/**
 * ElectricalSystem.js
 *
 * Simulación eléctrica de nivel medio para VR-CIRCUIT.
 *
 * Corrección principal de circuitos aislados:
 * - El LED NO crea arista en el grafo general.
 *   Esto evita que el BFS "cruce" el LED como conductor y mezcle circuitos.
 * - El BFS bloquea explícitamente los nodos del otro extremo del LED
 *   y de la batería contraria, forzando que cada camino sea independiente.
 * - Dos circuitos con LEDs distintos no se influyen mutuamente.
 */

export class ElectricalSystem {
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState        = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem      = holeSystem

    this._blinkIntervalMs = 400
    this._blinkAccumMs    = 0
    this._blinkOn         = false
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
    const edges     = new Map()
    const batteries = []
    const leds      = []
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
        const comp = this.appState.components.find(c => c.id === anchor.componentId)
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
        const anodeNode   = pinToNode(comp, "anode")
        const cathodeNode = pinToNode(comp, "cathode")
        if (anodeNode && cathodeNode) {
          // ✅ LED NO crea arista — solo se registra para evaluación
          // Si creara arista, el BFS cruzaría el LED y conectaría circuitos distintos
          leds.push({ anodeNode, cathodeNode, componentId: comp.id })
        }
      }

      if (comp.type === "resistor" && comp.inserted && comp.pinConnections) {
        const leftNode  = pinToNode(comp, "left")
        const rightNode = pinToNode(comp, "right")
        if (leftNode && rightNode) {
          resistors.push({ leftNode, rightNode, componentId: comp.id })
          addEdge(leftNode, rightNode)
        }
      }

      if (comp.type === "button" && comp.inserted && comp.pinConnections) {
        const mesh      = this.stateSyncSystem?.getMeshById(comp.id)
        const isPressed = mesh?.userData?.buttonState === true
        if (isPressed) {
          const nA = pinToNode(comp, "pin_a")
          const nB = pinToNode(comp, "pin_b")
          if (nA && nB) addEdge(nA, nB)
        }
      }

      if (comp.type === "switch" && comp.inserted && comp.pinConnections) {
        const mesh     = this.stateSyncSystem?.getMeshById(comp.id)
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

  _simulate(graph) {
    for (const led of graph.leds) {
      this._applyLEDState(led.componentId, this._evaluateLED(led, graph))
    }
  }

  /**
   * Evalúa si UN LED específico debe encenderse.
   *
   * Camino 1: batería(+) → LED(ánodo)
   *   Bloqueamos: LED(cátodo) y batería(-) para no cruzar el LED ni cerrar el loop prematuramente
   *
   * Camino 2: LED(cátodo) → batería(-)
   *   Bloqueamos: LED(ánodo) y batería(+) por la misma razón
   *
   * Si ambos caminos existen → circuito cerrado para ESTE LED específico.
   * Otro LED en otro circuito tiene sus propios nodos de ánodo/cátodo → no se mezcla.
   */
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

  /**
   * BFS desde startNode hasta targetNode.
   * blockedNodes: Set — no se puede pasar por ellos (excepto el propio targetNode).
   * Registra si el camino pasó por algún nodo de resistencia.
   */
  _bfsWithResistorCheck(startNode, targetNode, blockedNodes, edges, resistors) {
    if (startNode === targetNode) return { reached: true, passedResistor: false }
    if (blockedNodes.has(startNode)) return { reached: false, passedResistor: false }

    const resistorNodes = new Set()
    for (const r of resistors) {
      resistorNodes.add(r.leftNode)
      resistorNodes.add(r.rightNode)
    }

    const visited = new Set([startNode])
    const queue   = [[startNode, false]]

    while (queue.length > 0) {
      const [current, passedR] = queue.shift()
      const neighbors = edges.get(current)
      if (!neighbors) continue

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue
        if (blockedNodes.has(neighbor) && neighbor !== targetNode) continue

        const nowPassedR = passedR || resistorNodes.has(neighbor)

        if (neighbor === targetNode) return { reached: true, passedResistor: nowPassedR }

        visited.add(neighbor)
        queue.push([neighbor, nowPassedR])
      }
    }

    return { reached: false, passedResistor: false }
  }

  _applyLEDState(componentId, state) {
    const mesh = this.stateSyncSystem?.getMeshById(componentId)
    if (!mesh) return

    mesh.traverse((child) => {
      if (!child.isMesh) return
      if (child.name !== "LEDBody" && child.name !== "LEDDome") return
      const mat = child.material
      if (!mat || !("emissive" in mat)) return

      if (state === "on") {
        mat.color.setHex(0xff2222)
        mat.emissive.setHex(0xff1111)
        mat.emissiveIntensity = 1.8
        mat.transparent = false
        mat.opacity     = 1.0
      } else if (state === "no_resistor") {
        if (this._blinkOn) {
          mat.color.setHex(0xff6600)
          mat.emissive.setHex(0xff3300)
          mat.emissiveIntensity = 1.4
        } else {
          mat.color.setHex(0xff3b3b)
          mat.emissive.setHex(0x000000)
          mat.emissiveIntensity = 0
        }
        mat.transparent = false
      } else {
        mat.color.setHex(0xff3b3b)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
        mat.transparent = false
      }
    })
  }
}