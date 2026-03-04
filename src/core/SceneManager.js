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

    // ✅ IMPORTANTE: la cámara base debe ver 0/1/2 siempre
    // (layers 1 y 2 son para raycast, pero también existen en objetos)
    this.camera.layers.enable(0)
    this.camera.layers.enable(1)
    this.camera.layers.enable(2)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    })

    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.xr.enabled = true

    const app = document.getElementById("app")
    if (!app) throw new Error("No existe <div id='app'></div> en index.html")
    app.appendChild(this.renderer.domElement)

    window.addEventListener("resize", this.onResize.bind(this))

    // ✅ Hooks XR para Quest
    this.renderer.xr.addEventListener("sessionstart", () => {
      this.renderer.setPixelRatio(1)
      this.renderer.xr.setFramebufferScaleFactor(1.0)

      // Primer sync al iniciar sesión
      this.syncXRCameraLayers()
    })

    this.renderer.xr.addEventListener("sessionend", () => {
      this.renderer.setPixelRatio(window.devicePixelRatio)
      this.onResize()
    })
  }

  onResize() {
    if (this.renderer.xr.isPresenting) return

    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
  }

  /**
   * ✅ FIX CLAVE:
   * Asegura que la cámara XR (ArrayCamera) y sus sub-cámaras (ojos)
   * tengan la misma máscara de layers que la cámara base.
   * Esto evita el bug: "un ojo ve cubos y el otro mesa".
   */
  syncXRCameraLayers() {
    if (!this.renderer.xr.isPresenting) return

    // Asegurar cámara base con 0/1/2 (por si alguien lo cambia)
    this.camera.layers.enable(0)
    this.camera.layers.enable(1)
    this.camera.layers.enable(2)

    const xrCam = this.renderer.xr.getCamera(this.camera)

    // Copia máscara al ArrayCamera
    if (xrCam?.layers) xrCam.layers.mask = this.camera.layers.mask

    // Copia máscara a cada ojo
    if (xrCam?.isArrayCamera && Array.isArray(xrCam.cameras)) {
      for (const eyeCam of xrCam.cameras) {
        eyeCam.layers.mask = this.camera.layers.mask
      }
    }
  }

  render() {
    // Si algún runtime desincroniza layers por ojo, esto lo corrige cada frame
    this.syncXRCameraLayers()
    this.renderer.render(this.scene, this.camera)
  }
}