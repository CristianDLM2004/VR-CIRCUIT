import * as THREE from "three"

import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"

import { InteractionSystem } from "./systems/InteractionSystem.js"
import { PhysicsSystem } from "./systems/PhysicsSystem.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { TrashSystem } from "./systems/TrashSystem.js"
import { AppState } from "./state/AppState.js"

import { createVRPanel } from "./components/VRPanel.js"
import { createProtoboard } from "./components/Protoboard.js"
import { HoleSystem } from "./systems/HoleSystem.js"

const sceneManager = new SceneManager()
const { scene, camera, renderer } = sceneManager

new VRManager(renderer)

const appState = new AppState()

const stateSyncSystem = new StateSyncSystem(scene, appState)

const interactionSystem = new InteractionSystem(
  scene,
  camera,
  renderer,
  appState,
  stateSyncSystem
)

stateSyncSystem.setInteractionSystem(interactionSystem)

const physicsSystem = new PhysicsSystem(
  scene,
  camera,
  appState,
  stateSyncSystem,
  interactionSystem
)

const trashSystem = new TrashSystem(scene, appState, stateSyncSystem)

const trash = trashSystem.createTrashBin({
  position: new THREE.Vector3(-0.55, 0.0, -0.10),
})

interactionSystem.registerSurface(trash)

const table = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.1, 1.0),
  new THREE.MeshStandardMaterial({ color: 0x555555 })
)
table.position.set(0, 0.75, -0.8)
table.receiveShadow = true
scene.add(table)

interactionSystem.registerSurface(table)

const { group: protoboard, surfaceMesh, layout } = createProtoboard({
  position: new THREE.Vector3(0, 1.05, -1.0),
})

scene.add(protoboard)

interactionSystem.registerSurface(surfaceMesh)

const holeSystem = new HoleSystem(protoboard, layout)

interactionSystem.holeSystem = holeSystem

const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)
scene.add(light)

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
dirLight.position.set(3, 6, 4)
scene.add(dirLight)

function addBattery5V() {
  const id = crypto.randomUUID()

  const t = {
    x: 0,
    y: 1.3,
    z: -0.88,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  }

  const component = {
    id,
    type: "battery5v",
    transform: t,
  }

  appState.addComponent(component)

  const mesh = stateSyncSystem.addMeshFromComponent(component)

  if (mesh) {
    interactionSystem.register(mesh)
  }
}

function addLED() {
  const id = crypto.randomUUID()

  const component = {
    id,
    type: "led",
    transform: { x: 0, y: 1.3, z: -0.88 },
  }

  appState.addComponent(component)

  const mesh = stateSyncSystem.addMeshFromComponent(component)

  if (mesh) interactionSystem.register(mesh)
}

function addResistor() {
  const id = crypto.randomUUID()

  const component = {
    id,
    type: "resistor",
    transform: { x: 0, y: 1.3, z: -0.88 },
  }

  appState.addComponent(component)

  const mesh = stateSyncSystem.addMeshFromComponent(component)

  if (mesh) interactionSystem.register(mesh)
}

function saveState() {
  localStorage.setItem("vr-circuit-state", appState.toJSON())
  console.log("Estado guardado")
}

function loadState() {
  const data = localStorage.getItem("vr-circuit-state")
  if (!data) return

  appState.loadFromObject(JSON.parse(data))
  stateSyncSystem.rebuildFromState()
  console.log("Estado cargado")
}

/* =========================
   MODO WIRE
========================= */

let wireMode = false

function toggleWireMode() {
  wireMode = !wireMode

  interactionSystem.toolMode = wireMode ? "wire" : "grab"

  console.log("Modo cable:", wireMode ? "ACTIVO" : "DESACTIVADO")
}

/* =========================
   VR PANEL
========================= */

const { group: panel } = createVRPanel({
  position: new THREE.Vector3(0.55, 1.15, -0.50),

  onAdd: addBattery5V,
  onLed: addLED,
  onResistor: addResistor,
  onWire: toggleWireMode,
  onSave: saveState,
  onLoad: loadState,
})

scene.add(panel)

/* =========================
   BOTÓN HTML
========================= */

document.getElementById("btn-add-cube")?.addEventListener("click", addBattery5V)

/* =========================
   HOTKEYS
========================= */

window.addEventListener("keydown", (e) => {
  if (e.key === "c") addBattery5V()
})

/* =========================
   LOOP
========================= */

const clock = new THREE.Clock()

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta()

  interactionSystem.update()

  physicsSystem.update(stateSyncSystem.meshById.values(), dt)

  trashSystem.update(stateSyncSystem.meshById.values())

  sceneManager.render()
})