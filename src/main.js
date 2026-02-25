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

init()

function init() {

  sceneManager = new SceneManager()
  vrManager = new VRManager(sceneManager.renderer)

  appState = new AppState()
  stateSync = new StateSyncSystem(sceneManager.scene, appState)

  addBasicEnvironment()

  // Componente inicial (dummy)
  const componentData = {
    id: crypto.randomUUID(),
    type: "cube",
    transform: { x: 0, y: 1.2, z: -1, qx: 0, qy: 0, qz: 0, qw: 1 }
  }

  appState.addComponent(componentData)

  // Construir escena desde AppState
  stateSync.rebuildFromState()

  // Interacción usa AppState para guardar cambios al soltar
  interactionSystem = new InteractionSystem(sceneManager, appState)

  sceneManager.renderer.setAnimationLoop(() => {
    interactionSystem.update()
    sceneManager.render()
  })
}

function addBasicEnvironment() {

  const light = new THREE.HemisphereLight(0xffffff, 0x444444)
  light.position.set(0, 20, 0)
  sceneManager.scene.add(light)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x808080 })
  )
  floor.rotation.x = -Math.PI / 2
  sceneManager.scene.add(floor)
}