/**
 * ElectricalSystem.js
 *
 * Sistema de simulación eléctrica para VR-CIRCUIT.
 *
 * Cada frame (o cada N frames) reconstruye el grafo eléctrico
 * a partir del estado actual de componentes y cables, resuelve
 * el circuito con un análisis nodal simplificado y aplica
 * los efectos visuales correspondientes a cada componente.
 *
 * Fallas simuladas:
 *   - LED sin resistencia → parpadeo → quemado (negro permanente)
 *   - Circuito abierto → LED apagado
 *   - Polaridad invertida → LED apagado
 */

import * as THREE from "three"
import {
  getComponentPorts,
  getComponentInternalEdges,
  resolveElectricalNodeId,
  BATTERY_VOLTAGE,
  LED_FORWARD_VOLTAGE,
  LED_MIN_CURRENT,
  LED_MAX_SAFE_CURRENT,
  LED_BURN_CURRENT,
} from "../components/CircuitComponent.js"

// ---------------------------
// Estados del LED
// ---------------------------
export const LED_STATE = {
  OFF: "off",
  ON: "on",
  BURNING: "burning",
  BURNED: "burned",
}

// Cuánto tiempo en "burning" antes de quemarse definitivamente (ms)
const BURN_TIME_MS = 2500

// Frecuencia de parpadeo en burning (Hz)
const BURN_FLICKER_HZ = 8

export class ElectricalSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {AppState} appState
   * @param {StateSyncSystem} stateSyncSystem
   * @param {HoleSystem} holeSystem
   */
  constructor(scene, appState, stateSyncSystem, holeSystem) {
    this.scene = scene
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem

    // Cada cuántos ms reconstruir el grafo (no cada frame)
    this.updateIntervalMs = 80
    this._lastUpdateMs = 0

    // Estado visual de cada LED: componentId → { state, burnMs, originalMaterials }
    this._ledStates = new Map()

    // Tiempo acumulado para parpadeo
    this._flickerT = 0
  }

  // ---------------------------
  // API pública
  // ---------------------------

  update(dt) {
    this._flickerT += dt

    const now = performance.now()
    if (now - this._lastUpdateMs >= this.updateIntervalMs) {
      this._lastUpdateMs = now
      this._runSimulation()
    }

    // El parpadeo se actualiza cada frame aunque el grafo no se reconstruya
    this._updateFlicker(dt)
  }

  // ---------------------------
  // Simulación principal
  // ---------------------------

  _runSimulation() {
    const graph = this._buildGraph()
    const results = this._solveGraph(graph)
    this._applyResults(results)
  }

  /**
   * Construye el grafo eléctrico a partir del estado actual.
   *
   * Nodos: puntos eléctricos únicos (groupKey de hole o terminal de batería)
   * Aristas: cables + aristas internas de componentes
   *
   * @returns {{ nodes: Set<string>, edges: Array, components: Array }}
   */
  _buildGraph() {
    const nodes = new Set()
    const edges = []
    const components = []

    if (!this.stateSyncSystem) return { nodes, edges, components }

    // --- Actualizar posiciones de holes ---
    if (this.holeSystem) this.holeSystem.updateWorldPositions()

    // --- Procesar cada componente ---
    for (const [id, mesh] of this.stateSyncSystem.meshById) {
      const type = mesh?.userData?.componentType
      if (!type) continue
      if (type === "wire") continue // los cables se procesan aparte

      const ports = getComponentPorts(mesh)
      const internalEdges = getComponentInternalEdges(mesh)

      // Resolver el nodo eléctrico de cada puerto
      const portNodeMap = {} // portId → nodeId

      for (const port of ports) {
        let nodeId = null

        if (port.kind === "terminal") {
          // Terminal de batería — nodo propio
          nodeId = resolveElectricalNodeId(id, port.anchorId, "terminal", null)

        } else if (port.kind === "pin") {
          // Pin — depende de si está insertado en un hole
          const pinConnections = mesh.userData?.pinConnections
          const holeId = pinConnections?.[port.anchorId]

          if (holeId && this.holeSystem) {
            const hole = this.holeSystem.holes.find((h) => h.id === holeId)
            if (hole) {
              nodeId = resolveElectricalNodeId(id, port.anchorId, "pin", hole.groupKey)
            }
          }

          if (!nodeId) {
            // Pin flotante — no conectado
            nodeId = resolveElectricalNodeId(id, port.anchorId, "pin", null)
          }
        }

        if (nodeId) {
          portNodeMap[port.id] = nodeId
          nodes.add(nodeId)
        }
      }

      // Registrar el componente con sus nodos resueltos
      components.push({
        id,
        type,
        mesh,
        portNodeMap,
        internalEdges,
      })

      // Agregar aristas internas al grafo (excepto batería que es fuente)
      for (const edge of internalEdges) {
        if (edge.isSource) continue // la batería no agrega arista pasiva

        const fromNode = portNodeMap[edge.from]
        const toNode = portNodeMap[edge.to]

        if (fromNode && toNode) {
          edges.push({
            from: fromNode,
            to: toNode,
            resistance: edge.resistance,
            isLED: !!edge.isLED,
            forwardVoltage: edge.forwardVoltage ?? 0,
            componentId: id,
          })
        }
      }
    }

    // --- Procesar cables ---
    for (const [id, mesh] of this.stateSyncSystem.meshById) {
      if (mesh?.userData?.componentType !== "wire") continue
      if (!mesh?.userData?.isWire) continue

      const startAnchor = mesh.userData.startAnchor
      const endAnchor = mesh.userData.endAnchor

      if (!startAnchor || !endAnchor) continue

      const startNode = this._resolveAnchorToNode(startAnchor)
      const endNode = this._resolveAnchorToNode(endAnchor)

      if (!startNode || !endNode) continue
      if (startNode === endNode) continue

      nodes.add(startNode)
      nodes.add(endNode)

      // Cable = resistencia 0 (conductor ideal)
      edges.push({
        from: startNode,
        to: endNode,
        resistance: 0,
        isWire: true,
        componentId: id,
      })
    }

    return { nodes, edges, components }
  }

  /**
   * Convierte un anchor serializado al nodo eléctrico correspondiente.
   */
  _resolveAnchorToNode(anchor) {
    if (!anchor) return null

    if (anchor.kind === "hole" || anchor.kind === "hole") {
      // Anchor es un hole — usar su groupKey
      if (!this.holeSystem) return null
      const hole = this.holeSystem.holes.find(
        (h) => h.id === (anchor.holeId || anchor.id)
      )
      if (!hole) return null
      return `hole_${hole.groupKey}`
    }

    if (anchor.kind === "terminal") {
      return resolveElectricalNodeId(
        anchor.componentId,
        anchor.id,
        "terminal",
        null
      )
    }

    if (anchor.kind === "pin") {
      // Pin en hole — necesitamos el groupKey del hole
      if (!this.holeSystem) return null

      // Buscar el componente y su pinConnection
      const mesh = this.stateSyncSystem?.getMeshById(anchor.componentId)
      const holeId = mesh?.userData?.pinConnections?.[anchor.id]

      if (holeId) {
        const hole = this.holeSystem.holes.find((h) => h.id === holeId)
        if (hole) return `hole_${hole.groupKey}`
      }

      // Pin no insertado — nodo flotante
      return resolveElectricalNodeId(anchor.componentId, anchor.id, "pin", null)
    }

    return null
  }

  /**
   * Resuelve el grafo eléctrico con análisis nodal simplificado.
   *
   * Busca rutas entre el positivo y negativo de cada batería.
   * Para cada ruta, calcula la resistencia total y la corriente.
   *
   * @returns {Array<{componentId: string, current: number, voltage: number, hasResistor: boolean}>}
   */
  _solveGraph({ nodes, edges, components }) {
    const results = []

    // Encontrar baterías
    const batteries = components.filter((c) => c.type === "battery5v")

    for (const battery of batteries) {
      const posNode = battery.portNodeMap["positive"]
      const negNode = battery.portNodeMap["negative"]

      if (!posNode || !negNode) continue

      // Construir mapa de adyacencia (grafo no dirigido)
      const adj = new Map()
      for (const node of nodes) adj.set(node, [])

      for (const edge of edges) {
        if (!adj.has(edge.from)) adj.set(edge.from, [])
        if (!adj.has(edge.to)) adj.set(edge.to, [])

        adj.get(edge.from).push({ node: edge.to, edge })
        adj.get(edge.to).push({ node: edge.from, edge })
      }

      // BFS para encontrar todos los caminos entre positivo y negativo
      const paths = this._findAllPaths(adj, posNode, negNode, 20)

      if (paths.length === 0) continue

      // Para cada camino, calcular la corriente y qué componentes atraviesa
      for (const path of paths) {
        const { totalResistance, ledEdges, resistorEdges, wireEdges } =
          this._analyzePath(path)

        // Voltaje disponible = BATTERY_VOLTAGE - caída en LEDs
        const ledCount = ledEdges.length
        const voltageDropLEDs = ledCount * LED_FORWARD_VOLTAGE
        const availableVoltage = BATTERY_VOLTAGE - voltageDropLEDs

        if (availableVoltage <= 0) continue // imposible encender con tantos LEDs en serie

        // Corriente en el circuito
        const effectiveResistance = Math.max(totalResistance, 0.1) // evitar división por 0
        const current = availableVoltage / effectiveResistance

        const hasResistor = resistorEdges.length > 0

        // Registrar resultado para cada LED en el camino
        for (const ledEdge of ledEdges) {
          results.push({
            componentId: ledEdge.componentId,
            current,
            voltage: availableVoltage,
            hasResistor,
            isConnected: true,
          })
        }
      }
    }

    return results
  }

  /**
   * BFS para encontrar todos los caminos simples entre start y end.
   * maxDepth evita explosión combinatoria.
   */
  _findAllPaths(adj, start, end, maxDepth = 15) {
    const paths = []
    const queue = [{ node: start, path: [], visited: new Set([start]) }]

    while (queue.length > 0) {
      const { node, path, visited } = queue.shift()

      if (node === end) {
        paths.push(path)
        continue
      }

      if (path.length >= maxDepth) continue

      const neighbors = adj.get(node) || []
      for (const { node: next, edge } of neighbors) {
        if (visited.has(next)) continue

        const newVisited = new Set(visited)
        newVisited.add(next)

        queue.push({
          node: next,
          path: [...path, edge],
          visited: newVisited,
        })
      }
    }

    return paths
  }

  /**
   * Analiza un camino y extrae su resistencia total + componentes.
   */
  _analyzePath(pathEdges) {
    let totalResistance = 0
    const ledEdges = []
    const resistorEdges = []
    const wireEdges = []

    for (const edge of pathEdges) {
      totalResistance += edge.resistance ?? 0

      if (edge.isLED) ledEdges.push(edge)
      else if (edge.isWire) wireEdges.push(edge)
      else if (!edge.isLED && !edge.isWire && edge.resistance > 0) resistorEdges.push(edge)
    }

    return { totalResistance, ledEdges, resistorEdges, wireEdges }
  }

  // ---------------------------
  // Aplicar resultados visuales
  // ---------------------------

  _applyResults(results) {
    // Primero: apagar todos los LEDs que no estén en resultados
    const activeLedIds = new Set(results.map((r) => r.componentId))

    for (const [id, mesh] of this.stateSyncSystem.meshById) {
      if (mesh?.userData?.componentType !== "led") continue

      const ledState = this._getLedState(id, mesh)

      // LEDs quemados permanecen quemados
      if (ledState.state === LED_STATE.BURNED) continue

      if (!activeLedIds.has(id)) {
        // LED sin corriente — apagar
        if (ledState.state !== LED_STATE.OFF) {
          this._setLedState(id, mesh, LED_STATE.OFF)
        }
      }
    }

    // Segundo: aplicar resultados
    for (const result of results) {
      const mesh = this.stateSyncSystem.getMeshById(result.componentId)
      if (!mesh) continue
      if (mesh.userData?.componentType !== "led") continue

      const ledState = this._getLedState(result.componentId, mesh)

      // LED quemado — no hacer nada más
      if (ledState.state === LED_STATE.BURNED) continue

      const { current, hasResistor } = result

      if (current < LED_MIN_CURRENT) {
        // Corriente insuficiente — apagado
        this._setLedState(result.componentId, mesh, LED_STATE.OFF)
        continue
      }

      if (!hasResistor && current >= LED_BURN_CURRENT) {
        // Sin resistencia y corriente peligrosa — burning → burned
        if (ledState.state !== LED_STATE.BURNING && ledState.state !== LED_STATE.BURNED) {
          this._setLedState(result.componentId, mesh, LED_STATE.BURNING)
        }
        continue
      }

      if (!hasResistor && current >= LED_MAX_SAFE_CURRENT) {
        // Sin resistencia, corriente alta pero no destruye inmediatamente
        if (ledState.state !== LED_STATE.BURNING && ledState.state !== LED_STATE.BURNED) {
          this._setLedState(result.componentId, mesh, LED_STATE.BURNING)
        }
        continue
      }

      // Corriente normal con resistencia — encender
      if (ledState.state !== LED_STATE.ON) {
        this._setLedState(result.componentId, mesh, LED_STATE.ON)
      }
    }
  }

  // ---------------------------
  // Estado y visual del LED
  // ---------------------------

  _getLedState(id, mesh) {
    if (!this._ledStates.has(id)) {
      this._ledStates.set(id, {
        state: LED_STATE.OFF,
        burnMs: 0,
        mesh,
      })
    }
    return this._ledStates.get(id)
  }

  _setLedState(id, mesh, newState) {
    const ledState = this._getLedState(id, mesh)
    const prevState = ledState.state

    if (prevState === newState) return
    if (prevState === LED_STATE.BURNED) return // quemado es permanente

    ledState.state = newState
    ledState.mesh = mesh

    if (newState === LED_STATE.BURNING) {
      ledState.burnMs = 0
    }

    this._applyLedVisual(mesh, newState)
  }

  _applyLedVisual(mesh, state) {
    // Recorrer todos los meshes del grupo LED
    mesh.traverse((child) => {
      if (!child.isMesh) return
      if (!child.material) return

      // Identificar si es el cuerpo/domo del LED (color rojo)
      // vs las patas (color plateado)
      const isBody = child.material.color
        ? child.material.color.r > 0.5 && child.material.color.g < 0.5
        : false

      const isPlatinumLeg = child.material.color
        ? child.material.color.r > 0.5 && child.material.color.g > 0.5 && child.material.color.b > 0.5
        : false

      if (!isBody && !isPlatinumLeg) return

      // Clonar material si no lo hemos clonado antes para no afectar otras instancias
      if (!child.userData._electricalMaterialCloned) {
        child.material = child.material.clone()
        child.userData._electricalMaterialCloned = true
      }

      const mat = child.material

      switch (state) {
        case LED_STATE.OFF:
          if (isBody) {
            mat.color.setHex(0xff3b3b)
            mat.emissive?.setHex(0x000000)
            mat.emissiveIntensity = 0
          }
          break

        case LED_STATE.ON:
          if (isBody) {
            mat.color.setHex(0xff3b3b)
            mat.emissive?.setHex(0xff2200)
            mat.emissiveIntensity = 1.8
          }
          break

        case LED_STATE.BURNING:
          // El parpadeo se actualiza en _updateFlicker, aquí solo ponemos estado inicial
          if (isBody) {
            mat.color.setHex(0xffffff)
            mat.emissive?.setHex(0xff8800)
            mat.emissiveIntensity = 2.5
          }
          break

        case LED_STATE.BURNED:
          if (isBody) {
            mat.color.setHex(0x1a1a1a)
            mat.emissive?.setHex(0x000000)
            mat.emissiveIntensity = 0
          }
          break
      }
    })
  }

  _updateFlicker(dt) {
    for (const [id, ledState] of this._ledStates) {
      if (ledState.state !== LED_STATE.BURNING) continue

      const mesh = ledState.mesh
      if (!mesh) continue

      // Acumular tiempo en burning
      ledState.burnMs += dt * 1000

      // Si supera el tiempo de quemado → burned permanente
      if (ledState.burnMs >= BURN_TIME_MS) {
        this._setLedState(id, mesh, LED_STATE.BURNED)
        console.warn(`🔥 LED ${id} se ha quemado (sin resistencia)`)
        continue
      }

      // Parpadeo: seno rápido
      const flickerSin = Math.sin(this._flickerT * BURN_FLICKER_HZ * Math.PI * 2)
      const flickerVal = (flickerSin + 1) * 0.5 // 0..1

      // Alternar entre blanco y naranja
      mesh.traverse((child) => {
        if (!child.isMesh || !child.material) return
        if (!child.userData._electricalMaterialCloned) return

        const mat = child.material
        if (!mat.emissive) return

        // Intensidad pulsante
        mat.emissiveIntensity = 1.5 + flickerVal * 2.0

        // Color oscila entre naranja y blanco
        const r = 1.0
        const g = 0.3 + flickerVal * 0.5
        const b = flickerVal * 0.3
        mat.color.setRGB(r, g, b)
        mat.emissive.setRGB(r * 0.8, g * 0.5, 0)
      })
    }
  }

  // ---------------------------
  // Reset
  // ---------------------------

  /**
   * Resetea el estado de todos los LEDs (útil al limpiar escena o cargar estado).
   */
  resetAllLedStates() {
    for (const [id, ledState] of this._ledStates) {
      const mesh = ledState.mesh
      if (mesh) this._applyLedVisual(mesh, LED_STATE.OFF)
    }
    this._ledStates.clear()
  }

  /**
   * Resetea el estado de un LED específico (útil al quitarlo de la protoboard).
   */
  resetLedState(componentId) {
    const ledState = this._ledStates.get(componentId)
    if (!ledState) return

    if (ledState.mesh) this._applyLedVisual(ledState.mesh, LED_STATE.OFF)
    this._ledStates.delete(componentId)
  }
}