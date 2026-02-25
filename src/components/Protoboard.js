import * as THREE from "three"

/**
 * Protoboard placeholder + metadata de layout para holes.
 * Devuelve { group, surfaceMesh, layout }
 */
export function createProtoboard(options = {}) {
  const {
    width = 0.9,
    depth = 0.32,
    height = 0.05,
    position = new THREE.Vector3(0, 1.05, -1.0),
  } = options

  const group = new THREE.Group()
  group.name = "Protoboard"

  // Base
  const baseGeo = new THREE.BoxGeometry(width, height, depth)
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.9 })
  const base = new THREE.Mesh(baseGeo, baseMat)
  base.castShadow = false
  base.receiveShadow = true
  base.name = "ProtoboardBase"

  group.add(base)
  group.position.copy(position)

  // Top surface Y (en local)
  const topYLocal = height / 2

  // Layout simple de holes (placeholder):
  // Dos bloques centrales (izq/der) con canal al centro + dos rails arriba/abajo.
  // No es 100% realista aún; lo suficiente para snap + nodos después.
  const layout = {
    width,
    depth,
    height,
    topYLocal,

    // márgenes internos
    marginX: 0.06,
    marginZ: 0.03,

    // canal central (sin holes)
    centerGap: 0.04,

    // separaciones
    pitchX: 0.015, // distancia entre columnas
    pitchZ: 0.015, // distancia entre filas

    // dimensiones de bloques
    colsPerSide: 15, // 15 columnas por lado (placeholder)
    rowsCenter: 10,  // 10 filas en el bloque central (placeholder)

    // rails
    railsRows: 2,    // 2 filas de rail arriba, 2 abajo (en total 4)
    railOffsetZ: 0.11, // qué tan lejos del centro
  }

  // El mesh “surface” para snap (Layer 2) será el base.
  const surfaceMesh = base

  return { group, surfaceMesh, layout }
}