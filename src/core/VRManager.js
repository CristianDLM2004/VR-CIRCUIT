import { VRButton } from "three/examples/jsm/webxr/VRButton.js"

export class VRManager {
  constructor(renderer) {
    // Reference space recomendado
    renderer.xr.setReferenceSpaceType("local-floor")

    const options = {
      optionalFeatures: [
        "local-floor",
        "bounded-floor",
        "hand-tracking",
        "dom-overlay",
      ],
      domOverlay: { root: document.body },
    }

    document.body.appendChild(VRButton.createButton(renderer, options))
  }
}