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

    // Base general
    this.nearRadius = 0.145

    // Pulido final de agarre por manos:
    // - tolerancia real para esquinas/caras
    // - sin volver a capturar desde muy lejos
    this.handGrabSurfaceMaxDist = 0.050
    this.handGrabSurfaceSlack = 0.030
    this.handHoverSurfaceMaxDist = 0.065

    // Caja expandida para mejorar esquinas
    this.handGrabExpandedBoxMargin = 0.020
    this.handGrabExpandedBoxMarginWhenOtherHandBusy = 0.026
    this.handHoverExpandedBoxMargin = 0.016

    this.pinchStartDist = 0.070
    this.pinchEndDist = 0.100
    this.pinchReleaseResetDist = 0.115

    this.uiPokeRadius = 0.020
    this.uiReleaseRadius = 0.040

    this.throwVelocityMultiplier = 1.9
    this.throwMinSpeed = 0.22
    this.directPlaceMaxDrop = 0.12

    this.handTrackingReleaseGraceMs = 280
    this.handOpenReleaseGraceMs = 80

    this._tmpA = new THREE.Vector3()
    this._tmpB = new THREE.Vector3()
    this._tmpC = new THREE.Vector3()
    this._tmpD = new THREE.Vector3()
    this._tmpE = new THREE.Vector3()
    this._tmpF = new THREE.Vector3()
    this._tmpSize = new THREE.Vector3()
    this._box = new THREE.Box3()
    this._box2 = new THREE.Box3()

    this._lastPokedButton = null
    this._lastUpdateTime = performance.now()
    this._activePinHoleMarkers = []

    this.initXRInputs()
  }

  setHoleSystem(holeSystem) {
    this.holeSystem = holeSystem
  }

  register(mesh) {
    if (!mesh) return
    if (mesh.userData?.isSurface) return

    mesh.userData.interactable = true
    if (!("heldBy" in mesh.userData)) mesh.userData.heldBy = null

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
        pinchArmed: true,
        heldObject: null,
        hold: this.createHoldState("hand", null),
        lostTrackingMs: 0,
        openPinchMs: 0,
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

  getObjectCenterDistance(obj, worldPoint) {
    this._box.setFromObject(obj)
    this._box.getCenter(this._tmpE)
    return this._tmpE.distanceTo(worldPoint)
  }

  getExpandedBoxDistance(obj, worldPoint, margin = 0.02) {
    this._box2.setFromObject(obj)
    this._box2.expandByScalar(margin)
    return this._box2.distanceToPoint(worldPoint)
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

  makeOwnerToken(type, index) {
    return `${type}:${index}`
  }

  getObjectOwner(obj) {
    return obj?.userData?.heldBy || null
  }

  setObjectOwner(obj, ownerToken) {
    if (!obj) return
    obj.userData.heldBy = ownerToken
  }

  clearObjectOwner(obj) {
    if (!obj) return
    obj.userData.heldBy = null
  }

  isObjectFreeForGrab(obj) {
    if (!obj) return false
    if (obj.userData?.isUI) return true
    if (!obj.userData?.componentId) return false
    if (obj.parent !== this.scene) return false
    return !this.getObjectOwner(obj)
  }

  isAnyOtherHandHolding(handEntry) {
    return this.hands.some((h) => h !== handEntry && !!h.heldObject)
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
    const p = this.getJointWorld(handEntry.hand, "index-finger-tip", out)
    if (p) return p
    handEntry.pinchPoint.getWorldPosition(out)
    return out
  }

  getThumbTipWorld(handEntry, out) {
    const p = this.getJointWorld(handEntry.hand, "thumb-tip", out)
    if (p) return p
    handEntry.pinchPoint.getWorldPosition(out)
    return out
  }

  getGrabPointWorld(handEntry, out) {
    const thumb = this.getThumbTipWorld(handEntry, this._tmpA)
    const index = this.getIndexTipWorld(handEntry, this._tmpB)

    if (thumb && index) {
      out.copy(thumb).add(index).multiplyScalar(0.5)
      return out
    }

    if (index) {
      out.copy(index)
      return out
    }

    if (thumb) {
      out.copy(thumb)
      return out
    }

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

  canHandGrabObject(handEntry, obj) {
    if (!obj?.userData?.componentId) return false
    if (!this.isObjectFreeForGrab(obj)) return false

    const extraMargin = this.isAnyOtherHandHolding(handEntry)
      ? this.handGrabExpandedBoxMarginWhenOtherHandBusy
      : this.handGrabExpandedBoxMargin

    this.getGrabPointWorld(handEntry, this._tmpC)

    const surfaceDist = this.distanceToObjectSurface(obj, this._tmpC)
    const centerDist = this.getObjectCenterDistance(obj, this._tmpC)
    const expandedDist = this.getExpandedBoxDistance(obj, this._tmpC, extraMargin)

    if (centerDist > this.nearRadius) return false
    if (expandedDist > 0.0001 && surfaceDist > this.handGrabSurfaceMaxDist + this.handGrabSurfaceSlack) {
      return false
    }

    return true
  }

  findNearestComponentToHand(handEntry, maxDist) {
    this.getGrabPointWorld(handEntry, this._tmpC)

    let best = null
    let bestScore = Infinity

    const extraMargin = this.isAnyOtherHandHolding(handEntry)
      ? this.handGrabExpandedBoxMarginWhenOtherHandBusy
      : this.handGrabExpandedBoxMargin

    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId) continue
      if (!this.isObjectFreeForGrab(obj)) continue

      const surfaceDist = this.distanceToObjectSurface(obj, this._tmpC)
      const centerDist = this.getObjectCenterDistance(obj, this._tmpC)
      const expandedDist = this.getExpandedBoxDistance(obj, this._tmpC, extraMargin)

      if (centerDist > maxDist) continue

      const nearEnoughBySurface = surfaceDist <= this.handGrabSurfaceMaxDist + this.handGrabSurfaceSlack
      const nearEnoughByExpandedBox = expandedDist <= 0.0001

      if (!nearEnoughBySurface && !nearEnoughByExpandedBox) continue

      const score = expandedDist * 6 + surfaceDist * 2.4 + centerDist
      if (score < bestScore) {
        bestScore = score
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
      this.getGrabPointWorld(source, holdState.lastPos)
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
      this.getGrabPointWorld(holdState.source, this._tmpA)
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

  resolveSurfacePenetration(object) {
    if (!object || this.surfaces.length === 0) return false

    const best = this.getBestSurfaceBelow(object)
    if (!best) return false

    this._box.setFromObject(object)
    this._box.getSize(this._tmpSize)
    const halfY = this._tmpSize.y * 0.5

    const bottomY = object.position.y - halfY
    const targetY = best.point.y + halfY

    if (bottomY < best.point.y) {
      object.position.y = targetY + 0.001
      return true
    }

    return false
  }

  //Verificar holes válidos y todo lo relacionado
  trySnapComponentPinsToHoles(object, maxDist = 0.05) {
    if (!object) return false
    if (!this.holeSystem) return false
    if (!object.userData?.getPinWorldPositions) return false
    if (!Array.isArray(object.userData?.pins) || object.userData.pins.length === 0) return false

    const pinWorldPositions = object.userData.getPinWorldPositions()
    const matches = this.holeSystem.getNearestHolesForPins(pinWorldPositions, maxDist)

    if (!Array.isArray(matches) || matches.length === 0) return false

    const validMatches = matches.filter((m) => !!m.hole)
    if (validMatches.length !== object.userData.pins.length) return false

    const anodeMatch = validMatches.find((m) => m.pinId === "anode")
    const cathodeMatch = validMatches.find((m) => m.pinId === "cathode")

    if (!anodeMatch || !cathodeMatch) return false

    const anodePin = object.userData.pins.find((p) => p.id === "anode")
    const cathodePin = object.userData.pins.find((p) => p.id === "cathode")

    if (!anodePin || !cathodePin) return false

    // Dirección objetivo entre holes, solo en plano horizontal
    const targetDir = new THREE.Vector3()
      .subVectors(cathodeMatch.hole.worldPos, anodeMatch.hole.worldPos)
      .setY(0)

    if (targetDir.lengthSq() < 1e-8) return false

    targetDir.normalize()

    // Calcular yaw objetivo y forzar LED completamente derecho
    const targetYaw = Math.atan2(targetDir.x, targetDir.z)
    object.rotation.set(0, targetYaw, 0)
    object.updateMatrixWorld(true)

    // Recalcular posición del ánodo después de enderezar el LED
    const rotatedAnodeWorld = new THREE.Vector3().copy(anodePin.localPos)
    object.localToWorld(rotatedAnodeWorld)

    const delta = new THREE.Vector3().subVectors(anodeMatch.hole.worldPos, rotatedAnodeWorld)
    object.position.add(delta)

    // Profundidad visual de inserción
    object.position.y -= 0.02

    object.updateMatrixWorld(true)

    this.persistMeshTransform(object)
    return true
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
    this.clearObjectOwner(object)

    this.resolveSurfacePenetration(object)

    const snappedByPins = this.trySnapComponentPinsToHoles(object, 0.05)

    if (snappedByPins) {
      object.userData.physics = null
      clearOwner()
      this.stopHoldTracking(holdState)
      this.clearActivePinHoleMarkers()
      return
    }

    if (releaseVel.lengthSq() === 0 && this.tryPlaceObjectDirectly(object)) {
      clearOwner()
      this.stopHoldTracking(holdState)
      this.clearActivePinHoleMarkers()
      return
    }

    object.userData.physics = { active: true, vel: releaseVel }
    clearOwner()
    this.stopHoldTracking(holdState)
    this.clearActivePinHoleMarkers()
  }

  onHandPinchStart(handEntry) {
    if (!this.isHandEntryTracked(handEntry)) return
    if (handEntry.heldObject) return
    if (!handEntry.pinchArmed) return

    const target = this.findNearestComponentToHand(handEntry, this.nearRadius)

    handEntry.isPinching = true
    handEntry.pinchArmed = false
    handEntry.lostTrackingMs = 0
    handEntry.openPinchMs = 0

    if (!target) return
    if (!this.canHandGrabObject(handEntry, target)) return

    handEntry.heldObject = target
    this.setObjectOwner(target, this.makeOwnerToken("hand", handEntry.index))
    this.startHoldTracking(handEntry.hold, "hand", handEntry)

    const joint = handEntry.hand.joints?.["index-finger-tip"]
    if (this.isJointTracked(joint)) joint.attach(target)
    else handEntry.pinchPoint.attach(target)
  }

  onHandPinchEnd(handEntry, options = {}) {
    if (!handEntry) return

    handEntry.isPinching = false
    handEntry.openPinchMs = 0
    handEntry.lostTrackingMs = 0

    if (!handEntry.heldObject) return

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
    if (!handEntry) return

    handEntry.isPinching = false
    handEntry.openPinchMs = 0
    handEntry.lostTrackingMs = 0

    if (!handEntry.heldObject) {
      this.stopHoldTracking(handEntry.hold)
      return
    }

    this.onHandPinchEnd(handEntry, { forceZeroVelocity })
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
    this.setObjectOwner(target, this.makeOwnerToken("controller", controller.userData.sourceIndex))
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
    let bestScore = Infinity

    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h)) continue
      if (h.heldObject) continue

      this.getGrabPointWorld(h, this._tmpA)

      for (const obj of this.interactables) {
        if (!obj || obj.userData?.isSurface) continue
        if (obj.userData?.componentId && !this.isObjectFreeForGrab(obj)) continue

        if (obj.userData?.isUI) {
          const d = this.distanceToObjectSurface(obj, this._tmpA)
          if (d < bestScore && d < this.uiPokeRadius * 2) {
            bestScore = d
            best = obj
          }
          continue
        }

        const surfaceDist = this.distanceToObjectSurface(obj, this._tmpA)
        const centerDist = this.getObjectCenterDistance(obj, this._tmpA)
        const expandedDist = this.getExpandedBoxDistance(obj, this._tmpA, this.handHoverExpandedBoxMargin)

        if (centerDist > this.nearRadius) continue
        if (surfaceDist > this.handHoverSurfaceMaxDist && expandedDist > 0.0001) continue

        const score = expandedDist * 6 + surfaceDist * 2.4 + centerDist
        if (score < bestScore) {
          bestScore = score
          best = obj
        }
      }
    }

    return best
  }

  updateHeldObjects() {
    let activeHeldObject = null

    for (const handEntry of this.hands) {
      if (handEntry.heldObject) {
        this.updateHoldVelocity(handEntry.hold)
        activeHeldObject = handEntry.heldObject
      }
    }

    for (const controller of this.controllers) {
      if (controller.userData?.heldObject) {
        this.updateHoldVelocity(controller.userData.hold)
        activeHeldObject = controller.userData.heldObject
      }
    }

    if (activeHeldObject) {
      this.updatePinHoleMarkersForHeldObject(activeHeldObject)
    } else {
      this.clearActivePinHoleMarkers()
    }
  }

  cleanupDetachedHolds() {
    for (const handEntry of this.hands) {
      const held = handEntry.heldObject
      if (held && held.parent === this.scene) {
        this.clearObjectOwner(held)
        handEntry.heldObject = null
        handEntry.isPinching = false
        handEntry.openPinchMs = 0
        handEntry.lostTrackingMs = 0
        this.stopHoldTracking(handEntry.hold)
      }
    }

    for (const controller of this.controllers) {
      const held = controller.userData?.heldObject
      if (held && held.parent === this.scene) {
        this.clearObjectOwner(held)
        controller.userData.heldObject = null
        this.stopHoldTracking(controller.userData.hold)
      }
    }
  }

  updateHandPinchState(dtMs) {
    for (const h of this.hands) {
      const tracked = this.isHandEntryTracked(h)
      const dist = tracked ? this.computePinchDistance(h.hand) : null

      if (!tracked || dist == null) {
        if (h.heldObject) {
          h.lostTrackingMs += dtMs
          if (h.lostTrackingMs >= this.handTrackingReleaseGraceMs) {
            this.forceReleaseHand(h, true)
            h.pinchArmed = true
          }
        } else {
          h.isPinching = false
          h.pinchArmed = true
          h.openPinchMs = 0
          h.lostTrackingMs = 0
          this.stopHoldTracking(h.hold)
        }
        continue
      }

      h.lostTrackingMs = 0

      if (dist >= this.pinchReleaseResetDist) {
        h.pinchArmed = true
      }

      if (h.heldObject) {
        if (dist >= this.pinchEndDist) {
          h.openPinchMs += dtMs
          if (h.openPinchMs >= this.handOpenReleaseGraceMs) {
            this.onHandPinchEnd(h)
          }
        } else {
          h.openPinchMs = 0
          h.isPinching = true
        }
        continue
      }

      h.openPinchMs = 0

      if (dist <= this.pinchStartDist && h.pinchArmed) {
        this.onHandPinchStart(h)
      } else if (dist > this.pinchEndDist) {
        h.isPinching = false
      }
    }
  }

  //Borra los puntos blancos viejos para que no se queden flotando.
  clearActivePinHoleMarkers() {
    for (const marker of this._activePinHoleMarkers) {
      if (marker?.parent) marker.parent.remove(marker)
    }
    this._activePinHoleMarkers.length = 0
  }

  //Dibuja bolas blancas y encuentra holes cercanos mientras se sostiene el objeto
  updatePinHoleMarkersForHeldObject(object) {
    this.clearActivePinHoleMarkers()

    if (!object) return
    if (!this.holeSystem) return
    if (!object.userData?.getPinWorldPositions) return

    const pinWorldPositions = object.userData.getPinWorldPositions()
    const matches = this.holeSystem.getNearestHolesForPins(pinWorldPositions, 0.05)

    for (const match of matches) {
      if (!match.hole) continue

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      )

      marker.position.copy(match.hole.worldPos)
      this.scene.add(marker)
      this._activePinHoleMarkers.push(marker)
    }
  }
  update() {
    if (!this.renderer.xr.isPresenting) return

    const now = performance.now()
    const dtMs = Math.min(50, now - this._lastUpdateTime)
    this._lastUpdateTime = now

    const handsActive = this.isHandTrackingActive()

    this.updateControllerRays(!handsActive)

    if (handsActive) {
      this.updateUIPoke()
      this.updateHandPinchState(dtMs)
    } else {
      for (const handEntry of this.hands) {
        this.forceReleaseHand(handEntry, true)
        handEntry.pinchArmed = true
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