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
    this.interactables = [] //  SOLO objetos interactuables
    this.hovered = null
    this.selected = null

    this.initControllers()
  }

  register(mesh) {
    if (!mesh) return
    mesh.userData.interactable = true
    this.interactables.push(mesh)
  }

  unregister(mesh) {
    this.interactables = this.interactables.filter((m) => m !== mesh)
  }

  initControllers() {
    const controllerModelFactory = new XRControllerModelFactory()

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i)
      controller.addEventListener("selectstart", (e) => this.onSelectStart(e))
      controller.addEventListener("selectend", () => this.onSelectEnd())
      this.scene.add(controller)

      const controllerGrip = this.renderer.xr.getControllerGrip(i)
      controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
      this.scene.add(controllerGrip)

      this.controllers.push(controller)
    }
  }

  onSelectStart(event) {
    const controller = event.target
    if (this.hovered) {
      this.selected = this.hovered
      controller.attach(this.selected)
    }
  }

  onSelectEnd() {
    if (!this.selected) return

    // Regresar a la escena
    this.scene.attach(this.selected)

    // Snap básico a mesa (altura fija por ahora)
    const TABLE_Y = 1.05
    this.selected.position.y = TABLE_Y

    // Guardar transform en AppState
    const id = this.selected.userData?.componentId
    if (id) {
      const p = this.selected.position
      const q = this.selected.quaternion
      this.appState.updateComponent(id, {
        transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w },
      })
    }

    this.selected = null
  }

  setHover(newHovered) {
    if (this.hovered === newHovered) return

    // quitar highlight anterior
    if (this.hovered?.material?.emissive) {
      this.hovered.material.emissive.setHex(0x000000)
    }

    this.hovered = newHovered

    // poner highlight
    if (this.hovered?.material?.emissive) {
      this.hovered.material.emissive.setHex(0x222222)
    }
  }

  update() {
    if (this.selected) return // mientras agarras, no cambies hover

    let best = null

    for (let controller of this.controllers) {
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)
      if (hits.length > 0) {
        let obj = hits[0].object
        while (obj && obj.parent && !obj.userData?.interactable) obj = obj.parent
        if (obj?.userData?.interactable) {
          best = obj
          break
        }
      }
    }

    this.setHover(best)
  }
}