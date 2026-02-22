import * as THREE from "three"
import { SceneManager } from "./core/SceneManager"
import { VRManager } from "./core/VRManager"
import { InteractionSystem } from "./systems/InteractionSystem"

let sceneManager
let vrManager
let interactionSystem

init()

function init() {

    sceneManager = new SceneManager()
    vrManager = new VRManager(sceneManager.renderer)

    interactionSystem = new InteractionSystem(sceneManager)

    addBasicEnvironment()
    addTestCube()

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

function addTestCube() {

    const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xff0000 })
    )

    cube.position.set(0, 1.2, -1)
    sceneManager.scene.add(cube)
}