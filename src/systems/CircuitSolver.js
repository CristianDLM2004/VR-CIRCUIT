// Hecho e implementado por LFTS
import { supplySettings } from "../core/PowerSupplySettings.js"

// Modelo DC didáctico: LED por tramos y conductores de 1 mΩ para medir cada rama. Hecho e implementado por LFTS
const CONTACT_R = 0.001
const OFF_G = 1e-10
const CURRENT_EPS = 1e-7

function forwardVoltage(color) {
  const names = { red: 0xff3b3b, green: 0x2ecc71, blue: 0x3498db, white: 0xffffff,
    yellow: 0xf1c40f, orange: 0xe67e22, purple: 0x9b59b6, magenta: 0xff00ff, cyan: 0x00d8ff }
  const hex = typeof color === "number" ? color : names[color] ?? Number.parseInt(String(color).replace("#", ""), 16)
  const safe = Number.isFinite(hex) ? hex : 0xff3b3b
  const r = ((safe >> 16) & 255) / 255, g = ((safe >> 8) & 255) / 255, b = (safe & 255) / 255
  if (Math.min(r, g, b) > 0.82 && Math.max(r, g, b) > 0.92) return 3.1
  if (b > 0.75 && b >= g && b >= r) return 3
  if (b > 0.65 && g > 0.65 && r < 0.35) return 3
  if (r > 0.55 && b > 0.55 && g < 0.45) return 2.9
  if (g > r && g > b) return 2.1
  if (r > 0.75 && g > 0.45 && b < 0.25) return 2.1
  return 2
}

export function buildCircuit(components, holeSystem, stateSyncSystem) {
  const byId = new Map(components.map(c => [c.id, c]))
  const groups = new Map((holeSystem?.holes || []).map(h => [h.id, h.groupKey]))
  const holeNode = id => groups.get(id) ? `group:${groups.get(id)}` : `hole:${id}`
  const pinNode = (c, id) => c.inserted && c.pinConnections?.[id]
    ? holeNode(c.pinConnections[id]) : `pin:${c.id}:${id}`
  const anchorNode = a => {
    if (a?.kind === "hole" && a.holeId && groups.has(a.holeId)) return holeNode(a.holeId)
    const c = byId.get(a?.componentId)
    if (!c) return null
    if (a.kind === "terminal" && ["battery5v", "powerSupply"].includes(c.type)
      && ["positive", "negative"].includes(a.id)) return `terminal:${c.id}:${a.id}`
    const pins = { led: ["anode", "cathode"], resistor: ["left", "right"], button: ["pin_a", "pin_b"], switch: ["pin_a", "pin_b"] }
    if (a.kind === "pin" && pins[c.type]?.includes(a.id)) return pinNode(c, a.id)
    return null
  }
  const branches = []
  const invalidWires = []
  for (const c of components) {
    const mesh = stateSyncSystem?.getMeshById(c.id)
    const b = { id: c.id, type: c.type, component: c, closed: true }
    if (c.type === "battery5v" || c.type === "powerSupply") {
      b.a = `terminal:${c.id}:positive`
      b.b = `terminal:${c.id}:negative`
      const raw = Number(c.meta?.voltage)
      b.voltage = c.type === "powerSupply" ? supplySettings(c.meta).voltage
        : Math.max(0, Number.isFinite(raw) ? raw : 5)
      b.currentLimit = c.type === "powerSupply" ? supplySettings(c.meta).currentLimit : null
      b.source = true
    } else if (c.type === "wire") {
      b.a = anchorNode(c.meta?.startAnchor)
      b.b = anchorNode(c.meta?.endAnchor)
      b.resistance = CONTACT_R
      b.conductor = true
      if (!b.a || !b.b) { invalidWires.push(c.id); continue }
    } else if (["led", "resistor", "button", "switch"].includes(c.type)) {
      const ids = c.type === "led" ? ["anode", "cathode"] : c.type === "resistor" ? ["left", "right"] : ["pin_a", "pin_b"]
      b.a = pinNode(c, ids[0]); b.b = pinNode(c, ids[1])
      if (c.type === "led") {
        b.vf = forwardVoltage(c.meta?.color)
      } else if (c.type === "resistor") {
        const r = Number(c.meta?.resistance)
        b.resistance = Math.max(1, Number.isFinite(r) ? r : 220)
      } else {
        b.closed = c.type === "button" ? mesh?.userData?.buttonState === true
          : (mesh?.userData?.switchState ?? c.meta?.switchState) === true
        b.resistance = CONTACT_R
        b.conductor = true
      }
    } else continue
    branches.push(b)
  }
  return { branches, invalidWires }
}

function adjacency(branches) {
  const map = new Map()
  for (const b of branches) {
    if (!map.has(b.a)) map.set(b.a, [])
    if (!map.has(b.b)) map.set(b.b, [])
    map.get(b.a).push({ node: b.b, branch: b })
    map.get(b.b).push({ node: b.a, branch: b })
  }
  return map
}

function reachable(map, start) {
  const seen = new Set([start]), queue = [start]
  for (let i = 0; i < queue.length; i++) {
    for (const { node } of map.get(queue[i]) || []) {
      if (!seen.has(node)) { seen.add(node); queue.push(node) }
    }
  }
  return seen
}

// Eliminación gaussiana con pivoteo parcial; una matriz singular no produce lecturas ficticias. Hecho e implementado por LFTS
function linearSolve(matrix, rhs) {
  const n = rhs.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row
    if (Math.abs(matrix[pivot][col]) < 1e-14) return null
    ;[matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]]
    ;[rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]]
    for (let row = col + 1; row < n; row++) {
      const f = matrix[row][col] / matrix[col][col]
      if (!f) continue
      for (let k = col; k < n; k++) matrix[row][k] -= f * matrix[col][k]
      rhs[row] -= f * rhs[col]
    }
  }
  const x = new Float64Array(n)
  for (let row = n - 1; row >= 0; row--) {
    let v = rhs[row]
    for (let k = row + 1; k < n; k++) v -= matrix[row][k] * x[k]
    x[row] = v / matrix[row][row]
    if (!Number.isFinite(x[row])) return null
  }
  return x
}

function solveIsland(branches, nodes) {
  const sources = branches.filter(b => b.source)
  if (!sources.length) return { voltages: new Map([...nodes].map(n => [n, 0])), currents: new Map() }
  const ground = sources[0].b
  const ids = [...nodes].filter(n => n !== ground)
  const index = new Map(ids.map((n, i) => [n, i]))
  const leds = branches.filter(b => b.type === "led")
  const active = new Set()
  let solution
  for (let iteration = 0; iteration < 100; iteration++) {
    const size = ids.length + sources.length
    const m = Array.from({ length: size }, () => new Float64Array(size))
    const rhs = new Float64Array(size)
    const stampG = (a, b, g, offset = 0) => {
      const i = index.get(a), j = index.get(b)
      if (i !== undefined) { m[i][i] += g; rhs[i] += g * offset }
      if (j !== undefined) { m[j][j] += g; rhs[j] -= g * offset }
      if (i !== undefined && j !== undefined) { m[i][j] -= g; m[j][i] -= g }
    }
    // Fuga numérica mínima para nodos aislados por interruptores abiertos. Hecho e implementado por LFTS
    for (let i = 0; i < ids.length; i++) m[i][i] += 1e-12
    for (const b of branches) {
      if (b.source) continue
      if (!b.closed) { stampG(b.a, b.b, OFF_G); continue }
      if (b.type === "led") stampG(b.a, b.b, active.has(b.id) ? 1 : OFF_G, active.has(b.id) ? b.vf : 0)
      else stampG(b.a, b.b, 1 / b.resistance)
    }
    sources.forEach((s, k) => {
      const row = ids.length + k
      const a = index.get(s.a), b = index.get(s.b)
      if (a !== undefined) { m[a][row] += 1; m[row][a] += 1 }
      if (b !== undefined) { m[b][row] -= 1; m[row][b] -= 1 }
      rhs[row] = s.voltage
    })
    solution = linearSolve(m, rhs)
    if (!solution) return { error: "Fuentes incompatibles o corriente indeterminada entre fuentes ideales" }
    const voltage = n => n === ground ? 0 : solution[index.get(n)]
    let changed = false
    for (const led of leds) {
      const delta = voltage(led.a) - voltage(led.b) - led.vf
      if (!active.has(led.id) && delta > 1e-7) { active.add(led.id); changed = true }
      else if (active.has(led.id) && delta < -1e-7) { active.delete(led.id); changed = true }
    }
    if (changed) continue
    const voltages = new Map([...nodes].map(n => [n, voltage(n)]))
    const currents = new Map()
    sources.forEach((s, k) => currents.set(s.id, -solution[ids.length + k]))
    for (const b of branches) {
      if (b.source) continue
      const v = voltage(b.a) - voltage(b.b)
      const i = !b.closed ? 0 : b.type === "led"
        ? (active.has(b.id) ? Math.max(0, v - b.vf) : 0) : v / b.resistance
      currents.set(b.id, Math.abs(i) < CURRENT_EPS ? 0 : i)
    }
    return { voltages, currents }
  }
  return { error: "El cálculo no convergió; revisa las conexiones" }
}

export function solveCircuit(netlist) {
  const { branches, invalidWires = [] } = netlist
  const readings = new Map()
  const faults = invalidWires.map(id => ({ ids: [id], message: "Cable con extremo desconectado o eliminado" }))
  const network = adjacency(branches)
  const seen = new Set()
  for (const start of network.keys()) {
    if (seen.has(start)) continue
    const nodes = reachable(network, start)
    for (const n of nodes) seen.add(n)
    const island = branches.filter(b => nodes.has(b.a))
    const sources = island.filter(b => b.source)
    const conductive = adjacency(island.filter(b => b.conductor && b.closed))
    const shorted = sources.filter(s => s.voltage > 0 && reachable(conductive, s.a).has(s.b))
    let result
    if (shorted.length) result = { error: "Cortocircuito: (+) conectado a (-) sin carga; corriente no calculable" }
    else result = solveIsland(island, nodes)
    if (result.error) {
      faults.push({ ids: island.map(b => b.id), message: result.error })
      for (const b of island) readings.set(b.id, { voltage: null, currentA: null, powerW: null, invalid: true })
      continue
    }
    for (const b of island) {
      const voltage = result.voltages.get(b.a) - result.voltages.get(b.b)
      const currentA = result.currents.get(b.id) ?? 0
      // Buscar retorno sin el propio componente distingue un ramal abierto de una carga completa. Hecho e implementado por LFTS
      const remaining = adjacency(island.filter(x => x.id !== b.id && x.closed))
      const returnNodes = reachable(remaining, b.a)
      const closedLoop = returnNodes.has(b.b)
      const powered = sources.some(s => s.voltage > 0 && returnNodes.has(s.a) && returnNodes.has(s.b))
      const noResistor = b.type === "led" && currentA > CURRENT_EPS && reachable(
        adjacency(island.filter(x => x.id !== b.id && x.closed && x.type !== "resistor")), b.a
      ).has(b.b)
      readings.set(b.id, {
        voltage, currentA: Math.abs(currentA) < CURRENT_EPS ? 0 : currentA,
        powerW: Math.abs(voltage * currentA), closedLoop, powered, noResistor, invalid: false,
      })
    }
  }
  return { branches, readings, faults, sources: branches.filter(b => b.source), revision: 0 }
}

