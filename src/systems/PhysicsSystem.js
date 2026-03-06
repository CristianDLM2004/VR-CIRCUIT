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
    this._tmpQuat = new THREE.Quaternion()

    this.bodies = new Map()

    // ---------------------------
    // Dinámica base
    // ---------------------------
    this.gravity = -9.8
    this.linearDrag = 0.015
    this.angularDrag = 0.10

    this.restitution = 0.18
    this.friction = 0.25

    // Umbrales de reposo
    this.restLinearSpeed = 0.06       // m/s
    this.restAngularSpeed = 0.55      // rad/s aprox (en nuestro sistema es “arbitrario” pero consistente)
    this.restHoldMs = 90              // ✅ tiempo mínimo en reposo antes de tip/settle (casi imperceptible)

    // “Legacy” (ya no manda, pero lo dejamos por seguridad)
    this.sleepAfterMs = 120

    this.spinFromThrow = 6.5

    // ---------------------------
    // Tip-over + settle
    // ---------------------------
    this.tipOverDuration = 0.28
    this.tipOverAngleThreshold = THREE.MathUtils.degToRad(10)
    this.settleDuration = 0.18

    // ---------------------------
    // Limpieza
    // ---------------------------
    this.maxDistance = 10.0
    this.farAfterMs = 1500
    this.fallYKill = -3.0
    this.floorTimeoutMs = 45000
    this.floorTimeoutDist = 4.5

    // 24 orientaciones estables de un cubo
    this.stableCubeQuaternions = this.buildStableCubeQuaternions()
  }

  // ---------------------------
  // Orientaciones estables cubo
  // ---------------------------
  buildStableCubeQuaternions() {
    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ]

    const quats = []

    for (const yAxis of dirs) {
      for (const zAxis of dirs) {
        if (Math.abs(yAxis.dot(zAxis)) > 1e-6) continue
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)
        if (xAxis.lengthSq() < 1e-6) continue
        xAxis.normalize()

        const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
        const q = new THREE.Quaternion().setFromRotationMatrix(m)

        let duplicate = false
        for (const existing of quats) {
          const dot = Math.abs(existing.dot(q))
          if (dot > 0.9999) {
            duplicate = true
            break
          }
        }
        if (!duplicate) quats.push(q)
      }
    }

    return quats
  }

  getNearestStableQuaternion(currentQuat) {
    let best = this.stableCubeQuaternions[0]
    let bestDot = -Infinity
    for (const q of this.stableCubeQuaternions) {
      const dot = Math.abs(currentQuat.dot(q))
      if (dot > bestDot) {
        bestDot = dot
        best = q
      }
    }
    return best
  }

  getQuatAngularDistance(a, b) {
    const dot = THREE.MathUtils.clamp(Math.abs(a.dot(b)), -1, 1)
    return 2 * Math.acos(dot)
  }

  // ---------------------------
  // Bodies
  // ---------------------------
  ensureBodyForMesh(mesh, initialVel = null) {
    const id = mesh?.userData?.componentId
    if (!id) return null

    let body = this.bodies.get(id)
    if (!body) {
      body = {
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        freeSinceMs: performance.now(),

        // legacy
        sleepMs: 0,

        // ✅ nuevo: reposo continuo
        restTimeMs: 0,

        tipping: false,
        tipT: 0,
        tipStartQuat: new THREE.Quaternion(),
        tipTargetQuat: new THREE.Quaternion(),

        settling: false,
        settleT: 0,
        settleStartQuat: new THREE.Quaternion(),
        settleTargetQuat: new THREE.Quaternion(),
      }
      this.bodies.set(id, body)
    }

    if (initialVel) {
      body.vel.copy(initialVel)
      const speed = initialVel.length()
      if (speed > 0.02) {
        body.angVel.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
        body.angVel.normalize().multiplyScalar(Math.min(12, speed * this.spinFromThrow))
      } else {
        body.angVel.set(0, 0, 0)
      }
    }

    body.sleepMs = 0
    body.restTimeMs = 0
    body.tipping = false
    body.tipT = 0
    body.settling = false
    body.settleT = 0

    return body
  }

  removeComponentById(id) {
    this.bodies.delete(id)
    this.appState.removeComponent(id)
    this.stateSyncSystem.rebuildFromState()
  }

  // ---------------------------
  // Surface helpers
  // ---------------------------
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

  alignHeightToSurface(mesh) {
    const hit = this.getSurfaceHitBelow(mesh)
    if (!hit) return

    const bbox = new THREE.Box3().setFromObject(mesh)
    bbox.getSize(this._tmpSize)
    const halfY = this._tmpSize.y * 0.5
    mesh.position.y = hit.point.y + halfY
  }

  // ---------------------------
  // Rotación
  // ---------------------------
  integrateRotation(mesh, angVel, dt) {
    const ax = angVel.x * dt
    const ay = angVel.y * dt
    const az = angVel.z * dt
    this._tmpQuat.set(ax, ay, az, 1.0).normalize()
    mesh.quaternion.multiply(this._tmpQuat).normalize()
  }

  // ---------------------------
  // Tip-over + settle
  // ---------------------------
  startTipOver(mesh, body, targetQuat) {
    body.tipping = true
    body.tipT = 0
    body.tipStartQuat.copy(mesh.quaternion)
    body.tipTargetQuat.copy(targetQuat)
    body.vel.set(0, 0, 0)
    body.angVel.set(0, 0, 0)
  }

  updateTipOver(mesh, body, dt) {
    body.tipT += dt
    const t = Math.min(1, body.tipT / this.tipOverDuration)
    const eased = t * t * (3 - 2 * t)
    mesh.quaternion.copy(body.tipStartQuat).slerp(body.tipTargetQuat, eased)
    this.alignHeightToSurface(mesh)

    if (t >= 1) {
      body.tipping = false
      this.startSettling(mesh, body, body.tipTargetQuat)
    }
  }

  startSettling(mesh, body, targetQuat = null) {
    body.settling = true
    body.settleT = 0
    body.settleStartQuat.copy(mesh.quaternion)
    body.settleTargetQuat.copy(targetQuat || this.getNearestStableQuaternion(mesh.quaternion))
    body.vel.set(0, 0, 0)
    body.angVel.set(0, 0, 0)
  }

  updateSettling(mesh, body, dt) {
    body.settleT += dt
    const t = Math.min(1, body.settleT / this.settleDuration)
    const eased = 1 - Math.pow(1 - t, 3)
    mesh.quaternion.copy(body.settleStartQuat).slerp(body.settleTargetQuat, eased)
    this.alignHeightToSurface(mesh)

    if (t >= 1) {
      mesh.quaternion.copy(body.settleTargetQuat)
      body.settling = false
      this.bodies.delete(mesh.userData.componentId)

      if (this.interactionSystem?.persistMeshTransform) {
        this.interactionSystem.persistMeshTransform(mesh)
      }
    }
  }

  // ---------------------------
  // Simulación principal
  // ---------------------------
  stepMesh(mesh, body, dt) {
    if (body.tipping) {
      this.updateTipOver(mesh, body, dt)
      return
    }
    if (body.settling) {
      this.updateSettling(mesh, body, dt)
      return
    }

    // gravedad
    body.vel.y += this.gravity * dt

    // drag lineal
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

    // contacto con superficie
    const hit = this.getSurfaceHitBelow(mesh)
    let onSurface = false

    if (hit) {
      const bbox = new THREE.Box3().setFromObject(mesh)
      bbox.getSize(this._tmpSize)
      const halfY = this._tmpSize.y * 0.5

      const targetY = hit.point.y + halfY
      const eps = 0.006

      if (mesh.position.y <= targetY + eps && body.vel.y <= 0) {
        onSurface = true
        mesh.position.y = targetY

        // rebote
        body.vel.y = -body.vel.y * this.restitution

        // si el rebote ya es mínimo, cortarlo (evita “vibración eterna”)
        if (Math.abs(body.vel.y) < 0.08) body.vel.y = 0

        // fricción
        const fr = Math.max(0, 1 - this.friction)
        body.vel.x *= fr
        body.vel.z *= fr

        // amortiguar giro fuerte al tocar
        body.angVel.multiplyScalar(0.78)

        // legacy counter por si acaso
        const legacySpeed = body.vel.length() + body.angVel.length() * 0.08
        if (legacySpeed < 0.14) body.sleepMs += dt * 1000
        else body.sleepMs = 0
      }
    }

    // ✅ NUEVO: si está en superficie y realmente ya casi quieto, acumular reposo continuo
    if (onSurface) {
      const lin = body.vel.length()
      const ang = body.angVel.length()

      if (lin < this.restLinearSpeed && ang < this.restAngularSpeed) {
        body.restTimeMs += dt * 1000
      } else {
        body.restTimeMs = 0
      }

      // ✅ dispara tip/settle sin esperar “un segundo”
      if (body.restTimeMs >= this.restHoldMs) {
        const targetQuat = this.getNearestStableQuaternion(mesh.quaternion)
        const angle = this.getQuatAngularDistance(mesh.quaternion, targetQuat)

        if (angle > this.tipOverAngleThreshold) this.startTipOver(mesh, body, targetQuat)
        else this.startSettling(mesh, body, targetQuat)

        return
      }
    } else {
      body.restTimeMs = 0
    }

    // fallback legacy (por seguridad)
    if (body.sleepMs >= this.sleepAfterMs && onSurface) {
      const targetQuat = this.getNearestStableQuaternion(mesh.quaternion)
      const angle = this.getQuatAngularDistance(mesh.quaternion, targetQuat)
      if (angle > this.tipOverAngleThreshold) this.startTipOver(mesh, body, targetQuat)
      else this.startSettling(mesh, body, targetQuat)
      return
    }

    // cleanup
    if (mesh.position.y < this.fallYKill) {
      this.removeComponentById(mesh.userData.componentId)
      return
    }

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