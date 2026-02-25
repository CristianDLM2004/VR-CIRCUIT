// src/systems/InteractionSystem.js
import * as THREE from "three";

export class InteractionSystem {
  constructor(renderer, camera, scene, appState) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.appState = appState;

    // Interactuables (Layer 1)
    this.interactables = [];

    // Surfaces (Layer 2)
    // Cada surface: { mesh, type: "table"|"floor", bounds?: {minX,maxX,minZ,maxZ} }
    this.surfaces = [];

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(1); // solo componentes

    this.downRaycaster = new THREE.Raycaster();
    this.downRaycaster.layers.set(2); // solo superficies

    this.tempVec3 = new THREE.Vector3();

    // Estado interacción
    this.hovered = null;
    this.selected = null;
    this.selectedRoot = null;

    // Colores/feedback
    this.hoverEmissive = new THREE.Color(0x333333);
    this.selectEmissive = new THREE.Color(0x666666);

    // XR
    this.controllers = [];
  }

  // ---------------------------
  // Registro de objetos
  // ---------------------------
  registerInteractable(mesh) {
    if (!mesh) return;
    if (!this.interactables.includes(mesh)) this.interactables.push(mesh);
  }

  unregisterInteractable(mesh) {
    const idx = this.interactables.indexOf(mesh);
    if (idx >= 0) this.interactables.splice(idx, 1);
  }

  /**
   * Registra una superficie para snap.
   * @param {THREE.Object3D} surfaceMesh
   * @param {Object} options
   *  - type: "table" | "floor" (default: "floor")
   *  - bounds: { minX,maxX,minZ,maxZ } en mundo (solo para "table")
   */
  registerSurface(surfaceMesh, options = {}) {
    if (!surfaceMesh) return;
    const type = options.type || "floor";
    const bounds = options.bounds || null;

    // Evitar duplicados
    const exists = this.surfaces.find((s) => s.mesh === surfaceMesh);
    if (exists) {
      exists.type = type;
      exists.bounds = bounds;
      return;
    }

    this.surfaces.push({ mesh: surfaceMesh, type, bounds });
  }

  clearSurfaces() {
    this.surfaces.length = 0;
  }

  // ---------------------------
  // XR Controllers
  // ---------------------------
  addController(controller) {
    if (!controller) return;
    if (!this.controllers.includes(controller)) {
      this.controllers.push(controller);

      controller.addEventListener("selectstart", (e) => this.onSelectStart(e, controller));
      controller.addEventListener("selectend", (e) => this.onSelectEnd(e, controller));
    }
  }

  // ---------------------------
  // Update loop
  // ---------------------------
  update() {
    // 1) Hover desde controladores XR (si hay), si no, desde cámara (PC fallback)
    let hoverHit = null;

    if (this.controllers.length > 0) {
      // Tomamos el primer controlador que esté apuntando algo
      for (const c of this.controllers) {
        const hit = this.getRayHitFromController(c);
        if (hit) {
          hoverHit = hit;
          break;
        }
      }
    } else {
      // PC fallback: ray desde cámara al centro de pantalla
      hoverHit = this.getRayHitFromCameraCenter();
    }

    const newHovered = hoverHit ? this.findInteractableRoot(hoverHit.object) : null;

    // 2) Actualizar highlight hover (si no estamos agarrando ese mismo)
    if (newHovered !== this.hovered) {
      this.setEmissive(this.hovered, null);
      this.hovered = newHovered;

      if (this.hovered && this.hovered !== this.selectedRoot) {
        this.setEmissive(this.hovered, this.hoverEmissive);
      }
    }

    // 3) Si estamos agarrando, podrías agregar aquí “follow” si usas attach directo al controller
    // (En tu caso ya lo tienes funcionando, así que no meto cambios aquí).
  }

  // ---------------------------
  // Ray helpers
  // ---------------------------
  getRayHitFromController(controller) {
    // Convierte el controller a rayo
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);

    controller.getWorldPosition(origin);
    direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();

    this.raycaster.set(origin, direction);

    const hits = this.raycaster.intersectObjects(this.interactables, true);
    if (!hits || hits.length === 0) return null;

    // Acepta solo objetos con componentId en la cadena
    for (const h of hits) {
      const root = this.findInteractableRoot(h.object);
      if (root && root.userData && root.userData.componentId) return h;
    }
    return null;
  }

  getRayHitFromCameraCenter() {
    // Centro pantalla
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);

    const hits = this.raycaster.intersectObjects(this.interactables, true);
    if (!hits || hits.length === 0) return null;

    for (const h of hits) {
      const root = this.findInteractableRoot(h.object);
      if (root && root.userData && root.userData.componentId) return h;
    }
    return null;
  }

  findInteractableRoot(obj) {
    let cur = obj;
    while (cur) {
      if (cur.userData && cur.userData.componentId) return cur;
      cur = cur.parent;
    }
    return null;
  }

  // ---------------------------
  // Select handlers
  // ---------------------------
  onSelectStart(_event, controller) {
    // Solo si hay hovered válido
    if (!this.hovered || !this.hovered.userData?.componentId) return;
    if (this.selectedRoot) return;

    this.selectedRoot = this.hovered;
    this.selected = controller;

    // Visual feedback
    this.setEmissive(this.selectedRoot, this.selectEmissive);

    // “Pegar” al controller (tu proyecto ya lo hace; aquí lo dejamos simple)
    controller.attach(this.selectedRoot);
  }

  onSelectEnd(_event, controller) {
    if (!this.selectedRoot) return;
    if (controller !== this.selected) return;

    // Soltar al scene (mantiene world transform)
    this.scene.attach(this.selectedRoot);

    // Snap mejorado (mesa primero, clamp; si no, piso)
    this.snapSelectedToBestSurface(this.selectedRoot);

    // Actualiza AppState con transform final
    this.commitTransformToState(this.selectedRoot);

    // Limpieza visual/estado
    this.setEmissive(this.selectedRoot, null);
    this.selectedRoot = null;
    this.selected = null;
  }

  // ---------------------------
  // Snap logic (MEJORADO)
  // ---------------------------
  snapSelectedToBestSurface(selectedMesh) {
    // 1) Tomar posición actual para lanzar ray down
    const worldPos = new THREE.Vector3();
    selectedMesh.getWorldPosition(worldPos);

    // 2) Preparar ray down
    const origin = new THREE.Vector3(worldPos.x, worldPos.y + 2.0, worldPos.z);
    const direction = new THREE.Vector3(0, -1, 0);
    this.downRaycaster.set(origin, direction);

    // 3) Intersectar con TODAS las surfaces (Layer 2 ya filtra)
    const surfaceMeshes = this.surfaces.map((s) => s.mesh);
    const hits = this.downRaycaster.intersectObjects(surfaceMeshes, true);
    if (!hits || hits.length === 0) return;

    // 4) Elegir mejor surface: mesa si el punto cae dentro de bounds; si no, fallback a piso
    const best = this.pickBestSurfaceHit(hits);
    if (!best) return;

    // 5) Aplicar Y al punto de hit
    selectedMesh.position.y = best.point.y;

    // 6) Si es mesa y tiene bounds -> clamp XZ
    if (best.surface?.type === "table" && best.surface?.bounds) {
      const b = best.surface.bounds;
      selectedMesh.position.x = THREE.MathUtils.clamp(selectedMesh.position.x, b.minX, b.maxX);
      selectedMesh.position.z = THREE.MathUtils.clamp(selectedMesh.position.z, b.minZ, b.maxZ);
    }
  }

  pickBestSurfaceHit(hits) {
    // hits ya vienen ordenados por distancia
    // Necesitamos mapear hit.object a surface registrada (puede ser child).
    const getSurfaceEntry = (hitObj) => {
      // busca por identidad o por parentesco
      for (const s of this.surfaces) {
        if (hitObj === s.mesh) return s;

        // si el hit fue a un child:
        let cur = hitObj;
        while (cur) {
          if (cur === s.mesh) return s;
          cur = cur.parent;
        }
      }
      return null;
    };

    // 1) Candidatos mesa dentro de bounds
    for (const h of hits) {
      const surf = getSurfaceEntry(h.object);
      if (!surf) continue;
      if (surf.type !== "table") continue;
      if (!surf.bounds) continue;

      const { minX, maxX, minZ, maxZ } = surf.bounds;
      const x = h.point.x;
      const z = h.point.z;

      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
        return { ...h, surface: surf };
      }
    }

    // 2) Si no, primer piso
    for (const h of hits) {
      const surf = getSurfaceEntry(h.object);
      if (!surf) continue;
      if (surf.type === "floor") return { ...h, surface: surf };
    }

    // 3) Si no hay floor registrado, regresa el primer hit válido
    for (const h of hits) {
      const surf = getSurfaceEntry(h.object);
      if (surf) return { ...h, surface: surf };
    }

    return null;
  }

  // ---------------------------
  // State commit
  // ---------------------------
  commitTransformToState(mesh) {
    const id = mesh.userData?.componentId;
    if (!id) return;

    // Pos/Rot/Scale (world)
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    mesh.getWorldPosition(pos);
    mesh.getWorldQuaternion(quat);
    mesh.getWorldScale(scale);

    const euler = new THREE.Euler().setFromQuaternion(quat, "YXZ");

    this.appState.updateComponent(id, {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
      scale: { x: scale.x, y: scale.y, z: scale.z },
    });
  }

  // ---------------------------
  // Visual helpers
  // ---------------------------
  setEmissive(obj, colorOrNull) {
    if (!obj) return;

    obj.traverse((child) => {
      if (!child.isMesh) return;
      const mat = child.material;
      if (!mat) return;

      // soporta material único o array
      if (Array.isArray(mat)) {
        for (const m of mat) this.applyEmissive(m, colorOrNull);
      } else {
        this.applyEmissive(mat, colorOrNull);
      }
    });
  }

  applyEmissive(material, colorOrNull) {
    if (!material) return;
    if (!("emissive" in material)) return;

    if (colorOrNull) {
      material.emissive.copy(colorOrNull);
    } else {
      material.emissive.set(0x000000);
    }
    material.needsUpdate = true;
  }
}