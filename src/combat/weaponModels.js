import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Box-built gun shapes shared by the first-person viewmodel, third-person bodies and map
// pickups. Gun space: barrel along -z, origin at the grip, meters.
// Each part: [center, size, color]. A null color means "the owner's armor color".

const METAL = 0x464c53;
const METAL_LIGHT = 0x666e77;
const WOOD = 0x8a5a33;
const WOOD_DARK = 0x6e4526;
const GLOW = 0xffa040;
const OLIVE = 0x5e6b48;
const ORANGE = 0xff7a1a;
const SHELL_RED = 0xb02a20;
const SCREEN = 0x63f2ff;
export const GLOVE = 0x24272c;

export const GUN_PARTS = {
  hickory: [
    [[0, 0.02, -0.12], [0.07, 0.09, 0.34], METAL],
    [[0, 0.073, -0.12], [0.03, 0.016, 0.26], METAL_LIGHT],
    [[0, 0.092, -0.03], [0.032, 0.03, 0.05], METAL],
    [[0, 0.092, -0.056], [0.012, 0.012, 0.004], GLOW],
    [[0, 0.012, -0.37], [0.082, 0.072, 0.22], WOOD],
    [[0, 0.02, -0.53], [0.03, 0.03, 0.14], METAL],
    [[0, 0.02, -0.615], [0.048, 0.048, 0.05], METAL_LIGHT],
    [[0, -0.01, 0.12], [0.06, 0.08, 0.2], WOOD],
    [[0, -0.02, 0.225], [0.07, 0.11, 0.03], WOOD_DARK],
    [[0, -0.07, -0.02], [0.045, 0.1, 0.05], METAL],
    [[0, -0.085, -0.17], [0.05, 0.13, 0.07], METAL],
    [[0, -0.07, -0.134], [0.052, 0.022, 0.003], GLOW],
  ],
  mesquite: [
    [[0, 0.02, -0.1], [0.075, 0.085, 0.28], METAL],
    [[0, 0.045, -0.44], [0.05, 0.05, 0.42], METAL_LIGHT],
    [[0, -0.008, -0.4], [0.04, 0.04, 0.36], METAL],
    [[0, -0.01, -0.36], [0.075, 0.065, 0.17], WOOD],
    [[0, 0.075, -0.645], [0.012, 0.014, 0.012], GLOW],
    [[0, -0.02, 0.12], [0.065, 0.09, 0.22], WOOD],
    [[0, -0.03, 0.235], [0.072, 0.12, 0.03], WOOD_DARK],
    [[0, -0.07, 0], [0.045, 0.1, 0.05], WOOD_DARK],
    [[0.041, 0.02, -0.12], [0.008, 0.045, 0.11], SHELL_RED],
  ],
  smokeSignal: [
    [[0, 0.07, -0.2], [0.14, 0.14, 0.9], OLIVE],
    [[0, 0.07, -0.67], [0.17, 0.17, 0.06], METAL],
    [[0, 0.07, 0.27], [0.16, 0.16, 0.05], METAL],
    [[0, 0.142, -0.45], [0.143, 0.006, 0.08], ORANGE],
    [[0, 0.142, 0.05], [0.143, 0.006, 0.08], ORANGE],
    [[-0.105, 0.1, -0.12], [0.06, 0.08, 0.09], METAL],
    [[-0.105, 0.1, -0.075], [0.045, 0.055, 0.003], SCREEN],
    [[0, -0.03, 0], [0.045, 0.1, 0.05], METAL],
    [[0, -0.02, -0.32], [0.04, 0.09, 0.05], METAL],
  ],
};

// Gloves and forearms for the first-person view.
export const HAND_PARTS = {
  hickory: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.03, -0.38], [0.075, 0.055, 0.1], GLOVE],
    [[-0.035, -0.07, -0.33], [0.05, 0.05, 0.1], GLOVE],
  ],
  mesquite: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.04, -0.36], [0.08, 0.055, 0.1], GLOVE],
    [[-0.04, -0.08, -0.31], [0.05, 0.05, 0.1], GLOVE],
  ],
  smokeSignal: [
    [[0.005, -0.06, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.14, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.145, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.005, -0.05, -0.32], [0.075, 0.08, 0.09], GLOVE],
  ],
};

export const MUZZLES = {
  hickory: new THREE.Vector3(0, 0.02, -0.65),
  mesquite: new THREE.Vector3(0, 0.045, -0.67),
  smokeSignal: new THREE.Vector3(0, 0.07, -0.72),
};

// Merge parts into one vertex-colored geometry. `extra` adds skinning or other attributes per
// vertex: extra(geometry, vertexCount).
export function partsGeometry(parts, armorColor, { offset = [0, 0, 0], scale = 1, inflate = 0, extra = null } = {}) {
  const geoms = [];
  const c = new THREE.Color();
  for (const [center, size, color] of parts) {
    const g = new THREE.BoxGeometry(size[0] * scale + inflate, size[1] * scale + inflate, size[2] * scale + inflate);
    g.deleteAttribute('uv');
    g.translate(offset[0] + center[0] * scale, offset[1] + center[1] * scale, offset[2] + center[2] * scale);
    c.set(color ?? armorColor);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (extra) extra(g, n);
    geoms.push(g);
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

// Charcoal briquette grenade: a squat rounded-ish block with glowing seams.
export function briquetteGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.16, 0.09, 0.16], 0x2a2420],
      [[0, 0, 0], [0.13, 0.11, 0.13], 0x2f2925],
      [[0, 0.0, 0.081], [0.1, 0.012, 0.002], 0xff6a1a],
      [[0.081, 0.0, 0], [0.002, 0.012, 0.1], 0xff6a1a],
    ],
    0x2a2420,
  );
}

// Smoke Signal rocket: fat body, nose, four fins. Points along -z.
export function missileGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.11, 0.11, 0.46], 0xd8d2c4],
      [[0, 0, -0.27], [0.08, 0.08, 0.08], ORANGE],
      [[0, 0, -0.32], [0.045, 0.045, 0.04], ORANGE],
      [[0, 0.09, 0.18], [0.012, 0.08, 0.12], METAL],
      [[0, -0.09, 0.18], [0.012, 0.08, 0.12], METAL],
      [[0.09, 0, 0.18], [0.08, 0.012, 0.12], METAL],
      [[-0.09, 0, 0.18], [0.08, 0.012, 0.12], METAL],
      [[0, 0, -0.05], [0.115, 0.115, 0.04], ORANGE],
    ],
    0xd8d2c4,
  );
}
