// src/main.js
import * as THREE from "three"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"

const sceneManager = new SceneManager()
const { scene, camera, renderer } = sceneManager

// ✅ TU VRManager solo recibe renderer
new VRManager(renderer)

const appState = new AppState()

// ✅ TU InteractionSystem recibe (sceneManager, appState)
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
floor.receiveShadow = true
scene.add(floor)

// Mesa (placeholder)
const table = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 0.1, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x444444 })
)
table.position.set(0, 1.0, -1.0)
table.receiveShadow = true
scene.add(table)

// ✅ Registrar surfaces SOLO con registerSurface (esto setea layers y flags correctamente)
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
// Reconstrucción desde estado
// ---------------------------
stateSyncSystem.rebuildFromState()

// Guardar / cargar
window.addEventListener("keydown", (e) => {
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
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  interactionSystem.update()
  renderer.render(scene, camera)
})