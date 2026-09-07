// Hecho e implementado por LFTS
import * as THREE from "three"
import { measureMultimeter } from "./MultimeterMeasurement.js"

export class MultimeterSystem {
  constructor(scene, appState, sync, interaction) {
    Object.assign(this, { scene, appState, sync, interaction })
    this.cables = new Map()
    this.markers = new Map()
    this.audio = null
    this.oscillator = null
    this.lastBeep = false
    this.lastReading = 0
    this.alerts = []
    interaction.renderer.xr.addEventListener("sessionend", () => this.beep(false))
  }

  // Crear un instrumento y dos componentes agarrables, guardados en AppState. Hecho e implementado por LFTS
  spawn(position) {
    const id = crypto.randomUUID()
    const parts = [
      { id, type: "multimeter", meta: { mode: "V" }, offset: new THREE.Vector3() },
      ...["red", "black"].map((polarity, i) => ({ id: crypto.randomUUID(), type: "meterProbe",
        meta: { meterId: id, polarity, anchor: null }, offset: new THREE.Vector3(0.16 + i * 0.07, 0.16, 0) })),
    ]
    for (const part of parts) {
      const p = position.clone().add(part.offset)
      const data = { id: part.id, type: part.type, meta: part.meta, transform: { x:p.x, y:p.y, z:p.z, qx:0, qy:0, qz:0, qw:1 } }
      this.appState.addComponent(data)
      const mesh = this.sync.addMeshFromComponent(data)
      if (part.type === "multimeter") this.interaction.tryPlaceObjectDirectly(mesh)
    }
    return id
  }

  register(root) {
    for (const button of root.userData.meterButtons || []) {
      button.userData.onPress = () => {
        const c = this.appState.components.find(c => c.id === root.userData.componentId)
        if (!c) return
        const meta = { ...c.meta, mode: button.userData.meterMode }
        this.appState.updateComponent(c.id, { meta }); root.userData.meta = meta
        this.lastReading = 0
        if (!this.audio && (window.AudioContext || window.webkitAudioContext)) {
          this.audio = new (window.AudioContext || window.webkitAudioContext)()
        }
        this.audio?.resume().catch(() => {})
      }
      this.interaction.register(button)
    }
  }

  unregister(root) {
    for (const button of root.userData.meterButtons || []) this.interaction.unregister(button)
    this.beep(false)
  }

  detach(root) {
    if (root.userData.componentType !== "meterProbe") return
    const c = this.appState.components.find(c => c.id === root.userData.componentId)
    if (!c) return
    const meta = { ...c.meta, anchor: null }
    this.appState.updateComponent(c.id, { meta }); root.userData.meta = meta
  }

  // Solo el extremo metálico selecciona el contacto; el mango sigue siendo agarrable. Hecho e implementado por LFTS
  nearest(root) {
    const tip = root.userData.getProbeTipWorld()
    let result = null, distance = 0.025
    const consider = (anchor, point) => {
      const d = point.distanceTo(tip)
      if (d < distance) { distance = d; result = { anchor, point } }
    }
    this.interaction.holeSystem?.updateWorldPositions()
    for (const hole of this.interaction.holeSystem?.holes || []) {
      consider({ kind: "hole", holeId: hole.id }, hole.worldPos)
    }
    for (const mesh of this.sync.meshById.values()) {
      if (mesh === root) continue
      for (const a of mesh.userData.getConnectionAnchors?.() || []) {
        consider({ kind: a.kind, id: a.id, componentId: mesh.userData.componentId }, a.worldPos)
      }
    }
    return result
  }

  release(root) {
    if (root.userData.componentType !== "meterProbe") return false
    const target = this.nearest(root)
    if (!target) return false
    const c = this.appState.components.find(c => c.id === root.userData.componentId)
    const meta = { ...c.meta, anchor: target.anchor }
    this.appState.updateComponent(c.id, { meta }); root.userData.meta = meta
    root.position.add(target.point.clone().sub(root.userData.getProbeTipWorld()))
    root.updateMatrixWorld(true)
    root.userData.physics = null
    this.interaction.persistMeshTransform(root)
    return true
  }

  beep(on) {
    if (on && this.audio?.state !== "running") on = false
    if (on === this.lastBeep) return
    this.lastBeep = on
    if (this.oscillator) { this.oscillator.stop(); this.oscillator.disconnect(); this.oscillator = null }
    if (on && this.audio?.state === "running") {
      const oscillator = this.audio.createOscillator(), gain = this.audio.createGain()
      oscillator.frequency.value = 1800; gain.gain.value = 0.025
      oscillator.connect(gain); gain.connect(this.audio.destination); oscillator.start()
      oscillator.onended = () => gain.disconnect()
      this.oscillator = oscillator
    }
  }

  update(graph) {
    const components = [...this.appState.components]
    const ids = new Set(components.map(c => c.id))
    for (const c of components) {
      if (c.type !== "meterProbe") continue
      if (!ids.has(c.meta?.meterId)) {
        this.appState.removeComponent(c.id); this.sync.removeMeshById(c.id); continue
      }
      const root = this.sync.getMeshById(c.id), meter = this.sync.getMeshById(c.meta.meterId)
      if (!root || !meter) continue
      let marker = this.markers.get(c.id)
      if (!marker) {
        marker = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0x55ff99 }))
        this.scene.add(marker); this.markers.set(c.id, marker)
      }
      const candidate = root.userData.heldBy ? this.nearest(root) : null
      marker.visible = !!candidate
      if (candidate) marker.position.copy(candidate.point)
      if (c.meta.anchor && !root.userData.heldBy) {
        const position = this.interaction.resolveAnchorWorldPosition(c.meta.anchor)
        if (position) {
          root.position.add(position.sub(root.userData.getProbeTipWorld()))
          root.updateMatrixWorld(true); root.userData.physics = null
          this.interaction.persistMeshTransform(root)
        } else {
          this.detach(root)
          root.userData.physics = { active: true, vel: new THREE.Vector3() }
        }
      }
      const start = meter.localToWorld(new THREE.Vector3(c.meta.polarity === "red" ? 0.04 : -0.04, 0.025, 0.03))
      const end = root.localToWorld(new THREE.Vector3(0, 0.052, 0))
      let cable = this.cables.get(c.id)
      if (!cable) {
        cable = new THREE.Mesh(new THREE.BufferGeometry(),
          new THREE.MeshStandardMaterial({ color: c.meta.polarity === "red" ? 0xff2a2a : 0x161616, roughness: 0.7 }))
        this.scene.add(cable); this.cables.set(c.id, cable)
      }
      // Grosor visible en XR; reconstruir únicamente cuando se mueve un extremo. Hecho e implementado por LFTS
      if (!cable.userData.start || cable.userData.start.distanceToSquared(start) > 1e-8 || cable.userData.end.distanceToSquared(end) > 1e-8) {
        const midpoint = start.clone().add(end).multiplyScalar(0.5); midpoint.y -= Math.min(0.16, start.distanceTo(end) * 0.3)
        const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end)
        cable.geometry.dispose()
        cable.geometry = new THREE.TubeGeometry(curve, 24, 0.002, 6, false)
        cable.userData.start = start.clone(); cable.userData.end = end.clone()
      }
    }
    const liveIds = new Set(this.appState.components.map(c => c.id))
    for (const [id, cable] of this.cables) if (!liveIds.has(id)) {
      this.scene.remove(cable); cable.geometry.dispose(); cable.material.dispose(); this.cables.delete(id)
    }
    for (const [id, marker] of this.markers) if (!liveIds.has(id)) {
      this.scene.remove(marker); marker.geometry.dispose(); marker.material.dispose(); this.markers.delete(id)
    }
    if (!graph || performance.now() - this.lastReading < 100) return
    this.lastReading = performance.now()
    this.alerts = []
    let sound = false
    for (const meter of this.appState.components.filter(c => c.type === "multimeter")) {
      const reading = measureMultimeter(meter, this.appState.components, this.interaction.holeSystem, this.sync, graph)
      this.sync.getMeshById(meter.id)?.userData.showReading(meter.meta?.mode || "V", reading.value, reading.message)
      if (reading.value === "ERROR" || (reading.value === "OL" && meter.meta?.mode === "A")) this.alerts.push("Multímetro: " + reading.message)
      sound ||= !!reading.beep
    }
    this.beep(sound && this.interaction.renderer.xr.isPresenting)
  }
}
