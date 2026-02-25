import * as THREE from "three"
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js"

export class InteractionSystem {
  constructor(sceneManager, appState) {
    this.sceneManager = sceneManager
    this.appState = appState

    this.scene = sceneManager.scene
    this.renderer = sceneManager.renderer

    // Raycaster para apuntar desde controladores
    this.raycaster = new THREE.Raycaster()
    this.tempMatrix = new THREE.Matrix4()

    // Raycaster para snap hacia abajo
    this.downRaycaster = new THREE.Raycaster()

    this.controllers = []
    this.interactables = [] // ✅ SOLO objetos interactuables
    this.surfaces = [] // ✅ superficies para snap (mesa/piso)

    this.hovered = null
    this.selected = null

    this.initControllers()
  }

  // ---------- REGISTRO ----------
  register(mesh) {
    if (!mesh) return
    mesh.userData.interactable = true
    this.interactables.push(mesh)
  }

  unregister(mesh) {
    this.interactables = this.interactables.filter((m) => m !== mesh)
  }

  registerSurface(mesh) {
    if (!mesh) return
    mesh.userData.isSurface = true
    this.surfaces.push(mesh)
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

    // Quitar highlight anterior
    if (this.hovered?.material?.emissive) {
      this.hovered.material.emissive.setHex(0x000000)
    }

    this.hovered = newHovered

    // Poner highlight
    if (this.hovered?.material?.emissive) {
      this.hovered.material.emissive.setHex(0x222222)
    }
  }

  // ---------- SNAP REAL ----------
  snapToSurface(object) {
    if (!object || this.surfaces.length === 0) return

    // origin un poco arriba para asegurar intersección
    const origin = object.position.clone()
    origin.y += 2

    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))

    const hits = this.downRaycaster.intersectObjects(this.surfaces, true)
    if (hits.length === 0) return

    const hit = hits[0]

    // Ajuste para apoyar el objeto: mitad de su altura (bounding box)
    const bbox = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    object.position.y = hit.point.y + size.y / 2
  }

  // ---------- SELECT ----------
  onSelectStart(event) {
    const controller = event.target

    if (this.hovered) {
      this.selected = this.hovered
      controller.attach(this.selected)
    }
  }

  onSelectEnd() {
    if (!this.selected) return

    // Regresar a la escena (world space)
    this.scene.attach(this.selected)

    // Snap real a mesa/piso
    this.snapToSurface(this.selected)

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

  // ---------- ROTACIÓN ----------
  rotateSelectedFromGamepad() {
    if (!this.selected) return

    // Rotación simple: usa eje X del joystick (puede variar por mapeo)
    const ROT_SPEED = 0.05

    for (const controller of this.controllers) {
      const gp = controller.gamepad
      if (!gp || !gp.axes) continue

      // Quest puede mapear en axes[2] o axes[0] dependiendo
      const x = gp.axes[2] ?? gp.axes[0] ?? 0

      if (Math.abs(x) > 0.2) {
        this.selected.rotation.y -= x * ROT_SPEED
      }
    }
  }

  // ---------- UPDATE ----------
  update() {
    // Si está agarrando, permitir rotación y no calcular hover
    if (this.selected) {
      this.rotateSelectedFromGamepad()
      return
    }

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