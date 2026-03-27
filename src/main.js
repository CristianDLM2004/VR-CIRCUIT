import * as THREE from "three"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"
import { ElectricalSystem } from "./systems/ElectricalSystem.js"

import { createProtoboard } from "./components/Protoboard.js"
import { HoleSystem } from "./systems/HoleSystem.js"
import { createVRPanel } from "./components/VRPanel.js"
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
// Luces
// ---------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const dir = new THREE.DirectionalLight(0xffffff, 1.0)
dir.position.set(2, 4, 2)
scene.add(dir)

// ---------------------------
// Piso + Mesa
// ---------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const table = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 0.1, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x444444 })
)
table.position.set(0, 0.75, -0.8)
scene.add(table)
table.updateMatrixWorld(true)

interactionSystem.registerSurface(floor, { type: "floor" })
const tableBox = new THREE.Box3().setFromObject(table)
const tableMargin = 0.12
interactionSystem.registerSurface(table, {
  type: "table",
  bounds: {
    minX: tableBox.min.x + tableMargin, maxX: tableBox.max.x - tableMargin,
    minZ: tableBox.min.z + tableMargin, maxZ: tableBox.max.z - tableMargin,
  },
})

// ---------------------------
// Protoboard + HoleSystem
// ---------------------------
const tableTopY = table.position.y + 0.05
const { group: protoboard, surfaceMesh: protoSurface, layout } = createProtoboard({
  position: new THREE.Vector3(table.position.x, tableTopY + 0.03, table.position.z),
})
scene.add(protoboard)
interactionSystem.registerSurface(protoSurface, { type: "protoboard" })

const holeSystem = new HoleSystem(protoboard, layout)
interactionSystem.setHoleSystem(holeSystem)

const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
for (const hole of holeSystem.holes) {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 6, 6), holeMat)
  dot.position.copy(hole.worldPos)
  scene.add(dot)
}

// ---------------------------
// Sistema eléctrico
// ---------------------------
const electricalSystem = new ElectricalSystem(appState, stateSyncSystem, holeSystem)

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
  if (candidate.userData?.heldObject?.userData?.componentId) {
    return candidate.userData.heldObject.userData.componentId
  }
  if (candidate.heldObject?.userData?.componentId) {
    return candidate.heldObject.userData.componentId
  }

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
  if (held && (held.type === "led" || held.type === "wire" || held.type === "resistor")) {
    return held
  }
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
      meta: {
        ...comp.meta,
        color: pendingColorHex,
      },
    })
    applyLedColorToMesh(mesh, pendingColorHex)
    pendingColorHex = null
    refreshEditPanel()
    return
  }

  if (comp.type === "wire" && pendingColorHex !== null) {
    appState.updateComponent(comp.id, {
      meta: {
        ...comp.meta,
        color: pendingColorHex,
      },
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
      meta: {
        ...comp.meta,
        resistance: next,
        bands: nextBands,
      },
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
  const p = protoboard.position.clone(); p.y += 0.15; p.z += 0.12

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
  const p = protoboard.position.clone(); p.y += 0.25; p.z += 0.12

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
  const p = protoboard.position.clone(); p.y += 0.32; p.z += 0.12

  const resistance = 220
  const data = {
    id,
    type: "resistor",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: {
      resistance,
      bands: resistanceToBands(resistance),
    },
  }

  appState.addComponent(data)
  const mesh = stateSyncSystem.addMeshFromComponent(data)
  syncSpecialRefs(mesh)
  selectComponent(id)
}

function addButton() {
  const id = genId("button")
  const p = protoboard.position.clone(); p.y += 0.25; p.z += 0.20

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
  const p = protoboard.position.clone(); p.y += 0.25; p.z += 0.28

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
// Panel 3D principal
// ---------------------------
const panelWorldPos = new THREE.Vector3(0.55, 1.15, -0.50)
const panelRotY = -Math.PI / 6

const { group: vrPanel, buttons: panelButtons, setWireModeVisual, setSimModeVisual } = createVRPanel({
  position: panelWorldPos,
  rotationY: panelRotY,
  onAdd: addBattery5V,
  onLed: addLed,
  onResistor: addResistor,
  onButton: addButton,
  onSwitch: addSwitch,
  onWire: toggleWireMode,
  onSave: saveState,
  onLoad: loadState,
  onMode: toggleAppMode,
})

setWireModeVisualFn = setWireModeVisual
setSimModeVisualFn = setSimModeVisual

scene.add(vrPanel)
for (const b of panelButtons) interactionSystem.register(b)

vrPanel.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x333333)
  }
})

// ---------------------------
// Panel de edición
// ---------------------------
const editPanelApi = createEditPanel({
  position: new THREE.Vector3(-0.62, 1.15, -0.48),
  rotationY: Math.PI / 6,
  onSelectHeld: selectHeldComponent,
  onSelectLastWire: selectLastWire,
  onClearSelection: clearSelection,
  onResistanceDelta: queueResistanceDelta,
  onColorPicked: queueColorPicked,
  onAcceptChanges: applyPendingChanges,
})

scene.add(editPanelApi.group)
for (const b of editPanelApi.buttons) interactionSystem.register(b)

editPanelApi.group.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x202020)
  }
})

// ---------------------------
// Botón 3D de limpiar escena
// ---------------------------
function createClearSceneButton({ position, rotationY, onPress }) {
  const group = new THREE.Group()
  group.name = "ClearSceneButton"
  group.position.copy(position)
  group.rotation.y = rotationY

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.11, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 })
  )
  base.position.y = 0.04
  group.add(base)

  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.035, 24),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.55 })
  )
  button.name = "BtnClearScene"
  button.position.y = 0.095
  button.userData.isUI = true
  button.userData.uiAction = "clear-scene"
  button.userData._lastPressMs = 0
  button.userData._cooldownMs = 500
  button.userData.onPress = () => {
    const now = performance.now()
    if (now - button.userData._lastPressMs < button.userData._cooldownMs) return
    button.userData._lastPressMs = now
    button.scale.set(0.9, 0.9, 0.9)
    setTimeout(() => button.scale.set(1, 1, 1), 100)
    onPress()
  }
  group.add(button)

  const iconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
  const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.008), iconMat)
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.008), iconMat)
  bar1.rotation.z = Math.PI / 4
  bar1.position.y = 0.02
  bar2.rotation.z = -Math.PI / 4
  bar2.position.y = 0.02
  button.add(bar1, bar2)

  return { group, button }
}

const { group: clearSceneButtonGroup, button: clearSceneButton } = createClearSceneButton({
  position: new THREE.Vector3(0.95, 0.82, -0.25),
  rotationY: -Math.PI / 5,
  onPress: clearScene,
})
scene.add(clearSceneButtonGroup)
interactionSystem.register(clearSceneButton)

clearSceneButtonGroup.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x222222)
  }
})

// ---------------------------
// Trash System
// ---------------------------
const trashSystem = new TrashSystem(scene, appState, stateSyncSystem)
const trashBin = trashSystem.createTrashBin({ parent: scene, position: new THREE.Vector3(-0.55, 0.0, -0.10) })
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
  refreshEditPanel()

  sceneManager.render()
})