// Hecho e implementado por LFTS
import * as THREE from "three"

// Carcasa y puntas independientes con la misma interfaz de agarre del laboratorio. Hecho e implementado por LFTS
export function createMultimeterPart(data) {
  const root = new THREE.Group()
  const probe = data.type === "meterProbe"
  root.name = probe ? "PuntaMultimetro" : "Multimetro"
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(...(probe ? [0.020, 0.105, 0.020] : [0.19, 0.25, 0.055])),
    new THREE.MeshStandardMaterial({ color: probe ? (data.meta?.polarity === "red" ? 0xe53935 : 0x202020) : 0xe9ac25 }))
  body.position.y = probe ? 0 : 0.125
  root.add(body)
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(...(probe ? [0.04, 0.12, 0.04] : [0.20, 0.26, 0.065])),
    new THREE.MeshBasicMaterial({ visible: false, depthWrite: false, colorWrite: false }))
  proxy.position.copy(body.position); root.add(proxy)
  root.userData.grabTarget = proxy
  root.userData.surfaceContactObject = body
  root.userData.surfaceUpright = !probe
  root.userData.grabRadius = 0.025
  root.userData.getGrabCenterWorld = () => root.localToWorld(body.position.clone())
  root.userData.getGrabWorldPoints = () => [{ weight: 1, worldPos: root.userData.getGrabCenterWorld() }]
  const textures = []
  if (probe) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.003, 0.038, 12),
      new THREE.MeshStandardMaterial({ color: 0xcbd2d8, metalness: 0.8, roughness: 0.3 }))
    tip.position.y = -0.071; root.add(tip)
    root.userData.probeTip = new THREE.Vector3(0, -0.09, 0)
    root.userData.getProbeTipWorld = () => root.localToWorld(root.userData.probeTip.clone())
  } else {
    const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 384
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.12), new THREE.MeshBasicMaterial({ map: texture }))
    screen.position.set(0, 0.174, 0.029); root.add(screen)
    let previous = ""
    root.userData.showReading = (mode, value, message) => {
      const key = JSON.stringify([mode, value, message]); if (key === previous) return; previous = key
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#17291c"; ctx.fillRect(0, 0, 768, 384)
      ctx.fillStyle = "#c9ffbf"; ctx.textAlign = "center"
      ctx.font = "bold 43px Arial"; ctx.fillText("MULTÍMETRO · " + mode, 384, 65)
      ctx.font = "bold 90px monospace"; ctx.fillText(value, 384, 186)
      ctx.font = "30px Arial"; ctx.fillText(message, 384, 265)
      ctx.font = "26px Arial"; ctx.fillText("Roja (+) · Negra (COM)", 384, 335)
      texture.needsUpdate = true
    }
    root.userData.meterButtons = []
    for (const [i, mode] of ["V", "A", "Ω", "CONT"].entries()) {
      const button = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.015),
        new THREE.MeshStandardMaterial({ color: 0x293542 }))
      button.position.set((i - 1.5) * 0.044, 0.067, 0.035)
      const label = document.createElement("canvas"); label.width = 256; label.height = 128
      const ctx = label.getContext("2d"); ctx.fillStyle = "white"; ctx.textAlign = "center"
      ctx.font = "bold 60px Arial"; ctx.fillText(mode, 128, 85)
      const tex = new THREE.CanvasTexture(label); tex.colorSpace = THREE.SRGBColorSpace; textures.push(tex)
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.025), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
      face.position.z = 0.008; button.add(face)
      button.userData.isUI = true; button.userData.meterMode = mode
      root.add(button); root.userData.meterButtons.push(button)
    }
    root.userData.showReading(data.meta?.mode || "V", "—", "Conecta las dos puntas")
  }
  root.userData.disposeMeter = () => {
    for (const t of textures) t.dispose()
    root.traverse(o => { o.geometry?.dispose(); o.material?.dispose() })
  }
  return root
}
