import * as THREE from "three"
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js"

export class InteractionSystem {
  constructor(sceneManager, appState) {
    this.sceneManager = sceneManager
    this.appState = appState

    this.scene = sceneManager.scene
    this.renderer = sceneManager.renderer

    // Raycaster para agarrar (Layer 1)
    this.raycaster = new THREE.Raycaster()
    this.raycaster.layers.set(1)

    this.tempMatrix = new THREE.Matrix4()

    // Raycaster para snap (Layer 2)
    this.downRaycaster = new THREE.Raycaster()
    this.downRaycaster.layers.set(2)

    this.controllers = []
    this.interactables = [] // meshes layer 1

    /**
     * Surfaces registradas:
     * [{ mesh, type: "table"|"floor", bounds?: {minX,maxX,minZ,maxZ} }]
     */
    this.surfaces = []

    this.hovered = null
    this.selected = null

    this.initControllers()
  }

  // -------------------------
  // Interactuables (componentes)
  // -------------------------
  register(mesh) {
    if (!mesh) return
    mesh.userData.interactable = true
    mesh.layers.set(1)

    if (!this.interactables.includes(mesh)) {
      this.interactables.push(mesh)
    }
  }

  unregister(mesh) {
    this.interactables = this.interactables.filter((m) => m !== mesh)
  }

  // -------------------------
  // Surfaces (piso/mesa)
  // -------------------------
  /**
   * @param {THREE.Object3D} mesh
   * @param {Object} options
   *  - type: "table" | "floor" (default "floor")
   *  - bounds: { minX,maxX,minZ,maxZ } EN MUNDO (recomendado para mesa)
   */
  registerSurface(mesh, options = {}) {
    if (!mesh) return

    const type = options.type || "floor"
    const bounds = options.bounds || null

    mesh.userData.isSurface = true
    mesh.userData.interactable = false
    mesh.layers.set(2)

    const existing = this.surfaces.find((s) => s.mesh === mesh)
    if (existing) {
      existing.type = type
      existing.bounds = bounds
      return
    }

    this.surfaces.push({ mesh, type, bounds })
  }

  initControllers() {
    const controllerModelFactory = new XRControllerModelFactory()

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i)
      controller.addEventListener("selectstart", (e) => this.onSelectStart(e))
      controller.addEventListener("selectend", () => this.onSelectEnd())
      this.scene.add(controller)

      const controllerGrip = this.renderer.xr.getControllerGrip(i)
      controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip))
      this.scene.add(controllerGrip)

      this.controllers.push(controller)
    }
  }

  // -------------------------
  // Hover highlight (solo visual)
  // -------------------------
  setHover(newHovered) {
    if (this.hovered === newHovered) return

    // Quitar highlight anterior
    if (this.hovered) {
      this.hovered.traverse?.((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x000000)
      })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x000000)
    }

    this.hovered = newHovered

    // Poner highlight nuevo
    if (this.hovered) {
      this.hovered.traverse?.((child) => {
        if (child.isMesh && child.material?.emissive) child.material.emissive.setHex(0x222222)
      })
      if (this.hovered.material?.emissive) this.hovered.material.emissive.setHex(0x222222)
    }
  }

  // -------------------------
  // Snap mejorado: mesa > piso + clamp
  // -------------------------
  snapToSurface(object) {
    if (!object || this.surfaces.length === 0) return

    // origin en mundo (asumimos que ya está attach a scene)
    const origin = object.position.clone()
    origin.y += 2

    this.downRaycaster.set(origin, new THREE.Vector3(0, -1, 0))

    // Intersecta meshes de surface (Layer 2 ya filtra)
    const surfaceMeshes = this.surfaces.map((s) => s.mesh)
    const hits = this.downRaycaster.intersectObjects(surfaceMeshes, true)
    if (hits.length === 0) return

    const best = this.pickBestSurfaceHit(hits)
    if (!best) return

    // Tamaño del objeto (para que repose sobre la superficie)
    const bbox = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    // 1) Ajustar altura (apoya sobre surface)
    object.position.y = best.point.y + size.y / 2

    // 2) Si es mesa con bounds: clamp X/Z (considera el tamaño del objeto para no “salirse”)
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
  }

  pickBestSurfaceHit(hits) {
    // Mapear hit.object a surface registrada (puede pegar a un child)
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

    // 1) Mesa dentro de bounds
    for (const h of hits) {
      const surf = getSurfaceEntry(h.object)
      if (!surf || surf.type !== "table" || !surf.bounds) continue

      const { minX, maxX, minZ, maxZ } = surf.bounds
      const x = h.point.x
      const z = h.point.z

      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
        return { ...h, surface: surf }
      }
    }

    // 2) Piso (primer floor)
    for (const h of hits) {
      const surf = getSurfaceEntry(h.object)
      if (surf?.type === "floor") return { ...h, surface: surf }
    }

    // 3) Fallback: el primero con surface
    for (const h of hits) {
      const surf = getSurfaceEntry(h.object)
      if (surf) return { ...h, surface: surf }
    }

    return null
  }

  // -------------------------
  // Select handlers
  // -------------------------
  onSelectStart(event) {
    const controller = event.target
    if (!this.hovered) return

    // ✅ Nunca permitir agarrar algo sin componentId
    if (!this.hovered.userData?.componentId) return

    this.selected = this.hovered
    controller.attach(this.selected)
  }

  onSelectEnd() {
    if (!this.selected) return

    // volver al mundo (scene) para que el snap sea en coords mundo
    this.scene.attach(this.selected)
    this.snapToSurface(this.selected)

    // Guardar transform
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
  // Update: hover por raycast (Layer 1)
  // -------------------------
  update() {
    if (this.selected) return

    let best = null

    for (const controller of this.controllers) {
      this.tempMatrix.identity().extractRotation(controller.matrixWorld)

      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix)

      // ✅ Intersecta SOLO Layer 1 por configuración del raycaster
      const hits = this.raycaster.intersectObjects(this.interactables, true)

      if (hits.length > 0) {
        let obj = hits[0].object
        while (obj && obj.parent && !obj.userData?.componentId) obj = obj.parent

        if (obj?.userData?.componentId) {
          best = obj
          break
        }
      }
    }

    this.setHover(best)
  }
}