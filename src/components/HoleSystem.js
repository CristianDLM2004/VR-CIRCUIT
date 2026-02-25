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
    const halfW = L.width / 2
    const halfD = L.depth / 2

    const usableLeftX = -halfW + L.marginX
    const usableRightX = halfW - L.marginX

    // Centro (canal)
    const gapHalf = L.centerGap / 2

    // Definimos dos rangos: lado izquierdo y lado derecho (evitando el gap central)
    const leftMaxX = -gapHalf
    const rightMinX = gapHalf

    // Z: bloque central alrededor de 0
    const centerMinZ = -(L.rowsCenter - 1) / 2 * L.pitchZ
    const centerMaxZ = +(L.rowsCenter - 1) / 2 * L.pitchZ

    // --- Bloques centrales (izq y der) ---
    const makeCenterBlock = (sideName, xStart, xDir) => {
      for (let c = 0; c < L.colsPerSide; c++) {
        const x = xStart + xDir * c * L.pitchX

        // hard clamp a área usable
        if (x < usableLeftX || x > usableRightX) continue
        if (sideName === "L" && x > leftMaxX) continue
        if (sideName === "R" && x < rightMinX) continue

        for (let r = 0; r < L.rowsCenter; r++) {
          const z = centerMinZ + r * L.pitchZ
          if (z < -halfD + L.marginZ || z > halfD - L.marginZ) continue

          const id = `${sideName}${r + 1}-${c + 1}`
          const localPos = new THREE.Vector3(x, L.topYLocal + 0.001, z)

          // groupKey placeholder para nodos eléctricos después
          // (ej. tiras de 5 por fila). Por ahora agrupamos por r y lado.
          const groupKey = `CENTER_${sideName}_ROW_${r + 1}`

          this.holes.push({
            id,
            localPos,
            worldPos: localPos.clone(),
            groupKey,
          })
        }
      }
    }

    // Lado izquierdo: de cerca del gap hacia la izquierda
    makeCenterBlock("L", -gapHalf - L.pitchX, -1)
    // Lado derecho: de cerca del gap hacia la derecha
    makeCenterBlock("R", gapHalf + L.pitchX, +1)

    // --- Rails (arriba y abajo) ---
    // Dos filas arriba y dos abajo (placeholder)
    const railZs = [
      +L.railOffsetZ,
      +L.railOffsetZ + L.pitchZ,
      -L.railOffsetZ,
      -L.railOffsetZ - L.pitchZ,
    ]

    const railCols = Math.floor((L.width - 2 * L.marginX) / L.pitchX)

    for (let railRow = 0; railRow < railZs.length; railRow++) {
      const z = railZs[railRow]
      for (let c = 0; c < railCols; c++) {
        const x = usableLeftX + c * L.pitchX
        const id = `RAIL${railRow + 1}-${c + 1}`
        const localPos = new THREE.Vector3(x, L.topYLocal + 0.001, z)
        const groupKey = `RAIL_${railRow + 1}`

        this.holes.push({
          id,
          localPos,
          worldPos: localPos.clone(),
          groupKey,
        })
      }
    }
  }

  updateWorldPositions() {
    // Asegura matrices
    this.protoboardGroup.updateMatrixWorld(true)

    for (const h of this.holes) {
      h.worldPos.copy(h.localPos)
      this.protoboardGroup.localToWorld(h.worldPos)
    }
  }

  /**
   * Encuentra el hole más cercano a una posición mundo.
   * @param {THREE.Vector3} worldPos
   * @param {number} maxDist (metros)
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

  /**
   * Intenta snapear un objeto a un hole cercano (solo XZ).
   * Devuelve true si snapeó.
   */
  trySnapObject(object, maxDist = 0.03) {
    if (!object) return false

    // refresca world positions por si el protoboard se moviera
    this.updateWorldPositions()

    const pos = object.position
    const hole = this.getNearestHole(pos, maxDist)
    if (!hole) return false

    pos.x = hole.worldPos.x
    pos.z = hole.worldPos.z
    return true
  }
}