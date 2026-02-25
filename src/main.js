import './style.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const app = document.querySelector('#app')
if (!app) {
  throw new Error('No se encontró el div #app. Revisa index.html')
}

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
app.appendChild(renderer.domElement)

// Scene
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x222222)

// Camera
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
)
camera.position.set(0, 1.2, 2.5)

// Controls (para mover con mouse)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.8, 0)
controls.update()

// Lights
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))

const dir = new THREE.DirectionalLight(0xffffff, 1.2)
dir.position.set(3, 5, 2)
scene.add(dir)

// Floor (referencia)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 0x333333 })
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

// Load GLB
const loader = new GLTFLoader()
loader.load(
  '/models/protoboard_elecronic.glb',
  (gltf) => {
    const model = gltf.scene

    // Si no se ve o sale gigante, prueba 0.1 / 0.01 / 0.001
    model.scale.set(1, 1, 1)
    model.position.set(0, 0.75, 0)
    model.rotation.set(0, 0, 0)

    scene.add(model)
    console.log('✅ Protoboard cargado (GLB)')
  },
  undefined,
  (err) => {
    console.error('❌ Error cargando GLB:', err)
  }
)

// Resize
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

// FPS en consola (cada ~1s)
let last = performance.now()
let frames = 0

function animate() {
  requestAnimationFrame(animate)

  frames++
  const now = performance.now()
  if (now - last > 1000) {
    const fps = (frames * 1000) / (now - last)
    console.log(`FPS: ${fps.toFixed(1)}`)
    frames = 0
    last = now
  }

  renderer.render(scene, camera)
}

animate()