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
    this.stateSyncSystem = null

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

    this.controllerRayMaxLength = 1.15
    this.controllerRayMinLength = 0.08

    this.nearEnabled = true
    this.nearRadius = 0.24

    this.handGrabSurfaceMaxDist = 0.115
    this.handGrabSurfaceSlack = 0.065
    this.handHoverSurfaceMaxDist = 0.125

    this.handGrabExpandedBoxMargin = 0.042
    this.handGrabExpandedBoxMarginWhenOtherHandBusy = 0.052
    this.handHoverExpandedBoxMargin = 0.034

    this.handGrabExpandedSphereMargin = 0.048
    this.handHoverExpandedSphereMargin = 0.038

    this.insertedGrabBonusBoxMargin = 0.012
    this.insertedGrabBonusSphereMargin = 0.016
    this.insertedGrabBonusRadius = 0.016

    this.pinchStartDist = 0.070
    this.pinchEndDist = 0.100
    this.pinchReleaseResetDist = 0.115

    this.uiPokeRadius = 0.028
    this.uiReleaseRadius = 0.048

    this.throwVelocityMultiplier = 1.9
    this.throwMinSpeed = 0.22
    this.directPlaceMaxDrop = 0.12

    this.handTrackingReleaseGraceMs = 280
    this.handOpenReleaseGraceMs = 80

    this.appMode = "edit"

    this._handHeldButton = new Map()

    this.toolMode = "grab"
    this.wireHoverAnchor = null
    this.wireHoverEndpoint = null
    this.wireHoverHandIndex = null
    this.wireHoverSourceType = null
    this.wireHoverSourceIndex = null
    this._wireHoverMarker = null

    this.wireHoverMaxDist = 0.055
    this.wireHoverReleaseDist = 0.085
    this.wireEndpointHoverMaxDist = 0.020
    this.wirePinchStartDist = 0.016
    this.wirePinchEndDist = 0.030

    this.wireControllerHoverPerpMaxDist = 0.022
    this.wireControllerEndpointPerpMaxDist = 0.026
    this.wireControllerRayMaxDist = this.controllerRayMaxLength
    this.wireControllerFallbackDist = 0.35

    this.wireAnchorPriority = { terminal: 0, pin: 1, hole: 2 }

    this.wireDraftStartAnchor = null
    this.wireDraftHandIndex = null
    this.wireDraftSourceType = null
    this.wireDraftSourceIndex = null
    this.wireDraftWaypoints = []
    this.wireDraftColor = 0x111111
    this._wireDraftMeshes = []
    this.wireDraftRadius = 0.0038

    this.wireActionCooldownMs = 90
    this._lastWireActionMs = 0

    this._tmpA = new THREE.Vector3()
    this._tmpB = new THREE.Vector3()
    this._tmpC = new THREE.Vector3()
    this._tmpD = new THREE.Vector3()
    this._tmpE = new THREE.Vector3()
    this._tmpF = new THREE.Vector3()
    this._tmpG = new THREE.Vector3()
    this._tmpH = new THREE.Vector3()
    this._tmpI = new THREE.Vector3()
    this._tmpJ = new THREE.Vector3()
    this._tmpK = new THREE.Vector3()
    this._tmpL = new THREE.Vector3()
    this._tmpSize = new THREE.Vector3()
    this._box = new THREE.Box3()
    this._box2 = new THREE.Box3()
    this._sphere = new THREE.Sphere()

    this._lastPokedButton = null
    this._lastUpdateTime = performance.now()
    this._activePinHoleMarkers = []

    this.initXRInputs()

    this.renderer.xr.addEventListener("sessionend", () => {
      this.handleXRSessionEnd()
    })
  }

  setHoleSystem(hs) { this.holeSystem = hs }
  setStateSyncSystem(sss) { this.stateSyncSystem = sss }

  setAppMode(mode) {
    const next = mode === "sim" ? "sim" : "edit"
    if (this.appMode === next) return
    this.appMode = next

    if (this.appMode === "sim") {
      for (const h of this.hands) {
        if (h.heldObject) this.forceReleaseHand(h, true)
      }
      for (const c of this.controllers) {
        if (c.userData?.heldObject) {
          this.releaseHeldObject(c.userData.heldObject, c.userData.hold, () => { c.userData.heldObject = null })
        }
      }
      for (const [, pressed] of this._handHeldButton) {
        if (typeof pressed.userData?.releaseButton === "function") pressed.userData.releaseButton()
      }
      this._handHeldButton.clear()
    }

    if (this.appMode === "edit") {
      for (const [, pressed] of this._handHeldButton) {
        if (typeof pressed.userData?.releaseButton === "function") pressed.userData.releaseButton()
      }
      this._handHeldButton.clear()
    }

    console.log(`🔧 Modo: ${this.appMode === "edit" ? "EDICIÓN" : "SIMULACIÓN"}`)
  }

  setToolMode(mode = "grab") {
    const next = mode === "wire" ? "wire" : "grab"
    if (this.toolMode === next) return
    this.toolMode = next
    if (this.toolMode !== "wire") {
      this.clearWireHoverAnchor()
      this.clearWireDraft()
    }
  }

  isSimMode() { return this.appMode === "sim" }
  isEditMode() { return this.appMode === "edit" }

  isComponentWithOnPress(obj) {
    return !!(
      obj?.userData?.componentId &&
      !obj.userData?.isUI &&
      typeof obj.userData?.onPress === "function"
    )
  }

  register(mesh) {
    if (!mesh) return
    if (mesh.userData?.isSurface) return
    if (mesh.userData?.interactable === false) return
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
    const cmf = new XRControllerModelFactory()
    const hmf = new XRHandModelFactory()

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i)
      controller.userData.sourceType = "controller"
      controller.userData.sourceIndex = i
      controller.userData.heldObject = null
      controller.userData.hold = this.createHoldState("controller", controller)
      controller.userData._pressedComponent = null

      controller.addEventListener("selectstart", (e) => this.onControllerSelectStart(e))
      controller.addEventListener("selectend", (e) => this.onControllerSelectEnd(e))
      this.scene.add(controller)

      const grip = this.renderer.xr.getControllerGrip(i)
      grip.add(cmf.createControllerModel(grip))
      this.scene.add(grip)

      const { line, hitDot } = this.createControllerRay()
      controller.add(line)
      controller.add(hitDot)
      this.controllerRays.push({ controller, line, hitDot })
      this.controllers.push(controller)

      const hand = this.renderer.xr.getHand(i)
      hand.add(hmf.createHandModel(hand, "mesh"))
      this.scene.add(hand)

      const pp = new THREE.Object3D()
      pp.name = `PinchPoint_${i}`
      hand.add(pp)

      this.hands.push({
        index: i,
        hand,
        pinchPoint: pp,
        isPinching: false,
        pinchArmed: true,
        heldObject: null,
        hold: this.createHoldState("hand", null),
        lostTrackingMs: 0,
        openPinchMs: 0,
        wirePinchCloseMs: 0,
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
      grabOffset: new THREE.Vector3(),
      grabLocalPoint: new THREE.Vector3(),
      holdDistance: 0,
    }
  }

  createControllerRay() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)])
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff }))
    line.name = "ControllerRay"
    line.scale.z = this.controllerRayMaxLength

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    )
    dot.name = "ControllerRayDot"
    dot.position.z = -this.controllerRayMaxLength

    return { line, hitDot: dot }
  }

  detachHeldComponentsFromNode(root) {
    if (!root) return
    const found = []
    root.traverse((obj) => {
      if (obj?.userData?.componentId) found.push(obj)
    })
    for (const obj of found) {
      this.scene.attach(obj)
      this.clearObjectOwner(obj)
      obj.userData.physics = null
      this.resolveSurfacePenetration(obj)
      if (!this.tryPlaceObjectDirectly(obj)) this.persistMeshTransform(obj)
    }
  }

  finalizeDetachedObjectAfterXRExit(obj) {
    if (!obj) return
    this.scene.attach(obj)
    this.clearObjectOwner(obj)
    obj.userData.physics = null
    this.resolveSurfacePenetration(obj)
    if (!this.trySnapComponentPinsToHoles(obj, 0.05)) {
      this.tryPlaceObjectDirectly(obj)
      this.persistMeshTransform(obj)
    }
  }

  handleXRSessionEnd() {
    for (const h of this.hands) {
      if (h.heldObject) {
        this.finalizeDetachedObjectAfterXRExit(h.heldObject)
        h.heldObject = null
      }
      this.detachHeldComponentsFromNode(h.hand)
      h.isPinching = false
      h.pinchArmed = true
      h.lostTrackingMs = 0
      h.openPinchMs = 0
      h.wirePinchCloseMs = 0
      this.stopHoldTracking(h.hold)
    }

    for (const c of this.controllers) {
      if (c.userData?.heldObject) {
        this.finalizeDetachedObjectAfterXRExit(c.userData.heldObject)
        c.userData.heldObject = null
      }
      this.detachHeldComponentsFromNode(c)
      if (c.userData?._pressedComponent && typeof c.userData._pressedComponent.userData?.releaseButton === "function") {
        c.userData._pressedComponent.userData.releaseButton()
      }
      c.userData._pressedComponent = null
      this.stopHoldTracking(c.userData.hold)
    }

    for (const [, pressed] of this._handHeldButton) {
      if (typeof pressed.userData?.releaseButton === "function") pressed.userData.releaseButton()
    }
    this._handHeldButton.clear()

    this.clearWireHoverAnchor()
    this.clearWireDraft()
    this.setHover(null)
    this.clearActivePinHoleMarkers()
  }

  isHandTrackingActive() {
    const s = this.renderer.xr.getSession?.()
    if (!s) return false
    return Array.from(s.inputSources || []).some((src) => !!src.hand)
  }

  isJointTracked(joint) {
    return !!(joint && joint.visible !== false)
  }

  isHandEntryTracked(he) {
    if (!he?.hand?.joints) return false
    return this.isJointTracked(he.hand.joints["thumb-tip"]) && this.isJointTracked(he.hand.joints["index-finger-tip"])
  }

  setHover(newH) {
    if (this.hovered === newH) return
    if (this.hovered) {
      this.hovered.traverse?.((c) => { if (c.isMesh && c.material?.emissive) c.material.emissive.setHex(0x000000) })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x000000)
    }
    this.hovered = newH
    if (this.hovered) {
      this.hovered.traverse?.((c) => { if (c.isMesh && c.material?.emissive) c.material.emissive.setHex(0x222222) })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x222222)
    }
  }

  distanceToObjectSurface(obj, pt) {
    this._box.setFromObject(obj)
    return this._box.distanceToPoint(pt)
  }

  getObjectCenterDistance(obj, pt) {
    this._box.setFromObject(obj)
    this._box.getCenter(this._tmpE)
    return this._tmpE.distanceTo(pt)
  }

  getExpandedBoxDistance(obj, pt, m = 0.02) {
    this._box2.setFromObject(obj)
    this._box2.expandByScalar(m)
    return this._box2.distanceToPoint(pt)
  }

  getExpandedSphereDistance(obj, pt, margin = 0.03) {
    this._box.setFromObject(obj)
    this._box.getBoundingSphere(this._sphere)
    const r = this._sphere.radius + margin
    const d = this._sphere.center.distanceTo(pt) - r
    return Math.max(0, d)
  }

  getAdaptiveExpandedMargin(obj, baseMargin = 0.02) {
    const target = obj?.userData?.grabTarget || obj
    this._box.setFromObject(target)
    this._box.getSize(this._tmpSize)
    const minDim = Math.min(this._tmpSize.x, this._tmpSize.y, this._tmpSize.z)
    const extra = THREE.MathUtils.clamp(0.020 - minDim, 0, 0.012)
    return baseMargin + extra
  }

  getClosestPointOnObjectBounds(obj, worldPoint, out) {
    this._box.setFromObject(obj)
    out.copy(worldPoint).clamp(this._box.min, this._box.max)
    return out
  }

  getObjectGrabCenterWorld(obj, out) {
    if (obj?.userData?.getGrabCenterWorld) {
      out.copy(obj.userData.getGrabCenterWorld())
      return out
    }

    const target = obj?.userData?.grabTarget || obj
    this._box.setFromObject(target)
    this._box.getCenter(out)
    return out
  }

  getClosestGrabPointWorld(obj, worldPoint, out) {
    const target = obj?.userData?.grabTarget || obj
    this._box.setFromObject(target)
    out.copy(worldPoint).clamp(this._box.min, this._box.max)
    return out
  }

  getGrabDistanceToObject(obj, worldPoint) {
    const radius = obj?.userData?.grabRadius ?? 0.020
    const target = obj?.userData?.grabTarget || obj

    this._box.setFromObject(target)
    const bodyDistance = Math.max(0, this._box.distanceToPoint(worldPoint) - radius)

    let best = bodyDistance

    if (obj?.userData?.getGrabWorldPoints) {
      const grabPoints = obj.userData.getGrabWorldPoints()
      if (Array.isArray(grabPoints) && grabPoints.length) {
        for (const gp of grabPoints) {
          const weight = gp.weight ?? 1
          const d = Math.max(0, gp.worldPos.distanceTo(worldPoint) - radius) / Math.max(0.0001, weight)
          if (d < best) best = d
        }
      }
    }

    return best
  }

  getGrabCandidateScore(obj, pt, baseBoxMargin, baseSphereMargin) {
    const inserted = !!obj?.userData?.inserted || !!obj?.userData?.pinConnections

    const adaptiveBoxMargin =
      this.getAdaptiveExpandedMargin(obj, baseBoxMargin) +
      (inserted ? this.insertedGrabBonusBoxMargin : 0)

    const adaptiveSphereMargin =
      this.getAdaptiveExpandedMargin(obj, baseSphereMargin) +
      (inserted ? this.insertedGrabBonusSphereMargin : 0)

    const target = obj?.userData?.grabTarget || obj

    const grabD = this.getGrabDistanceToObject(obj, pt)
    const sd = this.distanceToObjectSurface(target, pt)
    const cd = this.getObjectGrabCenterWorld(obj, this._tmpH).distanceTo(pt)
    const ed = this.getExpandedBoxDistance(target, pt, adaptiveBoxMargin)
    const sphereD = this.getExpandedSphereDistance(target, pt, adaptiveSphereMargin)

    return {
      grabD,
      sd,
      cd,
      ed,
      sphereD,
      adaptiveBoxMargin,
      adaptiveSphereMargin,
      inserted,
      score: grabD * 8.0 + sd * 2.1 + sphereD * 1.3 + ed * 0.8 + cd * 0.035,
    }
  }

  getHandProbeWorldPoints(he) {
    const probes = []

    const thumb = this.getThumbTipWorld(he, this._tmpI)
    if (thumb) probes.push({ id: "thumb", worldPos: thumb.clone() })

    const index = this.getIndexTipWorld(he, this._tmpJ)
    if (index) probes.push({ id: "index", worldPos: index.clone() })

    if (thumb && index) {
      probes.push({
        id: "mid",
        worldPos: thumb.clone().add(index).multiplyScalar(0.5),
      })

      probes.push({
        id: "index_biased",
        worldPos: thumb.clone().lerp(index, 0.72),
      })

      probes.push({
        id: "thumb_biased",
        worldPos: index.clone().lerp(thumb, 0.72),
      })
    }

    he.pinchPoint.getWorldPosition(this._tmpK)
    probes.push({ id: "pinchPoint", worldPos: this._tmpK.clone() })

    return probes
  }

  getBestHandProbePointWorld(he, obj, out) {
    const probes = this.getHandProbeWorldPoints(he)
    let best = null
    let bestScore = Infinity

    for (const probe of probes) {
      const grabD = this.getGrabDistanceToObject(obj, probe.worldPos)
      const target = obj?.userData?.grabTarget || obj
      const sd = this.distanceToObjectSurface(target, probe.worldPos)
      const score = grabD * 3.5 + sd * 1.2

      if (score < bestScore) {
        bestScore = score
        best = probe
      }
    }

    if (best) {
      out.copy(best.worldPos)
      return out
    }

    return this.getGrabPointWorld(he, out)
  }

  pickInteractableFromHitObject(hit) {
    let obj = hit
    while (obj && obj.parent) {
      if (obj.userData?.isUI || obj.userData?.componentId) return obj
      obj = obj.parent
    }
    if (hit?.userData?.isUI || hit?.userData?.componentId) return hit
    return null
  }

  makeOwnerToken(t, i) { return `${t}:${i}` }
  getObjectOwner(obj) { return obj?.userData?.heldBy || null }
  setObjectOwner(obj, t) { if (obj) obj.userData.heldBy = t }
  clearObjectOwner(obj) { if (obj) obj.userData.heldBy = null }

  isObjectFreeForGrab(obj) {
    if (!obj) return false
    if (obj.userData?.isUI) return true
    if (!obj.userData?.componentId) return false
    if (obj.parent !== this.scene) return false
    return !this.getObjectOwner(obj)
  }

  isAnyOtherHandHolding(he) {
    return this.hands.some((h) => h !== he && !!h.heldObject)
  }

  getControllerRayWorld(controller, outOrigin, outDir) {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld)
    outOrigin.setFromMatrixPosition(controller.matrixWorld)
    outDir.set(0, 0, -1).applyMatrix4(this.tempMatrix).normalize()
    return { origin: outOrigin, direction: outDir }
  }

  getControllerByIndex(index) {
    return this.controllers.find((c) => (c.userData?.sourceIndex ?? -1) === index) || null
  }

  getControllerWirePointerWorld(controller, out) {
    if (!controller) return null

    if (this.wireHoverSourceType === "controller" && this.wireHoverSourceIndex === (controller.userData?.sourceIndex ?? -1)) {
      const target = this.wireHoverAnchor?.worldPos || this.wireHoverEndpoint?.worldPos
      if (target) {
        out.copy(target)
        return out
      }
    }

    const { origin, direction } = this.getControllerRayWorld(controller, this._tmpE, this._tmpF)

    const surfaceMeshes = this.surfaces.map((s) => s.mesh)
    if (surfaceMeshes.length) {
      this.raycaster.ray.origin.copy(origin)
      this.raycaster.ray.direction.copy(direction)
      const hits = this.raycaster.intersectObjects(surfaceMeshes, true)
      const best = typeof this.pickBestSurfaceHit === "function"
        ? this.pickBestSurfaceHit(hits, null)
        : (hits[0] || null)

      if (best?.point) {
        const dist = origin.distanceTo(best.point)
        if (dist <= this.controllerRayMaxLength) {
          out.copy(best.point)
          return out
        }
        out.copy(direction).multiplyScalar(this.controllerRayMaxLength).add(origin)
        return out
      }
    }

    out.copy(origin).add(direction.multiplyScalar(Math.min(this.wireControllerFallbackDist, this.controllerRayMaxLength)))
    return out
  }

  projectPointToControllerRay(controller, point, outProjected = null) {
    const { origin, direction } = this.getControllerRayWorld(controller, this._tmpE, this._tmpF)
    const toPoint = this._tmpG.copy(point).sub(origin)
    const along = toPoint.dot(direction)
    const projected = outProjected || new THREE.Vector3()
    projected.copy(direction).multiplyScalar(Math.max(0, along)).add(origin)
    const perp = projected.distanceTo(point)
    return { along, perp, projected }
  }

  computeControllerHoverFor(controller) {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld)
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

    const hits = this.raycaster.intersectObjects(this.interactables, true)
    for (const h of hits) {
      if (h.distance > this.controllerRayMaxLength) continue
      const picked = this.pickInteractableFromHitObject(h.object)
      if (!picked || !this.interactables.includes(picked) || picked.userData?.isSurface) continue
      if (picked.userData?.isUI) return picked
      if (this.isSimMode() && this.isComponentWithOnPress(picked)) return picked
      if (this.isEditMode() && picked.userData?.componentId && this.isObjectFreeForGrab(picked)) return picked
    }
    return null
  }

  computeControllerHover() {
    for (const c of this.controllers) {
      const b = this.computeControllerHoverFor(c)
      if (b) return b
    }
    return null
  }

  updateControllerRays(visible) {
    for (const r of this.controllerRays) {
      r.line.visible = visible
      r.hitDot.visible = visible
      if (!visible) continue

      const controller = r.controller
      const { origin } = this.getControllerRayWorld(controller, this._tmpE, this._tmpF)
      let dist = this.controllerRayMaxLength

      if (controller.userData?.heldObject) {
        const held = controller.userData.heldObject
        held.getWorldPosition(this._tmpG)
        dist = THREE.MathUtils.clamp(origin.distanceTo(this._tmpG), this.controllerRayMinLength, this.controllerRayMaxLength)
      } else if (this.toolMode === "wire") {
        const hoverBelongsToThisController =
          this.wireHoverSourceType === "controller" &&
          this.wireHoverSourceIndex === (controller.userData?.sourceIndex ?? -1)

        if (hoverBelongsToThisController) {
          const p = this.wireHoverAnchor?.worldPos || this.wireHoverEndpoint?.worldPos
          if (p) dist = THREE.MathUtils.clamp(origin.distanceTo(p), this.controllerRayMinLength, this.controllerRayMaxLength)
        } else {
          const targetPoint = this.getControllerWirePointerWorld(controller, this._tmpG)
          if (targetPoint) dist = THREE.MathUtils.clamp(origin.distanceTo(targetPoint), this.controllerRayMinLength, this.controllerRayMaxLength)
        }
      } else {
        const target = this.computeControllerHoverFor(controller)
        if (target) {
          target.getWorldPosition(this._tmpG)
          dist = THREE.MathUtils.clamp(origin.distanceTo(this._tmpG), this.controllerRayMinLength, this.controllerRayMaxLength)
        }
      }

      r.line.scale.z = dist
      r.hitDot.position.z = -dist
    }
  }

  getJointWorld(hand, name, out) {
    const j = hand.joints?.[name]
    if (!this.isJointTracked(j)) return null
    j.getWorldPosition(out)
    return out
  }

  getIndexTipWorld(he, out) {
    const p = this.getJointWorld(he.hand, "index-finger-tip", out)
    if (p) return p
    he.pinchPoint.getWorldPosition(out)
    return out
  }

  getThumbTipWorld(he, out) {
    const p = this.getJointWorld(he.hand, "thumb-tip", out)
    if (p) return p
    he.pinchPoint.getWorldPosition(out)
    return out
  }

  getGrabPointWorld(he, out) {
    const thumb = this.getThumbTipWorld(he, this._tmpA)
    const index = this.getIndexTipWorld(he, this._tmpB)

    if (thumb && index) {
      out.copy(thumb).lerp(index, 0.72)
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
    he.pinchPoint.getWorldPosition(out)
    return out
  }

  getAllConnectionAnchors() {
    const anchors = []
    if (this.holeSystem) {
      this.holeSystem.updateWorldPositions()
      for (const hole of this.holeSystem.holes) {
        anchors.push({
          kind: "hole",
          id: hole.id,
          label: hole.id,
          worldPos: hole.worldPos.clone(),
          holeId: hole.id,
          groupKey: hole.groupKey
        })
      }
    }
    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId || typeof obj.userData?.getConnectionAnchors !== "function") continue
      for (const a of obj.userData.getConnectionAnchors()) {
        anchors.push({
          kind: a.kind,
          id: a.id,
          label: a.label,
          worldPos: a.worldPos.clone(),
          componentId: obj.userData.componentId,
          componentType: obj.userData.componentType
        })
      }
    }
    return anchors
  }

  findBestWireAnchorForHand(he, maxDist = this.wireHoverMaxDist) {
    if (!he || !this.isHandEntryTracked(he) || he.heldObject) return null
    this.getGrabPointWorld(he, this._tmpC)
    const anchors = this.getAllConnectionAnchors()
    let best = null
    let bestDist = maxDist
    for (const anchor of anchors) {
      const d = anchor.worldPos.distanceTo(this._tmpC)
      if (d > bestDist) continue
      if (!best) {
        best = anchor
        bestDist = d
        continue
      }
      const bp = this.wireAnchorPriority[best.kind] ?? 999
      const cp = this.wireAnchorPriority[anchor.kind] ?? 999
      if (d < bestDist - 0.001) {
        best = anchor
        bestDist = d
      } else if (Math.abs(d - bestDist) <= 0.001 && cp < bp) {
        best = anchor
        bestDist = d
      }
    }
    return best ? {
      ...best,
      distance: bestDist,
      handIndex: he.index,
      sourceType: "hand",
      sourceIndex: he.index
    } : null
  }

  findBestWireAnchorForController(controller, maxPerpDist = this.wireControllerHoverPerpMaxDist) {
    if (!controller || controller.userData?.heldObject) return null
    const anchors = this.getAllConnectionAnchors()
    let best = null
    let bestPerp = maxPerpDist
    let bestAlong = Infinity

    for (const anchor of anchors) {
      const { along, perp } = this.projectPointToControllerRay(controller, anchor.worldPos, this._tmpG)
      if (along < 0.03 || along > this.controllerRayMaxLength) continue
      if (perp > bestPerp) continue

      if (!best) {
        best = anchor
        bestPerp = perp
        bestAlong = along
        continue
      }

      const bp = this.wireAnchorPriority[best.kind] ?? 999
      const cp = this.wireAnchorPriority[anchor.kind] ?? 999

      if (perp < bestPerp - 0.001) {
        best = anchor
        bestPerp = perp
        bestAlong = along
      } else if (Math.abs(perp - bestPerp) <= 0.001) {
        if (cp < bp || (cp === bp && along < bestAlong)) {
          best = anchor
          bestPerp = perp
          bestAlong = along
        }
      }
    }

    return best
      ? {
          ...best,
          distance: bestPerp,
          rayDistance: bestAlong,
          controllerIndex: controller.userData?.sourceIndex ?? 0,
          sourceType: "controller",
          sourceIndex: controller.userData?.sourceIndex ?? 0,
        }
      : null
  }

  ensureWireHoverMarker() {
    if (this._wireHoverMarker) return this._wireHoverMarker
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.0065, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ffff })
    )
    m.name = "WireHoverMarker"
    m.visible = false
    this.scene.add(m)
    this._wireHoverMarker = m
    return m
  }

  clearWireHoverAnchor() {
    this.wireHoverAnchor = null
    this.wireHoverEndpoint = null
    this.wireHoverHandIndex = null
    this.wireHoverSourceType = null
    this.wireHoverSourceIndex = null
    if (this._wireHoverMarker) this._wireHoverMarker.visible = false
  }

  getAllWireEndpoints() {
    const eps = []
    if (!this.stateSyncSystem) return eps
    for (const mesh of this.stateSyncSystem.meshById.values()) {
      if (!mesh?.userData?.isWire) continue
      const sw = this.getWireEndpointWorldPosition(mesh, "start")
      const ew = this.getWireEndpointWorldPosition(mesh, "end")
      if (sw) eps.push({ kind: "wire-endpoint", endpointType: "start", wireId: mesh.userData.componentId, worldPos: sw })
      if (ew) eps.push({ kind: "wire-endpoint", endpointType: "end", wireId: mesh.userData.componentId, worldPos: ew })
    }
    return eps
  }

  findBestWireEndpointForHand(he, maxDist = this.wireEndpointHoverMaxDist) {
    if (!he || !this.isHandEntryTracked(he) || he.heldObject || !this.stateSyncSystem || this.wireDraftStartAnchor) return null
    this.getGrabPointWorld(he, this._tmpC)
    let best = null
    let bestDist = maxDist
    for (const ep of this.getAllWireEndpoints()) {
      const d = ep.worldPos.distanceTo(this._tmpC)
      if (d < bestDist) {
        best = ep
        bestDist = d
      }
    }
    return best ? {
      ...best,
      distance: bestDist,
      handIndex: he.index,
      sourceType: "hand",
      sourceIndex: he.index
    } : null
  }

  findBestWireEndpointForController(controller, maxPerpDist = this.wireControllerEndpointPerpMaxDist) {
    if (!controller || controller.userData?.heldObject || !this.stateSyncSystem || this.wireDraftStartAnchor) return null

    let best = null
    let bestPerp = maxPerpDist
    let bestAlong = Infinity

    for (const ep of this.getAllWireEndpoints()) {
      const { along, perp } = this.projectPointToControllerRay(controller, ep.worldPos, this._tmpG)
      if (along < 0.03 || along > this.controllerRayMaxLength) continue
      if (perp > bestPerp) continue

      if (!best || perp < bestPerp - 0.001 || (Math.abs(perp - bestPerp) <= 0.001 && along < bestAlong)) {
        best = ep
        bestPerp = perp
        bestAlong = along
      }
    }

    return best
      ? {
          ...best,
          distance: bestPerp,
          rayDistance: bestAlong,
          controllerIndex: controller.userData?.sourceIndex ?? 0,
          sourceType: "controller",
          sourceIndex: controller.userData?.sourceIndex ?? 0,
        }
      : null
  }

  updateWireHover() {
    if (this.toolMode !== "wire") {
      this.clearWireHoverAnchor()
      return
    }

    let best = null
    let bestType = null

    if (!this.wireDraftStartAnchor) {
      for (const he of this.hands) {
        const ac = this.findBestWireAnchorForHand(he)
        const ep = this.findBestWireEndpointForHand(he)

        let candidate = null
        let candidateType = null

        if (ac && ep) {
          candidate = ep.distance <= ac.distance ? ep : ac
          candidateType = candidate === ep ? "endpoint" : "anchor"
        } else if (ep) {
          candidate = ep
          candidateType = "endpoint"
        } else if (ac) {
          candidate = ac
          candidateType = "anchor"
        }

        if (candidate && (!best || candidate.distance < best.distance)) {
          best = candidate
          bestType = candidateType
        }
      }

      for (const controller of this.controllers) {
        const ac = this.findBestWireAnchorForController(controller)
        const ep = this.findBestWireEndpointForController(controller)

        let candidate = null
        let candidateType = null

        if (ac && ep) {
          candidate = ep.distance <= ac.distance ? ep : ac
          candidateType = candidate === ep ? "endpoint" : "anchor"
        } else if (ep) {
          candidate = ep
          candidateType = "endpoint"
        } else if (ac) {
          candidate = ac
          candidateType = "anchor"
        }

        if (candidate && (!best || candidate.distance < best.distance)) {
          best = candidate
          bestType = candidateType
        }
      }
    } else {
      if (this.wireDraftSourceType === "hand") {
        const he = this.hands.find((h) => h.index === this.wireDraftSourceIndex)
        const ac = this.findBestWireAnchorForHand(he)
        if (ac) {
          best = ac
          bestType = "anchor"
        }
      } else if (this.wireDraftSourceType === "controller") {
        const controller = this.getControllerByIndex(this.wireDraftSourceIndex)
        const ac = this.findBestWireAnchorForController(controller)
        if (ac) {
          best = ac
          bestType = "anchor"
        }
      }
    }

    if (!best) {
      if (this.wireHoverAnchor || this.wireHoverEndpoint) {
        if (this.wireHoverSourceType === "hand") {
          const th = this.hands.find((h) => h.index === this.wireHoverSourceIndex)
          if (th && this.isHandEntryTracked(th)) {
            this.getGrabPointWorld(th, this._tmpD)
            const tp = this.wireHoverAnchor?.worldPos || this.wireHoverEndpoint?.worldPos
            if (tp && tp.distanceTo(this._tmpD) <= this.wireHoverReleaseDist) {
              const m = this.ensureWireHoverMarker()
              m.position.copy(tp)
              m.visible = true
              return
            }
          }
        } else if (this.wireHoverSourceType === "controller") {
          const controller = this.getControllerByIndex(this.wireHoverSourceIndex)
          if (controller) {
            const tp = this.wireHoverAnchor?.worldPos || this.wireHoverEndpoint?.worldPos
            if (tp) {
              const { perp, along } = this.projectPointToControllerRay(controller, tp, this._tmpG)
              if (along > 0.03 && along <= this.controllerRayMaxLength && perp <= this.wireControllerEndpointPerpMaxDist * 1.6) {
                const m = this.ensureWireHoverMarker()
                m.position.copy(tp)
                m.visible = true
                return
              }
            }
          }
        }
      }

      this.clearWireHoverAnchor()
      return
    }

    this.wireHoverSourceType = best.sourceType ?? null
    this.wireHoverSourceIndex = best.sourceIndex ?? null
    this.wireHoverHandIndex = best.sourceType === "hand" ? best.sourceIndex : null

    if (bestType === "anchor") {
      this.wireHoverAnchor = best
      this.wireHoverEndpoint = null
    } else {
      this.wireHoverAnchor = null
      this.wireHoverEndpoint = best
    }

    const m = this.ensureWireHoverMarker()
    m.position.copy(best.worldPos)
    m.visible = true
  }

  ensureWireDraftMesh(index = 0) {
    if (this._wireDraftMeshes[index]) {
      const m = this._wireDraftMeshes[index]
      if (m.material?.color) m.material.color.setHex(this.wireDraftColor ?? 0x111111)
      return m
    }
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(this.wireDraftRadius, this.wireDraftRadius, 1, 18),
      new THREE.MeshStandardMaterial({
        color: this.wireDraftColor ?? 0x111111,
        roughness: 0.65,
        metalness: 0.0,
        emissive: 0x181818
      })
    )
    mesh.name = `WireDraftMesh_${index}`
    mesh.visible = false
    this.scene.add(mesh)
    this._wireDraftMeshes[index] = mesh
    return mesh
  }

  clearWireDraft() {
    this.wireDraftStartAnchor = null
    this.wireDraftHandIndex = null
    this.wireDraftSourceType = null
    this.wireDraftSourceIndex = null
    this.wireDraftWaypoints = []
    this.wireDraftColor = 0x111111
    for (const m of this._wireDraftMeshes) {
      if (m) m.visible = false
    }
  }

  startWireDraftFromAnchor(anchor, sourceType, sourceIndex) {
    if (!anchor) return
    this.wireDraftStartAnchor = { ...anchor, worldPos: anchor.worldPos.clone() }
    this.wireDraftSourceType = sourceType
    this.wireDraftSourceIndex = sourceIndex
    this.wireDraftHandIndex = sourceType === "hand" ? sourceIndex : null
    this.wireDraftWaypoints = []
    this.wireDraftColor = this.getWireColorFromAnchors(anchor, null)
    const mesh = this.ensureWireDraftMesh(0)
    if (mesh.material?.color) mesh.material.color.setHex(this.wireDraftColor)
    if (mesh.material?.emissive) mesh.material.emissive.setHex(0x181818)
    mesh.visible = true
  }

  canRunWireAction() {
    const now = performance.now()
    if (now - this._lastWireActionMs < this.wireActionCooldownMs) return false
    this._lastWireActionMs = now
    return true
  }

  getWireSourcePointerWorld(sourceType, sourceIndex, out) {
    if (sourceType === "hand") {
      const he = this.hands.find((h) => h.index === sourceIndex)
      if (!he || !this.isHandEntryTracked(he)) return null
      return this.getGrabPointWorld(he, out)
    }

    if (sourceType === "controller") {
      const controller = this.getControllerByIndex(sourceIndex)
      if (!controller) return null
      return this.getControllerWirePointerWorld(controller, out)
    }

    return null
  }

  addWireWaypointFromSource(sourceType, sourceIndex) {
    if (!this.wireDraftStartAnchor || this.wireDraftSourceType !== sourceType || this.wireDraftSourceIndex !== sourceIndex || !this.canRunWireAction()) return false
    const wp = this.getWireSourcePointerWorld(sourceType, sourceIndex, this._tmpA)
    if (!wp) return false
    const np = wp.clone()
    const pts = [this.wireDraftStartAnchor.worldPos, ...this.wireDraftWaypoints]
    if (pts[pts.length - 1].distanceTo(np) < 0.015) return false
    this.wireDraftWaypoints.push(np)
    return true
  }

  getWireDraftPoints(end = null) {
    const pts = []
    if (!this.wireDraftStartAnchor) return pts
    pts.push(this.wireDraftStartAnchor.worldPos.clone())
    for (const p of this.wireDraftWaypoints) pts.push(p.clone())
    if (end) pts.push(end.clone())
    return pts
  }

  updateWireDraftSegment(mesh, start, end) {
    const dir = this._tmpB.copy(end).sub(start)
    const len = dir.length()
    if (len < 0.001) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    const mid = this._tmpC.copy(start).add(end).multiplyScalar(0.5)
    mesh.position.copy(mid)
    dir.normalize()
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    mesh.scale.set(1, len, 1)
  }

  generateComponentId(prefix = "cmp") {
    return globalThis.crypto?.randomUUID
      ? `${prefix}_${globalThis.crypto.randomUUID()}`
      : `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  }

  serializeWireAnchor(a) {
    if (!a) return null
    return {
      kind: a.kind ?? null,
      id: a.id ?? null,
      label: a.label ?? null,
      componentId: a.componentId ?? null,
      componentType: a.componentType ?? null,
      holeId: a.holeId ?? null,
      groupKey: a.groupKey ?? null,
      worldPos: a.worldPos ? { x: a.worldPos.x, y: a.worldPos.y, z: a.worldPos.z } : null,
    }
  }

  isSameWireAnchor(a, b) {
    if (!a || !b || a.kind !== b.kind) return false
    if (a.kind === "hole") return a.holeId === b.holeId
    return a.componentId === b.componentId && a.id === b.id
  }

  getWireColorFromAnchors(s, e) {
    const pick = (a) => {
      if (!a) return null
      if (a.componentType === "battery5v" && a.id === "positive") return 0xff2a2a
      if (a.componentType === "battery5v" && a.id === "negative") return 0x5bc0de
      return null
    }
    return pick(s) ?? pick(e) ?? 0x111111
  }

  finalizeWireDraftToAnchor(endAnchor, sourceType, sourceIndex) {
    if (!endAnchor || !this.wireDraftStartAnchor || !this.stateSyncSystem || !this.canRunWireAction()) return false
    if (this.wireDraftSourceType !== sourceType || this.wireDraftSourceIndex !== sourceIndex) return false
    const sa = this.wireDraftStartAnchor
    if (this.isSameWireAnchor(sa, endAnchor)) return false
    const pts = [sa.worldPos.clone(), ...this.wireDraftWaypoints.map((p) => p.clone()), endAnchor.worldPos.clone()]
    if (pts.length < 2) return false

    const id = this.generateComponentId("wire")
    const wc = this.getWireColorFromAnchors(sa, endAnchor)
    const data = {
      id,
      type: "wire",
      transform: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
      meta: {
        color: wc,
        points: pts.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        startAnchor: this.serializeWireAnchor(sa),
        endAnchor: this.serializeWireAnchor(endAnchor),
      },
    }

    this.appState.addComponent(data)
    this.stateSyncSystem.addMeshFromComponent(data)
    this.clearWireDraft()
    this.clearWireHoverAnchor()

    if (sourceType === "hand") {
      const he = this.hands.find((h) => h.index === sourceIndex)
      if (he) {
        he.isPinching = true
        he.pinchArmed = false
        he.wirePinchCloseMs = 0
      }
    }

    console.log("✅ Cable cerrado")
    return true
  }

  findComponentMeshById(id) {
    return this.stateSyncSystem?.getMeshById(id) ?? null
  }

  resolveAnchorWorldPosition(anchor) {
    if (!anchor) return null
    if (anchor.kind === "hole") {
      if (!this.holeSystem) return null
      this.holeSystem.updateWorldPositions()
      const h = this.holeSystem.holes.find((h) => h.id === anchor.holeId || h.id === anchor.id)
      return h ? h.worldPos.clone() : null
    }
    if (anchor.componentId) {
      const mesh = this.findComponentMeshById(anchor.componentId)
      if (!mesh) return null
      if (anchor.kind === "terminal" && typeof mesh.userData?.getTerminalWorldPositions === "function") {
        const f = mesh.userData.getTerminalWorldPositions().find((t) => t.id === anchor.id)
        return f ? f.worldPos.clone() : null
      }
      if (anchor.kind === "pin" && typeof mesh.userData?.getPinWorldPositions === "function") {
        const f = mesh.userData.getPinWorldPositions().find((p) => p.id === anchor.id)
        return f ? f.worldPos.clone() : null
      }
    }
    if (anchor.worldPos) return new THREE.Vector3(anchor.worldPos.x, anchor.worldPos.y, anchor.worldPos.z)
    return null
  }

  getWireEndpointWorldPosition(wireMesh, type) {
    if (!wireMesh?.userData?.isWire) return null
    const anchor = type === "start" ? wireMesh.userData.startAnchor : wireMesh.userData.endAnchor
    const r = this.resolveAnchorWorldPosition(anchor)
    if (r) return r
    const fp = Array.isArray(wireMesh.userData.fixedPoints) ? wireMesh.userData.fixedPoints : null
    if (!fp || fp.length < 2) return null
    return type === "start" ? fp[0].clone() : fp[fp.length - 1].clone()
  }

  deleteWireById(id) {
    if (!id || !this.stateSyncSystem) return false
    this.appState.removeComponent(id)
    this.stateSyncSystem.removeMeshById(id)
    return true
  }

  reopenWireFromEndEndpoint(ep, sourceType, sourceIndex) {
    if (!ep || ep.endpointType !== "end" || !this.stateSyncSystem) return false
    const wm = this.stateSyncSystem.getMeshById(ep.wireId)
    if (!wm?.userData?.isWire) return false

    const sa = wm.userData.startAnchor
    const fp = Array.isArray(wm.userData.fixedPoints) ? wm.userData.fixedPoints.map((p) => p.clone()) : []
    if (!sa || fp.length < 2) return false

    this.deleteWireById(ep.wireId)
    this.wireDraftStartAnchor = { ...sa, worldPos: this.resolveAnchorWorldPosition(sa) || fp[0].clone() }
    this.wireDraftSourceType = sourceType
    this.wireDraftSourceIndex = sourceIndex
    this.wireDraftHandIndex = sourceType === "hand" ? sourceIndex : null
    this.wireDraftWaypoints = fp.slice(1, -1)
    this.wireDraftColor = wm.userData.wireColor ?? 0x111111

    const mesh = this.ensureWireDraftMesh(0)
    if (mesh.material?.color) mesh.material.color.setHex(this.wireDraftColor)
    mesh.visible = true

    this.clearWireHoverAnchor()

    if (sourceType === "hand") {
      const he = this.hands.find((h) => h.index === sourceIndex)
      if (he) {
        he.isPinching = true
        he.pinchArmed = false
        he.wirePinchCloseMs = 0
      }
    }

    return true
  }

  updateDynamicWires() {
    if (!this.stateSyncSystem) return
    for (const mesh of this.stateSyncSystem.meshById.values()) {
      if (!mesh?.userData?.isWire || typeof mesh.userData?.rebuildWireGeometry !== "function") continue
      const fp = Array.isArray(mesh.userData.fixedPoints) ? mesh.userData.fixedPoints.map((p) => p.clone()) : []
      if (fp.length < 2) continue
      const sw = this.resolveAnchorWorldPosition(mesh.userData.startAnchor)
      const ew = this.resolveAnchorWorldPosition(mesh.userData.endAnchor)
      if (sw) fp[0] = sw
      if (ew) fp[fp.length - 1] = ew
      mesh.userData.rebuildWireGeometry(fp)
    }
  }

  updateHandHeldObjectPose(he) {
    if (!he?.heldObject) return
    if (!this.isHandEntryTracked(he)) return

    const obj = he.heldObject

    this.getBestHandProbePointWorld(he, obj, this._tmpA)

    obj.localToWorld(this._tmpB.copy(he.hold.grabLocalPoint))
    this._tmpC.copy(this._tmpA).sub(this._tmpB)

    obj.position.add(this._tmpC)
    obj.updateMatrixWorld(true)
  }

  updateWireDraftPreview() {
    if (this.toolMode !== "wire") {
      this.clearWireDraft()
      return
    }

    if (!this.wireDraftStartAnchor) {
      for (const m of this._wireDraftMeshes) {
        if (m) m.visible = false
      }
      return
    }

    const end = this.getWireSourcePointerWorld(this.wireDraftSourceType, this.wireDraftSourceIndex, this._tmpA)
    if (!end) {
      for (const m of this._wireDraftMeshes) {
        if (m) m.visible = false
      }
      return
    }

    const pts = this.getWireDraftPoints(end.clone())
    if (pts.length < 2) {
      for (const m of this._wireDraftMeshes) {
        if (m) m.visible = false
      }
      return
    }

    const needed = pts.length - 1
    for (let i = 0; i < needed; i++) {
      this.updateWireDraftSegment(this.ensureWireDraftMesh(i), pts[i], pts[i + 1])
    }
    for (let i = needed; i < this._wireDraftMeshes.length; i++) {
      const m = this._wireDraftMeshes[i]
      if (m) m.visible = false
    }
  }

  updateUIPoke() {
    if (this.hands.some((h) => h.heldObject)) return

    for (const [handIndex, pressed] of this._handHeldButton.entries()) {
      const he = this.hands.find((h) => h.index === handIndex)
      if (!he || !this.isHandEntryTracked(he)) {
        if (typeof pressed.userData?.releaseButton === "function") pressed.userData.releaseButton()
        this._handHeldButton.delete(handIndex)
        continue
      }
      this.getIndexTipWorld(he, this._tmpA)
      if (this.distanceToObjectSurface(pressed, this._tmpA) > this.uiReleaseRadius) {
        if (typeof pressed.userData?.releaseButton === "function") pressed.userData.releaseButton()
        this._handHeldButton.delete(handIndex)
      }
    }

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

    let bestObj = null
    let bestDist = this.uiPokeRadius
    let bestHand = null

    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h) || h.heldObject) continue
      if (this._handHeldButton.has(h.index)) continue
      this.getIndexTipWorld(h, this._tmpA)

      for (const obj of this.interactables) {
        if (obj.userData?.isSurface) continue

        if (obj.userData?.isUI) {
          const d = this.distanceToObjectSurface(obj, this._tmpA)
          if (d < bestDist) {
            bestDist = d
            bestObj = obj
            bestHand = h
          }
          continue
        }

        if (this.isSimMode() && this.isComponentWithOnPress(obj)) {
          const d = this.distanceToObjectSurface(obj, this._tmpA)
          if (d < bestDist) {
            bestDist = d
            bestObj = obj
            bestHand = h
          }
        }
      }
    }

    if (!bestObj || !bestHand) return

    if (bestObj.userData?.isUI) {
      if (typeof bestObj.userData?.onPress === "function") {
        bestObj.userData.onPress()
        this._lastPokedButton = bestObj
      }
    } else if (this.isSimMode()) {
      if (bestObj.userData?.isButtonComponent) {
        if (typeof bestObj.userData?.pressButton === "function") {
          bestObj.userData.pressButton()
          this._handHeldButton.set(bestHand.index, bestObj)
        }
      } else if (bestObj.userData?.isSwitchComponent) {
        if (typeof bestObj.userData?.onPress === "function") {
          bestObj.userData.onPress()
          this._lastPokedButton = bestObj
        }
      }
    }
  }

  computePinchDistance(hand) {
    const tt = this.getJointWorld(hand, "thumb-tip", this._tmpA)
    if (!tt) return null
    let best = Infinity
    for (const name of ["index-finger-tip", "index-finger-phalanx-distal", "index-finger-phalanx-intermediate"]) {
      const p = this.getJointWorld(hand, name, this._tmpB)
      if (p) {
        const d = tt.distanceTo(p)
        if (d < best) best = d
      }
    }
    return isFinite(best) ? best : null
  }

  canHandGrabObject(he, obj) {
    if (!obj?.userData?.componentId || !this.isObjectFreeForGrab(obj)) return false

    const inserted = !!obj.userData?.inserted || !!obj.userData?.pinConnections
    const busyOffset = this.isAnyOtherHandHolding(he) ? 0.006 : 0.0
    const baseBoxMargin = this.handGrabExpandedBoxMargin + busyOffset
    const baseSphereMargin = this.handGrabExpandedSphereMargin + busyOffset

    this.getBestHandProbePointWorld(he, obj, this._tmpC)
    const { grabD, sd, cd, ed, sphereD, adaptiveBoxMargin } = this.getGrabCandidateScore(obj, this._tmpC, baseBoxMargin, baseSphereMargin)

    const centerLimit = this.nearRadius + adaptiveBoxMargin * 1.1 + (inserted ? this.insertedGrabBonusRadius : 0)
    if (cd > centerLimit && ed > 0.0001 && sphereD > 0.0001) return false
    if (grabD > this.handGrabSurfaceMaxDist && ed > 0.0001 && sphereD > 0.0001 && sd > this.handGrabSurfaceMaxDist + this.handGrabSurfaceSlack) return false

    return true
  }

  findNearestComponentToHand(he, maxDist) {
    let best = null
    let bestScore = Infinity

    const busyOffset = this.isAnyOtherHandHolding(he) ? 0.006 : 0.0
    const baseBoxMargin = this.handGrabExpandedBoxMargin + busyOffset
    const baseSphereMargin = this.handGrabExpandedSphereMargin + busyOffset

    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId || !this.isObjectFreeForGrab(obj)) continue

      this.getBestHandProbePointWorld(he, obj, this._tmpC)

      const inserted = !!obj.userData?.inserted || !!obj.userData?.pinConnections
      const { grabD, cd, ed, sphereD, adaptiveBoxMargin, score } = this.getGrabCandidateScore(obj, this._tmpC, baseBoxMargin, baseSphereMargin)
      const centerLimit = maxDist + adaptiveBoxMargin * 1.1 + (inserted ? this.insertedGrabBonusRadius : 0)

      if (cd > centerLimit && ed > 0.0001 && sphereD > 0.0001) continue
      if (grabD > this.handGrabSurfaceMaxDist && ed > 0.0001 && sphereD > 0.0001) continue

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
      transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }
    })
  }

  startHoldTracking(hs, sourceType, source) {
    hs.active = true
    hs.sourceType = sourceType
    hs.source = source
    hs.lastT = performance.now()
    hs.vel.set(0, 0, 0)
    hs.samples.length = 0
    hs.grabOffset.set(0, 0, 0)
    hs.grabLocalPoint.set(0, 0, 0)
    hs.holdDistance = 0

    if (sourceType === "controller") source.getWorldPosition(hs.lastPos)
    else this.getGrabPointWorld(source, hs.lastPos)
  }

  stopHoldTracking(hs) {
    hs.active = false
    hs.sourceType = null
    hs.source = null
    hs.lastT = 0
    hs.vel.set(0, 0, 0)
    hs.samples.length = 0
    hs.grabOffset.set(0, 0, 0)
    hs.grabLocalPoint.set(0, 0, 0)
    hs.holdDistance = 0
  }

  updateHoldVelocity(hs) {
    if (!hs?.active || !hs.sourceType || !hs.source) return
    const now = performance.now()
    const dt = (now - hs.lastT) / 1000
    if (dt <= 0.0001) return
    if (hs.sourceType === "controller") hs.source.getWorldPosition(this._tmpA)
    else this.getGrabPointWorld(hs.source, this._tmpA)
    const v = this._tmpA.clone().sub(hs.lastPos).multiplyScalar(1 / dt)
    hs.samples.push({ v, t: now })
    while (hs.samples.length > hs.maxSamples) hs.samples.shift()
    const minT = now - hs.sampleWindowMs
    while (hs.samples.length && hs.samples[0].t < minT) hs.samples.shift()
    if (hs.samples.length) {
      hs.vel.set(0, 0, 0)
      for (const s of hs.samples) hs.vel.add(s.v)
      hs.vel.multiplyScalar(1 / hs.samples.length)
    } else {
      hs.vel.copy(v)
    }
    hs.lastPos.copy(this._tmpA)
    hs.lastT = now
  }

  getReleaseVelocity(hs, forceZero = false) {
    if (forceZero) return new THREE.Vector3()
    const v = hs.vel.clone().multiplyScalar(this.throwVelocityMultiplier)
    if (v.length() < this.throwMinSpeed) v.set(0, 0, 0)
    return v
  }

  getBestSurfaceBelow(object) {
    if (!object || this.surfaces.length === 0) return null
    const origin = object.position.clone()
    origin.y += 2
    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))
    const disallowed = Array.isArray(object.userData?.surfaceDisallowedTypes) ? object.userData.surfaceDisallowedTypes : []
    const entries = this.surfaces.filter((s) => !disallowed.includes(s.type))
    if (!entries.length) return null
    const hits = this.downRaycaster.intersectObjects(entries.map((s) => s.mesh), true)
    return hits.length ? this.pickBestSurfaceHit(hits, object) : null
  }

  resolveSurfacePenetration(object) {
    if (!object || !this.surfaces.length) return false
    const best = this.getBestSurfaceBelow(object)
    if (!best) return false
    const co = object.userData?.surfaceContactObject || object
    this._box.setFromObject(co)
    this._box.getSize(this._tmpSize)
    const center = new THREE.Vector3()
    this._box.getCenter(center)
    const halfY = this._tmpSize.y * 0.5
    if (center.y - halfY < best.point.y) {
      object.position.y += (best.point.y + halfY - center.y) + 0.001
      if (object.userData?.surfaceUpright) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).setY(0)
        let yaw = object.rotation.y
        if (fwd.lengthSq() > 1e-8) {
          fwd.normalize()
          yaw = Math.atan2(fwd.x, fwd.z)
        }
        object.rotation.set(0, yaw, 0)
        object.updateMatrixWorld(true)
      }
      return true
    }
    return false
  }

  trySnapComponentPinsToHoles(object, maxDist = 0.05) {
    if (!object || !this.holeSystem || !object.userData?.getPinWorldPositions) return false
    if (!Array.isArray(object.userData?.pins) || !object.userData.pins.length) return false
    const pwp = object.userData.getPinWorldPositions()
    const matches = this.holeSystem.getNearestHolesForPins(pwp, maxDist)
    if (!matches?.length) return false
    const valid = matches.filter((m) => !!m.hole)
    if (valid.length !== object.userData.pins.length) return false
    const [pinA, pinB] = [object.userData.pins[0], object.userData.pins[1]]
    if (!pinA || !pinB) return false
    const mA = valid.find((m) => m.pinId === pinA.id)
    const mB = valid.find((m) => m.pinId === pinB.id)
    if (!mA || !mB) return false
    object.userData.pinConnections = { [pinA.id]: mA.hole.id, [pinB.id]: mB.hole.id }
    const dir = new THREE.Vector3().subVectors(mB.hole.worldPos, mA.hole.worldPos).setY(0)
    if (dir.lengthSq() < 1e-8) return false
    dir.normalize()
    object.rotation.set(0, Math.atan2(-dir.z, dir.x), 0)
    object.updateMatrixWorld(true)
    const rpAW = new THREE.Vector3().copy(pinA.localPos)
    object.localToWorld(rpAW)
    object.position.add(new THREE.Vector3().subVectors(mA.hole.worldPos, rpAW))
    object.position.y -= 0.02
    object.updateMatrixWorld(true)
    const id = object.userData?.componentId
    if (id) this.appState.updateComponent(id, {
      inserted: true,
      pinConnections: { [pinA.id]: mA.hole.id, [pinB.id]: mB.hole.id }
    })
    this.persistMeshTransform(object)
    return true
  }

  tryPlaceObjectDirectly(object) {
    if (!object) return false
    const best = this.getBestSurfaceBelow(object)
    if (!best) return false
    if (object.userData?.surfaceUpright) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).setY(0)
      let yaw = object.rotation.y
      if (fwd.lengthSq() > 1e-8) {
        fwd.normalize()
        yaw = Math.atan2(fwd.x, fwd.z)
      }
      object.rotation.set(0, yaw, 0)
      object.updateMatrixWorld(true)
    }
    const co = object.userData?.surfaceContactObject || object
    const bbox = new THREE.Box3().setFromObject(co)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    bbox.getSize(size)
    bbox.getCenter(center)
    const halfY = size.y * 0.5
    const drop = (center.y - halfY) - best.point.y
    if (drop < -0.03 || drop > this.directPlaceMaxDrop) return false
    object.position.y += (best.point.y + halfY - center.y)
    if (this.holeSystem && Array.isArray(object.userData?.pins)) this.holeSystem.trySnapObject(object, 0.03)
    this.persistMeshTransform(object)
    return true
  }

  releaseHeldObject(object, hs, clearOwner, options = {}) {
    if (!object) return
    this.updateHoldVelocity(hs)
    const vel = this.getReleaseVelocity(hs, options.forceZeroVelocity ?? false)
    this.scene.attach(object)
    this.clearObjectOwner(object)
    this.resolveSurfacePenetration(object)
    if (this.trySnapComponentPinsToHoles(object, 0.05)) {
      object.userData.physics = null
      clearOwner()
      this.stopHoldTracking(hs)
      this.clearActivePinHoleMarkers()
      return
    }
    if (vel.lengthSq() === 0 && this.tryPlaceObjectDirectly(object)) {
      clearOwner()
      this.stopHoldTracking(hs)
      this.clearActivePinHoleMarkers()
      return
    }
    object.userData.physics = { active: true, vel }
    clearOwner()
    this.stopHoldTracking(hs)
    this.clearActivePinHoleMarkers()
  }

  onHandPinchStart(he) {
    if (!this.isHandEntryTracked(he) || he.heldObject || !he.pinchArmed) return
    he.isPinching = true
    he.pinchArmed = false
    he.lostTrackingMs = 0
    he.openPinchMs = 0

    if (this.toolMode === "wire") {
      const hoverMatchesThisHand =
        this.wireHoverSourceType === "hand" &&
        this.wireHoverSourceIndex === he.index

      const hA = !!this.wireHoverAnchor && hoverMatchesThisHand
      const hE = !!this.wireHoverEndpoint && hoverMatchesThisHand

      if (!this.wireDraftStartAnchor) {
        if (hE) {
          if (!this.canRunWireAction()) return
          if (this.wireHoverEndpoint.endpointType === "start") {
            const d = this.deleteWireById(this.wireHoverEndpoint.wireId)
            if (d) {
              he.isPinching = true
              he.pinchArmed = false
              he.wirePinchCloseMs = 0
              this.clearWireHoverAnchor()
            }
            return
          }
          if (this.wireHoverEndpoint.endpointType === "end") {
            this.reopenWireFromEndEndpoint(this.wireHoverEndpoint, "hand", he.index)
            return
          }
        }
        if (hA && this.canRunWireAction()) {
          this.startWireDraftFromAnchor(this.wireHoverAnchor, "hand", he.index)
          console.log("🟢 Punto A:", this.wireHoverAnchor)
        }
        return
      }

      if (this.wireDraftSourceType !== "hand" || this.wireDraftSourceIndex !== he.index) return

      if (hA) {
        const c = this.finalizeWireDraftToAnchor(this.wireHoverAnchor, "hand", he.index)
        if (c) console.log("🔌 Punto B:", this.wireHoverAnchor)
      } else {
        const a = this.addWireWaypointFromSource("hand", he.index)
        if (a) console.log("〰️ Waypoint")
      }
      return
    }

    if (this.isSimMode()) return

    const target = this.findNearestComponentToHand(he, this.nearRadius)
    if (!target || !this.canHandGrabObject(he, target)) return

    if (target.userData?.inserted || target.userData?.pinConnections) {
      target.userData.inserted = false
      target.userData.pinConnections = null
      const id = target.userData?.componentId
      if (id) this.appState.updateComponent(id, { inserted: false, pinConnections: null })
    }

    he.heldObject = target
    target.userData.physics = null
    this.setObjectOwner(target, this.makeOwnerToken("hand", he.index))
    this.startHoldTracking(he.hold, "hand", he)

    this.getBestHandProbePointWorld(he, target, this._tmpA)
    this.getClosestGrabPointWorld(target, this._tmpA, this._tmpB)

    target.worldToLocal(this._tmpC.copy(this._tmpB))
    he.hold.grabLocalPoint.copy(this._tmpC)

    target.localToWorld(this._tmpD.copy(he.hold.grabLocalPoint))
    he.hold.grabOffset.copy(this._tmpD).sub(this._tmpA)

    this.getObjectGrabCenterWorld(target, this._tmpE)
    he.hold.holdDistance = this._tmpE.distanceTo(this._tmpA)
  }

  onHandPinchEnd(he, options = {}) {
    if (!he) return
    he.isPinching = false
    he.openPinchMs = 0
    he.lostTrackingMs = 0
    if (this.toolMode === "wire" || !he.heldObject) return
    this.releaseHeldObject(he.heldObject, he.hold, () => { he.heldObject = null }, options)
  }

  forceReleaseHand(he, forceZero = true) {
    if (!he) return
    he.isPinching = false
    he.openPinchMs = 0
    he.lostTrackingMs = 0
    if (this.toolMode === "wire") {
      this.stopHoldTracking(he.hold)
      return
    }
    if (!he.heldObject) {
      this.stopHoldTracking(he.hold)
      return
    }
    this.onHandPinchEnd(he, { forceZeroVelocity: forceZero })
  }

  onControllerSelectStart(event) {
    const ctrl = event.target
    if (!ctrl || ctrl.userData?.heldObject) return

    const target = this.computeControllerHoverFor(ctrl)

    if (target?.userData?.isUI && typeof target.userData?.onPress === "function") {
      target.userData.onPress()
      return
    }

    if (this.toolMode === "wire") {
      const ctrlIndex = ctrl.userData?.sourceIndex ?? 0
      const hoverMatchesThisController =
        this.wireHoverSourceType === "controller" &&
        this.wireHoverSourceIndex === ctrlIndex

      const hA = !!this.wireHoverAnchor && hoverMatchesThisController
      const hE = !!this.wireHoverEndpoint && hoverMatchesThisController

      if (!this.wireDraftStartAnchor) {
        if (hE) {
          if (!this.canRunWireAction()) return
          if (this.wireHoverEndpoint.endpointType === "start") {
            const d = this.deleteWireById(this.wireHoverEndpoint.wireId)
            if (d) this.clearWireHoverAnchor()
            return
          }
          if (this.wireHoverEndpoint.endpointType === "end") {
            this.reopenWireFromEndEndpoint(this.wireHoverEndpoint, "controller", ctrlIndex)
            return
          }
        }

        if (hA && this.canRunWireAction()) {
          this.startWireDraftFromAnchor(this.wireHoverAnchor, "controller", ctrlIndex)
          console.log("🟢 Punto A:", this.wireHoverAnchor)
        }
        return
      }

      if (this.wireDraftSourceType !== "controller" || this.wireDraftSourceIndex !== ctrlIndex) return

      if (hA) {
        const c = this.finalizeWireDraftToAnchor(this.wireHoverAnchor, "controller", ctrlIndex)
        if (c) console.log("🔌 Punto B:", this.wireHoverAnchor)
      } else {
        const a = this.addWireWaypointFromSource("controller", ctrlIndex)
        if (a) console.log("〰️ Waypoint")
      }
      return
    }

    if (!target || target.userData?.isSurface) return

    if (this.isSimMode()) {
      if (target.userData?.isButtonComponent && typeof target.userData?.pressButton === "function") {
        target.userData.pressButton()
        ctrl.userData._pressedComponent = target
        return
      }
      if (target.userData?.isSwitchComponent && typeof target.userData?.onPress === "function") {
        target.userData.onPress()
        return
      }
      return
    }

    if (!target.userData?.componentId || !this.isObjectFreeForGrab(target)) return
    if (target.userData?.inserted || target.userData?.pinConnections) {
      target.userData.inserted = false
      target.userData.pinConnections = null
      const id = target.userData?.componentId
      if (id) this.appState.updateComponent(id, { inserted: false, pinConnections: null })
    }

    target.userData.physics = null
    ctrl.userData.heldObject = target
    this.setObjectOwner(target, this.makeOwnerToken("controller", ctrl.userData.sourceIndex ?? 0))
    this.startHoldTracking(ctrl.userData.hold, "controller", ctrl)
    ctrl.attach(target)
  }

  onControllerSelectEnd(event) {
    const ctrl = event?.target
    if (!ctrl) return
    if (ctrl.userData?._pressedComponent) {
      if (typeof ctrl.userData._pressedComponent.userData?.releaseButton === "function") {
        ctrl.userData._pressedComponent.userData.releaseButton()
      }
      ctrl.userData._pressedComponent = null
      return
    }
    if (!ctrl.userData?.heldObject) return
    this.releaseHeldObject(ctrl.userData.heldObject, ctrl.userData.hold, () => { ctrl.userData.heldObject = null })
  }

  pickBestSurfaceHit(hits, object = null) {
    const getEntry = (hitObj) => {
      for (const s of this.surfaces) {
        let cur = hitObj
        while (cur) {
          if (cur === s.mesh) return s
          cur = cur.parent
        }
      }
      return null
    }
    const disallowed = Array.isArray(object?.userData?.surfaceDisallowedTypes) ? object.userData.surfaceDisallowedTypes : []
    const filtered = hits.filter((h) => {
      const s = getEntry(h.object)
      return s && !disallowed.includes(s.type)
    })
    for (const priority of ["protoboard", "table", "floor"]) {
      const h = filtered.find((h) => getEntry(h.object)?.type === priority)
      if (h) return { ...h, surface: getEntry(h.object) }
    }
    const h = filtered[0]
    return h ? { ...h, surface: getEntry(h.object) } : null
  }

  computeHandHover() {
    if (!this.nearEnabled) return null
    let best = null
    let bestScore = Infinity

    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h) || h.heldObject) continue

      for (const obj of this.interactables) {
        if (!obj || obj.userData?.isSurface) continue
        if (obj.userData?.componentId && !this.isObjectFreeForGrab(obj)) continue

        if (obj.userData?.isUI) {
          this.getIndexTipWorld(h, this._tmpA)
          const d = this.distanceToObjectSurface(obj, this._tmpA)
          if (d < bestScore && d < this.uiPokeRadius * 2) {
            bestScore = d
            best = obj
          }
          continue
        }

        this.getBestHandProbePointWorld(h, obj, this._tmpA)
        const { grabD, cd, ed, sphereD, adaptiveBoxMargin, inserted, score } = this.getGrabCandidateScore(
          obj,
          this._tmpA,
          this.handHoverExpandedBoxMargin,
          this.handHoverExpandedSphereMargin
        )

        const centerLimit = this.nearRadius + adaptiveBoxMargin * 1.1 + (inserted ? this.insertedGrabBonusRadius : 0)
        if (cd > centerLimit && ed > 0.0001 && sphereD > 0.0001) continue
        if (grabD > this.handHoverSurfaceMaxDist && ed > 0.0001 && sphereD > 0.0001) continue

        if (score < bestScore) {
          bestScore = score
          best = obj
        }
      }
    }

    return best
  }

  updateHeldObjects() {
    let active = null

    for (const h of this.hands) {
      if (h.heldObject) {
        this.updateHandHeldObjectPose(h)
        this.updateHoldVelocity(h.hold)
        active = h.heldObject
      }
    }

    for (const c of this.controllers) {
      if (c.userData?.heldObject) {
        this.updateHoldVelocity(c.userData.hold)
        active = c.userData.heldObject
      }
    }

    if (active) this.updatePinHoleMarkersForHeldObject(active)
    else this.clearActivePinHoleMarkers()
  }

  cleanupDetachedHolds() {
    for (const h of this.hands) {
      if (h.heldObject && this.getObjectOwner(h.heldObject) !== this.makeOwnerToken("hand", h.index)) {
        h.heldObject = null
        h.isPinching = false
        h.openPinchMs = 0
        h.lostTrackingMs = 0
        this.stopHoldTracking(h.hold)
      }
    }

    for (const c of this.controllers) {
      if (c.userData?.heldObject && this.getObjectOwner(c.userData.heldObject) !== this.makeOwnerToken("controller", c.userData.sourceIndex ?? 0)) {
        c.userData.heldObject = null
        this.stopHoldTracking(c.userData.hold)
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
      if (dist >= this.pinchReleaseResetDist) h.pinchArmed = true

      if (this.toolMode === "wire") {
        const hoveringThisHand =
          this.wireHoverSourceType === "hand" &&
          this.wireHoverSourceIndex === h.index

        const hAH = !!this.wireHoverAnchor && hoveringThisHand
        const hEH = !!this.wireHoverEndpoint && hoveringThisHand
        const hasDH = !!this.wireDraftStartAnchor && this.wireDraftSourceType === "hand" && this.wireDraftSourceIndex === h.index

        const tt = this.getJointWorld(h.hand, "thumb-tip", this._tmpE)
        const it = this.getJointWorld(h.hand, "index-finger-tip", this._tmpF)
        let wd = Infinity
        if (tt && it) wd = tt.distanceTo(it)
        const close = wd <= this.wirePinchStartDist
        const open = wd >= this.wirePinchEndDist
        if (open) {
          h.isPinching = false
          h.pinchArmed = true
          h.wirePinchCloseMs = 0
        }
        const canAcc = close && h.pinchArmed && !h.isPinching && (((hAH || hEH) && hoveringThisHand) || hasDH)
        h.wirePinchCloseMs = canAcc ? h.wirePinchCloseMs + dtMs : 0
        if (h.pinchArmed && !h.isPinching && canAcc) {
          h.wirePinchCloseMs = 0
          this.onHandPinchStart(h)
        }
        continue
      }

      if (h.heldObject) {
        if (dist >= this.pinchEndDist) {
          h.openPinchMs += dtMs
          if (h.openPinchMs >= this.handOpenReleaseGraceMs) this.onHandPinchEnd(h)
        } else {
          h.openPinchMs = 0
          h.isPinching = true
        }
        continue
      }

      h.openPinchMs = 0
      if (this.isSimMode()) {
        h.isPinching = false
        continue
      }
      if (dist <= this.pinchStartDist && h.pinchArmed) this.onHandPinchStart(h)
      else if (dist > this.pinchEndDist) h.isPinching = false
    }
  }

  clearActivePinHoleMarkers() {
    for (const m of this._activePinHoleMarkers) {
      if (m?.parent) m.parent.remove(m)
    }
    this._activePinHoleMarkers.length = 0
  }

  updatePinHoleMarkersForHeldObject(object) {
    this.clearActivePinHoleMarkers()
    if (!object || !this.holeSystem || !object.userData?.getPinWorldPositions) return
    for (const match of this.holeSystem.getNearestHolesForPins(object.userData.getPinWorldPositions(), 0.05)) {
      if (!match.hole) continue
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.0075, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      )
      m.position.copy(match.hole.worldPos)
      this.scene.add(m)
      this._activePinHoleMarkers.push(m)
    }
  }

  update() {
    const xrPresenting = this.renderer.xr.isPresenting

    if (!xrPresenting) {
      this.cleanupDetachedHolds()
      this.updateDynamicWires()
      this.clearActivePinHoleMarkers()
      this.setHover(null)
      return
    }

    const now = performance.now()
    const dtMs = Math.min(50, now - this._lastUpdateTime)
    this._lastUpdateTime = now

    const handsActive = this.isHandTrackingActive()
    const showControllerRays = !handsActive
    this.updateControllerRays(showControllerRays)

    if (handsActive) {
      this.updateUIPoke()
      this.updateHandPinchState(dtMs)
      this.updateWireHover()
      this.updateWireDraftPreview()
    } else {
      this.updateWireHover()
      this.updateWireDraftPreview()
      for (const h of this.hands) {
        this.forceReleaseHand(h, true)
        h.pinchArmed = true
      }
    }

    this.cleanupDetachedHolds()
    this.updateHeldObjects()
    this.updateDynamicWires()

    if (this.toolMode === "wire") {
      this.setHover(null)
      return
    }

    const anyHeld = this.hands.some((h) => !!h.heldObject) || this.controllers.some((c) => !!c.userData?.heldObject)
    if (anyHeld) {
      this.setHover(null)
      return
    }

    this.setHover(handsActive ? this.computeHandHover() : this.computeControllerHover())
  }
}