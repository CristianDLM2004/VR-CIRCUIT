/**
 * AlertPanel.js
 *
 * Panel de estado del circuito para VR-CIRCUIT.
 * Hecho e implementado por LFTS.
 *
 * Panel flotante permanente — siempre visible desde el inicio.
 * No depende de ningún botón ni del modo activo para mostrarse.
 *
 * Comportamiento:
 *   - Siempre muestra el modo actual (edición / simulación)
 *   - En modo edición: solo muestra el modo, sin análisis
 *   - En modo simulación sin errores: muestra "Circuito OK"
 *   - En modo simulación con errores: se expande HACIA ARRIBA
 *     para no encimarse con los paneles que están debajo
 *
 * El panel usa un canvas dinámico renderizado como textura Three.js.
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

const PANEL_W_M        = 0.52
const PANEL_H_COMPACT  = 0.08    // alto en estado normal (solo header)
const PANEL_H_EXPANDED = 0.38    // alto en estado expandido (header + errores)
const PANEL_DEPTH_M    = 0.015

// Resolución canvas
const CANVAS_W          = 768
const CANVAS_H_COMPACT  = 128
const CANVAS_H_EXPANDED = 608

// ─────────────────────────────────────────────
// Paleta de colores
// ─────────────────────────────────────────────

const C_BG_EDIT    = "#0d1a0d"
const C_BG_SIM_OK  = "#0d0d1a"
const C_BG_ERROR   = "#1a0d0d"

const C_HEADER_EDIT  = "#2ecc71"
const C_HEADER_SIM   = "#3498db"
const C_HEADER_ERROR = "#e74c3c"

const C_TEXT_OK     = "#2ecc71"
const C_TEXT_WARN   = "#f39c12"
const C_TEXT_ERROR  = "#e74c3c"
const C_TEXT_NORMAL = "#cccccc"

// ─────────────────────────────────────────────
// Factory principal
// ─────────────────────────────────────────────

/**
 * Crea el panel de alertas como objeto Three.js.
 *
 * @param {object} opts
 * @param {THREE.Vector3} opts.position   — Posición base en el mundo (header)
 * @param {number}        opts.rotationY  — Rotación Y en radianes
 * @returns {{ group: THREE.Group, update: Function }}
 */
export function createAlertPanel({
  position  = new THREE.Vector3(-0.62, 1.15, -0.48),
  rotationY = Math.PI / 6,
} = {}) {

  // ── Canvas compacto ────────────────────────
  const canvasCompact   = document.createElement("canvas")
  canvasCompact.width   = CANVAS_W
  canvasCompact.height  = CANVAS_H_COMPACT
  const ctxCompact      = canvasCompact.getContext("2d")
  const texCompact      = new THREE.CanvasTexture(canvasCompact)
  texCompact.colorSpace = THREE.SRGBColorSpace

  // ── Canvas expandido ───────────────────────
  const canvasExpanded   = document.createElement("canvas")
  canvasExpanded.width   = CANVAS_W
  canvasExpanded.height  = CANVAS_H_EXPANDED
  const ctxExpanded      = canvasExpanded.getContext("2d")
  const texExpanded      = new THREE.CanvasTexture(canvasExpanded)
  texExpanded.colorSpace = THREE.SRGBColorSpace

  // ── Grupo raíz ─────────────────────────────
  // La posición del grupo es la del BORDE INFERIOR del panel (donde está el header).
  // Al expandirse, el panel crece HACIA ARRIBA desde ese punto,
  // así no choca con los paneles que están por debajo.
  const group = new THREE.Group()
  group.name  = "AlertPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  // ── Mesh compacto ──────────────────────────
  // Centrado en Y=0 del grupo → ocupa de -H/2 a +H/2
  const meshCompact = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_W_M, PANEL_H_COMPACT, PANEL_DEPTH_M),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  )
  meshCompact.name = "AlertPanelBodyCompact"
  // Sin desplazamiento: el header queda centrado en la posición base
  meshCompact.position.y = 0

  const faceCompact = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M - 0.008, PANEL_H_COMPACT - 0.008),
    new THREE.MeshBasicMaterial({ map: texCompact, transparent: false })
  )
  faceCompact.position.z = PANEL_DEPTH_M / 2 + 0.001
  meshCompact.add(faceCompact)

  // ── Mesh expandido ─────────────────────────
  // Se desplaza hacia ARRIBA desde la posición base.
  // El header ocupa la parte inferior del panel expandido,
  // y las alertas crecen hacia arriba, lejos de los otros paneles.
  const meshExpanded = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_W_M, PANEL_H_EXPANDED, PANEL_DEPTH_M),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  )
  meshExpanded.name = "AlertPanelBodyExpanded"

  // Desplazar hacia arriba: el centro del panel expandido queda
  // a (PANEL_H_EXPANDED / 2) encima de la posición base
  meshExpanded.position.y = PANEL_H_EXPANDED / 2

  const faceExpanded = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M - 0.008, PANEL_H_EXPANDED - 0.008),
    new THREE.MeshBasicMaterial({ map: texExpanded, transparent: false })
  )
  faceExpanded.position.z = PANEL_DEPTH_M / 2 + 0.001
  meshExpanded.add(faceExpanded)

  group.add(meshCompact, meshExpanded)

  // Estado inicial: solo compacto visible
  meshCompact.visible  = true
  meshExpanded.visible = false

  // ── Estado interno ─────────────────────────
  let _lastHash = null

  // ─────────────────────────────────────────────
  // Helpers de estilo
  // ─────────────────────────────────────────────

  function headerColor(hasErrors, appMode) {
    if (hasErrors)         return C_HEADER_ERROR
    if (appMode === "sim") return C_HEADER_SIM
    return C_HEADER_EDIT
  }

  function headerText(hasErrors, appMode) {
    if (appMode === "edit") return "🔧  MODO EDICIÓN"
    if (hasErrors)          return "⚠   SIMULACIÓN — ERRORES"
    return "✅  SIMULACIÓN — OK"
  }

  function bgColor(hasErrors, appMode) {
    if (hasErrors)         return C_BG_ERROR
    if (appMode === "sim") return C_BG_SIM_OK
    return C_BG_EDIT
  }

  function colorForLine(line) {
    if (line.startsWith("✅")) return C_TEXT_OK
    if (line.startsWith("🔴")) return C_TEXT_ERROR
    if (line.startsWith("⚠"))  return C_TEXT_WARN
    return C_TEXT_NORMAL
  }

  // ─────────────────────────────────────────────
  // Funciones de dibujo
  // ─────────────────────────────────────────────

  /**
   * Dibuja el canvas compacto — solo el header con el modo actual.
   */
  function drawCompact(hasErrors, appMode) {
    const ctx = ctxCompact
    const W   = CANVAS_W
    const H   = CANVAS_H_COMPACT

    // Fondo completo con color del header
    ctx.fillStyle = headerColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, H)

    // Borde interior
    ctx.strokeStyle = "rgba(255,255,255,0.3)"
    ctx.lineWidth   = 3
    ctx.strokeRect(3, 3, W - 6, H - 6)

    // Texto centrado
    ctx.fillStyle    = "#ffffff"
    ctx.font         = "bold 30px Arial"
    ctx.textAlign    = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(headerText(hasErrors, appMode), W / 2, H / 2)

    texCompact.needsUpdate = true
  }

  /**
   * Dibuja el canvas expandido — header en la parte INFERIOR + alertas arriba.
   * Al crecer hacia arriba, el header queda al fondo y las alertas encima.
   */
  function drawExpanded(alerts, hasErrors, appMode) {
    const ctx = ctxExpanded
    const W   = CANVAS_W
    const H   = CANVAS_H_EXPANDED

    // Fondo
    ctx.fillStyle = bgColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, H)

    // Borde
    ctx.strokeStyle = headerColor(hasErrors, appMode)
    ctx.lineWidth   = 4
    ctx.strokeRect(3, 3, W - 6, H - 6)

    // ── Alertas en la parte SUPERIOR del canvas ──
    // (que visualmente es la parte superior del panel que crece hacia arriba)
    const lineH   = 40
    const marginX = 18
    const maxLines = Math.floor((H - 70) / lineH)
    const visible  = alerts.slice(0, maxLines)

    ctx.font        = "22px Arial"
    ctx.textAlign   = "left"
    ctx.textBaseline = "top"

    let y = 14
    for (const line of visible) {
      ctx.fillStyle = colorForLine(line)
      ctx.fillText(line, marginX, y)
      y += lineH
    }

    if (alerts.length > maxLines) {
      ctx.fillStyle = C_TEXT_WARN
      ctx.fillText(`  … y ${alerts.length - maxLines} más`, marginX, y)
    }

    // ── Separador antes del header ──────────────
    const headerH  = 54
    const headerY  = H - headerH

    ctx.strokeStyle = headerColor(hasErrors, appMode)
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.moveTo(16, headerY - 2)
    ctx.lineTo(W - 16, headerY - 2)
    ctx.stroke()

    // ── Header en la parte INFERIOR del canvas ──
    ctx.fillStyle = headerColor(hasErrors, appMode)
    ctx.fillRect(0, headerY, W, headerH)

    ctx.fillStyle    = "#ffffff"
    ctx.font         = "bold 28px Arial"
    ctx.textAlign    = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(headerText(hasErrors, appMode), W / 2, headerY + headerH / 2)

    texExpanded.needsUpdate = true
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

    // Expandir solo si hay errores en modo simulación
    const shouldExpand = hasErrors && appMode === "sim" && alerts.length > 0

    meshCompact.visible  = !shouldExpand
    meshExpanded.visible =  shouldExpand

    if (shouldExpand) {
      drawExpanded(alerts, hasErrors, appMode)
    } else {
      drawCompact(hasErrors, appMode)
    }
  }

  // Dibujar estado inicial (modo edición)
  update([], false, "edit")

  return { group, update }
}