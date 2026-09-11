//TutorialSystem.js
// Hecho e implementado por LFTS
import * as THREE from "three"

const STORAGE_KEY = "vr_circuit_tutorial_done"
const HIGHLIGHT_COLOR = 0x00e5ff
const HIGHLIGHT_BASE_INTENSITY = 1.4
const HIGHLIGHT_PULSE_AMPLITUDE = 1.0
const STUCK_HINT_MS = 25000 // tiempo en el paso final sin lograrlo antes de sugerir activamente revisar modo/conexiones.
// eléctrico real (¿enciende el LED?) en vez de exigir conexiones exactas.
export class TutorialSystem {
    constructor(ctx) {
        // ctx esperado: {
        //   appState, electricalSystem,
        //   getOpenPanelKey: () => string|null,
        //   getToolMode: () => "grab"|"wire",
        //   isSimMode: () => boolean,
        // }
        this.ctx = ctx
        this.active = false
        this.stepIndex = 0
        this.targets = {}
        this.tracked = { battery: null, led: null, resistor: null, buttonOrSwitch: null }

        this._pulseT = 0
        this._highlighted = null
        this._highlightOriginal = new Map()
        this._stepStartMs = 0
        this._knownIdsAtStepStart = new Set()

        this.steps = this.buildSteps()
    }

    buildSteps() {
        return [
            {
                id: "welcome",
                title: "Bienvenido a VR-Circuit",
                instruction: "Vamos a armar juntos un circuito simple: batería, LED, resistencia y un botón o switch.",
                targetKey: null,
                manualAdvance: true,
                primaryLabel: "Entendido",
            },
            {
                id: "open-spawn",
                title: "Abre el panel de Componentes",
                instruction: "Presiona el botón verde \"Comp.\" en la mesa.",
                targetKey: "btnSpawn",
                check: (ctx) => ctx.getOpenPanelKey() === "spawn",
            },
            {
                id: "add-battery",
                title: "Agrega una batería",
                instruction: "Presiona el botón de batería en el panel.",
                targetKey: "spawnBattery",
                check: (ctx, self) => self.findNewComponent("battery5v", "battery"),
            },
            {
                id: "add-led",
                title: "Agrega un LED",
                instruction: "Presiona el botón de LED en el panel.",
                targetKey: "spawnLed",
                check: (ctx, self) => self.findNewComponent("led", "led"),
            },
            {
                id: "add-resistor",
                title: "Agrega una resistencia",
                instruction: "Presiona el botón de resistencia. Sin ella, el LED se puede dañar en simulación.",
                targetKey: "spawnResistor",
                check: (ctx, self) => self.findNewComponent("resistor", "resistor"),
            },
            {
                id: "add-switch",
                title: "Agrega un botón o un switch",
                instruction: "Cualquiera de los dos sirve para controlar el circuito.",
                targetKey: "spawnButtonOrSwitch",
                check: (ctx, self) =>
                    self.findNewComponent("button", "buttonOrSwitch") || self.findNewComponent("switch", "buttonOrSwitch"),
            },
            {
                id: "open-mode",
                title: "Abre el panel de Modos",
                instruction: "Presiona el botón azul \"Modos\" en la mesa.",
                targetKey: "btnMode",
                check: (ctx) => ctx.getOpenPanelKey() === "mode",
            },
            {
                id: "activate-wire",
                title: "Activa el modo cable",
                instruction: "Presiona el botón \"Cable\" dentro del panel de Modos.",
                targetKey: "modeWire",
                check: (ctx) => ctx.getToolMode() === "wire",
            },
            {
                id: "wire-up",
                title: "Conecta el circuito",
                instruction: "Con el modo cable activo, une con cables: batería → resistencia → LED → botón/switch → de vuelta a la batería, usando los hoyos de la protoboard.",
                targetKey: null,
                manualAdvance: true,
                primaryLabel: "Listo, continuar",
            },
            {
                id: "enter-sim",
                title: "Activa el modo Simulación",
                instruction: "Presiona el botón \"Modo\" dentro del panel de Modos para pasar a Simulación.",
                targetKey: "modeToggle",
                check: (ctx) => ctx.isSimMode(),
            },
            {
                id: "light-led",
                title: "¡Enciende el LED!",
                instruction: "Si el circuito está bien armado, el LED debería encender. Revisa el panel de alertas si ves un error.",
                targetKey: null,
                check: (ctx, self) => self.isLedLit(ctx),
                stuckHint: "¿Sigues en modo edición? Revisa que el modo Simulación esté activo y que todos los cables estén conectados.",
            },
            {
                id: "done",
                title: "¡Circuito completo!",
                instruction: "Terminaste la práctica guiada. Puedes seguir explorando libremente.",
                targetKey: null,
                manualAdvance: true,
                primaryLabel: "Cerrar",
                isFinal: true,
            },
        ]
    }

    // --- Ciclo de vida ---

    hasBeenSeen() {
        return localStorage.getItem(STORAGE_KEY) === "1"
    }

    start() {
        this.active = true
        this.tracked = { battery: null, led: null, resistor: null, buttonOrSwitch: null }
        this.enterStep(0)
    }

    close(markSeen = true) {
        this.active = false
        this.clearHighlight()
        if (markSeen) localStorage.setItem(STORAGE_KEY, "1")
    }

    // Botón "Entendido/Listo/Cerrar" del panel — solo avanza si el paso lo permite. Hecho e implementado por LFTS
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
        this.enterStep(this.stepIndex + 1)
    }

    enterStep(index) {
        this.stepIndex = index
        this._stepStartMs = performance.now()
        this._knownIdsAtStepStart = new Set(this.ctx.appState.components.map((c) => c.id))
        this.applyHighlight(this.targets[this.steps[index].targetKey] || null)
    }

    setTargets(targets) {
        Object.assign(this.targets, targets)
    }

    // --- Condiciones de los pasos ---

    findNewComponent(type, trackKey) {
        if (this.tracked[trackKey]) return true
        const found = this.ctx.appState.components.find(
            (c) => c.type === type && !this._knownIdsAtStepStart.has(c.id)
        )
        if (found) {
            this.tracked[trackKey] = found.id
            return true
        }
        return false
    }

    isLedLit(ctx) {
        if (!ctx.isSimMode() || !this.tracked.led) return false
        const reading = ctx.electricalSystem.lastGraph?.readings?.get(this.tracked.led)
        if (!reading || reading.invalid) return false
        return Math.abs(reading.currentA || 0) > 0.0008 // mismo umbral que ElectricalSystem usa para "encendido". Hecho e implementado por LFTS
    }

    // --- Resaltado ---

  applyHighlight(target) {
    if (this._highlighted === target) return
    this.clearHighlight()
    if (!target) return
    this._highlighted = target
    // Acepta un solo mesh o un arreglo (p. ej. resaltar "Botón" y "Switch" a la vez,
    // ya que cualquiera de los dos completa ese paso)
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
        const stuckHintVisible = !!step.stuckHint && performance.now() - this._stepStartMs > STUCK_HINT_MS
        return {
            active: this.active,
            stepIndex: this.stepIndex,
            totalSteps: this.steps.length,
            title: step.title,
            instruction: step.instruction,
            manualAdvance: !!step.manualAdvance,
            primaryLabel: step.primaryLabel || "Listo",
            isFinal: !!step.isFinal,
            stuckHintVisible,
            stuckHintText: step.stuckHint || "",
        }
    }
}