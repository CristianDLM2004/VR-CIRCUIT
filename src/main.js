import * as THREE from "three"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"

import { createProtoboard } from "./components/Protoboard.js"
import { HoleSystem } from "./systems/HoleSystem.js"
import { createVRPanel } from "./components/VRPanel.js"

import { TrashSystem } from "./systems/TrashSystem.js"
import { PhysicsSystem } from "./systems/PhysicsSystem.js"
import { ElectricalSystem } from "./systems/ElectricalSystem.js"

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
// Piso + Mesa (surfaces)
// ---------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
)
floor.rotation.x = -Math.PI / 2
floor.position.y = 0
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
    minX: tableBox.min.x + tableMargin,
    maxX: tableBox.max.x - tableMargin,
    minZ: tableBox.min.z + tableMargin,
    maxZ: tableBox.max.z - tableMargin,
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

// Visualización de holes
const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 })

for (const hole of holeSystem.holes) {
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.0025, 6, 6),
    holeMat
  )
  dot.position.copy(hole.worldPos)
  scene.add(dot)
}

// ---------------------------
// Helpers: IDs y acciones
// ---------------------------
function genId(prefix = "cmp") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function addBattery5V() {
  const id = genId("battery5v")

  const p = protoboard.position.clone()
  p.y += 0.15
  p.z += 0.12

  const data = {
    id,
    type: "battery5v",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: {
      voltage: 5,
    },
  }

  appState.addComponent(data)
  stateSyncSystem.addMeshFromComponent(data)
}

function addLed() {
  const id = genId("led")

  const p = protoboard.position.clone()
  p.y += 0.25
  p.z += 0.12

  const data = {
    id,
    type: "led",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: {
      color: "red",
    },
  }

  appState.addComponent(data)
  stateSyncSystem.addMeshFromComponent(data)
}

function addResistor() {
  const id = genId("resistor")

  const p = protoboard.position.clone()
  p.y += 0.32
  p.z += 0.12

  const data = {
    id,
    type: "resistor",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
    meta: {
      resistance: 220,
      bands: ["red", "red", "brown", "gold"],
    },
  }

  appState.addComponent(data)
  stateSyncSystem.addMeshFromComponent(data)
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
  electricalSystem.resetAllLedStates()
  stateSyncSystem.rebuildFromState()
  console.log("✅ Estado cargado y reconstruido")
}

function clearScene() {
  appState.components = []
  appState.connections = []
  physicsSystem.clearAllBodies()
  electricalSystem.resetAllLedStates()
  stateSyncSystem.rebuildFromState()
  console.log("🧹 Escena limpiada")
}

// ---------------------------
// Modo cable
// ---------------------------
let wireModeActive = false

function toggleWireMode() {
  wireModeActive = !wireModeActive

  if (typeof interactionSystem.setToolMode === "function") {
    interactionSystem.setToolMode(wireModeActive ? "wire" : "grab")
  } else {
    interactionSystem.toolMode = wireModeActive ? "wire" : "grab"
  }

  console.log(wireModeActive ? "🧵 Modo cable activado" : "✋ Modo cable desactivado")
}

// ---------------------------
// Panel 3D (VR UI)
// ---------------------------
const panelWorldPos = new THREE.Vector3(0.55, 1.15, -0.50)
const panelRotY = -Math.PI / 6

const { group: vrPanel, buttons: panelButtons } = createVRPanel({
  position: panelWorldPos,
  rotationY: panelRotY,
  onAdd: addBattery5V,
  onLed: addLed,
  onResistor: addResistor,
  onWire: toggleWireMode,
  onSave: saveState,
  onLoad: loadState,
})
scene.add(vrPanel)

for (const b of panelButtons) interactionSystem.register(b)

vrPanel.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x333333)
  }
})

// ---------------------------
// Botón 3D de limpiar escena
// ---------------------------
function createClearSceneButton({
  position = new THREE.Vector3(0.95, 0.82, -0.25),
  rotationY = -Math.PI / 5,
  onPress = () => { },
} = {}) {
  const group = new THREE.Group()
  group.name = "ClearSceneButton"
  group.position.copy(position)
  group.rotation.y = rotationY

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.11, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 })
  )
  base.position.y = 0.04
  base.receiveShadow = true
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
    onPress()
  }
  group.add(button)

  const iconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })

  const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.008), iconMat)
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.008), iconMat)
  bar1.rotation.z = Math.PI / 4
  bar2.rotation.z = -Math.PI / 4
  bar1.position.y = 0.02
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

const trashBin = trashSystem.createTrashBin({
  parent: scene,
  position: new THREE.Vector3(-0.55, 0.0, -0.10),
})

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

// ---------------------------
// Electrical System
// ---------------------------
const electricalSystem = new ElectricalSystem(scene, appState, stateSyncSystem, holeSystem)

// ---------------------------
// UI HTML (PC) opcional
// ---------------------------
document.getElementById("btn-add-cube")?.addEventListener("click", addBattery5V)

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase()
  if (k === "c") addBattery5V()
  if (k === "v") addLed()
  if (k === "b") addResistor()
  if (k === "w") toggleWireMode()
  if (k === "s") saveState()
  if (k === "l") loadState()
  if (k === "x") clearScene()
})

// ---------------------------
// Init
// ---------------------------
stateSyncSystem.rebuildFromState()

// ---------------------------
// Clock
// ---------------------------
const clock = new THREE.Clock()

// ---------------------------
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.033, clock.getDelta())

  interactionSystem.update()
  physicsSystem.update(stateSyncSystem.meshById.values(), dt)
  trashSystem.update(stateSyncSystem.meshById.values())
  electricalSystem.update(dt)
  sceneManager.render()
})