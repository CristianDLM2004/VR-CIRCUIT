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
        instruction: "Este es un simulador de circuitos electrónicos en VR. Antes de armar algo, hagamos un recorrido rápido: qué hay en el entorno, cómo interactuar en cada modo, y qué hace cada botón.",
        targetKey: null,
        manualAdvance: true,
        primaryLabel: "Empezar",
      },
      {
        id: "entorno",
        title: "El entorno",
        instruction: "Frente a ti está la protoboard, donde vas a insertar y conectar componentes. A los lados tienes 3 paneles flotantes (Componentes, Modos, Editor) y sus botones físicos en la mesa. También hay un bote de basura para deshacerte de componentes sueltos.",
        targetKey: "protoboard",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "modo-edicion-gestos",
        title: "Modo Edición — mover componentes",
        instruction: "Con las manos: junta el pulgar y el índice (pinch) sobre un componente para agarrarlo; se mueve con tu mano y gira si giras la muñeca; abre los dedos para soltarlo. Con los controles: mantén presionado el gatillo apuntando al componente para agarrarlo, y suéltalo para dejarlo caer.",
        targetKey: null,
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "modo-simulacion-gestos",
        title: "Modo Simulación — probar el circuito",
        instruction: "Aquí ya no puedes mover ni reacomodar componentes (excepto el multímetro y sus puntas, que siguen siendo agarrables para medir). Lo que sí puedes hacer es presionar botones y accionar switches con la mano o el gatillo para ver el circuito en acción.",
        targetKey: null,
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "modo-cable-gestos",
        title: "Modo Cable — conectar todo",
        instruction: "Pinch (o gatillo) sobre un hoyo/terminal libre inicia un cable; llévalo a otro punto y vuelve a hacer pinch para cerrarlo. Si haces pinch en el aire a medio camino, se agrega un doblez al cable. Tocar el inicio de un cable ya existente lo borra; tocar su extremo final lo reabre para moverlo a otra posición.",
        targetKey: null,
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "open-spawn",
        title: "Panel de Componentes",
        instruction: "Presiona el botón verde \"Comp.\" en la mesa para abrir el panel donde se crean los componentes.",
        targetKey: "btnSpawn",
        check: (ctx) => ctx.getOpenPanelKey() === "spawn",
      },
      {
        id: "spawn-overview",
        title: "Componentes disponibles",
        instruction: "Estos son todos los componentes que puedes crear: batería, LED, resistencia, botón, switch, fuente variable y multímetro. Cada botón crea uno nuevo cerca de la protoboard.",
        targetKey: "spawnAll",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "open-edit",
        title: "Panel Editor",
        instruction: "Presiona el botón morado \"Editor\" en la mesa.",
        targetKey: "btnEdit",
        check: (ctx) => ctx.getOpenPanelKey() === "edit",
      },
      {
        id: "edit-overview",
        title: "Editar valores",
        instruction: "Un LED o una resistencia recién creados quedan seleccionados automáticamente aquí. También puedes usar \"En mano\" para seleccionar el que tengas agarrado en ese momento. Ajusta el color o el valor de resistencia y presiona \"Aceptar\" para aplicar el cambio.",
        targetKey: "editPanel",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "open-mode",
        title: "Panel de Modos",
        instruction: "Presiona el botón azul \"Modos\" en la mesa.",
        targetKey: "btnMode",
        check: (ctx) => ctx.getOpenPanelKey() === "mode",
      },
      {
        id: "explain-cable-btn",
        title: "Botón Cable",
        instruction: "Activa o desactiva el modo cable que ya vimos: mientras está activo, tus manos/controles sirven para conectar, mover y borrar cables en vez de agarrar componentes.",
        targetKey: "modeWire",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "explain-mode-btn",
        title: "Botón Modo",
        instruction: "Alterna entre Edición y Simulación — los dos modos que ya vimos.",
        targetKey: "modeToggle",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "explain-save-btn",
        title: "Botón Guardar",
        instruction: "Guarda todo lo que hay actualmente en la escena (componentes, cables y sus posiciones).",
        targetKey: "modeSave",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "explain-load-btn",
        title: "Botón Cargar",
        instruction: "Reemplaza lo que ves ahora por lo último que hayas guardado.",
        targetKey: "modeLoad",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "explain-clear-btn",
        title: "Botón Limpiar",
        instruction: "Borra por completo todo lo que hay en la escena. Si no habías guardado antes, se pierde para siempre — úsalo con cuidado.",
        targetKey: "modeClear",
        manualAdvance: true,
        primaryLabel: "Entendido",
      },
      {
        id: "done",
        title: "¡Listo!",
        instruction: "Ya conoces el entorno, los modos y los paneles. Cuando quieras armar tu primer circuito real, busca la práctica guiada (próximamente).",
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