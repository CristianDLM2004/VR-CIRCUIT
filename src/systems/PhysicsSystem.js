import * as THREE from "three"

/**
 * PhysicsSystem (ligero, sin libs externas)
 * - Aplica gravedad + integración simple a objetos "sueltos" (parent === scene)
 * - Colisión básica contra superficies registradas en InteractionSystem (raycast hacia abajo)
 * - Sleep cuando se detiene y persiste transform en AppState
 * - Limpieza por distancia/caída para no saturar
 */
export class PhysicsSystem {
  constructor(scene, camera, appState, stateSyncSystem, interactionSystem) {
    this.scene = scene
    this.camera = camera
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.interactionSystem = interactionSystem

    this._ray = new THREE.Raycaster()
    this._tmpOrigin = new THREE.Vector3()
    this._tmpDir = new THREE.Vector3(0, -1, 0)
    this._tmpSize = new THREE.Vector3()
    this._tmpCamPos = new THREE.Vector3()

    // bodies: id -> { vel, freeSinceMs, sleepMs }
    this.bodies = new Map()

    // Tuning (Quest-friendly)
    this.gravity = -9.8
    this.linearDrag = 0.08      // aire
    this.restitution = 0.22     // rebote vertical
    this.friction = 0.55        // fricción al tocar superficie
    this.restSpeed = 0.10       // velocidad para considerar "casi quieto"
    this.sleepAfterMs = 350     // tiempo quieto para dormir

    // Limpieza
    this.maxDistance = 8.0      // metros del usuario
    this.farAfterMs = 1500      // sólo borrar si lleva un ratito suelto
    this.fallYKill = -3.0       // si se cae demasiado
    this.floorTimeoutMs = 30000 // 30s suelto y lejos => borrar (evitar saturación)
    this.floorTimeoutDist = 4.0
  }

  ensureBodyForMesh(mesh, initialVel = null) {
    const id = mesh?.userData?.componentId
    if (!id) return null

    let body = this.bodies.get(id)
    if (!body) {
      body = {
        vel: new THREE.Vector3(),
        freeSinceMs: performance.now(),
        sleepMs: 0,
      }
      this.bodies.set(id, body)
    }

    if (initialVel) body.vel.copy(initialVel)
    return body
  }

  removeComponentById(id) {
    this.bodies.delete(id)
    this.appState.removeComponent(id)
    this.stateSyncSystem.rebuildFromState()
  }

  getSurfaceHitBelow(mesh) {
    if (!this.interactionSystem?.surfaces?.length) return null

    // origen un poco arriba del objeto
    this._tmpOrigin.copy(mesh.position)
    this._tmpOrigin.y += 1.5
    this._ray.set(this._tmpOrigin, this._tmpDir)

    const surfaceMeshes = this.interactionSystem.surfaces.map((s) => s.mesh)
    const hits = this._ray.intersectObjects(surfaceMeshes, true)
    if (!hits || hits.length === 0) return null

    // Prioridad: protoboard > table > floor (reutilizamos la lógica existente si está)
    if (typeof this.interactionSystem.pickBestSurfaceHit === "function") {
      return this.interactionSystem.pickBestSurfaceHit(hits)
    }
    return hits[0]
  }

  stepMesh(mesh, body, dt) {
    // integrar velocidad
    body.vel.y += this.gravity * dt

    // drag lineal
    const drag = Math.max(0, 1 - this.linearDrag * dt)
    body.vel.multiplyScalar(drag)

    // integrar posición
    mesh.position.x += body.vel.x * dt
    mesh.position.y += body.vel.y * dt
    mesh.position.z += body.vel.z * dt

    // colisión simple con superficie abajo
    const hit = this.getSurfaceHitBelow(mesh)
    if (hit) {
      // tamaño del mesh
      const bbox = new THREE.Box3().setFromObject(mesh)
      bbox.getSize(this._tmpSize)
      const halfY = this._tmpSize.y * 0.5

      const targetY = hit.point.y + halfY
      const eps = 0.002

      if (mesh.position.y <= targetY + eps && body.vel.y <= 0) {
        mesh.position.y = targetY

        // rebote vertical
        body.vel.y = -body.vel.y * this.restitution

        // fricción en XZ al impactar
        const fr = Math.max(0, 1 - this.friction)
        body.vel.x *= fr
        body.vel.z *= fr

        // Si ya casi no se mueve, acumular sleep
        const speed = body.vel.length()
        if (speed < this.restSpeed) {
          body.sleepMs += dt * 1000
        } else {
          body.sleepMs = 0
        }

        // Dormir: ya quedó estable
        if (body.sleepMs >= this.sleepAfterMs) {
          // Apagar física
          this.bodies.delete(mesh.userData.componentId)

          // Snap final (incluye holes si aplica) + persistencia
          if (this.interactionSystem?.snapToSurface) this.interactionSystem.snapToSurface(mesh)
          if (this.interactionSystem?.persistMeshTransform)
            this.interactionSystem.persistMeshTransform(mesh)

          // limpiar userData
          if (mesh.userData.physics) delete mesh.userData.physics
          return
        }
      }
    }

    // Seguridad: si cae al vacío, borrar
    if (mesh.position.y < this.fallYKill) {
      this.removeComponentById(mesh.userData.componentId)
      return
    }

    // Limpieza por distancia
    this.camera.getWorldPosition(this._tmpCamPos)
    const dist = mesh.position.distanceTo(this._tmpCamPos)
    const aliveMs = performance.now() - body.freeSinceMs

    if (dist > this.maxDistance && aliveMs > this.farAfterMs) {
      this.removeComponentById(mesh.userData.componentId)
      return
    }

    // Limpieza por tiempo suelto lejos (para no borrar lo que usas cerca)
    if (aliveMs > this.floorTimeoutMs && dist > this.floorTimeoutDist) {
      this.removeComponentById(mesh.userData.componentId)
      return
    }
  }

  update(meshIterable, dt) {
    if (!meshIterable) return
    if (!dt || !isFinite(dt)) return

    // iterar componentes actuales
    for (const mesh of meshIterable) {
      if (!mesh?.userData?.componentId) continue

      // sólo física en objetos sueltos (si están agarrados, parent != scene)
      if (mesh.parent !== this.scene) continue

      const id = mesh.userData.componentId

      // crear body si el mesh trae physics activo
      const phys = mesh.userData.physics
      if (phys?.active) {
        const body = this.ensureBodyForMesh(mesh, phys.vel || null)
        // borrar el flag para no reinyectar vel cada frame
        delete mesh.userData.physics
        if (body) body.freeSinceMs = performance.now()
      }

      const body = this.bodies.get(id)
      if (!body) continue

      this.stepMesh(mesh, body, dt)
    }
  }
}