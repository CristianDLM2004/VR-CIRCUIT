import { ComponentFactory } from "../components/ComponentFactory"

export class StateSyncSystem {

  constructor(scene, appState, interactionSystem = null) {
    this.scene = scene
    this.appState = appState
    this.interactionSystem = interactionSystem
    this.meshById = new Map()
  }

  setInteractionSystem(interactionSystem) {
    this.interactionSystem = interactionSystem
  }

  rebuildFromState() {

    for (const mesh of this.meshById.values()) {
      if (this.interactionSystem) this.interactionSystem.unregister(mesh)
      this.scene.remove(mesh)
    }
    this.meshById.clear()

    for (const data of this.appState.components) {

      const mesh = ComponentFactory.createComponent(data)
      if (!mesh) continue

      this.scene.add(mesh)
      this.meshById.set(data.id, mesh)

      if (this.interactionSystem) this.interactionSystem.register(mesh)
    }
  }
}