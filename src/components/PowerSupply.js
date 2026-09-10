// Hecho e implementado por LFTS
import * as THREE from "three"
import { SUPPLY_FIELDS, supplySettings } from "../core/PowerSupplySettings.js"

// Fuente de banco con controles propios y terminales compatibles con los cables existentes. Hecho e implementado por LFTS
export function createPowerSupply(data) {
  const group = new THREE.Group()
  group.name = "PowerSupply"
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.20, 0.17),
    new THREE.MeshStandardMaterial({ color: 0xd5d9dd, roughness: 0.65 }))
  body.position.y = 0.10
  body.name = "PowerSupplyBody"
  group.add(body)
  const textures = [], controls = [], screens = new Map(), knobs = new Map()
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.266, 0.184, 0.006),
    new THREE.MeshStandardMaterial({ color: 0x303941, roughness: 0.8 }))
  plate.position.set(0, 0.10, 0.088)
  group.add(plate)

  function textFace(width, height, x, y, z) {
    const canvas = document.createElement("canvas")
    canvas.width = 768; canvas.height = 256
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    textures.push(texture)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture }))
    face.position.set(x, y, z)
    group.add(face)
    return { canvas, texture, face }
  }

  for (const [field, y] of [["voltage", 0.15], ["currentLimit", 0.085]]) {
    const screen = textFace(0.158, 0.048, -0.04, y, 0.093)
    screen.face.userData.supplyControl = { field, kind: "entry", root: group }
    controls.push(screen.face)
    screens.set(field, screen)
    const knob = new THREE.Group()
    knob.position.set(0.087, y, 0.102)
    knob.userData.supplyControl = { field, kind: "knob", root: group }
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.023, 0.020, 32),
      new THREE.MeshStandardMaterial({ color: 0x8c979f, metalness: 0.3, roughness: 0.4 }))
    dial.rotation.x = Math.PI / 2
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.014, 0.002),
      new THREE.MeshStandardMaterial({ color: 0xffffff }))
    indicator.position.set(0, 0.010, 0.011)
    knob.add(dial, indicator)
    group.add(knob)
    controls.push(knob)
    knobs.set(field, knob)
  }

  const terminals = [
    { id: "positive", label: "Positivo", localPos: new THREE.Vector3(-0.045, 0.025, 0.108), color: 0xe53935 },
    { id: "negative", label: "Negativo", localPos: new THREE.Vector3(0.005, 0.025, 0.108), color: 0x15191c },
  ]
  for (const t of terminals) {
    const terminal = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.022, 20),
      new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.4 }))
    terminal.rotation.x = Math.PI / 2
    terminal.position.copy(t.localPos)
    group.add(terminal)
  }
  const caption = textFace(0.073, 0.024, 0.077, 0.025, 0.093)
  const cc = caption.canvas.getContext("2d")
  cc.fillStyle = "#303941"; cc.fillRect(0, 0, 768, 256)
  cc.fillStyle = "#ffffff"; cc.font = "bold 80px Arial"
  cc.textAlign = "center"; cc.fillText("DC 30V / 5A", 384, 150)
  caption.texture.needsUpdate = true
  const signs = textFace(0.075, 0.012, -0.02, 0.047, 0.093)
  const sc = signs.canvas.getContext("2d")
  sc.fillStyle = "#303941"; sc.fillRect(0, 0, 768, 256)
  sc.fillStyle = "#ffffff"; sc.font = "bold 190px Arial"
  sc.fillText("+", 52, 196); sc.fillText("−", 553, 196)
  signs.texture.needsUpdate = true

  group.userData.terminals = terminals
  group.userData.supplyControls = controls
  group.userData.surfaceContactObject = body
  group.userData.surfaceUpright = true
  // Permitir apoyo sobre la plataforma y las demás superficies del laboratorio. Hecho e implementado por LFTS
  group.userData.surfaceDisallowedTypes = []
  group.userData.grabTarget = body
  group.userData.grabCenter = new THREE.Vector3(0, 0.10, 0)
  group.userData.grabRadius = 0.025
  group.userData.getGrabCenterWorld = () => group.localToWorld(new THREE.Vector3(0, 0.10, 0))
  group.userData.getGrabWorldPoints = () => [-0.10, 0, 0.10].map(x => ({
    weight: 1, worldPos: group.localToWorld(new THREE.Vector3(x, 0.10, 0)),
  }))
  let lastDisplay = ""
  group.userData.updateSupplyDisplay = (meta, reading) => {
    const settings = supplySettings(meta)
    const actual = reading?.invalid ? "ERROR" : Number.isFinite(reading?.currentA) ? reading.currentA.toFixed(3) + " A" : "—"
    const exceeded = Number.isFinite(reading?.currentA) && Math.abs(reading.currentA) > settings.currentLimit + 1e-7
    const hash = JSON.stringify([settings, actual, exceeded])
    if (hash === lastDisplay) return
    lastDisplay = hash
    for (const [field, screen] of screens) {
      const spec = SUPPLY_FIELDS[field]
      knobs.get(field).rotation.z = Math.PI * 0.75 - settings[field] / spec.max * Math.PI * 1.5
      const ctx = screen.canvas.getContext("2d")
      ctx.fillStyle = exceeded || reading?.invalid ? "#361416" : "#0b2421"
      ctx.fillRect(0, 0, 768, 256)
      ctx.fillStyle = "#88ffd6"; ctx.textAlign = "left"
      ctx.font = "bold 40px Arial"
      ctx.fillText(field === "voltage" ? "VOLTAJE · toca para escribir" : "MAX A · toca para escribir", 18, 48)
      ctx.font = "bold 103px monospace"
      ctx.fillText(settings[field].toFixed(spec.digits) + " " + spec.unit, 18, 151)
      ctx.font = "39px Arial"
      ctx.fillText(field === "voltage" ? "SALIDA DC" : "CONSUMO: " + actual, 18, 223)
      screen.texture.needsUpdate = true
    }
  }
  group.userData.disposeSupply = () => {
    for (const texture of textures) texture.dispose()
    const geometries = new Set(), materials = new Set()
    group.traverse(o => {
      if (o.geometry) geometries.add(o.geometry)
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m)
    })
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
  }
  group.userData.updateSupplyDisplay(data.meta)
  return group
}
