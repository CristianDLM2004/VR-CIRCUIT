import * as THREE from "three"

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

function hsvToHex(h, s, v) {
  h = ((h % 1) + 1) % 1
  s = clamp01(s)
  v = clamp01(v)

  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  let r = 0, g = 0, b = 0

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }

  return (
    ((Math.round(r * 255) & 255) << 16) |
    ((Math.round(g * 255) & 255) << 8) |
    (Math.round(b * 255) & 255)
  )
}

function hexToRgb01(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  }
}

function rgbToHsv(hex) {
  const { r, g, b } = hexToRgb01(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min

  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max

  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return { h, s, v }
}

function makeTextTexture(width = 768, height = 256) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  return { canvas, ctx, texture }
}

export function createEditPanel({
  position = new THREE.Vector3(-0.55, 1.15, -0.50),
  rotationY = Math.PI / 6,
  onSelectHeld = () => {},
  onSelectLastWire = () => {},
  onClearSelection = () => {},
  onResistanceDelta = () => {},
  onColorPicked = () => {},
  onAcceptChanges = () => {},
} = {}) {
  const group = new THREE.Group()
  group.name = "EditPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.74, 0.58, 0.015),
    new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.92 })
  )
  panel.name = "EditPanelBase"
  group.add(panel)

  const buttons = []

  let currentHue = 0
  let previewColor = 0xff3b3b
  let lastBoundSelectionKey = null

  const status = makeTextTexture()
  const statusMat = new THREE.MeshBasicMaterial({ map: status.texture, transparent: false })
  const statusPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.12), statusMat)
  statusPlane.position.set(-0.07, 0.205, 0.009)
  group.add(statusPlane)

  const preview = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.01),
    new THREE.MeshStandardMaterial({ color: previewColor, roughness: 0.35 })
  )
  preview.position.set(0.26, 0.205, 0.014)
  group.add(preview)

  function drawStatus(lines = []) {
    const { ctx, canvas, texture } = status
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#1a1a1a"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = "#ffffff"
    ctx.font = "bold 34px Arial"
    ctx.fillText("Editor", 28, 44)

    ctx.font = "26px Arial"
    let y = 92
    for (const line of lines) {
      ctx.fillText(line, 28, y)
      y += 38
    }

    texture.needsUpdate = true
  }

  function setPreviewColor(hex) {
    previewColor = hex >>> 0
    preview.material.color.setHex(previewColor)
  }

  function makeButton({
    name,
    x,
    y,
    w = 0.11,
    h = 0.05,
    color = 0x444444,
    label = "",
    onPress = () => {},
  }) {
    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.02),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
    )
    btn.name = name
    btn.position.set(x, y, 0.02)
    btn.castShadow = true

    btn.userData.isUI = true
    btn.userData._lastPressMs = 0
    btn.userData._cooldownMs = 180
    btn.userData.onPress = () => {
      const now = performance.now()
      if (now - btn.userData._lastPressMs < btn.userData._cooldownMs) return
      btn.userData._lastPressMs = now
      btn.scale.set(0.92, 0.92, 0.92)
      setTimeout(() => btn.scale.set(1, 1, 1), 80)
      onPress()
    }

    if (label) {
      const tt = makeTextTexture(256, 128)
      const ctx = tt.ctx
      ctx.fillStyle = "#000000"
      ctx.fillRect(0, 0, 256, 128)
      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 42px Arial"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(label, 128, 64)
      tt.texture.needsUpdate = true

      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.75, h * 0.55),
        new THREE.MeshBasicMaterial({ map: tt.texture, transparent: true })
      )
      face.position.z = 0.011
      btn.add(face)
    }

    group.add(btn)
    buttons.push(btn)
    return btn
  }

  const actionButtons = {
    selectHeld: makeButton({
      name: "BtnEditSelectHeld",
      x: -0.18,
      y: 0.10,
      w: 0.18,
      h: 0.05,
      color: 0x2980b9,
      label: "En mano",
      onPress: onSelectHeld,
    }),
    selectLastWire: makeButton({
      name: "BtnEditSelectLastWire",
      x: 0.02,
      y: 0.10,
      w: 0.16,
      h: 0.05,
      color: 0x8e44ad,
      label: "Cable",
      onPress: onSelectLastWire,
    }),
    clearSelection: makeButton({
      name: "BtnEditClearSelection",
      x: 0.20,
      y: 0.10,
      w: 0.16,
      h: 0.05,
      color: 0xc0392b,
      label: "Limpiar",
      onPress: onClearSelection,
    }),
  }

  const resistorButtons = {
    minus100: makeButton({
      name: "BtnResMinus100",
      x: -0.18,
      y: -0.18,
      color: 0x7f8c8d,
      label: "-100",
      onPress: () => onResistanceDelta(-100),
    }),
    minus10: makeButton({
      name: "BtnResMinus10",
      x: -0.06,
      y: -0.18,
      color: 0x95a5a6,
      label: "-10",
      onPress: () => onResistanceDelta(-10),
    }),
    plus10: makeButton({
      name: "BtnResPlus10",
      x: 0.06,
      y: -0.18,
      color: 0x27ae60,
      label: "+10",
      onPress: () => onResistanceDelta(10),
    }),
    plus100: makeButton({
      name: "BtnResPlus100",
      x: 0.18,
      y: -0.18,
      color: 0x2ecc71,
      label: "+100",
      onPress: () => onResistanceDelta(100),
    }),
  }

  const acceptButton = makeButton({
    name: "BtnEditAccept",
    x: -0.18,
    y: -0.255,
    w: 0.18,
    h: 0.055,
    color: 0x16a085,
    label: "Aceptar",
    onPress: onAcceptChanges,
  })

  const colorButtons = []
  const hueButtons = []

  const boardCols = 10
  const boardRows = 6
  const cellW = 0.034
  const cellH = 0.030
  const cellGap = 0.003
  const boardOriginX = -0.265
  const boardOriginY = -0.03

  function rebuildSVBoard() {
    for (let row = 0; row < boardRows; row++) {
      for (let col = 0; col < boardCols; col++) {
        const idx = row * boardCols + col
        const btn = colorButtons[idx]
        const s = col / (boardCols - 1)
        const v = 1 - row / (boardRows - 1)
        const hex = hsvToHex(currentHue, s, v)
        btn.material.color.setHex(hex)
        btn.userData._pickedColor = hex
      }
    }
  }

  for (let row = 0; row < boardRows; row++) {
    for (let col = 0; col < boardCols; col++) {
      const btn = makeButton({
        name: `BtnColor_${row}_${col}`,
        x: boardOriginX + col * (cellW + cellGap),
        y: boardOriginY - row * (cellH + cellGap),
        w: cellW,
        h: cellH,
        color: 0xffffff,
        label: "",
        onPress: () => {
          const hex = btn.userData._pickedColor ?? 0xffffff
          setPreviewColor(hex)
          onColorPicked(hex)
        },
      })
      colorButtons.push(btn)
    }
  }

  const hueX = 0.29
  const hueStartY = -0.02
  for (let i = 0; i < 8; i++) {
    const hue = i / 8
    const hex = hsvToHex(hue, 1, 1)
    const btn = makeButton({
      name: `BtnHue_${i}`,
      x: hueX,
      y: hueStartY - i * 0.039,
      w: 0.040,
      h: 0.031,
      color: hex,
      label: "",
      onPress: () => {
        currentHue = hue
        rebuildSVBoard()
      },
    })
    hueButtons.push(btn)
  }

  rebuildSVBoard()

  function setColorControlsVisible(visible) {
    for (const b of colorButtons) b.visible = visible
    for (const b of hueButtons) b.visible = visible
    preview.visible = visible
  }

  function setResistorControlsVisible(visible) {
    Object.values(resistorButtons).forEach((b) => { b.visible = visible })
  }

  function updateForSelection(selection) {
    const type = selection?.type ?? null
    const canEditResistance = type === "resistor"
    const canEditColor = type === "led" || type === "wire"
    const canAccept = !!selection && (canEditResistance || canEditColor)

    setResistorControlsVisible(canEditResistance)
    setColorControlsVisible(canEditColor)
    acceptButton.visible = canAccept

    if (canEditColor) {
      const shownColor = typeof selection.pendingColor === "number"
        ? selection.pendingColor
        : selection.color

      const bindKey = `${selection.id ?? "none"}:${shownColor ?? "none"}:${selection.pendingColor ?? "nopending"}`

      if (bindKey !== lastBoundSelectionKey && typeof shownColor === "number") {
        setPreviewColor(shownColor)
        const hsv = rgbToHsv(shownColor)
        currentHue = hsv.h
        rebuildSVBoard()
        lastBoundSelectionKey = bindKey
      }
    } else {
      lastBoundSelectionKey = null
    }

    if (!selection) {
      drawStatus([
        "Seleccionado: ninguno",
        "En mano: toma el componente sostenido",
        "Cable: toma el último cable creado",
      ])
      return
    }

    if (type === "resistor") {
      const shownResistance = selection.pendingResistance ?? selection.resistance ?? 220
      drawStatus([
        "Tipo: resistencia",
        `Valor actual: ${selection.resistance ?? 220} ohms`,
        `Nuevo valor: ${shownResistance} ohms`,
      ])
      return
    }

    if (type === "led") {
      drawStatus([
        "Tipo: LED",
        selection.hasPendingChanges ? "Hay cambios pendientes" : "Sin cambios pendientes",
        "Elige color y presiona Aceptar",
      ])
      return
    }

    if (type === "wire") {
      drawStatus([
        "Tipo: cable",
        selection.hasPendingChanges ? "Hay cambios pendientes" : "Sin cambios pendientes",
        "Elige color y presiona Aceptar",
      ])
      return
    }

    drawStatus([
      `Tipo: ${type}`,
      "Sin edición disponible",
      "",
    ])
  }

  updateForSelection(null)

  return {
    group,
    buttons,
    updateForSelection,
    setPreviewColor,
    actionButtons,
    resistorButtons,
    colorButtons,
    hueButtons,
    acceptButton,
  }
}