import * as THREE from "three"
import { SceneManager } from "./core/SceneManager"
import { VRManager } from "./core/VRManager"
import { InteractionSystem } from "./systems/InteractionSystem"
import { AppState } from "./core/AppState"
import { ComponentFactory } from "./components/ComponentFactory"

let sceneManager
let vrManager
let interactionSystem
let appState

init()

function init() {

    sceneManager = new SceneManager()
    vrManager = new VRManager(sceneManager.renderer)
    interactionSystem = new InteractionSystem(sceneManager)

    appState = new AppState()

    addBasicEnvironment()
    spawnInitialComponent()

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

function spawnInitialComponent() {

    const componentData = {
        id: crypto.randomUUID(),
        type: "cube",
        transform: { x: 0, y: 1.2, z: -1 }
    }

    appState.addComponent(componentData)

    const mesh = ComponentFactory.createComponent(componentData)
    sceneManager.scene.add(mesh)
}