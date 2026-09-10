// Hecho e implementado por LFTS
import { buildCircuit, solveCircuit } from "./CircuitSolver.js"

function namedColorToHex(name, fallback = 0xff3b3b) {
  if (typeof name !== "string") return fallback
  const n = name.trim().toLowerCase()

  const map = {
    red:     0xff3b3b,
    green:   0x2ecc71,
    blue:    0x3498db,
    yellow:  0xf1c40f,
    orange:  0xe67e22,
    purple:  0x9b59b6,
    magenta: 0xff00ff,
    cyan:    0x00d8ff,
    white:   0xffffff,
    black:   0x111111,
  }

  if (n in map) return map[n]

  if (n.startsWith("#")) {
    const parsed = Number.parseInt(n.slice(1), 16)
    if (Number.isFinite(parsed)) return parsed
  }

  return fallback
}

/**
 * Normaliza cualquier valor de color (número o string) a número hexadecimal.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 * Hecho e implementado por LFTS
 */
function normalizeColorValue(value, fallback = 0xff3b3b) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0
  if (typeof value === "string") return namedColorToHex(value, fallback)
  return fallback
}

/**
 * Mezcla dos colores hex con un factor t ∈ [0, 1].
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 * Hecho e implementado por LFTS
 */
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
  const rr = Math.round(ar + (br - ar) * t)
  const rg = Math.round(ag + (bg - ag) * t)
  const rb = Math.round(ab + (bb - ab) * t)
  return ((rr & 255) << 16) | ((rg & 255) << 8) | (rb & 255)
}

/**
 * Multiplica la luminosidad de un color hex por un factor.
 * @param {number} hex
 * @param {number} factor
 * @returns {number}
 * Hecho e implementado por LFTS
 */
function boostHex(hex, factor = 1.0) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * factor))
  const g = Math.min(255, Math.round(((hex >> 8)  & 255) * factor))
  const b = Math.min(255, Math.round((hex & 255)         * factor))
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}

/**
 * Limita el valor al intervalo [0, 1].
 * @param {number} v
 * @returns {number}
 * Hecho e implementado por LFTS
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

export class ElectricalSystem {
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem
    this.lastGraph = null
    this._signature = ""
    this._revision = 0
    this._blinkAccumMs = 0
    this._blinkOn = false
  }

  update(dt) {
    this._blinkAccumMs += dt * 1000
    if (this._blinkAccumMs >= 400) {
      this._blinkAccumMs %= 400
      this._blinkOn = !this._blinkOn
    }
    const netlist = buildCircuit(this.appState.components, this.holeSystem, this.stateSyncSystem)
    const signature = JSON.stringify([netlist.branches.map(b => [
      b.id, b.a, b.b, b.type, b.closed, b.resistance, b.voltage, b.currentLimit, b.vf, b.component.meta?.ratings,
    ]), netlist.invalidWires])
    if (signature !== this._signature) {
      this.lastGraph = solveCircuit(netlist)
      this.lastGraph.revision = ++this._revision
      this._signature = signature
    }
    for (const comp of this.appState.components) {
      if (comp.type !== "led") continue
      const r = this.lastGraph?.readings.get(comp.id)
      const current = r?.invalid ? 0 : Math.max(0, r?.currentA || 0)
      this._applyLEDState(comp.id, {
        mode: r?.noResistor ? "no_resistor" : current > 0.0008 ? "on" : "off",
        brightness: Math.pow(clamp01(current / 0.02), 0.7),
      })
    }
  }

  _applyLEDState(componentId, ledState) {
    const mesh = this.stateSyncSystem?.getMeshById(componentId)
    if (!mesh) return

    const state      = ledState?.mode ?? "off"
    const brightness = clamp01(ledState?.brightness ?? 0)

    // Color base del LED (puede haber sido editado por el EditPanel) — Hecho e implementado por LFTS
    const baseColor  = normalizeColorValue(
      mesh.userData?.meta?.color,
      mesh.userData?.baseLedColor ?? 0xff3b3b
    )

    const onColor      = boostHex(baseColor, 1.15)
    const onEmissive   = boostHex(baseColor, 0.95)
    const warnColor    = mixHex(baseColor, 0xffa000, 0.45)
    const warnEmissive = mixHex(baseColor, 0xff6600, 0.65)

    mesh.traverse((child) => {
      if (!child.isMesh) return
      if (child.name !== "LEDBody" && child.name !== "LEDDome") return

      const mat = child.material
      if (!mat || !("emissive" in mat)) return

      if (state === "on") {
        const colorT     = 0.20 + brightness * 0.80
        const visibleColor = mixHex(baseColor, onColor, colorT)

        mat.color.setHex(visibleColor)
        mat.emissive.setHex(onEmissive)
        mat.emissiveIntensity = 0.15 + brightness * 1.65
        mat.transparent = false
        mat.opacity     = 1.0

      } else if (state === "no_resistor") {
        // Parpadeo naranja — el diagnóstico marcará el error también — Hecho e implementado por LFTS
        if (this._blinkOn) {
          mat.color.setHex(warnColor)
          mat.emissive.setHex(warnEmissive)
          mat.emissiveIntensity = 1.4
        } else {
          mat.color.setHex(baseColor)
          mat.emissive.setHex(0x000000)
          mat.emissiveIntensity = 0
        }
        mat.transparent = false
        mat.opacity     = 1.0

      } else {
        // Apagado — Hecho e implementado por LFTS
        mat.color.setHex(baseColor)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
        mat.transparent = false
        mat.opacity     = 1.0
      }
      if (mesh.userData.diagnosticError) {
        mat.emissive.setHex(0xff1a00)
        mat.emissiveIntensity = 1.2
      }
    })
  }
}