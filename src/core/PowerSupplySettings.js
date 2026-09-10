// Hecho e implementado por LFTS
// Ajustes de la fuente y perfiles didácticos; no representan fichas técnicas. Hecho e implementado por LFTS
export const SUPPLY_FIELDS = Object.freeze({
  voltage: { label: "Voltaje", unit: "V", max: 30, step: 0.1, digits: 1, initial: 5 },
  currentLimit: { label: "Alerta de corriente", unit: "A", max: 5, step: 0.01, digits: 2, initial: 0.02 },
})

export const DIDACTIC_RATINGS = Object.freeze({
  led: { maxCurrentA: 0.02, maxReverseVoltage: 5 },
  resistor: { maxPowerW: 0.25 },
  button: { maxCurrentA: 0.05, maxVoltage: 12 },
  switch: { maxCurrentA: 5, maxVoltage: 30 },
  wire: { maxCurrentA: 5 },
})

export function normalizeSupplyValue(field, value) {
  const spec = SUPPLY_FIELDS[field]
  if (!spec) throw new Error("Ajuste de fuente desconocido")
  const numeric = value === null || value === "" ? NaN : Number(value)
  const bounded = Math.max(0, Math.min(spec.max, Number.isFinite(numeric) ? numeric : spec.initial))
  return Number((Math.round(bounded / spec.step) * spec.step).toFixed(spec.digits))
}

export function supplySettings(meta = {}) {
  return {
    voltage: normalizeSupplyValue("voltage", meta.voltage),
    currentLimit: normalizeSupplyValue("currentLimit", meta.currentLimit),
  }
}

export function parseSupplyInput(field, text) {
  const raw = String(text).trim().replace(",", ".")
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
    return { error: "Escribe un número válido" }
  }
  const value = Number(raw)
  const spec = SUPPLY_FIELDS[field]
  if (!Number.isFinite(value) || value < 0 || value > spec.max) {
    return { error: `Rango permitido: 0 a ${spec.max} ${spec.unit}` }
  }
  const normalized = normalizeSupplyValue(field, value)
  if (Math.abs(value - normalized) > 1e-8) {
    return { error: `Usa pasos de ${spec.step} ${spec.unit}` }
  }
  return { value: normalized }
}

export function componentRatings(component) {
  const defaults = DIDACTIC_RATINGS[component.type] || {}
  const overrides = component.meta?.ratings || {}
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const n = Number(overrides[key])
    return [key, Number.isFinite(n) && n > 0 ? n : fallback]
  }))
}

