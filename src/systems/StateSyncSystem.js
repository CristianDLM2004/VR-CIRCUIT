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

  detachAndDisposeMesh(mesh) {
    if (!mesh) return

    if (this.interactionSystem) this.interactionSystem.unregister(mesh)

    if (mesh.userData) {
      mesh.userData.heldBy = null
      delete mesh.userData.physics
    }

    if (mesh.parent) {
      mesh.parent.remove(mesh)
    } else {
      this.scene.remove(mesh)
    }
  }

  rebuildFromState() {
    for (const mesh of this.meshById.values()) {
      this.detachAndDisposeMesh(mesh)
    }
    this.meshById.clear()

    for (const data of this.appState.components) {
      const mesh = ComponentFactory.createComponent(data)
      if (!mesh) continue

      this.scene.add(mesh)
      this.meshById.set(data.id, mesh)

      if (this.interactionSystem) this.interactionSystem.register(mesh)

      // Recolocar LED insertado usando sus holes guardados
      if (
        data.type === "led" &&
        data.inserted &&
        data.pinConnections &&
        this.interactionSystem?.holeSystem &&
        Array.isArray(mesh.userData?.pins)
      ) {
        const anodePin = mesh.userData.pins.find((p) => p.id === "anode")
        const anodeHole = this.interactionSystem.holeSystem.holes.find(
          (h) => h.id === data.pinConnections.anode
        )

        const cathodeHole = this.interactionSystem.holeSystem.holes.find(
          (h) => h.id === data.pinConnections.cathode
        )

        if (anodePin && anodeHole && cathodeHole) {
          const targetDir = cathodeHole.worldPos.clone().sub(anodeHole.worldPos).setY(0)

          if (targetDir.lengthSq() > 1e-8) {
            targetDir.normalize()

            const targetYaw = Math.atan2(-targetDir.z, targetDir.x)
            mesh.rotation.set(0, targetYaw, 0)
            mesh.updateMatrixWorld(true)

            const rotatedAnodeWorld = anodePin.localPos.clone()
            mesh.localToWorld(rotatedAnodeWorld)

            const delta = anodeHole.worldPos.clone().sub(rotatedAnodeWorld)
            mesh.position.add(delta)
            mesh.position.y -= 0.02
            mesh.updateMatrixWorld(true)
          }
        }
      }
    }
  }

  addMeshFromComponent(componentData) {
    if (!componentData?.id) return null
    if (this.meshById.has(componentData.id)) return this.meshById.get(componentData.id)

    const mesh = ComponentFactory.createComponent(componentData)
    if (!mesh) return null

    this.scene.add(mesh)
    this.meshById.set(componentData.id, mesh)

    if (this.interactionSystem) this.interactionSystem.register(mesh)
    return mesh
  }

  removeMeshById(id) {
    const mesh = this.meshById.get(id)
    if (!mesh) return false

    this.detachAndDisposeMesh(mesh)
    this.meshById.delete(id)
    return true
  }

  getMeshById(id) {
    return this.meshById.get(id) || null
  }
}