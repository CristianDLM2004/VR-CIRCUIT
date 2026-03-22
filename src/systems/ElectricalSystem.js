/**
 * ElectricalSystem.js
 *
 * Simulación eléctrica de nivel medio para VR-CIRCUIT.
 *
 * Reglas:
 * - Batería 5V tiene terminal positivo y negativo.
 * - Cables conectan anchors (terminales, pines, holes).
 * - Holes del mismo groupKey están eléctricamente unidos.
 * - Para que el LED encienda debe existir un camino cerrado:
 *     batería(+) → ... → LED(ánodo) → LED(cátodo) → ... → batería(-)
 *   que además pase por al menos una resistencia.
 * - Sin resistencia: LED parpadea en naranja (advertencia).
 * - Botón: solo conduce si buttonState === true (presionado).
 * - Switch: solo conduce si switchState === true (cerrado).
 * - Circuito incompleto: LED apagado.
 *
 * Se recalcula cada frame (llamar a update() en el loop principal).
 */

export class ElectricalSystem {
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem

    // Parpadeo para estado "sin resistencia"
    this._blinkIntervalMs = 400
    this._blinkAccumMs = 0
    this._blinkOn = false
  }

  // ---------------------------
  // API pública
  // ---------------------------

  update(dt) {
    this._blinkAccumMs += dt * 1000
    if (this._blinkAccumMs >= this._blinkIntervalMs) {
      this._blinkAccumMs -= this._blinkIntervalMs
      this._blinkOn = !this._blinkOn
    }

    const graph = this._buildGraph()
    this._simulate(graph)
  }

  // ---------------------------
  // Construcción del grafo
  // ---------------------------

  /**
   * Nodos del grafo:
   *   - Terminal de batería:  "terminal:battery5v_xxx:positive"
   *   - Hole group:           "group:CENTER_TOP_COL_5"
   *   - Pin no insertado:     "pin:led_xxx:anode"
   *
   * Aristas:
   *   - Cables → conectan sus dos anchors
   *   - LED insertado → arista ánodo↔cátodo (dirigida lógicamente, bidireccional en grafo)
   *   - Resistencia insertada → arista left↔right
   *   - Botón insertado y PRESIONADO → arista pin_a↔pin_b
   *   - Switch insertado y CERRADO → arista pin_a↔pin_b
   *
   * Retorna:
   * {
   *   edges: Map<nodeId, Set<nodeId>>,
   *   batteries:  [ { posNode, negNode, componentId } ],
   *   leds:       [ { anodeNode, cathodeNode, componentId } ],
   *   resistors:  [ { leftNode, rightNode, componentId } ],
   * }
   */
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

    // Mapa holeId → groupKey
    const holeGroupMap = new Map()
    if (this.holeSystem) {
      for (const hole of this.holeSystem.holes) {
        holeGroupMap.set(hole.id, hole.groupKey)
      }
    }

    // Resolver anchor serializado → nodeId
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
        // Si está insertado, resolver al groupKey del hole
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

    // Resolver un pin de componente insertado → nodeId
    const pinToNode = (comp, pinId) => {
      if (comp?.inserted && comp?.pinConnections) {
        const holeId = comp.pinConnections[pinId]
        if (holeId) {
          const gk = holeGroupMap.get(holeId)
          if (gk) return `group:${gk}`
          return `hole:${holeId}`
        }
      }
      return `pin:${comp.id}:${pinId}`
    }

    for (const comp of this.appState.components) {

      // Batería
      if (comp.type === "battery5v") {
        const posNode = `terminal:${comp.id}:positive`
        const negNode = `terminal:${comp.id}:negative`
        batteries.push({ posNode, negNode, componentId: comp.id })
        if (!edges.has(posNode)) edges.set(posNode, new Set())
        if (!edges.has(negNode)) edges.set(negNode, new Set())
      }

      // LED insertado → arista ánodo↔cátodo
      if (comp.type === "led" && comp.inserted && comp.pinConnections) {
        const anodeNode = pinToNode(comp, "anode")
        const cathodeNode = pinToNode(comp, "cathode")
        if (anodeNode && cathodeNode) {
          leds.push({ anodeNode, cathodeNode, componentId: comp.id })
          addEdge(anodeNode, cathodeNode)
        }
      }

      // Resistencia insertada → arista left↔right
      if (comp.type === "resistor" && comp.inserted && comp.pinConnections) {
        const leftNode = pinToNode(comp, "left")
        const rightNode = pinToNode(comp, "right")
        if (leftNode && rightNode) {
          resistors.push({ leftNode, rightNode, componentId: comp.id })
          addEdge(leftNode, rightNode)
        }
      }

      // Botón insertado → arista SOLO si está presionado
      if (comp.type === "button" && comp.inserted && comp.pinConnections) {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const isPressed = mesh?.userData?.buttonState === true

        if (isPressed) {
          const nodeA = pinToNode(comp, "pin_a")
          const nodeB = pinToNode(comp, "pin_b")
          if (nodeA && nodeB) addEdge(nodeA, nodeB)
        }
      }

      // Switch insertado → arista SOLO si está cerrado
      if (comp.type === "switch" && comp.inserted && comp.pinConnections) {
        const mesh = this.stateSyncSystem?.getMeshById(comp.id)
        const isClosed = mesh?.userData?.switchState === true

        if (isClosed) {
          const nodeA = pinToNode(comp, "pin_a")
          const nodeB = pinToNode(comp, "pin_b")
          if (nodeA && nodeB) addEdge(nodeA, nodeB)
        }
      }

      // Cable → arista entre sus dos anchors
      if (comp.type === "wire" && comp.meta?.startAnchor && comp.meta?.endAnchor) {
        const startNode = anchorToNode(comp.meta.startAnchor)
        const endNode = anchorToNode(comp.meta.endAnchor)
        if (startNode && endNode) addEdge(startNode, endNode)
      }
    }

    return { edges, batteries, leds, resistors }
  }

  // ---------------------------
  // Simulación
  // ---------------------------

  _simulate(graph) {
    for (const led of graph.leds) {
      const result = this._evaluateLED(led, graph)
      this._applyLEDState(led.componentId, result)
    }
  }

  /**
   * Evalúa si el LED debe encenderse.
   * Busca camino cerrado: batería(+) → LED(ánodo) y LED(cátodo) → batería(-)
   * con al menos una resistencia en el camino total.
   *
   * Retorna: "on" | "no_resistor" | "off"
   */
  _evaluateLED(led, graph) {
    const { edges, batteries, resistors } = graph

    for (const battery of batteries) {
      const toAnode = this._bfsWithResistorCheck(
        battery.posNode,
        led.anodeNode,
        battery.negNode,
        edges,
        resistors
      )
      if (!toAnode.reached) continue

      const toCathode = this._bfsWithResistorCheck(
        led.cathodeNode,
        battery.negNode,
        battery.posNode,
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
   * No cruza blockedNode.
   * Registra si el camino pasa por un nodo de resistencia.
   */
  _bfsWithResistorCheck(startNode, targetNode, blockedNode, edges, resistors) {
    if (startNode === targetNode) return { reached: true, passedResistor: false }

    const resistorNodes = new Set()
    for (const r of resistors) {
      resistorNodes.add(r.leftNode)
      resistorNodes.add(r.rightNode)
    }

    const visited = new Set()
    const queue = [[startNode, false]]
    visited.add(startNode)

    while (queue.length > 0) {
      const [current, passedR] = queue.shift()

      const neighbors = edges.get(current)
      if (!neighbors) continue

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue
        if (neighbor === blockedNode) continue

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

  // ---------------------------
  // Aplicar estado visual al LED
  // ---------------------------

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
        mat.opacity = 1.0
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