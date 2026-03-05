import * as THREE from "three"
import { SceneManager } from "./core/SceneManager.js"
import { VRManager } from "./core/VRManager.js"
import { AppState } from "./core/AppState.js"
import { StateSyncSystem } from "./systems/StateSyncSystem.js"
import { InteractionSystem } from "./systems/InteractionSystem.js"

import { createProtoboard } from "./components/Protoboard.js"
import { HoleSystem } from "./systems/HoleSystem.js"
import { createVRPanel } from "./components/VRPanel.js"

import { TrashSystem } from "./systems/TrashSystem.js"

const sceneManager = new SceneManager()
const { scene, camera, renderer } = sceneManager

new VRManager(renderer)

const appState = new AppState()
const interactionSystem = new InteractionSystem(sceneManager, appState)
const stateSyncSystem = new StateSyncSystem(scene, appState, interactionSystem)

// ---------------------------
// Luces
// ---------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const dir = new THREE.DirectionalLight(0xffffff, 1.0)
dir.position.set(2, 4, 2)
scene.add(dir)

// ---------------------------
// Helpers: IDs y acciones
// ---------------------------
function genId(prefix = "cmp") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

function addCube() {
  const id = genId("cube")

  // Spawn cercano: sobre el protoboard pero ligeramente hacia el usuario
  const p = protoboard.position.clone()
  p.y += 0.15
  p.z += 0.12

  appState.addComponent({
    id,
    type: "cube",
    transform: { x: p.x, y: p.y, z: p.z, qx: 0, qy: 0, qz: 0, qw: 1 },
  })

  stateSyncSystem.rebuildFromState()
}

function saveState() {
  localStorage.setItem("vr_circuit_state", appState.toJSON())
  console.log("✅ Estado guardado")
}

function loadState() {
  const raw = localStorage.getItem("vr_circuit_state")
  if (!raw) return console.log("⚠️ No hay estado guardado")
  appState.loadFromObject(JSON.parse(raw))
  stateSyncSystem.rebuildFromState()
  console.log("✅ Estado cargado y reconstruido")
}

// ---------------------------
// Piso + Mesa (surfaces)
// ---------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
)
floor.rotation.x = -Math.PI / 2
floor.position.y = 0
scene.add(floor)

// Mesa cómoda en VR
const table = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 0.1, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x444444 })
)
table.position.set(0, 0.75, -0.8)
scene.add(table)

table.updateMatrixWorld(true)

interactionSystem.registerSurface(floor, { type: "floor" })

const tableBox = new THREE.Box3().setFromObject(table)
const tableMargin = 0.12
interactionSystem.registerSurface(table, {
  type: "table",
  bounds: {
    minX: tableBox.min.x + tableMargin,
    maxX: tableBox.max.x - tableMargin,
    minZ: tableBox.min.z + tableMargin,
    maxZ: tableBox.max.z - tableMargin,
  },
})

// ---------------------------
// Protoboard + HoleSystem
// ---------------------------
const tableTopY = table.position.y + 0.05
const { group: protoboard, surfaceMesh: protoSurface, layout } = createProtoboard({
  position: new THREE.Vector3(table.position.x, tableTopY + 0.03, table.position.z),
})
scene.add(protoboard)

interactionSystem.registerSurface(protoSurface, { type: "protoboard" })

const holeSystem = new HoleSystem(protoboard, layout)
interactionSystem.setHoleSystem(holeSystem)

// ---------------------------
// Debug: ejes del mundo
// ---------------------------
const worldAxes = new THREE.AxesHelper(0.6)
worldAxes.position.set(0, 0.01, 0)
scene.add(worldAxes)

// ---------------------------
// UI estática (panel + bote) con modo ajuste
// ---------------------------
const UI_KEYS = {
  panel: "vr_ui_panel_pos",
  trash: "vr_ui_trash_pos",
}

const DEFAULTS = {
  panelPos: new THREE.Vector3(0.85, 1.15, -0.95),
  trashPos: new THREE.Vector3(-0.85, 0.0, -0.35),
  panelRotY: -Math.PI / 6,
}

// Carga Vector3 desde localStorage
function loadVec3(key, fallbackVec3) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallbackVec3.clone()
    const obj = JSON.parse(raw)
    if (typeof obj?.x !== "number" || typeof obj?.y !== "number" || typeof obj?.z !== "number") {
      return fallbackVec3.clone()
    }
    return new THREE.Vector3(obj.x, obj.y, obj.z)
  } catch {
    return fallbackVec3.clone()
  }
}

// Guarda Vector3 a localStorage
function saveVec3(key, v) {
  localStorage.setItem(key, JSON.stringify({ x: v.x, y: v.y, z: v.z }))
}

// Posiciones iniciales (persistentes)
let panelWorldPos = loadVec3(UI_KEYS.panel, DEFAULTS.panelPos)
let trashWorldPos = loadVec3(UI_KEYS.trash, DEFAULTS.trashPos)

// Panel
const { group: vrPanel, buttons: panelButtons } = createVRPanel({
  position: panelWorldPos.clone(),
  rotationY: DEFAULTS.panelRotY,
  onAdd: addCube,
  onSave: saveState,
  onLoad: loadState,
})
scene.add(vrPanel)

// Registrar botones como interactuables
for (const b of panelButtons) interactionSystem.register(b)

// Refuerzo visual
vrPanel.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x333333)
  }
})

// Bote
const trashSystem = new TrashSystem(scene, appState, stateSyncSystem)
const trashBin = trashSystem.createTrashBin({
  parent: scene,
  position: trashWorldPos.clone(),
})
trashBin.traverse((o) => {
  if (o.isMesh && o.material) {
    o.material = o.material.clone()
    if ("emissive" in o.material) o.material.emissive.setHex(0x222222)
  }
})

// Ejes locales para que veas orientación del panel/bote
const panelAxes = new THREE.AxesHelper(0.25)
vrPanel.add(panelAxes)
const trashAxes = new THREE.AxesHelper(0.25)
trashBin.add(trashAxes)

// ---------------------------
// Modo ajuste (teclas)
// ---------------------------
let tweakTarget = "panel" // "panel" | "trash"
let tweakEnabled = true // puedes apagarlo si quieres

function printPositions() {
  const p = vrPanel.position
  const t = trashBin.position
  console.log(
    `📌 PANEL  pos: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`
  )
  console.log(
    `🗑️ BOTE   pos: (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`
  )
}

function applyCurrentToVars() {
  panelWorldPos.copy(vrPanel.position)
  trashWorldPos.copy(trashBin.position)
}

function resetPositions() {
  vrPanel.position.copy(DEFAULTS.panelPos)
  trashBin.position.copy(DEFAULTS.trashPos)
  applyCurrentToVars()
  console.log("🔄 Reset posiciones a defaults")
  printPositions()
}

window.addEventListener("keydown", (e) => {
  if (!tweakEnabled) return

  const key = e.key.toLowerCase()

  // Selección
  if (key === "1") {
    tweakTarget = "panel"
    console.log("🎯 Ajustando: PANEL")
    return
  }
  if (key === "2") {
    tweakTarget = "trash"
    console.log("🎯 Ajustando: BOTE")
    return
  }

  // Utilidades
  if (key === "p") {
    printPositions()
    return
  }
  if (key === "o") {
    // guardar
    applyCurrentToVars()
    saveVec3(UI_KEYS.panel, panelWorldPos)
    saveVec3(UI_KEYS.trash, trashWorldPos)
    console.log("💾 Guardado en localStorage")
    printPositions()
    return
  }
  if (key === "l") {
    // cargar
    panelWorldPos = loadVec3(UI_KEYS.panel, DEFAULTS.panelPos)
    trashWorldPos = loadVec3(UI_KEYS.trash, DEFAULTS.trashPos)
    vrPanel.position.copy(panelWorldPos)
    trashBin.position.copy(trashWorldPos)
    console.log("📥 Cargado desde localStorage")
    printPositions()
    return
  }
  if (key === "0") {
    resetPositions()
    return
  }

  // Movimiento
  const stepBase = 0.05
  const step = e.shiftKey ? stepBase * 5 : stepBase

  const targetObj = tweakTarget === "panel" ? vrPanel : trashBin

  // WASD = X/Z
  if (key === "a") targetObj.position.x -= step
  if (key === "d") targetObj.position.x += step
  if (key === "w") targetObj.position.z -= step // enfrente (más negativo)
  if (key === "s") targetObj.position.z += step // atrás / más cerca (más positivo)

  // RF = Y
  if (key === "r") targetObj.position.y += step
  if (key === "f") targetObj.position.y -= step
})

// ---------------------------
// UI HTML (PC) opcional
// ---------------------------
document.getElementById("btn-add-cube")?.addEventListener("click", addCube)

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase()
  if (k === "c") addCube()
  if (k === "s") saveState()
  if (k === "l") loadState()
})

// ---------------------------
// Init
// ---------------------------
stateSyncSystem.rebuildFromState()
printPositions()

// ---------------------------
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  interactionSystem.update()
  trashSystem.update(stateSyncSystem.meshById.values())
  sceneManager.render()
})