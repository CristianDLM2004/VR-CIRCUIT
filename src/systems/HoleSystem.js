import * as THREE from "three"

export class HoleSystem {
  constructor(protoboardGroup, layout) {
    this.protoboardGroup = protoboardGroup
    this.layout = layout

    this.holes = [] // { id, localPos, worldPos, groupKey }
    this._tmpV = new THREE.Vector3()

    this.buildHoles()
    this.updateWorldPositions()
  }

  buildHoles() {
    this.holes.length = 0

    const L = this.layout
    const halfD = L.depth / 2

    // ---------------------------
    // Eje X: 30 columnas a lo largo de toda la protoboard
    // ---------------------------
    const totalCenterSpanX = (L.columns - 1) * L.centerPitchX
    const startX = -totalCenterSpanX / 2

    const xForCol = (colIndex) => startX + colIndex * L.centerPitchX

    // ---------------------------
    // Centro tipo protoboard real:
    // 5 filas arriba + canal + 5 filas abajo
    // Conexión eléctrica por columna de 5 holes
    // ---------------------------
    const halfGap = L.centerGapZ / 2
    const pitchZ = L.centerPitchZ

    // Parte superior del bloque central (f..j)
    const topRowLabels = ["f", "g", "h", "i", "j"]
    const topRowZs = [
      halfGap + pitchZ * 0,
      halfGap + pitchZ * 1,
      halfGap + pitchZ * 2,
      halfGap + pitchZ * 3,
      halfGap + pitchZ * 4,
    ]

    // Parte inferior del bloque central (a..e)
    const bottomRowLabels = ["e", "d", "c", "b", "a"]
    const bottomRowZs = [
      -(halfGap + pitchZ * 0),
      -(halfGap + pitchZ * 1),
      -(halfGap + pitchZ * 2),
      -(halfGap + pitchZ * 3),
      -(halfGap + pitchZ * 4),
    ]

    for (let c = 0; c < L.columns; c++) {
      const x = xForCol(c)

      // Mitad superior
      for (let r = 0; r < topRowLabels.length; r++) {
        const id = `${topRowLabels[r]}${c + 1}`
        const localPos = new THREE.Vector3(x, L.topYLocal + 0.001, topRowZs[r])
        const groupKey = `CENTER_TOP_COL_${c + 1}`

        this.holes.push({
          id,
          localPos,
          worldPos: localPos.clone(),
          groupKey,
        })
      }

      // Mitad inferior
      for (let r = 0; r < bottomRowLabels.length; r++) {
        const id = `${bottomRowLabels[r]}${c + 1}`
        const localPos = new THREE.Vector3(x, L.topYLocal + 0.001, bottomRowZs[r])
        const groupKey = `CENTER_BOTTOM_COL_${c + 1}`

        this.holes.push({
          id,
          localPos,
          worldPos: localPos.clone(),
          groupKey,
        })
      }
    }

    // ---------------------------
    // Rails: 2 arriba y 2 abajo
    // Conexión eléctrica por fila completa
    // Distribución visual tipo protoboard real:
    // arriba: (-) y (+)
    // abajo: (-) y (+)
    // ---------------------------
    const topOuterZ = halfD - L.railInsetZ
    const topInnerZ = topOuterZ - L.railPitchZ

    const bottomOuterZ = -halfD + L.railInsetZ
    const bottomInnerZ = bottomOuterZ + L.railPitchZ

    const railDefs = [
      { idPrefix: "TNEG", z: topOuterZ, groupKey: "RAIL_TOP_NEG" },
      { idPrefix: "TPOS", z: topInnerZ, groupKey: "RAIL_TOP_POS" },
      { idPrefix: "BNEG", z: bottomInnerZ, groupKey: "RAIL_BOTTOM_NEG" },
      { idPrefix: "BPOS", z: bottomOuterZ, groupKey: "RAIL_BOTTOM_POS" },
    ]

    for (const rail of railDefs) {
      for (let c = 0; c < L.columns; c++) {
        const x = xForCol(c)
        const id = `${rail.idPrefix}-${c + 1}`
        const localPos = new THREE.Vector3(x, L.topYLocal + 0.001, rail.z)

        this.holes.push({
          id,
          localPos,
          worldPos: localPos.clone(),
          groupKey: rail.groupKey,
        })
      }
    }
  }

  updateWorldPositions() {
    this.protoboardGroup.updateMatrixWorld(true)

    for (const h of this.holes) {
      h.worldPos.copy(h.localPos)
      this.protoboardGroup.localToWorld(h.worldPos)
    }
  }

  /**
   * Encuentra el hole más cercano a una posición mundo.
   * @param {THREE.Vector3} worldPos
   * @param {number} maxDist
   */
  getNearestHole(worldPos, maxDist = 0.03) {
    let best = null
    let bestD2 = maxDist * maxDist

    for (const h of this.holes) {
      const d2 = h.worldPos.distanceToSquared(worldPos)
      if (d2 < bestD2) {
        bestD2 = d2
        best = h
      }
    }

    return best
  }

  getNearestHolesForPins(pinWorldPositions, maxDist = 0.03) {
    if (!Array.isArray(pinWorldPositions) || pinWorldPositions.length === 0) return []

    this.updateWorldPositions()

    const results = []
    const usedHoleIds = new Set()

    for (const pin of pinWorldPositions) {
      let best = null
      let bestD2 = maxDist * maxDist

      for (const hole of this.holes) {
        if (usedHoleIds.has(hole.id)) continue

        const d2 = hole.worldPos.distanceToSquared(pin.worldPos)
        if (d2 < bestD2) {
          bestD2 = d2
          best = hole
        }
      }

      if (best) {
        usedHoleIds.add(best.id)

        results.push({
          pinId: pin.id,
          pinLabel: pin.label,
          pinWorldPos: pin.worldPos.clone(),
          hole: best,
          distance: Math.sqrt(bestD2),
        })
      } else {
        results.push({
          pinId: pin.id,
          pinLabel: pin.label,
          pinWorldPos: pin.worldPos.clone(),
          hole: null,
          distance: null,
        })
      }
    }

    return results
  }

  /**
   * Intenta snapear un objeto a un hole cercano (solo XZ).
   * Devuelve true si snapeó.
   */
  trySnapObject(object, maxDist = 0.03) {
    if (!object) return false

    this.updateWorldPositions()

    const pos = object.position
    const hole = this.getNearestHole(pos, maxDist)
    if (!hole) return false

    pos.x = hole.worldPos.x
    pos.z = hole.worldPos.z
    return true
  }
}