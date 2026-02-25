import * as THREE from "three"
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js"

export class InteractionSystem {
  constructor(sceneManager, appState) {
    this.sceneManager = sceneManager
    this.appState = appState

    this.scene = sceneManager.scene
    this.renderer = sceneManager.renderer

    // Raycaster para agarrar (Layer 1)
    this.raycaster = new THREE.Raycaster()
    this.raycaster.layers.set(1)

    this.tempMatrix = new THREE.Matrix4()

    // Raycaster para snap (Layer 2)
    this.downRaycaster = new THREE.Raycaster()
    this.downRaycaster.layers.set(2)

    this.controllers = []
    this.interactables = [] // meshes layer 1
    this.surfaces = [] // meshes layer 2

    this.hovered = null
    this.selected = null

    this.initControllers()
  }

  // Solo componentes
  register(mesh) {
    if (!mesh) return
    mesh.userData.interactable = true
    mesh.layers.set(1)

    if (!this.interactables.includes(mesh)) {
      this.interactables.push(mesh)
    }
  }

  unregister(mesh) {
    this.interactables = this.interactables.filter((m) => m !== mesh)
  }

  // Solo superficies
  registerSurface(mesh) {
    if (!mesh) return
    mesh.userData.isSurface = true
    mesh.userData.interactable = false
    mesh.layers.set(2)

    if (!this.surfaces.includes(mesh)) {
      this.surfaces.push(mesh)
    }
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

  setHover(newHovered) {
    if (this.hovered === newHovered) return

    if (this.hovered?.material?.emissive) {
      this.hovered.material.emissive.setHex(0x000000)
    }

    this.hovered = newHovered

    if (this.hovered?.material?.emissive) {
      this.hovered.material.emissive.setHex(0x222222)
    }
  }

  snapToSurface(object) {
    if (!object || this.surfaces.length === 0) return

    const origin = object.position.clone()
    origin.y += 2

    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))

    // ✅ Solo intersecta Layer 2 por configuración del raycaster
    const hits = this.downRaycaster.intersectObjects(this.surfaces, true)
    if (hits.length === 0) return

    const hit = hits[0]

    const bbox = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    object.position.y = hit.point.y + size.y / 2
  }

  onSelectStart(event) {
    const controller = event.target
    if (!this.hovered) return

    // ✅ Extra: nunca permitir agarrar algo sin componentId
    if (!this.hovered.userData?.componentId) return

    this.selected = this.hovered
    controller.attach(this.selected)
  }

  onSelectEnd() {
    if (!this.selected) return

    this.scene.attach(this.selected)
    this.snapToSurface(this.selected)

    // Guardar transform
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

  update() {
    if (this.selected) return

    let best = null

    for (const controller of this.controllers) {
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      // ✅ Intersecta SOLO Layer 1 por configuración del raycaster
      const hits = this.raycaster.intersectObjects(this.interactables, true)

      if (hits.length > 0) {
        let obj = hits[0].object
        while (obj && obj.parent && !obj.userData?.componentId) obj = obj.parent

        if (obj?.userData?.componentId) {
          best = obj
          break
        }
      }
    }

    this.setHover(best)
  }
}