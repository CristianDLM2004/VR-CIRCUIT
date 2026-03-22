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

        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.11, 0.05),
          bodyMat
        )
        body.position.y = 0

        const top = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.012, 0.05),
          topMat
        )
        top.position.y = 0.061

        const plusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.006, 0.008, 14),
          plusMat
        )
        plusTerminal.position.set(-0.018, 0.071, 0)

        const minusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 14),
          minusMat
        )
        minusTerminal.position.set(0.018, 0.071, 0)

        group.add(body)
        group.add(top)
        group.add(plusTerminal)
        group.add(minusTerminal)

        group.userData.surfaceContactObject = body
        group.userData.surfaceUpright = true

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
        body.name = "LEDBody"
        body.position.y = 0.026

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.02, 20, 20),
          redMat
        )
        dome.name = "LEDDome"
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

      case "wire": {
        const group = new THREE.Group()

        const rawPoints = Array.isArray(data.meta?.points) ? data.meta.points : []
        const points = rawPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z))

        if (points.length < 2) return null

        const wireColor = data.meta?.color ?? 0x111111
        const radius = 0.0038

        group.userData.interactable = false
        group.userData.isWire = true
        group.userData.wireColor = wireColor
        group.userData.wireRadius = radius
        group.userData.startAnchor = data.meta?.startAnchor ?? null
        group.userData.endAnchor = data.meta?.endAnchor ?? null
        group.userData.fixedPoints = points.map((p) => p.clone())

        group.userData.rebuildWireGeometry = function (nextPoints) {
          while (group.children.length > 0) {
            const child = group.children.pop()
            if (child?.geometry) child.geometry.dispose?.()
            if (child?.material) child.material.dispose?.()
          }

          const wireMat = new THREE.MeshStandardMaterial({
            color: group.userData.wireColor ?? 0x111111,
            roughness: 0.65,
            metalness: 0.0,
            emissive: 0x181818,
          })

          const jointMat = new THREE.MeshStandardMaterial({
            color: group.userData.wireColor ?? 0x111111,
            roughness: 0.7,
            metalness: 0.0,
          })

          for (let i = 0; i < nextPoints.length; i++) {
            const joint = new THREE.Mesh(
              new THREE.SphereGeometry((group.userData.wireRadius ?? 0.0038) * 1.15, 10, 10),
              jointMat.clone()
            )
            joint.position.copy(nextPoints[i])
            group.add(joint)
          }

          for (let i = 0; i < nextPoints.length - 1; i++) {
            const start = nextPoints[i]
            const end = nextPoints[i + 1]

            const dir = end.clone().sub(start)
            const len = dir.length()
            if (len < 0.0001) continue

            const mid = start.clone().add(end).multiplyScalar(0.5)

            const segment = new THREE.Mesh(
              new THREE.CylinderGeometry(
                group.userData.wireRadius ?? 0.0038,
                group.userData.wireRadius ?? 0.0038,
                1,
                12
              ),
              wireMat.clone()
            )

            segment.position.copy(mid)
            dir.normalize()
            segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
            segment.scale.set(1, len, 1)

            group.add(segment)
          }
        }

        group.userData.rebuildWireGeometry(points)

        mesh = group
        break
      }

      default:
        return null
    }

    // ---------------------------
    // Transform
    // ---------------------------
    const t = data.transform || { x: 0, y: 1.2, z: -1, qx: 0, qy: 0, qz: 0, qw: 1 }
    mesh.position.set(t.x, t.y, t.z)
    mesh.quaternion.set(t.qx ?? 0, t.qy ?? 0, t.qz ?? 0, t.qw ?? 1)

    // ---------------------------
    // Metadata base
    // ---------------------------
    mesh.userData.componentId = data.id
    mesh.userData.interactable = data.type === "wire" ? false : true
    mesh.userData.isSurface = false
    mesh.userData.componentType = data.type
    mesh.userData.restSnapMode = "freeze"
    mesh.userData.inserted = !!data.inserted
    mesh.userData.pinConnections = data.pinConnections || null

    // ← ÚNICA adición respecto al original:
    // Guardar meta para que ElectricalSystem pueda leer resistance, voltage, etc.
    mesh.userData.meta = data.meta || {}

    // ---------------------------
    // Terminales: battery5v
    // ---------------------------
    if (data.type === "battery5v") {
      mesh.userData.terminals = [
        {
          id: "positive",
          label: "Positivo",
          localPos: new THREE.Vector3(-0.018, 0.071, 0),
        },
        {
          id: "negative",
          label: "Negativo",
          localPos: new THREE.Vector3(0.018, 0.071, 0),
        },
      ]
    }

    // ---------------------------
    // Pines: led
    // ---------------------------
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

    // ---------------------------
    // Pines: resistor
    // ---------------------------
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

    // ---------------------------
    // Helpers de posición mundial
    // ---------------------------
    mesh.userData.getPinWorldPositions = function () {
      const results = []
      const worldPos = new THREE.Vector3()
      if (!this.pins || !Array.isArray(this.pins)) return results
      for (const pin of this.pins) {
        worldPos.copy(pin.localPos)
        mesh.localToWorld(worldPos)
        results.push({ id: pin.id, label: pin.label, worldPos: worldPos.clone() })
      }
      return results
    }

    mesh.userData.getTerminalWorldPositions = function () {
      const results = []
      const worldPos = new THREE.Vector3()
      if (!this.terminals || !Array.isArray(this.terminals)) return results
      for (const terminal of this.terminals) {
        worldPos.copy(terminal.localPos)
        mesh.localToWorld(worldPos)
        results.push({ id: terminal.id, label: terminal.label, worldPos: worldPos.clone() })
      }
      return results
    }

    mesh.userData.getConnectionAnchors = function () {
      const results = []
      if (Array.isArray(this.terminals)) {
        for (const terminal of this.getTerminalWorldPositions()) {
          results.push({ id: terminal.id, label: terminal.label, kind: "terminal", worldPos: terminal.worldPos.clone() })
        }
      }
      if (Array.isArray(this.pins)) {
        for (const pin of this.getPinWorldPositions()) {
          results.push({ id: pin.id, label: pin.label, kind: "pin", worldPos: pin.worldPos.clone() })
        }
      }
      return results
    }

    return mesh
  }
}