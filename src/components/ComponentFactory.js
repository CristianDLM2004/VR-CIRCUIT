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

      case "led": {
        const group = new THREE.Group()

        const redMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b })
        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })

        // cuerpo principal
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, 0.033, 20),
          redMat
        )
        body.position.y = 0.026

        // cúpula
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.02, 20, 20),
          redMat
        )
        dome.position.y = 0.041

        // patas
        const anodeGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.075, 12)
        const cathodeGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.055, 12)

        const anodeLeg = new THREE.Mesh(anodeGeo, legMat)
        anodeLeg.position.set(-0.0065, -0.018, 0)

        const cathodeLeg = new THREE.Mesh(cathodeGeo, legMat)
        cathodeLeg.position.set(0.0065, -0.008, 0)

        //Marcadores para el ánodo y cátodo (puntitos)
        const pinMarkerGeo = new THREE.SphereGeometry(0.004, 10, 10)

        const anodeMarker = new THREE.Mesh(
          pinMarkerGeo,
          new THREE.MeshStandardMaterial({ color: 0x00ff88 })
        )
        anodeMarker.position.set(-0.0065, -0.055, 0)

        const cathodeMarker = new THREE.Mesh(
          pinMarkerGeo,
          new THREE.MeshStandardMaterial({ color: 0x4488ff })
        )
        cathodeMarker.position.set(0.0065, -0.038, 0)

        group.add(body)
        group.add(dome)
        group.add(anodeLeg)
        group.add(cathodeLeg)
        group.add(anodeMarker)
        group.add(cathodeMarker)

        mesh = group
        break
      }
    }


    // Transform
    const t = data.transform || { x: 0, y: 1.2, z: -1, qx: 0, qy: 0, qz: 0, qw: 1 }
    mesh.position.set(t.x, t.y, t.z)
    mesh.quaternion.set(t.qx ?? 0, t.qy ?? 0, t.qz ?? 0, t.qw ?? 1)

    // Metadata
    mesh.userData.componentId = data.id
    mesh.userData.interactable = true
    mesh.userData.isSurface = false
    mesh.userData.componentType = data.type

    // Para componentes tipo simulador eléctrico:
    // por defecto NO auto-acomodarse a una cara “estable”.
    mesh.userData.restSnapMode = "freeze"

    //Agregar los pines al led
    if (data.type === "led") {
      mesh.userData.pins = [
        {
          id: "anode",
          label: "Ánodo",
          localPos: new THREE.Vector3(-0.01, -0.055, 0),
        },
        {
          id: "cathode",
          label: "Cátodo",
          localPos: new THREE.Vector3(0.01, -0.038, 0),
        },
      ]
    }

    mesh.userData.getPinWorldPositions = function () {
      const results = []
      const worldPos = new THREE.Vector3()

      if (!this.pins || !Array.isArray(this.pins)) return results

      for (const pin of this.pins) {
        worldPos.copy(pin.localPos)
        mesh.localToWorld(worldPos)

        results.push({
          id: pin.id,
          label: pin.label,
          worldPos: worldPos.clone(),
        })
      }

      return results
    }

    return mesh
  }
}