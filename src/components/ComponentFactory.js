import * as THREE from "three"

export class ComponentFactory {
  static createComponent(data) {
    let mesh

    switch (data.type) {

      case "battery5v": {
        const group = new THREE.Group()

        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a })
        const topMat = new THREE.MeshStandardMaterial({ color: 0x1f1f1f })
        const plusMat = new THREE.MeshStandardMaterial({ color: 0xd9534f })
        const minusMat = new THREE.MeshStandardMaterial({ color: 0x5bc0de })

        // cuerpo principal
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.11, 0.05),
          bodyMat
        )
        body.position.y = 0.055

        // tapa superior
        const top = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.012, 0.05),
          topMat
        )
        top.position.y = 0.111

        // terminal positivo
        const plusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.006, 0.008, 14),
          plusMat
        )
        plusTerminal.position.set(-0.018, 0.121, 0)

        // terminal negativo
        const minusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 14),
          minusMat
        )
        minusTerminal.position.set(0.018, 0.121, 0)

        group.add(body)
        group.add(top)
        group.add(plusTerminal)
        group.add(minusTerminal)

        group.userData.surfaceContactHalfY = 0.055
        mesh = group
        break
      }

      case "led": {
        const group = new THREE.Group()

        const redMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b })
        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })

        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, 0.033, 20),
          redMat
        )
        body.position.y = 0.026

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.02, 20, 20),
          redMat
        )
        dome.position.y = 0.041

        const anodeGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.075, 12)
        const cathodeGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.055, 12)

        const anodeLeg = new THREE.Mesh(anodeGeo, legMat)
        anodeLeg.position.set(-0.0065, -0.018, 0)

        const cathodeLeg = new THREE.Mesh(cathodeGeo, legMat)
        cathodeLeg.position.set(0.0065, -0.008, 0)

        group.add(body)
        group.add(dome)
        group.add(anodeLeg)
        group.add(cathodeLeg)

        mesh = group
        break
      }

      case "resistor": {
        const group = new THREE.Group()

        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c29d })

        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.007, 0.007, 0.022, 18),
          bodyMat
        )
        body.rotation.z = Math.PI / 2
        body.position.y = 0.006

        const leftLead = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.009, 12),
          legMat
        )
        leftLead.rotation.z = Math.PI / 2
        leftLead.position.set(-0.0105, 0.006, 0)

        const rightLead = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.009, 12),
          legMat
        )
        rightLead.rotation.z = Math.PI / 2
        rightLead.position.set(0.0105, 0.006, 0)

        const leftLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.026, 12),
          legMat
        )
        leftLeg.position.set(-0.015, -0.007, 0)

        const rightLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.026, 12),
          legMat
        )
        rightLeg.position.set(0.015, -0.007, 0)

        group.add(body)
        group.add(leftLead)
        group.add(rightLead)
        group.add(leftLeg)
        group.add(rightLeg)

        mesh = group
        break
      }

      default:
        return null
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

    mesh.userData.inserted = !!data.inserted
    mesh.userData.pinConnections = data.pinConnections || null

    //Agregar los pines al led
    if (data.type === "led") {
      mesh.userData.pins = [
        {
          id: "anode",
          label: "Ánodo",
          localPos: new THREE.Vector3(-0.0065, -0.055, 0),
        },
        {
          id: "cathode",
          label: "Cátodo",
          localPos: new THREE.Vector3(0.0065, -0.038, 0),
        },
      ]
    }

    //Agregar los pines a la resistencia
    if (data.type === "resistor") {
      mesh.userData.pins = [
        {
          id: "left",
          label: "Pin izquierdo",
          localPos: new THREE.Vector3(-0.015, -0.022, 0),
        },
        {
          id: "right",
          label: "Pin derecho",
          localPos: new THREE.Vector3(0.015, -0.022, 0),
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