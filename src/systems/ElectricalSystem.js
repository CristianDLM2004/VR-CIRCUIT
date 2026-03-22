/**
 * ElectricalSystem.js
 *
 * Simulación eléctrica de nivel medio para VR-CIRCUIT.
 *
 * Reglas:
 * - Una batería 5V tiene terminal positivo y negativo.
 * - Los cables conectan anchors (terminales, pines, holes).
 * - Los holes de una misma columna (groupKey) están eléctricamente unidos.
 * - Para que el LED encienda debe existir un camino cerrado:
 *     batería(+) → ... → LED(ánodo) → LED(cátodo) → ... → batería(-)
 *   que además pase por al menos una resistencia.
 * - Si el camino existe pero SIN resistencia: el LED parpadea (advertencia).
 * - Si el circuito está incompleto: el LED se apaga.
 *
 * Se recalcula cada frame (llamar a update() en el loop principal).
 */

export class ElectricalSystem {
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem

    // Control de parpadeo para el estado "sin resistencia"
    this._blinkIntervalMs = 400
    this._blinkAccumMs = 0
    this._blinkOn = false

    // Cache para no reconstruir el grafo si nada cambió
    this._lastStateHash = null
  }

  // ---------------------------
  // API pública
  // ---------------------------

  update(dt) {
    // Acumular tiempo para parpadeo
    this._blinkAccumMs += dt * 1000
    if (this._blinkAccumMs >= this._blinkIntervalMs) {
      this._blinkAccumMs -= this._blinkIntervalMs
      this._blinkOn = !this._blinkOn
    }

    // Hash rápido del estado (número de componentes + conexiones)
    const hash = this._computeHash()
    const stateChanged = hash !== this._lastStateHash
    this._lastStateHash = hash

    // Construir grafo y simular
    const graph = this._buildGraph()
    this._simulate(graph, stateChanged)
  }

  // ---------------------------
  // Hash de estado
  // ---------------------------

  _computeHash() {
    const c = this.appState.components
    return c.length + "_" + c.map(x => x.id + (x.inserted ? "i" : "") + (x.pinConnections ? "p" : "")).join("|")
  }

  // ---------------------------
  // Construcción del grafo
  // ---------------------------

  /**
   * Cada nodo del grafo es un string que representa un punto eléctrico:
   *   - Terminal de batería:    "terminal:battery5v_xxx:positive"
   *   - Hole group:             "group:CENTER_TOP_COL_5"
   *   - Pin de componente:      "pin:led_xxx:anode"  (solo para componentes NO insertados)
   *
   * Los cables crean aristas entre nodos.
   * Los holes del mismo groupKey están unidos (mismo nodo lógico = el groupKey).
   * Los pines insertados en holes se unen al groupKey del hole correspondiente.
   *
   * Retorna:
   * {
   *   edges: Map<nodeId, Set<nodeId>>,   // grafo no dirigido
   *   batteries: [ { posNode, negNode, componentId } ],
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
      if (a === b) return
      if (!edges.has(a)) edges.set(a, new Set())
      if (!edges.has(b)) edges.set(b, new Set())
      edges.get(a).add(b)
      edges.get(b).add(a)
    }

    // Mapa de holeId → groupKey (para resolver pines insertados)
    const holeGroupMap = new Map()
    if (this.holeSystem) {
      for (const hole of this.holeSystem.holes) {
        holeGroupMap.set(hole.id, hole.groupKey)
      }
    }

    // Función: dado un anchor serializado del cable, devuelve su nodeId
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
        // Si el componente está insertado, resolver al groupKey del hole
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

    // Procesar todos los componentes
    for (const comp of this.appState.components) {

      if (comp.type === "battery5v") {
        const posNode = `terminal:${comp.id}:positive`
        const negNode = `terminal:${comp.id}:negative`
        batteries.push({ posNode, negNode, componentId: comp.id })
        // Asegurar que los nodos existan aunque no tengan aristas aún
        if (!edges.has(posNode)) edges.set(posNode, new Set())
        if (!edges.has(negNode)) edges.set(negNode, new Set())
      }

      if (comp.type === "led" && comp.inserted && comp.pinConnections) {
        const anodeHoleId = comp.pinConnections["anode"]
        const cathodeHoleId = comp.pinConnections["cathode"]

        const anodeGK = anodeHoleId ? holeGroupMap.get(anodeHoleId) : null
        const cathodeGK = cathodeHoleId ? holeGroupMap.get(cathodeHoleId) : null

        const anodeNode = anodeGK ? `group:${anodeGK}` : (anodeHoleId ? `hole:${anodeHoleId}` : null)
        const cathodeNode = cathodeGK ? `group:${cathodeGK}` : (cathodeHoleId ? `hole:${cathodeHoleId}` : null)

        if (anodeNode && cathodeNode) {
          leds.push({ anodeNode, cathodeNode, componentId: comp.id })
          // El LED crea una arista dirigida lógica (ánodo→cátodo)
          // En el grafo la ponemos bidireccional pero la validamos en simulación
          addEdge(anodeNode, cathodeNode)
        }
      }

      if (comp.type === "resistor" && comp.inserted && comp.pinConnections) {
        const leftHoleId = comp.pinConnections["left"]
        const rightHoleId = comp.pinConnections["right"]

        const leftGK = leftHoleId ? holeGroupMap.get(leftHoleId) : null
        const rightGK = rightHoleId ? holeGroupMap.get(rightHoleId) : null

        const leftNode = leftGK ? `group:${leftGK}` : (leftHoleId ? `hole:${leftHoleId}` : null)
        const rightNode = rightGK ? `group:${rightGK}` : (rightHoleId ? `hole:${rightHoleId}` : null)

        if (leftNode && rightNode) {
          resistors.push({ leftNode, rightNode, componentId: comp.id })
          addEdge(leftNode, rightNode)
        }
      }

      // Los cables crean aristas directas entre sus anchors
      if (comp.type === "wire" && comp.meta?.startAnchor && comp.meta?.endAnchor) {
        const startNode = anchorToNode(comp.meta.startAnchor)
        const endNode = anchorToNode(comp.meta.endAnchor)
        if (startNode && endNode) {
          addEdge(startNode, endNode)
        }
      }
    }

    return { edges, batteries, leds, resistors }
  }

  // ---------------------------
  // Simulación
  // ---------------------------

  _simulate(graph, _stateChanged) {
    const { edges, batteries, leds, resistors } = graph

    // Para cada LED, determinar su estado
    for (const led of leds) {
      const result = this._evaluateLED(led, graph)
      this._applyLEDState(led.componentId, result)
    }

    // Si no hay LEDs, no hay nada que mostrar
  }

  /**
   * Evalúa si un LED debe encenderse.
   *
   * Busca si existe alguna batería tal que:
   *   - Hay camino de batería(+) → LED(ánodo)
   *   - Hay camino de LED(cátodo) → batería(-)
   *   - Al menos uno de esos caminos pasa por una resistencia
   *
   * Retorna: "on" | "no_resistor" | "off"
   */
  _evaluateLED(led, graph) {
    const { edges, batteries, resistors } = graph

    for (const battery of batteries) {
      // BFS desde batería(+) hacia LED(ánodo), registrando si pasamos por resistencia
      const toAnode = this._bfsWithResistorCheck(
        battery.posNode,
        led.anodeNode,
        battery.negNode, // no cruzar el negativo en este sentido
        edges,
        resistors
      )

      if (!toAnode.reached) continue

      // BFS desde LED(cátodo) hacia batería(-), registrando si pasamos por resistencia
      const toCathode = this._bfsWithResistorCheck(
        led.cathodeNode,
        battery.negNode,
        battery.posNode, // no cruzar el positivo en este sentido
        edges,
        resistors
      )

      if (!toCathode.reached) continue

      // Circuito completo — ¿hay resistencia en alguno de los dos tramos?
      const hasResistor = toAnode.passedResistor || toCathode.passedResistor

      if (hasResistor) return "on"
      return "no_resistor"
    }

    return "off"
  }

  /**
   * BFS desde `startNode` hasta `targetNode`.
   * Evita cruzar `blockedNode` para no crear caminos inválidos.
   * Registra si el camino pasa por algún nodo de resistencia.
   *
   * Retorna { reached: bool, passedResistor: bool }
   */
  _bfsWithResistorCheck(startNode, targetNode, blockedNode, edges, resistors) {
    if (startNode === targetNode) return { reached: true, passedResistor: false }

    // Construir set de nodos que son parte de resistencias
    const resistorNodes = new Set()
    for (const r of resistors) {
      resistorNodes.add(r.leftNode)
      resistorNodes.add(r.rightNode)
    }

    const visited = new Set()
    // Cola: [currentNode, passedResistor]
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

    // Buscar los materiales del body y dome del LED
    mesh.traverse((child) => {
      if (!child.isMesh) return
      if (child.name !== "LEDBody" && child.name !== "LEDDome") return

      const mat = child.material
      if (!mat) return

      // Asegurar que el material tiene emissive
      if (!("emissive" in mat)) return

      if (state === "on") {
        // Encendido: color vivo + emissive fuerte
        mat.color.setHex(0xff2222)
        mat.emissive.setHex(0xff1111)
        mat.emissiveIntensity = 1.8
        mat.opacity = 1.0
        mat.transparent = false
      } else if (state === "no_resistor") {
        // Sin resistencia: parpadeo de advertencia (naranja)
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
        // Apagado: color base sin emissive
        mat.color.setHex(0xff3b3b)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
        mat.transparent = false
      }
    })
  }
}