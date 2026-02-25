import * as THREE from "three"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"

import { createProtoboard } from "./components/Protoboard.js"
import { HoleSystem } from "./systems/HoleSystem.js"

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

const table = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 0.1, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x444444 })
)
table.position.set(0, 1.0, -1.0)
scene.add(table)

// ✅ Importante: asegurar matrices antes de calcular bounds
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
// ✅ Protoboard placeholder + HoleSystem
// ---------------------------
const tableTopY = table.position.y + 0.05 // mesa (0.1 alto) => top aprox
const { group: protoboard, surfaceMesh: protoSurface, layout } = createProtoboard({
  position: new THREE.Vector3(table.position.x, tableTopY + 0.03, table.position.z),
})

scene.add(protoboard)

// Registrar como surface (idealmente prioritaria dentro de InteractionSystem)
interactionSystem.registerSurface(protoSurface, { type: "protoboard" })

// HoleSystem (snapeo a holes)
const holeSystem = new HoleSystem(protoboard, layout)
interactionSystem.setHoleSystem(holeSystem)

// ---------------------------
// UI overlay (Add Cube)
// ---------------------------
function genId(prefix = "cmp") {
  // Preferir UUID para evitar colisiones (Quest Browser soporta crypto normalmente)
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function addCube() {
  const id = genId("cube")

  // spawn cerca del protoboard (centro)
  const p = protoboard.position.clone()
  p.y += 0.15

  appState.addComponent({
    id,
    type: "cube",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
  })

  stateSyncSystem.rebuildFromState()
}

document.getElementById("btn-add-cube")?.addEventListener("click", addCube)

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase()

  if (k === "c") addCube()

  if (k === "s") {
    localStorage.setItem("vr_circuit_state", appState.toJSON())
    console.log("✅ Estado guardado")
  }

  if (k === "l") {
    const raw = localStorage.getItem("vr_circuit_state")
    if (!raw) return console.log("⚠️ No hay estado guardado")
    appState.loadFromObject(JSON.parse(raw))
    stateSyncSystem.rebuildFromState()
    console.log("✅ Estado cargado y reconstruido")
  }
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
  renderer.render(scene, camera)
})