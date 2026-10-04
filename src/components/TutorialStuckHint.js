//TutorialStuckHint.js
// Hecho e implementado por LFTS
import * as THREE from "three"

// HUD flotante: se reposiciona cada frame frente a la cámara (no vive en un punto fijo
// del mundo), y tiene su propio botón de cerrar para no estorbar. No usamos un overlay
// HTML/DOM porque no es confiable dentro de una sesión VR inmersiva en el navegador de
// Quest; esto es un plano 3D normal que se comporta como HUD. Hecho e implementado por LFTS
export function createStuckHintOverlay({ onClose }) {
    const group = new THREE.Group()
    group.name = "TutorialStuckHint"
    group.visible = false

    const base = new THREE.Mesh(
        new THREE.PlaneGeometry(0.30, 0.105),
        new THREE.MeshBasicMaterial({ color: 0x1a1400, transparent: true, opacity: 0.92 })
    )
    group.add(base)

    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 224
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.28, 0.098),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    )
    face.position.z = 0.002
    group.add(face)

  const closeButton = new THREE.Mesh(
    new THREE.CircleGeometry(0.015, 16),
    new THREE.MeshStandardMaterial({ color: 0xaa3333 })
  )
  closeButton.position.set(0.135, 0.04, 0.003)
  closeButton.userData.isUI = true
  closeButton.userData._lastPressMs = 0
  closeButton.userData._cooldownMs = 250
  closeButton.userData.onPress = () => {
    const now = performance.now()
    if (now - closeButton.userData._lastPressMs < closeButton.userData._cooldownMs) return
    closeButton.userData._lastPressMs = now
    onClose?.()
  }
  group.add(closeButton)

  const xBar1 = new THREE.Mesh(
    new THREE.PlaneGeometry(0.018, 0.0035),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  )
  xBar1.rotation.z = Math.PI / 4
  xBar1.position.z = 0.001
  const xBar2 = xBar1.clone()
  xBar2.rotation.z = -Math.PI / 4
  closeButton.add(xBar1, xBar2)
    function drawText(text) {
        const ctx = canvas.getContext("2d")
        ctx.fillStyle = "#1a1400"
        ctx.fillRect(0, 0, 640, 224)
        ctx.fillStyle = "#ffd166"
        ctx.font = "28px Arial"
        const words = text.split(" ")
        let line = ""
        let y = 46
        for (const word of words) {
            const test = line + word + " "
            if (ctx.measureText(test).width > 580 && line !== "") {
                ctx.fillText(line, 20, y)
                line = word + " "
                y += 36
            } else {
                line = test
            }
        }
        ctx.fillText(line, 20, y)
        texture.needsUpdate = true
    }

    const _tmpPos = new THREE.Vector3()
    const _tmpQuat = new THREE.Quaternion()
    const _tmpOffset = new THREE.Vector3()

    function updateFollow(camera) {
        camera.getWorldPosition(_tmpPos)
        camera.getWorldQuaternion(_tmpQuat)
        _tmpOffset.set(0.05, -0.10, -0.50).applyQuaternion(_tmpQuat)
        group.position.copy(_tmpPos).add(_tmpOffset)
        group.quaternion.copy(_tmpQuat)
    }

    return { group, closeButton, drawText, updateFollow }
}