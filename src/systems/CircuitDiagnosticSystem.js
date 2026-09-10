//CircuitDiagnosticSystem.js
// Hecho e implementado por LFTS
import { componentRatings } from "../core/PowerSupplySettings.js"

// Diagnóstico compartido con el solucionador; no altera ni destruye los componentes. Hecho e implementado por LFTS
export class CircuitDiagnosticSystem {
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem
    this._lastAnalyzeMs = -Infinity
    this._lastRevision = -1
    this._lastResult = { alerts: [], hasErrors: false, mode: "edit" }
    this._errorIds = new Set()
    this._originalMaterials = new Map()
  }

  setHoleSystem(holeSystem) { this.holeSystem = holeSystem }

  label(component) {
    const names = { powerSupply: "Fuente", battery5v: "Batería", led: "LED", resistor: "Resistencia",
      button: "Botón", switch: "Switch", wire: "Cable" }
    const same = this.appState.components.filter(c => c.type === component.type)
    return (names[component.type] || component.type) + " " + (same.findIndex(c => c.id === component.id) + 1)
  }

  analyze(graph, appMode) {
    if (appMode !== "sim") {
      this.clearAll()
      return this._lastResult
    }
    const now = performance.now()
    if (this._lastResult.mode === "sim" && graph?.revision === this._lastRevision && now - this._lastAnalyzeMs < 200) {
      this.applyHighlights()
      return this._lastResult
    }
    this._lastAnalyzeMs = now
    this._lastRevision = graph?.revision
    const alerts = [], errorIds = new Set()
    const add = (message, ids = []) => {
      alerts.push(message)
      for (const id of ids) errorIds.add(id)
    }
    if (!graph) add("⚠ Sin datos de circuito")
    else {
      if (!graph.sources.length && graph.branches.length) add("⚠ No hay fuente de alimentación")
      for (const fault of graph.faults) add("🔴 " + fault.message, fault.ids)
      for (const b of graph.branches) {
        const r = graph.readings.get(b.id)
        if (!r || r.invalid) continue
        const label = this.label(b.component)
        if (b.source) {
          if (b.currentLimit !== null && Math.abs(r.currentA) > b.currentLimit + 1e-7) {
            add(`🔴 ${label}: circuito incorrecto; ${Math.abs(r.currentA).toFixed(3)} A supera el máximo ${b.currentLimit.toFixed(2)} A`, [b.id])
          }
          if (r.currentA < -1e-7) add(`🔴 ${label}: recibe corriente de otra fuente`, [b.id])
          continue
        }
        const limits = componentRatings(b.component)
        if (limits.maxCurrentA && Math.abs(r.currentA) > limits.maxCurrentA + 1e-7) {
          add(`🔴 ${label}: sobrecorriente ${Math.abs(r.currentA).toFixed(3)} A > ${limits.maxCurrentA} A; riesgo de daño`, [b.id])
        }
        if (limits.maxPowerW && r.powerW > limits.maxPowerW + 1e-7) {
          add(`🔴 ${label}: sobrepotencia ${r.powerW.toFixed(3)} W > ${limits.maxPowerW} W; riesgo de daño`, [b.id])
        }
        if (limits.maxVoltage && Math.abs(r.voltage) > limits.maxVoltage + 1e-7) {
          add(`🔴 ${label}: sobretensión ${Math.abs(r.voltage).toFixed(2)} V > ${limits.maxVoltage} V`, [b.id])
        }
        if (b.type === "led") {
          if (r.voltage < -0.1) add(`🔴 ${label}: polaridad invertida (${Math.abs(r.voltage).toFixed(2)} V inversos)`, [b.id])
          if (-r.voltage > limits.maxReverseVoltage + 1e-7) {
            add(`🔴 ${label}: tensión inversa supera ${limits.maxReverseVoltage} V; riesgo de daño`, [b.id])
          }
          if (r.noResistor) add(`⚠ ${label}: falta resistencia limitadora`, [b.id])
          if (r.closedLoop && r.powered && r.voltage >= -0.1 && r.currentA === 0) {
            add(`⚠ ${label}: voltaje insuficiente para encender (${Math.max(0, r.voltage).toFixed(2)} V)`, [b.id])
          }
        }
        const used = b.component.inserted || b.type === "wire"
          || graph.branches.some(other => other.id !== b.id && [other.a, other.b].some(n => n === b.a || n === b.b))
        if (used && !r.closedLoop && b.closed && b.type !== "wire") {
          add(`⚠ ${label}: circuito abierto o componente desconectado`, [b.id])
        }
      }
    }
    this.restoreHighlights()
    this._errorIds = errorIds
    this.applyHighlights()
    this._lastResult = { alerts: [...new Set(alerts)], hasErrors: alerts.length > 0, mode: "sim" }
    return this._lastResult
  }

  applyHighlights() {
    for (const id of this._errorIds) {
      const root = this.stateSyncSystem.getMeshById(id)
      if (!root) continue
      root.userData.diagnosticError = true
      root.traverse(child => {
        if (!child.isMesh) return
        // El sistema eléctrico controla el color del LED cada fotograma. Hecho e implementado por LFTS
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          if (!material?.emissive) continue
          if (!this._originalMaterials.has(material)) {
            this._originalMaterials.set(material, [material.emissive.getHex(), material.emissiveIntensity])
          }
          material.emissive.setHex(0xff1a00)
          material.emissiveIntensity = 1.2
        }
      })
    }
  }

  restoreHighlights() {
    for (const [material, [color, intensity]] of this._originalMaterials) {
      material.emissive.setHex(color)
      material.emissiveIntensity = intensity
    }
    this._originalMaterials.clear()
    for (const id of this._errorIds) {
      const root = this.stateSyncSystem.getMeshById(id)
      if (root) root.userData.diagnosticError = false
    }
    this._errorIds.clear()
  }

  clearAll() {
    this.restoreHighlights()
    this._lastAnalyzeMs = -Infinity
    this._lastRevision = -1
    this._lastResult = { alerts: [], hasErrors: false, mode: "edit" }
  }
}

