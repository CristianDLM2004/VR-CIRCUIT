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

// ✅ Mesa más realista y más cómoda en VR
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
// Trash System (bote de basura)
// ---------------------------
const trashSystem = new TrashSystem(scene, appState, stateSyncSystem)

// Debajo de la mesa, lado izquierdo (como pediste)
trashSystem.createTrashBin(new THREE.Vector3(-0.6, 0.0, table.position.z))

// ---------------------------
// Helpers: IDs y acciones
// ---------------------------
function genId(prefix = "cmp") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function addCube() {
  const id = genId("cube")

  // ✅ Spawn cercano: sobre el protoboard pero ligeramente hacia el usuario
  const p = protoboard.position.clone()
  p.y += 0.15
  p.z += 0.12 // acerca hacia el usuario (menos negativo = más cerca)

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
// Panel 3D (VR UI)
// ---------------------------
// ✅ Panel a la derecha, PERO más cerca (como pediste)
const panelPos = new THREE.Vector3(0.5, 1.22, -0.45)
const panelRotY = -Math.PI / 4

const { group: vrPanel, buttons: panelButtons } = createVRPanel({
  position: panelPos,
  rotationY: panelRotY,
  onAdd: addCube,
  onSave: saveState,
  onLoad: loadState,
})
scene.add(vrPanel)

// Registrar botones como interactuables (para hover + ray + select)
for (const b of panelButtons) interactionSystem.register(b)

// ---------------------------
// UI HTML (PC) se mantiene opcional
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

  // ✅ Check del bote (solo borra objetos sueltos)
  trashSystem.update(stateSyncSystem.meshById.values())

  sceneManager.render()
})