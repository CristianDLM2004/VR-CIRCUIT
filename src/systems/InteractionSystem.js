import * as THREE from "three"
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js"
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js"

export class InteractionSystem {
  constructor(sceneManager, appState) {
    this.sceneManager = sceneManager
    this.appState = appState

    this.scene = sceneManager.scene
    this.renderer = sceneManager.renderer
    this.camera = sceneManager.camera

    // ✅ Raycasters SIN layers (evita render desincronizado por ojo)
    this.raycaster = new THREE.Raycaster()
    this.downRaycaster = new THREE.Raycaster()
    this.tempMatrix = new THREE.Matrix4()

    this.controllers = []
    this.interactables = []
    this.surfaces = []
    this.holeSystem = null

    this.hovered = null
    this.selected = null

    // Visual aids (rays)
    this.controllerRays = [] // { controller, line, hitDot }

    // -------------------------
    // PC Mouse controls
    // -------------------------
    this.mouseEnabled = true
    this.mouseNDC = new THREE.Vector2()
    this.mouseRaycaster = new THREE.Raycaster()

    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this.dragHit = new THREE.Vector3()
    this.dragOffset = new THREE.Vector3()

    this._onMouseMove = (e) => this.onMouseMove(e)
    this._onMouseDown = (e) => this.onMouseDown(e)
    this._onMouseUp = () => this.onMouseUp()

    window.addEventListener("pointermove", this._onMouseMove)
    window.addEventListener("pointerdown", this._onMouseDown)
    window.addEventListener("pointerup", this._onMouseUp)

    this.initControllers()
  }

  dispose() {
    window.removeEventListener("pointermove", this._onMouseMove)
    window.removeEventListener("pointerdown", this._onMouseDown)
    window.removeEventListener("pointerup", this._onMouseUp)
  }

  setHoleSystem(holeSystem) {
    this.holeSystem = holeSystem
  }

  // -------------------------
  // Interactuables
  // -------------------------
  register(mesh) {
    if (!mesh) return
    if (mesh.userData?.isSurface) return

    mesh.userData.interactable = true

    if (!this.interactables.includes(mesh)) this.interactables.push(mesh)
  }

  unregister(mesh) {
    this.interactables = this.interactables.filter((m) => m !== mesh)
  }

  // -------------------------
  // Surfaces
  // -------------------------
  registerSurface(mesh, options = {}) {
    if (!mesh) return

    const type = options.type || "floor"
    const bounds = options.bounds || null

    mesh.userData.isSurface = true
    mesh.userData.interactable = false
    if ("componentId" in mesh.userData) delete mesh.userData.componentId

    this.unregister(mesh)

    const existing = this.surfaces.find((s) => s.mesh === mesh)
    if (existing) {
      existing.type = type
      existing.bounds = bounds
      return
    }

    this.surfaces.push({ mesh, type, bounds })
  }

  // -------------------------
  // XR Controllers + Hands + Rays
  // -------------------------
  initControllers() {
    const controllerModelFactory = new XRControllerModelFactory()
    const handModelFactory = new XRHandModelFactory()

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i)
      controller.addEventListener("selectstart", (e) => this.onSelectStart(e))
      controller.addEventListener("selectend", () => this.onSelectEnd())
      this.scene.add(controller)

      const controllerGrip = this.renderer.xr.getControllerGrip(i)
      controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
      this.scene.add(controllerGrip)

      const hand = this.renderer.xr.getHand(i)
      hand.add(handModelFactory.createHandModel(hand, "mesh"))
      this.scene.add(hand)

      const { line, hitDot } = this.createControllerRay()
      controller.add(line)
      controller.add(hitDot)
      this.controllerRays.push({ controller, line, hitDot })

      this.controllers.push(controller)
    }
  }

  createControllerRay() {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff })
    const line = new THREE.Line(geo, mat)
    line.name = "ControllerRay"
    line.scale.z = 5

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    )
    dot.name = "ControllerRayDot"
    dot.position.z = -5

    return { line, hitDot: dot }
  }

  // -------------------------
  // Hover highlight
  // -------------------------
  setHover(newHovered) {
    if (this.hovered === newHovered) return

    if (this.hovered) {
      this.hovered.traverse?.((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x000000)
      })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x000000)
    }

    this.hovered = newHovered

    if (this.hovered) {
      this.hovered.traverse?.((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x222222)
      })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x222222)
    }
  }

  // -------------------------
  // Mouse helpers
  // -------------------------
  updateMouseNDC(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    this.mouseNDC.set(x, y)
  }

  pickWithMouse() {
    this.mouseRaycaster.setFromCamera(this.mouseNDC, this.camera)
    const hits = this.mouseRaycaster.intersectObjects(this.interactables, true)
    if (hits.length === 0) return null

    for (const h of hits) {
      let obj = h.object
      while (obj && obj.parent && !obj.userData?.componentId) obj = obj.parent
      if (obj?.userData?.componentId && this.interactables.includes(obj) && !obj.userData?.isSurface) {
        return obj
      }
    }
    return null
  }

  onMouseMove(event) {
    if (this.renderer.xr.isPresenting) return
    if (!this.mouseEnabled) return

    this.updateMouseNDC(event)

    if (this.selected) {
      this.mouseRaycaster.setFromCamera(this.mouseNDC, this.camera)
      if (this.mouseRaycaster.ray.intersectPlane(this.dragPlane, this.dragHit)) {
        this.selected.position.copy(this.dragHit).add(this.dragOffset)
      }
      return
    }

    const hovered = this.pickWithMouse()
    this.setHover(hovered)
  }

  onMouseDown(event) {
    if (this.renderer.xr.isPresenting) return
    if (!this.mouseEnabled) return
    if (event.button !== 0) return

    this.updateMouseNDC(event)
    const obj = this.pickWithMouse()
    if (!obj) return

    this.selected = obj
    this.dragPlane.set(new THREE.Vector3(0, 1, 0), -this.selected.position.y)

    this.mouseRaycaster.setFromCamera(this.mouseNDC, this.camera)
    if (this.mouseRaycaster.ray.intersectPlane(this.dragPlane, this.dragHit)) {
      this.dragOffset.copy(this.selected.position).sub(this.dragHit)
    } else {
      this.dragOffset.set(0, 0, 0)
    }
  }

  onMouseUp() {
    if (this.renderer.xr.isPresenting) return
    if (!this.mouseEnabled) return
    if (!this.selected) return

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

  // -------------------------
  // Snap logic (surfaces + holes)
  // -------------------------
  snapToSurface(object) {
    if (!object || this.surfaces.length === 0) return

    const origin = object.position.clone()
    origin.y += 2
    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))

    const surfaceMeshes = this.surfaces.map((s) => s.mesh)
    const hits = this.downRaycaster.intersectObjects(surfaceMeshes, true)
    if (hits.length === 0) return

    const best = this.pickBestSurfaceHit(hits)
    if (!best) return

    const bbox = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    object.position.y = best.point.y + size.y / 2

    const surf = best.surface
    if (surf?.type === "table" && surf.bounds) {
      const halfX = size.x / 2
      const halfZ = size.z / 2
      const minX = surf.bounds.minX + halfX
      const maxX = surf.bounds.maxX - halfX
      const minZ = surf.bounds.minZ + halfZ
      const maxZ = surf.bounds.maxZ - halfZ

      object.position.x = THREE.MathUtils.clamp(object.position.x, minX, maxX)
      object.position.z = THREE.MathUtils.clamp(object.position.z, minZ, maxZ)
    }

    if (this.holeSystem) {
      this.holeSystem.trySnapObject(object, 0.03)
    }
  }

  pickBestSurfaceHit(hits) {
    const getSurfaceEntry = (hitObj) => {
      for (const s of this.surfaces) {
        if (hitObj === s.mesh) return s
        let cur = hitObj
        while (cur) {
          if (cur === s.mesh) return s
          cur = cur.parent
        }
      }
      return null
    }

    for (const h of hits) {
      const surf = getSurfaceEntry(h.object)
      if (surf?.type === "protoboard") return { ...h, surface: surf }
    }

    for (const h of hits) {
      const surf = getSurfaceEntry(h.object)
      if (!surf || surf.type !== "table" || !surf.bounds) continue
      const { minX, maxX, minZ, maxZ } = surf.bounds
      const x = h.point.x
      const z = h.point.z
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return { ...h, surface: surf }
    }

    for (const h of hits) {
      const surf = getSurfaceEntry(h.object)
      if (surf?.type === "floor") return { ...h, surface: surf }
    }

    for (const h of hits) {
      const surf = getSurfaceEntry(h.object)
      if (surf) return { ...h, surface: surf }
    }

    return null
  }

  // -------------------------
  // XR select handlers
  // -------------------------
  onSelectStart(event) {
    const controller = event.target
    if (!this.hovered) return
    if (this.hovered.userData?.isSurface) return
    if (!this.hovered.userData?.componentId) return
    if (!this.interactables.includes(this.hovered)) return

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

  update() {
    if (!this.renderer.xr.isPresenting) return

    this.updateControllerRays()
    if (this.selected) return

    let best = null

    for (const controller of this.controllers) {
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)
      if (hits.length === 0) continue

      for (const h of hits) {
        let obj = h.object
        while (obj && obj.parent && !obj.userData?.componentId) obj = obj.parent
        if (obj?.userData?.componentId && this.interactables.includes(obj) && !obj.userData?.isSurface) {
          best = obj
          break
        }
      }

      if (best) break
    }

    this.setHover(best)
  }

  updateControllerRays() {
    for (const r of this.controllerRays) {
      const controller = r.controller
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)

      let dist = 5
      if (hits.length > 0) dist = Math.min(5, Math.max(0.05, hits[0].distance))

      r.line.scale.z = dist
      r.hitDot.position.z = -dist
      r.hitDot.visible = true
    }
  }
}