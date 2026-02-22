import * as THREE from "three"
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js"

export class InteractionSystem {

    constructor(sceneManager) {

        this.sceneManager = sceneManager
        this.scene = sceneManager.scene
        this.renderer = sceneManager.renderer

        this.raycaster = new THREE.Raycaster()
        this.tempMatrix = new THREE.Matrix4()

        this.controllers = []
        this.intersected = []
        this.selected = null

        this.initControllers()
    }

    initControllers() {

        const controllerModelFactory = new XRControllerModelFactory()

        for (let i = 0; i < 2; i++) {

            const controller = this.renderer.xr.getController(i)
            controller.addEventListener("selectstart", (e) => this.onSelectStart(e))
            controller.addEventListener("selectend", (e) => this.onSelectEnd(e))
            this.scene.add(controller)

            const controllerGrip = this.renderer.xr.getControllerGrip(i)
            controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
            this.scene.add(controllerGrip)

            this.controllers.push(controller)
        }
    }

    onSelectStart(event) {

        const controller = event.target

        if (this.intersected.length > 0) {

            const object = this.intersected[0]
            this.selected = object
            controller.attach(object)
        }
    }

    onSelectEnd(event) {

        const controller = event.target

        if (this.selected) {
            this.scene.attach(this.selected)
            this.selected = null
        }
    }

    update() {

        this.intersected = []

        for (let controller of this.controllers) {

            this.tempMatrix.identity().extractRotation(controller.matrixWorld)

            this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
            this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

            const intersects = this.raycaster.intersectObjects(this.scene.children, false)

            if (intersects.length > 0) {
                this.intersected.push(intersects[0].object)
            }
        }
    }
}