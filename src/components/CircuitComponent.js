/**
 * CircuitComponent.js
 *
 * Define cómo cada tipo de componente se traduce a nodos y aristas
 * dentro del grafo eléctrico del ElectricalSystem.
 *
 * Un "nodo eléctrico" es un punto de conexión con voltaje asignable.
 * Una "arista interna" es la relación entre los nodos de un mismo componente.
 *
 * Tipos soportados:
 *   battery5v  — fuente de voltaje fijo (5V entre positivo y negativo)
 *   led        — carga con caída de voltaje (~2V), requiere corriente mínima
 *   resistor   — elemento resistivo (limita corriente)
 *   wire       — conductor ideal (resistencia 0)
 */

// ---------------------------
// Constantes eléctricas
// ---------------------------

export const BATTERY_VOLTAGE = 5.0       // V — voltaje nominal de la batería
export const LED_FORWARD_VOLTAGE = 2.0   // V — caída de voltaje del LED
export const LED_MIN_CURRENT = 0.001     // A — corriente mínima para encender (1 mA)
export const LED_MAX_SAFE_CURRENT = 0.02 // A — corriente máxima sin resistencia (20 mA)
export const LED_BURN_CURRENT = 0.035    // A — corriente a partir de la cual se quema (35 mA)
export const DEFAULT_RESISTANCE = 220    // Ω — resistencia por defecto si no se especifica

// ---------------------------
// Resolución de nodos por componente
// ---------------------------

/**
 * Dado un mesh de componente, devuelve sus "puertos" eléctricos.
 * Cada puerto tiene:
 *   - id: string único dentro del componente
 *   - anchorId: el id del anchor (terminal o pin) al que está conectado
 *   - kind: "terminal" | "pin"
 *
 * @param {THREE.Object3D} mesh
 * @returns {Array<{id: string, anchorId: string, kind: string}>}
 */
export function getComponentPorts(mesh) {
  const type = mesh?.userData?.componentType
  if (!type) return []

  switch (type) {
    case "battery5v":
      return [
        { id: "positive", anchorId: "positive", kind: "terminal" },
        { id: "negative", anchorId: "negative", kind: "terminal" },
      ]

    case "led":
      return [
        { id: "anode", anchorId: "anode", kind: "pin" },
        { id: "cathode", anchorId: "cathode", kind: "pin" },
      ]

    case "resistor":
      return [
        { id: "left", anchorId: "left", kind: "pin" },
        { id: "right", anchorId: "right", kind: "pin" },
      ]

    default:
      return []
  }
}

/**
 * Dado un mesh de componente, devuelve sus aristas internas.
 * Una arista interna conecta dos puertos del mismo componente
 * con una resistencia interna dada.
 *
 * Para la batería: NO hay arista interna pasiva — es una fuente de voltaje.
 * Para el LED: hay una arista interna de ánodo→cátodo con resistencia dinámica.
 * Para la resistencia: hay una arista interna de left→right con resistencia fija.
 *
 * @param {THREE.Object3D} mesh
 * @returns {Array<{from: string, to: string, resistance: number, isSource: boolean, voltage: number}>}
 */
export function getComponentInternalEdges(mesh) {
  const type = mesh?.userData?.componentType
  if (!type) return []

  switch (type) {
    case "battery5v":
      // La batería es una fuente de voltaje ideal entre positivo y negativo
      return [
        {
          from: "positive",
          to: "negative",
          isSource: true,
          voltage: BATTERY_VOLTAGE,
          resistance: 0,
        },
      ]

    case "led":
      // El LED tiene una resistencia interna muy baja — la caída de voltaje
      // se modela como una fuente de voltaje opuesta + resistencia interna pequeña
      return [
        {
          from: "anode",
          to: "cathode",
          isSource: false,
          voltage: 0,
          resistance: 50, // Ω — resistencia interna baja del LED
          isLED: true,
          forwardVoltage: LED_FORWARD_VOLTAGE,
        },
      ]

    case "resistor": {
      const resistance = mesh?.userData?.meta?.resistance ?? DEFAULT_RESISTANCE
      return [
        {
          from: "left",
          to: "right",
          isSource: false,
          voltage: 0,
          resistance,
        },
      ]
    }

    default:
      return []
  }
}

/**
 * Obtiene el identificador de nodo eléctrico global para un anchor de un componente.
 * El nodo global es la unión de todos los anchors del mismo groupKey eléctrico.
 *
 * Para pins en holes: el nodo es el groupKey del hole
 * Para terminales de batería: el nodo es `battery_{componentId}_{terminalId}`
 *
 * @param {string} componentId
 * @param {string} anchorId
 * @param {string} kind — "terminal" | "pin"
 * @param {string|null} holeGroupKey — si es pin insertado en hole, el groupKey del hole
 * @returns {string}
 */
export function resolveElectricalNodeId(componentId, anchorId, kind, holeGroupKey = null) {
  if (kind === "terminal") {
    // Las terminales de batería tienen su propio nodo global
    return `terminal_${componentId}_${anchorId}`
  }

  if (kind === "pin" && holeGroupKey) {
    // Los pines insertados en holes comparten nodo con todos los del mismo groupKey
    return `hole_${holeGroupKey}`
  }

  // Pin no insertado — nodo flotante
  return `floating_${componentId}_${anchorId}`
}