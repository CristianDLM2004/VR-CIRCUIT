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

    this.raycaster = new THREE.Raycaster()
    this.downRaycaster = new THREE.Raycaster()
    this.tempMatrix = new THREE.Matrix4()

    this.controllers = []
    this.hands = [] // { hand, pinchPoint, isPinching }
    this.interactables = []
    this.surfaces = []
    this.holeSystem = null

    this.hovered = null
    this.selected = null
    this.selectedBy = null // "controller" | "hand" | "mouse"

    // Rays only for controllers
    this.controllerRays = [] // { controller, line, hitDot }

    // Near interaction
    this.nearEnabled = true
    this.nearRadius = 0.08 // 8 cm (más cómodo en Quest)
    this.pinchStartDist = 0.028
    this.pinchEndDist = 0.040

    this._tmpA = new THREE.Vector3()
    this._tmpB = new THREE.Vector3()
    this._tmpCenter = new THREE.Vector3()
    this._box = new THREE.Box3()

    // PC mouse
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

    this.initXRInputs()
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
  // XR Inputs
  // -------------------------
  initXRInputs() {
    const controllerModelFactory = new XRControllerModelFactory()
    const handModelFactory = new XRHandModelFactory()

    for (let i = 0; i < 2; i++) {
      // Controllers
      const controller = this.renderer.xr.getController(i)
      controller.addEventListener("selectstart", (e) => this.onControllerSelectStart(e))
      controller.addEventListener("selectend", () => this.onControllerSelectEnd())
      this.scene.add(controller)

      const controllerGrip = this.renderer.xr.getControllerGrip(i)
      controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
      this.scene.add(controllerGrip)

      const { line, hitDot } = this.createControllerRay()
      controller.add(line)
      controller.add(hitDot)
      this.controllerRays.push({ controller, line, hitDot })

      this.controllers.push(controller)

      // Hands
      const hand = this.renderer.xr.getHand(i)
      hand.add(handModelFactory.createHandModel(hand, "mesh"))
      this.scene.add(hand)

      const pinchPoint = new THREE.Object3D()
      pinchPoint.name = `PinchPoint_${i}`
      hand.add(pinchPoint)

      this.hands.push({ hand, pinchPoint, isPinching: false })
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

  // ✅ DETECCIÓN REAL: hand tracking activo usando XRSession
  isHandTrackingActive() {
    const session = this.renderer.xr.getSession?.()
    if (!session) return false
    return Array.from(session.inputSources || []).some((src) => !!src.hand)
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

  pickInteractableFromHitObject(hitObject) {
    let obj = hitObject
    while (obj && obj.parent) {
      if (obj.userData?.isUI) return obj
      if (obj.userData?.componentId) return obj
      obj = obj.parent
    }
    if (hitObject?.userData?.isUI) return hitObject
    if (hitObject?.userData?.componentId) return hitObject
    return null
  }

  getObjectWorldCenter(obj, out) {
    this._box.setFromObject(obj)
    this._box.getCenter(out)
    return out
  }

  // -------------------------
  // Controller hover + rays
  // -------------------------
  computeControllerHover() {
    let best = null

    for (const controller of this.controllers) {
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)
      if (hits.length === 0) continue

      for (const h of hits) {
        const picked = this.pickInteractableFromHitObject(h.object)
        if (picked && this.interactables.includes(picked) && !picked.userData?.isSurface) {
          best = picked
          break
        }
      }
      if (best) break
    }

    return best
  }

  updateControllerRays(visible) {
    for (const r of this.controllerRays) {
      r.line.visible = visible
      r.hitDot.visible = visible
      if (!visible) continue

      const controller = r.controller
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)

      let dist = 5
      if (hits.length > 0) dist = Math.min(5, Math.max(0.05, hits[0].distance))

      r.line.scale.z = dist
      r.hitDot.position.z = -dist
    }
  }

  // -------------------------
  // Hands near hover + pinch detection
  // -------------------------
  getHandIndexTipWorld(handEntry, out) {
    const joint = handEntry.hand.joints?.["index-finger-tip"]
    if (joint) return joint.getWorldPosition(out)
    return handEntry.pinchPoint.getWorldPosition(out)
  }

  updateHandPinchState() {
    for (const h of this.hands) {
      const index = h.hand.joints?.["index-finger-tip"]
      const thumb = h.hand.joints?.["thumb-tip"]

      // Si no hay joints, no pinch
      if (!index || !thumb) {
        if (h.isPinching) {
          h.isPinching = false
          this.onHandPinchEnd()
        }
        continue
      }

      index.getWorldPosition(this._tmpA)
      thumb.getWorldPosition(this._tmpB)
      const dist = this._tmpA.distanceTo(this._tmpB)

      if (!h.isPinching && dist <= this.pinchStartDist) {
        h.isPinching = true
        this.onHandPinchStart(h)
      } else if (h.isPinching && dist >= this.pinchEndDist) {
        h.isPinching = false
        this.onHandPinchEnd()
      }
    }
  }

  computeHandHover() {
    if (!this.nearEnabled) return null
    if (this.selected && this.selectedBy === "controller") return null

    let best = null
    let bestD2 = this.nearRadius * this.nearRadius

    for (const h of this.hands) {
      this.getHandIndexTipWorld(h, this._tmpA)

      for (const obj of this.interactables) {
        if (!obj || obj.userData?.isSurface) continue

        this.getObjectWorldCenter(obj, this._tmpCenter)
        const d2 = this._tmpCenter.distanceToSquared(this._tmpA)
        if (d2 < bestD2) {
          bestD2 = d2
          best = obj
        }
      }
    }

    return best
  }

  // -------------------------
  // Controller select (ray)
  // -------------------------
  onControllerSelectStart(event) {
    const controller = event.target
    if (!this.hovered) return
    if (this.hovered.userData?.isSurface) return

    // UI press
    if (this.hovered.userData?.isUI && typeof this.hovered.userData?.onPress === "function") {
      this.hovered.userData.onPress()
      return
    }

    // Grab components only
    if (!this.hovered.userData?.componentId) return

    this.selected = this.hovered
    this.selectedBy = "controller"
    controller.attach(this.selected)
  }

  onControllerSelectEnd() {
    if (!this.selected) return
    if (this.selectedBy !== "controller") return

    this.scene.attach(this.selected)
    this.snapToSurface(this.selected)
    this.persistSelectedTransform()

    this.selected = null
    this.selectedBy = null
  }

  // -------------------------
  // Hand pinch (near)
  // -------------------------
  onHandPinchStart(handEntry) {
    if (this.selected) return

    // target: hovered o nearest
    let target = this.hovered
    if (!target) {
      this.getHandIndexTipWorld(handEntry, this._tmpA)
      target = this.computeHandHover()
      if (target) this.setHover(target)
    }
    if (!target) return
    if (target.userData?.isSurface) return

    // UI press
    if (target.userData?.isUI && typeof target.userData?.onPress === "function") {
      target.userData.onPress()
      return
    }

    // Grab components only
    if (!target.userData?.componentId) return

    this.selected = target
    this.selectedBy = "hand"

    const joint = handEntry.hand.joints?.["index-finger-tip"]
    if (joint) joint.attach(this.selected)
    else handEntry.pinchPoint.attach(this.selected)
  }

  onHandPinchEnd() {
    if (!this.selected) return
    if (this.selectedBy !== "hand") return

    this.scene.attach(this.selected)
    this.snapToSurface(this.selected)
    this.persistSelectedTransform()

    this.selected = null
    this.selectedBy = null
  }

  persistSelectedTransform() {
    const id = this.selected?.userData?.componentId
    if (!id) return

    const p = this.selected.position
    const q = this.selected.quaternion
    this.appState.updateComponent(id, {
      transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w },
    })
  }

  // -------------------------
  // Mouse (PC)
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
      const picked = this.pickInteractableFromHitObject(h.object)
      if (picked && this.interactables.includes(picked) && !picked.userData?.isSurface) return picked
    }
    return null
  }

  onMouseMove(event) {
    if (this.renderer.xr.isPresenting) return
    if (!this.mouseEnabled) return
    this.updateMouseNDC(event)
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

    if (obj.userData?.isUI && typeof obj.userData?.onPress === "function") {
      obj.userData.onPress()
      return
    }
  }

  onMouseUp() {}

  // -------------------------
  // Snap logic
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

    if (this.holeSystem) this.holeSystem.trySnapObject(object, 0.03)
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
      if (surf?.type === "table") return { ...h, surface: surf }
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
  // Update loop
  // -------------------------
  update() {
    if (!this.renderer.xr.isPresenting) return

    const handsActive = this.isHandTrackingActive()

    // ✅ rayos SOLO con controladores
    this.updateControllerRays(!handsActive)

    // pinch detection solo si handsActive
    if (handsActive) this.updateHandPinchState()

    // no cambiar hover si ya agarraste algo
    if (this.selected) return

    // ✅ hover: manos si handsActive, si no controllers
    const hovered = handsActive ? this.computeHandHover() : this.computeControllerHover()
    this.setHover(hovered)
  }
}