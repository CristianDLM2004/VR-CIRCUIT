/**
 * CircuitDiagnosticSystem.js
 *
 * Sistema de diagnóstico de errores eléctricos para VR-CIRCUIT.
 * Hecho e implementado por Luis Fernando Tolentino Segovia.
 *
 * Detecta los siguientes errores en modo simulación:
 *   1. Circuito abierto          — no hay camino completo entre + y -
 *   2. Polaridad incorrecta      — LED insertado con ánodo y cátodo invertidos
 *   3. Cortocircuito             — terminal + conectado directamente a - sin carga
 *   4. Componente sin conexión   — insertado en protoboard pero sin cables hacia él
 *   5. Falta de resistencia      — LED encendido sin resistencia en el camino
 *
 * Por cada error detectado:
 *   - Ilumina el componente afectado en rojo (emissive rojo)
 *   - Devuelve una lista de mensajes para mostrar en el AlertPanel
 *
 * El sistema recibe el grafo ya construido por ElectricalSystem para no
 * duplicar trabajo de construcción.
 *
 * Uso:
 *   const diag = new CircuitDiagnosticSystem(appState, stateSyncSystem, holeSystem)
 *   const { alerts, hasErrors } = diag.analyze(graph)  // graph viene de ElectricalSystem
 */

// ─────────────────────────────────────────────
// Utilidades internas
// ─────────────────────────────────────────────

/**
 * BFS genérico que retorna true si existe camino de start a target
 * sin cruzar los nodos en blockedNodes (excepto el propio target).
 *
 * @param {string} startNode
 * @param {string} targetNode
 * @param {Set<string>} blockedNodes
 * @param {Map<string, Set<string>>} edges
 * @returns {boolean}
 */
function bfsReachable(startNode, targetNode, blockedNodes, edges) {
  if (startNode === targetNode) return true
  if (blockedNodes.has(startNode)) return false

  const visited = new Set([startNode])
  const queue = [startNode]

  while (queue.length > 0) {
    const current = queue.shift()
    const neighbors = edges.get(current)
    if (!neighbors) continue

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue
      if (blockedNodes.has(neighbor) && neighbor !== targetNode) continue
      if (neighbor === targetNode) return true
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }

  return false
}

/**
 * BFS que acumula la resistencia total mínima en el camino.
 * Retorna { reached, totalResistance }.
 *
 * @param {string} startNode
 * @param {string} targetNode
 * @param {Set<string>} blockedNodes
 * @param {Map<string, Set<string>>} edges
 * @param {Map<string, number>} edgeResistance
 * @returns {{ reached: boolean, totalResistance: number }}
 */
function bfsMinResistance(startNode, targetNode, blockedNodes, edges, edgeResistance) {
  if (startNode === targetNode) return { reached: true, totalResistance: 0 }
  if (blockedNodes.has(startNode)) return { reached: false, totalResistance: Infinity }

  // Dijkstra simple (cola ordenada por resistencia acumulada)
  const dist = new Map([[startNode, 0]])
  const queue = [{ node: startNode, r: 0 }]

  while (queue.length > 0) {
    // Extraer mínimo
    queue.sort((a, b) => a.r - b.r)
    const { node: current, r: currentR } = queue.shift()

    if (current === targetNode) return { reached: true, totalResistance: currentR }

    const neighbors = edges.get(current)
    if (!neighbors) continue

    for (const neighbor of neighbors) {
      if (blockedNodes.has(neighbor) && neighbor !== targetNode) continue

      const key = current < neighbor ? `${current}|${neighbor}` : `${neighbor}|${current}`
      const edgeR = edgeResistance?.get(key) ?? 0
      const nextR = currentR + edgeR
      const prev = dist.get(neighbor)

      if (prev == null || nextR < prev) {
        dist.set(neighbor, nextR)
        queue.push({ node: neighbor, r: nextR })
      }
    }
  }

  return { reached: false, totalResistance: Infinity }
}

// ─────────────────────────────────────────────
// Clase principal
// ─────────────────────────────────────────────

export class CircuitDiagnosticSystem {
  /**
   * @param {object} appState           — Estado global de componentes
   * @param {object} stateSyncSystem    — Para obtener meshes por ID
   * @param {object} holeSystem         — Para resolver posiciones de holes
   */
  constructor(appState, stateSyncSystem, holeSystem) {
    this.appState        = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem      = holeSystem

    // IDs de componentes que tienen highlight de error activo
    this._highlightedErrorIds = new Set()

    // Color de highlight de error (rojo intenso)
    this._errorEmissive  = 0xff1a00
    this._errorIntensity = 1.2

    // Cooldown para no recalcular cada frame (ms)
    this._analyzeIntervalMs  = 200
    this._lastAnalyzeMs      = 0

    // Resultado cacheado
    this._lastResult = { alerts: [], hasErrors: false, mode: "none" }
  }

  // ─────────────────────────────────────────────
  // API pública
  // ─────────────────────────────────────────────

  /**
   * Actualiza el holeSystem si cambia (e.g. cuando se recarga el salón).
   * @param {object} holeSystem
   */
  setHoleSystem(holeSystem) {
    this.holeSystem = holeSystem
  }

  /**
   * Ejecuta el diagnóstico usando el grafo ya construido por ElectricalSystem.
   * Llama esto desde el loop principal solo en modo simulación.
   *
   * @param {object} graph  — { edges, edgeResistance, batteries, leds }
   * @param {string} appMode — "edit" | "sim"
   * @returns {{ alerts: string[], hasErrors: boolean, mode: string }}
   */
  analyze(graph, appMode) {
    const now = performance.now()

    // Solo recalcular si pasó el intervalo
    if (now - this._lastAnalyzeMs < this._analyzeIntervalMs) {
      return this._lastResult
    }
    this._lastAnalyzeMs = now

    // Limpiar highlights anteriores
    this._clearAllHighlights()

    // En modo edición: solo mostrar el estado del modo, sin diagnóstico
    if (appMode !== "sim") {
      this._lastResult = {
        alerts: ["Modo: EDICIÓN", "Los circuitos no se evalúan", "Cambia a simulación para diagnosticar"],
        hasErrors: false,
        mode: "edit",
      }
      return this._lastResult
    }

    // Sin grafo disponible
    if (!graph) {
      this._lastResult = {
        alerts: ["Modo: SIMULACIÓN", "Sin datos de circuito"],
        hasErrors: false,
        mode: "sim",
      }
      return this._lastResult
    }

    const { edges, edgeResistance, batteries, leds } = graph

    const alerts  = []
    const errorIds = new Set()
    let hasErrors = false

    // ─── 1. Sin batería ───────────────────────────────────────
    if (!batteries || batteries.length === 0) {
      alerts.push("⚠ No hay batería en el circuito")
      hasErrors = true
    }

    // ─── 2. Componentes insertados sin ninguna conexión ───────
    const disconnectedIds = this._detectDisconnectedComponents(edges)
    for (const id of disconnectedIds) {
      const comp = this._getCompById(id)
      if (!comp) continue
      alerts.push(`⚠ ${this._compLabel(comp)} no está conectado`)
      errorIds.add(id)
      hasErrors = true
    }

    // ─── 3. Cortocircuito ─────────────────────────────────────
    const shortIds = this._detectShortCircuits(batteries, leds, edges, edgeResistance)
    for (const { batteryId, message } of shortIds) {
      alerts.push(`🔴 ${message}`)
      errorIds.add(batteryId)
      hasErrors = true
    }

    // ─── 4. Por cada LED: diagnosticar ────────────────────────
    for (const led of leds) {
      const ledComp = this._getCompById(led.componentId)
      const ledLabel = ledComp ? this._compLabel(ledComp) : "LED"

      let ledDiagnosed = false

      for (const battery of batteries) {

        // 4a. Comprobar polaridad invertida:
        //     ¿Hay camino cátodo→+ y ánodo→- más fácil que la dirección correcta?
        const polarityOk = this._checkLedPolarity(led, battery, edges)
        if (!polarityOk) {
          alerts.push(`🔴 ${ledLabel}: polaridad invertida (ánodo y cátodo al revés)`)
          errorIds.add(led.componentId)
          hasErrors = true
          ledDiagnosed = true
          break
        }

        // 4b. Comprobar camino completo (circuito abierto)
        const toAnode = bfsReachable(
          battery.posNode,
          led.anodeNode,
          new Set([led.cathodeNode, battery.negNode]),
          edges
        )

        const toCathode = bfsReachable(
          led.cathodeNode,
          battery.negNode,
          new Set([led.anodeNode, battery.posNode]),
          edges
        )

        if (!toAnode && !toCathode) {
          alerts.push(`⚠ ${ledLabel}: circuito abierto (sin camino completo)`)
          errorIds.add(led.componentId)
          hasErrors = true
          ledDiagnosed = true
          break
        }

        if (!toAnode) {
          alerts.push(`⚠ ${ledLabel}: falta conexión desde batería (+) al ánodo`)
          errorIds.add(led.componentId)
          hasErrors = true
          ledDiagnosed = true
          break
        }

        if (!toCathode) {
          alerts.push(`⚠ ${ledLabel}: falta conexión desde cátodo a batería (-)`)
          errorIds.add(led.componentId)
          hasErrors = true
          ledDiagnosed = true
          break
        }

        // 4c. Comprobar falta de resistencia
        const pathA = bfsMinResistance(
          battery.posNode,
          led.anodeNode,
          new Set([led.cathodeNode, battery.negNode]),
          edges,
          edgeResistance
        )
        const pathB = bfsMinResistance(
          led.cathodeNode,
          battery.negNode,
          new Set([led.anodeNode, battery.posNode]),
          edges,
          edgeResistance
        )

        const totalR = (pathA.totalResistance ?? 0) + (pathB.totalResistance ?? 0)

        if (totalR <= 0) {
          alerts.push(`⚠ ${ledLabel}: falta resistencia (puede dañarse)`)
          errorIds.add(led.componentId)
          hasErrors = true
          ledDiagnosed = true
          break
        }

        // 4d. Circuito correcto
        if (!ledDiagnosed) {
          alerts.push(`✅ ${ledLabel}: circuito correcto (${Math.round(totalR)} Ω)`)
        }
        ledDiagnosed = true
        break
      }

      // Si no hay baterías, marcar LEDs como sin fuente
      if (!ledDiagnosed) {
        alerts.push(`⚠ ${ledLabel}: sin fuente de alimentación`)
        errorIds.add(led.componentId)
        hasErrors = true
      }
    }

    // Sin LEDs ni baterías
    if (leds.length === 0 && batteries.length > 0) {
      alerts.push("ℹ No hay LEDs insertados")
    }

    if (alerts.length === 0) {
      alerts.push("✅ Modo: SIMULACIÓN")
      alerts.push("Sin errores detectados")
    } else {
      alerts.unshift("Modo: SIMULACIÓN")
    }

    // Aplicar highlights de error a los componentes afectados
    for (const id of errorIds) {
      this._applyErrorHighlight(id)
      this._highlightedErrorIds.add(id)
    }

    this._lastResult = { alerts, hasErrors, mode: "sim" }
    return this._lastResult
  }

  // ─────────────────────────────────────────────
  // Limpieza de highlights
  // ─────────────────────────────────────────────

  /**
   * Quita el highlight de error de todos los componentes que lo tenían.
   */
  _clearAllHighlights() {
    for (const id of this._highlightedErrorIds) {
      this._clearErrorHighlight(id)
    }
    this._highlightedErrorIds.clear()
  }

  /**
   * Fuerza limpiar todos los highlights (llamar al salir del modo sim).
   */
  clearAll() {
    this._clearAllHighlights()
    this._lastResult = { alerts: [], hasErrors: false, mode: "none" }
  }

  // ─────────────────────────────────────────────
  // Detección de errores
  // ─────────────────────────────────────────────

  /**
   * Detecta componentes insertados cuyas columnas de holes no tienen
   * ninguna arista en el grafo (ningún cable conectado a ellos).
   *
   * @param {Map<string, Set<string>>} edges
   * @returns {string[]} IDs de componentes desconectados
   */
  _detectDisconnectedComponents(edges) {
    const result = []

    for (const comp of this.appState.components) {
      // Solo componentes que deben insertarse
      if (!["led", "resistor", "button", "switch"].includes(comp.type)) continue
      if (!comp.inserted || !comp.pinConnections) continue

      const holeGroupMap = this._buildHoleGroupMap()
      let anyConnected = false

      // Verificar si alguno de sus nodos de hole aparece en el grafo con vecinos
      for (const pinId of Object.keys(comp.pinConnections)) {
        const holeId = comp.pinConnections[pinId]
        if (!holeId) continue

        const gk = holeGroupMap.get(holeId)
        const node = gk ? `group:${gk}` : `hole:${holeId}`

        const neighbors = edges.get(node)
        if (neighbors && neighbors.size > 0) {
          anyConnected = true
          break
        }
      }

      if (!anyConnected) {
        result.push(comp.id)
      }
    }

    return result
  }

  /**
   * Detecta cortocircuitos: camino directo de batería(+) a batería(-)
   * sin pasar por ningún LED ni resistencia.
   *
   * @param {object[]} batteries
   * @param {object[]} leds
   * @param {Map} edges
   * @param {Map} edgeResistance
   * @returns {{ batteryId: string, message: string }[]}
   */
  _detectShortCircuits(batteries, leds, edges, edgeResistance) {
    const result = []

    // Nodos que son pines/ánodos/cátodos de LEDs (no cruzar)
    const ledNodes = new Set()
    for (const led of leds) {
      if (led.anodeNode)   ledNodes.add(led.anodeNode)
      if (led.cathodeNode) ledNodes.add(led.cathodeNode)
    }

    for (const battery of batteries) {
      // Buscar camino directo de + a - sin cruzar LEDs y sin resistencia
      const path = bfsMinResistance(
        battery.posNode,
        battery.negNode,
        ledNodes,  // bloquear nodos de LEDs
        edges,
        edgeResistance
      )

      if (path.reached && path.totalResistance === 0) {
        result.push({
          batteryId: battery.componentId,
          message: "Cortocircuito: (+) conectado directo a (-)",
        })
      }
    }

    return result
  }

  /**
   * Verifica si la polaridad del LED es correcta.
   * Un LED tiene polaridad correcta si el camino natural es ánodo←(+) y cátodo→(-).
   * Si el camino invertido (cátodo←(+) y ánodo→(-)) es más accesible, la polaridad está mal.
   *
   * @param {object} led
   * @param {object} battery
   * @param {Map} edges
   * @returns {boolean} true si la polaridad es correcta o no determinable
   */
  _checkLedPolarity(led, battery, edges) {
    // Camino correcto: + → ánodo existe
    const correctA = bfsReachable(
      battery.posNode,
      led.anodeNode,
      new Set([led.cathodeNode, battery.negNode]),
      edges
    )

    // Camino invertido: + → cátodo existe (ánodo bloqueado)
    const invertedA = bfsReachable(
      battery.posNode,
      led.cathodeNode,
      new Set([led.anodeNode, battery.negNode]),
      edges
    )

    // Camino correcto: cátodo → - existe
    const correctB = bfsReachable(
      led.cathodeNode,
      battery.negNode,
      new Set([led.anodeNode, battery.posNode]),
      edges
    )

    // Camino invertido: ánodo → - existe
    const invertedB = bfsReachable(
      led.anodeNode,
      battery.negNode,
      new Set([led.cathodeNode, battery.posNode]),
      edges
    )

    // Si hay camino en dirección correcta, OK
    if (correctA && correctB) return true

    // Si hay camino en dirección invertida pero no en la correcta, hay inversión
    if (invertedA && invertedB && !correctA && !correctB) return false

    // En cualquier otro caso, asumir OK (circuito abierto se detecta aparte)
    return true
  }

  // ─────────────────────────────────────────────
  // Highlights visuales en componentes
  // ─────────────────────────────────────────────

  /**
   * Aplica emissive rojo a todos los meshes del componente.
   * @param {string} componentId
   */
  _applyErrorHighlight(componentId) {
    const mesh = this.stateSyncSystem?.getMeshById(componentId)
    if (!mesh) return

    mesh.traverse((child) => {
      if (!child.isMesh) return
      if (!child.material) return

      // No tocar LEDBody/LEDDome porque ElectricalSystem los maneja
      if (child.name === "LEDBody" || child.name === "LEDDome") return

      // Clonar material si todavía es compartido
      if (!child.userData._diagOriginalEmissive) {
        if (!child.material.__diagCloned) {
          child.material = child.material.clone()
          child.material.__diagCloned = true
        }

        child.userData._diagOriginalEmissive = child.material.emissive
          ? child.material.emissive.getHex()
          : 0x000000
        child.userData._diagOriginalEmissiveIntensity = child.material.emissiveIntensity ?? 0
      }

      if ("emissive" in child.material) {
        child.material.emissive.setHex(this._errorEmissive)
        child.material.emissiveIntensity = this._errorIntensity
      }
    })
  }

  /**
   * Restaura el emissive original del componente.
   * @param {string} componentId
   */
  _clearErrorHighlight(componentId) {
    const mesh = this.stateSyncSystem?.getMeshById(componentId)
    if (!mesh) return

    mesh.traverse((child) => {
      if (!child.isMesh) return
      if (!child.material) return
      if (child.name === "LEDBody" || child.name === "LEDDome") return

      if ("emissive" in child.material && child.userData._diagOriginalEmissive !== undefined) {
        child.material.emissive.setHex(child.userData._diagOriginalEmissive)
        child.material.emissiveIntensity = child.userData._diagOriginalEmissiveIntensity ?? 0
        delete child.userData._diagOriginalEmissive
        delete child.userData._diagOriginalEmissiveIntensity
      }
    })
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /**
   * Construye el mapa holeId → groupKey desde holeSystem.
   * @returns {Map<string, string>}
   */
  _buildHoleGroupMap() {
    const map = new Map()
    if (!this.holeSystem) return map
    for (const hole of this.holeSystem.holes) {
      map.set(hole.id, hole.groupKey)
    }
    return map
  }

  /**
   * Retorna el componente del appState por ID.
   * @param {string} id
   * @returns {object|null}
   */
  _getCompById(id) {
    return this.appState.components.find((c) => c.id === id) ?? null
  }

  /**
   * Genera una etiqueta legible para un componente.
   * @param {object} comp
   * @returns {string}
   */
  _compLabel(comp) {
    const typeLabels = {
      led:       "LED",
      resistor:  "Resistencia",
      button:    "Botón",
      switch:    "Switch",
      battery5v: "Batería",
    }
    return typeLabels[comp.type] ?? comp.type
  }
}