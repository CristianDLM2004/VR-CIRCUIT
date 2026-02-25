import * as THREE from "three"
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js"

export class InteractionSystem {

  constructor(sceneManager, appState) {

    this.sceneManager = sceneManager
    this.appState = appState

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

      // Solo interactuables (por si el raycaster toca otras cosas)
      if (!object.userData?.interactable) return

      this.selected = object
      controller.attach(object)
    }
  }

  onSelectEnd(event) {

    const controller = event.target

    if (this.selected) {

      // Regresar el objeto a la escena
      this.scene.attach(this.selected)

      // Sincronizar transform hacia AppState
      const id = this.selected.userData?.componentId
      if (id) {
        const p = this.selected.position
        const q = this.selected.quaternion

        this.appState.updateComponent(id, {
          transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }
        })
      }

      this.selected = null
    }
  }

  update() {

    this.intersected = []

    for (let controller of this.controllers) {

      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      // MVP: intersecta todo; luego lo filtramos en Fase 1 (interactuables list)
      const intersects = this.raycaster.intersectObjects(this.scene.children, true)

      if (intersects.length > 0) {
        // Tomamos el primer objeto, pero subimos al padre si el mesh está anidado
        let obj = intersects[0].object
        while (obj && obj.parent && !obj.userData?.interactable) obj = obj.parent

        if (obj?.userData?.interactable) {
          this.intersected.push(obj)
        }
      }
    }
  }
}