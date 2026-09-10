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

export function createModePanel({
  position = new THREE.Vector3(0.55, 1.15, -0.50),
  rotationY = -Math.PI / 6,
  onWire = () => {},
  onSave = () => {},
  onLoad = () => {},
  onMode = () => {},
  onClear = () => {},
} = {}) {
  const group = new THREE.Group()
  group.name = "ModePanel"
  group.position.copy(position)
  group.rotation.y = rotationY
  group.visible = false

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.34, 0.015),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  )
  base.name = "ModePanelBase"
  group.add(base)

  const buttons = []

  let wireBtnMesh = null
  let modeBtnMesh = null

  const WIRE_COLOR_OFF = 0x95a5a6
  const WIRE_COLOR_ON = 0x00bcd4
  const MODE_EDIT_COLOR = 0x8e44ad
  const MODE_SIM_COLOR = 0xe67e22

  function createIcon(type) {
    const g = new THREE.Group()
    g.name = `Icon_${type}`

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6 })

    if (type === "wire") {
      const lt = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 10), whiteMat)
      lt.position.set(-0.015, 0.004, 0)
      const rt = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 10), whiteMat)
      rt.position.set(0.015, -0.004, 0)
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.034, 10), whiteMat)
      seg.rotation.z = Math.PI / 2
      seg.rotation.y = Math.PI / 8
      g.add(lt, rt, seg)
    } else if (type === "save") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.006), whiteMat)
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.006, 0.006), darkMat)
      slot.position.y = 0.008
      g.add(body, slot)
    } else if (type === "load") {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.020, 0.006), whiteMat)
      stem.position.y = 0.004
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.014, 10), whiteMat)
      head.rotation.x = Math.PI
      head.position.y = -0.012
      g.add(stem, head)
    } else if (type === "mode-edit") {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.022, 0.005), whiteMat)
      shaft.rotation.z = Math.PI / 5
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.008, 6), whiteMat)
      tip.rotation.z = Math.PI / 5 + Math.PI
      tip.position.set(-0.010, -0.013, 0)
      g.add(shaft, tip)
    } else if (type === "mode-sim") {
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), whiteMat)
      top.position.set(0.003, 0.007, 0)
      top.rotation.z = -Math.PI / 8
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), whiteMat)
      bottom.position.set(-0.003, -0.007, 0)
      bottom.rotation.z = -Math.PI / 8
      g.add(top, bottom)
    } else if (type === "clear") {
      const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.004, 0.004), whiteMat)
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.004, 0.004), whiteMat)
      bar1.rotation.z = Math.PI / 4
      bar2.rotation.z = -Math.PI / 4
      g.add(bar1, bar2)
    }

    return g
  }

  function makeButton({ name, x, y, w = 0.10, h = 0.05, color, label, iconType, onPress, action }) {
    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.02),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    )
    btn.name = name
    btn.position.set(x, y, 0.02)
    btn.castShadow = true

    btn.userData.isUI = true
    btn.userData.uiAction = action
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

    if (action === "wire") wireBtnMesh = btn
    if (action === "mode") modeBtnMesh = btn

    group.add(btn)
    buttons.push(btn)
    return btn
  }

  const colX = [-0.12, 0.00, 0.12]

  makeButton({ name: "ModeWire", x: colX[0], y: 0.08, color: WIRE_COLOR_OFF, label: "Cable", iconType: "wire", onPress: onWire, action: "wire" })
  makeButton({ name: "ModeSave", x: colX[1], y: 0.08, color: 0xf1c40f, label: "Guardar", iconType: "save", onPress: onSave, action: "save" })
  makeButton({ name: "ModeLoad", x: colX[2], y: 0.08, color: 0x3498db, label: "Cargar", iconType: "load", onPress: onLoad, action: "load" })

  makeButton({ name: "ModeToggle", x: -0.07, y: -0.05, w: 0.16, h: 0.055, color: MODE_EDIT_COLOR, label: "Modo", iconType: "mode-edit", onPress: onMode, action: "mode" })
  makeButton({ name: "ModeClear", x: 0.11, y: -0.05, w: 0.16, h: 0.055, color: 0xc0392b, label: "Limpiar", iconType: "clear", onPress: onClear, action: "clear" })

  function setWireModeVisual(isActive) {
    if (!wireBtnMesh) return
    wireBtnMesh.material.color.setHex(isActive ? WIRE_COLOR_ON : WIRE_COLOR_OFF)
    if ("emissive" in wireBtnMesh.material) {
      wireBtnMesh.material.emissive.setHex(isActive ? 0x006080 : 0x333333)
    }
  }

  function setSimModeVisual(isSimMode) {
    if (!modeBtnMesh) return

    modeBtnMesh.material.color.setHex(isSimMode ? MODE_SIM_COLOR : MODE_EDIT_COLOR)
    if ("emissive" in modeBtnMesh.material) {
      modeBtnMesh.material.emissive.setHex(isSimMode ? 0x6b3000 : 0x3a006b)
    }

    const oldIcon = modeBtnMesh.children.find((c) => c.name?.startsWith("Icon_"))
    if (oldIcon) modeBtnMesh.remove(oldIcon)

    const icon = createIcon(isSimMode ? "mode-sim" : "mode-edit")
    icon.position.set(0, 0.010, 0.013)
    modeBtnMesh.add(icon)
  }

  return { group, buttons, setWireModeVisual, setSimModeVisual }
}