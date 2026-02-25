import * as THREE from "three"
import { ComponentFactory } from "../components/ComponentFactory"

export class StateSyncSystem {

  constructor(scene, appState) {
    this.scene = scene
    this.appState = appState

    // Mapa: componentId -> mesh
    this.meshById = new Map()
  }

  // Construye la escena a partir de AppState (al iniciar o al cargar)
  rebuildFromState() {

    // 1) quitar meshes actuales gestionados por el sistema
    for (const mesh of this.meshById.values()) {
      this.scene.remove(mesh)
    }
    this.meshById.clear()

    // 2) crear meshes desde el estado
    for (const data of this.appState.components) {

      const mesh = ComponentFactory.createComponent(data)
      if (!mesh) continue

      this.scene.add(mesh)
      this.meshById.set(data.id, mesh)
    }
  }

  // Útil si en el futuro agregas componentes en caliente:
  spawnOne(componentData) {
    const mesh = ComponentFactory.createComponent(componentData)
    if (!mesh) return null

    this.scene.add(mesh)
    this.meshById.set(componentData.id, mesh)
    return mesh
  }

  getMeshById(id) {
    return this.meshById.get(id) || null
  }
}