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

    this.downRaycaster = new THREE.Raycaster()

    this.controllers = []
    this.interactables = [] // SOLO agarrables
    this.surfaces = [] // piso/mesa

    this.hovered = null
    this.selected = null

    this.initControllers()
  }

  // ---------- UTIL ----------
  isValidInteractable(mesh) {
    return !!mesh && mesh.userData?.interactable === true && mesh.userData?.isSurface !== true
  }

  cleanupInteractables() {
    // ✅ Elimina cualquier cosa que se haya colado (piso/mesa/etc.)
    this.interactables = this.interactables.filter((m) => this.isValidInteractable(m))
  }

  // ---------- REGISTRO ----------
  register(mesh) {
    if (!mesh) return

    // Nunca registrar surfaces como interactuables
    if (mesh.userData?.isSurface) return

    mesh.userData.interactable = true

    // Evitar duplicados
    if (!this.interactables.includes(mesh)) {
      this.interactables.push(mesh)
    }
  }

  unregister(mesh) {
    this.interactables = this.interactables.filter((m) => m !== mesh)
  }

  registerSurface(mesh) {
    if (!mesh) return

    mesh.userData.isSurface = true

    // 🔒 Blindaje: si por error estaba como interactuable, eliminar flag
    if (mesh.userData.interactable) {
      delete mesh.userData.interactable
    }

    // 🔒 Blindaje real: si ya estaba en el array de interactuables, SACARLO
    this.unregister(mesh)

    // Evitar duplicados
    if (!this.surfaces.includes(mesh)) {
      this.surfaces.push(mesh)
    }

    // Limpieza final
    this.cleanupInteractables()
  }

  unregisterSurface(mesh) {
    this.surfaces = this.surfaces.filter((m) => m !== mesh)
  }

  // ---------- CONTROLADORES ----------
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

  // ---------- HOVER ----------
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

  // ---------- SNAP ----------
  snapToSurface(object) {
    if (!object || this.surfaces.length === 0) return

    const origin = object.position.clone()
    origin.y += 2

    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))

    const hits = this.downRaycaster.intersectObjects(this.surfaces, true)
    if (hits.length === 0) return

    const hit = hits[0]

    const bbox = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    object.position.y = hit.point.y + size.y / 2
  }

  // ---------- SELECT ----------
  onSelectStart(event) {
    const controller = event.target

    // Limpieza defensiva
    this.cleanupInteractables()

    // Si no hay hovered válido, nada
    if (!this.isValidInteractable(this.hovered)) return

    this.selected = this.hovered
    controller.attach(this.selected)
  }

  onSelectEnd() {
    if (!this.selected) return

    this.scene.attach(this.selected)
    this.snapToSurface(this.selected)

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

  // ---------- UPDATE ----------
  update() {
    if (this.selected) return

    // ✅ Limpieza constante (evita que vuelvan a colarse surfaces)
    this.cleanupInteractables()

    let best = null

    for (let controller of this.controllers) {
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)

      if (hits.length > 0) {
        let obj = hits[0].object
        while (obj && obj.parent && !this.isValidInteractable(obj)) obj = obj.parent

        if (this.isValidInteractable(obj)) {
          best = obj
          break
        }
      }
    }

    this.setHover(best)
  }
}