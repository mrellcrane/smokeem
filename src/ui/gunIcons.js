import * as THREE from 'three';
import { partsGeometry } from '../combat/weaponModels.js';
import { allParts } from '../combat/guns/index.js';

// Pictures of the guns for the loadout cards and the set's gun list: each gun's third-person
// model rendered once, side on and barrel to the right, into a small transparent PNG with the
// match's renderer while the match loads. The pictures outlive the match (the models never
// change), so later matches reuse them.

const W = 192;
const H = 96;
// Rendered at twice the size and scaled down on a 2D canvas: smooth edges without MSAA.
const SS = 2;
const icons = new Map();

// The picture of a gun (a data URL), or null if it hasn't been rendered.
export function gunIcon(id) {
  return icons.get(id) ?? null;
}

// Renders the guns in ids that have no picture yet.
export function renderGunIcons(renderer, ids) {
  const todo = ids.filter((id) => !icons.has(id));
  if (!todo.length) return;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf4ead8, 0x4a4c54, 3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.position.set(2, 3, 1.5);
  scene.add(sun);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  camera.position.set(5, 0, 0);
  camera.lookAt(0, 0, 0);
  const target = new THREE.WebGLRenderTarget(W * SS, H * SS);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const pixels = new Uint8Array(W * SS * H * SS * 4);
  const big = document.createElement('canvas');
  big.width = W * SS;
  big.height = H * SS;
  const bigCtx = big.getContext('2d');
  const image = bigCtx.createImageData(W * SS, H * SS);
  const small = document.createElement('canvas');
  small.width = W;
  small.height = H;
  const smallCtx = small.getContext('2d');

  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  for (const id of todo) {
    const geom = partsGeometry(allParts(id), 0x888888);
    const mesh = new THREE.Mesh(geom, material);
    // A touch of the top and near side, so it reads as a solid gun.
    mesh.rotation.set(0.12, 0.35, 0);
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    box.setFromObject(mesh);
    box.getCenter(center);
    box.getSize(size);
    // Camera right is world -z (the barrel), up is +y.
    const half = Math.max(size.z / 2, (size.y / 2) * (W / H)) * 1.08;
    camera.left = -half;
    camera.right = half;
    camera.top = half * (H / W);
    camera.bottom = -half * (H / W);
    camera.position.set(center.x + 5, center.y, center.z);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W * SS, H * SS, pixels);
    // WebGL rows run bottom up.
    const row = W * SS * 4;
    for (let y = 0; y < H * SS; y++) image.data.set(pixels.subarray((H * SS - 1 - y) * row, (H * SS - y) * row), y * row);
    bigCtx.putImageData(image, 0, 0);
    smallCtx.clearRect(0, 0, W, H);
    smallCtx.drawImage(big, 0, 0, W, H);
    icons.set(id, small.toDataURL('image/png'));
    scene.remove(mesh);
    geom.dispose();
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAutoClear;
  material.dispose();
  target.dispose();
}
