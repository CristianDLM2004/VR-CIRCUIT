import * as THREE from "three"

function makeTextTexture(text, width = 256, height = 128) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = "#ffffff"
  ctx.font = "bold 42px Arial"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}