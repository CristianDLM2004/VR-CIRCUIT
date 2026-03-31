import * as THREE from "three"

function makeTextTexture(text, width = 256, height = 128) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = "#ffffff"
  ctx.font = "bold 42px Arial"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createSpawnPanel({
  position = new THREE.Vector3(0.55, 1.15, -0.50),
  rotationY = -Math.PI / 6,
  onAdd = () => {},
  onLed = () => {},
  onResistor = () => {},
  onButton = () => {},
  onSwitch = () => {},
} = {}) {
  const group = new THREE.Group()
  group.name = "SpawnPanel"
  group.position.copy(position)
  group.rotation.y = rotationY
  group.visible = false

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.34, 0.015),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  )
  base.name = "SpawnPanelBase"
  group.add(base)

  const buttons = []

  function createIcon(type) {
    const g = new THREE.Group()
    g.name = `Icon_${type}`

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6 })
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.4 })
    const redMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.4 })
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.4 })

    if (type === "battery") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.018, 0.006), whiteMat)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.010, 0.006), whiteMat)
      cap.position.x = 0.015
      const pH = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.002, 0.006), darkMat)
      pH.position.set(-0.006, 0, 0.001)
      const pV = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.006, 0.006), darkMat)
      pV.position.set(-0.006, 0, 0.001)
      g.add(body, cap, pH, pV)
    } else if (type === "led") {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), whiteMat)
      bulb.position.y = 0.006
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.014, 0.003), metalMat)
      const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.014, 0.003), metalMat)
      l1.position.set(-0.004, -0.008, 0)
      l2.position.set(0.004, -0.008, 0)
      g.add(bulb, l1, l2)
    } else if (type === "resistor") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.010, 0.006), whiteMat)
      const lL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0025, 0.0025), metalMat)
      lL.position.set(-0.016, 0, 0)
      const rL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0025, 0.0025), metalMat)
      rL.position.set(0.016, 0, 0)
      g.add(body, lL, rL)
    } else if (type === "button") {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.008, 0.016), whiteMat)
      base.position.y = -0.004
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 14), redMat)
      cap.position.y = 0.007
      const lL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.010, 0.002), metalMat)
      lL.position.set(-0.006, -0.013, 0)
      const rL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.010, 0.002), metalMat)
      rL.position.set(0.006, -0.013, 0)
      g.add(base, cap, lL, rL)
    } else if (type === "switch") {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.007, 0.010), whiteMat)
      base.position.y = -0.004
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), greenMat)
      lever.position.y = 0.008
      lever.rotation.z = -Math.PI / 5
      const lL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.010, 0.002), metalMat)
      lL.position.set(-0.007, -0.013, 0)
      const rL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.010, 0.002), metalMat)
      rL.position.set(0.007, -0.013, 0)
      g.add(base, lever, lL, rL)
    }

    return g
  }

  function makeButton({ name, x, y, color, label, iconType, onPress }) {
    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.05, 0.02),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    )
    btn.name = name
    btn.position.set(x, y, 0.02)
    btn.castShadow = true

    btn.userData.isUI = true
    btn.userData._lastPressMs = 0
    btn.userData._cooldownMs = 220
    btn.userData.onPress = () => {
      const now = performance.now()
      if (now - btn.userData._lastPressMs < btn.userData._cooldownMs) return
      btn.userData._lastPressMs = now
      btn.scale.set(0.92, 0.92, 0.92)
      setTimeout(() => btn.scale.set(1, 1, 1), 80)
      onPress()
    }

    const icon = createIcon(iconType)
    icon.position.set(0, 0.010, 0.013)
    btn.add(icon)

    const labelTex = makeTextTexture(label)
    const labelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.070, 0.020),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
    )
    labelPlane.position.set(0, -0.012, 0.013)
    btn.add(labelPlane)

    group.add(btn)
    buttons.push(btn)
    return btn
  }

  const colX = [-0.18, -0.06, 0.06, 0.18]

  makeButton({ name: "SpawnBattery", x: colX[0], y: 0.08, color: 0x2ecc71, label: "Bateria", iconType: "battery", onPress: onAdd })
  makeButton({ name: "SpawnLed", x: colX[1], y: 0.08, color: 0xe74c3c, label: "LED", iconType: "led", onPress: onLed })
  makeButton({ name: "SpawnResistor", x: colX[2], y: 0.08, color: 0xd8b26e, label: "Resist.", iconType: "resistor", onPress: onResistor })
  makeButton({ name: "SpawnButton", x: colX[3], y: 0.08, color: 0xc0392b, label: "Boton", iconType: "button", onPress: onButton })

  makeButton({ name: "SpawnSwitch", x: colX[0], y: -0.04, color: 0x27ae60, label: "Switch", iconType: "switch", onPress: onSwitch })

  return { group, buttons }
}