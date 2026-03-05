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

const sceneManager = new SceneManager()
const { scene, camera, renderer } = sceneManager

new VRManager(renderer)

const appState = new AppState()
const interactionSystem = new InteractionSystem(sceneManager, appState)
const stateSyncSystem = new StateSyncSystem(scene, appState, interactionSystem)

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

// Mesa cómoda en VR
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

// ---------------------------
// Helpers: IDs y acciones
// ---------------------------
function genId(prefix = "cmp") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function addCube() {
  const id = genId("cube")

  // Spawn cercano: sobre el protoboard pero ligeramente hacia el usuario
  const p = protoboard.position.clone()
  p.y += 0.15
  p.z += 0.12

  appState.addComponent({
    id,
    type: "cube",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
  })

  stateSyncSystem.rebuildFromState()
}

function saveState() {
  localStorage.setItem("vr_circuit_state", appState.toJSON())
  console.log("✅ Estado guardado")
}

function loadState() {
  const raw = localStorage.getItem("vr_circuit_state")
  if (!raw) return console.log("⚠️ No hay estado guardado")
  appState.loadFromObject(JSON.parse(raw))
  stateSyncSystem.rebuildFromState()
  console.log("✅ Estado cargado y reconstruido")
}

// ---------------------------
// Panel 3D (VR UI) - ESTÁTICO EN EL MUNDO
// ---------------------------
// ✅ Lo alejamos MÁS para evitar que se “corte” (queda ~0.8-1.0m frente al origen)
const panelWorldPos = new THREE.Vector3(0.85, 1.15, -1.5)
const panelRotY = -Math.PI / 6 // 30° ligeramente hacia el centro

const { group: vrPanel, buttons: panelButtons } = createVRPanel({
  position: panelWorldPos,
  rotationY: panelRotY,
  onAdd: addCube,
  onSave: saveState,
  onLoad: loadState,
})
scene.add(vrPanel)

// Registrar botones como interactuables (para hover + ray + select)
for (const b of panelButtons) interactionSystem.register(b)

// Refuerzo visual para que se note
vrPanel.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x333333)
  }
})

// ---------------------------
// Trash System (bote) - ESTÁTICO EN EL MUNDO
// ---------------------------
const trashSystem = new TrashSystem(scene, appState, stateSyncSystem)

// ✅ En el piso, lado izquierdo del usuario (cerca del origen, sin moverse con la cabeza)
const trashBin = trashSystem.createTrashBin({
  parent: scene,
  position: new THREE.Vector3(-0.2, 0.0, 0.2),
})

// Refuerzo visual
trashBin.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x222222)
  }
})

// ---------------------------
// UI HTML (PC) opcional
// ---------------------------
document.getElementById("btn-add-cube")?.addEventListener("click", addCube)

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase()
  if (k === "c") addCube()
  if (k === "s") saveState()
  if (k === "l") loadState()
})

// ---------------------------
// Init
// ---------------------------
stateSyncSystem.rebuildFromState()

// ---------------------------
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  interactionSystem.update()

  // Check del bote (solo borra objetos sueltos)
  trashSystem.update(stateSyncSystem.meshById.values())

  sceneManager.render()
})