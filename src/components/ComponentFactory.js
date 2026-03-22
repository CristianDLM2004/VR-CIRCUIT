import * as THREE from "three"

export class ComponentFactory {
  static createComponent(data) {
    let mesh

    switch (data.type) {

      // ---------------------------
      // BATERÍA 5V
      // ---------------------------
      case "battery5v": {
        const group = new THREE.Group()

        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a })
        const topMat = new THREE.MeshStandardMaterial({ color: 0x1f1f1f })
        const plusMat = new THREE.MeshStandardMaterial({ color: 0xd9534f })
        const minusMat = new THREE.MeshStandardMaterial({ color: 0x5bc0de })

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.05), bodyMat)
        body.position.y = 0

        const top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.05), topMat)
        top.position.y = 0.061

        const plusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.006, 0.008, 14), plusMat
        )
        plusTerminal.position.set(-0.018, 0.071, 0)

        const minusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 14), minusMat
        )
        minusTerminal.position.set(0.018, 0.071, 0)

        group.add(body, top, plusTerminal, minusTerminal)
        group.userData.surfaceContactObject = body
        group.userData.surfaceUpright = true

        mesh = group
        break
      }

      // ---------------------------
      // LED
      // ---------------------------
      case "led": {
        const group = new THREE.Group()

        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })

        const bodyMat = new THREE.MeshStandardMaterial({
          color: 0xff3b3b,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 0,
          roughness: 0.35,
          metalness: 0.0,
        })

        const domeMat = new THREE.MeshStandardMaterial({
          color: 0xff3b3b,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 0,
          roughness: 0.25,
          metalness: 0.0,
          transparent: true,
          opacity: 0.88,
        })

        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.033, 20), bodyMat)
        body.name = "LEDBody"
        body.position.y = 0.026

        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 20), domeMat)
        dome.name = "LEDDome"
        dome.position.y = 0.041

        const anodeLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, 0.075, 12), legMat
        )
        anodeLeg.position.set(-0.0065, -0.018, 0)

        const cathodeLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, 0.055, 12), legMat
        )
        cathodeLeg.position.set(0.0065, -0.008, 0)

        group.add(body, dome, anodeLeg, cathodeLeg)

        mesh = group
        break
      }

      // ---------------------------
      // RESISTENCIA
      // ---------------------------
      case "resistor": {
        const group = new THREE.Group()

        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c29d })

        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.022, 18), bodyMat)
        body.rotation.z = Math.PI / 2
        body.position.y = 0.006

        const leftLead = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.009, 12), legMat
        )
        leftLead.rotation.z = Math.PI / 2
        leftLead.position.set(-0.0105, 0.006, 0)

        const rightLead = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.009, 12), legMat
        )
        rightLead.rotation.z = Math.PI / 2
        rightLead.position.set(0.0105, 0.006, 0)

        const leftLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.026, 12), legMat
        )
        leftLeg.position.set(-0.015, -0.007, 0)

        const rightLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.026, 12), legMat
        )
        rightLeg.position.set(0.015, -0.007, 0)

        group.add(body, leftLead, rightLead, leftLeg, rightLeg)

        mesh = group
        break
      }

      // ---------------------------
      // BOTÓN MOMENTÁNEO
      // 2 pines — conduce solo mientras está presionado
      // ---------------------------
      case "button": {
        const group = new THREE.Group()

        const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 })
        const rimMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7 })
        const capMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.5 })
        const capPressedMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 })
        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })

        // Base cuadrada
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.010, 0.022), baseMat)
        base.name = "ButtonBase"
        base.position.y = 0.005

        // Aro del cuerpo
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 16), rimMat)
        rim.position.y = 0.014

        // Caperuza presionable
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.007, 16), capMat.clone())
        cap.name = "ButtonCap"
        cap.position.y = 0.022

        // Patas
        const leftLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.020, 12), legMat
        )
        leftLeg.position.set(-0.010, -0.005, 0)

        const rightLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.020, 12), legMat
        )
        rightLeg.position.set(0.010, -0.005, 0)

        group.add(base, rim, cap, leftLeg, rightLeg)

        // Estado lógico
        const CAP_BASE_Y = 0.022
        const CAP_PRESSED_Y = 0.017

        group.userData.buttonState = false
        group.userData.buttonCap = cap
        group.userData.buttonCapNormalMat = cap.material
        group.userData.buttonCapPressedMat = capPressedMat
        group.userData.isButtonComponent = true

        group.userData.pressButton = function () {
          if (group.userData.buttonState) return
          group.userData.buttonState = true
          cap.position.y = CAP_PRESSED_Y
          cap.material = capPressedMat
        }

        group.userData.releaseButton = function () {
          if (!group.userData.buttonState) return
          group.userData.buttonState = false
          cap.position.y = CAP_BASE_Y
          cap.material = group.userData.buttonCapNormalMat
        }

        mesh = group
        break
      }

      // ---------------------------
      // SWITCH DE PASO
      // 2 pines — alterna abierto/cerrado al presionar
      // ---------------------------
      case "switch": {
        const group = new THREE.Group()

        const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 })
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7 })
        const leverOffMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.5 })
        const leverOnMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.45 })
        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })

        // Base rectangular
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.008, 0.016), baseMat)
        base.name = "SwitchBase"
        base.position.y = 0.004

        // Cuerpo
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.010, 0.012), bodyMat)
        body.position.y = 0.013

        // Palanca
        const lever = new THREE.Mesh(
          new THREE.BoxGeometry(0.006, 0.016, 0.006), leverOffMat.clone()
        )
        lever.name = "SwitchLever"
        lever.position.y = 0.024
        lever.rotation.z = Math.PI / 5   // inclinado izquierda = OFF

        // Patas
        const leftLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.020, 12), legMat
        )
        leftLeg.position.set(-0.010, -0.005, 0)

        const rightLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.020, 12), legMat
        )
        rightLeg.position.set(0.010, -0.005, 0)

        group.add(base, body, lever, leftLeg, rightLeg)

        // Estado lógico
        const initialState = data.meta?.switchState ?? false
        group.userData.switchState = initialState
        group.userData.switchLever = lever
        group.userData.switchLeverOnMat = leverOnMat
        group.userData.switchLeverOffMat = lever.material
        group.userData.isSwitchComponent = true

        // Aplicar estado inicial (para reconstrucción desde save/load)
        if (initialState) {
          lever.rotation.z = -Math.PI / 5
          lever.material = leverOnMat.clone()
        }

        group.userData.toggleSwitch = function () {
          group.userData.switchState = !group.userData.switchState
          const isOn = group.userData.switchState

          lever.rotation.z = isOn ? -Math.PI / 5 : Math.PI / 5
          lever.material = isOn
            ? group.userData.switchLeverOnMat.clone()
            : group.userData.switchLeverOffMat.clone()

          // Persistir en appState si está disponible
          const id = group.userData.componentId
          if (id && group.userData._appStateRef) {
            group.userData._appStateRef.updateComponent(id, {
              meta: { ...group.userData.meta, switchState: group.userData.switchState }
            })
            group.userData.meta.switchState = group.userData.switchState
          }
        }

        mesh = group
        break
      }

      // ---------------------------
      // CABLE
      // ---------------------------
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
    mesh.userData.meta = data.meta || {}

    // ---------------------------
    // Terminales: battery5v
    // ---------------------------
    if (data.type === "battery5v") {
      mesh.userData.terminals = [
        { id: "positive", label: "Positivo", localPos: new THREE.Vector3(-0.018, 0.071, 0) },
        { id: "negative", label: "Negativo", localPos: new THREE.Vector3(0.018, 0.071, 0) },
      ]
    }

    // ---------------------------
    // Pines: led
    // ---------------------------
    if (data.type === "led") {
      mesh.userData.pins = [
        { id: "anode",   label: "Ánodo",  localPos: new THREE.Vector3(-0.0065, -0.055, 0) },
        { id: "cathode", label: "Cátodo", localPos: new THREE.Vector3(0.0065, -0.038, 0) },
      ]
    }

    // ---------------------------
    // Pines: resistor
    // ---------------------------
    if (data.type === "resistor") {
      mesh.userData.pins = [
        { id: "left",  label: "Pin izquierdo", localPos: new THREE.Vector3(-0.015, -0.022, 0) },
        { id: "right", label: "Pin derecho",   localPos: new THREE.Vector3(0.015, -0.022, 0) },
      ]
    }

    // ---------------------------
    // Pines: button (2 pines, separación 2 holes = ~0.030m)
    // ---------------------------
    if (data.type === "button") {
      mesh.userData.pins = [
        { id: "pin_a", label: "Pin A", localPos: new THREE.Vector3(-0.010, -0.015, 0) },
        { id: "pin_b", label: "Pin B", localPos: new THREE.Vector3(0.010, -0.015, 0) },
      ]
    }

    // ---------------------------
    // Pines: switch (2 pines, separación 2 holes = ~0.030m)
    // ---------------------------
    if (data.type === "switch") {
      mesh.userData.pins = [
        { id: "pin_a", label: "Pin A", localPos: new THREE.Vector3(-0.010, -0.015, 0) },
        { id: "pin_b", label: "Pin B", localPos: new THREE.Vector3(0.010, -0.015, 0) },
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
        for (const t of this.getTerminalWorldPositions()) {
          results.push({ id: t.id, label: t.label, kind: "terminal", worldPos: t.worldPos.clone() })
        }
      }
      if (Array.isArray(this.pins)) {
        for (const p of this.getPinWorldPositions()) {
          results.push({ id: p.id, label: p.label, kind: "pin", worldPos: p.worldPos.clone() })
        }
      }
      return results
    }

    return mesh
  }
}