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

    this.nearEnabled = true

    this.nearRadius = 0.145

    this.handGrabSurfaceMaxDist = 0.050
    this.handGrabSurfaceSlack = 0.030
    this.handHoverSurfaceMaxDist = 0.065

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

    // ---------------------------
    // Wire mode
    // ---------------------------
    this.toolMode = "grab"
    this.wireHoverAnchor = null
    this.wireHoverEndpoint = null
    this.wireHoverHandIndex = null
    this._wireHoverMarker = null

    this.wireHoverMaxDist = 0.055
    this.wireHoverReleaseDist = 0.085
    this.wireEndpointHoverMaxDist = 0.020

    this.wirePinchStartDist = 0.016
    this.wirePinchEndDist = 0.030

    // Radio 3D para terminales y pines
    this.wireControllerAnchorRadius = 0.055
    // Radio XZ para holes (ignora diferencia de altura por ángulo del ray)
    this.wireControllerHoleRadiusXZ = 0.025

    this.wireAnchorPriority = {
      terminal: 0,
      pin: 1,
      hole: 2,
    }

    this.wireDraftStartAnchor = null
    this.wireDraftOwner = null
    this.wireDraftWaypoints = []
    this.wireDraftColor = 0x111111
    this._wireDraftMeshes = []
    this.wireDraftRadius = 0.0038

    this._controllerWireHover = null

    this.wireActionCooldownMs = 90
    this._lastWireActionMs = 0

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

  setStateSyncSystem(stateSyncSystem) {
    this.stateSyncSystem = stateSyncSystem
  }

  setToolMode(mode = "grab") {
    const nextMode = mode === "wire" ? "wire" : "grab"
    if (this.toolMode === nextMode) return

    this.toolMode = nextMode

    if (this.toolMode !== "wire") {
      this.clearWireHoverAnchor()
      this.clearWireDraft()
      this._controllerWireHover = null
    }
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

      if (picked.userData?.isUI) { best = picked; break }
      if (picked.userData?.componentId && this.isObjectFreeForGrab(picked)) { best = picked; break }
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

  updateControllerRays(handsActive) {
    for (const r of this.controllerRays) {
      if (handsActive) {
        r.line.visible = false
        r.hitDot.visible = false
        continue
      }

      r.line.visible = true
      r.hitDot.visible = true

      const controller = r.controller
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)
      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      let dist = 5

      if (this.toolMode === "wire") {
        const allMeshes = [
          ...this.interactables,
          ...this.surfaces.map((s) => s.mesh),
        ]
        const hits = this.raycaster.intersectObjects(allMeshes, true)
        if (hits.length > 0) dist = Math.min(5, Math.max(0.05, hits[0].distance))
      } else {
        const hits = this.raycaster.intersectObjects(this.interactables, true)
        for (const h of hits) {
          const picked = this.pickInteractableFromHitObject(h.object)
          if (!picked) continue
          if (picked.userData?.isUI || this.isObjectFreeForGrab(picked)) {
            dist = Math.min(5, Math.max(0.05, h.distance))
            break
          }
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

    if (thumb && index) { out.copy(thumb).add(index).multiplyScalar(0.5); return out }
    if (index) { out.copy(index); return out }
    if (thumb) { out.copy(thumb); return out }

    handEntry.pinchPoint.getWorldPosition(out)
    return out
  }

  getControllerRayHitPoint(controller, out) {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld)
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

    const allMeshes = [
      ...this.interactables,
      ...this.surfaces.map((s) => s.mesh),
    ]

    const hits = this.raycaster.intersectObjects(allMeshes, true)

    if (hits.length > 0) {
      out.copy(hits[0].point)
      return true
    }

    out.copy(this.raycaster.ray.direction).multiplyScalar(0.6).add(this.raycaster.ray.origin)
    return false
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
          groupKey: hole.groupKey,
        })
      }
    }

    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId) continue
      if (typeof obj.userData?.getConnectionAnchors !== "function") continue

      const componentAnchors = obj.userData.getConnectionAnchors()
      for (const anchor of componentAnchors) {
        anchors.push({
          kind: anchor.kind,
          id: anchor.id,
          label: anchor.label,
          worldPos: anchor.worldPos.clone(),
          componentId: obj.userData.componentId,
          componentType: obj.userData.componentType,
        })
      }
    }

    return anchors
  }

  findBestAnchorNearPoint(point, maxDist3D, maxDistXZForHoles = this.wireControllerHoleRadiusXZ) {
    const anchors = this.getAllConnectionAnchors()
    let best = null
    let bestScore = Infinity

    for (const anchor of anchors) {
      let dist

      if (anchor.kind === "hole") {
        const dx = anchor.worldPos.x - point.x
        const dz = anchor.worldPos.z - point.z
        dist = Math.sqrt(dx * dx + dz * dz)
        if (dist > maxDistXZForHoles) continue
      } else {
        dist = anchor.worldPos.distanceTo(point)
        if (dist > maxDist3D) continue
      }

      const priority = this.wireAnchorPriority[anchor.kind] ?? 999
      const score = priority * 1000 + dist

      if (score < bestScore) {
        bestScore = score
        best = { ...anchor, distance: dist }
      }
    }

    return best || null
  }

  findBestEndpointNearPoint(point, maxDist) {
    if (!this.stateSyncSystem) return null
    if (this.wireDraftOwner !== null) return null

    const endpoints = this.getAllWireEndpoints()
    let best = null
    let bestDist = maxDist

    for (const endpoint of endpoints) {
      const d = endpoint.worldPos.distanceTo(point)
      if (d > bestDist) continue
      best = endpoint
      bestDist = d
    }

    return best ? { ...best, distance: bestDist } : null
  }

  findBestWireAnchorForHand(handEntry, maxDist = this.wireHoverMaxDist) {
    if (!handEntry || !this.isHandEntryTracked(handEntry)) return null
    if (handEntry.heldObject) return null

    this.getGrabPointWorld(handEntry, this._tmpC)
    const anchors = this.getAllConnectionAnchors()
    let best = null
    let bestDist = maxDist

    for (const anchor of anchors) {
      const d = anchor.worldPos.distanceTo(this._tmpC)
      if (d > bestDist) continue

      if (!best) { best = anchor; bestDist = d; continue }

      const bestPriority = this.wireAnchorPriority[best.kind] ?? 999
      const candidatePriority = this.wireAnchorPriority[anchor.kind] ?? 999

      if (d < bestDist - 0.001) { best = anchor; bestDist = d }
      else if (Math.abs(d - bestDist) <= 0.001 && candidatePriority < bestPriority) {
        best = anchor; bestDist = d
      }
    }

    return best ? { ...best, distance: bestDist, handIndex: handEntry.index } : null
  }

  findBestWireEndpointForHand(handEntry, maxDist = this.wireEndpointHoverMaxDist) {
    if (!handEntry || !this.isHandEntryTracked(handEntry)) return null
    if (handEntry.heldObject) return null
    if (this.wireDraftOwner !== null) return null

    this.getGrabPointWorld(handEntry, this._tmpC)
    const result = this.findBestEndpointNearPoint(this._tmpC, maxDist)
    if (!result) return null
    return { ...result, handIndex: handEntry.index }
  }

  updateControllerWireHover() {
    if (this.toolMode !== "wire") {
      this._controllerWireHover = null
      if (this._wireHoverMarker) this._wireHoverMarker.visible = false
      return
    }

    let bestResult = null
    let bestControllerIndex = -1

    for (const controller of this.controllers) {
      const hitPoint = new THREE.Vector3()
      this.getControllerRayHitPoint(controller, hitPoint)

      const endpointResult = this.wireDraftOwner === null
        ? this.findBestEndpointNearPoint(hitPoint, Math.max(this.wireEndpointHoverMaxDist, 0.045))
        : null

      const anchorResult = this.findBestAnchorNearPoint(
        hitPoint,
        this.wireControllerAnchorRadius,
        this.wireControllerHoleRadiusXZ
      )

      let chosen = null
      let chosenType = null

      if (endpointResult && anchorResult) {
        if (endpointResult.distance <= anchorResult.distance) { chosen = endpointResult; chosenType = "endpoint" }
        else { chosen = anchorResult; chosenType = "anchor" }
      } else if (endpointResult) {
        chosen = endpointResult; chosenType = "endpoint"
      } else if (anchorResult) {
        chosen = anchorResult; chosenType = "anchor"
      }

      if (chosen) {
        bestResult = { ...chosen, type: chosenType }
        bestControllerIndex = controller.userData.sourceIndex
        break
      }
    }

    if (!bestResult) {
      this._controllerWireHover = null
      if (this._wireHoverMarker) this._wireHoverMarker.visible = false
      return
    }

    this._controllerWireHover = {
      anchor: bestResult.type === "anchor" ? bestResult : null,
      endpoint: bestResult.type === "endpoint" ? bestResult : null,
      controllerIndex: bestControllerIndex,
    }

    const marker = this.ensureWireHoverMarker()
    marker.position.copy(bestResult.worldPos)
    marker.visible = true
  }

  ensureWireHoverMarker() {
    if (this._wireHoverMarker) return this._wireHoverMarker

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.0065, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ffff })
    )
    marker.name = "WireHoverMarker"
    marker.visible = false
    this.scene.add(marker)

    this._wireHoverMarker = marker
    return marker
  }

  clearWireHoverAnchor() {
    this.wireHoverAnchor = null
    this.wireHoverEndpoint = null
    this.wireHoverHandIndex = null

    if (this._wireHoverMarker) this._wireHoverMarker.visible = false
  }

  updateWireHover() {
    if (this.toolMode !== "wire") {
      this.clearWireHoverAnchor()
      return
    }

    let best = null
    let bestType = null

    for (const handEntry of this.hands) {
      const anchorCandidate = this.findBestWireAnchorForHand(handEntry)
      const endpointCandidate = this.findBestWireEndpointForHand(handEntry)

      if (!this.wireDraftOwner) {
        if (anchorCandidate && endpointCandidate) {
          if (endpointCandidate.distance <= anchorCandidate.distance) { best = endpointCandidate; bestType = "endpoint" }
          else { best = anchorCandidate; bestType = "anchor" }
        } else if (endpointCandidate) { best = endpointCandidate; bestType = "endpoint" }
        else if (anchorCandidate) { best = anchorCandidate; bestType = "anchor" }
      } else {
        if (anchorCandidate && (!best || anchorCandidate.distance < best.distance)) {
          best = anchorCandidate; bestType = "anchor"
        }
      }

      if (best) break
    }

    if (!best) {
      if (this.wireHoverAnchor || this.wireHoverEndpoint) {
        const trackedHand = this.hands.find((h) => h.index === this.wireHoverHandIndex)
        if (trackedHand && this.isHandEntryTracked(trackedHand)) {
          this.getGrabPointWorld(trackedHand, this._tmpD)
          const targetPos = this.wireHoverAnchor?.worldPos || this.wireHoverEndpoint?.worldPos || null
          if (targetPos) {
            const keepDist = targetPos.distanceTo(this._tmpD)
            if (keepDist <= this.wireHoverReleaseDist) {
              const marker = this.ensureWireHoverMarker()
              marker.position.copy(targetPos)
              marker.visible = true
              return
            }
          }
        }
      }
      this.clearWireHoverAnchor()
      return
    }

    this.wireHoverHandIndex = best.handIndex

    if (bestType === "anchor") { this.wireHoverAnchor = best; this.wireHoverEndpoint = null }
    else { this.wireHoverAnchor = null; this.wireHoverEndpoint = best }

    const marker = this.ensureWireHoverMarker()
    marker.position.copy(best.worldPos)
    marker.visible = true
  }

  ensureWireDraftMesh(index = 0) {
    if (this._wireDraftMeshes[index]) {
      const existing = this._wireDraftMeshes[index]
      if (existing.material?.color) existing.material.color.setHex(this.wireDraftColor ?? 0x111111)
      return existing
    }

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(this.wireDraftRadius, this.wireDraftRadius, 1, 18),
      new THREE.MeshStandardMaterial({
        color: this.wireDraftColor ?? 0x111111,
        roughness: 0.65,
        metalness: 0.0,
        emissive: 0x181818,
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
    this.wireDraftOwner = null
    this.wireDraftWaypoints = []
    this.wireDraftColor = 0x111111

    for (const mesh of this._wireDraftMeshes) {
      if (mesh) mesh.visible = false
    }
  }

  startWireDraftFromAnchor(anchor, owner) {
    if (!anchor) return

    this.wireDraftStartAnchor = { ...anchor, worldPos: anchor.worldPos.clone() }
    this.wireDraftOwner = owner
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

  addWireWaypointFromHand(handEntry) {
    if (!handEntry) return false
    if (!this.wireDraftStartAnchor) return false
    if (this.wireDraftOwner !== handEntry.index) return false
    if (!this.isHandEntryTracked(handEntry)) return false
    if (!this.canRunWireAction()) return false

    this.getGrabPointWorld(handEntry, this._tmpA)
    const newPoint = this._tmpA.clone()

    const points = [this.wireDraftStartAnchor.worldPos, ...this.wireDraftWaypoints]
    const lastPoint = points[points.length - 1]
    if (lastPoint.distanceTo(newPoint) < 0.015) return false

    this.wireDraftWaypoints.push(newPoint)
    return true
  }

  addWireWaypointFromController(controller) {
    if (!controller) return false
    if (!this.wireDraftStartAnchor) return false

    const ownerKey = `ctrl_${controller.userData.sourceIndex}`
    if (this.wireDraftOwner !== ownerKey) return false
    if (!this.canRunWireAction()) return false

    const hitPoint = new THREE.Vector3()
    this.getControllerRayHitPoint(controller, hitPoint)

    const points = [this.wireDraftStartAnchor.worldPos, ...this.wireDraftWaypoints]
    const lastPoint = points[points.length - 1]
    if (lastPoint.distanceTo(hitPoint) < 0.015) return false

    this.wireDraftWaypoints.push(hitPoint)
    return true
  }

  getWireDraftPoints(currentEndPoint = null) {
    const points = []
    if (!this.wireDraftStartAnchor) return points

    points.push(this.wireDraftStartAnchor.worldPos.clone())
    for (const p of this.wireDraftWaypoints) points.push(p.clone())
    if (currentEndPoint) points.push(currentEndPoint.clone())

    return points
  }

  updateWireDraftSegment(mesh, start, end) {
    const dir = this._tmpB.copy(end).sub(start)
    const len = dir.length()

    if (len < 0.001) { mesh.visible = false; return }

    mesh.visible = true
    const mid = this._tmpC.copy(start).add(end).multiplyScalar(0.5)
    mesh.position.copy(mid)
    dir.normalize()
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    mesh.scale.set(1, len, 1)
  }

  generateComponentId(prefix = "cmp") {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  }

  serializeWireAnchor(anchor) {
    if (!anchor) return null
    return {
      kind: anchor.kind ?? null,
      id: anchor.id ?? null,
      label: anchor.label ?? null,
      componentId: anchor.componentId ?? null,
      componentType: anchor.componentType ?? null,
      holeId: anchor.holeId ?? null,
      groupKey: anchor.groupKey ?? null,
      worldPos: anchor.worldPos
        ? { x: anchor.worldPos.x, y: anchor.worldPos.y, z: anchor.worldPos.z }
        : null,
    }
  }

  isSameWireAnchor(a, b) {
    if (!a || !b) return false
    if (a.kind !== b.kind) return false
    if (a.kind === "hole") return a.holeId === b.holeId
    return a.componentId === b.componentId && a.id === b.id
  }

  getWireColorFromAnchors(startAnchor, endAnchor = null) {
    const pickBatteryColor = (anchor) => {
      if (!anchor) return null
      if (anchor.componentType === "battery5v" && anchor.id === "positive") return 0xff2a2a
      if (anchor.componentType === "battery5v" && anchor.id === "negative") return 0x5bc0de
      return null
    }

    const startColor = pickBatteryColor(startAnchor)
    if (startColor != null) return startColor

    const endColor = pickBatteryColor(endAnchor)
    if (endColor != null) return endColor

    return 0x111111
  }

  finalizeWireDraftToAnchor(endAnchor, owner) {
    if (!endAnchor) return false
    if (!this.wireDraftStartAnchor) return false
    if (this.wireDraftOwner !== owner) return false
    if (!this.stateSyncSystem) return false
    if (!this.canRunWireAction()) return false

    const startAnchor = this.wireDraftStartAnchor

    if (this.isSameWireAnchor(startAnchor, endAnchor)) {
      console.log("⚠️ Punto B inválido: mismo anchor que A")
      return false
    }

    const points = [
      startAnchor.worldPos.clone(),
      ...this.wireDraftWaypoints.map((p) => p.clone()),
      endAnchor.worldPos.clone(),
    ]

    if (points.length < 2) return false

    const id = this.generateComponentId("wire")
    const wireColor = this.getWireColorFromAnchors(startAnchor, endAnchor)

    const data = {
      id,
      type: "wire",
      transform: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
      meta: {
        color: wireColor,
        points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        startAnchor: this.serializeWireAnchor(startAnchor),
        endAnchor: this.serializeWireAnchor(endAnchor),
      },
    }

    this.appState.addComponent(data)
    this.stateSyncSystem.addMeshFromComponent(data)

    this.clearWireDraft()
    this.clearWireHoverAnchor()
    this._controllerWireHover = null

    console.log("✅ Cable cerrado entre A y B")
    return true
  }

  findComponentMeshById(componentId) {
    if (!componentId) return null
    if (!this.stateSyncSystem) return null
    return this.stateSyncSystem.getMeshById(componentId)
  }

  resolveAnchorWorldPosition(anchor) {
    if (!anchor) return null

    if (anchor.kind === "hole") {
      if (!this.holeSystem) return null
      this.holeSystem.updateWorldPositions()
      const hole = this.holeSystem.holes.find((h) => h.id === anchor.holeId || h.id === anchor.id)
      return hole ? hole.worldPos.clone() : null
    }

    if (anchor.componentId) {
      const mesh = this.findComponentMeshById(anchor.componentId)
      if (!mesh) return null

      if (anchor.kind === "terminal" && typeof mesh.userData?.getTerminalWorldPositions === "function") {
        const terminals = mesh.userData.getTerminalWorldPositions()
        const found = terminals.find((t) => t.id === anchor.id)
        return found ? found.worldPos.clone() : null
      }

      if (anchor.kind === "pin" && typeof mesh.userData?.getPinWorldPositions === "function") {
        const pins = mesh.userData.getPinWorldPositions()
        const found = pins.find((p) => p.id === anchor.id)
        return found ? found.worldPos.clone() : null
      }
    }

    if (anchor.worldPos) {
      return new THREE.Vector3(anchor.worldPos.x, anchor.worldPos.y, anchor.worldPos.z)
    }

    return null
  }

  getWireEndpointWorldPosition(wireMesh, endpointType) {
    if (!wireMesh?.userData?.isWire) return null

    const anchor = endpointType === "start"
      ? wireMesh.userData.startAnchor
      : wireMesh.userData.endAnchor

    const resolved = this.resolveAnchorWorldPosition(anchor)
    if (resolved) return resolved

    const fixedPoints = Array.isArray(wireMesh.userData.fixedPoints)
      ? wireMesh.userData.fixedPoints : null

    if (!fixedPoints || fixedPoints.length < 2) return null
    if (endpointType === "start") return fixedPoints[0].clone()
    return fixedPoints[fixedPoints.length - 1].clone()
  }

  getAllWireEndpoints() {
    const endpoints = []
    if (!this.stateSyncSystem) return endpoints

    for (const mesh of this.stateSyncSystem.meshById.values()) {
      if (!mesh?.userData?.isWire) continue

      const startWorld = this.getWireEndpointWorldPosition(mesh, "start")
      const endWorld = this.getWireEndpointWorldPosition(mesh, "end")

      if (startWorld) endpoints.push({ kind: "wire-endpoint", endpointType: "start", wireId: mesh.userData.componentId, worldPos: startWorld })
      if (endWorld) endpoints.push({ kind: "wire-endpoint", endpointType: "end", wireId: mesh.userData.componentId, worldPos: endWorld })
    }

    return endpoints
  }

  deleteWireById(wireId) {
    if (!wireId || !this.stateSyncSystem) return false
    this.appState.removeComponent(wireId)
    this.stateSyncSystem.removeMeshById(wireId)
    return true
  }

  reopenWireFromEndEndpoint(endpoint, owner) {
    if (!endpoint || endpoint.endpointType !== "end") return false
    if (!this.stateSyncSystem) return false

    const wireMesh = this.stateSyncSystem.getMeshById(endpoint.wireId)
    if (!wireMesh?.userData?.isWire) return false

    const startAnchor = wireMesh.userData.startAnchor
    const fixedPoints = Array.isArray(wireMesh.userData.fixedPoints)
      ? wireMesh.userData.fixedPoints.map((p) => p.clone()) : []

    if (!startAnchor || fixedPoints.length < 2) return false

    const waypoints = fixedPoints.slice(1, -1)
    this.deleteWireById(endpoint.wireId)

    this.wireDraftStartAnchor = {
      ...startAnchor,
      worldPos: this.resolveAnchorWorldPosition(startAnchor) || fixedPoints[0].clone(),
    }

    this.wireDraftOwner = owner
    this.wireDraftWaypoints = waypoints
    this.wireDraftColor = wireMesh.userData.wireColor ?? 0x111111

    const mesh = this.ensureWireDraftMesh(0)
    if (mesh.material?.color) mesh.material.color.setHex(this.wireDraftColor)
    mesh.visible = true

    this.clearWireHoverAnchor()
    this._controllerWireHover = null

    return true
  }

  updateDynamicWires() {
    if (!this.stateSyncSystem) return

    for (const mesh of this.stateSyncSystem.meshById.values()) {
      if (!mesh?.userData?.isWire) continue
      if (typeof mesh.userData?.rebuildWireGeometry !== "function") continue

      const startAnchor = mesh.userData.startAnchor
      const endAnchor = mesh.userData.endAnchor
      const fixedPoints = Array.isArray(mesh.userData.fixedPoints)
        ? mesh.userData.fixedPoints.map((p) => p.clone()) : []

      if (fixedPoints.length < 2) continue

      const startWorld = this.resolveAnchorWorldPosition(startAnchor)
      const endWorld = this.resolveAnchorWorldPosition(endAnchor)

      if (startWorld) fixedPoints[0] = startWorld
      if (endWorld) fixedPoints[fixedPoints.length - 1] = endWorld

      mesh.userData.rebuildWireGeometry(fixedPoints)
    }
  }

  updateWireDraftPreview() {
    if (this.toolMode !== "wire") {
      this.clearWireDraft()
      return
    }

    if (!this.wireDraftStartAnchor) {
      for (const mesh of this._wireDraftMeshes) { if (mesh) mesh.visible = false }
      return
    }

    const isControllerDraft =
      typeof this.wireDraftOwner === "string" && this.wireDraftOwner.startsWith("ctrl_")

    let liveEnd = null

    if (isControllerDraft) {
      const ctrlIndex = parseInt(this.wireDraftOwner.replace("ctrl_", ""), 10)
      const controller = this.controllers[ctrlIndex]
      if (controller) {
        const hitPoint = new THREE.Vector3()
        this.getControllerRayHitPoint(controller, hitPoint)
        liveEnd = hitPoint
      }
    } else {
      const handEntry = this.hands.find((h) => h.index === this.wireDraftOwner)
      if (!handEntry || !this.isHandEntryTracked(handEntry)) {
        for (const mesh of this._wireDraftMeshes) { if (mesh) mesh.visible = false }
        return
      }
      this.getGrabPointWorld(handEntry, this._tmpA)
      liveEnd = this._tmpA.clone()
    }

    if (!liveEnd) {
      for (const mesh of this._wireDraftMeshes) { if (mesh) mesh.visible = false }
      return
    }

    const snapTarget =
      this._controllerWireHover?.anchor?.worldPos ||
      this.wireHoverAnchor?.worldPos ||
      null
    if (snapTarget) liveEnd = snapTarget.clone()

    const points = this.getWireDraftPoints(liveEnd)

    if (points.length < 2) {
      for (const mesh of this._wireDraftMeshes) { if (mesh) mesh.visible = false }
      return
    }

    const neededSegments = points.length - 1

    for (let i = 0; i < neededSegments; i++) {
      const mesh = this.ensureWireDraftMesh(i)
      this.updateWireDraftSegment(mesh, points[i], points[i + 1])
    }

    for (let i = neededSegments; i < this._wireDraftMeshes.length; i++) {
      const mesh = this._wireDraftMeshes[i]
      if (mesh) mesh.visible = false
    }
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
        if (d < bestDist) { bestDist = d; bestBtn = obj }
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
    if (expandedDist > 0.0001 && surfaceDist > this.handGrabSurfaceMaxDist + this.handGrabSurfaceSlack) return false

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
      if (score < bestScore) { bestScore = score; best = obj }
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

    if (sourceType === "controller") source.getWorldPosition(holdState.lastPos)
    else this.getGrabPointWorld(source, holdState.lastPos)
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

    if (holdState.sourceType === "controller") holdState.source.getWorldPosition(this._tmpA)
    else this.getGrabPointWorld(holdState.source, this._tmpA)

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

    const disallowedTypes = Array.isArray(object.userData?.surfaceDisallowedTypes)
      ? object.userData.surfaceDisallowedTypes : []

    const surfaceEntries = this.surfaces.filter((s) => !disallowedTypes.includes(s.type))
    if (surfaceEntries.length === 0) return null

    const surfaceMeshes = surfaceEntries.map((s) => s.mesh)
    const hits = this.downRaycaster.intersectObjects(surfaceMeshes, true)
    if (hits.length === 0) return null

    return this.pickBestSurfaceHit(hits, object)
  }

  resolveSurfacePenetration(object) {
    if (!object || this.surfaces.length === 0) return false

    const best = this.getBestSurfaceBelow(object)
    if (!best) return false

    const contactObject = object.userData?.surfaceContactObject || object
    this._box.setFromObject(contactObject)
    this._box.getSize(this._tmpSize)
    const halfY = this._tmpSize.y * 0.5

    const center = new THREE.Vector3()
    this._box.getCenter(center)

    const bottomY = center.y - halfY
    const targetCenterY = best.point.y + halfY
    const deltaY = targetCenterY - center.y

    if (bottomY < best.point.y) {
      object.position.y += deltaY + 0.001

      if (object.userData?.surfaceUpright) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).setY(0)
        let yaw = object.rotation.y
        if (forward.lengthSq() > 1e-8) { forward.normalize(); yaw = Math.atan2(forward.x, forward.z) }
        object.rotation.set(0, yaw, 0)
        object.updateMatrixWorld(true)
      }

      return true
    }

    return false
  }

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

    const pinA = object.userData.pins[0]
    const pinB = object.userData.pins[1]

    if (!pinA || !pinB) return false

    const matchA = validMatches.find((m) => m.pinId === pinA.id)
    const matchB = validMatches.find((m) => m.pinId === pinB.id)

    if (!matchA || !matchB) return false

    object.userData.pinConnections = {
      [pinA.id]: matchA.hole.id,
      [pinB.id]: matchB.hole.id,
    }

    const targetDir = new THREE.Vector3()
      .subVectors(matchB.hole.worldPos, matchA.hole.worldPos)
      .setY(0)

    if (targetDir.lengthSq() < 1e-8) return false

    targetDir.normalize()

    const targetYaw = Math.atan2(-targetDir.z, targetDir.x)
    object.rotation.set(0, targetYaw, 0)
    object.updateMatrixWorld(true)

    const rotatedPinAWorld = new THREE.Vector3().copy(pinA.localPos)
    object.localToWorld(rotatedPinAWorld)

    const delta = new THREE.Vector3().subVectors(matchA.hole.worldPos, rotatedPinAWorld)
    object.position.add(delta)
    object.position.y -= 0.02
    object.updateMatrixWorld(true)

    const componentId = object.userData?.componentId
    if (componentId) {
      this.appState.updateComponent(componentId, {
        inserted: true,
        pinConnections: { [pinA.id]: matchA.hole.id, [pinB.id]: matchB.hole.id },
      })
    }

    this.persistMeshTransform(object)
    return true
  }

  tryPlaceObjectDirectly(object) {
    if (!object) return false

    const best = this.getBestSurfaceBelow(object)
    if (!best) return false

    if (object.userData?.surfaceUpright) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).setY(0)
      let yaw = object.rotation.y
      if (forward.lengthSq() > 1e-8) { forward.normalize(); yaw = Math.atan2(forward.x, forward.z) }
      object.rotation.set(0, yaw, 0)
      object.updateMatrixWorld(true)
    }

    const contactObject = object.userData?.surfaceContactObject || object
    const bbox = new THREE.Box3().setFromObject(contactObject)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    bbox.getSize(size)
    bbox.getCenter(center)

    const halfY = size.y * 0.5
    const bottomY = center.y - halfY
    const drop = bottomY - best.point.y

    if (drop < -0.03) return false
    if (drop > this.directPlaceMaxDrop) return false

    const targetCenterY = best.point.y + halfY
    const deltaY = targetCenterY - center.y
    object.position.y += deltaY

    if (this.holeSystem && Array.isArray(object.userData?.pins)) {
      this.holeSystem.trySnapObject(object, 0.03)
    }

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

    handEntry.isPinching = true
    handEntry.pinchArmed = false
    handEntry.lostTrackingMs = 0
    handEntry.openPinchMs = 0

    if (this.toolMode === "wire") {
      const hoverIsValidAnchor =
        !!this.wireHoverAnchor && this.wireHoverHandIndex === handEntry.index
      const hoverIsWireEndpoint =
        !!this.wireHoverEndpoint && this.wireHoverHandIndex === handEntry.index

      if (!this.wireDraftOwner) {
        if (hoverIsWireEndpoint) {
          if (!this.canRunWireAction()) return

          if (this.wireHoverEndpoint.endpointType === "start") {
            const deleted = this.deleteWireById(this.wireHoverEndpoint.wireId)
            if (deleted) { console.log("🗑️ Cable eliminado (mano)"); this.clearWireHoverAnchor() }
            return
          }

          if (this.wireHoverEndpoint.endpointType === "end") {
            const reopened = this.reopenWireFromEndEndpoint(this.wireHoverEndpoint, handEntry.index)
            if (reopened) console.log("↩️ Cable reabierto (mano)")
            return
          }
        }

        if (hoverIsValidAnchor && this.canRunWireAction()) {
          this.startWireDraftFromAnchor(this.wireHoverAnchor, handEntry.index)
          console.log("🟢 Punto A iniciado (mano):", this.wireHoverAnchor)
        }
        return
      }

      if (this.wireDraftOwner !== handEntry.index) return

      if (hoverIsValidAnchor) {
        const closed = this.finalizeWireDraftToAnchor(this.wireHoverAnchor, handEntry.index)
        if (closed) console.log("🔌 Punto B conectado (mano):", this.wireHoverAnchor)
      } else {
        const added = this.addWireWaypointFromHand(handEntry)
        if (added) console.log("〰️ Waypoint agregado (mano)")
      }

      return
    }

    const target = this.findNearestComponentToHand(handEntry, this.nearRadius)
    if (!target) return
    if (!this.canHandGrabObject(handEntry, target)) return

    if (target.userData?.inserted || target.userData?.pinConnections) {
      target.userData.inserted = false
      target.userData.pinConnections = null
      const componentId = target.userData?.componentId
      if (componentId) this.appState.updateComponent(componentId, { inserted: false, pinConnections: null })
    }

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

    if (this.toolMode === "wire") return
    if (!handEntry.heldObject) return

    const object = handEntry.heldObject
    this.releaseHeldObject(object, handEntry.hold, () => { handEntry.heldObject = null }, options)
  }

  forceReleaseHand(handEntry, forceZeroVelocity = true) {
    if (!handEntry) return

    handEntry.isPinching = false
    handEntry.openPinchMs = 0
    handEntry.lostTrackingMs = 0

    if (this.toolMode === "wire") { this.stopHoldTracking(handEntry.hold); return }
    if (!handEntry.heldObject) { this.stopHoldTracking(handEntry.hold); return }

    this.onHandPinchEnd(handEntry, { forceZeroVelocity })
  }

  // ---------------------------
  // onControllerSelectStart — con logs de diagnóstico
  // ---------------------------
  onControllerSelectStart(event) {
    const controller = event.target
    if (!controller) return

    if (this.toolMode === "wire") {
      if (!this.canRunWireAction()) return

      const ctrlIndex = controller.userData.sourceIndex
      const ownerKey = `ctrl_${ctrlIndex}`

      // ── DIAGNÓSTICO ─────────────────────────────────────────
      const hitPoint = new THREE.Vector3()
      const didHit = this.getControllerRayHitPoint(controller, hitPoint)

      console.log("🎯 PRESS hitPoint:", didHit, hitPoint.toArray().map((v) => v.toFixed(3)))
      console.log("🎯 wireDraftOwner:", this.wireDraftOwner, "| ownerKey:", ownerKey)

      const endpointResult = this.wireDraftOwner === null
        ? this.findBestEndpointNearPoint(hitPoint, Math.max(this.wireEndpointHoverMaxDist, 0.045))
        : null

      const anchorResult = this.findBestAnchorNearPoint(
        hitPoint,
        this.wireControllerAnchorRadius,
        this.wireControllerHoleRadiusXZ
      )

      console.log(
        "🎯 anchorResult:",
        anchorResult
          ? `kind=${anchorResult.kind} id=${anchorResult.id} distXZ=${anchorResult.distance.toFixed(4)}`
          : "null"
      )
      console.log(
        "🎯 endpointResult:",
        endpointResult
          ? `type=${endpointResult.endpointType} dist=${endpointResult.distance.toFixed(4)}`
          : "null"
      )

      // Si hay holes en el sistema, mostrar el más cercano para comparar
      if (this.holeSystem) {
        this.holeSystem.updateWorldPositions()
        let closestHole = null
        let closestDist = Infinity
        for (const hole of this.holeSystem.holes) {
          const dx = hole.worldPos.x - hitPoint.x
          const dz = hole.worldPos.z - hitPoint.z
          const d = Math.sqrt(dx * dx + dz * dz)
          if (d < closestDist) { closestDist = d; closestHole = hole }
        }
        console.log(
          "🎯 hole más cercano:",
          closestHole
            ? `id=${closestHole.id} distXZ=${closestDist.toFixed(4)} worldPos=[${closestHole.worldPos.toArray().map((v) => v.toFixed(3))}]`
            : "ninguno"
        )
        console.log("🎯 wireControllerHoleRadiusXZ:", this.wireControllerHoleRadiusXZ)
      }
      // ── FIN DIAGNÓSTICO ─────────────────────────────────────

      let chosenAnchor = null
      let chosenEndpoint = null

      if (endpointResult && anchorResult) {
        if (endpointResult.distance <= anchorResult.distance) chosenEndpoint = endpointResult
        else chosenAnchor = anchorResult
      } else if (endpointResult) {
        chosenEndpoint = endpointResult
      } else if (anchorResult) {
        chosenAnchor = anchorResult
      }

      if (!this.wireDraftOwner) {
        if (chosenEndpoint) {
          if (chosenEndpoint.endpointType === "start") {
            const deleted = this.deleteWireById(chosenEndpoint.wireId)
            if (deleted) {
              console.log("🗑️ Cable eliminado (control)")
              this._controllerWireHover = null
              if (this._wireHoverMarker) this._wireHoverMarker.visible = false
            }
            return
          }

          if (chosenEndpoint.endpointType === "end") {
            const reopened = this.reopenWireFromEndEndpoint(chosenEndpoint, ownerKey)
            if (reopened) console.log("↩️ Cable reabierto (control)")
            return
          }
        }

        if (chosenAnchor) {
          this.startWireDraftFromAnchor(chosenAnchor, ownerKey)
          this._controllerWireHover = null
          if (this._wireHoverMarker) this._wireHoverMarker.visible = false
          console.log("🟢 Punto A iniciado (control):", chosenAnchor.kind, chosenAnchor.id)
          return
        }

        console.log("⚠️ Press sin anchor ni endpoint válido cerca")
        return
      }

      if (this.wireDraftOwner !== ownerKey) {
        console.log("⚠️ Press ignorado: draft pertenece a", this.wireDraftOwner, "no a", ownerKey)
        return
      }

      if (chosenAnchor) {
        const closed = this.finalizeWireDraftToAnchor(chosenAnchor, ownerKey)
        if (closed) {
          console.log("🔌 Punto B conectado (control):", chosenAnchor.kind, chosenAnchor.id)
          this._controllerWireHover = null
          if (this._wireHoverMarker) this._wireHoverMarker.visible = false
        } else {
          console.log("⚠️ finalizeWireDraftToAnchor devolvió false")
        }
      } else {
        console.log("〰️ Sin anchor cerca — agregando waypoint")
        const added = this.addWireWaypointFromController(controller)
        if (added) console.log("〰️ Waypoint agregado (control)")
        else console.log("⚠️ Waypoint no agregado (muy cerca del anterior o cooldown)")
      }

      return
    }

    // ── GRAB MODE ──────────────────────────────────────────────
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

    if (target.userData?.inserted || target.userData?.pinConnections) {
      target.userData.inserted = false
      target.userData.pinConnections = null
      const componentId = target.userData?.componentId
      if (componentId) this.appState.updateComponent(componentId, { inserted: false, pinConnections: null })
    }

    controller.userData.heldObject = target
    this.setObjectOwner(target, this.makeOwnerToken("controller", controller.userData.sourceIndex))
    this.startHoldTracking(controller.userData.hold, "controller", controller)
    controller.attach(target)
  }

  onControllerSelectEnd(event) {
    const controller = event?.target
    if (!controller) return

    if (this.toolMode === "wire") return
    if (!controller.userData?.heldObject) return

    const object = controller.userData.heldObject
    this.releaseHeldObject(
      object,
      controller.userData.hold,
      () => { controller.userData.heldObject = null }
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

  pickBestSurfaceHit(hits, object = null) {
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

    const disallowedTypes = Array.isArray(object?.userData?.surfaceDisallowedTypes)
      ? object.userData.surfaceDisallowedTypes : []

    const filteredHits = hits.filter((h) => {
      const surf = getSurfaceEntry(h.object)
      return surf && !disallowedTypes.includes(surf.type)
    })

    for (const h of filteredHits) {
      const surf = getSurfaceEntry(h.object)
      if (surf?.type === "protoboard") return { ...h, surface: surf }
    }
    for (const h of filteredHits) {
      const surf = getSurfaceEntry(h.object)
      if (surf?.type === "table") return { ...h, surface: surf }
    }
    for (const h of filteredHits) {
      const surf = getSurfaceEntry(h.object)
      if (surf?.type === "floor") return { ...h, surface: surf }
    }
    for (const h of filteredHits) {
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
          if (d < bestScore && d < this.uiPokeRadius * 2) { bestScore = d; best = obj }
          continue
        }

        const surfaceDist = this.distanceToObjectSurface(obj, this._tmpA)
        const centerDist = this.getObjectCenterDistance(obj, this._tmpA)
        const expandedDist = this.getExpandedBoxDistance(obj, this._tmpA, this.handHoverExpandedBoxMargin)

        if (centerDist > this.nearRadius) continue
        if (surfaceDist > this.handHoverSurfaceMaxDist && expandedDist > 0.0001) continue

        const score = expandedDist * 6 + surfaceDist * 2.4 + centerDist
        if (score < bestScore) { bestScore = score; best = obj }
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

    if (activeHeldObject) this.updatePinHoleMarkersForHeldObject(activeHeldObject)
    else this.clearActivePinHoleMarkers()
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

      if (dist >= this.pinchReleaseResetDist) h.pinchArmed = true

      if (this.toolMode === "wire") {
        const hasAnchorHover = !!this.wireHoverAnchor
        const hasEndpointHover = !!this.wireHoverEndpoint
        const hasAnyWireHover = hasAnchorHover || hasEndpointHover
        const isSameHandHovering = this.wireHoverHandIndex === h.index

        const hasDraftForThisHand =
          !!this.wireDraftStartAnchor && this.wireDraftOwner === h.index

        const thumbTip = this.getJointWorld(h.hand, "thumb-tip", this._tmpE)
        const indexTip = this.getJointWorld(h.hand, "index-finger-tip", this._tmpF)

        let wireDist = Infinity
        if (thumbTip && indexTip) wireDist = thumbTip.distanceTo(indexTip)

        const closeEnoughForWire = wireDist <= this.wirePinchStartDist
        const openedEnoughToReset = wireDist >= this.wirePinchEndDist

        if (openedEnoughToReset) {
          h.isPinching = false
          h.pinchArmed = true
          h.wirePinchCloseMs = 0
        }

        const canAccumulateGesture =
          closeEnoughForWire &&
          h.pinchArmed &&
          !h.isPinching &&
          ((hasAnyWireHover && isSameHandHovering) || hasDraftForThisHand)

        if (canAccumulateGesture) h.wirePinchCloseMs += dtMs
        else h.wirePinchCloseMs = 0

        if (h.pinchArmed && !h.isPinching && canAccumulateGesture) {
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

      if (dist <= this.pinchStartDist && h.pinchArmed) this.onHandPinchStart(h)
      else if (dist > this.pinchEndDist) h.isPinching = false
    }
  }

  clearActivePinHoleMarkers() {
    for (const marker of this._activePinHoleMarkers) {
      if (marker?.parent) marker.parent.remove(marker)
    }
    this._activePinHoleMarkers.length = 0
  }

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
        new THREE.SphereGeometry(0.0075, 12, 12),
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

    this.updateControllerRays(handsActive)

    if (handsActive) {
      this.updateUIPoke()
      this.updateHandPinchState(dtMs)
      this.updateWireHover()
      this.updateWireDraftPreview()
      this._controllerWireHover = null
    } else {
      this.clearWireHoverAnchor()

      if (this.wireDraftStartAnchor && typeof this.wireDraftOwner === "number") {
        this.clearWireDraft()
      }

      for (const handEntry of this.hands) {
        this.forceReleaseHand(handEntry, true)
        handEntry.pinchArmed = true
      }

      if (this.toolMode === "wire") {
        this.updateControllerWireHover()
        this.updateWireDraftPreview()
      } else {
        this._controllerWireHover = null
        if (this._wireHoverMarker) this._wireHoverMarker.visible = false
      }
    }

    this.cleanupDetachedHolds()
    this.updateHeldObjects()
    this.updateDynamicWires()

    if (this.toolMode === "wire") {
      this.setHover(null)
      return
    }

    const anyHeld =
      this.hands.some((h) => !!h.heldObject) ||
      this.controllers.some((c) => !!c.userData?.heldObject)

    if (anyHeld) { this.setHover(null); return }

    const hovered = handsActive ? this.computeHandHover() : this.computeControllerHover()
    this.setHover(hovered)
  }
}