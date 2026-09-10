import { VRButton } from "three/examples/jsm/webxr/VRButton.js"

export class VRManager {
  constructor(renderer) {
    // Dejarlo explícito evita estados raros cuando el renderer se configura en otro lado
    renderer.xr.enabled = true

    // Reference space recomendado para Quest
    renderer.xr.setReferenceSpaceType("local-floor")

    const options = {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "dom-overlay"],
      domOverlay: { root: document.body },
    }

    const btn = VRButton.createButton(renderer, options)
    document.body.appendChild(btn)
  }
}