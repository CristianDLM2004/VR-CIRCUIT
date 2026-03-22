import * as THREE from "three"
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js"
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js"

export class InteractionSystem {
  constructor(sceneManager, appState) {
    this.sceneManager = sceneManager
    this.appState     = appState

    this.scene    = sceneManager.scene
    this.renderer = sceneManager.renderer
    this.camera   = sceneManager.camera
    this.stateSyncSystem = null

    this.raycaster     = new THREE.Raycaster()
    this.downRaycaster = new THREE.Raycaster()
    this.tempMatrix    = new THREE.Matrix4()

    this.controllers  = []
    this.hands        = []
    this.interactables = []
    this.surfaces     = []
    this.holeSystem   = null

    this.hovered      = null
    this.controllerRays = []

    this.nearEnabled  = true
    this.nearRadius   = 0.145

    this.handGrabSurfaceMaxDist  = 0.050
    this.handGrabSurfaceSlack    = 0.030
    this.handHoverSurfaceMaxDist = 0.065

    this.handGrabExpandedBoxMargin = 0.020
    this.handGrabExpandedBoxMarginWhenOtherHandBusy = 0.026
    this.handHoverExpandedBoxMargin = 0.016

    this.pinchStartDist        = 0.070
    this.pinchEndDist          = 0.100
    this.pinchReleaseResetDist = 0.115

    // Poke unificado (UI + componentes)
    this.uiPokeRadius    = 0.028
    this.uiReleaseRadius = 0.048

    this.throwVelocityMultiplier = 1.9
    this.throwMinSpeed           = 0.22
    this.directPlaceMaxDrop      = 0.12

    this.handTrackingReleaseGraceMs = 280
    this.handOpenReleaseGraceMs     = 80

    // Tracking de botón presionado por mano (para releaseButton)
    // Map<handIndex, mesh>
    this._handHeldButton = new Map()

    // ---------------------------
    // Wire mode
    // ---------------------------
    this.toolMode          = "grab"
    this.wireHoverAnchor   = null
    this.wireHoverEndpoint = null
    this.wireHoverHandIndex = null
    this._wireHoverMarker  = null

    this.wireHoverMaxDist        = 0.055
    this.wireHoverReleaseDist    = 0.085
    this.wireEndpointHoverMaxDist = 0.020
    this.wirePinchStartDist      = 0.016
    this.wirePinchEndDist        = 0.030

    this.wireAnchorPriority = { terminal: 0, pin: 1, hole: 2 }

    this.wireDraftStartAnchor = null
    this.wireDraftHandIndex   = null
    this.wireDraftWaypoints   = []
    this.wireDraftColor       = 0x111111
    this._wireDraftMeshes     = []
    this.wireDraftRadius      = 0.0038

    this.wireActionCooldownMs = 90
    this._lastWireActionMs    = 0

    this._tmpA    = new THREE.Vector3()
    this._tmpB    = new THREE.Vector3()
    this._tmpC    = new THREE.Vector3()
    this._tmpD    = new THREE.Vector3()
    this._tmpE    = new THREE.Vector3()
    this._tmpF    = new THREE.Vector3()
    this._tmpSize = new THREE.Vector3()
    this._box     = new THREE.Box3()
    this._box2    = new THREE.Box3()

    this._lastPokedButton  = null
    this._lastUpdateTime   = performance.now()
    this._activePinHoleMarkers = []

    this.initXRInputs()
  }

  setHoleSystem(hs)           { this.holeSystem = hs }
  setStateSyncSystem(sss)     { this.stateSyncSystem = sss }

  setToolMode(mode = "grab") {
    const next = mode === "wire" ? "wire" : "grab"
    if (this.toolMode === next) return
    this.toolMode = next
    if (this.toolMode !== "wire") {
      this.clearWireHoverAnchor()
      this.clearWireDraft()
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
    const type   = options.type   || "floor"
    const bounds = options.bounds || null
    mesh.userData.isSurface    = true
    mesh.userData.interactable = false
    if ("componentId" in mesh.userData) delete mesh.userData.componentId
    this.unregister(mesh)
    const existing = this.surfaces.find((s) => s.mesh === mesh)
    if (existing) { existing.type = type; existing.bounds = bounds; return }
    this.surfaces.push({ mesh, type, bounds })
  }

  initXRInputs() {
    const controllerModelFactory = new XRControllerModelFactory()
    const handModelFactory       = new XRHandModelFactory()

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i)
      controller.userData.sourceType  = "controller"
      controller.userData.sourceIndex = i
      controller.userData.heldObject  = null
      controller.userData.hold        = this.createHoldState("controller", controller)

      controller.addEventListener("selectstart", (e) => this.onControllerSelectStart(e))
      controller.addEventListener("selectend",   (e) => this.onControllerSelectEnd(e))
      this.scene.add(controller)

      const grip = this.renderer.xr.getControllerGrip(i)
      grip.add(controllerModelFactory.createControllerModel(grip))
      this.scene.add(grip)

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
        index: i, hand, pinchPoint,
        isPinching: false, pinchArmed: true,
        heldObject: null,
        hold: this.createHoldState("hand", null),
        lostTrackingMs: 0, openPinchMs: 0, wirePinchCloseMs: 0,
      })
    }
  }

  createHoldState(sourceType, source) {
    return {
      active: false, sourceType, source,
      lastPos: new THREE.Vector3(), lastT: 0,
      vel: new THREE.Vector3(), samples: [],
      maxSamples: 8, sampleWindowMs: 120,
    }
  }

  createControllerRay() {
    const geo  = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)])
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff }))
    line.name    = "ControllerRay"
    line.scale.z = 5
    const dot  = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    )
    dot.name       = "ControllerRayDot"
    dot.position.z = -5
    return { line, hitDot: dot }
  }

  isHandTrackingActive() {
    const session = this.renderer.xr.getSession?.()
    if (!session) return false
    return Array.from(session.inputSources || []).some((src) => !!src.hand)
  }

  isJointTracked(joint) {
    return !!(joint && joint.visible !== false)
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
      this.hovered.traverse?.((c) => { if (c.isMesh && c.material?.emissive) c.material.emissive.setHex(0x000000) })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x000000)
    }
    this.hovered = newHovered
    if (this.hovered) {
      this.hovered.traverse?.((c) => { if (c.isMesh && c.material?.emissive) c.material.emissive.setHex(0x222222) })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x222222)
    }
  }

  distanceToObjectSurface(obj, pt)         { this._box.setFromObject(obj);  return this._box.distanceToPoint(pt) }
  getObjectCenterDistance(obj, pt)          { this._box.setFromObject(obj);  this._box.getCenter(this._tmpE); return this._tmpE.distanceTo(pt) }
  getExpandedBoxDistance(obj, pt, m=0.02)   { this._box2.setFromObject(obj); this._box2.expandByScalar(m); return this._box2.distanceToPoint(pt) }

  pickInteractableFromHitObject(hitObject) {
    let obj = hitObject
    while (obj && obj.parent) {
      if (obj.userData?.isUI)          return obj
      if (obj.userData?.componentId)   return obj
      obj = obj.parent
    }
    if (hitObject?.userData?.isUI)        return hitObject
    if (hitObject?.userData?.componentId) return hitObject
    return null
  }

  makeOwnerToken(type, index) { return `${type}:${index}` }
  getObjectOwner(obj)          { return obj?.userData?.heldBy || null }
  setObjectOwner(obj, token)   { if (obj) obj.userData.heldBy = token }
  clearObjectOwner(obj)        { if (obj) obj.userData.heldBy = null }

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

  // ---------------------------
  // ¿Un objeto tiene onPress propio? (botón/switch de componente)
  // ---------------------------
  isComponentWithOnPress(obj) {
    return !!(
      obj?.userData?.componentId &&
      !obj.userData?.isUI &&
      typeof obj.userData?.onPress === "function"
    )
  }

  computeControllerHoverFor(controller) {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld)
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

    const hits = this.raycaster.intersectObjects(this.interactables, true)
    if (hits.length === 0) return null

    for (const h of hits) {
      const picked = this.pickInteractableFromHitObject(h.object)
      if (!picked || !this.interactables.includes(picked)) continue
      if (picked.userData?.isSurface) continue
      if (picked.userData?.isUI) return picked
      if (this.isComponentWithOnPress(picked)) return picked
      if (picked.userData?.componentId && this.isObjectFreeForGrab(picked)) return picked
    }
    return null
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
      r.line.visible   = visible
      r.hitDot.visible = visible
      if (!visible) continue

      this.tempMatrix.identity().extractRotation(r.controller.matrixWorld)
      this.raycaster.ray.origin.setFromMatrixPosition(r.controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)
      let dist = 5
      for (const h of hits) {
        const picked = this.pickInteractableFromHitObject(h.object)
        if (!picked) continue
        if (
          picked.userData?.isUI ||
          this.isComponentWithOnPress(picked) ||
          this.isObjectFreeForGrab(picked)
        ) {
          dist = Math.min(5, Math.max(0.05, h.distance))
          break
        }
      }
      r.line.scale.z    = dist
      r.hitDot.position.z = -dist
    }
  }

  getJointWorld(hand, name, out) {
    const j = hand.joints?.[name]
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

  // ---------------------------
  // Wire mode helpers
  // ---------------------------
  getAllConnectionAnchors() {
    const anchors = []
    if (this.holeSystem) {
      this.holeSystem.updateWorldPositions()
      for (const hole of this.holeSystem.holes) {
        anchors.push({ kind: "hole", id: hole.id, label: hole.id, worldPos: hole.worldPos.clone(), holeId: hole.id, groupKey: hole.groupKey })
      }
    }
    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId) continue
      if (typeof obj.userData?.getConnectionAnchors !== "function") continue
      for (const anchor of obj.userData.getConnectionAnchors()) {
        anchors.push({ kind: anchor.kind, id: anchor.id, label: anchor.label, worldPos: anchor.worldPos.clone(), componentId: obj.userData.componentId, componentType: obj.userData.componentType })
      }
    }
    return anchors
  }

  findBestWireAnchorForHand(handEntry, maxDist = this.wireHoverMaxDist) {
    if (!handEntry || !this.isHandEntryTracked(handEntry)) return null
    if (handEntry.heldObject) return null
    this.getGrabPointWorld(handEntry, this._tmpC)
    const anchors = this.getAllConnectionAnchors()
    let best = null, bestDist = maxDist
    for (const anchor of anchors) {
      const d = anchor.worldPos.distanceTo(this._tmpC)
      if (d > bestDist) continue
      if (!best) { best = anchor; bestDist = d; continue }
      const bp = this.wireAnchorPriority[best.kind]   ?? 999
      const cp = this.wireAnchorPriority[anchor.kind] ?? 999
      if (d < bestDist - 0.001) { best = anchor; bestDist = d }
      else if (Math.abs(d - bestDist) <= 0.001 && cp < bp) { best = anchor; bestDist = d }
    }
    if (!best) return null
    return { ...best, distance: bestDist, handIndex: handEntry.index }
  }

  ensureWireHoverMarker() {
    if (this._wireHoverMarker) return this._wireHoverMarker
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.0065, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ffff })
    )
    marker.name    = "WireHoverMarker"
    marker.visible = false
    this.scene.add(marker)
    this._wireHoverMarker = marker
    return marker
  }

  clearWireHoverAnchor() {
    this.wireHoverAnchor    = null
    this.wireHoverEndpoint  = null
    this.wireHoverHandIndex = null
    if (this._wireHoverMarker) this._wireHoverMarker.visible = false
  }

  updateWireHover() {
    if (this.toolMode !== "wire") { this.clearWireHoverAnchor(); return }
    let best = null, bestType = null
    for (const handEntry of this.hands) {
      const ac = this.findBestWireAnchorForHand(handEntry)
      const ep = this.findBestWireEndpointForHand(handEntry)
      if (!this.wireDraftStartAnchor) {
        if (ac && ep)       { best = ep.distance <= ac.distance ? ep : ac; bestType = best === ep ? "endpoint" : "anchor" }
        else if (ep)        { best = ep; bestType = "endpoint" }
        else if (ac)        { best = ac; bestType = "anchor" }
      } else {
        if (ac && (!best || ac.distance < best.distance)) { best = ac; bestType = "anchor" }
      }
      if (best) break
    }
    if (!best) {
      if (this.wireHoverAnchor || this.wireHoverEndpoint) {
        const th = this.hands.find((h) => h.index === this.wireHoverHandIndex)
        if (th && this.isHandEntryTracked(th)) {
          this.getGrabPointWorld(th, this._tmpD)
          const tp = this.wireHoverAnchor?.worldPos || this.wireHoverEndpoint?.worldPos || null
          if (tp && tp.distanceTo(this._tmpD) <= this.wireHoverReleaseDist) {
            const marker = this.ensureWireHoverMarker()
            marker.position.copy(tp)
            marker.visible = true
            return
          }
        }
      }
      this.clearWireHoverAnchor()
      return
    }
    this.wireHoverHandIndex = best.handIndex
    if (bestType === "anchor") { this.wireHoverAnchor = best; this.wireHoverEndpoint = null }
    else                       { this.wireHoverAnchor = null; this.wireHoverEndpoint = best }
    const marker = this.ensureWireHoverMarker()
    marker.position.copy(best.worldPos)
    marker.visible = true
  }

  ensureWireDraftMesh(index = 0) {
    if (this._wireDraftMeshes[index]) {
      const m = this._wireDraftMeshes[index]
      if (m.material?.color) m.material.color.setHex(this.wireDraftColor ?? 0x111111)
      return m
    }
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(this.wireDraftRadius, this.wireDraftRadius, 1, 18),
      new THREE.MeshStandardMaterial({ color: this.wireDraftColor ?? 0x111111, roughness: 0.65, metalness: 0.0, emissive: 0x181818 })
    )
    mesh.name    = `WireDraftMesh_${index}`
    mesh.visible = false
    this.scene.add(mesh)
    this._wireDraftMeshes[index] = mesh
    return mesh
  }

  clearWireDraft() {
    this.wireDraftStartAnchor = null
    this.wireDraftHandIndex   = null
    this.wireDraftWaypoints   = []
    this.wireDraftColor       = 0x111111
    for (const m of this._wireDraftMeshes) { if (m) m.visible = false }
  }

  startWireDraftFromAnchor(anchor, handIndex) {
    if (!anchor) return
    this.wireDraftStartAnchor = { ...anchor, worldPos: anchor.worldPos.clone() }
    this.wireDraftHandIndex   = handIndex
    this.wireDraftWaypoints   = []
    this.wireDraftColor       = this.getWireColorFromAnchors(anchor, null)
    const mesh = this.ensureWireDraftMesh(0)
    if (mesh.material?.color)   mesh.material.color.setHex(this.wireDraftColor)
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
    if (!handEntry || !this.wireDraftStartAnchor) return false
    if (this.wireDraftHandIndex !== handEntry.index) return false
    if (!this.isHandEntryTracked(handEntry)) return false
    if (!this.canRunWireAction()) return false
    this.getGrabPointWorld(handEntry, this._tmpA)
    const newPoint = this._tmpA.clone()
    const points   = [this.wireDraftStartAnchor.worldPos, ...this.wireDraftWaypoints]
    if (points[points.length - 1].distanceTo(newPoint) < 0.015) return false
    this.wireDraftWaypoints.push(newPoint)
    return true
  }

  getWireDraftPoints(currentEnd = null) {
    const pts = []
    if (!this.wireDraftStartAnchor) return pts
    pts.push(this.wireDraftStartAnchor.worldPos.clone())
    for (const p of this.wireDraftWaypoints) pts.push(p.clone())
    if (currentEnd) pts.push(currentEnd.clone())
    return pts
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
      kind: anchor.kind ?? null, id: anchor.id ?? null, label: anchor.label ?? null,
      componentId: anchor.componentId ?? null, componentType: anchor.componentType ?? null,
      holeId: anchor.holeId ?? null, groupKey: anchor.groupKey ?? null,
      worldPos: anchor.worldPos ? { x: anchor.worldPos.x, y: anchor.worldPos.y, z: anchor.worldPos.z } : null,
    }
  }

  isSameWireAnchor(a, b) {
    if (!a || !b) return false
    if (a.kind !== b.kind) return false
    if (a.kind === "hole") return a.holeId === b.holeId
    return a.componentId === b.componentId && a.id === b.id
  }

  getWireColorFromAnchors(startAnchor, endAnchor = null) {
    const pick = (a) => {
      if (!a) return null
      if (a.componentType === "battery5v" && a.id === "positive") return 0xff2a2a
      if (a.componentType === "battery5v" && a.id === "negative") return 0x5bc0de
      return null
    }
    return pick(startAnchor) ?? pick(endAnchor) ?? 0x111111
  }

  finalizeWireDraftToAnchor(endAnchor, handEntry) {
    if (!endAnchor || !handEntry || !this.wireDraftStartAnchor) return false
    if (this.wireDraftHandIndex !== handEntry.index) return false
    if (!this.stateSyncSystem || !this.canRunWireAction()) return false
    const startAnchor = this.wireDraftStartAnchor
    if (this.isSameWireAnchor(startAnchor, endAnchor)) return false
    const points = [startAnchor.worldPos.clone(), ...this.wireDraftWaypoints.map((p) => p.clone()), endAnchor.worldPos.clone()]
    if (points.length < 2) return false
    const id        = this.generateComponentId("wire")
    const wireColor = this.getWireColorFromAnchors(startAnchor, endAnchor)
    const data = {
      id, type: "wire",
      transform: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
      meta: {
        color: wireColor,
        points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        startAnchor: this.serializeWireAnchor(startAnchor),
        endAnchor:   this.serializeWireAnchor(endAnchor),
      },
    }
    this.appState.addComponent(data)
    this.stateSyncSystem.addMeshFromComponent(data)
    this.clearWireDraft()
    this.clearWireHoverAnchor()
    handEntry.isPinching      = true
    handEntry.pinchArmed      = false
    handEntry.wirePinchCloseMs = 0
    console.log("✅ Cable cerrado entre A y B")
    return true
  }

  findComponentMeshById(componentId) {
    if (!componentId || !this.stateSyncSystem) return null
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
        const found = mesh.userData.getTerminalWorldPositions().find((t) => t.id === anchor.id)
        return found ? found.worldPos.clone() : null
      }
      if (anchor.kind === "pin" && typeof mesh.userData?.getPinWorldPositions === "function") {
        const found = mesh.userData.getPinWorldPositions().find((p) => p.id === anchor.id)
        return found ? found.worldPos.clone() : null
      }
    }
    if (anchor.worldPos) return new THREE.Vector3(anchor.worldPos.x, anchor.worldPos.y, anchor.worldPos.z)
    return null
  }

  getWireEndpointWorldPosition(wireMesh, endpointType) {
    if (!wireMesh?.userData?.isWire) return null
    const anchor   = endpointType === "start" ? wireMesh.userData.startAnchor : wireMesh.userData.endAnchor
    const resolved = this.resolveAnchorWorldPosition(anchor)
    if (resolved) return resolved
    const fp = Array.isArray(wireMesh.userData.fixedPoints) ? wireMesh.userData.fixedPoints : null
    if (!fp || fp.length < 2) return null
    return endpointType === "start" ? fp[0].clone() : fp[fp.length - 1].clone()
  }

  getAllWireEndpoints() {
    const endpoints = []
    if (!this.stateSyncSystem) return endpoints
    for (const mesh of this.stateSyncSystem.meshById.values()) {
      if (!mesh?.userData?.isWire) continue
      const sw = this.getWireEndpointWorldPosition(mesh, "start")
      const ew = this.getWireEndpointWorldPosition(mesh, "end")
      if (sw) endpoints.push({ kind: "wire-endpoint", endpointType: "start", wireId: mesh.userData.componentId, worldPos: sw })
      if (ew) endpoints.push({ kind: "wire-endpoint", endpointType: "end",   wireId: mesh.userData.componentId, worldPos: ew })
    }
    return endpoints
  }

  findBestWireEndpointForHand(handEntry, maxDist = this.wireEndpointHoverMaxDist) {
    if (!handEntry || !this.isHandEntryTracked(handEntry)) return null
    if (handEntry.heldObject || !this.stateSyncSystem || this.wireDraftStartAnchor) return null
    this.getGrabPointWorld(handEntry, this._tmpC)
    let best = null, bestDist = maxDist
    for (const ep of this.getAllWireEndpoints()) {
      const d = ep.worldPos.distanceTo(this._tmpC)
      if (d > bestDist) continue
      best = ep; bestDist = d
    }
    return best ? { ...best, distance: bestDist, handIndex: handEntry.index } : null
  }

  deleteWireById(wireId) {
    if (!wireId || !this.stateSyncSystem) return false
    this.appState.removeComponent(wireId)
    this.stateSyncSystem.removeMeshById(wireId)
    return true
  }

  reopenWireFromEndEndpoint(endpoint, handEntry) {
    if (!endpoint || endpoint.endpointType !== "end" || !handEntry || !this.stateSyncSystem) return false
    const wireMesh = this.stateSyncSystem.getMeshById(endpoint.wireId)
    if (!wireMesh?.userData?.isWire) return false
    const startAnchor = wireMesh.userData.startAnchor
    const fp = Array.isArray(wireMesh.userData.fixedPoints) ? wireMesh.userData.fixedPoints.map((p) => p.clone()) : []
    if (!startAnchor || fp.length < 2) return false
    this.deleteWireById(endpoint.wireId)
    this.wireDraftStartAnchor = { ...startAnchor, worldPos: this.resolveAnchorWorldPosition(startAnchor) || fp[0].clone() }
    this.wireDraftHandIndex   = handEntry.index
    this.wireDraftWaypoints   = fp.slice(1, -1)
    this.wireDraftColor       = wireMesh.userData.wireColor ?? 0x111111
    const mesh = this.ensureWireDraftMesh(0)
    if (mesh.material?.color) mesh.material.color.setHex(this.wireDraftColor)
    mesh.visible = true
    this.clearWireHoverAnchor()
    handEntry.isPinching      = true
    handEntry.pinchArmed      = false
    handEntry.wirePinchCloseMs = 0
    return true
  }

  updateDynamicWires() {
    if (!this.stateSyncSystem) return
    for (const mesh of this.stateSyncSystem.meshById.values()) {
      if (!mesh?.userData?.isWire) continue
      if (typeof mesh.userData?.rebuildWireGeometry !== "function") continue
      const fp = Array.isArray(mesh.userData.fixedPoints) ? mesh.userData.fixedPoints.map((p) => p.clone()) : []
      if (fp.length < 2) continue
      const sw = this.resolveAnchorWorldPosition(mesh.userData.startAnchor)
      const ew = this.resolveAnchorWorldPosition(mesh.userData.endAnchor)
      if (sw) fp[0] = sw
      if (ew) fp[fp.length - 1] = ew
      mesh.userData.rebuildWireGeometry(fp)
    }
  }

  updateWireDraftPreview() {
    if (this.toolMode !== "wire") { this.clearWireDraft(); return }
    if (!this.wireDraftStartAnchor) {
      for (const m of this._wireDraftMeshes) { if (m) m.visible = false }
      return
    }
    const handEntry = this.hands.find((h) => h.index === this.wireDraftHandIndex)
    if (!handEntry || !this.isHandEntryTracked(handEntry)) {
      for (const m of this._wireDraftMeshes) { if (m) m.visible = false }
      return
    }
    this.getGrabPointWorld(handEntry, this._tmpA)
    const pts = this.getWireDraftPoints(this._tmpA.clone())
    if (pts.length < 2) { for (const m of this._wireDraftMeshes) { if (m) m.visible = false }; return }
    const needed = pts.length - 1
    for (let i = 0; i < needed; i++) { this.updateWireDraftSegment(this.ensureWireDraftMesh(i), pts[i], pts[i + 1]) }
    for (let i = needed; i < this._wireDraftMeshes.length; i++) { const m = this._wireDraftMeshes[i]; if (m) m.visible = false }
  }

  // ---------------------------
  // updateUIPoke — UNIFICADO
  // Detecta poke tanto de botones UI del panel como de componentes con onPress (botón/switch)
  // Para botones de componente: pressButton al tocar, releaseButton al alejar
  // ---------------------------
  updateUIPoke() {
    if (this.hands.some((h) => h.heldObject)) return

    // --- Gestión de botones de componente presionados (release al alejarse) ---
    for (const [handIndex, pressedObj] of this._handHeldButton.entries()) {
      const handEntry = this.hands.find((h) => h.index === handIndex)
      if (!handEntry || !this.isHandEntryTracked(handEntry)) {
        // Perdió tracking → soltar
        if (typeof pressedObj.userData?.releaseButton === "function") {
          pressedObj.userData.releaseButton()
        }
        this._handHeldButton.delete(handIndex)
        continue
      }

      this.getIndexTipWorld(handEntry, this._tmpA)
      const d = this.distanceToObjectSurface(pressedObj, this._tmpA)

      if (d > this.uiReleaseRadius) {
        if (typeof pressedObj.userData?.releaseButton === "function") {
          pressedObj.userData.releaseButton()
        }
        this._handHeldButton.delete(handIndex)
      }
    }

    // --- Cooldown para botones UI ---
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

    // --- Buscar nuevo objeto a tocar ---
    let bestObj  = null
    let bestDist = this.uiPokeRadius
    let bestHand = null

    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h)) continue
      if (h.heldObject) continue
      if (this._handHeldButton.has(h.index)) continue  // ya tiene botón presionado

      this.getIndexTipWorld(h, this._tmpA)

      for (const obj of this.interactables) {
        if (obj.userData?.isSurface) continue

        // Botones UI del panel
        if (obj.userData?.isUI) {
          const d = this.distanceToObjectSurface(obj, this._tmpA)
          if (d < bestDist) { bestDist = d; bestObj = obj; bestHand = h }
          continue
        }

        // Componentes con onPress (botón/switch) — sin importar si están insertados
        if (this.isComponentWithOnPress(obj)) {
          const d = this.distanceToObjectSurface(obj, this._tmpA)
          if (d < bestDist) { bestDist = d; bestObj = obj; bestHand = h }
        }
      }
    }

    if (!bestObj || !bestHand) return

    if (bestObj.userData?.isUI) {
      // Botón del panel: onPress normal
      if (typeof bestObj.userData?.onPress === "function") {
        bestObj.userData.onPress()
        this._lastPokedButton = bestObj
      }
    } else if (bestObj.userData?.isButtonComponent) {
      // Botón momentáneo: pressButton + registrar para release
      if (typeof bestObj.userData?.pressButton === "function") {
        bestObj.userData.pressButton()
        this._handHeldButton.set(bestHand.index, bestObj)
      }
    } else if (bestObj.userData?.isSwitchComponent) {
      // Switch: onPress (toggle con cooldown interno)
      if (typeof bestObj.userData?.onPress === "function") {
        bestObj.userData.onPress()
        this._lastPokedButton = bestObj
      }
    }
  }

  computePinchDistance(hand) {
    const thumbTip = this.getJointWorld(hand, "thumb-tip", this._tmpA)
    if (!thumbTip) return null
    let best = Infinity
    for (const name of ["index-finger-tip", "index-finger-phalanx-distal", "index-finger-phalanx-intermediate"]) {
      const p = this.getJointWorld(hand, name, this._tmpB)
      if (!p) continue
      const d = thumbTip.distanceTo(p)
      if (d < best) best = d
    }
    return isFinite(best) ? best : null
  }

  canHandGrabObject(handEntry, obj) {
    if (!obj?.userData?.componentId || !this.isObjectFreeForGrab(obj)) return false
    const extra = this.isAnyOtherHandHolding(handEntry)
      ? this.handGrabExpandedBoxMarginWhenOtherHandBusy
      : this.handGrabExpandedBoxMargin
    this.getGrabPointWorld(handEntry, this._tmpC)
    if (this.getObjectCenterDistance(obj, this._tmpC) > this.nearRadius) return false
    if (this.getExpandedBoxDistance(obj, this._tmpC, extra) > 0.0001 &&
        this.distanceToObjectSurface(obj, this._tmpC) > this.handGrabSurfaceMaxDist + this.handGrabSurfaceSlack) return false
    return true
  }

  findNearestComponentToHand(handEntry, maxDist) {
    this.getGrabPointWorld(handEntry, this._tmpC)
    let best = null, bestScore = Infinity
    const extra = this.isAnyOtherHandHolding(handEntry)
      ? this.handGrabExpandedBoxMarginWhenOtherHandBusy
      : this.handGrabExpandedBoxMargin
    for (const obj of this.interactables) {
      if (!obj?.userData?.componentId || !this.isObjectFreeForGrab(obj)) continue
      const sd = this.distanceToObjectSurface(obj, this._tmpC)
      const cd = this.getObjectCenterDistance(obj, this._tmpC)
      const ed = this.getExpandedBoxDistance(obj, this._tmpC, extra)
      if (cd > maxDist) continue
      if (sd > this.handGrabSurfaceMaxDist + this.handGrabSurfaceSlack && ed > 0.0001) continue
      const score = ed * 6 + sd * 2.4 + cd
      if (score < bestScore) { bestScore = score; best = obj }
    }
    return best
  }

  persistMeshTransform(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return
    const p = mesh.position, q = mesh.quaternion
    this.appState.updateComponent(id, { transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w } })
  }

  startHoldTracking(holdState, sourceType, source) {
    holdState.active = true; holdState.sourceType = sourceType; holdState.source = source
    holdState.lastT  = performance.now(); holdState.vel.set(0, 0, 0); holdState.samples.length = 0
    if (sourceType === "controller") source.getWorldPosition(holdState.lastPos)
    else this.getGrabPointWorld(source, holdState.lastPos)
  }

  stopHoldTracking(holdState) {
    holdState.active = false; holdState.sourceType = null; holdState.source = null
    holdState.lastT  = 0;     holdState.vel.set(0, 0, 0);  holdState.samples.length = 0
  }

  updateHoldVelocity(holdState) {
    if (!holdState?.active || !holdState.sourceType || !holdState.source) return
    const now = performance.now(), dt = (now - holdState.lastT) / 1000
    if (dt <= 0.0001) return
    if (holdState.sourceType === "controller") holdState.source.getWorldPosition(this._tmpA)
    else this.getGrabPointWorld(holdState.source, this._tmpA)
    const v = this._tmpA.clone().sub(holdState.lastPos).multiplyScalar(1 / dt)
    holdState.samples.push({ v, t: now })
    while (holdState.samples.length > holdState.maxSamples) holdState.samples.shift()
    const minT = now - holdState.sampleWindowMs
    while (holdState.samples.length && holdState.samples[0].t < minT) holdState.samples.shift()
    if (holdState.samples.length) { holdState.vel.set(0, 0, 0); for (const s of holdState.samples) holdState.vel.add(s.v); holdState.vel.multiplyScalar(1 / holdState.samples.length) }
    else holdState.vel.copy(v)
    holdState.lastPos.copy(this._tmpA); holdState.lastT = now
  }

  getReleaseVelocity(holdState, forceZero = false) {
    if (forceZero) return new THREE.Vector3()
    const v = holdState.vel.clone().multiplyScalar(this.throwVelocityMultiplier)
    if (v.length() < this.throwMinSpeed) v.set(0, 0, 0)
    return v
  }

  getBestSurfaceBelow(object) {
    if (!object || this.surfaces.length === 0) return null
    const origin = object.position.clone(); origin.y += 2
    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))
    const disallowed = Array.isArray(object.userData?.surfaceDisallowedTypes) ? object.userData.surfaceDisallowedTypes : []
    const entries    = this.surfaces.filter((s) => !disallowed.includes(s.type))
    if (entries.length === 0) return null
    const hits = this.downRaycaster.intersectObjects(entries.map((s) => s.mesh), true)
    if (hits.length === 0) return null
    return this.pickBestSurfaceHit(hits, object)
  }

  resolveSurfacePenetration(object) {
    if (!object || this.surfaces.length === 0) return false
    const best = this.getBestSurfaceBelow(object)
    if (!best) return false
    const co = object.userData?.surfaceContactObject || object
    this._box.setFromObject(co); this._box.getSize(this._tmpSize)
    const center = new THREE.Vector3(); this._box.getCenter(center)
    const halfY  = this._tmpSize.y * 0.5
    if (center.y - halfY < best.point.y) {
      object.position.y += (best.point.y + halfY - center.y) + 0.001
      if (object.userData?.surfaceUpright) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).setY(0)
        let yaw = object.rotation.y
        if (fwd.lengthSq() > 1e-8) { fwd.normalize(); yaw = Math.atan2(fwd.x, fwd.z) }
        object.rotation.set(0, yaw, 0); object.updateMatrixWorld(true)
      }
      return true
    }
    return false
  }

  trySnapComponentPinsToHoles(object, maxDist = 0.05) {
    if (!object || !this.holeSystem) return false
    if (!object.userData?.getPinWorldPositions) return false
    if (!Array.isArray(object.userData?.pins) || object.userData.pins.length === 0) return false
    const pwp     = object.userData.getPinWorldPositions()
    const matches = this.holeSystem.getNearestHolesForPins(pwp, maxDist)
    if (!Array.isArray(matches) || matches.length === 0) return false
    const valid = matches.filter((m) => !!m.hole)
    if (valid.length !== object.userData.pins.length) return false
    const pinA = object.userData.pins[0], pinB = object.userData.pins[1]
    if (!pinA || !pinB) return false
    const mA = valid.find((m) => m.pinId === pinA.id), mB = valid.find((m) => m.pinId === pinB.id)
    if (!mA || !mB) return false
    object.userData.pinConnections = { [pinA.id]: mA.hole.id, [pinB.id]: mB.hole.id }
    const dir = new THREE.Vector3().subVectors(mB.hole.worldPos, mA.hole.worldPos).setY(0)
    if (dir.lengthSq() < 1e-8) return false
    dir.normalize()
    object.rotation.set(0, Math.atan2(-dir.z, dir.x), 0); object.updateMatrixWorld(true)
    const rpAW = new THREE.Vector3().copy(pinA.localPos); object.localToWorld(rpAW)
    object.position.add(new THREE.Vector3().subVectors(mA.hole.worldPos, rpAW))
    object.position.y -= 0.02; object.updateMatrixWorld(true)
    const id = object.userData?.componentId
    if (id) this.appState.updateComponent(id, { inserted: true, pinConnections: { [pinA.id]: mA.hole.id, [pinB.id]: mB.hole.id } })
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
      if (fwd.lengthSq() > 1e-8) { fwd.normalize(); yaw = Math.atan2(fwd.x, fwd.z) }
      object.rotation.set(0, yaw, 0); object.updateMatrixWorld(true)
    }
    const co = object.userData?.surfaceContactObject || object
    const bbox = new THREE.Box3().setFromObject(co)
    const size = new THREE.Vector3(), center = new THREE.Vector3()
    bbox.getSize(size); bbox.getCenter(center)
    const halfY  = size.y * 0.5
    const drop   = (center.y - halfY) - best.point.y
    if (drop < -0.03 || drop > this.directPlaceMaxDrop) return false
    object.position.y += (best.point.y + halfY - center.y)
    if (this.holeSystem && Array.isArray(object.userData?.pins)) this.holeSystem.trySnapObject(object, 0.03)
    this.persistMeshTransform(object)
    return true
  }

  releaseHeldObject(object, holdState, clearOwner, options = {}) {
    if (!object) return
    this.updateHoldVelocity(holdState)
    const vel = this.getReleaseVelocity(holdState, options.forceZeroVelocity ?? false)
    this.scene.attach(object); this.clearObjectOwner(object)
    this.resolveSurfacePenetration(object)
    if (this.trySnapComponentPinsToHoles(object, 0.05)) { object.userData.physics = null; clearOwner(); this.stopHoldTracking(holdState); this.clearActivePinHoleMarkers(); return }
    if (vel.lengthSq() === 0 && this.tryPlaceObjectDirectly(object)) { clearOwner(); this.stopHoldTracking(holdState); this.clearActivePinHoleMarkers(); return }
    object.userData.physics = { active: true, vel }
    clearOwner(); this.stopHoldTracking(holdState); this.clearActivePinHoleMarkers()
  }

  onHandPinchStart(handEntry) {
    if (!this.isHandEntryTracked(handEntry) || handEntry.heldObject || !handEntry.pinchArmed) return
    handEntry.isPinching = true; handEntry.pinchArmed = false
    handEntry.lostTrackingMs = 0; handEntry.openPinchMs = 0

    if (this.toolMode === "wire") {
      const hoverAnchor   = !!this.wireHoverAnchor   && this.wireHoverHandIndex === handEntry.index
      const hoverEndpoint = !!this.wireHoverEndpoint && this.wireHoverHandIndex === handEntry.index
      if (!this.wireDraftStartAnchor) {
        if (hoverEndpoint) {
          if (!this.canRunWireAction()) return
          if (this.wireHoverEndpoint.endpointType === "start") { const d = this.deleteWireById(this.wireHoverEndpoint.wireId); if (d) { handEntry.isPinching = true; handEntry.pinchArmed = false; handEntry.wirePinchCloseMs = 0; this.clearWireHoverAnchor() } return }
          if (this.wireHoverEndpoint.endpointType === "end")   { this.reopenWireFromEndEndpoint(this.wireHoverEndpoint, handEntry); return }
        }
        if (hoverAnchor && this.canRunWireAction()) { this.startWireDraftFromAnchor(this.wireHoverAnchor, handEntry.index); console.log("🟢 Punto A:", this.wireHoverAnchor) }
        return
      }
      if (this.wireDraftHandIndex !== handEntry.index) return
      if (hoverAnchor) { const c = this.finalizeWireDraftToAnchor(this.wireHoverAnchor, handEntry); if (c) console.log("🔌 Punto B:", this.wireHoverAnchor) }
      else { const a = this.addWireWaypointFromHand(handEntry); if (a) console.log("〰️ Waypoint agregado") }
      return
    }

    const target = this.findNearestComponentToHand(handEntry, this.nearRadius)
    if (!target || !this.canHandGrabObject(handEntry, target)) return
    if (target.userData?.inserted || target.userData?.pinConnections) {
      target.userData.inserted = false; target.userData.pinConnections = null
      const id = target.userData?.componentId
      if (id) this.appState.updateComponent(id, { inserted: false, pinConnections: null })
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
    handEntry.isPinching = false; handEntry.openPinchMs = 0; handEntry.lostTrackingMs = 0
    if (this.toolMode === "wire" || !handEntry.heldObject) return
    this.releaseHeldObject(handEntry.heldObject, handEntry.hold, () => { handEntry.heldObject = null }, options)
  }

  forceReleaseHand(handEntry, forceZero = true) {
    if (!handEntry) return
    handEntry.isPinching = false; handEntry.openPinchMs = 0; handEntry.lostTrackingMs = 0
    if (this.toolMode === "wire") { this.stopHoldTracking(handEntry.hold); return }
    if (!handEntry.heldObject)   { this.stopHoldTracking(handEntry.hold); return }
    this.onHandPinchEnd(handEntry, { forceZeroVelocity: forceZero })
  }

  // ---------------------------
  // CONTROLADOR: selectstart — UI, botón, switch, grab
  // ---------------------------
  onControllerSelectStart(event) {
    const controller = event.target
    if (!controller || controller.userData?.heldObject) return

    if (this.toolMode === "wire") return

    const target = this.computeControllerHoverFor(controller)
    if (!target || target.userData?.isSurface) return

    // Botón UI del panel
    if (target.userData?.isUI && typeof target.userData?.onPress === "function") {
      target.userData.onPress()
      return
    }

    // Botón momentáneo de componente
    if (target.userData?.isButtonComponent && typeof target.userData?.pressButton === "function") {
      target.userData.pressButton()
      const idx = controller.userData.sourceIndex ?? 0
      // Guardar para soltar en selectend
      if (!controller.userData._pressedComponent) controller.userData._pressedComponent = null
      controller.userData._pressedComponent = target
      return
    }

    // Switch de componente
    if (target.userData?.isSwitchComponent && typeof target.userData?.onPress === "function") {
      target.userData.onPress()
      return
    }

    // Grab normal
    if (!target.userData?.componentId || !this.isObjectFreeForGrab(target)) return
    if (target.userData?.inserted || target.userData?.pinConnections) {
      target.userData.inserted = false; target.userData.pinConnections = null
      const id = target.userData?.componentId
      if (id) this.appState.updateComponent(id, { inserted: false, pinConnections: null })
    }
    controller.userData.heldObject = target
    this.setObjectOwner(target, this.makeOwnerToken("controller", controller.userData.sourceIndex ?? 0))
    this.startHoldTracking(controller.userData.hold, "controller", controller)
    controller.attach(target)
  }

  // ---------------------------
  // CONTROLADOR: selectend — soltar botón o grab
  // ---------------------------
  onControllerSelectEnd(event) {
    const controller = event?.target
    if (!controller) return

    // Soltar botón de componente si estaba presionado
    if (controller.userData?._pressedComponent) {
      const pressed = controller.userData._pressedComponent
      if (typeof pressed.userData?.releaseButton === "function") {
        pressed.userData.releaseButton()
      }
      controller.userData._pressedComponent = null
      return
    }

    // Soltar grab normal
    if (!controller.userData?.heldObject) return
    this.releaseHeldObject(
      controller.userData.heldObject,
      controller.userData.hold,
      () => { controller.userData.heldObject = null }
    )
  }

  pickBestSurfaceHit(hits, object = null) {
    const getEntry = (hitObj) => {
      for (const s of this.surfaces) {
        let cur = hitObj
        while (cur) { if (cur === s.mesh) return s; cur = cur.parent }
      }
      return null
    }
    const disallowed = Array.isArray(object?.userData?.surfaceDisallowedTypes) ? object.userData.surfaceDisallowedTypes : []
    const filtered   = hits.filter((h) => { const s = getEntry(h.object); return s && !disallowed.includes(s.type) })
    for (const priority of ["protoboard", "table", "floor"]) {
      const h = filtered.find((h) => getEntry(h.object)?.type === priority)
      if (h) return { ...h, surface: getEntry(h.object) }
    }
    const h = filtered[0]
    return h ? { ...h, surface: getEntry(h.object) } : null
  }

  computeHandHover() {
    if (!this.nearEnabled) return null
    let best = null, bestScore = Infinity
    for (const h of this.hands) {
      if (!this.isHandEntryTracked(h) || h.heldObject) continue
      this.getGrabPointWorld(h, this._tmpA)
      for (const obj of this.interactables) {
        if (!obj || obj.userData?.isSurface) continue
        if (obj.userData?.componentId && !this.isObjectFreeForGrab(obj)) continue
        if (obj.userData?.isUI) {
          const d = this.distanceToObjectSurface(obj, this._tmpA)
          if (d < bestScore && d < this.uiPokeRadius * 2) { bestScore = d; best = obj }
          continue
        }
        const sd = this.distanceToObjectSurface(obj, this._tmpA)
        const cd = this.getObjectCenterDistance(obj, this._tmpA)
        const ed = this.getExpandedBoxDistance(obj, this._tmpA, this.handHoverExpandedBoxMargin)
        if (cd > this.nearRadius) continue
        if (sd > this.handHoverSurfaceMaxDist && ed > 0.0001) continue
        const score = ed * 6 + sd * 2.4 + cd
        if (score < bestScore) { bestScore = score; best = obj }
      }
    }
    return best
  }

  updateHeldObjects() {
    let active = null
    for (const h of this.hands) { if (h.heldObject) { this.updateHoldVelocity(h.hold); active = h.heldObject } }
    for (const c of this.controllers) { if (c.userData?.heldObject) { this.updateHoldVelocity(c.userData.hold); active = c.userData.heldObject } }
    if (active) this.updatePinHoleMarkersForHeldObject(active)
    else this.clearActivePinHoleMarkers()
  }

  cleanupDetachedHolds() {
    for (const h of this.hands) {
      if (h.heldObject && h.heldObject.parent === this.scene) {
        this.clearObjectOwner(h.heldObject); h.heldObject = null
        h.isPinching = false; h.openPinchMs = 0; h.lostTrackingMs = 0
        this.stopHoldTracking(h.hold)
      }
    }
    for (const c of this.controllers) {
      if (c.userData?.heldObject && c.userData.heldObject.parent === this.scene) {
        this.clearObjectOwner(c.userData.heldObject); c.userData.heldObject = null
        this.stopHoldTracking(c.userData.hold)
      }
    }
  }

  updateHandPinchState(dtMs) {
    for (const h of this.hands) {
      const tracked = this.isHandEntryTracked(h)
      const dist    = tracked ? this.computePinchDistance(h.hand) : null

      if (!tracked || dist == null) {
        if (h.heldObject) {
          h.lostTrackingMs += dtMs
          if (h.lostTrackingMs >= this.handTrackingReleaseGraceMs) { this.forceReleaseHand(h, true); h.pinchArmed = true }
        } else {
          h.isPinching = false; h.pinchArmed = true; h.openPinchMs = 0; h.lostTrackingMs = 0
          this.stopHoldTracking(h.hold)
        }
        continue
      }

      h.lostTrackingMs = 0
      if (dist >= this.pinchReleaseResetDist) h.pinchArmed = true

      if (this.toolMode === "wire") {
        const hasAH = !!this.wireHoverAnchor, hasEH = !!this.wireHoverEndpoint
        const isSH  = this.wireHoverHandIndex === h.index
        const hasDH = !!this.wireDraftStartAnchor && this.wireDraftHandIndex === h.index
        const tt = this.getJointWorld(h.hand, "thumb-tip",         this._tmpE)
        const it = this.getJointWorld(h.hand, "index-finger-tip",  this._tmpF)
        let wd = Infinity
        if (tt && it) wd = tt.distanceTo(it)
        const close = wd <= this.wirePinchStartDist, open = wd >= this.wirePinchEndDist
        if (open) { h.isPinching = false; h.pinchArmed = true; h.wirePinchCloseMs = 0 }
        const canAcc = close && h.pinchArmed && !h.isPinching && ((hasAH || hasEH) && isSH || hasDH)
        h.wirePinchCloseMs = canAcc ? h.wirePinchCloseMs + dtMs : 0
        if (h.pinchArmed && !h.isPinching && canAcc) { h.wirePinchCloseMs = 0; this.onHandPinchStart(h) }
        continue
      }

      if (h.heldObject) {
        if (dist >= this.pinchEndDist) { h.openPinchMs += dtMs; if (h.openPinchMs >= this.handOpenReleaseGraceMs) this.onHandPinchEnd(h) }
        else { h.openPinchMs = 0; h.isPinching = true }
        continue
      }

      h.openPinchMs = 0
      if (dist <= this.pinchStartDist && h.pinchArmed) this.onHandPinchStart(h)
      else if (dist > this.pinchEndDist) h.isPinching = false
    }
  }

  clearActivePinHoleMarkers() {
    for (const m of this._activePinHoleMarkers) { if (m?.parent) m.parent.remove(m) }
    this._activePinHoleMarkers.length = 0
  }

  updatePinHoleMarkersForHeldObject(object) {
    this.clearActivePinHoleMarkers()
    if (!object || !this.holeSystem || !object.userData?.getPinWorldPositions) return
    for (const match of this.holeSystem.getNearestHolesForPins(object.userData.getPinWorldPositions(), 0.05)) {
      if (!match.hole) continue
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }))
      marker.position.copy(match.hole.worldPos)
      this.scene.add(marker)
      this._activePinHoleMarkers.push(marker)
    }
  }

  update() {
    if (!this.renderer.xr.isPresenting) return

    const now  = performance.now()
    const dtMs = Math.min(50, now - this._lastUpdateTime)
    this._lastUpdateTime = now

    const handsActive = this.isHandTrackingActive()
    this.updateControllerRays(!handsActive)

    if (handsActive) {
      this.updateUIPoke()
      this.updateHandPinchState(dtMs)
      this.updateWireHover()
      this.updateWireDraftPreview()
    } else {
      this.clearWireHoverAnchor()
      this.clearWireDraft()
      for (const h of this.hands) { this.forceReleaseHand(h, true); h.pinchArmed = true }
    }

    this.cleanupDetachedHolds()
    this.updateHeldObjects()
    this.updateDynamicWires()

    if (this.toolMode === "wire") { this.setHover(null); return }

    const anyHeld = this.hands.some((h) => !!h.heldObject) || this.controllers.some((c) => !!c.userData?.heldObject)
    if (anyHeld) { this.setHover(null); return }

    this.setHover(handsActive ? this.computeHandHover() : this.computeControllerHover())
  }
}