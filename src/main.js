// src/main.js
import * as THREE from "three";
import { SceneManager } from "./core/SceneManager.js";
import { VRManager } from "./core/VRManager.js";
import { AppState } from "./core/AppState.js";
import { StateSyncSystem } from "./systems/StateSyncSystem.js";
import { InteractionSystem } from "./systems/InteractionSystem.js";

const sceneManager = new SceneManager();
const { scene, camera, renderer } = sceneManager;

const vrManager = new VRManager(renderer, scene, camera);

const appState = new AppState();
const interactionSystem = new InteractionSystem(renderer, camera, scene, appState);
const stateSyncSystem = new StateSyncSystem(scene, appState, interactionSystem);

// ---------------------------
// Escena base: luz, piso, mesa
// ---------------------------
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(2, 4, 2);
scene.add(dir);

// Piso
const floorGeo = new THREE.PlaneGeometry(50, 50);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.receiveShadow = true;

floor.userData.isSurface = true;
floor.userData.interactable = false;
floor.layers.set(2); // surfaces
scene.add(floor);

// Mesa (placeholder)
const tableGeo = new THREE.BoxGeometry(2.0, 0.1, 1.2);
const tableMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
const table = new THREE.Mesh(tableGeo, tableMat);
table.position.set(0, 1.0, -1.0);
table.receiveShadow = true;

table.userData.isSurface = true;
table.userData.interactable = false;
table.layers.set(2); // surfaces
scene.add(table);

// Registrar surfaces en InteractionSystem
interactionSystem.registerSurface(floor, { type: "floor" });

// Bounds de mesa en mundo
const box = new THREE.Box3().setFromObject(table);

// Margen para que los componentes no queden al borde
const margin = 0.12;

const tableBounds = {
  minX: box.min.x + margin,
  maxX: box.max.x - margin,
  minZ: box.min.z + margin,
  maxZ: box.max.z - margin,
};

interactionSystem.registerSurface(table, { type: "table", bounds: tableBounds });

// ---------------------------
// XR Controllers
// ---------------------------
vrManager.onControllerReady((controller) => {
  interactionSystem.addController(controller);
});

// ---------------------------
// Cargar estado previo y reconstruir
// ---------------------------
stateSyncSystem.rebuildFromState();

// Teclas PC (ya tienes S y L; lo dejo aquí)
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "s") {
    localStorage.setItem("vr_circuit_state", appState.toJSON());
    console.log("✅ Estado guardado en localStorage");
  }
  if (e.key.toLowerCase() === "l") {
    const raw = localStorage.getItem("vr_circuit_state");
    if (raw) {
      appState.loadFromObject(JSON.parse(raw));
      stateSyncSystem.rebuildFromState();
      console.log("✅ Estado cargado y reconstruido");
    } else {
      console.log("⚠️ No hay estado guardado");
    }
  }
});

// ---------------------------
// Loop
// ---------------------------
renderer.setAnimationLoop(() => {
  interactionSystem.update();
  renderer.render(scene, camera);
});