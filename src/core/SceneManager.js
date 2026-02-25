import * as THREE from "three"

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x202020)

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    )
    this.camera.position.set(0, 1.6, 3)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    })

    // ✅ En Quest, pixelRatio alto + XR puede causar glitches; lo controlamos en sessionstart
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.xr.enabled = true

    const app = document.getElementById("app")
    if (!app) throw new Error("No existe <div id='app'></div> en index.html")
    app.appendChild(this.renderer.domElement)

    // ✅ Importante: NO resizes mientras XR está presentando
    window.addEventListener("resize", this.onResize.bind(this))

    // ✅ Hooks XR para evitar “un solo ojo”
    this.renderer.xr.addEventListener("sessionstart", () => {
      // En XR, mejor pixelRatio estable
      this.renderer.setPixelRatio(1)

      // Ayuda a estabilizar el framebuffer en Quest
      this.renderer.xr.setFramebufferScaleFactor(1.0)

      // Reafirma tamaño sin tocar style
      this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    })

    this.renderer.xr.addEventListener("sessionend", () => {
      // Al salir, regresa a pixelRatio normal
      this.renderer.setPixelRatio(window.devicePixelRatio)
      this.onResize()
    })
  }

  onResize() {
    // ✅ Si estás en VR, NO toques size/aspect; puede romper el stereo
    if (this.renderer.xr.isPresenting) return

    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}