/**
 * ElectricalSystem.js
 *
 * Simulación eléctrica para VR-CIRCUIT
 * - Detecta continuidad del circuito
 * - Detecta ausencia de resistencia
 * - Usa el valor real de la resistencia para variar la intensidad del LED
 * - Funciona tanto para una sola resistencia de alto valor
 *   como para varias resistencias en serie
 */

function namedColorToHex(name, fallback = 0xff3b3b) {
  if (typeof name !== "string") return fallback
  const n = name.trim().toLowerCase()

  const map = {
    red: 0xff3b3b,
    green: 0x2ecc71,
    blue: 0x3498db,
    yellow: 0xf1c40f,
    orange: 0xe67e22,
    purple: 0x9b59b6,
    magenta: 0xff00ff,
    cyan: 0x00d8ff,
    white: 0xffffff,
    black: 0x111111,
  }

  if (n in map) return map[n]

  if (n.startsWith("#")) {
    const parsed = Number.parseInt(n.slice(1), 16)
    if (Number.isFinite(parsed)) return parsed
  }

  return fallback
}

function normalizeColorValue(value, fallback = 0xff3b3b) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0
  if (typeof value === "string") return namedColorToHex(value, fallback)
  return fallback
}

function mixHex(a, b, t) {
  const ar = (a >> 16) & 255
  const ag = (a >> 8) & 255
  const ab = a & 255

  const br = (b >> 16) & 255
  const bg = (b >> 8) & 255
  const bb = b & 255

  const rr = Math.round(ar + (br - ar) * t)
  const rg = Math.round(ag + (bg - ag) * t)
  const rb = Math.round(ab + (bb - ab) * t)

  return ((rr & 255) << 16) | ((rg & 255) << 8) | (rb & 255)
}

function boostHex(hex, factor = 1.0) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * factor))
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * factor))
  const b = Math.min(255, Math.round((hex & 255) * factor))
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function hexToRgb01(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  }
}

// Aproximación práctica de Vf según color del LED
function estimateLedForwardVoltage(hexColor) {
  const { r, g, b } = hexToRgb01(hexColor)

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  if (max > 0.92 && min > 0.82) return 3.1
  if (b > 0.75 && b >= g && b >= r) return 3.0
  if (b > 0.65 && g > 0.65 && r < 0.35) return 3.0
  if (r > 0.55 && b > 0.55 && g < 0.45) return 2.9
  if (g > r && g > b) return 2.1
  if (r > 0.75 && g > 0.45 && b < 0.25) return 2.1

  return 2.0
}

export class ElectricalSystem {
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem

    this._blinkIntervalMs = 400
    this._blinkAccumMs = 0
    this._blinkOn = false
  }

  update(dt) {
    this._blinkAccumMs += dt * 1000
    if (this._blinkAccumMs >= this._blinkIntervalMs) {
      this._blinkAccumMs -= this._blinkIntervalMs
      this._blinkOn = !this._blinkOn
    }

    const graph = this._buildGraph()
    this._simulate(graph)
  }

  _buildGraph() {
    const edges = new Map()
    const edgeResistance = new Map()
    const batteries = []
    const leds = []

    const addEdge = (a, b, resistance = 0) => {
      if (!a || !b || a === b) return

      if (!edges.has(a)) edges.set(a, new Set())
      if (!edges.has(b)) edges.set(b, new Set())

      edges.get(a).add(b)
      edges.get(b).add(a)

      const key = edgeKey(a, b)
      const prev = edgeResistance.get(key)

      if (prev == null || resistance < prev) {
        edgeResistance.set(key, resistance)
      }
    }

    const holeGroupMap = new Map()
    if (this.holeSystem) {
      for (const hole of this.holeSystem.holes) {
        holeGroupMap.set(hole.id, hole.groupKey)
      }
    }

    const pinToNode = (comp, pinId) => {
      if (comp?.inserted && comp?.pinConnections) {
        const holeId = comp.pinConnections[pinId]
        if (holeId) {
          const gk = holeGroupMap.get(holeId)
          return gk ? `group:${gk}` : `hole:${holeId}`
        }
      }
      return `pin:${comp.id}:${pinId}`
    }

    const anchorToNode = (anchor) => {
      if (!anchor) return null

      if (anchor.kind === "hole" && anchor.holeId) {
        const gk = holeGroupMap.get(anchor.holeId)
        return gk ? `group:${gk}` : `hole:${anchor.holeId}`
      }

      if (anchor.kind === "terminal" && anchor.componentId) {
        return `terminal:${anchor.componentId}:${anchor.id}`
      }

      if (anchor.kind === "pin" && anchor.componentId) {
        const comp = this.appState.components.find((c) => c.id === anchor.componentId)
        if (comp?.inserted && comp?.pinConnections) {
          const holeId = comp.pinConnections[anchor.id]
          if (holeId) {
            const gk = holeGroupMap.get(holeId)
            if (gk) return `group:${gk}`
          }
        }
        return `pin:${anchor.componentId}:${anchor.id}`
      }

      return null
    }

    for (const comp of this.appState.components) {
      if (comp.type === "battery5v") {
        const posNode = `terminal:${comp.id}:positive`
        const negNode = `terminal:${comp.id}:negative`
        const voltage = Math.max(0, Number(comp.meta?.voltage) || 5)

        batteries.push({
          posNode,
          negNode,
          componentId: comp.id,
          voltage,
        })

        if (!edges.has(posNode)) edges.set(posNode, new Set())
        if (!edges.has(negNode)) edges.set(negNode, new Set())
      }

      if (comp.type === "led" && comp.inserted && comp.pinConnections) {
        const anodeNode = pinToNode(comp, "anode")
        const cathodeNode = pinToNode(comp, "cathode")

        if (anodeNode && cathodeNode) {
          leds.push({
            anodeNode,
            cathodeNode,
            componentId: comp.id,
            color: normalizeColorValue(comp.meta?.color, 0xff3b3b),
          })
        }
      }

      if (comp.type === "resistor" && comp.inserted && comp.pinConnections) {
        const leftNode = pinToNode(comp, "left")
        const rightNode = pinToNode(comp, "right")
        const resistance = Math.max(1, Math.round(Number(comp.meta?.resistance) || 220))

        if (leftNode && rightNode) {
          addEdge(leftNode, rightNode, resistance)
        }
      }

      if (comp.type === "button" && comp.inserted && comp.pinConnections) {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const isPressed = mesh?.userData?.buttonState === true

        if (isPressed) {
          const nA = pinToNode(comp, "pin_a")
          const nB = pinToNode(comp, "pin_b")
          if (nA && nB) addEdge(nA, nB, 0)
        }
      }

      if (comp.type === "switch" && comp.inserted && comp.pinConnections) {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const isClosed = mesh?.userData?.switchState === true

        if (isClosed) {
          const nA = pinToNode(comp, "pin_a")
          const nB = pinToNode(comp, "pin_b")
          if (nA && nB) addEdge(nA, nB, 0)
        }
      }

      if (comp.type === "wire" && comp.meta?.startAnchor && comp.meta?.endAnchor) {
        const sn = anchorToNode(comp.meta.startAnchor)
        const en = anchorToNode(comp.meta.endAnchor)
        if (sn && en) addEdge(sn, en, 0)
      }
    }

    return { edges, edgeResistance, batteries, leds }
  }

  _simulate(graph) {
    for (const led of graph.leds) {
      const ledState = this._evaluateLED(led, graph)
      this._applyLEDState(led.componentId, ledState)
    }
  }

  _evaluateLED(led, graph) {
    const { edges, edgeResistance, batteries } = graph

    for (const battery of batteries) {
      const toAnode = this._findLeastResistancePath(
        battery.posNode,
        led.anodeNode,
        new Set([led.cathodeNode, battery.negNode]),
        edges,
        edgeResistance
      )
      if (!toAnode.reached) continue

      const toCathode = this._findLeastResistancePath(
        led.cathodeNode,
        battery.negNode,
        new Set([led.anodeNode, battery.posNode]),
        edges,
        edgeResistance
      )
      if (!toCathode.reached) continue

      const totalResistance = toAnode.totalResistance + toCathode.totalResistance

      if (totalResistance <= 0) {
        return { mode: "no_resistor", brightness: 0, currentA: 0 }
      }

      const vf = estimateLedForwardVoltage(led.color)
      const availableVoltage = Math.max(0, battery.voltage - vf)
      const currentA = availableVoltage / totalResistance

      if (currentA <= 0.0008) {
        return { mode: "off", brightness: 0, currentA }
      }

      const normalizedCurrent = clamp01(currentA / 0.02)
      const brightness = Math.pow(normalizedCurrent, 0.7)

      return {
        mode: "on",
        brightness,
        currentA,
      }
    }

    return { mode: "off", brightness: 0, currentA: 0 }
  }

  _findLeastResistancePath(startNode, targetNode, blockedNodes, edges, edgeResistance) {
    if (startNode === targetNode) {
      return { reached: true, totalResistance: 0 }
    }

    if (blockedNodes.has(startNode)) {
      return { reached: false, totalResistance: Infinity }
    }

    const dist = new Map()
    const visited = new Set()
    const queue = []

    dist.set(startNode, 0)
    queue.push({ node: startNode, totalResistance: 0 })

    while (queue.length > 0) {
      queue.sort((a, b) => a.totalResistance - b.totalResistance)
      const current = queue.shift()

      if (!current) break
      if (visited.has(current.node)) continue

      visited.add(current.node)

      if (current.node === targetNode) {
        return { reached: true, totalResistance: current.totalResistance }
      }

      const neighbors = edges.get(current.node)
      if (!neighbors) continue

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue
        if (blockedNodes.has(neighbor) && neighbor !== targetNode) continue

        const key = edgeKey(current.node, neighbor)
        const resistance = edgeResistance.get(key) ?? 0
        const nextTotal = current.totalResistance + resistance
        const prev = dist.get(neighbor)

        if (prev == null || nextTotal < prev) {
          dist.set(neighbor, nextTotal)
          queue.push({
            node: neighbor,
            totalResistance: nextTotal,
          })
        }
      }
    }

    return { reached: false, totalResistance: Infinity }
  }

  _applyLEDState(componentId, ledState) {
    const mesh = this.stateSyncSystem?.getMeshById(componentId)
    if (!mesh) return

    const state = ledState?.mode ?? "off"
    const brightness = clamp01(ledState?.brightness ?? 0)

    const baseColor = normalizeColorValue(
      mesh.userData?.meta?.color,
      mesh.userData?.baseLedColor ?? 0xff3b3b
    )

    const onColor = boostHex(baseColor, 1.15)
    const onEmissive = boostHex(baseColor, 0.95)
    const warningColor = mixHex(baseColor, 0xffa000, 0.45)
    const warningEmissive = mixHex(baseColor, 0xff6600, 0.65)

    mesh.traverse((child) => {
      if (!child.isMesh) return
      if (child.name !== "LEDBody" && child.name !== "LEDDome") return

      const mat = child.material
      if (!mat || !("emissive" in mat)) return

      if (state === "on") {
        const colorT = 0.20 + brightness * 0.80
        const visibleColor = mixHex(baseColor, onColor, colorT)

        mat.color.setHex(visibleColor)
        mat.emissive.setHex(onEmissive)
        mat.emissiveIntensity = 0.15 + brightness * 1.65
        mat.transparent = false
        mat.opacity = 1.0
      } else if (state === "no_resistor") {
        if (this._blinkOn) {
          mat.color.setHex(warningColor)
          mat.emissive.setHex(warningEmissive)
          mat.emissiveIntensity = 1.4
        } else {
          mat.color.setHex(baseColor)
          mat.emissive.setHex(0x000000)
          mat.emissiveIntensity = 0
        }
        mat.transparent = false
        mat.opacity = 1.0
      } else {
        mat.color.setHex(baseColor)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
        mat.transparent = false
        mat.opacity = 1.0
      }
    })
  }
}