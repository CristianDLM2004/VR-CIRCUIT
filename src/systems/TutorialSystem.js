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

    this._checkArmed = true

    this._watchWasHeld = false
    this._watchLastHeldMs = 0
    this._watchTargets = []

    this.steps = this.buildSteps()
  }



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
        instruction: "Este es un simulador de circuitos electrónicos en realidad virtual. Vamos a recorrer, paso a paso, cómo moverte e interactuar con todo antes de armar tu primer circuito.",
        manualAdvance: true,
        primaryLabel: "Empezar",
      },
      {
        id: "entorno",
        title: "El entorno",
        instruction: "Frente a ti está la protoboard: ahí vas a insertar y conectar componentes más adelante. También hay paneles flotantes y botones físicos en la mesa para abrirlos. Ahora mismo estás en modo Edición, el modo por defecto para acomodar cosas libremente.",
        targetKey: "protoboard",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },

      // --- Agarrar y mover (batería de práctica) ---
      {
        id: "grab-move",
        title: "Agarrar y mover componentes",
        instruction: "Frente a ti hay una batería de práctica. Con la mano: acércate y junta el pulgar con el índice (gesto de pellizco) sobre ella para tomarla; gírala moviendo tu muñeca; abre los dedos para soltarla. Con el control: mantén presionado el gatillo apuntando hacia ella para tomarla, gírala moviendo el control, y suelta el gatillo para soltarla.",
        onEnter: (ctx, self) => {
          if (!self.data.practiceBatteryId || !ctx.getMeshById(self.data.practiceBatteryId)) {
            const { id } = ctx.spawnTutorialComponent("battery5v")
            self.data.practiceBatteryId = id
          }

          delete self.data["_grabCycle_practiceBattery"]
          delete self.data["_grabCycle_practiceBattery_done"]
          const mesh = ctx.getMeshById(self.data.practiceBatteryId)
          self.applyHighlight(mesh)
          self.setWatchTarget(mesh)
        },
        onExit: (ctx, self, direction) => {

          if (direction === "backward" && self.data.practiceBatteryId) {
            ctx.removeTutorialComponent(self.data.practiceBatteryId)
            delete self.data.practiceBatteryId
          }
        },
        check: (ctx, self) => {
          const mesh = ctx.getMeshById(self.data.practiceBatteryId)
          return self.trackGrabReleaseCycle("practiceBattery", mesh)
        },
      },

      // --- Bote de basura (paso propio, con su propio resaltado) ---
      {
        id: "trash-toss",
        title: "El bote de basura",
        instruction: "Para eliminar un componente, tómalo y suéltalo dentro del bote. Inténtalo con la misma batería.",
        onEnter: (ctx, self) => {
          if (!self.data.practiceBatteryId || !ctx.getMeshById(self.data.practiceBatteryId)) {
            const { id } = ctx.spawnTutorialComponent("battery5v")
            self.data.practiceBatteryId = id
          }
          const batteryMesh = ctx.getMeshById(self.data.practiceBatteryId)
          self.applyHighlight([self.targets.trashBin, batteryMesh].filter(Boolean))
          self.setWatchTarget(batteryMesh)
        },

        onExit: (ctx, self, direction) => {
          if (direction === "forward" && self.data.practiceBatteryId) {
            ctx.removeTutorialComponent(self.data.practiceBatteryId)
            delete self.data.practiceBatteryId
          }
        },
        check: (ctx, self) => {
          const done = !ctx.appState.components.some((c) => c.id === self.data.practiceBatteryId)
          if (done) delete self.data.practiceBatteryId
          return done
        },
      },
      // --- Botones UI ---
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
        instruction: "Dentro del panel, presiona el botón para activar el modo cable. Si tienes algo agarrado en este momento, suéltalo antes de activarlo. Fíjate en la apariencia de ese mismo botón: cambia mientras el modo cable está activo, así puedes confirmarlo en cualquier momento.",
        targetKey: "modeWire",
        check: (ctx) => ctx.getToolMode() === "wire",
      },
      {
        id: "wire-create",
        title: "Crear un cable",
        instruction: "Con la mano: haz el gesto de pellizcar cerca de un hoyo de la protoboard para iniciar el cable (punto A) — no hace falta tocarlo, solo estar cerca. Pellizca en el aire para agregar un doblez, y pellizca sobre otro hoyo para cerrar el cable (punto B). Con el control: apunta con el rayo y usa el gatillo en cada uno de esos momentos.",
        onEnter: (ctx, self) => { delete self.data.wireCreated },
        check: (ctx, self) => self.findNewComponent("wire", "wireCreated"),
      },
      {
        id: "wire-edit-end",
        title: "Editar el final de un cable",
        instruction: "Haz el gesto de pellizcar (o apunta con el control y usa el gatillo) sobre el extremo final de un cable que ya exista — no el punto donde empezó — y muévelo a otro hoyo para reconectarlo ahí.",
        onEnter: (ctx, self) => {
          delete self.data._wireEditSeenId
          delete self.data._wireEditGone
        },
        check: (ctx, self) => {
          const done = self.trackWireCycleThenChange("wireEdit", ctx, self, { requireReappear: true })
          if (done) self.rememberWireForCleanup(ctx)
          return done
        },
      },
      {
        id: "wire-delete",
        title: "Borrar un cable",
        instruction: "Haz el gesto de pellizcar (o apunta y usa el gatillo) sobre el inicio de un cable existente para borrarlo por completo. Si no hay ninguno en este momento, crea uno rápido para practicar.",
        onEnter: (ctx, self) => {
          delete self.data._wireDeleteSeenId
          delete self.data._wireDeleteGone
        },
        check: (ctx, self) => self.trackWireCycleThenChange("wireDelete", ctx, self, { requireReappear: false }),
      },
      {
        id: "wire-exit",
        title: "Salir del modo cable",
        instruction: "Abre de nuevo el panel de Modos y presiona el mismo botón para desactivar el modo cable — notarás que vuelve a cambiar de apariencia al desactivarse.",
        targetKey: "modeWire",
        check: (ctx) => ctx.getToolMode() === "grab",
        onExit: (ctx, self) => self.cleanupTrackedWires(ctx),
      },

      // --- Editar propiedades: LED recién creado ---
      {
        id: "edit-fresh-led",
        title: "Editar un componente recién creado",
        instruction: "Este LED aparece ya seleccionado, por ser el más reciente. Abre el panel Editor, elige un color distinto y confirma el cambio. (Esto mismo aplica para el valor de una resistencia.)",
        onEnter: (ctx, self) => {

          if (self.data.freshLedId) ctx.removeTutorialComponent(self.data.freshLedId)
          const { id } = ctx.spawnTutorialComponent("led", { color: 0xff3b3b })
          self.data.freshLedId = id
          self.data.freshLedInitialColor = 0xff3b3b
          ctx.selectComponent(id)

          self.applyHighlight(self.targets.btnEdit || null)
          self.setWatchTarget(ctx.getMeshById(id))
        },
        onExit: (ctx, self, direction) => {
          if (direction === "backward" && self.data.freshLedId) {
            ctx.removeTutorialComponent(self.data.freshLedId)
            delete self.data.freshLedId
            delete self.data.freshLedInitialColor
          }
        },
        check: (ctx, self) => {
          const comp = ctx.appState.components.find((c) => c.id === self.data.freshLedId)
          if (!comp) return false
          return comp.meta?.color !== self.data.freshLedInitialColor
        },
      },
      {
        id: "edit-fresh-led-toss",
        title: "¡Se ve el cambio!",
        instruction: "Termina llevándolo al bote de basura.",
        onEnter: (ctx, self) => {
          self.applyHighlight(self.targets.trashBin || null)
          self.setWatchTarget(ctx.getMeshById(self.data.freshLedId))
        },
        onExit: (ctx, self, direction) => {
          if (direction === "forward" && self.data.freshLedId) {
            ctx.removeTutorialComponent(self.data.freshLedId)
            delete self.data.freshLedId
            delete self.data.freshLedInitialColor
          }
        },
        check: (ctx, self) => {
          const done = !ctx.appState.components.some((c) => c.id === self.data.freshLedId)
          if (done) { delete self.data.freshLedId; delete self.data.freshLedInitialColor }
          return done
        },
      },

      // --- Editar propiedades: LED "ya existente" (En mano) ---
      {
        id: "edit-held-led",
        title: "Editar un componente que ya estaba ahí",
        instruction: "Este otro LED no está seleccionado. Tómalo con la mano o el control y, mientras lo sostienes, usa la opción del panel Editor para seleccionar \"el que tienes en la mano\"; cambia su color y confirma.",
        onEnter: (ctx, self) => {
          if (self.data.heldLedId) ctx.removeTutorialComponent(self.data.heldLedId)
          const { id } = ctx.spawnTutorialComponent("led", { color: 0x2ecc71 })
          self.data.heldLedId = id
          self.data.heldLedInitialColor = 0x2ecc71
          ctx.clearSelection()
          self.applyHighlight(self.targets.btnEdit || null)
          self.setWatchTarget(ctx.getMeshById(id))
        },
        onExit: (ctx, self, direction) => {
          if (direction === "backward" && self.data.heldLedId) {
            ctx.removeTutorialComponent(self.data.heldLedId)
            delete self.data.heldLedId
            delete self.data.heldLedInitialColor
          }
        },
        check: (ctx, self) => {
          const comp = ctx.appState.components.find((c) => c.id === self.data.heldLedId)
          if (!comp) return false
          return comp.meta?.color !== self.data.heldLedInitialColor
        },
      },
      {
        id: "edit-held-led-toss",
        title: "¡Se ve el cambio!",
        instruction: "Termina llevando este LED al bote de basura también.",
        onEnter: (ctx, self) => {
          self.applyHighlight(self.targets.trashBin || null)
          self.setWatchTarget(ctx.getMeshById(self.data.heldLedId))
        },
        onExit: (ctx, self, direction) => {
          if (direction === "forward" && self.data.heldLedId) {
            ctx.removeTutorialComponent(self.data.heldLedId)
            delete self.data.heldLedId
            delete self.data.heldLedInitialColor
          }
        },
        check: (ctx, self) => {
          const done = !ctx.appState.components.some((c) => c.id === self.data.heldLedId)
          if (done) { delete self.data.heldLedId; delete self.data.heldLedInitialColor }
          return done
        },
      },

      // --- Edición vs. Simulación (dividido en 3 pasos encadenados) ---
      {
        id: "sim-edit-move",
        title: "Edición vs. Simulación",
        instruction: "Aparece un botón de circuito. Estás en modo Edición: intenta presionarlo (con el dedo, o apuntando y usando el gatillo) — verás que en vez de accionarse, simplemente se mueve como cualquier otro objeto. Esto pasa igual con switches u otros componentes de circuito: no reaccionan como tal hasta entrar a Simulación.",
        onEnter: (ctx, self) => {
          if (!self.data.circuitButtonId || !ctx.getMeshById(self.data.circuitButtonId)) {
            const { id } = ctx.spawnTutorialComponentOnProtoboard("button")
            self.data.circuitButtonId = id
          }
          delete self.data["_grabCycle_circuitButton"]
          delete self.data["_grabCycle_circuitButton_done"]
          const mesh = ctx.getMeshById(self.data.circuitButtonId)
          self.applyHighlight(mesh)
          self.setWatchTarget(mesh)
        },
        onExit: (ctx, self, direction) => {
          if (direction === "backward" && self.data.circuitButtonId) {
            ctx.removeTutorialComponent(self.data.circuitButtonId)
            delete self.data.circuitButtonId
          }
        },
        check: (ctx, self) => {
          const mesh = ctx.getMeshById(self.data.circuitButtonId)
          return self.trackGrabReleaseCycle("circuitButton", mesh)
        },
      },
      {
        id: "sim-activate",
        title: "Activar Simulación",
        instruction: "Abre el panel de Modos y presiona el botón de modo para pasar a Simulación. Ese mismo botón también cambia de apariencia según el modo activo. Si en este momento tuvieras algo en la mano, se soltaría solo al cambiar de modo.",
        targetKey: "modeToggle",
        check: (ctx) => ctx.isSimMode(),
      },
      {
        id: "sim-press",
        title: "¡Ahora sí funciona!",
        instruction: "Presiona el botón de circuito con el dedo, o apúntale y usa el gatillo. Tómate tu tiempo para sentir cómo, en Simulación, reacciona de verdad en vez de moverse. Cuando lo hayas probado, continúa.",
        onEnter: (ctx, self) => {

          if (!self.data.circuitButtonId || !ctx.getMeshById(self.data.circuitButtonId)) {
            const { id } = ctx.spawnTutorialComponentOnProtoboard("button")
            self.data.circuitButtonId = id
          }
          const mesh = ctx.getMeshById(self.data.circuitButtonId)
          self.applyHighlight(mesh)
          self.setWatchTarget(mesh)
        },
        onExit: (ctx, self, direction) => {
          if (direction === "forward" && self.data.circuitButtonId) {
            ctx.removeTutorialComponent(self.data.circuitButtonId)
            delete self.data.circuitButtonId
          }
        },
        manualAdvance: true,
        primaryLabel: "Listo, continuar",
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


  trackWireCycleThenChange(prefix, ctx, self, { requireReappear }) {
    const seenKey = `_${prefix}SeenId`
    const goneKey = `_${prefix}Gone`
    const wires = ctx.appState.components.filter((c) => c.type === "wire")

    if (!self.data[seenKey]) {
      if (wires.length) self.data[seenKey] = wires[wires.length - 1].id
      return false
    }
    if (!self.data[goneKey]) {
      const stillThere = wires.some((w) => w.id === self.data[seenKey])
      if (!stillThere) self.data[goneKey] = true
      return false
    }
    if (!requireReappear) return true
    return wires.length > 0
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
    step?.onExit?.(this.ctx, this, "forward")
    this.active = false
    this.clearHighlight()
    if (markSeen) localStorage.setItem(STORAGE_KEY, "1")
  }

  manualAdvance() {
    if (!this.active) return
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

  // Simétrico en ambas direcciones: sale del paso actual, entra al nuevo.
  goTo(index) {
    if (index < 0 || index >= this.steps.length) return
    const prev = this.steps[this.stepIndex]
    // La dirección le permite a un paso saber si debe destruir su componente temporal
    // (al alejarse hacia atrás, ya no hará falta) o dejarlo vivo (al avanzar, porque un
    // paso siguiente puede seguir usándolo). 
    const direction = index > this.stepIndex ? "forward" : "backward"
    prev?.onExit?.(this.ctx, this, direction)
    this.enterStep(index)
  }
  enterStep(index) {
    this.stepIndex = index
    this._stepStartMs = performance.now()
    this._knownIdsAtStepStart = new Set(this.ctx.appState.components.map((c) => c.id))
    this.clearHighlight()

    this._watchTargets = []

    const step = this.steps[index]
    if (step.onEnter) {
      step.onEnter(this.ctx, this)
    } else if (step.targetKey) {
      this.applyHighlight(this.targets[step.targetKey] || null)
    }


    this._checkArmed = step.check ? !step.check(this.ctx, this) : true

    this._watchWasHeld = false
    this._watchLastHeldMs = performance.now()
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

  setWatchTarget(target) {
    const meshes = Array.isArray(target) ? target : [target]
    this._watchTargets = meshes.filter(Boolean)
  }

  update(dtMs) {
    if (!this.active) return

    if (this._highlighted) {
      const meshes = Array.isArray(this._highlighted) ? this._highlighted : [this._highlighted]
      const anyComponentHeld = meshes.some((m) => m?.userData?.componentId && m.userData?.heldBy)
      if (anyComponentHeld) this.clearHighlight()
    }

    if (this._highlighted) {
      this._pulseT += dtMs * 0.004
      const intensity = HIGHLIGHT_BASE_INTENSITY + HIGHLIGHT_PULSE_AMPLITUDE * Math.abs(Math.sin(this._pulseT))
      for (const mat of this._highlightOriginal.keys()) {
        mat.emissive.setHex(HIGHLIGHT_COLOR)
        mat.emissiveIntensity = intensity
      }
    }

  
    const watchedComponent = this._watchTargets.find((m) => m?.userData?.componentId)
    if (watchedComponent?.userData?.heldBy) {
      this._watchWasHeld = true
      this._watchLastHeldMs = performance.now()
    }

    const step = this.steps[this.stepIndex]
    if (step.check) {
      const result = step.check(this.ctx, this)
      if (!this._checkArmed) {
        if (!result) this._checkArmed = true
      } else if (result) {
        this.advance()
      }
    }
  }

  getStuckHint() {
    const step = this.steps[this.stepIndex]
    if (!step?.check) return ""
    if (performance.now() - this._stepStartMs < 20000) return ""
    return "💡 ¿Tienes problemas para continuar? Puedes presionar \"Atrás\" para reiniciar este paso, o \"Siguiente\" para saltarlo."
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
      primaryLabel: step.primaryLabel || "Siguiente",
      isFinal: !!step.isFinal,
      canGoBack: this.stepIndex > 0,
    }
  }
}