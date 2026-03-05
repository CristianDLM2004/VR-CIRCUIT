import * as THREE from "three"

/**
 * TrashSystem
 * - Crea un bote de basura (mesh) en escena o en un parent dado.
 * - Elimina componentes (por componentId) cuando:
 *    1) Están "libres" (parent === scene), o sea NO agarrados por mano/controlador
 *    2) Su bounding box intersecta el bounding box del bote
 */
export class TrashSystem {
  constructor(scene, appState, stateSyncSystem) {
    this.scene = scene
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem

    this.trashGroup = null
    this.trashBox = new THREE.Box3()
    this.tmpBox = new THREE.Box3()

    this._lastDeleteMsById = new Map()
    this._deleteCooldownMs = 300
  }

  /**
   * Crea el bote y lo agrega al parent (por defecto: scene)
   */
  createTrashBin({
    position = new THREE.Vector3(-0.45, -1.25, -0.35),
    parent = null,
  } = {}) {
    const group = new THREE.Group()
    group.name = "TrashBin"

    // Materiales un poco más visibles en VR
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.85 })
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.6 })
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    const iconMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })

    // Cuerpo
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.28, 20), bodyMat)
    body.name = "TrashBody"
    body.position.y = 0.14
    body.castShadow = true
    body.receiveShadow = true

    // Aro superior
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 10, 24), rimMat)
    rim.name = "TrashRim"
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.28
    rim.castShadow = true
    rim.receiveShadow = true

    // Placa frontal
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.01), plateMat)
    plate.name = "TrashPlate"
    plate.position.set(0, 0.18, 0.16)
    plate.castShadow = true

    // Icono X
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.006), iconMat)
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.006), iconMat)
    bar1.rotation.z = Math.PI / 4
    bar2.rotation.z = -Math.PI / 4
    bar1.position.z = 0.006
    bar2.position.z = 0.006
    plate.add(bar1, bar2)

    group.add(body, rim, plate)

    group.position.copy(position)

    // Metadata
    group.userData.isTrash = true
    body.userData.isTrash = true
    rim.userData.isTrash = true
    plate.userData.isTrash = true

    const targetParent = parent || this.scene
    targetParent.add(group)

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

  checkObject(object) {
    if (!this.trashGroup) return false
    if (!object?.userData?.componentId) return false

    // ✅ Solo si está suelto (no agarrado)
    if (object.parent !== this.scene) return false

    const id = object.userData.componentId
    if (!this.canDeleteNow(id)) return false

    this.tmpBox.setFromObject(object)
    if (!this.trashBox.intersectsBox(this.tmpBox)) return false

    this.appState.removeComponent(id)
    this.stateSyncSystem.rebuildFromState()
    return true
  }

  update(objects) {
    if (!this.trashGroup) return
    this.updateTrashBounds()

    for (const obj of objects) {
      const deleted = this.checkObject(obj)
      if (deleted) break
    }
  }
}