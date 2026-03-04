import * as THREE from "three"

/**
 * Panel 3D simple con 3 botones (Add / Save / Load).
 * No usa texto (para evitar loaders), pero usa colores + iconos 3D básicos.
 *
 * Retorna: { group, buttons }
 * buttons: array de meshes que debes registrar en InteractionSystem.register(...)
 */
export function createVRPanel({
  position = new THREE.Vector3(0, 1.35, -0.45),
  rotationY = 0,
  onAdd = () => {},
  onSave = () => {},
  onLoad = () => {},
} = {}) {
  const group = new THREE.Group()
  group.name = "VRPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  // Base del panel
  const panelGeo = new THREE.BoxGeometry(0.32, 0.18, 0.015)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  const panel = new THREE.Mesh(panelGeo, panelMat)
  panel.name = "VRPanelBase"
  panel.receiveShadow = true
  group.add(panel)

  const buttons = []

  // Helper para crear botón
  const makeButton = ({ name, x, y, color, action, iconType }) => {
    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.05, 0.02),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0 })
    )
    btn.name = name
    btn.position.set(x, y, 0.02) // un poquito al frente del panel
    btn.castShadow = true

    // Metadata UI
    btn.userData.isUI = true
    btn.userData.uiAction = action
    btn.userData.onPress = () => {
      if (action === "add") onAdd()
      if (action === "save") onSave()
      if (action === "load") onLoad()
    }

    // Icono 3D (sin texto)
    const icon = createIcon(iconType)
    icon.position.set(0, 0, 0.013)
    btn.add(icon)

    group.add(btn)
    buttons.push(btn)
  }

  // Iconos simples
  function createIcon(type) {
    const iconGroup = new THREE.Group()
    iconGroup.name = `Icon_${type}`

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })

    if (type === "plus") {
      const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.007, 0.006), mat)
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.028, 0.006), mat)
      iconGroup.add(bar1, bar2)
    } else if (type === "save") {
      // disquete-ish: un cuadrito + ranura
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.006), mat)
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.006, 0.006),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6 })
      )
      slot.position.y = 0.008
      iconGroup.add(body, slot)
    } else if (type === "load") {
      // flecha hacia abajo
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.006), mat)
      stem.position.y = 0.004
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.014, 10), mat)
      head.rotation.x = Math.PI
      head.position.y = -0.012
      iconGroup.add(stem, head)
    }

    return iconGroup
  }

  // Botones (colores distintos)
  makeButton({ name: "BtnAdd", x: -0.105, y: 0.0, color: 0x2ecc71, action: "add", iconType: "plus" })
  makeButton({ name: "BtnSave", x: 0.0, y: 0.0, color: 0xf1c40f, action: "save", iconType: "save" })
  makeButton({ name: "BtnLoad", x: 0.105, y: 0.0, color: 0x3498db, action: "load", iconType: "load" })

  return { group, buttons }
}