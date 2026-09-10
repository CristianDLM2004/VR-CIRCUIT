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

  // Layout actual conservado
  const layout = {
    width,
    depth,
    height,
    topYLocal,

    // Centro
    columns: 60,
    centerRowsPerHalf: 5,
    centerPitchX: 0.015,
    centerPitchZ: 0.015,
    centerGapZ: 0.042,

    // Rails
    railRowsPerSide: 2,
    railPitchZ: 0.015,
    railInsetZ: 0.026,

    // Margen lateral
    sideMarginX: 0.06,
  }

  // ---------------------------
  // Detalles visuales de buses
  // ---------------------------
  const halfW = width / 2
  const halfD = depth / 2

  const topOuterZ = halfD - layout.railInsetZ
  const topInnerZ = topOuterZ - layout.railPitchZ
  const bottomOuterZ = -halfD + layout.railInsetZ
  const bottomInnerZ = bottomOuterZ + layout.railPitchZ

  // Líneas visuales colocadas en los espacios vacíos:
  // - una entre el borde y el 1er bus
  // - otra entre el 2do bus y la zona central
  const topRedLineZ = topOuterZ + layout.railPitchZ * 1.0
  const topBlueLineZ = topInnerZ - layout.railPitchZ * 1.0
  const bottomRedLineZ = bottomInnerZ + layout.railPitchZ * 1.0
  const bottomBlueLineZ = bottomOuterZ - layout.railPitchZ * 1.0

  const lineY = topYLocal + 0.0012
  const symbolY = topYLocal + 0.0014

  const redMat = new THREE.MeshBasicMaterial({ color: 0xe34b4b })
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x4a9fff })

  const lineInsetX = 0.035
  const lineLength = width - lineInsetX * 2
  const lineThicknessY = 0.0008
  const lineThicknessZ = 0.0022

  function addBusLine(z, material) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(lineLength, lineThicknessY, lineThicknessZ),
      material
    )
    line.position.set(0, lineY, z)
    line.renderOrder = 2
    group.add(line)
  }

  function addMinusSymbol(x, z, material) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.010, 0.0008, 0.0024),
      material
    )
    bar.position.set(x, symbolY, z)
    bar.renderOrder = 3
    group.add(bar)
  }

  function addPlusSymbol(x, z, material) {
    const h = new THREE.Mesh(
      new THREE.BoxGeometry(0.010, 0.0008, 0.0024),
      material
    )
    h.position.set(x, symbolY, z)

    const v = new THREE.Mesh(
      new THREE.BoxGeometry(0.0024, 0.0008, 0.010),
      material
    )
    v.position.set(x, symbolY, z)

    h.renderOrder = 3
    v.renderOrder = 3

    group.add(h, v)
  }

  // Líneas como en una protoboard real, pero en los espacios vacíos al lado de los buses
  // Arriba: rojo más al borde, azul hacia adentro
  addBusLine(topRedLineZ, redMat)
  addBusLine(topBlueLineZ, blueMat)

  // Abajo: rojo hacia adentro, azul más al borde
  addBusLine(bottomRedLineZ, redMat)
  addBusLine(bottomBlueLineZ, blueMat)

  // Símbolos a ambos extremos de cada línea
  const leftSymbolX = -halfW + 0.018
  const rightSymbolX = halfW - 0.018

  // Arriba
  addPlusSymbol(leftSymbolX, topRedLineZ, redMat)
  addPlusSymbol(rightSymbolX, topRedLineZ, redMat)
  addMinusSymbol(leftSymbolX, topBlueLineZ, blueMat)
  addMinusSymbol(rightSymbolX, topBlueLineZ, blueMat)

  // Abajo
  addPlusSymbol(leftSymbolX, bottomRedLineZ, redMat)
  addPlusSymbol(rightSymbolX, bottomRedLineZ, redMat)
  addMinusSymbol(leftSymbolX, bottomBlueLineZ, blueMat)
  addMinusSymbol(rightSymbolX, bottomBlueLineZ, blueMat)

  // El mesh “surface” para snap será el base
  const surfaceMesh = base

  return { group, surfaceMesh, layout }
}