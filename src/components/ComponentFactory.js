import * as THREE from "three"

function cloneVec3(v) {
  return v ? new THREE.Vector3(v.x, v.y, v.z) : new THREE.Vector3()
}

function createGrabProxyBox(width, height, depth, position) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    })
  )
  mesh.position.copy(position)
  mesh.name = "GrabProxyBox"
  return mesh
}

function createGrabProxyCylinder(radiusTop, radiusBottom, height, radialSegments, position, rotation = null) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    })
  )
  mesh.position.copy(position)
  if (rotation) mesh.rotation.copy(rotation)
  mesh.name = "GrabProxyCylinder"
  return mesh
}

function setGrabMetadata(mesh, config = {}) {
  mesh.userData.grabCenter = cloneVec3(config.grabCenter)

  mesh.userData.grabPoints = Array.isArray(config.grabPoints)
    ? config.grabPoints.map((p, index) => ({
        id: p.id ?? `grab_${index}`,
        localPos: cloneVec3(p.localPos),
        weight: p.weight ?? 1,
      }))
    : []

  mesh.userData.grabRadius = config.grabRadius ?? 0.028
  mesh.userData.grabTarget = config.grabTarget ?? null

  if (config.surfaceContactObject) {
    mesh.userData.surfaceContactObject = config.surfaceContactObject
  }

  if (typeof config.surfaceUpright === "boolean") {
    mesh.userData.surfaceUpright = config.surfaceUpright
  }

  mesh.userData.getGrabWorldPoints = function () {
    const results = []
    const worldPos = new THREE.Vector3()

    if (!Array.isArray(this.grabPoints)) return results

    for (const point of this.grabPoints) {
      worldPos.copy(point.localPos)
      mesh.localToWorld(worldPos)
      results.push({
        id: point.id,
        weight: point.weight ?? 1,
        worldPos: worldPos.clone(),
      })
    }

    return results
  }

  mesh.userData.getGrabCenterWorld = function () {
    const worldPos = this.grabCenter instanceof THREE.Vector3
      ? this.grabCenter.clone()
      : new THREE.Vector3()

    mesh.localToWorld(worldPos)
    return worldPos
  }
}

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

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.05), bodyMat)
        body.name = "BatteryBody"
        body.position.y = 0

        const top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.05), topMat)
        top.name = "BatteryTop"
        top.position.y = 0.061

        const plusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.006, 0.008, 14),
          plusMat
        )
        plusTerminal.name = "BatteryPositiveTerminal"
        plusTerminal.position.set(-0.018, 0.071, 0)

        const minusTerminal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 14),
          minusMat
        )
        minusTerminal.name = "BatteryNegativeTerminal"
        minusTerminal.position.set(0.018, 0.071, 0)

        const grabProxy = createGrabProxyBox(0.092, 0.118, 0.062, new THREE.Vector3(0, 0.008, 0))

        group.add(body, top, plusTerminal, minusTerminal, grabProxy)

        setGrabMetadata(group, {
          grabCenter: new THREE.Vector3(0, 0.014, 0),
          grabPoints: [
            { id: "body_center", localPos: new THREE.Vector3(0, 0.014, 0), weight: 1.0 },
            { id: "body_upper", localPos: new THREE.Vector3(0, 0.042, 0), weight: 0.95 },
            { id: "body_front", localPos: new THREE.Vector3(0, 0.014, 0.016), weight: 0.92 },
            { id: "body_back", localPos: new THREE.Vector3(0, 0.014, -0.016), weight: 0.92 },
            { id: "body_left", localPos: new THREE.Vector3(-0.020, 0.014, 0), weight: 0.9 },
            { id: "body_right", localPos: new THREE.Vector3(0.020, 0.014, 0), weight: 0.9 },
          ],
          grabRadius: 0.060,
          grabTarget: grabProxy,
          surfaceContactObject: body,
          surfaceUpright: true,
        })

        mesh = group
        break
      }

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
          new THREE.CylinderGeometry(0.003, 0.003, 0.075, 12),
          legMat
        )
        anodeLeg.name = "LEDAnodeLeg"
        anodeLeg.position.set(-0.0065, -0.018, 0)

        const cathodeLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.003, 0.003, 0.055, 12),
          legMat
        )
        cathodeLeg.name = "LEDCathodeLeg"
        cathodeLeg.position.set(0.0065, -0.008, 0)

        const grabProxy = createGrabProxyBox(0.050, 0.052, 0.050, new THREE.Vector3(0, 0.030, 0))

        group.add(body, dome, anodeLeg, cathodeLeg, grabProxy)

        setGrabMetadata(group, {
          grabCenter: new THREE.Vector3(0, 0.031, 0),
          grabPoints: [
            { id: "led_body_center", localPos: new THREE.Vector3(0, 0.028, 0), weight: 1.0 },
            { id: "led_dome", localPos: new THREE.Vector3(0, 0.041, 0), weight: 0.96 },
            { id: "led_front", localPos: new THREE.Vector3(0, 0.031, 0.011), weight: 0.93 },
            { id: "led_back", localPos: new THREE.Vector3(0, 0.031, -0.011), weight: 0.93 },
            { id: "led_left", localPos: new THREE.Vector3(-0.009, 0.029, 0), weight: 0.91 },
            { id: "led_right", localPos: new THREE.Vector3(0.009, 0.029, 0), weight: 0.91 },
            { id: "led_lower_body", localPos: new THREE.Vector3(0, 0.020, 0), weight: 0.9 },
          ],
          grabRadius: 0.045,
          grabTarget: grabProxy,
          surfaceContactObject: body,
          surfaceUpright: true,
        })

        mesh = group
        break
      }

      case "resistor": {
        const group = new THREE.Group()

        const legMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0 })
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c29d })

        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.022, 18), bodyMat)
        body.name = "ResistorBody"
        body.rotation.z = Math.PI / 2
        body.position.y = 0.006

        const leftLead = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.009, 12),
          legMat
        )
        leftLead.name = "ResistorLeftLead"
        leftLead.rotation.z = Math.PI / 2
        leftLead.position.set(-0.0105, 0.006, 0)

        const rightLead = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.009, 12),
          legMat
        )
        rightLead.name = "ResistorRightLead"
        rightLead.rotation.z = Math.PI / 2
        rightLead.position.set(0.0105, 0.006, 0)

        const leftLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.026, 12),
          legMat
        )
        leftLeg.name = "ResistorLeftLeg"
        leftLeg.position.set(-0.015, -0.007, 0)

        const rightLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0018, 0.0018, 0.026, 12),
          legMat
        )
        rightLeg.name = "ResistorRightLeg"
        rightLeg.position.set(0.015, -0.007, 0)

        // Proxy elevado para que al estar insertada o apoyada siga “mandando” el cuerpo
        const grabProxy = createGrabProxyBox(0.060, 0.036, 0.036, new THREE.Vector3(0, 0.012, 0))

        group.add(body, leftLead, rightLead, leftLeg, rightLeg, grabProxy)

        setGrabMetadata(group, {
          grabCenter: new THREE.Vector3(0, 0.012, 0),
          grabPoints: [
            { id: "res_body_center", localPos: new THREE.Vector3(0, 0.012, 0), weight: 1.0 },
            { id: "res_body_left", localPos: new THREE.Vector3(-0.010, 0.012, 0), weight: 0.97 },
            { id: "res_body_right", localPos: new THREE.Vector3(0.010, 0.012, 0), weight: 0.97 },
            { id: "res_body_front", localPos: new THREE.Vector3(0, 0.012, 0.012), weight: 0.94 },
            { id: "res_body_back", localPos: new THREE.Vector3(0, 0.012, -0.012), weight: 0.94 },
            { id: "res_body_upper", localPos: new THREE.Vector3(0, 0.017, 0), weight: 0.93 },
          ],
          grabRadius: 0.062,
          grabTarget: grabProxy,
          surfaceContactObject: body,
          surfaceUpright: true,
        })

        mesh = group
        break
      }

      case "button": {
        const group = new THREE.Group()

        const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
        const rimMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7 })
        const capNormalMat = new THREE.MeshStandardMaterial({
          color: 0xe74c3c,
          roughness: 0.45,
          metalness: 0.05,
        })
        const capPressedMat = new THREE.MeshStandardMaterial({
          color: 0x7b241c,
          roughness: 0.45,
        })
        const dotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
        const legMat = new THREE.MeshStandardMaterial({
          color: 0xb8b8b8,
          metalness: 0.6,
          roughness: 0.3,
        })

        const base = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.012, 0.034), baseMat)
        base.name = "ButtonBase"
        base.position.y = 0.006

        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.010, 20), rimMat)
        rim.name = "ButtonRim"
        rim.position.y = 0.017

        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.011, 0.011, 0.010, 20),
          capNormalMat.clone()
        )
        cap.name = "ButtonCap"
        cap.position.y = 0.027

        const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.001, 12), dotMat)
        dot.position.y = 0.006
        cap.add(dot)

        const leftLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.002, 0.002, 0.030, 12),
          legMat
        )
        leftLeg.name = "ButtonLeftLeg"
        leftLeg.position.set(-0.0225, -0.009, 0)

        const rightLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.002, 0.002, 0.030, 12),
          legMat
        )
        rightLeg.name = "ButtonRightLeg"
        rightLeg.position.set(0.0225, -0.009, 0)

        const grabProxy = createGrabProxyBox(0.046, 0.036, 0.046, new THREE.Vector3(0, 0.018, 0))

        group.add(base, rim, cap, leftLeg, rightLeg, grabProxy)

        const CAP_BASE_Y = 0.027
        const CAP_PRESSED_Y = 0.021
        const SCALE_NORMAL = new THREE.Vector3(1, 1, 1)
        const SCALE_PRESSED = new THREE.Vector3(0.92, 0.92, 0.92)

        group.userData.buttonState = false
        group.userData.buttonCap = cap
        group.userData.buttonCapNormalMat = cap.material
        group.userData.buttonCapPressedMat = capPressedMat
        group.userData.isButtonComponent = true
        group.userData._lastPressMs = 0
        group.userData._cooldownMs = 120

        group.userData.isUI = false
        group.userData.onPress = function () {
          const now = performance.now()
          if (now - group.userData._lastPressMs < group.userData._cooldownMs) return
          group.userData._lastPressMs = now

          if (!group.userData.buttonState) {
            group.userData.pressButton()
          }
        }

        group.userData.pressButton = function () {
          if (group.userData.buttonState) return
          group.userData.buttonState = true
          cap.position.y = CAP_PRESSED_Y
          cap.material = capPressedMat
          group.scale.copy(SCALE_PRESSED)
        }

        group.userData.releaseButton = function () {
          if (!group.userData.buttonState) return
          group.userData.buttonState = false
          cap.position.y = CAP_BASE_Y
          cap.material = group.userData.buttonCapNormalMat
          group.scale.copy(SCALE_NORMAL)
        }

        setGrabMetadata(group, {
          grabCenter: new THREE.Vector3(0, 0.018, 0),
          grabPoints: [
            { id: "btn_body_center", localPos: new THREE.Vector3(0, 0.016, 0), weight: 1.0 },
            { id: "btn_cap", localPos: new THREE.Vector3(0, 0.027, 0), weight: 0.96 },
            { id: "btn_front", localPos: new THREE.Vector3(0, 0.017, 0.012), weight: 0.93 },
            { id: "btn_back", localPos: new THREE.Vector3(0, 0.017, -0.012), weight: 0.93 },
            { id: "btn_left", localPos: new THREE.Vector3(-0.012, 0.016, 0), weight: 0.91 },
            { id: "btn_right", localPos: new THREE.Vector3(0.012, 0.016, 0), weight: 0.91 },
            { id: "btn_lower_body", localPos: new THREE.Vector3(0, 0.010, 0), weight: 0.9 },
          ],
          grabRadius: 0.052,
          grabTarget: grabProxy,
          surfaceContactObject: base,
          surfaceUpright: true,
        })

        mesh = group
        break
      }

      case "switch": {
        const group = new THREE.Group()

        const housingMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 })
        const frameInnerMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 })
        const rockerOffMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.7 })
        const rockerOnMat = new THREE.MeshStandardMaterial({ color: 0x1a5c2a, roughness: 0.6 })
        const symbolMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3 })
        const legMat = new THREE.MeshStandardMaterial({
          color: 0xb8b8b8,
          metalness: 0.6,
          roughness: 0.3,
        })

        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.018, 0.030), housingMat)
        housing.name = "SwitchHousing"
        housing.position.y = 0.009

        const frameInner = new THREE.Mesh(
          new THREE.BoxGeometry(0.032, 0.004, 0.022),
          frameInnerMat
        )
        frameInner.name = "SwitchFrameInner"
        frameInner.position.y = 0.020

        const rocker = new THREE.Mesh(
          new THREE.BoxGeometry(0.030, 0.010, 0.020),
          rockerOffMat.clone()
        )
        rocker.name = "SwitchRocker"
        rocker.position.y = 0.022
        rocker.rotation.z = -Math.PI / 10

        const symbolI = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.002, 0.002), symbolMat)
        symbolI.position.set(-0.008, 0.006, 0)
        rocker.add(symbolI)

        const symbolO = new THREE.Mesh(new THREE.TorusGeometry(0.003, 0.001, 8, 16), symbolMat)
        symbolO.position.set(0.008, 0.006, 0)
        symbolO.rotation.x = Math.PI / 2
        rocker.add(symbolO)

        const leftLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.002, 0.002, 0.030, 12),
          legMat
        )
        leftLeg.name = "SwitchLeftLeg"
        leftLeg.position.set(-0.0225, -0.009, 0)

        const rightLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.002, 0.002, 0.030, 12),
          legMat
        )
        rightLeg.name = "SwitchRightLeg"
        rightLeg.position.set(0.0225, -0.009, 0)

        const grabProxy = createGrabProxyBox(0.052, 0.040, 0.042, new THREE.Vector3(0, 0.016, 0))

        group.add(housing, frameInner, rocker, leftLeg, rightLeg, grabProxy)

        const ROCKER_OFF_Z = -Math.PI / 10
        const ROCKER_ON_Z = Math.PI / 10
        const SCALE_NORMAL = new THREE.Vector3(1, 1, 1)
        const SCALE_PRESSED = new THREE.Vector3(0.93, 0.93, 0.93)

        const initialState = data.meta?.switchState ?? false
        group.userData.switchState = initialState
        group.userData.switchRocker = rocker
        group.userData.switchRockerOnMat = rockerOnMat
        group.userData.switchRockerOffMat = rocker.material
        group.userData.isSwitchComponent = true
        group.userData._lastPressMs = 0
        group.userData._cooldownMs = 300

        if (initialState) {
          rocker.rotation.z = ROCKER_ON_Z
          rocker.material = rockerOnMat.clone()
        }

        group.userData.onPress = function () {
          const now = performance.now()
          if (now - group.userData._lastPressMs < group.userData._cooldownMs) return
          group.userData._lastPressMs = now
          group.userData.toggleSwitch()
        }

        group.userData.toggleSwitch = function () {
          group.userData.switchState = !group.userData.switchState
          const isOn = group.userData.switchState

          rocker.rotation.z = isOn ? ROCKER_ON_Z : ROCKER_OFF_Z
          rocker.material = isOn
            ? group.userData.switchRockerOnMat.clone()
            : group.userData.switchRockerOffMat.clone()

          group.scale.copy(SCALE_PRESSED)
          setTimeout(() => {
            group.scale.copy(SCALE_NORMAL)
          }, 80)

          const id = group.userData.componentId
          if (id && group.userData._appStateRef) {
            group.userData._appStateRef.updateComponent(id, {
              meta: { ...group.userData.meta, switchState: group.userData.switchState },
            })
            group.userData.meta.switchState = group.userData.switchState
          }
        }

        setGrabMetadata(group, {
          grabCenter: new THREE.Vector3(0, 0.016, 0),
          grabPoints: [
            { id: "sw_body_center", localPos: new THREE.Vector3(0, 0.014, 0), weight: 1.0 },
            { id: "sw_rocker", localPos: new THREE.Vector3(0, 0.022, 0), weight: 0.96 },
            { id: "sw_front", localPos: new THREE.Vector3(0, 0.016, 0.012), weight: 0.93 },
            { id: "sw_back", localPos: new THREE.Vector3(0, 0.016, -0.012), weight: 0.93 },
            { id: "sw_left", localPos: new THREE.Vector3(-0.013, 0.014, 0), weight: 0.91 },
            { id: "sw_right", localPos: new THREE.Vector3(0.013, 0.014, 0), weight: 0.91 },
            { id: "sw_lower_body", localPos: new THREE.Vector3(0, 0.009, 0), weight: 0.9 },
          ],
          grabRadius: 0.055,
          grabTarget: grabProxy,
          surfaceContactObject: housing,
          surfaceUpright: true,
        })

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
            child?.geometry?.dispose?.()
            child?.material?.dispose?.()
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

    const t = data.transform || { x: 0, y: 1.2, z: -1, qx: 0, qy: 0, qz: 0, qw: 1 }
    mesh.position.set(t.x, t.y, t.z)
    mesh.quaternion.set(t.qx ?? 0, t.qy ?? 0, t.qz ?? 0, t.qw ?? 1)

    mesh.userData.componentId = data.id
    mesh.userData.interactable = data.type === "wire" ? false : true
    mesh.userData.isSurface = false
    mesh.userData.componentType = data.type
    mesh.userData.restSnapMode = "freeze"
    mesh.userData.inserted = !!data.inserted
    mesh.userData.pinConnections = data.pinConnections || null
    mesh.userData.meta = data.meta || {}

    if (data.type === "battery5v") {
      mesh.userData.terminals = [
        { id: "positive", label: "Positivo", localPos: new THREE.Vector3(-0.018, 0.071, 0) },
        { id: "negative", label: "Negativo", localPos: new THREE.Vector3(0.018, 0.071, 0) },
      ]
    }

    if (data.type === "led") {
      mesh.userData.pins = [
        { id: "anode", label: "Ánodo", localPos: new THREE.Vector3(-0.0065, -0.055, 0) },
        { id: "cathode", label: "Cátodo", localPos: new THREE.Vector3(0.0065, -0.038, 0) },
      ]
    }

    if (data.type === "resistor") {
      mesh.userData.pins = [
        { id: "left", label: "Pin izquierdo", localPos: new THREE.Vector3(-0.015, -0.022, 0) },
        { id: "right", label: "Pin derecho", localPos: new THREE.Vector3(0.015, -0.022, 0) },
      ]
    }

    if (data.type === "button") {
      mesh.userData.pins = [
        { id: "pin_a", label: "Pin A", localPos: new THREE.Vector3(-0.0225, -0.024, 0) },
        { id: "pin_b", label: "Pin B", localPos: new THREE.Vector3(0.0225, -0.024, 0) },
      ]
    }

    if (data.type === "switch") {
      mesh.userData.pins = [
        { id: "pin_a", label: "Pin A", localPos: new THREE.Vector3(-0.0225, -0.024, 0) },
        { id: "pin_b", label: "Pin B", localPos: new THREE.Vector3(0.0225, -0.024, 0) },
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

    mesh.userData.getTerminalWorldPositions = function () {
      const results = []
      const worldPos = new THREE.Vector3()

      if (!this.terminals || !Array.isArray(this.terminals)) return results

      for (const terminal of this.terminals) {
        worldPos.copy(terminal.localPos)
        mesh.localToWorld(worldPos)
        results.push({
          id: terminal.id,
          label: terminal.label,
          worldPos: worldPos.clone(),
        })
      }

      return results
    }

    mesh.userData.getConnectionAnchors = function () {
      const results = []

      if (Array.isArray(this.terminals)) {
        for (const tPos of this.getTerminalWorldPositions()) {
          results.push({
            id: tPos.id,
            label: tPos.label,
            kind: "terminal",
            worldPos: tPos.worldPos.clone(),
          })
        }
      }

      if (Array.isArray(this.pins)) {
        for (const pPos of this.getPinWorldPositions()) {
          results.push({
            id: pPos.id,
            label: pPos.label,
            kind: "pin",
            worldPos: pPos.worldPos.clone(),
          })
        }
      }

      return results
    }

    return mesh
  }
}