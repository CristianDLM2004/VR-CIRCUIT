import * as THREE from "three"

/**
 * TrashSystem
 * - Crea un bote de basura (mesh) en escena.
 * - Elimina componentes (por componentId) cuando:
 *    1) Están "libres" (parent === scene), o sea NO agarrados por mano/controlador
 *    2) Su bounding box intersecta el bounding box del bote
 *
 * Nota: No registra el bote como interactuable, para que no estorbe al ray/poke.
 */
export class TrashSystem {
  constructor(scene, appState, stateSyncSystem) {
    this.scene = scene
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem

    this.trashGroup = null
    this.trashBox = new THREE.Box3()
    this.tmpBox = new THREE.Box3()

    // Cooldown por id para evitar doble eliminación por frames cercanos
    this._lastDeleteMsById = new Map()
    this._deleteCooldownMs = 300
  }

  createTrashBin(position = new THREE.Vector3(-0.6, 0, -0.8)) {
    const group = new THREE.Group()
    group.name = "TrashBin"

    // Cuerpo
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.16, 0.28, 20),
      new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.85 })
    )
    body.name = "TrashBody"
    body.position.y = 0.14
    body.castShadow = true
    body.receiveShadow = true

    // Aro superior
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.155, 0.012, 10, 24),
      new THREE.MeshStandardMaterial({ color: 0x95a5a6, roughness: 0.6 })
    )
    rim.name = "TrashRim"
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.28
    rim.castShadow = true
    rim.receiveShadow = true

    // Señal visual (placa) para identificarlo rápido
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.06, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    )
    plate.name = "TrashPlate"
    plate.position.set(0, 0.18, 0.16)
    plate.castShadow = true

    // “Icono” simple (X)
    const iconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.006), iconMat)
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.006), iconMat)
    bar1.rotation.z = Math.PI / 4
    bar2.rotation.z = -Math.PI / 4
    bar1.position.z = 0.006
    bar2.position.z = 0.006
    plate.add(bar1, bar2)

    group.add(body, rim, plate)
    group.position.copy(position)

    // Metadata (por si luego quieres detectar/depurar)
    group.userData.isTrash = true
    body.userData.isTrash = true
    rim.userData.isTrash = true
    plate.userData.isTrash = true

    this.scene.add(group)

    this.trashGroup = group
    this.updateTrashBounds()
    return group
  }

  updateTrashBounds() {
    if (!this.trashGroup) return
    this.trashBox.setFromObject(this.trashGroup)
  }

  canDeleteNow(id) {
    const now = performance.now()
    const last = this._lastDeleteMsById.get(id) || 0
    if (now - last < this._deleteCooldownMs) return false
    this._lastDeleteMsById.set(id, now)
    return true
  }

  /**
   * Revisa un objeto y lo elimina si está dentro del bote.
   * Importante: solo elimina si object.parent === scene (objeto suelto).
   */
  checkObject(object) {
    if (!this.trashGroup) return false
    if (!object?.userData?.componentId) return false

    // ✅ Solo si está suelto (no agarrado por mano/controlador)
    if (object.parent !== this.scene) return false

    const id = object.userData.componentId
    if (!this.canDeleteNow(id)) return false

    this.tmpBox.setFromObject(object)
    if (!this.trashBox.intersectsBox(this.tmpBox)) return false

    this.appState.removeComponent(id)
    this.stateSyncSystem.rebuildFromState()
    return true
  }

  /**
   * objects: iterable de meshes (componentes) actualmente en escena
   */
  update(objects) {
    if (!this.trashGroup) return
    this.updateTrashBounds()

    // Si eliminamos uno, rebuildFromState recrea meshes: salimos temprano
    for (const obj of objects) {
      const deleted = this.checkObject(obj)
      if (deleted) break
    }
  }
}