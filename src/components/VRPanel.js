import * as THREE from "three"

/**
 * Panel 3D con botones de herramientas y acciones.
 * Retorna { group, buttons }
 */
export function createVRPanel({
  position = new THREE.Vector3(0, 1.35, -0.45),
  rotationY = 0,
  onAdd = () => { },
  onLed = () => { },
  onResistor = () => { },
  onWire = () => { },
  onSave = () => { },
  onLoad = () => { },
} = {}) {
  const group = new THREE.Group()
  group.name = "VRPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  const panelGeo = new THREE.BoxGeometry(0.40, 0.34, 0.015)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  const panel = new THREE.Mesh(panelGeo, panelMat)
  panel.name = "VRPanelBase"
  panel.receiveShadow = true
  group.add(panel)

  const buttons = []

  const makeButton = ({ name, x, y, color, action, iconType }) => {
    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.05, 0.02),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0 })
    )
    btn.name = name
    btn.position.set(x, y, 0.02)
    btn.castShadow = true

    btn.userData.isUI = true
    btn.userData.uiAction = action

    // Debounce / cooldown
    btn.userData._lastPressMs = 0
    btn.userData._cooldownMs = 250

    btn.userData.onPress = () => {
      const now = performance.now()
      if (now - btn.userData._lastPressMs < btn.userData._cooldownMs) return
      btn.userData._lastPressMs = now

      if (action === "add") onAdd()
      if (action === "led") onLed()
      if (action === "resistor") onResistor()
      if (action === "wire") onWire()
      if (action === "save") onSave()
      if (action === "load") onLoad()
    }

    const icon = createIcon(iconType)
    icon.position.set(0, 0, 0.013)
    btn.add(icon)

    group.add(btn)
    buttons.push(btn)
  }

  function createIcon(type) {
    const iconGroup = new THREE.Group()
    iconGroup.name = `Icon_${type}`

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6 })
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.4 })

    if (type === "plus") {
      const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.007, 0.006), whiteMat)
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.028, 0.006), whiteMat)
      iconGroup.add(bar1, bar2)

    } else if (type === "battery") {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.024, 0.018, 0.006),
        whiteMat
      )

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, 0.010, 0.006),
        whiteMat
      )
      cap.position.x = 0.015

      const plusBar1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, 0.002, 0.006),
        darkMat
      )
      plusBar1.position.set(-0.006, 0, 0.001)

      const plusBar2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.002, 0.006, 0.006),
        darkMat
      )
      plusBar2.position.set(-0.006, 0, 0.001)

      iconGroup.add(body, cap, plusBar1, plusBar2)

    } else if (type === "save") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.006), whiteMat)
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.006, 0.006),
        darkMat
      )
      slot.position.y = 0.008
      iconGroup.add(body, slot)

    } else if (type === "led") {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), whiteMat)
      bulb.position.y = 0.006

      const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.014, 0.003), metalMat)
      const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.014, 0.003), metalMat)
      leg1.position.set(-0.004, -0.008, 0)
      leg2.position.set(0.004, -0.008, 0)

      iconGroup.add(bulb, leg1, leg2)

    } else if (type === "resistor") {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.01, 0.006),
        whiteMat
      )

      const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0025, 0.0025), metalMat)
      leftLeg.position.set(-0.016, 0, 0)

      const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0025, 0.0025), metalMat)
      rightLeg.position.set(0.016, 0, 0)

      iconGroup.add(body, leftLeg, rightLeg)

    } else if (type === "wire") {
      const leftTip = new THREE.Mesh(
        new THREE.SphereGeometry(0.005, 10, 10),
        whiteMat
      )
      leftTip.position.set(-0.015, 0.004, 0)

      const rightTip = new THREE.Mesh(
        new THREE.SphereGeometry(0.005, 10, 10),
        whiteMat
      )
      rightTip.position.set(0.015, -0.004, 0)

      const segment = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0025, 0.0025, 0.034, 10),
        whiteMat
      )
      segment.rotation.z = Math.PI / 2
      segment.rotation.y = Math.PI / 8

      iconGroup.add(leftTip, rightTip, segment)

    } else if (type === "load") {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.006), whiteMat)
      stem.position.y = 0.004

      const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.014, 10), whiteMat)
      head.rotation.x = Math.PI
      head.position.y = -0.012

      iconGroup.add(stem, head)
    }

    return iconGroup
  }

  makeButton({
    name: "BtnAdd",
    x: -0.11,
    y: 0.09,
    color: 0x2ecc71,
    action: "add",
    iconType: "battery",
  })

  makeButton({
    name: "BtnLed",
    x: 0.0,
    y: 0.09,
    color: 0xe74c3c,
    action: "led",
    iconType: "led",
  })

  makeButton({
    name: "BtnResistor",
    x: 0.11,
    y: 0.09,
    color: 0xd8b26e,
    action: "resistor",
    iconType: "resistor",
  })

  makeButton({
    name: "BtnWire",
    x: -0.11,
    y: -0.09,
    color: 0x95a5a6,
    action: "wire",
    iconType: "wire",
  })

  makeButton({
    name: "BtnSave",
    x: 0.0,
    y: -0.09,
    color: 0xf1c40f,
    action: "save",
    iconType: "save",
  })

  makeButton({
    name: "BtnLoad",
    x: 0.11,
    y: -0.09,
    color: 0x3498db,
    action: "load",
    iconType: "load",
  })

  return { group, buttons }
}