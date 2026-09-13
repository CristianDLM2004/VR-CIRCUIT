//TutorialSystem.js

//   appState
//   getOpenPanelKey: () => string|null
//   getToolMode: () => "grab" | "wire"
//   isSimMode: () => boolean
//   getMeshById: (id) => THREE.Object3D|null
//   spawnTutorialComponent: (type, meta?) => { id, mesh }   // posición neutra, sin seleccionar
//   removeTutorialComponent: (id) => void                    // no-op si el id ya no existe
//   selectComponent: (id) => void
//   clearSelection: () => void
//   spawnDemoButton: () => THREE.Object3D                    // botón temporal sin función real
//   removeDemoButton: (mesh) => void

const STORAGE_KEY = "vr_circuit_tutorial_done"
const HIGHLIGHT_COLOR = 0x00e5ff
const HIGHLIGHT_BASE_INTENSITY = 1.4
const HIGHLIGHT_PULSE_AMPLITUDE = 1.0

export class TutorialSystem {
  constructor(ctx) {
    this.ctx = ctx
    this.active = false
    this.stepIndex = 0
    this.targets = {}

    // Datos que persisten durante toda la corrida del tutorial (ids de componentes
    // creados, banderas de progreso). Se reinicia solo en start(). Hecho e implementado por LFTS
    this.data = {}

    this._pulseT = 0
    this._highlighted = null
    this._highlightOriginal = new Map()
    this._stepStartMs = 0
    this._knownIdsAtStepStart = new Set()

    this.steps = this.buildSteps()
  }

  // --- Helpers de detección reutilizables ---
  // Todos escriben banderas en this.data bajo una llave con prefijo, para no chocar
  // entre pasos distintos. Hecho e implementado por LFTS

  trackGrabReleaseCycle(flagKey, mesh) {
    const key = `_grabCycle_${flagKey}`
    if (!mesh) return !!this.data[key + "_done"]
    const wasHeld = !!this.data[key]
    const isHeld = !!mesh.userData?.heldBy
    if (isHeld) this.data[key] = true
    const done = wasHeld && !isHeld
    if (done) this.data[key + "_done"] = true
    return this.data[key + "_done"] === true
  }

  trackFlagOnce(flagKey, currentValue) {
    const key = `_flag_${flagKey}`
    if (currentValue) this.data[key] = true
    return !!this.data[key]
  }

  // --- Definición de pasos ---

  buildSteps() {
    return [
      {
        id: "welcome",
        title: "Bienvenido a VR-Circuit",
        instruction: "Este es un simulador de circuitos electrónicos en realidad virtual. Vamos a recorrer juntos, paso a paso, cómo moverte e interactuar con todo antes de armar tu primer circuito.",
        manualAdvance: true,
        primaryLabel: "Empezar",
      },
      {
        id: "entorno",
        title: "El entorno",
        instruction: "Frente a ti está la protoboard, donde más adelante vas a insertar y conectar componentes. A los lados hay paneles flotantes y, en la mesa, botones físicos para abrirlos. También hay un bote para deshacerte de componentes sueltos.",
        targetKey: "protoboard",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },

      // --- Agarrar, mover y tirar a la basura (fusionado en un solo paso) ---
      {
        id: "grab-basics",
        title: "Agarrar y mover componentes",
        onEnter: (ctx, self) => {
          const { id, mesh } = ctx.spawnTutorialComponent("battery5v")
          self.data.grabBasicsId = id
          self.applyHighlight(mesh)
        },
        onExit: (ctx, self) => {
          if (self.data.grabBasicsId) ctx.removeTutorialComponent(self.data.grabBasicsId)
          delete self.data.grabBasicsId
        },
        instruction: (ctx, self) => {
          const mesh = ctx.getMeshById(self.data.grabBasicsId)
          const grabbed = self.trackGrabReleaseCycle("grabBasics", mesh)
          if (!grabbed) {
            return "Acércate a la batería flotante. Con la mano: junta el pulgar y el índice (pellizco) sobre ella para tomarla, y abre los dedos para soltarla. Con el control: mantén presionado el gatillo apuntando hacia ella, y suéltalo para dejarla caer."
          }
          return "¡Bien! Ahora aparece un bote de basura. Toma la batería otra vez y suéltala dentro del bote para eliminarla."
        },
        onEnterExtra: null,
        check: (ctx, self) => {
          const mesh = ctx.getMeshById(self.data.grabBasicsId)
          self.trackGrabReleaseCycle("grabBasics", mesh)
          if (!self.data._flag_grabBasicsPhase2) {
            if (self.data["_grabCycle_grabBasics_done"]) self.data._flag_grabBasicsPhase2 = true
            return false
          }
          // Fase 2: se completa cuando el componente desaparece de la escena (basura)
          return !ctx.appState.components.some((c) => c.id === self.data.grabBasicsId)
        },
      },

      // --- Botones UI con un botón de práctica neutro ---
      {
        id: "ui-button-basics",
        title: "Botones de la interfaz",
        instruction: "Presiona el botón flotante frente a ti. Con la mano: empújalo con el índice, como en la vida real. Con el control: apunta el rayo hacia él y presiona el gatillo (no necesitas estar cerca).",
        onEnter: (ctx, self) => {
          const mesh = ctx.spawnDemoButton()
          self.data.demoButtonMesh = mesh
          self.applyHighlight(mesh)
        },
        onExit: (ctx, self) => {
          if (self.data.demoButtonMesh) ctx.removeDemoButton(self.data.demoButtonMesh)
          delete self.data.demoButtonMesh
        },
        check: (ctx, self) => !!self.data.demoButtonMesh?.userData?._tutorialPressed,
      },

      // --- Modo cable ---
      {
        id: "wire-open-panel",
        title: "Panel de Modos",
        instruction: "Presiona el botón de la mesa que abre el panel de Modos.",
        targetKey: "btnMode",
        check: (ctx) => ctx.getOpenPanelKey() === "mode",
      },
      {
        id: "wire-activate",
        title: "Activar el modo cable",
        instruction: "Dentro del panel, presiona el botón para activar el modo cable. Importante: si tienes algo agarrado en este momento, suéltalo antes de activarlo.",
        targetKey: "modeWire",
        check: (ctx) => ctx.getToolMode() === "wire",
      },
      {
        id: "wire-create",
        title: "Crear un cable",
        instruction: "Toca un hoyo de la protoboard para iniciar el cable (punto A). Puedes tocar en el aire para agregar un doblez, y luego toca otro hoyo para cerrarlo (punto B). Con el control: apunta y usa el gatillo en cada caso.",
        check: (ctx, self) => self.findNewComponent("wire", "wireCreated"),
      },
      {
        id: "wire-edit-end",
        title: "Editar el final de un cable",
        instruction: "Toca (o apunta y presiona el gatillo sobre) el extremo final del cable que acabas de crear — no el punto donde empezó — y muévelo a otro hoyo para reconectarlo ahí.",
        onEnter: (ctx, self) => {
          const wires = ctx.appState.components.filter((c) => c.type === "wire")
          self.data.wireBeforeEdit = wires[wires.length - 1]?.id ?? null
        },
        check: (ctx, self) => {
          if (!self.data.wireBeforeEdit) return false
          const stillThere = ctx.appState.components.some((c) => c.id === self.data.wireBeforeEdit)
          if (stillThere) return false
          const hasAnyWire = ctx.appState.components.some((c) => c.type === "wire")
          if (hasAnyWire) self.rememberWireForCleanup(ctx)
          return hasAnyWire
        },
      },
      {
        id: "wire-delete",
        title: "Borrar un cable",
        instruction: "Toca (o apunta y usa el gatillo sobre) el inicio de ese mismo cable para borrarlo por completo.",
        onEnter: (ctx, self) => {
          const wires = ctx.appState.components.filter((c) => c.type === "wire")
          self.data.wireBeforeDelete = wires[wires.length - 1]?.id ?? null
        },
        check: (ctx, self) => {
          if (!self.data.wireBeforeDelete) return false
          return !ctx.appState.components.some((c) => c.id === self.data.wireBeforeDelete)
        },
      },
      {
        id: "wire-exit",
        title: "Salir del modo cable",
        instruction: "Abre de nuevo el panel de Modos y presiona el botón de modo cable para desactivarlo.",
        targetKey: "modeWire",
        check: (ctx) => ctx.getToolMode() === "grab",
        onExit: (ctx, self) => self.cleanupTrackedWires(ctx),
      },

      // --- Editar propiedades ---
      {
        id: "edit-fresh-led",
        title: "Editar un componente recién creado",
        instruction: "Aparece un LED, ya seleccionado automáticamente por ser el más reciente. Abre el panel Editor, elige un color y confirma el cambio. (Esto mismo aplica para el valor de una resistencia.)",
        onEnter: (ctx, self) => {
          const { id, mesh } = ctx.spawnTutorialComponent("led", { color: 0xff3b3b })
          self.data.freshLedId = id
          self.data.freshLedInitialColor = 0xff3b3b
          ctx.selectComponent(id)
          self.applyHighlight(mesh)
        },
        onExit: (ctx, self) => {
          if (self.data.freshLedId) ctx.removeTutorialComponent(self.data.freshLedId)
          delete self.data.freshLedId
          delete self.data.freshLedInitialColor
        },
        check: (ctx, self) => {
          const comp = ctx.appState.components.find((c) => c.id === self.data.freshLedId)
          if (!comp) return false
          return comp.meta?.color !== self.data.freshLedInitialColor
        },
      },
      {
        id: "edit-held-led",
        title: "Editar un componente que ya estaba ahí",
        instruction: "Este otro LED no está seleccionado. Tómalo con la mano o el control, y mientras lo sostienes usa la opción del panel Editor para seleccionar \"el que tienes en la mano\"; luego cambia su color y confirma.",
        onEnter: (ctx, self) => {
          const { id, mesh } = ctx.spawnTutorialComponent("led", { color: 0x2ecc71 })
          self.data.heldLedId = id
          self.data.heldLedInitialColor = 0x2ecc71
          ctx.clearSelection()
          self.applyHighlight(mesh)
        },
        onExit: (ctx, self) => {
          if (self.data.heldLedId) ctx.removeTutorialComponent(self.data.heldLedId)
          delete self.data.heldLedId
          delete self.data.heldLedInitialColor
        },
        check: (ctx, self) => {
          const comp = ctx.appState.components.find((c) => c.id === self.data.heldLedId)
          if (!comp) return false
          return comp.meta?.color !== self.data.heldLedInitialColor
        },
      },

      // --- Edición vs. Simulación (fusionado en un solo paso, 3 fases) ---
      {
        id: "edit-vs-sim",
        title: "Edición vs. Simulación",
        onEnter: (ctx, self) => {
          const { id, mesh } = ctx.spawnTutorialComponent("button")
          self.data.circuitButtonId = id
          self.applyHighlight(mesh)
        },
        onExit: (ctx, self) => {
          if (self.data.circuitButtonId) ctx.removeTutorialComponent(self.data.circuitButtonId)
          delete self.data.circuitButtonId
        },
        instruction: (ctx, self) => {
          const mesh = ctx.getMeshById(self.data.circuitButtonId)
          const moved = self.trackFlagOnce("editVsSimMoved", !!mesh?.userData?.heldBy)
          if (!moved) {
            return "Estás en modo Edición. Intenta presionar este componente — verás que en vez de accionarse, simplemente se mueve como cualquier otro objeto."
          }
          if (!ctx.isSimMode()) {
            return "Ahora abre el panel de Modos y activa el modo Simulación."
          }
          return "Ahora sí presiónalo — en Simulación, este componente reacciona de verdad en vez de moverse."
        },
        check: (ctx, self) => {
          const mesh = ctx.getMeshById(self.data.circuitButtonId)
          const moved = self.trackFlagOnce("editVsSimMoved", !!mesh?.userData?.heldBy)
          if (!moved) return false
          if (!ctx.isSimMode()) return false
          return self.trackFlagOnce("editVsSimPressed", mesh?.userData?.buttonState === true)
        },
      },

      // --- Utilidades ---
      {
        id: "util-save",
        title: "Guardar",
        instruction: "Este botón guarda todo lo que hay actualmente en la escena: componentes, cables y sus posiciones.",
        targetKey: "modeSave",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "util-load",
        title: "Cargar",
        instruction: "Este botón reemplaza lo que ves ahora por lo último que hayas guardado.",
        targetKey: "modeLoad",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "util-clear",
        title: "Limpiar",
        instruction: "Este botón borra por completo todo lo que hay en la escena. Si no habías guardado antes, se pierde para siempre — úsalo con cuidado.",
        targetKey: "modeClear",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },

      {
        id: "done",
        title: "¡Listo!",
        instruction: "Ya conoces el entorno, los modos, los paneles y cómo interactuar con manos o controles. Cuando quieras armar tu primer circuito real, busca la práctica guiada (próximamente).",
        manualAdvance: true,
        primaryLabel: "Cerrar",
        isFinal: true,
      },
    ]
  }

  // Ayuda a los pasos de cable a saber qué borrar al salir del modo cable, sin
  // necesidad de pasarse el id manualmente de paso en paso. Hecho e implementado por LFTS
  rememberWireForCleanup(ctx) {
    const wires = ctx.appState.components.filter((c) => c.type === "wire")
    this.data._wiresToCleanup = wires.map((w) => w.id)
  }

  cleanupTrackedWires(ctx) {
    const ids = this.data._wiresToCleanup || ctx.appState.components.filter((c) => c.type === "wire").map((c) => c.id)
    for (const id of ids) ctx.removeTutorialComponent(id)
    delete this.data._wiresToCleanup
  }

  findNewComponent(type, dataKey) {
    if (this.data[dataKey]) return true
    const found = this.ctx.appState.components.find(
      (c) => c.type === type && !this._knownIdsAtStepStart.has(c.id)
    )
    if (found) {
      this.data[dataKey] = found.id
      return true
    }
    return false
  }

  // --- Ciclo de vida ---

  hasBeenSeen() {
    return localStorage.getItem(STORAGE_KEY) === "1"
  }

  start() {
    this.active = true
    this.data = {}
    this.enterStep(0)
  }

  close(markSeen = true) {
    const step = this.steps[this.stepIndex]
    step?.onExit?.(this.ctx, this)
    this.active = false
    this.clearHighlight()
    if (markSeen) localStorage.setItem(STORAGE_KEY, "1")
  }

  manualAdvance() {
    if (!this.active) return
    const step = this.steps[this.stepIndex]
    if (!step?.manualAdvance) return
    this.advance()
  }

  advance() {
    if (this.stepIndex >= this.steps.length - 1) {
      this.close(true)
      return
    }
    this.goTo(this.stepIndex + 1)
  }

  back() {
    if (this.stepIndex <= 0) return
    this.goTo(this.stepIndex - 1)
  }

  // Simétrico en ambas direcciones: sale del paso actual, entra al nuevo. Hecho e implementado por LFTS
  goTo(index) {
    if (index < 0 || index >= this.steps.length) return
    const prev = this.steps[this.stepIndex]
    prev?.onExit?.(this.ctx, this)
    this.enterStep(index)
  }

  enterStep(index) {
    this.stepIndex = index
    this._stepStartMs = performance.now()
    this._knownIdsAtStepStart = new Set(this.ctx.appState.components.map((c) => c.id))
    this.clearHighlight()

    const step = this.steps[index]
    if (step.onEnter) {
      step.onEnter(this.ctx, this)
    } else if (step.targetKey) {
      this.applyHighlight(this.targets[step.targetKey] || null)
    }
  }

  setTargets(targets) {
    Object.assign(this.targets, targets)
  }

  // --- Resaltado ---

  applyHighlight(target) {
    if (this._highlighted === target) return
    this.clearHighlight()
    if (!target) return
    this._highlighted = target
    const meshes = Array.isArray(target) ? target : [target]
    for (const mesh of meshes) {
      mesh?.traverse?.((child) => {
        if (!child.isMesh || !child.material) return
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        for (const mat of mats) {
          if (!("emissive" in mat)) continue
          this._highlightOriginal.set(mat, [mat.emissive.getHex(), mat.emissiveIntensity])
        }
      })
    }
  }

  clearHighlight() {
    for (const [mat, [hex, intensity]] of this._highlightOriginal) {
      mat.emissive.setHex(hex)
      mat.emissiveIntensity = intensity
    }
    this._highlightOriginal.clear()
    this._highlighted = null
  }

  // --- Loop principal ---

  update(dtMs) {
    if (!this.active) return

    if (this._highlighted) {
      this._pulseT += dtMs * 0.004
      const intensity = HIGHLIGHT_BASE_INTENSITY + HIGHLIGHT_PULSE_AMPLITUDE * Math.abs(Math.sin(this._pulseT))
      for (const mat of this._highlightOriginal.keys()) {
        mat.emissive.setHex(HIGHLIGHT_COLOR)
        mat.emissiveIntensity = intensity
      }
    }

    const step = this.steps[this.stepIndex]
    if (step.check && step.check(this.ctx, this)) this.advance()
  }

  getPanelData() {
    const step = this.steps[this.stepIndex]
    const instruction = typeof step.instruction === "function" ? step.instruction(this.ctx, this) : step.instruction
    const title = typeof step.title === "function" ? step.title(this.ctx, this) : step.title
    return {
      active: this.active,
      stepIndex: this.stepIndex,
      totalSteps: this.steps.length,
      title,
      instruction,
      manualAdvance: !!step.manualAdvance,
      primaryLabel: step.primaryLabel || "Listo",
      isFinal: !!step.isFinal,
      canGoBack: this.stepIndex > 0,
    }
  }
}