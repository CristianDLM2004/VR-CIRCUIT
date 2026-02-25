import * as THREE from "three"

export class ComponentFactory {

  static createComponent(data) {

    let mesh

    switch (data.type) {
      case "cube":
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.2, 0.2),
          new THREE.MeshStandardMaterial()
        )
        break

      default:
        return null
    }

    // Transform
    const t = data.transform || { x: 0, y: 1.2, z: -1, qx: 0, qy: 0, qz: 0, qw: 1 }
    mesh.position.set(t.x, t.y, t.z)
    mesh.quaternion.set(t.qx ?? 0, t.qy ?? 0, t.qz ?? 0, t.qw ?? 1)

    // Metadata para sistemas
    mesh.userData.componentId = data.id
    mesh.userData.interactable = true

    return mesh
  }
}