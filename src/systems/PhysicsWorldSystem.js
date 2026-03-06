import * as THREE from "three"
import * as CANNON from "cannon-es"

export class PhysicsWorldSystem {
  constructor(scene, appState, stateSyncSystem) {
    this.scene = scene
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem

    // Cannon world
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    })

    // Materiales
    this.matDefault = new CANNON.Material("default")
    this.contactDefault = new CANNON.ContactMaterial(this.matDefault, this.matDefault, {
      friction: 0.55,
      restitution: 0.12,
    })
    this.world.defaultContactMaterial = this.contactDefault
    this.world.allowSleep = true

    // id -> body
    this.bodyById = new Map()

    // temporales
    this._tmpWorldPos = new THREE.Vector3()
    this._tmpWorldQuat = new THREE.Quaternion()

    this._accum = 0
    this.fixedTimeStep = 1 / 90
    this.maxSubSteps = 3
  }

  // ---------------------------
  // Estáticos
  // ---------------------------
  addStaticBoxFromMesh(mesh, options = {}) {
    const { material = this.matDefault } = options

    const box3 = new THREE.Box3().setFromObject(mesh)
    const size = new THREE.Vector3()
    box3.getSize(size)

    const center = new THREE.Vector3()
    box3.getCenter(center)

    const half = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)
    const shape = new CANNON.Box(half)

    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      mass: 0,
      material,
    })

    body.addShape(shape)
    body.position.set(center.x, center.y, center.z)

    mesh.getWorldQuaternion(this._tmpWorldQuat)
    body.quaternion.set(
      this._tmpWorldQuat.x,
      this._tmpWorldQuat.y,
      this._tmpWorldQuat.z,
      this._tmpWorldQuat.w
    )

    this.world.addBody(body)
    return body
  }

  addStaticFloorPlane(y = 0) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: this.matDefault,
    })
    const shape = new CANNON.Plane()
    body.addShape(shape)
    body.position.set(0, y, 0)
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    this.world.addBody(body)
    return body
  }

  // ---------------------------
  // Dinámicos
  // ---------------------------
  ensureBodyForMesh(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return null
    if (this.bodyById.has(id)) return this.bodyById.get(id)

    // Por ahora solo cubo 0.2
    const sx = 0.2
    const sy = 0.2
    const sz = 0.2

    const shape = new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2))

    const body = new CANNON.Body({
      mass: 0.25,
      material: this.matDefault,
      linearDamping: 0.02,
      angularDamping: 0.04,
      allowSleep: true,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.35,
    })

    body.addShape(shape)

    // ✅ usar transform mundial inicial
    mesh.getWorldPosition(this._tmpWorldPos)
    mesh.getWorldQuaternion(this._tmpWorldQuat)

    body.position.set(this._tmpWorldPos.x, this._tmpWorldPos.y, this._tmpWorldPos.z)
    body.quaternion.set(
      this._tmpWorldQuat.x,
      this._tmpWorldQuat.y,
      this._tmpWorldQuat.z,
      this._tmpWorldQuat.w
    )

    this.world.addBody(body)
    this.bodyById.set(id, body)

    return body
  }

  removeBodyById(id) {
    const body = this.bodyById.get(id)
    if (!body) return
    this.world.removeBody(body)
    this.bodyById.delete(id)
  }

  setGrabbed(mesh, grabbed) {
    const id = mesh?.userData?.componentId
    if (!id) return

    const body = this.ensureBodyForMesh(mesh)
    if (!body) return

    if (grabbed) {
      body.type = CANNON.Body.KINEMATIC
      body.mass = 0
      body.updateMassProperties()
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)

      // ✅ sync con transform mundial actual
      mesh.getWorldPosition(this._tmpWorldPos)
      mesh.getWorldQuaternion(this._tmpWorldQuat)

      body.position.set(this._tmpWorldPos.x, this._tmpWorldPos.y, this._tmpWorldPos.z)
      body.quaternion.set(
        this._tmpWorldQuat.x,
        this._tmpWorldQuat.y,
        this._tmpWorldQuat.z,
        this._tmpWorldQuat.w
      )

      body.wakeUp()
    } else {
      body.type = CANNON.Body.DYNAMIC
      body.mass = 0.25
      body.updateMassProperties()
      body.wakeUp()
    }
  }

  applyReleaseVelocity(mesh, linearVel, angularVel = null) {
    const body = this.ensureBodyForMesh(mesh)
    if (!body) return

    // ✅ CLAVE: usar transform mundial del mesh ya suelto
    mesh.getWorldPosition(this._tmpWorldPos)
    mesh.getWorldQuaternion(this._tmpWorldQuat)

    body.position.set(this._tmpWorldPos.x, this._tmpWorldPos.y, this._tmpWorldPos.z)
    body.quaternion.set(
      this._tmpWorldQuat.x,
      this._tmpWorldQuat.y,
      this._tmpWorldQuat.z,
      this._tmpWorldQuat.w
    )

    body.type = CANNON.Body.DYNAMIC
    body.mass = 0.25
    body.updateMassProperties()
    body.wakeUp()

    body.velocity.set(linearVel.x, linearVel.y, linearVel.z)

    if (angularVel) {
      body.angularVelocity.set(angularVel.x, angularVel.y, angularVel.z)
    } else {
      body.angularVelocity.set(0, 0, 0)
    }
  }

  // Mientras está agarrado: body sigue la transform mundial del mesh
  syncBodyToMesh(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return

    const body = this.ensureBodyForMesh(mesh)
    if (!body) return
    if (body.type !== CANNON.Body.KINEMATIC) return

    mesh.getWorldPosition(this._tmpWorldPos)
    mesh.getWorldQuaternion(this._tmpWorldQuat)

    body.position.set(this._tmpWorldPos.x, this._tmpWorldPos.y, this._tmpWorldPos.z)
    body.quaternion.set(
      this._tmpWorldQuat.x,
      this._tmpWorldQuat.y,
      this._tmpWorldQuat.z,
      this._tmpWorldQuat.w
    )

    body.velocity.set(0, 0, 0)
    body.angularVelocity.set(0, 0, 0)
    body.wakeUp()
  }

  syncMeshFromBody(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return

    const body = this.bodyById.get(id)
    if (!body) return

    // ✅ si el mesh sigue agarrado (parent != scene), NO lo pises desde el body
    if (mesh.parent !== this.scene) return
    if (body.type === CANNON.Body.KINEMATIC) return

    mesh.position.set(body.position.x, body.position.y, body.position.z)
    mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
  }

  persistIfSleeping(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return

    const body = this.bodyById.get(id)
    if (!body) return

    if (body.sleepState === CANNON.Body.SLEEPING) {
      const p = mesh.position
      const q = mesh.quaternion
      this.appState.updateComponent(id, {
        transform: {
          x: p.x,
          y: p.y,
          z: p.z,
          qx: q.x,
          qy: q.y,
          qz: q.z,
          qw: q.w,
        },
      })
    }
  }

  cleanupBodies(meshesIterable) {
    const aliveIds = new Set()
    for (const mesh of meshesIterable) {
      const id = mesh?.userData?.componentId
      if (id) aliveIds.add(id)
    }

    for (const id of this.bodyById.keys()) {
      if (!aliveIds.has(id)) this.removeBodyById(id)
    }
  }

  step(meshesIterable, dt) {
    this._accum += dt
    const maxAccum = this.fixedTimeStep * this.maxSubSteps
    if (this._accum > maxAccum) this._accum = maxAccum

    while (this._accum >= this.fixedTimeStep) {
      this.world.step(this.fixedTimeStep)
      this._accum -= this.fixedTimeStep
    }

    for (const mesh of meshesIterable) {
      if (!mesh?.userData?.componentId) continue

      this.ensureBodyForMesh(mesh)

      // agarrado -> body sigue al mesh
      this.syncBodyToMesh(mesh)

      // libre -> mesh sigue al body
      this.syncMeshFromBody(mesh)

      this.persistIfSleeping(mesh)
    }

    this.cleanupBodies(meshesIterable)
  }
}