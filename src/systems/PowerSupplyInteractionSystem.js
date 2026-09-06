// Hecho e implementado por LFTS
import * as THREE from "three"
import { SUPPLY_FIELDS, normalizeSupplyValue, parseSupplyInput, supplySettings } from "../core/PowerSupplySettings.js"

// Control exclusivo de perillas y teclado; los valores siempre se escriben primero en AppState. Hecho e implementado por LFTS
export class PowerSupplyInteractionSystem {
  constructor(interaction, appState, stateSync, onOpen = () => {}) {
    this.interaction = interaction
    this.appState = appState
    this.stateSync = stateSync
    this.scene = interaction.scene
    this.onOpen = onOpen
    this.drags = new Map()
    this.handLatch = new Map()
    this.handInputCaptured = new WeakSet()
    this.keyboard = null
    this.raycaster = new THREE.Raycaster()
    this.box = new THREE.Box3()
    this.onKey = e => {
      if (!this.keyboard || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      this.key(e.key)
    }
    window.addEventListener("keydown", this.onKey)
    interaction.renderer.xr.addEventListener("sessionend", () => this.cancel())
    for (const ctrl of interaction.controllers) {
      ctrl.addEventListener("connected", event => { ctrl.userData.supplyInputSource = event.data })
      ctrl.addEventListener("disconnected", () => {
        delete ctrl.userData.supplyInputSource
        this.endDrag(ctrl)
      })
    }
  }

  roots() {
    return [...this.stateSync.meshById.values()].filter(m => m.userData.componentType === "powerSupply"
      && m.parent === this.scene && (!m.userData.heldBy || String(m.userData.heldBy).startsWith("supply:")))
  }

  visible(object) {
    for (let node = object; node; node = node.parent) if (!node.visible) return false
    return true
  }

  controlFrom(object) {
    for (let node = object; node; node = node.parent) {
      if (node.userData.supplyControl) return node
    }
    return null
  }

  controllerHit(ctrl) {
    ctrl.updateWorldMatrix(true, false)
    const origin = new THREE.Vector3(), direction = new THREE.Vector3()
    this.interaction.getControllerRayWorld(ctrl, origin, direction)
    this.raycaster.set(origin, direction)
    this.raycaster.far = this.interaction.controllerRayMaxLength
    const objects = [...this.interaction.interactables, ...this.roots()]
    for (const hit of this.raycaster.intersectObjects(objects, true)) {
      if (!this.visible(hit.object) || hit.object.material?.visible === false) continue
      return hit
    }
    return null
  }

  controllerHover(ctrl) {
    if (this.interaction.toolMode === "wire") return null
    const hit = this.controllerHit(ctrl)
    return hit ? this.controlFrom(hit.object) : null
  }

  onControllerStart(ctrl) {
    if (this.interaction.toolMode === "wire") return false
    const hit = this.controllerHit(ctrl)
    if (this.keyboard) {
      const button = hit && this.interaction.pickInteractableFromHitObject(hit.object)
      if (this.keyboard.buttons.includes(button)) button.userData.onPress()
      return true
    }
    const control = hit && this.controlFrom(hit.object)
    if (!control) return false
    if (control.userData.supplyControl.kind === "entry") this.openKeyboard(control)
    else this.beginDrag(ctrl, control, this.controllerAngle(ctrl, control))
    return true
  }

  controllerAngle(ctrl, control) {
    const q = ctrl.getWorldQuaternion(new THREE.Quaternion())
    const localQ = control.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(localQ)
    return Math.hypot(up.x, up.y) < 0.1 ? null : Math.atan2(up.x, up.y)
  }

  handAngle(point, control) {
    const p = control.parent.worldToLocal(point.clone()).sub(control.position)
    return Math.hypot(p.x, p.y) < 0.006 ? null : Math.atan2(p.x, p.y)
  }

  beginDrag(key, control, angle) {
    const { root, field } = control.userData.supplyControl
    if (root.userData.heldBy || angle === null) return
    const c = this.appState.components.find(c => c.id === root.userData.componentId)
    if (!c) return
    root.userData.heldBy = "supply:" + c.id
    this.drags.set(key, { control, root, field, angle, value: supplySettings(c.meta)[field] })
  }

  drag(key, angle) {
    const d = this.drags.get(key)
    if (!d || angle === null) return
    const delta = Math.atan2(Math.sin(angle - d.angle), Math.cos(angle - d.angle))
    d.angle = angle
    const spec = SUPPLY_FIELDS[d.field]
    d.value = THREE.MathUtils.clamp(d.value + delta / (Math.PI * 1.5) * spec.max, 0, spec.max)
    this.setValue(d.root, d.field, normalizeSupplyValue(d.field, d.value))
  }

  setValue(root, field, value) {
    const c = this.appState.components.find(c => c.id === root.userData.componentId)
    if (!c) return
    const meta = { ...c.meta, ...supplySettings(c.meta), [field]: value }
    this.appState.updateComponent(c.id, { meta })
    root.userData.meta = meta
    root.userData.updateSupplyDisplay(meta)
  }

  endDrag(key) {
    const d = this.drags.get(key)
    if (!d) return false
    if (String(d.root.userData.heldBy).startsWith("supply:")) d.root.userData.heldBy = null
    this.drags.delete(key)
    return true
  }

  processHand(hand) {
    if (this.interaction.toolMode === "wire" || hand.heldObject) {
      this.endDrag(hand)
      return false
    }
    if (!this.interaction.isHandEntryTracked(hand)) {
      this.endDrag(hand)
      this.handLatch.set(hand, true)
      return false
    }
    const thumb = this.interaction.getThumbTipWorld(hand, new THREE.Vector3())
    const index = this.interaction.getIndexTipWorld(hand, new THREE.Vector3())
    const distance = thumb.distanceTo(index)
    // Devolver el agarre normal al abrir la mano después de operar la fuente. Hecho e implementado por LFTS
    if (distance > 0.045 && this.handInputCaptured.has(hand)) {
      hand.pinchArmed = true
      this.handInputCaptured.delete(hand)
    }
    if (distance > 0.045) {
      const ended = this.endDrag(hand)
      this.handLatch.set(hand, false)
      if (ended) { hand.pinchArmed = true; return true }
    }
    if (this.keyboard) {
      this.handInputCaptured.add(hand)
      return true
    }
    const drag = this.drags.get(hand)
    if (drag) {
      this.handInputCaptured.add(hand)
      this.drag(hand, this.handAngle(index, drag.control))
      hand.pinchArmed = false
      return true
    }
    let nearest = null, nearestDistance = 0.022
    for (const root of this.roots()) {
      root.updateWorldMatrix(true, true)
      for (const control of root.userData.supplyControls) {
        const d = this.box.setFromObject(control).distanceToPoint(index)
        if (d < nearestDistance) { nearest = control; nearestDistance = d }
      }
    }
    if (!nearest) return false
    this.handInputCaptured.add(hand)
    hand.pinchArmed = false
    if (distance < 0.025 && !this.handLatch.get(hand)) {
      this.handLatch.set(hand, true)
      if (nearest.userData.supplyControl.kind === "entry") this.openKeyboard(nearest)
      else this.beginDrag(hand, nearest, this.handAngle(index, nearest))
    }
    return true
  }

  update(graph) {
    for (const [key, d] of this.drags) {
      if (this.stateSync.getMeshById(d.root.userData.componentId) !== d.root
        || this.interaction.toolMode === "wire" || !this.interaction.renderer.xr.isPresenting) {
        this.endDrag(key)
      } else if (key.isObject3D) {
        const source = key.userData.supplyInputSource
          ?? this.interaction.renderer.xr.getSession()?.inputSources?.[key.userData.sourceIndex]
        if (!source || source.hand) this.endDrag(key)
        else this.drag(key, this.controllerAngle(key, d.control))
      }
    }
    if (this.keyboard && (this.stateSync.getMeshById(this.keyboard.root.userData.componentId) !== this.keyboard.root
      || this.interaction.toolMode === "wire")) this.closeKeyboard()
    for (const root of this.roots()) {
      const c = this.appState.components.find(c => c.id === root.userData.componentId)
      if (c) root.userData.updateSupplyDisplay(c.meta, graph?.readings?.get(c.id))
    }
  }

  openKeyboard(control) {
    const { root, field } = control.userData.supplyControl
    if (root.userData.heldBy) return
    this.cancel()
    this.onOpen()
    const group = new THREE.Group()
    group.position.copy(root.localToWorld(new THREE.Vector3(0, 0.43, 0.13)))
    group.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()))
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.015),
      new THREE.MeshStandardMaterial({ color: 0x18232e }))
    group.add(base)
    const canvas = document.createElement("canvas")
    canvas.width = 1024; canvas.height = 256
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.085), new THREE.MeshBasicMaterial({ map: texture }))
    face.position.set(0, 0.139, 0.011); group.add(face)
    const c = this.appState.components.find(c => c.id === root.userData.componentId)
    const buttons = [], textures = [texture]
    this.keyboard = { group, root, field, buttons, textures, canvas, texture,
      buffer: supplySettings(c?.meta)[field].toFixed(SUPPLY_FIELDS[field].digits), replace: true, error: "" }
    const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "⌫", "Cancelar", "Borrar", "Aceptar"]
    keys.forEach((label, i) => {
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.043, 0.016),
        new THREE.MeshStandardMaterial({ color: label === "Aceptar" ? 0x217953 : 0x35485a }))
      btn.position.set((i % 3 - 1) * 0.104, 0.070 - Math.floor(i / 3) * 0.052, 0.016)
      const labelCanvas = document.createElement("canvas")
      labelCanvas.width = 256; labelCanvas.height = 128
      const ctx = labelCanvas.getContext("2d")
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 43px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
      ctx.fillText(label, 128, 64)
      const tex = new THREE.CanvasTexture(labelCanvas); tex.colorSpace = THREE.SRGBColorSpace; textures.push(tex)
      const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.086, 0.037), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
      labelMesh.position.z = 0.009; btn.add(labelMesh)
      btn.userData.isUI = true
      btn.userData.onPress = () => this.key(label)
      group.add(btn); buttons.push(btn); this.interaction.register(btn)
    })
    this.scene.add(group)
    this.drawKeyboard()
  }

  key(key) {
    const k = this.keyboard
    if (!k) return
    if (key === "Escape" || key === "Cancelar") { this.closeKeyboard(); return }
    if (key === "Enter" || key === "Aceptar") {
      const result = parseSupplyInput(k.field, k.buffer)
      if (result.error) k.error = result.error
      else { this.setValue(k.root, k.field, result.value); this.closeKeyboard(); return }
    } else if (key === "Borrar") {
      k.buffer = ""; k.replace = false; k.error = ""
    } else if (key === "Backspace" || key === "⌫") {
      k.buffer = k.replace ? "" : k.buffer.slice(0, -1); k.replace = false; k.error = ""
    } else if (/^[0-9.,]$/.test(key)) {
      const char = key === "," ? "." : key
      if (k.replace) { k.buffer = ""; k.replace = false }
      if (k.buffer.length < 9 && !(char === "." && k.buffer.includes("."))) k.buffer += char
      k.error = ""
    }
    this.drawKeyboard()
  }

  drawKeyboard() {
    const k = this.keyboard, spec = SUPPLY_FIELDS[k.field], ctx = k.canvas.getContext("2d")
    ctx.fillStyle = "#10202b"; ctx.fillRect(0, 0, 1024, 256)
    ctx.fillStyle = "#b9e6ff"; ctx.font = "36px Arial"
    ctx.fillText(spec.label + " · 0–" + spec.max + " " + spec.unit + " · paso " + spec.step, 18, 48)
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 82px monospace"
    ctx.fillText((k.buffer || "—") + " " + spec.unit, 18, 150)
    ctx.fillStyle = k.error ? "#ff8c82" : "#9db4c4"; ctx.font = "30px Arial"
    ctx.fillText(k.error || "Aceptar aplica · Cancelar conserva el valor", 18, 220)
    k.texture.needsUpdate = true
  }

  closeKeyboard() {
    const k = this.keyboard
    if (!k) return
    for (const button of k.buttons) {
      this.interaction.unregister(button)
      if (this.interaction._lastPokedButton === button) this.interaction._lastPokedButton = null
    }
    this.interaction.setHover(null)
    this.scene.remove(k.group)
    k.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose() })
    for (const t of k.textures) t.dispose()
    this.keyboard = null
  }

  cancel() {
    for (const key of [...this.drags.keys()]) this.endDrag(key)
    this.closeKeyboard()
  }
}
