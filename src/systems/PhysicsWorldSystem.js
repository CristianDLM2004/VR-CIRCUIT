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

    // Materiales (fricción / rebote)
    this.matDefault = new CANNON.Material("default")
    this.contactDefault = new CANNON.ContactMaterial(this.matDefault, this.matDefault, {
      friction: 0.55,
      restitution: 0.12,
    })
    this.world.defaultContactMaterial = this.contactDefault
    this.world.allowSleep = true

    // Mapeo id -> body
    this.bodyById = new Map()

    // Reusables
    this._tmpV3 = new THREE.Vector3()
    this._tmpQ = new THREE.Quaternion()

    // Timing
    this._accum = 0
    this.fixedTimeStep = 1 / 90 // Quest va cómodo aquí
    this.maxSubSteps = 3
  }

  // ---------------------------
  // Colliders estáticos
  // ---------------------------
  addStaticBoxFromMesh(mesh, options = {}) {
    const { material = this.matDefault } = options

    // Bounding box en mundo
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

    // Si el mesh está rotado (ej: piso), también rotamos body
    mesh.getWorldQuaternion(this._tmpQ)
    body.quaternion.set(this._tmpQ.x, this._tmpQ.y, this._tmpQ.z, this._tmpQ.w)

    this.world.addBody(body)
    return body
  }

  // Piso como plano infinito (más robusto)
  addStaticFloorPlane(y = 0) {
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: this.matDefault })
    const shape = new CANNON.Plane()
    body.addShape(shape)
    body.position.set(0, y, 0)
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    this.world.addBody(body)
    return body
  }

  // ---------------------------
  // Dinámicos (componentes)
  // ---------------------------
  ensureBodyForMesh(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return null
    if (this.bodyById.has(id)) return this.bodyById.get(id)

    // Por ahora: cubo 0.2
    const sx = 0.2,
      sy = 0.2,
      sz = 0.2
    const shape = new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2))

    const body = new CANNON.Body({
      mass: 0.25, // peso aparente
      material: this.matDefault,
      linearDamping: 0.02,
      angularDamping: 0.04,
      allowSleep: true,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.35,
    })

    body.addShape(shape)

    // sync inicial from mesh -> body
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z)
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w)

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

  // Cuando agarras: desactivamos física (kinematic-like)
  setGrabbed(mesh, grabbed) {
    const id = mesh?.userData?.componentId
    if (!id) return
    const body = this.bodyById.get(id)
    if (!body) return

    if (grabbed) {
      body.type = CANNON.Body.KINEMATIC
      body.mass = 0
      body.updateMassProperties()
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
      body.sleepState = CANNON.Body.AWAKE
    } else {
      body.type = CANNON.Body.DYNAMIC
      body.mass = 0.25
      body.updateMassProperties()
      body.sleepState = CANNON.Body.AWAKE
    }
  }

  // Al soltar: aplicamos velocidades reales
  applyReleaseVelocity(mesh, linearVel, angularVel = null) {
    const body = this.ensureBodyForMesh(mesh)
    if (!body) return

    body.type = CANNON.Body.DYNAMIC
    body.mass = 0.25
    body.updateMassProperties()
    body.sleepState = CANNON.Body.AWAKE

    body.velocity.set(linearVel.x, linearVel.y, linearVel.z)

    if (angularVel) {
      body.angularVelocity.set(angularVel.x, angularVel.y, angularVel.z)
    }
  }

  // Sync mesh -> body mientras es kinematic (si lo mueves con la mano)
  syncBodyToMesh(mesh) {
    const body = this.ensureBodyForMesh(mesh)
    if (!body) return
    if (body.type !== CANNON.Body.KINEMATIC) return

    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z)
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w)
    body.velocity.set(0, 0, 0)
    body.angularVelocity.set(0, 0, 0)
    body.sleepState = CANNON.Body.AWAKE
  }

  // Sync body -> mesh cuando es dinámico
  syncMeshFromBody(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return
    const body = this.bodyById.get(id)
    if (!body) return
    if (body.type === CANNON.Body.KINEMATIC) return

    mesh.position.set(body.position.x, body.position.y, body.position.z)
    mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
  }

  // Persistimos al estado cuando el cuerpo está “dormido”
  persistIfSleeping(mesh) {
    const id = mesh?.userData?.componentId
    if (!id) return
    const body = this.bodyById.get(id)
    if (!body) return

    if (body.sleepState === CANNON.Body.SLEEPING) {
      const p = mesh.position
      const q = mesh.quaternion
      this.appState.updateComponent(id, {
        transform: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w },
      })
    }
  }

  step(meshesIterable, dt) {
    // substeps fijos
    this._accum += dt
    const maxAccum = this.fixedTimeStep * this.maxSubSteps
    if (this._accum > maxAccum) this._accum = maxAccum

    while (this._accum >= this.fixedTimeStep) {
      this.world.step(this.fixedTimeStep)
      this._accum -= this.fixedTimeStep
    }

    // Sync
    for (const mesh of meshesIterable) {
      if (!mesh?.userData?.componentId) continue
      this.ensureBodyForMesh(mesh)

      // Si está agarrado, body sigue al mesh (kinematic)
      this.syncBodyToMesh(mesh)

      // Si no, el mesh sigue al body
      this.syncMeshFromBody(mesh)

      // Persist si ya está dormido
      this.persistIfSleeping(mesh)
    }
  }
}