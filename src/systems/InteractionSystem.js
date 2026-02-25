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
    this.interactables = [] // SOLO roots de componentes (Layer 1)
    this.surfaces = [] // [{ mesh, type, bounds }]

    this.hovered = null
    this.selected = null

    this.initControllers()
  }

  // -------------------------
  // Helpers de jerarquía
  // -------------------------
  isDescendant(child, parent) {
    let cur = child
    while (cur) {
      if (cur === parent) return true
      cur = cur.parent
    }
    return false
  }

  hasSurfaceInAncestry(obj) {
    let cur = obj
    while (cur) {
      if (cur.userData?.isSurface) return true
      cur = cur.parent
    }
    return false
  }

  findRootWithComponentId(obj) {
    let cur = obj
    while (cur) {
      if (cur.userData?.componentId) return cur
      cur = cur.parent
    }
    return null
  }

  isRegisteredInteractableRoot(root) {
    // root debe ser exactamente uno de los meshes registrados (los que crea ComponentFactory)
    return this.interactables.includes(root)
  }

  // -------------------------
  // Interactuables (componentes)
  // -------------------------
  register(mesh) {
    if (!mesh) return

    // Si por error intentan registrar surfaces, no permitir
    if (mesh.userData?.isSurface) return

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
  registerSurface(mesh, options = {}) {
    if (!mesh) return

    const type = options.type || "floor"
    const bounds = options.bounds || null

    mesh.userData.isSurface = true
    mesh.userData.interactable = false

    // Blindaje extra: si por cualquier razón trae componentId, se lo quitamos
    if ("componentId" in mesh.userData) delete mesh.userData.componentId

    mesh.layers.set(2)

    // si estaba en interactables por error, sácalo
    this.unregister(mesh)

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
  // Snap: mesa > piso + clamp
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
      if (!surf || surf.type !== "table" || !surf.bounds) continue

      const { minX, maxX, minZ, maxZ } = surf.bounds
      const x = h.point.x
      const z = h.point.z

      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
        return { ...h, surface: surf }
      }
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
  // Select handlers
  // -------------------------
  onSelectStart(event) {
    const controller = event.target
    if (!this.hovered) return

    // Blindaje duro: nunca agarrar surfaces ni hijos de surfaces
    if (this.hovered.userData?.isSurface) return
    if (this.hasSurfaceInAncestry(this.hovered)) return

    // Solo componentes reales registrados
    if (!this.hovered.userData?.componentId) return
    if (!this.isRegisteredInteractableRoot(this.hovered)) return

    this.selected = this.hovered
    controller.attach(this.selected)
  }

  onSelectEnd() {
    if (!this.selected) return

    this.scene.attach(this.selected)
    this.snapToSurface(this.selected)

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

      const hits = this.raycaster.intersectObjects(this.interactables, true)
      if (hits.length === 0) continue

      // Busca el primer hit que realmente sea un componente ROOT registrado
      for (const h of hits) {
        const root = this.findRootWithComponentId(h.object)
        if (!root) continue

        // Blindaje duro: si por error el root es surface (o cuelga de surface), ignorar
        if (root.userData?.isSurface) continue
        if (this.hasSurfaceInAncestry(root)) continue

        // Solo si el root está registrado como interactuable real
        if (!this.isRegisteredInteractableRoot(root)) continue

        best = root
        break
      }

      if (best) break
    }

    this.setHover(best)
  }
}