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
// Trash + Panel (UI estática en el mundo)
// ---------------------------
const trashSystem = new TrashSystem(scene, appState, stateSyncSystem)

// Creamos panel y bote y los agregamos a la escena (NO a la cabeza)
const { group: vrPanel, buttons: panelButtons } = createVRPanel({
  // posición temporal; se recalcula al iniciar XR
  position: new THREE.Vector3(0.5, 1.2, -0.8),
  rotationY: 0,
  onAdd: addCube,
  onSave: saveState,
  onLoad: loadState,
})
scene.add(vrPanel)

// Registrar botones como interactuables
for (const b of panelButtons) interactionSystem.register(b)

// Crear bote (posición temporal; se recalcula al iniciar XR)
const trashBin = trashSystem.createTrashBin({
  parent: scene,
  position: new THREE.Vector3(-0.6, 0.0, -0.8),
})

// Más visible (no depender tanto de luces)
trashBin.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x222222)
  }
})
vrPanel.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x333333)
  }
})

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
// Posicionamiento estático cerca del usuario (solo 1 vez al entrar a VR)
// ---------------------------
let uiPlaced = false

const _tmpPos = new THREE.Vector3()
const _tmpQuat = new THREE.Quaternion()
const _tmpScale = new THREE.Vector3()
const _tmpEuler = new THREE.Euler()
const _yawQuat = new THREE.Quaternion()
const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()

function getHeadPose(outPos, outQuat) {
  const xrCam = renderer.xr.getCamera(camera)
  const poseCam =
    xrCam?.isArrayCamera && Array.isArray(xrCam.cameras) && xrCam.cameras.length > 0
      ? xrCam.cameras[0]
      : xrCam

  poseCam.matrixWorld.decompose(outPos, outQuat, _tmpScale)
}

function placeUIOnceNearUser() {
  // Toma pose actual de cabeza
  getHeadPose(_tmpPos, _tmpQuat)

  // Sacar solo yaw (rotación en Y) para que UI quede “enfrente” sin inclinarse por pitch/roll
  _tmpEuler.setFromQuaternion(_tmpQuat, "YXZ")
  const yaw = _tmpEuler.y
  _yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

  // Vectores forward/right en XZ
  _forward.set(0, 0, -1).applyQuaternion(_yawQuat).normalize()
  _right.set(1, 0, 0).applyQuaternion(_yawQuat).normalize()

  // --- Panel (derecha, un poco adelante, a altura pecho) ---
  // ✅ Lo alejamos para que NO se corte:
  // antes estaba muy cerca (0.35m); ahora ~0.85m adelante
  const panelWorldPos = _tmpPos
    .clone()
    .add(_right.clone().multiplyScalar(0.55))   // derecha
    .add(_forward.clone().multiplyScalar(0.85)) // adelante
  panelWorldPos.y = Math.max(1.05, _tmpPos.y - 0.35) // altura pecho aprox

  vrPanel.position.copy(panelWorldPos)

  // Que mire hacia el usuario (en XZ)
  vrPanel.lookAt(_tmpPos.x, vrPanel.position.y, _tmpPos.z)

  // --- Bote (izquierda, adelante, en el piso) ---
  const trashWorldPos = _tmpPos
    .clone()
    .add(_right.clone().multiplyScalar(-0.65))  // izquierda
    .add(_forward.clone().multiplyScalar(0.80)) // adelante
  trashWorldPos.y = 0.0 // piso

  trashBin.position.copy(trashWorldPos)

  // Opcional: que también “mire” al usuario
  trashBin.lookAt(_tmpPos.x, trashBin.position.y, _tmpPos.z)

  uiPlaced = true
  console.log("✅ UI colocada en el mundo cerca del usuario (estática)")
}

// Cuando inicia XR, colocamos UI una vez
renderer.xr.addEventListener("sessionstart", () => {
  // Espera a que exista pose válida (primer frame). Lo hacemos con flag en el loop también.
  uiPlaced = false
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
  // En cuanto haya XR presentando, colocamos UI una sola vez
  if (renderer.xr.isPresenting && !uiPlaced) {
    placeUIOnceNearUser()
  }

  interactionSystem.update()

  // Check del bote (solo borra objetos sueltos)
  trashSystem.update(stateSyncSystem.meshById.values())

  sceneManager.render()
})