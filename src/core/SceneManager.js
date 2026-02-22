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

        this.renderer = new THREE.WebGLRenderer({ antialias: true })
        this.renderer.setSize(window.innerWidth, window.innerHeight)
        this.renderer.xr.enabled = true

        document.body.appendChild(this.renderer.domElement)

        window.addEventListener("resize", this.onResize.bind(this))
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight
        this.camera.updateProjectionMatrix()
        this.renderer.setSize(window.innerWidth, window.innerHeight)
    }

    render() {
        this.renderer.render(this.scene, this.camera)
    }

}