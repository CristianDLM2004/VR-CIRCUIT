//MultimeterMeasurement.js
// Hecho e implementado por LFTS
import { buildCircuit, solveCircuit } from "./CircuitSolver.js"

// Resistencia equivalente de una red pasiva; nunca medir ohmios con alimentación conectada. Hecho e implementado por LFTS
export function measureMultimeter(meter, components, holes, sync, graph) {
  const mode = meter.meta?.mode || "V"
  const net = buildCircuit(components, holes, sync)
  const probes = components.filter(c => c.type === "meterProbe" && c.meta?.meterId === meter.id)
  const a = net.anchorNode(probes.find(p => p.meta.polarity === "red")?.meta?.anchor)
  const b = net.anchorNode(probes.find(p => p.meta.polarity === "black")?.meta?.anchor)
  if (!a || !b) return { value: "—", message: "Conecta las dos puntas" }
  if (mode === "V" || mode === "A") {
    const reading = graph?.readings.get(meter.id)
    if (reading?.invalid) return { value: "ERROR", message: mode === "A" ? "A en serie: revisa el circuito" : "Revisa las fuentes" }
    if (!reading) return { value: "—", message: "Esperando cálculo" }
    const n = mode === "V" ? reading.voltage : reading.currentA
    if (!Number.isFinite(n)) return { value: "—", message: "Sin lectura válida" }
    if (mode === "A" && Math.abs(n) > 5) return { value: "OL", message: "Corriente mayor de 5 A" }
    return { value: n.toFixed(mode === "V" ? 3 : 4) + " " + mode,
      message: mode === "V" ? "Voltaje DC · en paralelo" : "Corriente DC · en serie" }
  }
  const neighbors = new Map()
  for (const branch of net.branches.filter(x => x.closed)) {
    for (const [u, v] of [[branch.a, branch.b], [branch.b, branch.a]]) {
      if (!neighbors.has(u)) neighbors.set(u, [])
      neighbors.get(u).push(v)
    }
  }
  const seen = new Set([a, b]), queue = [a, b]
  for (let i = 0; i < queue.length; i++) for (const node of neighbors.get(queue[i]) || []) {
    if (!seen.has(node)) { seen.add(node); queue.push(node) }
  }
  const connected = net.branches.filter(x => seen.has(x.a) || seen.has(x.b))
  if (connected.some(x => x.source)) return { value: "ERROR", message: "Desconecta la alimentación" }
  if (connected.some(x => x.type === "led")) return { value: "—", message: "Red con LED: usa voltaje" }
  if (a === b) return { value: mode === "CONT" ? "SÍ" : "0.00 Ω", message: "Mismo nodo eléctrico", beep: mode === "CONT" }
  const source = { id: "__ohmmeter__", a, b, source: true, closed: true, voltage: 1, type: "test", component: {} }
  const passive = connected.filter(x => x.closed && x.a !== x.b).map(x => ({ ...x, conductor: false }))
  const result = solveCircuit({ branches: [...passive, source] })
  const current = result.readings.get(source.id)?.currentA
  const resistance = current > 1e-9 ? Math.round((1 / current) * 100) / 100 : Infinity
  if (!Number.isFinite(resistance)) return { value: "OL", message: "Circuito abierto" }
  const beep = mode === "CONT" && resistance <= 50
  return { value: mode === "CONT" ? (beep ? "SÍ" : "NO") : (resistance >= 1000 ? (resistance / 1000).toFixed(3) + " kΩ" : resistance.toFixed(2) + " Ω"),
    message: mode === "CONT" ? "Continuidad: hasta 50 Ω" : "Resistencia equivalente", beep }
}
