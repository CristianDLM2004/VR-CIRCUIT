import * as THREE from "three"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"

const sceneManager = new SceneManager()
const { scene, camera, renderer } = sceneManager

new VRManager(renderer)

const appState = new AppState()
const interactionSystem = new InteractionSystem(sceneManager, appState)
const stateSyncSystem = new StateSyncSystem(scene, appState, interactionSystem)

// ---------------------------
// Escena base: luz, piso, mesa
// ---------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.6))

const dir = new THREE.DirectionalLight(0xffffff, 1.0)
dir.position.set(2, 4, 2)
scene.add(dir)

// Piso
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
)
floor.rotation.x = -Math.PI / 2
floor.position.y = 0
scene.add(floor)

// Mesa
const table = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 0.1, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x444444 })
)
table.position.set(0, 1.0, -1.0)
scene.add(table)

// Register surfaces
interactionSystem.registerSurface(floor, { type: "floor" })
const box = new THREE.Box3().setFromObject(table)
const margin = 0.12
interactionSystem.registerSurface(table, {
  type: "table",
  bounds: {
    minX: box.min.x + margin,
    maxX: box.max.x - margin,
    minZ: box.min.z + margin,
    maxZ: box.max.z - margin,
  },
})

// ---------------------------
// Helpers: spawn
// ---------------------------
function genId(prefix = "cmp") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function spawnPositionOnTableOrFront() {
  // Prefer mesa: centro superior de mesa
  const tableTopY = table.position.y + 0.1 // aprox (mesa es 0.1 de alto)
  const pos = new THREE.Vector3(table.position.x, tableTopY + 0.2, table.position.z)

  // Clamp dentro de bounds de mesa
  const b = interactionSystem.surfaces.find((s) => s.mesh === table)?.bounds
  if (b) {
    pos.x = THREE.MathUtils.clamp(pos.x, b.minX + 0.2, b.maxX - 0.2)
    pos.z = THREE.MathUtils.clamp(pos.z, b.minZ + 0.2, b.maxZ - 0.2)
  } else {
    // Fallback: frente a cámara
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize()
    pos.copy(camera.position).add(forward.multiplyScalar(1.2))
    pos.y = 1.2
  }

  return pos
}

function addCube() {
  const id = genId("cube")
  const p = spawnPositionOnTableOrFront()

  appState.addComponent({
    id,
    type: "cube",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
  })

  stateSyncSystem.rebuildFromState()
}

// ---------------------------
// UI overlay
// ---------------------------
const btnAddCube = document.getElementById("btn-add-cube")
btnAddCube?.addEventListener("click", () => addCube())

window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "c") addCube()

  if (e.key.toLowerCase() === "s") {
    localStorage.setItem("vr_circuit_state", appState.toJSON())
    console.log("✅ Estado guardado")
  }

  if (e.key.toLowerCase() === "l") {
    const raw = localStorage.getItem("vr_circuit_state")
    if (!raw) return console.log("⚠️ No hay estado guardado")
    appState.loadFromObject(JSON.parse(raw))
    stateSyncSystem.rebuildFromState()
    console.log("✅ Estado cargado y reconstruido")
  }
})

// ---------------------------
// Init rebuild (si ya hay estado cargado en runtime, lo agregas después)
// ---------------------------
stateSyncSystem.rebuildFromState()

// ---------------------------
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  interactionSystem.update()
  renderer.render(scene, camera)
})