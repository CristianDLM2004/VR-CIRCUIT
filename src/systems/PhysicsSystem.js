import * as THREE from "three"

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
    this._tmpEuler = new THREE.Euler()
    this._tmpQuat = new THREE.Quaternion()

    this.bodies = new Map()

    // Tuning
    this.gravity = -9.8

    // ✅ Menos drag => más alcance al lanzar
    this.linearDrag = 0.015

    // rebote/fricción
    this.restitution = 0.18
    this.friction = 0.25

    // sleep
    this.restSpeed = 0.12
    this.sleepAfterMs = 450

    // rotación
    this.angularDrag = 0.10
    this.spinFromThrow = 6.5 // rad/s por cada m/s (aprox)

    // Limpieza
    this.maxDistance = 10.0
    this.farAfterMs = 1500
    this.fallYKill = -3.0
    this.floorTimeoutMs = 45000
    this.floorTimeoutDist = 4.5
  }

  ensureBodyForMesh(mesh, initialVel = null) {
    const id = mesh?.userData?.componentId
    if (!id) return null

    let body = this.bodies.get(id)
    if (!body) {
      body = {
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        freeSinceMs: performance.now(),
        sleepMs: 0,
      }
      this.bodies.set(id, body)
    }

    if (initialVel) {
      body.vel.copy(initialVel)

      // ✅ spin proporcional a la velocidad (más real)
      const speed = initialVel.length()
      if (speed > 0.02) {
        body.angVel.set(
          (Math.random() * 2 - 1),
          (Math.random() * 2 - 1),
          (Math.random() * 2 - 1)
        )
        body.angVel.normalize().multiplyScalar(Math.min(12, speed * this.spinFromThrow))
      } else {
        body.angVel.set(0, 0, 0)
      }
    }

    return body
  }

  removeComponentById(id) {
    this.bodies.delete(id)
    this.appState.removeComponent(id)
    this.stateSyncSystem.rebuildFromState()
  }

  getSurfaceHitBelow(mesh) {
    if (!this.interactionSystem?.surfaces?.length) return null

    this._tmpOrigin.copy(mesh.position)
    this._tmpOrigin.y += 1.5
    this._ray.set(this._tmpOrigin, this._tmpDir)

    const surfaceMeshes = this.interactionSystem.surfaces.map((s) => s.mesh)
    const hits = this._ray.intersectObjects(surfaceMeshes, true)
    if (!hits || hits.length === 0) return null

    if (typeof this.interactionSystem.pickBestSurfaceHit === "function") {
      return this.interactionSystem.pickBestSurfaceHit(hits)
    }
    return hits[0]
  }

  integrateRotation(mesh, angVel, dt) {
    // integración simple: q = q * dq
    const ax = angVel.x * dt
    const ay = angVel.y * dt
    const az = angVel.z * dt

    // small-angle approx quaternion
    this._tmpQuat.set(ax, ay, az, 1.0).normalize()
    mesh.quaternion.multiply(this._tmpQuat).normalize()
  }

  settleToStablePose(mesh) {
    // ✅ “asentar”: que no quede en esquina
    // Para cubos (y en general), hacemos que quede "upright" (x/z ~ 0) conservando yaw.
    this._tmpEuler.setFromQuaternion(mesh.quaternion, "YXZ")
    const yaw = this._tmpEuler.y

    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0))
    mesh.quaternion.slerp(target, 0.75) // asienta rápido
  }

  stepMesh(mesh, body, dt) {
    // gravedad
    body.vel.y += this.gravity * dt

    // drag lineal (aire)
    const drag = Math.max(0, 1 - this.linearDrag * dt)
    body.vel.multiplyScalar(drag)

    // drag angular
    const ad = Math.max(0, 1 - this.angularDrag * dt)
    body.angVel.multiplyScalar(ad)

    // integrar posición
    mesh.position.x += body.vel.x * dt
    mesh.position.y += body.vel.y * dt
    mesh.position.z += body.vel.z * dt

    // integrar rotación
    if (body.angVel.lengthSq() > 1e-6) {
      this.integrateRotation(mesh, body.angVel, dt)
    }

    // colisión simple con superficie
    const hit = this.getSurfaceHitBelow(mesh)
    if (hit) {
      const bbox = new THREE.Box3().setFromObject(mesh)
      bbox.getSize(this._tmpSize)
      const halfY = this._tmpSize.y * 0.5

      const targetY = hit.point.y + halfY
      const eps = 0.002

      if (mesh.position.y <= targetY + eps && body.vel.y <= 0) {
        mesh.position.y = targetY

        // rebote vertical
        body.vel.y = -body.vel.y * this.restitution

        // fricción al contacto (XZ)
        const fr = Math.max(0, 1 - this.friction)
        body.vel.x *= fr
        body.vel.z *= fr

        // amortiguar giro en contacto
        body.angVel.multiplyScalar(0.78)

        // sleep logic
        const speed = body.vel.length() + body.angVel.length() * 0.08
        if (speed < this.restSpeed) {
          body.sleepMs += dt * 1000
        } else {
          body.sleepMs = 0
        }

        if (body.sleepMs >= this.sleepAfterMs) {
          // asentar a pose estable y persistir
          this.settleToStablePose(mesh)

          this.bodies.delete(mesh.userData.componentId)

          if (this.interactionSystem?.persistMeshTransform)
            this.interactionSystem.persistMeshTransform(mesh)

          if (mesh.userData.physics) delete mesh.userData.physics
          return
        }
      }
    }

    // caídas al vacío
    if (mesh.position.y < this.fallYKill) {
      this.removeComponentById(mesh.userData.componentId)
      return
    }

    // limpieza por distancia
    this.camera.getWorldPosition(this._tmpCamPos)
    const dist = mesh.position.distanceTo(this._tmpCamPos)
    const aliveMs = performance.now() - body.freeSinceMs

    if (dist > this.maxDistance && aliveMs > this.farAfterMs) {
      this.removeComponentById(mesh.userData.componentId)
      return
    }

    if (aliveMs > this.floorTimeoutMs && dist > this.floorTimeoutDist) {
      this.removeComponentById(mesh.userData.componentId)
      return
    }
  }

  update(meshIterable, dt) {
    if (!meshIterable) return
    if (!dt || !isFinite(dt)) return

    for (const mesh of meshIterable) {
      if (!mesh?.userData?.componentId) continue
      if (mesh.parent !== this.scene) continue

      const id = mesh.userData.componentId

      const phys = mesh.userData.physics
      if (phys?.active) {
        const body = this.ensureBodyForMesh(mesh, phys.vel || null)
        delete mesh.userData.physics
        if (body) body.freeSinceMs = performance.now()
      }

      const body = this.bodies.get(id)
      if (!body) continue

      this.stepMesh(mesh, body, dt)
    }
  }
}