/**
 * ElectricalSystem.js
 *
 * Simulación eléctrica para VR-CIRCUIT.
 * Hecho e implementado por Luis Fernando Tolentino Segovia.
 *
 * Cambios respecto a la versión anterior:
 *   - Se guarda el grafo construido en this.lastGraph para que
 *     CircuitDiagnosticSystem pueda reutilizarlo sin reconstruirlo.
 *   - Toda la lógica eléctrica permanece igual.
 *
 * Detecta:
 *   - Continuidad del circuito
 *   - Ausencia de resistencia (LED parpadea)
 *   - Corriente real con la ley de Ohm
 *   - Intensidad variable del LED según valor de resistencia
 *   - Estimación del Vf del LED según su color
 */

// ─────────────────────────────────────────────
// Utilidades de color
// ─────────────────────────────────────────────

/**
 * Convierte un nombre de color CSS a su valor hexadecimal numérico.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
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
 */
function boostHex(hex, factor = 1.0) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * factor))
  const g = Math.min(255, Math.round(((hex >> 8)  & 255) * factor))
  const b = Math.min(255, Math.round((hex & 255)         * factor))
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}

/**
 * Clamp a [0, 1].
 * @param {number} v
 * @returns {number}
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

/**
 * Genera una clave única para una arista (a, b) independiente del orden.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Convierte un color hex a RGB normalizado [0, 1].
 * @param {number} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb01(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8)  & 255) / 255,
    b: (hex & 255)         / 255,
  }
}

/**
 * Estima el voltaje de umbral (Vf) del LED según su color dominante.
 * Valores típicos reales:
 *   Rojo/Naranja: ~2.0 V
 *   Verde: ~2.1 V
 *   Azul/Blanco: ~3.0–3.2 V
 *
 * @param {number} hexColor
 * @returns {number} Vf en voltios
 */
function estimateLedForwardVoltage(hexColor) {
  const { r, g, b } = hexToRgb01(hexColor)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  if (max > 0.92 && min > 0.82) return 3.1              // blanco
  if (b > 0.75 && b >= g && b >= r) return 3.0          // azul puro
  if (b > 0.65 && g > 0.65 && r < 0.35) return 3.0     // cian
  if (r > 0.55 && b > 0.55 && g < 0.45) return 2.9     // magenta/violeta
  if (g > r && g > b) return 2.1                        // verde
  if (r > 0.75 && g > 0.45 && b < 0.25) return 2.1     // naranja-amarillo
  return 2.0                                             // rojo por defecto
}

// ─────────────────────────────────────────────
// Clase principal
// ─────────────────────────────────────────────

export class ElectricalSystem {
  /**
   * @param {object} appState        — Estado global de componentes
   * @param {object} stateSyncSystem — Para obtener meshes por ID
   * @param {object|null} holeSystem — Sistema de holes de la protoboard
   */
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState        = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem      = holeSystem

    // Grafo más reciente construido — lo lee CircuitDiagnosticSystem
    this.lastGraph = null

    // Control de parpadeo para estado "sin resistencia"
    this._blinkIntervalMs = 400
    this._blinkAccumMs    = 0
    this._blinkOn         = false
  }

  // ─────────────────────────────────────────────
  // API pública
  // ─────────────────────────────────────────────

  /**
   * Actualiza la simulación eléctrica.
   * Debe llamarse cada frame desde el loop principal.
   *
   * @param {number} dt — Delta time en segundos
   */
  update(dt) {
    // Control de parpadeo
    this._blinkAccumMs += dt * 1000
    if (this._blinkAccumMs >= this._blinkIntervalMs) {
      this._blinkAccumMs -= this._blinkIntervalMs
      this._blinkOn = !this._blinkOn
    }

    // Construir grafo y guardar referencia para diagnóstico
    const graph = this._buildGraph()
    this.lastGraph = graph

    // Simular y aplicar estados a los LEDs
    this._simulate(graph)
  }

  // ─────────────────────────────────────────────
  // Construcción del grafo eléctrico
  // ─────────────────────────────────────────────

  /**
   * Construye el grafo eléctrico a partir del estado actual de componentes.
   *
   * Nodos del grafo:
   *   "terminal:{id}:{positive|negative}"  — terminales de batería
   *   "group:{groupKey}"                   — grupo eléctrico de holes
   *   "hole:{holeId}"                      — hole individual (sin groupKey)
   *   "pin:{compId}:{pinId}"               — pin no insertado
   *
   * Aristas:
   *   - Resistencias: arista con resistencia = su valor en Ω
   *   - Cables: arista con resistencia = 0
   *   - Botón presionado: arista con resistencia = 0
   *   - Switch cerrado: arista con resistencia = 0
   *   - LED: NO crea arista (se evalúa de forma aislada para no mezclar circuitos)
   *
   * @returns {{ edges: Map, edgeResistance: Map, batteries: object[], leds: object[] }}
   */
  _buildGraph() {
    const edges          = new Map()   // Map<nodeId, Set<nodeId>>
    const edgeResistance = new Map()   // Map<edgeKey, number>
    const batteries      = []
    const leds           = []

    /**
     * Agrega una arista bidireccional al grafo con una resistencia asociada.
     * Si ya existe la arista, conserva el menor valor de resistencia.
     */
    const addEdge = (a, b, resistance = 0) => {
      if (!a || !b || a === b) return

      if (!edges.has(a)) edges.set(a, new Set())
      if (!edges.has(b)) edges.set(b, new Set())

      edges.get(a).add(b)
      edges.get(b).add(a)

      const key  = edgeKey(a, b)
      const prev = edgeResistance.get(key)

      if (prev == null || resistance < prev) {
        edgeResistance.set(key, resistance)
      }
    }

    // Mapa holeId → groupKey para resolver nodos de holes
    const holeGroupMap = new Map()
    if (this.holeSystem) {
      for (const hole of this.holeSystem.holes) {
        holeGroupMap.set(hole.id, hole.groupKey)
      }
    }

    /**
     * Resuelve el nodo eléctrico de un pin de un componente insertado.
     * Si el componente está insertado, retorna el nodo del groupKey del hole.
     * Si no, retorna un nodo de pin aislado.
     */
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

    /**
     * Resuelve el nodo eléctrico de un anchor serializado de un cable.
     */
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

    // ── Procesar todos los componentes ─────────────────────────
    for (const comp of this.appState.components) {

      // Batería — registrar terminales como nodos fuente
      if (comp.type === "battery5v") {
        const posNode = `terminal:${comp.id}:positive`
        const negNode = `terminal:${comp.id}:negative`
        const voltage = Math.max(0, Number(comp.meta?.voltage) || 5)

        batteries.push({ posNode, negNode, componentId: comp.id, voltage })

        if (!edges.has(posNode)) edges.set(posNode, new Set())
        if (!edges.has(negNode)) edges.set(negNode, new Set())
      }

      // LED insertado — registrar sin arista (evalúo aislado en _evaluateLED)
      if (comp.type === "led" && comp.inserted && comp.pinConnections) {
        const anodeNode   = pinToNode(comp, "anode")
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

      // Resistencia insertada — arista con su valor en Ω
      if (comp.type === "resistor" && comp.inserted && comp.pinConnections) {
        const leftNode  = pinToNode(comp, "left")
        const rightNode = pinToNode(comp, "right")
        const resistance = Math.max(1, Math.round(Number(comp.meta?.resistance) || 220))

        if (leftNode && rightNode) {
          addEdge(leftNode, rightNode, resistance)
        }
      }

      // Botón insertado — solo conduce si está presionado
      if (comp.type === "button" && comp.inserted && comp.pinConnections) {
        const mesh      = this.stateSyncSystem?.getMeshById(comp.id)
        const isPressed = mesh?.userData?.buttonState === true

        if (isPressed) {
          const nA = pinToNode(comp, "pin_a")
          const nB = pinToNode(comp, "pin_b")
          if (nA && nB) addEdge(nA, nB, 0)
        }
      }

      // Switch insertado — solo conduce si está cerrado
      if (comp.type === "switch" && comp.inserted && comp.pinConnections) {
        const mesh     = this.stateSyncSystem?.getMeshById(comp.id)
        const isClosed = mesh?.userData?.switchState === true

        if (isClosed) {
          const nA = pinToNode(comp, "pin_a")
          const nB = pinToNode(comp, "pin_b")
          if (nA && nB) addEdge(nA, nB, 0)
        }
      }

      // Cable — arista de resistencia 0
      if (comp.type === "wire" && comp.meta?.startAnchor && comp.meta?.endAnchor) {
        const sn = anchorToNode(comp.meta.startAnchor)
        const en = anchorToNode(comp.meta.endAnchor)
        if (sn && en) addEdge(sn, en, 0)
      }
    }

    return { edges, edgeResistance, batteries, leds }
  }

  // ─────────────────────────────────────────────
  // Simulación
  // ─────────────────────────────────────────────

  /**
   * Evalúa cada LED y aplica su estado visual.
   * @param {object} graph
   */
  _simulate(graph) {
    for (const led of graph.leds) {
      const ledState = this._evaluateLED(led, graph)
      this._applyLEDState(led.componentId, ledState)
    }
  }

  /**
   * Evalúa si un LED específico debe encenderse y con qué intensidad.
   *
   * Busca para cada batería:
   *   - Camino de menor resistencia: batería(+) → LED(ánodo)
   *   - Camino de menor resistencia: LED(cátodo) → batería(-)
   *
   * Aplica la ley de Ohm: I = (V - Vf) / R
   * La intensidad del LED es proporcional a I normalizada a 20 mA.
   *
   * @param {object} led   — { anodeNode, cathodeNode, componentId, color }
   * @param {object} graph — { edges, edgeResistance, batteries }
   * @returns {{ mode: string, brightness: number, currentA: number }}
   */
  _evaluateLED(led, graph) {
    const { edges, edgeResistance, batteries } = graph

    for (const battery of batteries) {
      // Camino (+) → ánodo (bloqueando cátodo y negativo para aislar el circuito)
      const toAnode = this._findLeastResistancePath(
        battery.posNode,
        led.anodeNode,
        new Set([led.cathodeNode, battery.negNode]),
        edges,
        edgeResistance
      )
      if (!toAnode.reached) continue

      // Camino cátodo → (-) (bloqueando ánodo y positivo)
      const toCathode = this._findLeastResistancePath(
        led.cathodeNode,
        battery.negNode,
        new Set([led.anodeNode, battery.posNode]),
        edges,
        edgeResistance
      )
      if (!toCathode.reached) continue

      const totalResistance = toAnode.totalResistance + toCathode.totalResistance

      // Sin resistencia: parpadeo de advertencia
      if (totalResistance <= 0) {
        return { mode: "no_resistor", brightness: 0, currentA: 0 }
      }

      // Ley de Ohm: I = (V - Vf) / R
      const vf             = estimateLedForwardVoltage(led.color)
      const availableVoltage = Math.max(0, battery.voltage - vf)
      const currentA         = availableVoltage / totalResistance

      // Corriente mínima para encender (~0.8 mA)
      if (currentA <= 0.0008) {
        return { mode: "off", brightness: 0, currentA }
      }

      // Normalizar a 20 mA (corriente típica máxima de un LED)
      const normalizedCurrent = clamp01(currentA / 0.02)
      const brightness        = Math.pow(normalizedCurrent, 0.7)

      return { mode: "on", brightness, currentA }
    }

    return { mode: "off", brightness: 0, currentA: 0 }
  }

  /**
   * Algoritmo de Dijkstra simplificado para encontrar el camino de
   * menor resistencia entre dos nodos del grafo.
   *
   * @param {string} startNode
   * @param {string} targetNode
   * @param {Set<string>} blockedNodes  — Nodos que no se pueden cruzar
   * @param {Map<string, Set<string>>} edges
   * @param {Map<string, number>} edgeResistance
   * @returns {{ reached: boolean, totalResistance: number }}
   */
  _findLeastResistancePath(startNode, targetNode, blockedNodes, edges, edgeResistance) {
    if (startNode === targetNode) return { reached: true, totalResistance: 0 }
    if (blockedNodes.has(startNode)) return { reached: false, totalResistance: Infinity }

    const dist   = new Map([[startNode, 0]])
    const queue  = [{ node: startNode, totalResistance: 0 }]
    const visited = new Set()

    while (queue.length > 0) {
      // Extraer nodo con menor resistencia acumulada (Dijkstra)
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

        const key    = edgeKey(current.node, neighbor)
        const edgeR  = edgeResistance?.get(key) ?? 0
        const nextR  = current.totalResistance + edgeR
        const prev   = dist.get(neighbor)

        if (prev == null || nextR < prev) {
          dist.set(neighbor, nextR)
          queue.push({ node: neighbor, totalResistance: nextR })
        }
      }
    }

    return { reached: false, totalResistance: Infinity }
  }

  // ─────────────────────────────────────────────
  // Estado visual del LED
  // ─────────────────────────────────────────────

  /**
   * Aplica el color y emissive correcto al LED según su estado eléctrico.
   *
   * Estados:
   *   "on"          → encendido con intensidad variable
   *   "no_resistor" → parpadeo naranja (advertencia de daño)
   *   "off"         → apagado, color base
   *
   * @param {string} componentId
   * @param {{ mode: string, brightness: number }} ledState
   */
  _applyLEDState(componentId, ledState) {
    const mesh = this.stateSyncSystem?.getMeshById(componentId)
    if (!mesh) return

    const state      = ledState?.mode ?? "off"
    const brightness = clamp01(ledState?.brightness ?? 0)

    // Color base del LED (puede haber sido editado por el EditPanel)
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
        // Parpadeo naranja — el diagnóstico marcará el error también
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
        // Apagado
        mat.color.setHex(baseColor)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
        mat.transparent = false
        mat.opacity     = 1.0
      }
    })
  }
}