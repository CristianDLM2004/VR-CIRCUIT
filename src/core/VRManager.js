import { VRButton } from "three/examples/jsm/webxr/VRButton.js"

export class VRManager {

    constructor(renderer) {
        document.body.appendChild(VRButton.createButton(renderer))
    }

}