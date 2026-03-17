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

  // Layout más cercano a una protoboard real:
  // - 30 columnas a lo largo
  // - bloque central dividido en dos mitades horizontales (5 filas arriba y 5 abajo)
  // - canal central horizontal
  // - 2 rails arriba y 2 abajo
  const layout = {
    width,
    depth,
    height,
    topYLocal,

    // Centro
    columns: 30,
    centerRowsPerHalf: 5,
    centerPitchX: 0.0265,
    centerPitchZ: 0.015,
    centerGapZ: 0.042,

    // Rails
    railRowsPerSide: 2,
    railPitchZ: 0.015,
    railInsetZ: 0.026,

    // Margen lateral para dejar "marco" visual
    sideMarginX: 0.06,
  }

  // El mesh “surface” para snap será el base
  const surfaceMesh = base

  return { group, surfaceMesh, layout }
}