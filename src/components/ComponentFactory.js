import * as THREE from "three"

export class ComponentFactory {

    static createComponent(data) {

        let mesh

        switch (data.type) {

            case "cube":
                mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(0.2, 0.2, 0.2),
                    new THREE.MeshStandardMaterial({ color: 0xff0000 })
                )
                break

            default:
                return null
        }

        mesh.position.set(
            data.transform.x,
            data.transform.y,
            data.transform.z
        )

        mesh.userData.componentId = data.id

        return mesh
    }
}