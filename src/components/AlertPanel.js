// Hecho e implementado por LFTS
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
 *   // En el loop: — Hecho e implementado por LFTS
 *   update(alerts, hasErrors, appMode)
 */

import * as THREE from "three"

// ───────────────────────────────────────────── — Hecho e implementado por LFTS
// Dimensiones del panel (en metros) — Hecho e implementado por LFTS
// ───────────────────────────────────────────── — Hecho e implementado por LFTS

const PANEL_W_M        = 0.52
const PANEL_H_COMPACT  = 0.08    // alto en estado normal (solo header) — Hecho e implementado por LFTS
const PANEL_H_EXPANDED = 0.38    // alto en estado expandido (header + errores) — Hecho e implementado por LFTS
const PANEL_DEPTH_M    = 0.015

// Resolución canvas — Hecho e implementado por LFTS
const CANVAS_W          = 768
const CANVAS_H_COMPACT  = 128
const CANVAS_H_EXPANDED = 608

// ───────────────────────────────────────────── — Hecho e implementado por LFTS
// Paleta de colores — Hecho e implementado por LFTS
// ───────────────────────────────────────────── — Hecho e implementado por LFTS

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

// ───────────────────────────────────────────── — Hecho e implementado por LFTS
// Factory principal — Hecho e implementado por LFTS
// ───────────────────────────────────────────── — Hecho e implementado por LFTS

/**
 * Crea el panel de alertas como objeto Three.js.
 *
 * @param {object} opts
 * @param {THREE.Vector3} opts.position   — Posición base en el mundo (header)
 * @param {number}        opts.rotationY  — Rotación Y en radianes
 * @returns {{ group: THREE.Group, update: Function }}
 * Hecho e implementado por LFTS
 */
export function createAlertPanel({
  position  = new THREE.Vector3(-0.62, 1.15, -0.48),
  rotationY = Math.PI / 6,
} = {}) {

  // ── Canvas compacto ──────────────────────── — Hecho e implementado por LFTS
  const canvasCompact   = document.createElement("canvas")
  canvasCompact.width   = CANVAS_W
  canvasCompact.height  = CANVAS_H_COMPACT
  const ctxCompact      = canvasCompact.getContext("2d")
  const texCompact      = new THREE.CanvasTexture(canvasCompact)
  texCompact.colorSpace = THREE.SRGBColorSpace

  // ── Canvas expandido ─────────────────────── — Hecho e implementado por LFTS
  const canvasExpanded   = document.createElement("canvas")
  canvasExpanded.width   = CANVAS_W
  canvasExpanded.height  = CANVAS_H_EXPANDED
  const ctxExpanded      = canvasExpanded.getContext("2d")
  const texExpanded      = new THREE.CanvasTexture(canvasExpanded)
  texExpanded.colorSpace = THREE.SRGBColorSpace

  // ── Grupo raíz ───────────────────────────── — Hecho e implementado por LFTS
  // La posición del grupo es la del BORDE INFERIOR del panel (donde está el header). — Hecho e implementado por LFTS
  // Al expandirse, el panel crece HACIA ARRIBA desde ese punto, — Hecho e implementado por LFTS
  // así no choca con los paneles que están por debajo. — Hecho e implementado por LFTS
  const group = new THREE.Group()
  group.name  = "AlertPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  // ── Mesh compacto ────────────────────────── — Hecho e implementado por LFTS
  // Centrado en Y=0 del grupo → ocupa de -H/2 a +H/2 — Hecho e implementado por LFTS
  const meshCompact = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_W_M, PANEL_H_COMPACT, PANEL_DEPTH_M),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  )
  meshCompact.name = "AlertPanelBodyCompact"
  // Sin desplazamiento: el header queda centrado en la posición base — Hecho e implementado por LFTS
  meshCompact.position.y = 0

  const faceCompact = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M - 0.008, PANEL_H_COMPACT - 0.008),
    new THREE.MeshBasicMaterial({ map: texCompact, transparent: false })
  )
  faceCompact.position.z = PANEL_DEPTH_M / 2 + 0.001
  meshCompact.add(faceCompact)

  // ── Mesh expandido ───────────────────────── — Hecho e implementado por LFTS
  // Se desplaza hacia ARRIBA desde la posición base. — Hecho e implementado por LFTS
  // El header ocupa la parte inferior del panel expandido, — Hecho e implementado por LFTS
  // y las alertas crecen hacia arriba, lejos de los otros paneles. — Hecho e implementado por LFTS
  const meshExpanded = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_W_M, PANEL_H_EXPANDED, PANEL_DEPTH_M),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  )
  meshExpanded.name = "AlertPanelBodyExpanded"

  // Desplazar hacia arriba: el centro del panel expandido queda — Hecho e implementado por LFTS
  // a (PANEL_H_EXPANDED / 2) encima de la posición base — Hecho e implementado por LFTS
  meshExpanded.position.y = PANEL_H_EXPANDED / 2

  const faceExpanded = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M - 0.008, PANEL_H_EXPANDED - 0.008),
    new THREE.MeshBasicMaterial({ map: texExpanded, transparent: false })
  )
  faceExpanded.position.z = PANEL_DEPTH_M / 2 + 0.001
  meshExpanded.add(faceExpanded)

  group.add(meshCompact, meshExpanded)

  // Estado inicial: solo compacto visible — Hecho e implementado por LFTS
  meshCompact.visible  = true
  meshExpanded.visible = false

  // ── Estado interno ───────────────────────── — Hecho e implementado por LFTS
  let _lastHash = null

  // ───────────────────────────────────────────── — Hecho e implementado por LFTS
  // Helpers de estilo — Hecho e implementado por LFTS
  // ───────────────────────────────────────────── — Hecho e implementado por LFTS

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

  // ───────────────────────────────────────────── — Hecho e implementado por LFTS
  // Funciones de dibujo — Hecho e implementado por LFTS
  // ───────────────────────────────────────────── — Hecho e implementado por LFTS

  /**
   * Dibuja el canvas compacto — solo el header con el modo actual.
   * Hecho e implementado por LFTS
 */
  function drawCompact(hasErrors, appMode) {
    const ctx = ctxCompact
    const W   = CANVAS_W
    const H   = CANVAS_H_COMPACT

    // Fondo completo con color del header — Hecho e implementado por LFTS
    ctx.fillStyle = headerColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, H)

    // Borde interior — Hecho e implementado por LFTS
    ctx.strokeStyle = "rgba(255,255,255,0.3)"
    ctx.lineWidth   = 3
    ctx.strokeRect(3, 3, W - 6, H - 6)

    // Texto centrado — Hecho e implementado por LFTS
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
   * Hecho e implementado por LFTS
 */
  function drawExpanded(alerts, hasErrors, appMode) {
    const ctx = ctxExpanded
    const W   = CANVAS_W
    const H   = CANVAS_H_EXPANDED

    // Fondo — Hecho e implementado por LFTS
    ctx.fillStyle = bgColor(hasErrors, appMode)
    ctx.fillRect(0, 0, W, H)

    // Borde — Hecho e implementado por LFTS
    ctx.strokeStyle = headerColor(hasErrors, appMode)
    ctx.lineWidth   = 4
    ctx.strokeRect(3, 3, W - 6, H - 6)

    // ── Alertas en la parte SUPERIOR del canvas ── — Hecho e implementado por LFTS
    // (que visualmente es la parte superior del panel que crece hacia arriba) — Hecho e implementado por LFTS

    const lineH = 35, marginX = 18, maxWidth = W - marginX * 2
    ctx.font = "22px Arial"
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    const lines = []
    for (const alert of alerts) {
      let text = ""
      for (const word of alert.split(/\s+/)) {
        const candidate = text ? text + " " + word : word
        if (text && ctx.measureText(candidate).width > maxWidth) {
          lines.push({ text, color: colorForLine(alert) })
          text = word
        } else text = candidate
      }
      if (text) lines.push({ text, color: colorForLine(alert) })
    }
    const capacity = Math.floor((H - 84) / lineH)
    const pageCount = Math.max(1, Math.ceil(lines.length / capacity))
    const page = Math.floor(performance.now() / 6000) % pageCount
    let y = 14
    for (const line of lines.slice(page * capacity, (page + 1) * capacity)) {
      ctx.fillStyle = line.color
      ctx.fillText(line.text, marginX, y, maxWidth)
      y += lineH
    }
    if (pageCount > 1) {
      ctx.fillStyle = C_TEXT_WARN
      ctx.font = "18px Arial"
      ctx.fillText("Página " + (page + 1) + "/" + pageCount + " · cambio cada 6 s", marginX, H - 78)
    }

    // ── Separador antes del header ────────────── — Hecho e implementado por LFTS
    const headerH  = 54
    const headerY  = H - headerH

    ctx.strokeStyle = headerColor(hasErrors, appMode)
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.moveTo(16, headerY - 2)
    ctx.lineTo(W - 16, headerY - 2)
    ctx.stroke()

    // ── Header en la parte INFERIOR del canvas ── — Hecho e implementado por LFTS
    ctx.fillStyle = headerColor(hasErrors, appMode)
    ctx.fillRect(0, headerY, W, headerH)

    ctx.fillStyle    = "#ffffff"
    ctx.font         = "bold 28px Arial"
    ctx.textAlign    = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(headerText(hasErrors, appMode), W / 2, headerY + headerH / 2)

    texExpanded.needsUpdate = true
  }

  // ───────────────────────────────────────────── — Hecho e implementado por LFTS
  // API pública — Hecho e implementado por LFTS
  // ───────────────────────────────────────────── — Hecho e implementado por LFTS

  /**
   * Actualiza el panel con el estado actual del circuito.
   * Solo redibuja si los datos cambiaron.
   *
   * @param {string[]} alerts   — Lista de mensajes de diagnóstico
   * @param {boolean}  hasErrors — Si hay errores activos
   * @param {string}   appMode  — "edit" | "sim"
   * Hecho e implementado por LFTS
 */
  function update(alerts = [], hasErrors = false, appMode = "edit") {
    const hash = appMode + hasErrors + alerts.join("|") + (hasErrors ? Math.floor(performance.now() / 6000) : "")
    if (hash === _lastHash) return
    _lastHash = hash

    // Expandir solo si hay errores en modo simulación — Hecho e implementado por LFTS
    const shouldExpand = hasErrors && appMode === "sim" && alerts.length > 0

    meshCompact.visible  = !shouldExpand
    meshExpanded.visible =  shouldExpand

    if (shouldExpand) {
      drawExpanded(alerts, hasErrors, appMode)
    } else {
      drawCompact(hasErrors, appMode)
    }
  }

  // Dibujar estado inicial (modo edición) — Hecho e implementado por LFTS
  update([], false, "edit")

  return { group, update }
}