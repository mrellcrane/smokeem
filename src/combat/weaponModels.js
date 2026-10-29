import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared helpers and colors for the box-built guns (each gun's parts live in its module under
// src/combat/guns/). Gun space: barrel along -z, origin at the grip, meters.
// Each part: [center, size, color]. A null color means "the owner's armor color".

export const METAL = 0x464c53;
export const METAL_LIGHT = 0x666e77;
export const WOOD = 0x8a5a33;
export const WOOD_DARK = 0x6e4526;
export const GLOW = 0xffa040;
export const OLIVE = 0x5e6b48;
export const ORANGE = 0xff7a1a;
export const SHELL_RED = 0xb02a20;
export const SCREEN = 0x63f2ff;
export const GLOVE = 0x24272c;

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

// Chimney coal: a smaller briquette with brighter seams.
export function coalGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.11, 0.07, 0.11], 0x2a2420],
      [[0, 0, 0.056], [0.08, 0.012, 0.002], 0xffa040],
      [[0.056, 0, 0], [0.002, 0.012, 0.08], 0xffa040],
      [[0, 0.036, 0], [0.06, 0.002, 0.06], 0xff7a1a],
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
