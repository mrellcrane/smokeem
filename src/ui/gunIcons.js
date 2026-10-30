import * as THREE from 'three';
import { partsGeometry } from '../combat/weaponModels.js';
import { allParts } from '../combat/guns/index.js';
import { viewmodelMaterial, viewmodelUniforms } from '../player/viewmodel.js';

// Pictures of the guns for the loadout cards and the set's gun list: each gun's third-person
// model rendered once, side on and barrel to the right, into a small transparent PNG with the
// match's renderer while the match loads. The pictures outlive the match (the models never
// change), so later matches reuse them.

// Twice the biggest size a card shows (128 x 64 CSS px), so they stay sharp on Retina screens.
const W = 256;
const H = 128;
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
  const gl = renderer.getContext();
  if (!todo.length || gl.isContextLost()) return;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf4ead8, 0x4a4c54, 3.4));
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(2, 3, 1.5);
  scene.add(sun);
  // The first-person material (shine by finish), with the reflection's up the picture's up.
  const material = viewmodelMaterial();
  viewmodelUniforms.uUp.value.set(0, 1, 0);
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
    // Rolled about the barrel to show a touch of the top, and turned to show the near side, so
    // it reads as a solid gun (XYZ order: the roll applies first, in the gun's own frame).
    mesh.rotation.set(0, 0.35, -0.3);
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
    scene.remove(mesh);
    geom.dispose();
    // Lost mid-pass: the read came back blank, so keep nothing and let a later match draw it.
    if (gl.isContextLost()) break;
    icons.set(id, small.toDataURL('image/png'));
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAutoClear;
  target.dispose();
}
