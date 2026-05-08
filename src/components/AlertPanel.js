/**
 * AlertPanel.js
 *
 * Panel de estado del circuito para VR-CIRCUIT.
 * Hecho e implementado por LFTS.
 *
 * Panel flotante permanente — siempre visible desde el inicio,
 * igual que SpawnPanel y ModePanel. No depende de ningún botón
 * ni del modo activo para mostrarse.
 *
 * Comportamiento:
 *   - Siempre muestra el modo actual (edición / simulación)
 *   - En modo edición: solo muestra el modo, sin análisis
 *   - En modo simulación sin errores: muestra "Circuito OK"
 *   - En modo simulación con errores: se despliega mostrando cada falla
 *
 * El panel usa un canvas dinámico renderizado como textura Three.js.
 * Se posiciona en mundo 3D igual que los demás paneles del proyecto.
 *
 * Uso:
 *   const { group, update } = createAlertPanel({ position, rotationY })
 *   scene.add(group)
 *   // En el loop:
 *   update(alerts, hasErrors, appMode)
 */

import * as THREE from "three"

// ─────────────────────────────────────────────
// Dimensiones del panel (en metros)
// ─────────────────────────────────────────────

// Alto compacto cuando no hay errores
const PANEL_W_M        = 0.52
const PANEL_H_COMPACT  = 0.08   // solo muestra el header
const PANEL_H_EXPANDED = 0.36   // se expande al haber errores
const PANEL_DEPTH_M    = 0.015

// Resolución del canvas
const CANVAS_W = 768
const CANVAS_H_COMPACT  = 128
const CANVAS_H_EXPANDED = 576

// ─────────────────────────────────────────────
// Paleta de colores
// ─────────────────────────────────────────────

const C_BG_EDIT    = "#0d1a0d"
const C_BG_SIM_OK  = "#0d0d1a"
const C_BG_ERROR   = "#1a0d0d"

const C_HEADER_EDIT  = "#2ecc71"
const C_HEADER_SIM   = "#3498db"
const C_HEADER_ERROR = "#e74c3c"

const C_TEXT_OK      = "#2ecc71"
const C_TEXT_WARN    = "#f39c12"
const C_TEXT_ERROR   = "#e74c3c"
const C_TEXT_NORMAL  = "#cccccc"

// ─────────────────────────────────────────────
// Factory principal
// ─────────────────────────────────────────────

/**
 * Crea el panel de alertas como objeto Three.js.
 *
 * @param {object} opts
 * @param {THREE.Vector3} opts.position   — Posición en el mundo
 * @param {number}        opts.rotationY  — Rotación Y en radianes
 * @returns {{ group: THREE.Group, update: Function }}
 */
export function createAlertPanel({
  position  = new THREE.Vector3(-0.62, 1.15, -0.48),
  rotationY = Math.PI / 6,
} = {}) {

  // ── Canvas compacto (solo header) ──────────
  const canvasCompact    = document.createElement("canvas")
  canvasCompact.width    = CANVAS_W
  canvasCompact.height   = CANVAS_H_COMPACT
  const ctxCompact       = canvasCompact.getContext("2d")
  const texCompact       = new THREE.CanvasTexture(canvasCompact)
  texCompact.colorSpace  = THREE.SRGBColorSpace

  // ── Canvas expandido (header + alertas) ────
  const canvasExpanded   = document.createElement("canvas")
  canvasExpanded.width   = CANVAS_W
  canvasExpanded.height  = CANVAS_H_EXPANDED
  const ctxExpanded      = canvasExpanded.getContext("2d")
  const texExpanded      = new THREE.CanvasTexture(canvasExpanded)
  texExpanded.colorSpace = THREE.SRGBColorSpace

  // ── Grupo raíz ─────────────────────────────
  const group = new THREE.Group()
  group.name  = "AlertPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  // ── Mesh compacto ──────────────────────────
  const geoCompact = new THREE.BoxGeometry(PANEL_W_M, PANEL_H_COMPACT, PANEL_DEPTH_M)
  const matCompact = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  const meshCompact = new THREE.Mesh(geoCompact, matCompact)
  meshCompact.name = "AlertPanelBodyCompact"

  const faceCompact = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M - 0.008, PANEL_H_COMPACT - 0.008),
    new THREE.MeshBasicMaterial({ map: texCompact, transparent: false })
  )
  faceCompact.position.z = PANEL_DEPTH_M / 2 + 0.001
  meshCompact.add(faceCompact)

  // ── Mesh expandido ─────────────────────────
  const geoExpanded = new THREE.BoxGeometry(PANEL_W_M, PANEL_H_EXPANDED, PANEL_DEPTH_M)
  const matExpanded = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  const meshExpanded = new THREE.Mesh(geoExpanded, matExpanded)
  meshExpanded.name = "AlertPanelBodyExpanded"

  // Centrar expandido hacia abajo desde el header
  meshExpanded.position.y = -(PANEL_H_EXPANDED - PANEL_H_COMPACT) / 2

  const faceExpanded = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M - 0.008, PANEL_H_EXPANDED - 0.008),
    new THREE.MeshBasicMaterial({ map: texExpanded, transparent: false })
  )
  faceExpanded.position.z = PANEL_DEPTH_M / 2 + 0.001
  meshExpanded.add(faceExpanded)

  // Inicialmente solo el compacto es visible
  group.add(meshCompact)
  group.add(meshExpanded)
  meshExpanded.visible = false

  // ── Estado interno ─────────────────────────
  let _lastHash = null

  // ─────────────────────────────────────────────
  // Funciones de dibujo
  // ─────────────────────────────────────────────

  /**
   * Determina el color del header según el modo y si hay errores.
   */
  function headerColor(hasErrors, appMode) {
    if (hasErrors)          return C_HEADER_ERROR
    if (appMode === "sim")  return C_HEADER_SIM
    return C_HEADER_EDIT
  }

  /**
   * Texto del header según modo y errores.
   */
  function headerText(hasErrors, appMode) {
    if (appMode === "edit") return "🔧  MODO EDICIÓN"
    if (hasErrors)          return "⚠   SIMULACIÓN — ERRORES"
    return "✅  SIMULACIÓN — OK"
  }

  /**
   * Color de fondo según modo y errores.
   */
  function bgColor(hasErrors, appMode) {
    if (hasErrors)         return C_BG_ERROR
    if (appMode === "sim") return C_BG_SIM_OK
    return C_BG_EDIT
  }

  /**
   * Dibuja el canvas compacto (solo header).
   */
  function drawCompact(hasErrors, appMode) {
    const ctx = ctxCompact
    const W = CANVAS_W
    const H = CANVAS_H_COMPACT

    ctx.fillStyle = bgColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, H)

    // Borde
    ctx.strokeStyle = headerColor(hasErrors, appMode)
    ctx.lineWidth   = 4
    ctx.strokeRect(3, 3, W - 6, H - 6)

    // Header centrado
    ctx.fillStyle    = headerColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, H)

    ctx.fillStyle    = "#ffffff"
    ctx.font         = "bold 30px Arial"
    ctx.textAlign    = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(headerText(hasErrors, appMode), W / 2, H / 2)

    texCompact.needsUpdate = true
  }

  /**
   * Dibuja el canvas expandido (header + lista de alertas).
   */
  function drawExpanded(alerts, hasErrors, appMode) {
    const ctx = ctxExpanded
    const W   = CANVAS_W
    const H   = CANVAS_H_EXPANDED

    ctx.fillStyle = bgColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, H)

    // Borde
    ctx.strokeStyle = headerColor(hasErrors, appMode)
    ctx.lineWidth   = 4
    ctx.strokeRect(3, 3, W - 6, H - 6)

    // Header
    ctx.fillStyle    = headerColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, 54)

    ctx.fillStyle    = "#ffffff"
    ctx.font         = "bold 28px Arial"
    ctx.textAlign    = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(headerText(hasErrors, appMode), W / 2, 27)

    // Separador
    ctx.strokeStyle = headerColor(hasErrors, appMode)
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.moveTo(16, 56)
    ctx.lineTo(W - 16, 56)
    ctx.stroke()

    // Alertas
    ctx.font        = "22px Arial"
    ctx.textAlign   = "left"
    ctx.textBaseline = "top"

    const lineH  = 38
    const marginX = 18
    let y = 66

    const maxLines = Math.floor((H - 70) / lineH)
    const visible  = alerts.slice(0, maxLines)

    for (const line of visible) {
      ctx.fillStyle = colorForLine(line)
      ctx.fillText(line, marginX, y)
      y += lineH
    }

    if (alerts.length > maxLines) {
      ctx.fillStyle = C_TEXT_WARN
      ctx.fillText(`  … y ${alerts.length - maxLines} alerta(s) más`, marginX, y)
    }

    texExpanded.needsUpdate = true
  }

  /**
   * Color de texto según el prefijo del mensaje.
   */
  function colorForLine(line) {
    if (line.startsWith("✅"))   return C_TEXT_OK
    if (line.startsWith("🔴"))   return C_TEXT_ERROR
    if (line.startsWith("⚠"))    return C_TEXT_WARN
    return C_TEXT_NORMAL
  }

  // ─────────────────────────────────────────────
  // API pública
  // ─────────────────────────────────────────────

  /**
   * Actualiza el panel con el estado actual del circuito.
   * Solo redibuja si los datos cambiaron.
   *
   * @param {string[]} alerts   — Lista de mensajes de diagnóstico
   * @param {boolean}  hasErrors — Si hay errores activos
   * @param {string}   appMode  — "edit" | "sim"
   */
  function update(alerts = [], hasErrors = false, appMode = "edit") {
    const hash = appMode + hasErrors + alerts.join("|")
    if (hash === _lastHash) return
    _lastHash = hash

    const expand = hasErrors && appMode === "sim" && alerts.length > 0

    meshCompact.visible  = !expand
    meshExpanded.visible =  expand

    if (expand) {
      drawExpanded(alerts, hasErrors, appMode)
    } else {
      drawCompact(hasErrors, appMode)
    }
  }

  // Dibujar estado inicial en modo edición
  update([], false, "edit")

  return { group, update }
}