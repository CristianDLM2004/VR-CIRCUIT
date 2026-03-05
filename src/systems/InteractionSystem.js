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
    this.selected = null
    this.selectedBy = null // "controller" | "hand"
    this._selectedHandEntry = null
    this._selectedController = null

    this.controllerRays = []

    this.nearEnabled = true
    this.nearRadius = 0.12

    this.pinchStartDist = 0.065
    this.pinchEndDist = 0.085

    this.uiPokeRadius = 0.020
    this.uiReleaseRadius = 0.040

    this._tmpA = new THREE.Vector3()
    this._tmpB = new THREE.Vector3()
    this._tmpC = new THREE.Vector3()
    this._box = new THREE.Box3()

    this._lastPokedButton = null

    // Throw tuning
    this.throwVelocityMultiplier = 2.4
    this.throwMinSpeed = 0.03

    this._hold = {
      active: false,
      lastPos: new THREE.Vector3(),
      lastT: 0,
      vel: new THREE.Vector3(),
      source: null,
      sourceType: null,
      samples: [],
      maxSamples: 8,
      sampleWindowMs: 120,
    }

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

  isHandTrackingActive() {
    const session = this.renderer.xr.getSession?.()
    if (!session) return false
    return Array.from(session.inputSources || []).some((src) => !!src.hand)
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

  persistMeshTransform(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return
    const p = mesh.position
    const q = mesh.quaternion
    this.appState.updateComponent(id, {
      transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w },
    })
  }

  _startHoldTracking(sourceType, source) {
    this._hold.active = true
    this._hold.sourceType = sourceType
    this._hold.source = source
    this._hold.lastT = performance.now()
    this._hold.vel.set(0, 0, 0)
    this._hold.samples.length = 0

    if (sourceType === "controller") source.getWorldPosition(this._hold.lastPos)
    else this.getIndexTipWorld(source, this._hold.lastPos)
  }

  _stopHoldTracking() {
    this._hold.active = false
    this._hold.sourceType = null
    this._hold.source = null
    this._hold.lastT = 0
    this._hold.vel.set(0, 0, 0)
    this._hold.samples.length = 0
  }

  _updateHoldVelocity() {
    if (!this._hold.active || !this._hold.sourceType || !this._hold.source) return

    const now = performance.now()
    const dt = (now - this._hold.lastT) / 1000
    if (dt <= 0.0001) return

    if (this._hold.sourceType === "controller") this._hold.source.getWorldPosition(this._tmpA)
    else this.getIndexTipWorld(this._hold.source, this._tmpA)

    const v = this._tmpA.clone().sub(this._hold.lastPos).multiplyScalar(1 / dt)

    this._hold.samples.push({ v, t: now })
    while (this._hold.samples.length > this._hold.maxSamples) this._hold.samples.shift()

    const minT = now - this._hold.sampleWindowMs
    while (this._hold.samples.length && this._hold.samples[0].t < minT) this._hold.samples.shift()

    if (this._hold.samples.length) {
      this._hold.vel.set(0, 0, 0)
      for (const s of this._hold.samples) this._hold.vel.add(s.v)
      this._hold.vel.multiplyScalar(1 / this._hold.samples.length)
    } else {
      this._hold.vel.copy(v)
    }

    this._hold.lastPos.copy(this._tmpA)
    this._hold.lastT = now
  }

  _getReleaseVelocity() {
    const v = this._hold.vel.clone().multiplyScalar(this.throwVelocityMultiplier)
    if (v.length() < this.throwMinSpeed) v.set(0, 0, 0)
    return v
  }

  // ✅ failsafe: soltar forzado (por pérdida de tracking, etc.)
  _forceReleaseSelected() {
    if (!this.selected) return

    // última vel disponible
    this._updateHoldVelocity()
    const releaseVel = this._getReleaseVelocity()

    // suelta al mundo
    this.scene.attach(this.selected)
    this.selected.userData.physics = { active: true, vel: releaseVel }

    this.selected = null
    this.selectedBy = null
    this._selectedHandEntry = null
    this._selectedController = null
    this._stopHoldTracking()
  }

  onHandPinchStart(handEntry) {
    if (this.selected) return

    const target = this.findNearestComponentToHand(handEntry, this.nearRadius)
    if (!target) return

    this.selected = target
    this.selectedBy = "hand"
    this._selectedHandEntry = handEntry

    this._startHoldTracking("hand", handEntry)

    const joint = handEntry.hand.joints?.["index-finger-tip"]
    if (joint) joint.attach(this.selected)
    else handEntry.pinchPoint.attach(this.selected)
  }

  onHandPinchEnd() {
    if (!this.selected) return
    if (this.selectedBy !== "hand") return

    this._updateHoldVelocity()
    const releaseVel = this._getReleaseVelocity()

    this.scene.attach(this.selected)
    this.selected.userData.physics = { active: true, vel: releaseVel }

    this.selected = null
    this.selectedBy = null
    this._selectedHandEntry = null
    this._stopHoldTracking()
  }

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
    this._selectedController = controller

    this._startHoldTracking("controller", controller)

    controller.attach(this.selected)
  }

  onControllerSelectEnd() {
    if (!this.selected) return
    if (this.selectedBy !== "controller") return

    this._updateHoldVelocity()
    const releaseVel = this._getReleaseVelocity()

    this.scene.attach(this.selected)
    this.selected.userData.physics = { active: true, vel: releaseVel }

    this.selected = null
    this.selectedBy = null
    this._selectedController = null
    this._stopHoldTracking()
  }

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

  update() {
    if (!this.renderer.xr.isPresenting) return

    const handsActive = this.isHandTrackingActive()

    this.updateControllerRays(!handsActive)

    // ✅ failsafe: si estabas agarrando con mano y se perdió tracking => suelta
    if (!handsActive && this.selected && this.selectedBy === "hand") {
      this._forceReleaseSelected()
    }

    if (handsActive) {
      this.updateUIPoke()
      this.updateHandPinchState()
    }

    // ✅ failsafe extra: selected atorado pero ya está en scene
    if (this.selected && this.selected.parent === this.scene) {
      // ya no está realmente agarrado, liberar estado para permitir re-grab
      this.selected = null
      this.selectedBy = null
      this._selectedHandEntry = null
      this._selectedController = null
      this._stopHoldTracking()
    }

    if (this.selected) {
      this._updateHoldVelocity()
      return
    }

    const hovered = handsActive ? this.computeHandHover() : this.computeControllerHover()
    this.setHover(hovered)
  }
}