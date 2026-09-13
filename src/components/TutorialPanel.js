//TutorialPanel.js
import * as THREE from "three"

// Panel flotante del tutorial: título, instrucción, contador de pasos, botón "Atrás",
// botón principal (Entendido/Listo/Cerrar, solo visible en pasos manuales) y botón para
// saltar. Mismo patrón de canvas+textura usado en el teclado de
// PowerSupplyInteractionSystem. Hecho e implementado por LFTS
export function createTutorialPanel({ position, rotationY = 0, onAdvance, onBack, onSkip }) {
  const group = new THREE.Group()
  group.name = "TutorialPanel"
  group.position.copy(position)
  group.rotation.y = rotationY

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.50, 0.36, 0.015),
    new THREE.MeshStandardMaterial({ color: 0x14202b, roughness: 0.85 })
  )
  group.add(base)

  const canvas = document.createElement("canvas")
  canvas.width = 1024
  canvas.height = 700
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.47, 0.29),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  )
  face.position.set(0, 0.035, 0.009)
  group.add(face)

  function makeButton(label, x, w, color) {
    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.045, 0.016),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
    )
    btn.position.set(x, -0.145, 0.016)

    const labelCanvas = document.createElement("canvas")
    labelCanvas.width = 512
    labelCanvas.height = 128
    const ctx2 = labelCanvas.getContext("2d")
    const draw = (text) => {
      ctx2.clearRect(0, 0, 512, 128)
      ctx2.fillStyle = "#ffffff"
      ctx2.font = "bold 46px Arial"
      ctx2.textAlign = "center"
      ctx2.textBaseline = "middle"
      ctx2.fillText(text, 256, 64)
    }
    draw(label)
    const labelTex = new THREE.CanvasTexture(labelCanvas)
    labelTex.colorSpace = THREE.SRGBColorSpace
    const labelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.02, 0.038),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
    )
    labelMesh.position.z = 0.009
    btn.add(labelMesh)
    btn.userData.isUI = true
    btn.userData._setLabel = (text) => { draw(text); labelTex.needsUpdate = true }
    return btn
  }

  const backButton = makeButton("Atrás", -0.17, 0.13, 0x445566)
  backButton.userData.onPress = () => onBack?.()
  group.add(backButton)

  const primaryButton = makeButton("Entendido", 0, 0.17, 0x217953)
  primaryButton.userData.onPress = () => onAdvance?.()
  group.add(primaryButton)

  const skipButton = makeButton("Saltar", 0.17, 0.13, 0x8a3a3a)
  skipButton.userData.onPress = () => onSkip?.()
  group.add(skipButton)

  function drawContent(ctx2, data) {
    ctx2.fillStyle = "#0f1b24"
    ctx2.fillRect(0, 0, 1024, 700)

    ctx2.fillStyle = "#7fd8ff"
    ctx2.font = "34px Arial"
    ctx2.fillText(`Paso ${data.stepIndex + 1} / ${data.totalSteps}`, 24, 52)

    ctx2.fillStyle = "#ffffff"
    ctx2.font = "bold 54px Arial"
    wrapText(ctx2, data.title, 24, 130, 976, 58)

    ctx2.font = "36px Arial"
    ctx2.fillStyle = "#d8e6ee"
    wrapText(ctx2, data.instruction, 24, 250, 976, 46)
  }

  function wrapText(ctx2, text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ")
    let line = ""
    let curY = y
    for (const word of words) {
      const test = line + word + " "
      if (ctx2.measureText(test).width > maxWidth && line !== "") {
        ctx2.fillText(line, x, curY)
        line = word + " "
        curY += lineHeight
      } else {
        line = test
      }
    }
    ctx2.fillText(line, x, curY)
  }

  function updateContent(data) {
    const ctx2 = canvas.getContext("2d")
    drawContent(ctx2, data)
    texture.needsUpdate = true

    primaryButton.visible = data.manualAdvance
    primaryButton.userData._setLabel(data.primaryLabel)

    backButton.visible = data.canGoBack
  }

  return { group, buttons: [backButton, primaryButton, skipButton], updateContent }
}