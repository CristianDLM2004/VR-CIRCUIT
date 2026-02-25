// src/main.js
import * as THREE from "three"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"

const sceneManager = new SceneManager()
const { scene, camera, renderer } = sceneManager

// Si tu VRManager solo configura XR + botón + session, déjalo.
const vrManager = new VRManager(renderer, scene, camera)

const appState = new AppState()

// ✅ CORRECTO: InteractionSystem espera (sceneManager, appState)
const interactionSystem = new InteractionSystem(sceneManager, appState)

const stateSyncSystem = new StateSyncSystem(scene, appState, interactionSystem)

// ---------------------------
// Escena base: luz, piso, mesa
// ---------------------------
const ambient = new THREE.AmbientLight(0xffffff, 0.6)
scene.add(ambient)

const dir = new THREE.DirectionalLight(0xffffff, 1.0)
dir.position.set(2, 4, 2)
scene.add(dir)

// Piso
const floorGeo = new THREE.PlaneGeometry(50, 50)
const floorMat = new THREE.MeshStandardMaterial({ color: 0x222222 })
const floor = new THREE.Mesh(floorGeo, floorMat)
floor.rotation.x = -Math.PI / 2
floor.position.y = 0
floor.receiveShadow = true
scene.add(floor)

// Mesa (placeholder)
const tableGeo = new THREE.BoxGeometry(2.0, 0.1, 1.2)
const tableMat = new THREE.MeshStandardMaterial({ color: 0x444444 })
const table = new THREE.Mesh(tableGeo, tableMat)
table.position.set(0, 1.0, -1.0)
table.receiveShadow = true
scene.add(table)

// ✅ Registrar surfaces (esto pone Layer 2 internamente)
interactionSystem.registerSurface(floor, { type: "floor" })

const box = new THREE.Box3().setFromObject(table)
const margin = 0.12

const tableBounds = {
  minX: box.min.x + margin,
  maxX: box.max.x - margin,
  minZ: box.min.z + margin,
  maxZ: box.max.z - margin,
}

interactionSystem.registerSurface(table, { type: "table", bounds: tableBounds })

// ---------------------------
// Cargar estado previo y reconstruir
// ---------------------------
stateSyncSystem.rebuildFromState()

// Teclas PC
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "s") {
    localStorage.setItem("vr_circuit_state", appState.toJSON())
    console.log("✅ Estado guardado en localStorage")
  }
  if (e.key.toLowerCase() === "l") {
    const raw = localStorage.getItem("vr_circuit_state")
    if (raw) {
      appState.loadFromObject(JSON.parse(raw))
      stateSyncSystem.rebuildFromState()
      console.log("✅ Estado cargado y reconstruido")
    } else {
      console.log("⚠️ No hay estado guardado")
    }
  }
})

// ---------------------------
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  interactionSystem.update()
  renderer.render(scene, camera)
})