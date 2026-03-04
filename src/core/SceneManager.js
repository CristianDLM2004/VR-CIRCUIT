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

    // ✅ Para que el render NO dependa de layers de raycast
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

    this.renderer.xr.addEventListener("sessionstart", () => {
      this.renderer.setPixelRatio(1)
      this.renderer.xr.setFramebufferScaleFactor(1.0)

      // ✅ Asegurar que las 2 cámaras XR hereden el mismo layers.mask
      const xrCam = this.renderer.xr.getCamera(this.camera)
      if (xrCam?.isArrayCamera && Array.isArray(xrCam.cameras)) {
        for (const c of xrCam.cameras) {
          c.layers.mask = this.camera.layers.mask
        }
      }
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

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}