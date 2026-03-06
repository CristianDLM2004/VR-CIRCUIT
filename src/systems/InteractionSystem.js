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
    this.hands = []
    this.interactables = []
    this.surfaces = []
    this.holeSystem = null

    this.hovered = null
    this.controllerRays = []

    this.nearEnabled = true
    this.nearRadius = 0.12

    // Umbrales más robustos
    this.pinchStartDist = 0.060
    this.pinchEndDist = 0.090
    this.pinchReleaseResetDist = 0.100

    this.uiPokeRadius = 0.020
    this.uiReleaseRadius = 0.040

    this._tmpA = new THREE.Vector3()
    this._tmpB = new THREE.Vector3()
    this._tmpC = new THREE.Vector3()
    this._box = new THREE.Box3()

    this._lastPokedButton = null

    this.throwVelocityMultiplier = 1.9
    this.throwMinSpeed = 0.22
    this.directPlaceMaxDrop = 0.12

    this.initXRInputs()
  }

  setHoleSystem(holeSystem) {
    this.holeSystem = holeSystem
  }

  register(mesh) {
    if (!mesh) return
    if (mesh.userData?.isSurface) return
    mesh.userData.interactable = true
    if (!this.interactables.includes(mesh)) this.interactables.push(mesh)
  }

  unregister(mesh) {
    this.interactables = this.interactables.filter((m) => m !== mesh)
  }

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

  initXRInputs() {
    const controllerModelFactory = new XRControllerModelFactory()
    const handModelFactory = new XRHandModelFactory()

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i)
      controller.userData.sourceType = "controller"
      controller.userData.sourceIndex = i
      controller.userData.heldObject = null
      controller.userData.hold = this.createHoldState("controller", controller)

      controller.addEventListener("selectstart", (e) => this.onControllerSelectStart(e))
      controller.addEventListener("selectend", (e) => this.onControllerSelectEnd(e))
      this.scene.add(controller)

      const controllerGrip = this.renderer.xr.getControllerGrip(i)
      controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
      this.scene.add(controllerGrip)

      const { line, hitDot } = this.createControllerRay()
      controller.add(line)
      controller.add(hitDot)
      this.controllerRays.push({ controller, line, hitDot })

      this.controllers.push(controller)

      const hand = this.renderer.xr.getHand(i)
      hand.add(handModelFactory.createHandModel(hand, "mesh"))
      this.scene.add(hand)

      const pinchPoint = new THREE.Object3D()
      pinchPoint.name = `PinchPoint_${i}`
      hand.add(pinchPoint)

      this.hands.push({
        index: i,
        hand,
        pinchPoint,
        isPinching: false,
        heldObject: null,
        hold: this.createHoldState("hand", null),
      })
    }
  }

  createHoldState(sourceType, source) {
    return {
      active: false,
      sourceType,
      source,
      lastPos: new THREE.Vector3(),
      lastT: 0,
      vel: new THREE.Vector3(),
      samples: [],
      maxSamples: 8,
      sampleWindowMs: 120,
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

  isHandTrackingActive() {
    const session = this.renderer.xr.getSession?.()
    if (!session) return false
    return Array.from(session.inputSources || []).some((src) => !!src.hand)
  }

  isJointTracked(joint) {
    if (!joint) return false
    if (joint.visible === false) return false
    return true
  }

  isHandEntryTracked(handEntry) {
    if (!handEntry?.hand?.joints) return false
    const thumb = handEntry.hand.joints["thumb-tip"]
    const index = handEntry.hand.joints["index-finger-tip"]
    return this.isJointTracked(thumb) && this.isJointTracked(index)
  }

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

  distanceToObjectSurface(obj, worldPoint) {
    this._box.setFromObject(obj)
    return this._box.distanceToPoint(worldPoint)
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

  isObjectFreeForGrab(obj) {
    if (!obj) return false
    if (obj.userData?.isUI) return true
    if (!obj.userData?.componentId) return false
    return obj.parent === this.scene
  }

  computeControllerHoverFor(controller) {
    let best = null

    this.tempMatrix.identity().extractRotation(controller.matrixWorld)
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

    const hits = this.raycaster.intersectObjects(this.interactables, true)
    if (hits.length === 0) return null

    for (const h of hits) {
      const picked = this.pickInteractableFromHitObject(h.object)
      if (!picked) continue
      if (!this.interactables.includes(picked)) continue
      if (picked.userData?.isSurface) continue

      if (picked.userData?.isUI) {
        best = picked
        break
      }

      if (picked.userData?.componentId && this.isObjectFreeForGrab(picked)) {
        best = picked
        break
      }
    }

    return best
  }

  computeControllerHover() {
    for (const controller of this.controllers) {
      const best = this.computeControllerHoverFor(controller)
      if (best) return best
    }
    return null
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
      for (const h of hits) {
        const picked = this.pickInteractableFromHitObject(h.object)
        if (!picked) continue
        if (picked.userData?.isUI || this.isObjectFreeForGrab(picked)) {
          dist = Math.min(5, Math.max(0.05, h.distance))
          break
        }
      }

      r.line.scale.z = dist
      r.hitDot.position.z = -dist
    }
  }

  getJointWorld(hand, jointName, out) {
    const j = hand.joints?.[jointName]
    if (!this.isJointTracked(j)) return null
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

  updateUIPoke() {
    if (this.hands.some((h) => h.heldObject)) return

    if (this._lastPokedButton) {
      let minDist = Infinity

      for (const h of this.hands) {
        if (!this.isHandEntryTracked(h)) continue
        this.getIndexTipWorld(h, this._tmpA)
        minDist = Math.min(minDist, this.distanceToObjectSurface(this._lastPokedButton, this._tmpA))
      }

      if (minDist > this.uiReleaseRadius) this._lastPokedButton = null
      return
    }

    let bestBtn = null
    let bestDist = this.uiPokeRadius

    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h)) continue
      if (h.heldObject) continue

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

  resetHandPinchIfOpen(handEntry, dist) {
    if (!handEntry) return
    if (handEntry.heldObject) return
    if (dist == null) return

    if (dist >= this.pinchReleaseResetDist) {
      handEntry.isPinching = false
      this.stopHoldTracking(handEntry.hold)
    }
  }

  updateHandPinchState() {
    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h)) {
        if (h.isPinching) {
          h.isPinching = false
          this.onHandPinchEnd(h, { forceZeroVelocity: true })
        } else if (h.heldObject) {
          this.forceReleaseHand(h, true)
        } else {
          this.stopHoldTracking(h.hold)
        }
        continue
      }

      const dist = this.computePinchDistance(h.hand)

      if (dist == null) {
        if (h.isPinching) {
          h.isPinching = false
          this.onHandPinchEnd(h, { forceZeroVelocity: true })
        } else if (h.heldObject) {
          this.forceReleaseHand(h, true)
        } else {
          this.stopHoldTracking(h.hold)
        }
        continue
      }

      if (!h.heldObject) {
        this.resetHandPinchIfOpen(h, dist)
      }

      if (!h.isPinching && dist <= this.pinchStartDist) {
        h.isPinching = true
        this.onHandPinchStart(h)
      } else if (h.isPinching && dist >= this.pinchEndDist) {
        h.isPinching = false
        this.onHandPinchEnd(h)
      }

      if (!h.heldObject && dist > this.pinchEndDist) {
        h.isPinching = false
      }
    }
  }

  findNearestComponentToHand(handEntry, maxDist) {
    this.getIndexTipWorld(handEntry, this._tmpC)

    let best = null
    let bestDist = maxDist

    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId) continue
      if (!this.isObjectFreeForGrab(obj)) continue

      const d = this.distanceToObjectSurface(obj, this._tmpC)
      if (d < bestDist) {
        bestDist = d
        best = obj
      }
    }

    return best
  }

  persistMeshTransform(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return

    const p = mesh.position
    const q = mesh.quaternion

    this.appState.updateComponent(id, {
      transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w },
    })
  }

  startHoldTracking(holdState, sourceType, source) {
    holdState.active = true
    holdState.sourceType = sourceType
    holdState.source = source
    holdState.lastT = performance.now()
    holdState.vel.set(0, 0, 0)
    holdState.samples.length = 0

    if (sourceType === "controller") {
      source.getWorldPosition(holdState.lastPos)
    } else {
      this.getIndexTipWorld(source, holdState.lastPos)
    }
  }

  stopHoldTracking(holdState) {
    holdState.active = false
    holdState.sourceType = null
    holdState.source = null
    holdState.lastT = 0
    holdState.vel.set(0, 0, 0)
    holdState.samples.length = 0
  }

  updateHoldVelocity(holdState) {
    if (!holdState?.active || !holdState.sourceType || !holdState.source) return

    const now = performance.now()
    const dt = (now - holdState.lastT) / 1000
    if (dt <= 0.0001) return

    if (holdState.sourceType === "controller") {
      holdState.source.getWorldPosition(this._tmpA)
    } else {
      if (!this.isHandEntryTracked(holdState.source)) return
      this.getIndexTipWorld(holdState.source, this._tmpA)
    }

    const v = this._tmpA.clone().sub(holdState.lastPos).multiplyScalar(1 / dt)

    holdState.samples.push({ v, t: now })
    while (holdState.samples.length > holdState.maxSamples) holdState.samples.shift()

    const minT = now - holdState.sampleWindowMs
    while (holdState.samples.length && holdState.samples[0].t < minT) holdState.samples.shift()

    if (holdState.samples.length) {
      holdState.vel.set(0, 0, 0)
      for (const s of holdState.samples) holdState.vel.add(s.v)
      holdState.vel.multiplyScalar(1 / holdState.samples.length)
    } else {
      holdState.vel.copy(v)
    }

    holdState.lastPos.copy(this._tmpA)
    holdState.lastT = now
  }

  getReleaseVelocity(holdState, forceZeroVelocity = false) {
    if (forceZeroVelocity) return new THREE.Vector3(0, 0, 0)

    const v = holdState.vel.clone().multiplyScalar(this.throwVelocityMultiplier)
    if (v.length() < this.throwMinSpeed) v.set(0, 0, 0)
    return v
  }

  getBestSurfaceBelow(object) {
    if (!object || this.surfaces.length === 0) return null

    const origin = object.position.clone()
    origin.y += 2

    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))

    const surfaceMeshes = this.surfaces.map((s) => s.mesh)
    const hits = this.downRaycaster.intersectObjects(surfaceMeshes, true)
    if (hits.length === 0) return null

    return this.pickBestSurfaceHit(hits)
  }

  tryPlaceObjectDirectly(object) {
    if (!object) return false

    const best = this.getBestSurfaceBelow(object)
    if (!best) return false

    const bbox = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    const halfY = size.y / 2
    const bottomY = object.position.y - halfY
    const drop = bottomY - best.point.y

    if (drop < -0.03) return false
    if (drop > this.directPlaceMaxDrop) return false

    object.position.y = best.point.y + halfY

    if (this.holeSystem) this.holeSystem.trySnapObject(object, 0.03)
    this.persistMeshTransform(object)
    return true
  }

  releaseHeldObject(object, holdState, clearOwner, options = {}) {
    if (!object) return

    const { forceZeroVelocity = false } = options

    this.updateHoldVelocity(holdState)
    const releaseVel = this.getReleaseVelocity(holdState, forceZeroVelocity)

    this.scene.attach(object)

    if (releaseVel.lengthSq() === 0 && this.tryPlaceObjectDirectly(object)) {
      clearOwner()
      this.stopHoldTracking(holdState)
      return
    }

    object.userData.physics = { active: true, vel: releaseVel }
    clearOwner()
    this.stopHoldTracking(holdState)
  }

  onHandPinchStart(handEntry) {
    if (!this.isHandEntryTracked(handEntry)) return
    if (handEntry.heldObject) return

    const target = this.findNearestComponentToHand(handEntry, this.nearRadius)
    if (!target) return

    handEntry.heldObject = target
    this.startHoldTracking(handEntry.hold, "hand", handEntry)

    const joint = handEntry.hand.joints?.["index-finger-tip"]
    if (this.isJointTracked(joint)) joint.attach(target)
    else handEntry.pinchPoint.attach(target)
  }

  onHandPinchEnd(handEntry, options = {}) {
    if (!handEntry?.heldObject) return

    const object = handEntry.heldObject

    this.releaseHeldObject(
      object,
      handEntry.hold,
      () => {
        handEntry.heldObject = null
      },
      options
    )
  }

  forceReleaseHand(handEntry, forceZeroVelocity = true) {
    if (!handEntry?.heldObject) return
    this.onHandPinchEnd(handEntry, { forceZeroVelocity })
    handEntry.isPinching = false
  }

  onControllerSelectStart(event) {
    const controller = event.target
    if (!controller) return
    if (controller.userData?.heldObject) return

    const target = this.computeControllerHoverFor(controller)
    if (!target) return
    if (target.userData?.isSurface) return

    if (target.userData?.isUI && typeof target.userData?.onPress === "function") {
      target.userData.onPress()
      return
    }

    if (!target.userData?.componentId) return
    if (!this.isObjectFreeForGrab(target)) return

    controller.userData.heldObject = target
    this.startHoldTracking(controller.userData.hold, "controller", controller)
    controller.attach(target)
  }

  onControllerSelectEnd(event) {
    const controller = event?.target
    if (!controller?.userData?.heldObject) return

    const object = controller.userData.heldObject

    this.releaseHeldObject(
      object,
      controller.userData.hold,
      () => {
        controller.userData.heldObject = null
      }
    )
  }

  snapToSurface(object) {
    if (!object || this.surfaces.length === 0) return

    const best = this.getBestSurfaceBelow(object)
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

  computeHandHover() {
    if (!this.nearEnabled) return null

    let best = null
    let bestDist = this.nearRadius

    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h)) continue
      if (h.heldObject) continue

      this.getIndexTipWorld(h, this._tmpA)

      for (const obj of this.interactables) {
        if (!obj || obj.userData?.isSurface) continue
        if (obj.userData?.componentId && !this.isObjectFreeForGrab(obj)) continue

        const d = this.distanceToObjectSurface(obj, this._tmpA)
        if (d < bestDist) {
          bestDist = d
          best = obj
        }
      }
    }

    return best
  }

  updateHeldObjects() {
    for (const handEntry of this.hands) {
      if (handEntry.heldObject) this.updateHoldVelocity(handEntry.hold)
    }

    for (const controller of this.controllers) {
      if (controller.userData?.heldObject) this.updateHoldVelocity(controller.userData.hold)
    }
  }

  cleanupDetachedHolds() {
    for (const handEntry of this.hands) {
      if (handEntry.heldObject && handEntry.heldObject.parent === this.scene) {
        handEntry.heldObject = null
        handEntry.isPinching = false
        this.stopHoldTracking(handEntry.hold)
      }
    }

    for (const controller of this.controllers) {
      const held = controller.userData?.heldObject
      if (held && held.parent === this.scene) {
        controller.userData.heldObject = null
        this.stopHoldTracking(controller.userData.hold)
      }
    }
  }

  update() {
    if (!this.renderer.xr.isPresenting) return

    const handsActive = this.isHandTrackingActive()

    this.updateControllerRays(!handsActive)

    if (handsActive) {
      this.updateUIPoke()
      this.updateHandPinchState()
    } else {
      for (const handEntry of this.hands) {
        if (handEntry.heldObject) this.forceReleaseHand(handEntry, true)
        handEntry.isPinching = false
        this.stopHoldTracking(handEntry.hold)
      }
    }

    this.cleanupDetachedHolds()
    this.updateHeldObjects()

    const anyHeld =
      this.hands.some((h) => !!h.heldObject) ||
      this.controllers.some((c) => !!c.userData?.heldObject)

    if (anyHeld) {
      this.setHover(null)
      return
    }

    const hovered = handsActive ? this.computeHandHover() : this.computeControllerHover()
    this.setHover(hovered)
  }
}