import * as THREE from "../vendor/three/three.module.min.js";
import { HOST_PROTOCOL_VERSION, connectHost } from "../host-bridge.js";

const canvas = document.querySelector("#stage");
const status = document.querySelector("#status");

let renderer;

try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas,
    alpha: false,
    preserveDrawingBuffer: true
  });
} catch (error) {
  status.textContent = "WebGL unavailable";
  throw error;
}

renderer.setClearColor(0x0d1010, 1);
renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 4);

const spinner = createSpinner();
scene.add(spinner);
scene.add(createLights());

await initializeHostStatus();
requestAnimationFrame(render);

async function initializeHostStatus() {
  const host = await connectHost();
  const capabilities = await host.capabilities();
  const storageResult = await host.storage.save("web-iterate-smoke", {
    at: new Date().toISOString(),
    protocolVersion: HOST_PROTOCOL_VERSION,
    renderer: `three-r${THREE.REVISION}`
  });

  const storageText = storageResult.ok ? capabilities.storage : storageResult.code;
  status.textContent = `Host v${HOST_PROTOCOL_VERSION}; Three r${THREE.REVISION}; storage: ${storageText}; achievements: ${capabilities.achievements}`;
}

function render(now) {
  resizeRenderer();

  const time = now * 0.001;
  spinner.rotation.z = time * 0.8;
  spinner.rotation.x = Math.sin(time * 0.7) * 0.26;

  for (const [index, child] of spinner.children.entries()) {
    child.rotation.y += 0.012 + index * 0.002;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function resizeRenderer() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pixelWidth = Math.floor(width * pixelRatio);
  const pixelHeight = Math.floor(height * pixelRatio);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function createSpinner() {
  const group = new THREE.Group();
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x4fd1c5,
    emissive: 0x123d3a,
    metalness: 0.34,
    roughness: 0.28
  });
  const bladeMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xf59e6b, emissive: 0x3b1808, roughness: 0.42 }),
    new THREE.MeshStandardMaterial({ color: 0x9ed36a, emissive: 0x1d3210, roughness: 0.42 }),
    new THREE.MeshStandardMaterial({ color: 0x76a9ff, emissive: 0x10213d, roughness: 0.42 })
  ];

  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.055, 16, 96),
    ringMaterial
  ));

  for (let index = 0; index < 3; index += 1) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.72, 0.08),
      bladeMaterials[index]
    );
    const angle = index * (Math.PI * 2 / 3);

    blade.position.set(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0.04);
    blade.rotation.z = angle - Math.PI / 2;
    group.add(blade);
  }

  return group;
}

function createLights() {
  const group = new THREE.Group();
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  const fill = new THREE.AmbientLight(0x7da7a4, 0.75);

  key.position.set(2.4, 2.8, 4);
  group.add(key, fill);
  return group;
}
