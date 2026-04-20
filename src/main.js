import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"
import { ElectricalSystem } from "./systems/ElectricalSystem.js"

import { createProtoboard } from "./components/Protoboard.js"
import { HoleSystem } from "./systems/HoleSystem.js"
import { createSpawnPanel } from "./components/SpawnPanel.js"
import { createModePanel } from "./components/ModePanel.js"
import { createEditPanel } from "./components/EditPanel.js"

import { TrashSystem } from "./systems/TrashSystem.js"
import { PhysicsSystem } from "./systems/PhysicsSystem.js"

const sceneManager = new SceneManager()
const { scene, camera, renderer } = sceneManager

new VRManager(renderer)

const appState = new AppState()
const interactionSystem = new InteractionSystem(sceneManager, appState)
const stateSyncSystem = new StateSyncSystem(scene, appState, interactionSystem)
interactionSystem.setStateSyncSystem(stateSyncSystem)

// ---------------------------
// Luces + entorno salón Mrs. Puff
// ---------------------------
scene.background = new THREE.Color(0xcfc78a)
scene.fog = new THREE.Fog(0xcfc78a, 14, 28)

scene.add(new THREE.AmbientLight(0xffffff, 0.95))

const hemi = new THREE.HemisphereLight(0xf7f4ea, 0xb8c4d6, 1.10)
hemi.position.set(0, 4, 0)
scene.add(hemi)

const dir = new THREE.DirectionalLight(0xfff4dc, 1.15)
dir.position.set(2.5, 4.5, 1.5)
scene.add(dir)

const frontSpot = new THREE.SpotLight(0xfff1d8, 1.8, 10, Math.PI / 5, 0.35, 1.0)
frontSpot.position.set(0, 3.2, -1.8)
frontSpot.target.position.set(0, 0.8, -0.9)
scene.add(frontSpot)
scene.add(frontSpot.target)

const centerFill = new THREE.PointLight(0xffffff, 0.45, 8)
centerFill.position.set(0, 2.4, 0)
scene.add(centerFill)

// ---------------------------
// Piso físico invisible
// ---------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
)
floor.rotation.x = -Math.PI / 2
floor.visible = false
scene.add(floor)
interactionSystem.registerSurface(floor, { type: "floor" })

// ---------------------------
// Entorno GLB
// ---------------------------
let table = null
let protoboard = null
let protoSurface = null
let layout = null
let holeSystem = null
let holeDots = null

const classroomRoot = new THREE.Group()
classroomRoot.name = "MrsPuffsClassroomRoot"
scene.add(classroomRoot)

// Mesa helper invisible alineada al escritorio de la miss
const tableHelper = new THREE.Mesh(
  new THREE.BoxGeometry(1.80, 0.08, 0.95),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
)
tableHelper.name = "TeacherDeskHelper"
tableHelper.visible = false
scene.add(tableHelper)

function updateTableSurfaceBounds() {
  if (!table) return

  table.updateMatrixWorld(true)

  const tableBox = new THREE.Box3().setFromObject(table)
  const tableMargin = 0.10

  interactionSystem.registerSurface(table, {
    type: "table",
    bounds: {
      minX: tableBox.min.x + tableMargin,
      maxX: tableBox.max.x - tableMargin,
      minZ: tableBox.min.z + tableMargin,
      maxZ: tableBox.max.z - tableMargin,
    },
  })
}

function rebuildProtoboardOnDesk() {
  if (!table) return

  if (protoboard) {
    scene.remove(protoboard)
    protoboard = null
  }

  if (holeDots) {
    scene.remove(holeDots)
    holeDots = null
  }

  const tableTopY = table.position.y + 0.04

  const protoData = createProtoboard({
  position: new THREE.Vector3(
    table.position.x,
    tableTopY + 0.03,
    table.position.z + 0.18
  ),
})

  protoboard = protoData.group
  protoSurface = protoData.surfaceMesh
  layout = protoData.layout

  scene.add(protoboard)
  interactionSystem.registerSurface(protoSurface, { type: "protoboard" })

  holeSystem = new HoleSystem(protoboard, layout)
  interactionSystem.setHoleSystem(holeSystem)
  electricalSystem.holeSystem = holeSystem

  const SHOW_PROTO_HOLE_DOTS = true
  if (SHOW_PROTO_HOLE_DOTS) {
    const holeGeo = new THREE.SphereGeometry(0.0025, 6, 6)
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
    holeDots = new THREE.InstancedMesh(holeGeo, holeMat, holeSystem.holes.length)
    holeDots.name = "ProtoboardHoleDots"

    const holeMatrix = new THREE.Matrix4()

    for (let i = 0; i < holeSystem.holes.length; i++) {
      holeMatrix.makeTranslation(
        holeSystem.holes[i].worldPos.x,
        holeSystem.holes[i].worldPos.y,
        holeSystem.holes[i].worldPos.z
      )
      holeDots.setMatrixAt(i, holeMatrix)
    }

    holeDots.instanceMatrix.needsUpdate = true
    scene.add(holeDots)
  }
}

const classroomModelUrl = `${import.meta.env.BASE_URL}models/mrs-puffs-classroom.glb`
const classroomLoader = new GLTFLoader()
classroomLoader.load(
  classroomModelUrl,
  (gltf) => {
    const classroom = gltf.scene
    classroom.name = "MrsPuffsClassroom"

    classroomRoot.clear()
    classroomRoot.add(classroom)

    classroom.traverse((obj) => {
      if (!obj.isMesh) return

      obj.castShadow = false
      obj.receiveShadow = true

      if (obj.material) {
        if (Array.isArray(obj.material)) {
          for (const mat of obj.material) {
            if (mat?.map) mat.map.anisotropy = 4
          }
        } else {
          if (obj.material.map) obj.material.map.anisotropy = 4
        }
      }
    })

    const rawBox = new THREE.Box3().setFromObject(classroom)
    const rawSize = rawBox.getSize(new THREE.Vector3())
    console.log("📏 Tamaño original del salón:", rawSize)

    const targetRoomWidth = 7.2
    const scaleFactor = rawSize.x > 0 ? targetRoomWidth / rawSize.x : 1
    classroom.scale.setScalar(scaleFactor)
    classroom.updateMatrixWorld(true)

    const scaledBox = new THREE.Box3().setFromObject(classroom)
    const scaledSize = scaledBox.getSize(new THREE.Vector3())
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3())

    console.log("📏 Tamaño escalado del salón:", scaledSize)
    console.log("📍 Centro escalado del salón:", scaledCenter)
    console.log("📍 Min escalado:", scaledBox.min)
    console.log("📍 Max escalado:", scaledBox.max)

    classroom.position.x -= scaledCenter.x
    classroom.position.y -= scaledBox.min.y

    // Ajuste moderado: mantiene al usuario dentro del salón y detrás del escritorio
    classroom.position.z = -2.75
    classroom.position.x -= 0.08 //Negativos a la izquierda, positivos a la derecha

    classroom.updateMatrixWorld(true)

    // ESTE valor se queda porque ya comprobaste que coincide con el escritorio
    tableHelper.position.set(0.00, 0.76, 0.65)
    tableHelper.updateMatrixWorld(true)

    table = tableHelper
    updateTableSurfaceBounds()
    rebuildProtoboardOnDesk()

    // Botones físicos delante de ti pero todavía sobre la zona del escritorio
    btnSpawnGroup.position.set(0.18, tableButtonY, table.position.z - 0.34)
    btnModeGroup.position.set(0.34, tableButtonY, table.position.z - 0.34)
    btnEditGroup.position.set(0.50, tableButtonY, table.position.z - 0.34)

    // Bote al costado izquierdo, cerca del escritorio
    trashBin.position.set(-0.55, 0.20, table.position.z - 0.18)

    console.log("✅ Salón cargado")
  },
  () => {
    console.log("📦 Cargando salón desde:", classroomModelUrl)
  },
  (error) => {
    console.error("❌ No se pudo cargar el salón GLB:", classroomModelUrl, error)

    tableHelper.position.set(0, 0.75, -0.8)
    tableHelper.updateMatrixWorld(true)
    table = tableHelper
    updateTableSurfaceBounds()
    rebuildProtoboardOnDesk()
  }
)
// ---------------------------
// Sistema eléctrico
// ---------------------------
const electricalSystem = new ElectricalSystem(appState, stateSyncSystem, null)
// ---------------------------
// Helpers base
// ---------------------------
function genId(prefix = "cmp") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function namedColorToHex(name, fallback = 0xffffff) {
  if (typeof name !== "string") return fallback
  const n = name.trim().toLowerCase()

  const map = {
    red: 0xff3b3b,
    green: 0x2ecc71,
    blue: 0x3498db,
    yellow: 0xf1c40f,
    orange: 0xe67e22,
    purple: 0x9b59b6,
    magenta: 0xff00ff,
    cyan: 0x00d8ff,
    white: 0xffffff,
    black: 0x111111,
    brown: 0x8b4513,
    gray: 0x95a5a6,
    gold: 0xd4af37,
  }

  if (n in map) return map[n]
  if (n.startsWith("#")) {
    const parsed = Number.parseInt(n.slice(1), 16)
    if (Number.isFinite(parsed)) return parsed
  }

  return fallback
}

function normalizeColorValue(value, fallback = 0xffffff) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0
  if (typeof value === "string") return namedColorToHex(value, fallback)
  return fallback
}

function resistanceToBands(value) {
  const ohms = Math.max(10, Math.round(Number(value) || 220))
  const colorDigits = [
    "black",
    "brown",
    "red",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "gray",
    "white",
  ]
  const s = String(ohms)
  const d1 = Number(s[0] || 2)
  const d2 = Number(s[1] || 2)
  const mult = Math.max(0, s.length - 2)
  return [colorDigits[d1], colorDigits[d2], colorDigits[mult] || "black", "gold"]
}

function getComponentById(id) {
  return appState.components.find((c) => c.id === id) || null
}

function getLatestComponentByType(type) {
  for (let i = appState.components.length - 1; i >= 0; i--) {
    if (appState.components[i].type === type) return appState.components[i]
  }
  return null
}

function getSpawnBasePosition() {
  if (protoboard) return protoboard.position.clone()
  if (table) return new THREE.Vector3(table.position.x, table.position.y + 0.12, table.position.z)
  return new THREE.Vector3(0, 0.9, -0.8)
}

function syncSpecialRefs(mesh) {
  if (!mesh) return
  if (mesh.userData?.isSwitchComponent || mesh.userData?.isButtonComponent) {
    mesh.userData._appStateRef = appState
  }
}

function refreshComponentMeshById(id) {
  const data = getComponentById(id)
  if (!data) return null
  stateSyncSystem.removeMeshById(id)
  const mesh = stateSyncSystem.addMeshFromComponent(data)
  syncSpecialRefs(mesh)
  return mesh
}

function extractHeldIdFromCandidate(candidate) {
  if (!candidate) return null
  if (candidate.userData?.componentId) return candidate.userData.componentId
  if (candidate.userData?.heldObject?.userData?.componentId) return candidate.userData.heldObject.userData.componentId
  if (candidate.heldObject?.userData?.componentId) return candidate.heldObject.userData.componentId
  return null
}

function getHeldComponentId() {
  if (Array.isArray(interactionSystem.hands)) {
    for (const entry of interactionSystem.hands) {
      const direct =
        extractHeldIdFromCandidate(entry) ||
        extractHeldIdFromCandidate(entry?.hand) ||
        extractHeldIdFromCandidate(entry?.input) ||
        extractHeldIdFromCandidate(entry?.object)
      if (direct) return direct
    }
  }

  if (Array.isArray(interactionSystem.controllers)) {
    for (const entry of interactionSystem.controllers) {
      const direct =
        extractHeldIdFromCandidate(entry) ||
        extractHeldIdFromCandidate(entry?.controller) ||
        extractHeldIdFromCandidate(entry?.controllerGrip) ||
        extractHeldIdFromCandidate(entry?.input) ||
        extractHeldIdFromCandidate(entry?.object)
      if (direct) return direct
    }
  }

  return null
}

function getHeldComponent() {
  const id = getHeldComponentId()
  return id ? getComponentById(id) : null
}

function getHeldMesh() {
  const heldId = getHeldComponentId()
  return heldId ? stateSyncSystem.getMeshById(heldId) : null
}

function getEditingTargetComponent() {
  const held = getHeldComponent()
  if (held && (held.type === "led" || held.type === "wire" || held.type === "resistor")) return held
  return getSelectedComponent()
}

function getEditingTargetMesh() {
  const heldComp = getHeldComponent()
  if (heldComp && (heldComp.type === "led" || heldComp.type === "wire" || heldComp.type === "resistor")) {
    return getHeldMesh()
  }
  const selected = getSelectedComponent()
  if (!selected) return null
  return stateSyncSystem.getMeshById(selected.id)
}

function applyLedColorToMesh(mesh, hex) {
  if (!mesh) return
  const safeHex = normalizeColorValue(hex, 0xff3b3b)

  mesh.userData.meta = { ...(mesh.userData.meta || {}), color: safeHex }
  mesh.userData.baseLedColor = safeHex

  mesh.traverse((child) => {
    if (!child.isMesh) return
    if (child.name !== "LEDBody" && child.name !== "LEDDome") return
    if (child.material?.color) child.material.color.setHex(safeHex)
    if ("emissive" in child.material) {
      child.material.emissive.setHex(0x000000)
      child.material.emissiveIntensity = 0
    }
  })
}

function applyWireColorToMesh(mesh, hex) {
  if (!mesh?.userData?.rebuildWireGeometry) return
  const safeHex = normalizeColorValue(hex, 0x111111)

  mesh.userData.wireColor = safeHex
  mesh.userData.meta = { ...(mesh.userData.meta || {}), color: safeHex }

  const points = Array.isArray(mesh.userData.fixedPoints)
    ? mesh.userData.fixedPoints.map((p) => p.clone())
    : []

  if (points.length >= 2) {
    mesh.userData.rebuildWireGeometry(points)
  }
}

function applyResistorBandsToMesh(mesh, resistance) {
  if (!mesh) return

  const safeResistance = Math.max(10, Math.round(Number(resistance) || 220))
  const bands = resistanceToBands(safeResistance).map((c) => namedColorToHex(c, 0x000000))

  mesh.userData.meta = {
    ...(mesh.userData.meta || {}),
    resistance: safeResistance,
    bands: resistanceToBands(safeResistance),
  }

  for (let i = 0; i < 4; i++) {
    const bandMesh = mesh.children.find((c) => c.name === `ResistorBand_${i}`)
    if (bandMesh?.material?.color) {
      bandMesh.material.color.setHex(bands[i] ?? 0x000000)
    }
  }
}

// ---------------------------
// Selección y edición
// ---------------------------
let selectedComponentId = null
let pendingColorHex = null
let pendingResistanceValue = null

function getSelectedComponent() {
  return selectedComponentId ? getComponentById(selectedComponentId) : null
}

function clearPendingChanges() {
  pendingColorHex = null
  pendingResistanceValue = null
}

function selectComponent(id) {
  selectedComponentId = id || null
  clearPendingChanges()
  refreshEditPanel()
}

function clearSelection() {
  selectedComponentId = null
  clearPendingChanges()
  refreshEditPanel()
}

function selectHeldComponent() {
  const heldId = getHeldComponentId()
  if (!heldId) return
  selectedComponentId = heldId
  clearPendingChanges()
  refreshEditPanel()
}

function selectLastWire() {
  const wire = getLatestComponentByType("wire")
  if (!wire) return
  selectedComponentId = wire.id
  clearPendingChanges()
  refreshEditPanel()
}

function refreshEditPanel() {
  const comp = getEditingTargetComponent()
  if (!comp) {
    editPanelApi.updateForSelection(null)
    return
  }

  if (comp.type === "resistor") {
    const currentResistance = Math.max(10, Math.round(Number(comp.meta?.resistance) || 220))
    editPanelApi.updateForSelection({
      id: comp.id,
      type: comp.type,
      resistance: currentResistance,
      pendingResistance: pendingResistanceValue,
      hasPendingChanges: pendingResistanceValue !== null,
    })
    return
  }

  if (comp.type === "led") {
    editPanelApi.updateForSelection({
      id: comp.id,
      type: comp.type,
      color: normalizeColorValue(comp.meta?.color, 0xff3b3b),
      pendingColor: pendingColorHex,
      hasPendingChanges: pendingColorHex !== null,
    })
    return
  }

  if (comp.type === "wire") {
    editPanelApi.updateForSelection({
      id: comp.id,
      type: comp.type,
      color: normalizeColorValue(comp.meta?.color, 0x111111),
      pendingColor: pendingColorHex,
      hasPendingChanges: pendingColorHex !== null,
    })
    return
  }

  editPanelApi.updateForSelection({
    id: comp.id,
    type: comp.type,
    hasPendingChanges: false,
  })
}

function queueResistanceDelta(delta) {
  let comp = getEditingTargetComponent()

  if (!comp) {
    const held = getHeldComponent()
    if (held?.type === "resistor") {
      selectedComponentId = held.id
      comp = held
    }
  }

  if (!comp || comp.type !== "resistor") return

  const base = pendingResistanceValue ?? Math.max(10, Math.round(Number(comp.meta?.resistance) || 220))
  pendingResistanceValue = Math.max(10, base + delta)
  refreshEditPanel()
}

function queueColorPicked(hex) {
  let comp = getEditingTargetComponent()

  if (!comp) {
    const held = getHeldComponent()
    if (held && (held.type === "led" || held.type === "wire")) {
      selectedComponentId = held.id
      comp = held
    }
  }

  if (!comp) return
  if (comp.type !== "led" && comp.type !== "wire") return

  pendingColorHex = normalizeColorValue(hex, comp.type === "led" ? 0xff3b3b : 0x111111)
  refreshEditPanel()
}

function applyPendingChanges() {
  const comp = getEditingTargetComponent()
  const mesh = getEditingTargetMesh()
  if (!comp || !mesh) return

  if (comp.type === "led" && pendingColorHex !== null) {
    appState.updateComponent(comp.id, {
      meta: { ...comp.meta, color: pendingColorHex },
    })
    applyLedColorToMesh(mesh, pendingColorHex)
    pendingColorHex = null
    refreshEditPanel()
    return
  }

  if (comp.type === "wire" && pendingColorHex !== null) {
    appState.updateComponent(comp.id, {
      meta: { ...comp.meta, color: pendingColorHex },
    })
    applyWireColorToMesh(mesh, pendingColorHex)
    pendingColorHex = null
    refreshEditPanel()
    return
  }

  if (comp.type === "resistor" && pendingResistanceValue !== null) {
    const next = Math.max(10, Math.round(Number(pendingResistanceValue) || 220))
    const nextBands = resistanceToBands(next)

    appState.updateComponent(comp.id, {
      meta: { ...comp.meta, resistance: next, bands: nextBands },
    })

    applyResistorBandsToMesh(mesh, next)
    pendingResistanceValue = null
    refreshEditPanel()
  }
}

// ---------------------------
// Crear componentes
// ---------------------------
function addBattery5V() {
  const id = genId("battery5v")
  const p = getSpawnBasePosition(); p.y += 0.15; p.z += 0.12

  const data = {
    id,
    type: "battery5v",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: { voltage: 5 },
  }

  appState.addComponent(data)
  const mesh = stateSyncSystem.addMeshFromComponent(data)
  syncSpecialRefs(mesh)
  selectComponent(id)
}

function addLed() {
  const id = genId("led")
  const p = getSpawnBasePosition(); p.y += 0.25; p.z += 0.12

  const data = {
    id,
    type: "led",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: { color: 0xff3b3b },
  }

  appState.addComponent(data)
  const mesh = stateSyncSystem.addMeshFromComponent(data)
  syncSpecialRefs(mesh)
  selectComponent(id)
}

function addResistor() {
  const id = genId("resistor")
  const p = getSpawnBasePosition(); p.y += 0.32; p.z += 0.12

  const resistance = 220
  const data = {
    id,
    type: "resistor",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: { resistance, bands: resistanceToBands(resistance) },
  }

  appState.addComponent(data)
  const mesh = stateSyncSystem.addMeshFromComponent(data)
  syncSpecialRefs(mesh)
  selectComponent(id)
}

function addButton() {
  const id = genId("button")
  const p = getSpawnBasePosition(); p.y += 0.25; p.z += 0.20

  const data = {
    id,
    type: "button",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: {},
  }

  appState.addComponent(data)
  const mesh = stateSyncSystem.addMeshFromComponent(data)
  syncSpecialRefs(mesh)
  selectComponent(id)
}

function addSwitch() {
  const id = genId("switch")
  const p = getSpawnBasePosition(); p.y += 0.25; p.z += 0.28

  const data = {
    id,
    type: "switch",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: { switchState: false },
  }

  appState.addComponent(data)
  const mesh = stateSyncSystem.addMeshFromComponent(data)
  syncSpecialRefs(mesh)
  selectComponent(id)
}

function saveState() {
  localStorage.setItem("vr_circuit_state", appState.toJSON())
  console.log("✅ Estado guardado")
}

function loadState() {
  const raw = localStorage.getItem("vr_circuit_state")
  if (!raw) return console.log("⚠️ No hay estado guardado")

  appState.loadFromObject(JSON.parse(raw))
  physicsSystem.clearAllBodies()
  stateSyncSystem.rebuildFromState()

  for (const mesh of stateSyncSystem.meshById.values()) {
    syncSpecialRefs(mesh)
  }

  clearSelection()
  knownComponentIds = new Set(appState.components.map((c) => c.id))
  console.log("✅ Estado cargado y reconstruido")
}

function clearScene() {
  appState.components = []
  appState.connections = []
  physicsSystem.clearAllBodies()
  stateSyncSystem.rebuildFromState()
  clearSelection()
  knownComponentIds = new Set()
  console.log("🧹 Escena limpiada")
}

// ---------------------------
// Modo cable — toggle
// ---------------------------
let wireModeActive = false
let setWireModeVisualFn = null

function toggleWireMode() {
  wireModeActive = !wireModeActive
  interactionSystem.setToolMode(wireModeActive ? "wire" : "grab")
  setWireModeVisualFn?.(wireModeActive)
  console.log(wireModeActive ? "🧵 Modo cable ACTIVADO" : "✋ Modo cable DESACTIVADO")
}

// ---------------------------
// Modo app — edición / simulación
// ---------------------------
let isSimMode = false
let setSimModeVisualFn = null

function toggleAppMode() {
  isSimMode = !isSimMode
  interactionSystem.setAppMode(isSimMode ? "sim" : "edit")
  setSimModeVisualFn?.(isSimMode)

  if (isSimMode && wireModeActive) {
    wireModeActive = false
    interactionSystem.setToolMode("grab")
    setWireModeVisualFn?.(false)
  }

  console.log(isSimMode ? "⚡ Modo SIMULACIÓN" : "🔧 Modo EDICIÓN")
}

// ---------------------------
// Paneles separados
// ---------------------------
const panelWorldPos = new THREE.Vector3(0.55, 1.15, -1.80)
const panelRotY = -Math.PI / 6

const { group: spawnPanel, buttons: spawnButtons } = createSpawnPanel({
  position: panelWorldPos,
  rotationY: panelRotY,
  onAdd: addBattery5V,
  onLed: addLed,
  onResistor: addResistor,
  onButton: addButton,
  onSwitch: addSwitch,
})

const { group: modePanel, buttons: modeButtons, setWireModeVisual, setSimModeVisual } = createModePanel({
  position: panelWorldPos,
  rotationY: panelRotY,
  onWire: toggleWireMode,
  onSave: saveState,
  onLoad: loadState,
  onMode: toggleAppMode,
  onClear: clearScene,
})

setWireModeVisualFn = setWireModeVisual
setSimModeVisualFn = setSimModeVisual

const editPanelApi = createEditPanel({
  position: new THREE.Vector3(-0.62, 1.15, -1.78),
  rotationY: Math.PI / 6,
  onSelectHeld: selectHeldComponent,
  onSelectLastWire: selectLastWire,
  onClearSelection: clearSelection,
  onResistanceDelta: queueResistanceDelta,
  onColorPicked: queueColorPicked,
  onAcceptChanges: applyPendingChanges,
})

scene.add(spawnPanel, modePanel, editPanelApi.group)

function clonePanelMaterials(group) {
  group.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone()
      if ("emissive" in o.material) o.material.emissive.setHex(0x202020)
    }
  })
}

clonePanelMaterials(spawnPanel)
clonePanelMaterials(modePanel)
clonePanelMaterials(editPanelApi.group)

function setPanelEnabled(group, buttons, enabled) {
  group.visible = enabled
  for (const b of buttons) {
    if (enabled) interactionSystem.register(b)
    else interactionSystem.unregister(b)
  }
}

setPanelEnabled(spawnPanel, spawnButtons, false)
setPanelEnabled(modePanel, modeButtons, false)
setPanelEnabled(editPanelApi.group, editPanelApi.buttons, false)

let openPanelKey = null

function closeAllPanels() {
  setPanelEnabled(spawnPanel, spawnButtons, false)
  setPanelEnabled(modePanel, modeButtons, false)
  setPanelEnabled(editPanelApi.group, editPanelApi.buttons, false)
  openPanelKey = null
}

function togglePanel(panelKey) {
  if (openPanelKey === panelKey) {
    closeAllPanels()
    return
  }

  closeAllPanels()

  if (panelKey === "spawn") {
    setPanelEnabled(spawnPanel, spawnButtons, true)
    openPanelKey = "spawn"
    return
  }

  if (panelKey === "mode") {
    setPanelEnabled(modePanel, modeButtons, true)
    openPanelKey = "mode"
    return
  }

  if (panelKey === "edit") {
    setPanelEnabled(editPanelApi.group, editPanelApi.buttons, true)
    openPanelKey = "edit"
  }
}

// ---------------------------
// Botones físicos en mesa para abrir paneles
// ---------------------------
function createTableToggleButton({ name, label, color, position, onPress }) {
  const group = new THREE.Group()
  group.name = name
  group.position.copy(position)

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.060, 0.028, 18),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.88 })
  )
  base.position.y = 0.014
  group.add(base)

  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.046, 0.046, 0.020, 20),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
  )
  button.position.y = 0.034
  button.userData.isUI = true
  button.userData._lastPressMs = 0
  button.userData._cooldownMs = 250
  button.userData.onPress = () => {
    const now = performance.now()
    if (now - button.userData._lastPressMs < button.userData._cooldownMs) return
    button.userData._lastPressMs = now
    button.scale.set(0.92, 0.92, 0.92)
    setTimeout(() => button.scale.set(1, 1, 1), 80)
    onPress()
  }
  group.add(button)

  const texCanvas = document.createElement("canvas")
  texCanvas.width = 256
  texCanvas.height = 128
  const ctx = texCanvas.getContext("2d")
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, 256, 128)
  ctx.fillStyle = "#ffffff"
  ctx.font = "bold 38px Arial"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(label, 128, 64)
  const tex = new THREE.CanvasTexture(texCanvas)
  tex.colorSpace = THREE.SRGBColorSpace

  const labelPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.085, 0.040),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  )
  labelPlane.position.set(0, 0.035, 0.047)
  button.add(labelPlane)

  return { group, button }
}

const tableButtonY = 0.80

const { group: btnSpawnGroup, button: btnSpawn } = createTableToggleButton({
  name: "BtnTableSpawn",
  label: "Comp.",
  color: 0x2ecc71,
  position: new THREE.Vector3(0.18, tableButtonY, -1.63),
  onPress: () => togglePanel("spawn"),
})

const { group: btnModeGroup, button: btnMode } = createTableToggleButton({
  name: "BtnTableMode",
  label: "Modos",
  color: 0x3498db,
  position: new THREE.Vector3(0.34, tableButtonY, -1.63),
  onPress: () => togglePanel("mode"),
})

const { group: btnEditGroup, button: btnEdit } = createTableToggleButton({
  name: "BtnTableEdit",
  label: "Editor",
  color: 0x9b59b6,
  position: new THREE.Vector3(0.50, tableButtonY, -1.63),
  onPress: () => togglePanel("edit"),
})

scene.add(btnSpawnGroup, btnModeGroup, btnEditGroup)
interactionSystem.register(btnSpawn)
interactionSystem.register(btnMode)
interactionSystem.register(btnEdit)

// ---------------------------
// Trash System
// ---------------------------
const trashSystem = new TrashSystem(scene, appState, stateSyncSystem)
const trashBin = trashSystem.createTrashBin({ parent: scene, position: new THREE.Vector3(-0.55, 0.20, -1.40) })
trashBin.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x222222)
  }
})

// ---------------------------
// Physics
// ---------------------------
const physicsSystem = new PhysicsSystem(scene, camera, appState, stateSyncSystem, interactionSystem)
const clock = new THREE.Clock()

// ---------------------------
// UI HTML (PC)
// ---------------------------
document.getElementById("btn-add-cube")?.addEventListener("click", addBattery5V)

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase()
  if (k === "c") addBattery5V()
  if (k === "v") addLed()
  if (k === "b") addResistor()
  if (k === "n") addButton()
  if (k === "m") addSwitch()
  if (k === "w") toggleWireMode()
  if (k === "e") toggleAppMode()
  if (k === "s") saveState()
  if (k === "l") loadState()
  if (k === "x") clearScene()
  if (k === "h") selectHeldComponent()
  if (k === "j") selectLastWire()
  if (k === "enter") applyPendingChanges()
  if (k === "1") togglePanel("spawn")
  if (k === "2") togglePanel("mode")
  if (k === "3") togglePanel("edit")
})

// ---------------------------
// Init
// ---------------------------
stateSyncSystem.rebuildFromState()
for (const mesh of stateSyncSystem.meshById.values()) {
  syncSpecialRefs(mesh)
}
refreshEditPanel()

let knownComponentIds = new Set(appState.components.map((c) => c.id))

function detectNewComponents() {
  const nextIds = new Set()
  for (const comp of appState.components) {
    nextIds.add(comp.id)
    if (!knownComponentIds.has(comp.id)) {
      if (comp.type === "wire") {
        selectedComponentId = comp.id
        clearPendingChanges()
        refreshEditPanel()
      }
    }
  }
  knownComponentIds = nextIds
}

function validateSelection() {
  if (!selectedComponentId) return
  if (!getComponentById(selectedComponentId)) {
    clearSelection()
  }
}

// ---------------------------
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.033, clock.getDelta())
  interactionSystem.update()
  physicsSystem.update(stateSyncSystem.meshById.values(), dt)
  trashSystem.update(stateSyncSystem.meshById.values())
  electricalSystem.update(dt)

  detectNewComponents()
  validateSelection()

  sceneManager.render()
})