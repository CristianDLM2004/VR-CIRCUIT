import * as THREE from "three"

/**
 * Panel 3D con botones de herramientas y acciones.
 * Layout: 4 columnas × 3 filas = hasta 12 slots
 *
 * Fila 1: batería, LED, resistencia, botón
 * Fila 2: switch, cable (toggle), guardar, cargar
 * Fila 3: modo (edición/simulación) — centrado
 *
 * Exporta:
 *   setWireModeVisual(isActive)  — cambia color del botón cable
 *   setSimModeVisual(isSimMode)  — cambia color del botón modo
 */
export function createVRPanel({
  position   = new THREE.Vector3(0, 1.35, -0.45),
  rotationY  = 0,
  onAdd      = () => { },
  onLed      = () => { },
  onResistor = () => { },
  onButton   = () => { },
  onSwitch   = () => { },
  onWire     = () => { },
  onSave     = () => { },
  onLoad     = () => { },
  onMode     = () => { },
} = {}) {

  const group = new THREE.Group()
  group.name = "VRPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  // Panel más alto para acomodar 3 filas
  const panelGeo = new THREE.BoxGeometry(0.52, 0.46, 0.015)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  const panel    = new THREE.Mesh(panelGeo, panelMat)
  panel.name = "VRPanelBase"
  panel.receiveShadow = true
  group.add(panel)

  const buttons = []

  // Referencias a botones especiales para cambiar su color
  let wireBtnMesh = null
  let modeBtnMesh = null

  const WIRE_COLOR_OFF  = 0x95a5a6
  const WIRE_COLOR_ON   = 0x00bcd4

  const MODE_EDIT_COLOR = 0x8e44ad   // morado = edición
  const MODE_SIM_COLOR  = 0xe67e22   // naranja = simulación

  const makeButton = ({ name, x, y, color, action, iconType, w = 0.10, h = 0.05 }) => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0 })
    const btn = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), mat)
    btn.name = name
    btn.position.set(x, y, 0.02)
    btn.castShadow = true

    btn.userData.isUI         = true
    btn.userData.uiAction     = action
    btn.userData._lastPressMs = 0
    btn.userData._cooldownMs  = 250

    btn.userData.onPress = () => {
      const now = performance.now()
      if (now - btn.userData._lastPressMs < btn.userData._cooldownMs) return
      btn.userData._lastPressMs = now

      btn.scale.set(0.92, 0.92, 0.92)
      setTimeout(() => btn.scale.set(1, 1, 1), 80)

      if (action === "add")      onAdd()
      if (action === "led")      onLed()
      if (action === "resistor") onResistor()
      if (action === "button")   onButton()
      if (action === "switch")   onSwitch()
      if (action === "wire")     onWire()
      if (action === "save")     onSave()
      if (action === "load")     onLoad()
      if (action === "mode")     onMode()
    }

    const icon = createIcon(iconType)
    icon.position.set(0, 0, 0.013)
    btn.add(icon)

    group.add(btn)
    buttons.push(btn)

    if (action === "wire") wireBtnMesh = btn
    if (action === "mode") modeBtnMesh = btn

    return btn
  }

  function createIcon(type) {
    const g        = new THREE.Group()
    g.name         = `Icon_${type}`
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    const darkMat  = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6 })
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.4 })
    const redMat   = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.4 })
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.4 })

    if (type === "battery") {
      const body  = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.018, 0.006), whiteMat)
      const cap   = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.010, 0.006), whiteMat)
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
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.006), whiteMat)
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
      const base  = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.007, 0.010), whiteMat)
      base.position.y = -0.004
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), greenMat)
      lever.position.y  = 0.008
      lever.rotation.z  = -Math.PI / 5
      const lL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.010, 0.002), metalMat)
      lL.position.set(-0.007, -0.013, 0)
      const rL = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.010, 0.002), metalMat)
      rL.position.set(0.007, -0.013, 0)
      g.add(base, lever, lL, rL)

    } else if (type === "wire") {
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
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.006), whiteMat)
      stem.position.y = 0.004
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.014, 10), whiteMat)
      head.rotation.x = Math.PI
      head.position.y = -0.012
      g.add(stem, head)

    } else if (type === "mode-edit") {
      // Icono: lápiz — modo edición
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.022, 0.005), whiteMat)
      shaft.rotation.z = Math.PI / 5
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.008, 6), whiteMat)
      tip.rotation.z = Math.PI / 5 + Math.PI
      tip.position.set(-0.010, -0.013, 0)
      g.add(shaft, tip)

    } else if (type === "mode-sim") {
      // Icono: rayo — modo simulación
      const top    = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), whiteMat)
      top.position.set(0.003, 0.007, 0)
      top.rotation.z = -Math.PI / 8
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), whiteMat)
      bottom.position.set(-0.003, -0.007, 0)
      bottom.rotation.z = -Math.PI / 8
      g.add(top, bottom)
    }

    return g
  }

  // ---------------------------
  // Layout
  // Fila 1 (y=+0.14): batería, LED, resistencia, botón
  // Fila 2 (y=+0.02): switch, cable, guardar, cargar
  // Fila 3 (y=-0.10): [modo — botón ancho centrado]
  // ---------------------------
  const colX = [-0.183, -0.061, 0.061, 0.183]

  makeButton({ name: "BtnAdd",      x: colX[0], y:  0.14, color: 0x2ecc71,        action: "add",      iconType: "battery"   })
  makeButton({ name: "BtnLed",      x: colX[1], y:  0.14, color: 0xe74c3c,        action: "led",      iconType: "led"       })
  makeButton({ name: "BtnResistor", x: colX[2], y:  0.14, color: 0xd8b26e,        action: "resistor", iconType: "resistor"  })
  makeButton({ name: "BtnButton",   x: colX[3], y:  0.14, color: 0xe74c3c,        action: "button",   iconType: "button"    })

  makeButton({ name: "BtnSwitch",   x: colX[0], y:  0.02, color: 0x27ae60,        action: "switch",   iconType: "switch"    })
  makeButton({ name: "BtnWire",     x: colX[1], y:  0.02, color: WIRE_COLOR_OFF,  action: "wire",     iconType: "wire"      })
  makeButton({ name: "BtnSave",     x: colX[2], y:  0.02, color: 0xf1c40f,        action: "save",     iconType: "save"      })
  makeButton({ name: "BtnLoad",     x: colX[3], y:  0.02, color: 0x3498db,        action: "load",     iconType: "load"      })

  // Botón de modo — más ancho, centrado en la tercera fila
  makeButton({ name: "BtnMode", x: 0, y: -0.10, color: MODE_EDIT_COLOR, action: "mode", iconType: "mode-edit", w: 0.22, h: 0.06 })

  // ---------------------------
  // APIs de feedback visual
  // ---------------------------
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
    // Cambiar icono: swapear entre mode-edit y mode-sim
    const iconContainer = modeBtnMesh.children.find((c) => c.name?.startsWith("Icon_"))
    if (iconContainer) {
      iconContainer.name = isSimMode ? "Icon_mode-sim" : "Icon_mode-edit"
      // Limpiar hijos del icono y redibujar
      while (iconContainer.children.length > 0) {
        const child = iconContainer.children[0]
        iconContainer.remove(child)
      }
      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
      if (isSimMode) {
        // Rayo
        const top    = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), whiteMat)
        top.position.set(0.003, 0.007, 0); top.rotation.z = -Math.PI / 8
        const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.014, 0.005), whiteMat)
        bottom.position.set(-0.003, -0.007, 0); bottom.rotation.z = -Math.PI / 8
        iconContainer.add(top, bottom)
      } else {
        // Lápiz
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.022, 0.005), whiteMat)
        shaft.rotation.z = Math.PI / 5
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.008, 6), whiteMat)
        tip.rotation.z = Math.PI / 5 + Math.PI; tip.position.set(-0.010, -0.013, 0)
        iconContainer.add(shaft, tip)
      }
    }
  }

  return { group, buttons, setWireModeVisual, setSimModeVisual }
}