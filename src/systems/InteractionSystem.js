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

    // Raycasters (sin layers)
    this.raycaster = new THREE.Raycaster()
    this.downRaycaster = new THREE.Raycaster()
    this.tempMatrix = new THREE.Matrix4()

    this.controllers = []
    this.hands = [] // { hand, pinchPoint }
    this.interactables = []
    this.surfaces = []
    this.holeSystem = null

    this.hovered = null
    this.selected = null
    this.selectedBy = null // "controller" | "hand"
    this.activeController = null
    this.activeHand = null

    // Visual rays SOLO para controladores
    this.controllerRays = [] // { controller, line, hitDot }

    // Near interaction settings (hands)
    this.nearEnabled = true
    this.nearRadius = 0.06 // 6 cm
    this._tmpV = new THREE.Vector3()
    this._tmpW = new THREE.Vector3()

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
  // XR Inputs: controllers + hands
  // -------------------------
  initXRInputs() {
    const controllerModelFactory = new XRControllerModelFactory()
    const handModelFactory = new XRHandModelFactory()

    for (let i = 0; i < 2; i++) {
      // ---- Controllers ----
      const controller = this.renderer.xr.getController(i)
      controller.addEventListener("selectstart", (e) => this.onControllerSelectStart(e))
      controller.addEventListener("selectend", () => this.onControllerSelectEnd())
      this.scene.add(controller)

      const controllerGrip = this.renderer.xr.getControllerGrip(i)
      controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
      this.scene.add(controllerGrip)

      // Ray visual solo en controller
      const { line, hitDot } = this.createControllerRay()
      controller.add(line)
      controller.add(hitDot)
      this.controllerRays.push({ controller, line, hitDot })

      this.controllers.push(controller)

      // ---- Hands ----
      const hand = this.renderer.xr.getHand(i)
      hand.add(handModelFactory.createHandModel(hand, "mesh"))
      this.scene.add(hand)

      // Pinch point (un pequeño target invisible que sigue el índice)
      const pinchPoint = new THREE.Object3D()
      pinchPoint.name = `PinchPoint_${i}`
      hand.add(pinchPoint)

      // Eventos de pinch (Quest suele soportarlos)
      hand.addEventListener("pinchstart", (e) => this.onHandPinchStart(e))
      hand.addEventListener("pinchend", () => this.onHandPinchEnd())

      // Fallback: algunos runtimes disparan selectstart en hand
      hand.addEventListener("selectstart", (e) => this.onHandPinchStart(e))
      hand.addEventListener("selectend", () => this.onHandPinchEnd())

      this.hands.push({ hand, pinchPoint })
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
  // Picking helper
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

  // -------------------------
  // Controller-based (ray) hover
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

  // Visual rays only for controllers
  updateControllerRays() {
    for (const r of this.controllerRays) {
      const controller = r.controller
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      const hits = this.raycaster.intersectObjects(this.interactables, true)

      let dist = 5
      if (hits.length > 0) dist = Math.min(5, Math.max(0.05, hits[0].distance))

      r.line.visible = true
      r.hitDot.visible = true
      r.line.scale.z = dist
      r.hitDot.position.z = -dist
    }
  }

  // -------------------------
  // Hand-based (near) hover
  // -------------------------
  getHandWorldPoint(handEntry) {
    // Intento 1: si existe el joint index-finger-tip, úsalo
    const hand = handEntry.hand
    const joint = hand.joints?.["index-finger-tip"]
    if (joint) {
      joint.getWorldPosition(this._tmpW)
      return this._tmpW
    }

    // Intento 2: fallback al pinchPoint
    handEntry.pinchPoint.getWorldPosition(this._tmpW)
    return this._tmpW
  }

  findNearestInteractable(worldPoint, maxDist = 0.06) {
    let best = null
    let bestD2 = maxDist * maxDist

    // buscamos el objeto “raíz” interactuable (botón o mesh con componentId)
    for (const obj of this.interactables) {
      if (!obj) continue
      if (obj.userData?.isSurface) continue

      obj.getWorldPosition(this._tmpV)
      const d2 = this._tmpV.distanceToSquared(worldPoint)

      if (d2 < bestD2) {
        bestD2 = d2
        best = obj
      }
    }

    return best
  }

  computeHandHover() {
    if (!this.nearEnabled) return null

    // Si ya estamos agarrando con controller, no estorbar
    if (this.selected && this.selectedBy === "controller") return null

    // Revisa ambas manos y toma el nearest global
    let best = null
    let bestD2 = this.nearRadius * this.nearRadius

    for (const h of this.hands) {
      const p = this.getHandWorldPoint(h)
      const nearest = this.findNearestInteractable(p, this.nearRadius)
      if (!nearest) continue

      nearest.getWorldPosition(this._tmpV)
      const d2 = this._tmpV.distanceToSquared(p)
      if (d2 < bestD2) {
        bestD2 = d2
        best = nearest
      }
    }

    return best
  }

  // -------------------------
  // Controller select
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

    // Grab only components
    if (!this.hovered.userData?.componentId) return

    this.selected = this.hovered
    this.selectedBy = "controller"
    this.activeController = controller
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
    this.activeController = null
  }

  // -------------------------
  // Hand pinch
  // -------------------------
  onHandPinchStart(event) {
    const hand = event.target

    // Si ya hay selección, no iniciar otra
    if (this.selected) return
    if (!this.hovered) return
    if (this.hovered.userData?.isSurface) return

    // UI press
    if (this.hovered.userData?.isUI && typeof this.hovered.userData?.onPress === "function") {
      this.hovered.userData.onPress()
      return
    }

    // Grab only components
    if (!this.hovered.userData?.componentId) return

    // Encontrar entry de mano
    const handEntry = this.hands.find((h) => h.hand === hand)
    if (!handEntry) return

    this.selected = this.hovered
    this.selectedBy = "hand"
    this.activeHand = handEntry

    // Attach al joint index-finger-tip si existe; si no, al pinchPoint
    const joint = hand.joints?.["index-finger-tip"]
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
    this.activeHand = null
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
  // PC Mouse (igual que antes)
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

    // click UI
    if (obj.userData?.isUI && typeof obj.userData?.onPress === "function") {
      obj.userData.onPress()
      return
    }

    if (!obj.userData?.componentId) return

    this.selected = obj
    this.selectedBy = "mouse"

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
    if (this.selectedBy !== "mouse") return

    this.snapToSurface(this.selected)
    this.persistSelectedTransform()

    this.selected = null
    this.selectedBy = null
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
  // Update loop
  // -------------------------
  update() {
    if (!this.renderer.xr.isPresenting) return

    // Rays solo controller
    this.updateControllerRays()

    // Si estamos agarrando algo, no cambiar hover
    if (this.selected) return

    // Preferencia:
    // - Si hay manos activas cerca, usa near hover
    // - Si no, usa controller ray hover
    const handHover = this.computeHandHover()
    const controllerHover = this.computeControllerHover()

    this.setHover(handHover || controllerHover)
  }
}