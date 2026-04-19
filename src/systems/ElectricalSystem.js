/**
 * ElectricalSystem.js
 *
 * Simulación eléctrica de nivel medio para VR-CIRCUIT.
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

export class ElectricalSystem {
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem

    this._blinkIntervalMs = 400
    this._blinkAccumMs = 0
    this._blinkOn = false

    this._lastCircuitSignature = ""
    this._lastGraph = null
    this._lastLedStates = new Map()
  }

  update(dt) {
    const prevBlink = this._blinkOn

    this._blinkAccumMs += dt * 1000
    if (this._blinkAccumMs >= this._blinkIntervalMs) {
      this._blinkAccumMs -= this._blinkIntervalMs
      this._blinkOn = !this._blinkOn
    }

    const nextSignature = this._buildCircuitSignature()
    const blinkChanged = prevBlink !== this._blinkOn
    const circuitChanged =
      !this._lastGraph ||
      nextSignature !== this._lastCircuitSignature

    if (circuitChanged) {
      this._lastCircuitSignature = nextSignature
      this._lastGraph = this._buildGraph()
      this._lastLedStates = this._evaluateAllLeds(this._lastGraph)
      this._applyAllLedStates(this._lastLedStates)
      return
    }

    if (blinkChanged) {
      this._applyAllLedStates(this._lastLedStates)
    }
  }

  _buildCircuitSignature() {
    const parts = []

    for (const comp of this.appState.components) {
      if (comp.type === "battery5v") {
        parts.push(`battery:${comp.id}`)
        continue
      }

      if (comp.type === "led") {
        parts.push(
          [
            "led",
            comp.id,
            comp.inserted ? 1 : 0,
            comp.pinConnections?.anode ?? "-",
            comp.pinConnections?.cathode ?? "-",
            comp.meta?.color ?? "-"
          ].join(":")
        )
        continue
      }

      if (comp.type === "resistor") {
        parts.push(
          [
            "resistor",
            comp.id,
            comp.inserted ? 1 : 0,
            comp.pinConnections?.left ?? "-",
            comp.pinConnections?.right ?? "-",
            comp.meta?.resistance ?? "-"
          ].join(":")
        )
        continue
      }

      if (comp.type === "button") {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const pressed = mesh?.userData?.buttonState === true ? 1 : 0

        parts.push(
          [
            "button",
            comp.id,
            comp.inserted ? 1 : 0,
            comp.pinConnections?.pin_a ?? "-",
            comp.pinConnections?.pin_b ?? "-",
            pressed
          ].join(":")
        )
        continue
      }

      if (comp.type === "switch") {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const closed = mesh?.userData?.switchState === true ? 1 : 0

        parts.push(
          [
            "switch",
            comp.id,
            comp.inserted ? 1 : 0,
            comp.pinConnections?.pin_a ?? "-",
            comp.pinConnections?.pin_b ?? "-",
            closed
          ].join(":")
        )
        continue
      }

      if (comp.type === "wire") {
        parts.push(
          [
            "wire",
            comp.id,
            comp.meta?.startAnchor?.kind ?? "-",
            comp.meta?.startAnchor?.componentId ?? "-",
            comp.meta?.startAnchor?.id ?? "-",
            comp.meta?.startAnchor?.holeId ?? "-",
            comp.meta?.endAnchor?.kind ?? "-",
            comp.meta?.endAnchor?.componentId ?? "-",
            comp.meta?.endAnchor?.id ?? "-",
            comp.meta?.endAnchor?.holeId ?? "-",
            comp.meta?.color ?? "-"
          ].join(":")
        )
      }
    }

    return parts.join("|")
  }

  _buildGraph() {
    const edges = new Map()
    const batteries = []
    const leds = []
    const resistors = []

    const addEdge = (a, b) => {
      if (!a || !b || a === b) return
      if (!edges.has(a)) edges.set(a, new Set())
      if (!edges.has(b)) edges.set(b, new Set())
      edges.get(a).add(b)
      edges.get(b).add(a)
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
        batteries.push({ posNode, negNode, componentId: comp.id })
        if (!edges.has(posNode)) edges.set(posNode, new Set())
        if (!edges.has(negNode)) edges.set(negNode, new Set())
      }

      if (comp.type === "led" && comp.inserted && comp.pinConnections) {
        const anodeNode = pinToNode(comp, "anode")
        const cathodeNode = pinToNode(comp, "cathode")
        if (anodeNode && cathodeNode) {
          leds.push({ anodeNode, cathodeNode, componentId: comp.id })
        }
      }

      if (comp.type === "resistor" && comp.inserted && comp.pinConnections) {
        const leftNode = pinToNode(comp, "left")
        const rightNode = pinToNode(comp, "right")
        if (leftNode && rightNode) {
          resistors.push({ leftNode, rightNode, componentId: comp.id })
          addEdge(leftNode, rightNode)
        }
      }

      if (comp.type === "button" && comp.inserted && comp.pinConnections) {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const isPressed = mesh?.userData?.buttonState === true
        if (isPressed) {
          const nA = pinToNode(comp, "pin_a")
          const nB = pinToNode(comp, "pin_b")
          if (nA && nB) addEdge(nA, nB)
        }
      }

      if (comp.type === "switch" && comp.inserted && comp.pinConnections) {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const isClosed = mesh?.userData?.switchState === true
        if (isClosed) {
          const nA = pinToNode(comp, "pin_a")
          const nB = pinToNode(comp, "pin_b")
          if (nA && nB) addEdge(nA, nB)
        }
      }

      if (comp.type === "wire" && comp.meta?.startAnchor && comp.meta?.endAnchor) {
        const sn = anchorToNode(comp.meta.startAnchor)
        const en = anchorToNode(comp.meta.endAnchor)
        if (sn && en) addEdge(sn, en)
      }
    }

    return { edges, batteries, leds, resistors }
  }

  _evaluateAllLeds(graph) {
    const states = new Map()
    for (const led of graph.leds) {
      states.set(led.componentId, this._evaluateLED(led, graph))
    }
    return states
  }

  _applyAllLedStates(states) {
    for (const [componentId, state] of states.entries()) {
      this._applyLEDState(componentId, state)
    }
  }

  _evaluateLED(led, graph) {
    const { edges, batteries, resistors } = graph

    for (const battery of batteries) {
      const toAnode = this._bfsWithResistorCheck(
        battery.posNode,
        led.anodeNode,
        new Set([led.cathodeNode, battery.negNode]),
        edges,
        resistors
      )
      if (!toAnode.reached) continue

      const toCathode = this._bfsWithResistorCheck(
        led.cathodeNode,
        battery.negNode,
        new Set([led.anodeNode, battery.posNode]),
        edges,
        resistors
      )
      if (!toCathode.reached) continue

      const hasResistor = toAnode.passedResistor || toCathode.passedResistor
      return hasResistor ? "on" : "no_resistor"
    }

    return "off"
  }

  _bfsWithResistorCheck(startNode, targetNode, blockedNodes, edges, resistors) {
    if (startNode === targetNode) return { reached: true, passedResistor: false }
    if (blockedNodes.has(startNode)) return { reached: false, passedResistor: false }

    const resistorNodes = new Set()
    for (const r of resistors) {
      resistorNodes.add(r.leftNode)
      resistorNodes.add(r.rightNode)
    }

    const visited = new Set([startNode])
    const queue = [[startNode, false]]

    while (queue.length > 0) {
      const [current, passedR] = queue.shift()
      const neighbors = edges.get(current)
      if (!neighbors) continue

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue
        if (blockedNodes.has(neighbor) && neighbor !== targetNode) continue

        const nowPassedR = passedR || resistorNodes.has(neighbor)

        if (neighbor === targetNode) {
          return { reached: true, passedResistor: nowPassedR }
        }

        visited.add(neighbor)
        queue.push([neighbor, nowPassedR])
      }
    }

    return { reached: false, passedResistor: false }
  }

  _applyLEDState(componentId, state) {
    const mesh = this.stateSyncSystem?.getMeshById(componentId)
    if (!mesh) return

    const baseColor = normalizeColorValue(mesh.userData?.meta?.color, mesh.userData?.baseLedColor ?? 0xff3b3b)
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
        mat.color.setHex(onColor)
        mat.emissive.setHex(onEmissive)
        mat.emissiveIntensity = 1.8
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