import * as THREE from "three"
import { SceneManager } from "./core/SceneManager"
import { VRManager } from "./core/VRManager"
import { InteractionSystem } from "./systems/InteractionSystem"
import { AppState } from "./core/AppState"
import { StateSyncSystem } from "./systems/StateSyncSystem"

let sceneManager
let vrManager
let interactionSystem
let appState
let stateSync

// Superficies (para snap real)
let floor
let table

init()

function init() {
  sceneManager = new SceneManager()
  vrManager = new VRManager(sceneManager.renderer)

  appState = new AppState()

  // Interacción primero (para registrar interactuables y superficies)
  interactionSystem = new InteractionSystem(sceneManager, appState)
  stateSync = new StateSyncSystem(sceneManager.scene, appState, interactionSystem)

  addBasicEnvironment()

  // Registrar superficies para snap real (mesa y piso)
  interactionSystem.registerSurface(table)
  interactionSystem.registerSurface(floor)

  // Estado inicial: si no hay guardado, crea 1 componente dummy
  if (!localStorage.getItem("vrcircuit_state")) {
    appState.addComponent({
      id: crypto.randomUUID(),
      type: "cube",
      transform: { x: 0, y: 1.2, z: -1, qx: 0, qy: 0, qz: 0, qw: 1 },
    })
  } else {
    loadState()
  }

  // Construir escena desde AppState y registrar interactuables
  stateSync.rebuildFromState()

  // Atajos (PC) por ahora
  window.addEventListener("keydown", onKeyDown)

  sceneManager.renderer.setAnimationLoop(() => {
    interactionSystem.update()
    sceneManager.render()
  })
}

function onKeyDown(e) {
  const k = e.key.toLowerCase()

  if (k === "s") {
    saveState()
  }

  if (k === "l") {
    loadState()
    stateSync.rebuildFromState()
  }
}

function saveState() {
  localStorage.setItem("vrcircuit_state", appState.toJSON())
  console.log("✅ Estado guardado")
}

function loadState() {
  const raw = localStorage.getItem("vrcircuit_state")
  if (!raw) return
  const obj = JSON.parse(raw)
  appState.loadFromObject(obj)
  console.log("✅ Estado cargado")
}

function addBasicEnvironment() {
  const light = new THREE.HemisphereLight(0xffffff, 0x444444)
  light.position.set(0, 20, 0)
  sceneManager.scene.add(light)

  // Piso (surface)
  floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x808080 })
  )
  floor.rotation.x = -Math.PI / 2
  floor.userData.isSurface = true
  sceneManager.scene.add(floor)

  // Mesa (surface)
  table = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.1, 1),
    new THREE.MeshStandardMaterial({ color: 0x222222 })
  )
  table.position.set(0, 1, -1)
  table.userData.isSurface = true
  sceneManager.scene.add(table)
}