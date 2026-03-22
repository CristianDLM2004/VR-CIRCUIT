/**
 * ElectricalSystem.js
 *
 * Sistema de simulación eléctrica para VR-CIRCUIT.
 *
 * Correcciones v3:
 * - _resolveAnchorToNode ahora tiene fallback a worldPos cuando pinConnections
 *   no está disponible, buscando el hole más cercano en XZ
 * - _buildGraph también verifica pinConnections actuales del mesh antes de
 *   usar el anchor serializado del cable
 * - Sin traverse en el loop — materiales eléctricos por nombre de mesh
 */

import * as THREE from "three"
import {
  getComponentPorts,
  getComponentInternalEdges,
  resolveElectricalNodeId,
  LED_FORWARD_VOLTAGE,
  LED_MIN_CURRENT,
  LED_MAX_SAFE_CURRENT,
  LED_BURN_CURRENT,
} from "../components/CircuitComponent.js"

export const LED_STATE = {
  OFF: "off",
  ON: "on",
  BURNING: "burning",
  BURNED: "burned",
}

const BURN_TIME_MS = 2500
const BURN_FLICKER_HZ = 8

// Radio XZ para buscar hole más cercano desde worldPos de un anchor
const ANCHOR_HOLE_SNAP_RADIUS_XZ = 0.03

export class ElectricalSystem {
  constructor(scene, appState, stateSyncSystem, holeSystem) {
    this.scene = scene
    this.appState = appState
    this.stateSyncSystem = stateSyncSystem
    this.holeSystem = holeSystem

    this.updateIntervalMs = 80
    this._lastUpdateMs = 0
    this._flickerT = 0

    // componentId → { state, burnMs, bodyMesh, domeMesh, ... }
    this._ledStates = new Map()
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

    this._updateFlicker(dt)
  }

  resetAllLedStates() {
    for (const [, ledState] of this._ledStates) {
      this._restoreLedMaterial(ledState)
    }
    this._ledStates.clear()
  }

  resetLedState(componentId) {
    const ledState = this._ledStates.get(componentId)
    if (!ledState) return
    this._restoreLedMaterial(ledState)
    this._ledStates.delete(componentId)
  }

  // ---------------------------
  // Simulación
  // ---------------------------

  _runSimulation() {
    const graph = this._buildGraph()
    const results = this._solveGraph(graph)
    this._applyResults(results)
  }

  _buildGraph() {
    const nodes = new Set()
    const edges = []
    const components = []

    if (!this.stateSyncSystem) return { nodes, edges, components }
    if (this.holeSystem) this.holeSystem.updateWorldPositions()

    // --- Componentes ---
    for (const [id, mesh] of this.stateSyncSystem.meshById) {
      const type = mesh?.userData?.componentType
      if (!type || type === "wire") continue

      const ports = getComponentPorts(mesh)
      const internalEdges = getComponentInternalEdges(mesh)
      const portNodeMap = {}

      for (const port of ports) {
        let nodeId = null

        if (port.kind === "terminal") {
          nodeId = resolveElectricalNodeId(id, port.anchorId, "terminal", null)

        } else if (port.kind === "pin") {
          // Intentar primero con pinConnections actuales del mesh
          const holeId = mesh.userData?.pinConnections?.[port.anchorId]
          if (holeId && this.holeSystem) {
            const hole = this.holeSystem.holes.find((h) => h.id === holeId)
            if (hole) nodeId = resolveElectricalNodeId(id, port.anchorId, "pin", hole.groupKey)
          }

          // Si no está insertado, nodo flotante
          if (!nodeId) nodeId = resolveElectricalNodeId(id, port.anchorId, "pin", null)
        }

        if (nodeId) {
          portNodeMap[port.id] = nodeId
          nodes.add(nodeId)
        }
      }

      components.push({ id, type, mesh, portNodeMap, internalEdges })

      for (const edge of internalEdges) {
        if (edge.isSource) continue
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

    // --- Cables ---
    for (const [, mesh] of this.stateSyncSystem.meshById) {
      if (mesh?.userData?.componentType !== "wire") continue
      if (!mesh?.userData?.isWire) continue

      const startAnchor = mesh.userData.startAnchor
      const endAnchor = mesh.userData.endAnchor
      if (!startAnchor || !endAnchor) continue

      const startNode = this._resolveAnchorToNode(startAnchor)
      const endNode = this._resolveAnchorToNode(endAnchor)

      if (!startNode || !endNode || startNode === endNode) continue

      nodes.add(startNode)
      nodes.add(endNode)
      edges.push({
        from: startNode,
        to: endNode,
        resistance: 0,
        isWire: true,
      })
    }

    return { nodes, edges, components }
  }

  /**
   * Resuelve un anchor serializado a un nodo eléctrico.
   *
   * Orden de resolución:
   * 1. Si es hole → groupKey del hole
   * 2. Si es terminal → nodo de terminal de batería
   * 3. Si es pin → pinConnections actuales del mesh
   * 4. Si es pin y no hay pinConnections → buscar hole más cercano por worldPos (fallback)
   * 5. Si nada → nodo flotante
   */
  _resolveAnchorToNode(anchor) {
    if (!anchor) return null

    // --- Hole directo ---
    if (anchor.kind === "hole") {
      if (!this.holeSystem) return null
      const hole = this.holeSystem.holes.find(
        (h) => h.id === (anchor.holeId || anchor.id)
      )
      if (!hole) return null
      return `hole_${hole.groupKey}`
    }

    // --- Terminal de batería ---
    if (anchor.kind === "terminal") {
      if (!anchor.componentId) return null
      return resolveElectricalNodeId(anchor.componentId, anchor.id, "terminal", null)
    }

    // --- Pin de componente ---
    if (anchor.kind === "pin") {
      if (!anchor.componentId) return null

      // Intentar con pinConnections actuales del mesh
      const mesh = this.stateSyncSystem?.getMeshById(anchor.componentId)
      if (mesh) {
        const holeId = mesh.userData?.pinConnections?.[anchor.id]
        if (holeId && this.holeSystem) {
          const hole = this.holeSystem.holes.find((h) => h.id === holeId)
          if (hole) return `hole_${hole.groupKey}`
        }
      }

      // Fallback: buscar hole más cercano por worldPos del anchor
      // Útil cuando el cable se conectó al pin antes de insertar el componente
      // o cuando el anchor.worldPos apunta al pin que ya está sobre un hole
      if (anchor.worldPos && this.holeSystem) {
        const anchorPos = new THREE.Vector3(
          anchor.worldPos.x,
          anchor.worldPos.y,
          anchor.worldPos.z
        )
        const nearestHole = this._findNearestHoleXZ(anchorPos, ANCHOR_HOLE_SNAP_RADIUS_XZ)
        if (nearestHole) return `hole_${nearestHole.groupKey}`
      }

      // Sin hole → nodo flotante (no participa en el circuito)
      return resolveElectricalNodeId(anchor.componentId, anchor.id, "pin", null)
    }

    return null
  }

  /**
   * Encuentra el hole más cercano en XZ (ignora diferencia de altura).
   * Útil para pins de componentes insertados donde Y puede diferir.
   */
  _findNearestHoleXZ(worldPos, maxDistXZ) {
    if (!this.holeSystem) return null

    let best = null
    let bestDist = maxDistXZ

    for (const hole of this.holeSystem.holes) {
      const dx = hole.worldPos.x - worldPos.x
      const dz = hole.worldPos.z - worldPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < bestDist) {
        bestDist = dist
        best = hole
      }
    }

    return best
  }

  // ---------------------------
  // Resolver grafo
  // ---------------------------

  _solveGraph({ nodes, edges, components }) {
    const results = []
    const batteries = components.filter((c) => c.type === "battery5v")

    for (const battery of batteries) {
      const posNode = battery.portNodeMap["positive"]
      const negNode = battery.portNodeMap["negative"]
      if (!posNode || !negNode) continue

      // Construir adyacencia
      const adj = new Map()
      for (const node of nodes) adj.set(node, [])

      for (const edge of edges) {
        if (!adj.has(edge.from)) adj.set(edge.from, [])
        if (!adj.has(edge.to)) adj.set(edge.to, [])
        adj.get(edge.from).push({ node: edge.to, edge })
        adj.get(edge.to).push({ node: edge.from, edge })
      }

      const paths = this._findAllPaths(adj, posNode, negNode, 20)
      if (paths.length === 0) continue

      for (const path of paths) {
        const { totalResistance, ledEdges, resistorEdges } = this._analyzePath(path)

        const voltageDropLEDs = ledEdges.length * LED_FORWARD_VOLTAGE
        const availableVoltage = 5.0 - voltageDropLEDs
        if (availableVoltage <= 0) continue

        const effectiveResistance = Math.max(totalResistance, 0.1)
        const current = availableVoltage / effectiveResistance
        const hasResistor = resistorEdges.length > 0

        for (const ledEdge of ledEdges) {
          results.push({
            componentId: ledEdge.componentId,
            current,
            hasResistor,
          })
        }
      }
    }

    return results
  }

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

      for (const { node: next, edge } of (adj.get(node) || [])) {
        if (visited.has(next)) continue
        const newVisited = new Set(visited)
        newVisited.add(next)
        queue.push({ node: next, path: [...path, edge], visited: newVisited })
      }
    }

    return paths
  }

  _analyzePath(pathEdges) {
    let totalResistance = 0
    const ledEdges = []
    const resistorEdges = []
    const wireEdges = []

    for (const edge of pathEdges) {
      totalResistance += edge.resistance ?? 0
      if (edge.isLED) ledEdges.push(edge)
      else if (edge.isWire) wireEdges.push(edge)
      else if (edge.resistance > 0) resistorEdges.push(edge)
    }

    return { totalResistance, ledEdges, resistorEdges, wireEdges }
  }

  // ---------------------------
  // Aplicar resultados visuales
  // ---------------------------

  _applyResults(results) {
    const activeLedIds = new Set(results.map((r) => r.componentId))

    // Apagar LEDs sin corriente
    for (const [id, mesh] of this.stateSyncSystem.meshById) {
      if (mesh?.userData?.componentType !== "led") continue
      const ledState = this._getLedState(id, mesh)
      if (ledState.state === LED_STATE.BURNED) continue
      if (!activeLedIds.has(id) && ledState.state !== LED_STATE.OFF) {
        this._setLedState(id, mesh, LED_STATE.OFF)
      }
    }

    // Aplicar corriente a LEDs activos
    for (const result of results) {
      const mesh = this.stateSyncSystem.getMeshById(result.componentId)
      if (!mesh || mesh.userData?.componentType !== "led") continue

      const ledState = this._getLedState(result.componentId, mesh)
      if (ledState.state === LED_STATE.BURNED) continue

      const { current, hasResistor } = result

      if (current < LED_MIN_CURRENT) {
        this._setLedState(result.componentId, mesh, LED_STATE.OFF)
        continue
      }

      if (!hasResistor && current >= LED_BURN_CURRENT) {
        if (ledState.state !== LED_STATE.BURNING) {
          this._setLedState(result.componentId, mesh, LED_STATE.BURNING)
        }
        continue
      }

      if (!hasResistor && current >= LED_MAX_SAFE_CURRENT) {
        if (ledState.state !== LED_STATE.BURNING) {
          this._setLedState(result.componentId, mesh, LED_STATE.BURNING)
        }
        continue
      }

      if (ledState.state !== LED_STATE.ON) {
        this._setLedState(result.componentId, mesh, LED_STATE.ON)
      }
    }
  }

  // ---------------------------
  // Estado del LED
  // ---------------------------

  _getLedState(id, mesh) {
    if (!this._ledStates.has(id)) {
      let bodyMesh = null
      let domeMesh = null

      // Buscar una sola vez por nombre
      mesh.traverse((child) => {
        if (child.name === "LEDBody") bodyMesh = child
        if (child.name === "LEDDome") domeMesh = child
      })

      this._ledStates.set(id, {
        state: LED_STATE.OFF,
        burnMs: 0,
        mesh,
        bodyMesh,
        domeMesh,
        bodyElecMat: null,
        domeElecMat: null,
        bodyOrigMat: null,
        domeOrigMat: null,
      })
    }
    return this._ledStates.get(id)
  }

  _setLedState(id, mesh, newState) {
    const ledState = this._getLedState(id, mesh)
    if (ledState.state === newState) return
    if (ledState.state === LED_STATE.BURNED) return

    ledState.state = newState
    if (newState === LED_STATE.BURNING) ledState.burnMs = 0

    this._applyLedVisual(ledState, newState)
  }

  _applyLedVisual(ledState, state) {
    const { bodyMesh, domeMesh } = ledState
    if (!bodyMesh && !domeMesh) return

    if (state === LED_STATE.OFF) {
      this._restoreLedMaterial(ledState)
      return
    }

    // Clonar materiales una sola vez
    if (bodyMesh && !ledState.bodyElecMat) {
      ledState.bodyOrigMat = bodyMesh.material
      ledState.bodyElecMat = bodyMesh.material.clone()
      bodyMesh.material = ledState.bodyElecMat
    }
    if (domeMesh && !ledState.domeElecMat) {
      ledState.domeOrigMat = domeMesh.material
      ledState.domeElecMat = domeMesh.material.clone()
      domeMesh.material = ledState.domeElecMat
    }

    switch (state) {
      case LED_STATE.ON:
        if (ledState.bodyElecMat) {
          ledState.bodyElecMat.color.setHex(0xff3b3b)
          ledState.bodyElecMat.emissive?.setHex(0xff2200)
          ledState.bodyElecMat.emissiveIntensity = 1.8
        }
        if (ledState.domeElecMat) {
          ledState.domeElecMat.color.setHex(0xff3b3b)
          ledState.domeElecMat.emissive?.setHex(0xff2200)
          ledState.domeElecMat.emissiveIntensity = 1.8
        }
        break

      case LED_STATE.BURNING:
        if (ledState.bodyElecMat) {
          ledState.bodyElecMat.color.setHex(0xffffff)
          ledState.bodyElecMat.emissive?.setHex(0xff8800)
          ledState.bodyElecMat.emissiveIntensity = 2.5
        }
        if (ledState.domeElecMat) {
          ledState.domeElecMat.color.setHex(0xffffff)
          ledState.domeElecMat.emissive?.setHex(0xff8800)
          ledState.domeElecMat.emissiveIntensity = 2.5
        }
        break

      case LED_STATE.BURNED:
        if (ledState.bodyElecMat) {
          ledState.bodyElecMat.color.setHex(0x1a1a1a)
          ledState.bodyElecMat.emissive?.setHex(0x000000)
          ledState.bodyElecMat.emissiveIntensity = 0
        }
        if (ledState.domeElecMat) {
          ledState.domeElecMat.color.setHex(0x1a1a1a)
          ledState.domeElecMat.emissive?.setHex(0x000000)
          ledState.domeElecMat.emissiveIntensity = 0
        }
        break
    }
  }

  _restoreLedMaterial(ledState) {
    if (ledState.bodyMesh && ledState.bodyOrigMat) {
      ledState.bodyMesh.material = ledState.bodyOrigMat
      ledState.bodyElecMat = null
    }
    if (ledState.domeMesh && ledState.domeOrigMat) {
      ledState.domeMesh.material = ledState.domeOrigMat
      ledState.domeElecMat = null
    }
  }

  // ---------------------------
  // Parpadeo burning
  // ---------------------------

  _updateFlicker(dt) {
    for (const [id, ledState] of this._ledStates) {
      if (ledState.state !== LED_STATE.BURNING) continue

      ledState.burnMs += dt * 1000

      if (ledState.burnMs >= BURN_TIME_MS) {
        this._setLedState(id, ledState.mesh, LED_STATE.BURNED)
        console.warn(`🔥 LED ${id} quemado (sin resistencia)`)
        continue
      }

      const flickerSin = Math.sin(this._flickerT * BURN_FLICKER_HZ * Math.PI * 2)
      const flickerVal = (flickerSin + 1) * 0.5

      const r = 1.0
      const g = 0.3 + flickerVal * 0.5
      const b = flickerVal * 0.3

      if (ledState.bodyElecMat) {
        ledState.bodyElecMat.color.setRGB(r, g, b)
        ledState.bodyElecMat.emissive?.setRGB(r * 0.8, g * 0.5, 0)
        ledState.bodyElecMat.emissiveIntensity = 1.5 + flickerVal * 2.0
      }
      if (ledState.domeElecMat) {
        ledState.domeElecMat.color.setRGB(r, g, b)
        ledState.domeElecMat.emissive?.setRGB(r * 0.8, g * 0.5, 0)
        ledState.domeElecMat.emissiveIntensity = 1.5 + flickerVal * 2.0
      }
    }
  }
}