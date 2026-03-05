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
    this.selectedBy = null // "controller" | "hand"

    // Rays only for controllers
    this.controllerRays = [] // { controller, line, hitDot }

    // Near interaction tuning
    this.nearEnabled = true
    this.nearRadius = 0.12 // 12 cm

    // Pinch thresholds
    this.pinchStartDist = 0.065
    this.pinchEndDist = 0.085

    // UI poke radius
    this.uiPokeRadius = 0.020
    this.uiReleaseRadius = 0.040

    this._tmpA = new THREE.Vector3()
    this._tmpB = new THREE.Vector3()
    this._tmpC = new THREE.Vector3()
    this._box = new THREE.Box3()

    this._lastPokedButton = null

    // -------------------------
    // ✅ Tracking de velocidad para físicas al soltar
    // -------------------------
    this.throwStartSpeed = 0.60 // m/s (si supera, entra física)
    this.throwMinYSpeed = 0.25  // m/s (si hay velocidad vertical significativa)
    this._hold = {
      active: false,
      lastPos: new THREE.Vector3(),
      lastT: 0,
      vel: new THREE.Vector3(),
      source: null, // Object3D (controller) o handEntry
      sourceType: null, // "controller" | "hand"
    }

    this.initXRInputs()
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

  // ✅ hand tracking activo usando XRSession
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

  // -------------------------
  // Distance helpers
  // -------------------------
  distanceToObjectSurface(obj, worldPoint) {
    this._box.setFromObject(obj)
    return this._box.distanceToPoint(worldPoint)
  }

  // -------------------------
  // Controller hover + rays
  // -------------------------
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
  // Hand joint helpers
  // -------------------------
  getJointWorld(hand, jointName, out) {
    const j = hand.joints?.[jointName]
    if (!j) return null
    j.getWorldPosition(out)
    return out
  }

  getIndexTipWorld(handEntry, out) {
    const hand = handEntry.hand
    const p = this.getJointWorld(hand, "index-finger-tip", out)
    if (p) return p
    handEntry.pinchPoint.getWorldPosition(out)
    return out
  }

  // -------------------------
  // UI POKE
  // -------------------------
  updateUIPoke() {
    if (this.selected) return

    if (this._lastPokedButton) {
      let minDist = Infinity
      for (const h of this.hands) {
        this.getIndexTipWorld(h, this._tmpA)
        minDist = Math.min(minDist, this.distanceToObjectSurface(this._lastPokedButton, this._tmpA))
      }
      if (minDist > this.uiReleaseRadius) this._lastPokedButton = null
      return
    }

    let bestBtn = null
    let bestDist = this.uiPokeRadius

    for (const h of this.hands) {
      this.getIndexTipWorld(h, this._tmpA)

      for (const obj of this.interactables) {
        if (!obj?.userData?.isUI) continue
        const d = this.distanceToObjectSurface(obj, this._tmpA)
        if (d < bestDist) {
          bestDist = d
          bestBtn = obj
        }
      }
    }

    if (!bestBtn) return

    if (typeof bestBtn.userData?.onPress === "function") {
      bestBtn.userData.onPress()
      this._lastPokedButton = bestBtn
    }
  }

  // -------------------------
  // Pinch detection robusto
  // -------------------------
  computePinchDistance(hand) {
    const thumbTip = this.getJointWorld(hand, "thumb-tip", this._tmpA)
    if (!thumbTip) return null

    const candidates = [
      "index-finger-tip",
      "index-finger-phalanx-distal",
      "index-finger-phalanx-intermediate",
    ]

    let best = Infinity
    for (const name of candidates) {
      const p = this.getJointWorld(hand, name, this._tmpB)
      if (!p) continue
      const d = thumbTip.distanceTo(p)
      if (d < best) best = d
    }

    if (!isFinite(best)) return null
    return best
  }

  updateHandPinchState() {
    for (const h of this.hands) {
      const dist = this.computePinchDistance(h.hand)

      if (dist == null) {
        if (h.isPinching) {
          h.isPinching = false
          this.onHandPinchEnd()
        }
        continue
      }

      if (!h.isPinching && dist <= this.pinchStartDist) {
        h.isPinching = true
        this.onHandPinchStart(h)
      } else if (h.isPinching && dist >= this.pinchEndDist) {
        h.isPinching = false
        this.onHandPinchEnd()
      }
    }
  }

  findNearestComponentToHand(handEntry, maxDist) {
    this.getIndexTipWorld(handEntry, this._tmpC)

    let best = null
    let bestDist = maxDist

    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId) continue
      const d = this.distanceToObjectSurface(obj, this._tmpC)
      if (d < bestDist) {
        bestDist = d
        best = obj
      }
    }

    return best
  }

  // -------------------------
  // ✅ Persist helper (para físicas)
  // -------------------------
  persistMeshTransform(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return
    const p = mesh.position
    const q = mesh.quaternion
    this.appState.updateComponent(id, {
      transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w },
    })
  }

  // -------------------------
  // ✅ Hold velocity tracking
  // -------------------------
  _startHoldTracking(sourceType, source) {
    this._hold.active = true
    this._hold.sourceType = sourceType
    this._hold.source = source
    this._hold.lastT = performance.now()
    this._hold.vel.set(0, 0, 0)

    // posición inicial
    if (sourceType === "controller") {
      source.getWorldPosition(this._hold.lastPos)
    } else if (sourceType === "hand") {
      this.getIndexTipWorld(source, this._hold.lastPos)
    }
  }

  _stopHoldTracking() {
    this._hold.active = false
    this._hold.sourceType = null
    this._hold.source = null
    this._hold.lastT = 0
    this._hold.vel.set(0, 0, 0)
  }

  _updateHoldVelocity() {
    if (!this._hold.active || !this._hold.sourceType || !this._hold.source) return

    const now = performance.now()
    const dt = (now - this._hold.lastT) / 1000
    if (dt <= 0.0001) return

    if (this._hold.sourceType === "controller") {
      this._hold.source.getWorldPosition(this._tmpA)
    } else {
      this.getIndexTipWorld(this._hold.source, this._tmpA)
    }

    // v = dx/dt
    this._hold.vel.copy(this._tmpA).sub(this._hold.lastPos).multiplyScalar(1 / dt)

    // actualizar
    this._hold.lastPos.copy(this._tmpA)
    this._hold.lastT = now
  }

  _shouldEnablePhysics(releaseVel) {
    if (!releaseVel) return false
    const speed = releaseVel.length()
    if (speed >= this.throwStartSpeed) return true
    if (Math.abs(releaseVel.y) >= this.throwMinYSpeed) return true
    return false
  }

  // -------------------------
  // Hand pinch -> grab
  // -------------------------
  onHandPinchStart(handEntry) {
    if (this.selected) return

    const target = this.findNearestComponentToHand(handEntry, this.nearRadius)
    if (!target) return

    this.selected = target
    this.selectedBy = "hand"

    // Start tracking
    this._startHoldTracking("hand", handEntry)

    const joint = handEntry.hand.joints?.["index-finger-tip"]
    if (joint) joint.attach(this.selected)
    else handEntry.pinchPoint.attach(this.selected)
  }

  onHandPinchEnd() {
    if (!this.selected) return
    if (this.selectedBy !== "hand") return

    // Capturar última velocidad antes de soltar
    this._updateHoldVelocity()
    const releaseVel = this._hold.vel.clone()

    this.scene.attach(this.selected)

    // Si se “tiró”, activar física; si no, snap normal
    if (this._shouldEnablePhysics(releaseVel)) {
      this.selected.userData.physics = { active: true, vel: releaseVel }
      // Persist se hará cuando se duerma
    } else {
      this.snapToSurface(this.selected)
      this.persistSelectedTransform()
    }

    this.selected = null
    this.selectedBy = null
    this._stopHoldTracking()
  }

  // -------------------------
  // Controller select (ray)
  // -------------------------
  onControllerSelectStart(event) {
    const controller = event.target
    if (!this.hovered) return
    if (this.hovered.userData?.isSurface) return

    if (this.hovered.userData?.isUI && typeof this.hovered.userData?.onPress === "function") {
      this.hovered.userData.onPress()
      return
    }

    if (!this.hovered.userData?.componentId) return

    this.selected = this.hovered
    this.selectedBy = "controller"

    // Start tracking
    this._startHoldTracking("controller", controller)

    controller.attach(this.selected)
  }

  onControllerSelectEnd() {
    if (!this.selected) return
    if (this.selectedBy !== "controller") return

    // Capturar última velocidad
    this._updateHoldVelocity()
    const releaseVel = this._hold.vel.clone()

    this.scene.attach(this.selected)

    if (this._shouldEnablePhysics(releaseVel)) {
      this.selected.userData.physics = { active: true, vel: releaseVel }
    } else {
      this.snapToSurface(this.selected)
      this.persistSelectedTransform()
    }

    this.selected = null
    this.selectedBy = null
    this._stopHoldTracking()
  }

  // -------------------------
  // Persist (seleccionado)
  // -------------------------
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
  // Hover for hands
  // -------------------------
  computeHandHover() {
    if (!this.nearEnabled) return null

    let best = null
    let bestDist = this.nearRadius

    for (const h of this.hands) {
      this.getIndexTipWorld(h, this._tmpA)

      for (const obj of this.interactables) {
        if (!obj || obj.userData?.isSurface) continue
        const d = this.distanceToObjectSurface(obj, this._tmpA)
        if (d < bestDist) {
          bestDist = d
          best = obj
        }
      }
    }

    return best
  }

  // -------------------------
  // Update loop
  // -------------------------
  update() {
    if (!this.renderer.xr.isPresenting) return

    const handsActive = this.isHandTrackingActive()

    // Rays solo con controladores
    this.updateControllerRays(!handsActive)

    if (handsActive) {
      this.updateUIPoke()
      this.updateHandPinchState()
    }

    // ✅ si está agarrando algo, igual actualizamos velocidad
    if (this.selected) {
      this._updateHoldVelocity()
      return
    }

    const hovered = handsActive ? this.computeHandHover() : this.computeControllerHover()
    this.setHover(hovered)
  }
}