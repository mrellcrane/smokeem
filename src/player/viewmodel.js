import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, clamp } from '../util/math.js';

// First-person Hickory rifle with gloved hands. Lives in its own scene, rendered after the
// world with a cleared depth buffer and its own camera, so it never clips into walls and keeps
// the same size in every split-screen view.

const METAL = 0x464c53;
const METAL_LIGHT = 0x666e77;
const WOOD = 0x8a5a33;
const WOOD_DARK = 0x6e4526;
const GLOVE = 0x24272c;
const GLOW = 0xffa040;

// [center, size, color] in gun space: barrel along -z, origin at the grip.
const GUN_PARTS = [
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
  // Right hand on the grip; the forearm runs back and down off screen.
  [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
  [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
  [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
  // Left hand wrapped under the handguard.
  [[-0.008, -0.03, -0.38], [0.075, 0.055, 0.1], GLOVE],
  [[-0.035, -0.07, -0.33], [0.05, 0.05, 0.1], GLOVE],
];

export const MUZZLE = new THREE.Vector3(0, 0.02, -0.65);

function buildGunGeometry(armorColor) {
  const geoms = [];
  const c = new THREE.Color();
  for (const [center, size, color] of GUN_PARTS) {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    g.deleteAttribute('uv');
    g.translate(center[0], center[1], center[2]);
    c.set(color ?? armorColor);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geoms.push(g);
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

let sharedMaterial = null;

export class Viewmodel {
  constructor(textures, armorColor) {
    if (!sharedMaterial) {
      sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
      sharedMaterial.name = 'viewmodel';
    }
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.gun = new THREE.Mesh(buildGunGeometry(armorColor), sharedMaterial);
    this.gun.scale.setScalar(0.72);
    this.root.add(this.gun);

    this.flashMaterial = new THREE.MeshBasicMaterial({
      map: textures.flash,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flashMaterial.name = 'muzzleFlash';
    this.flash = new THREE.Group();
    for (const ry of [0, Math.PI / 2]) {
      // Front-facing star plus a side-on streak.
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), this.flashMaterial);
      q.rotation.y = ry;
      this.flash.add(q);
    }
    this.flash.position.copy(MUZZLE);
    this.flash.visible = false;
    this.gun.add(this.flash);

    this.kick = 0;
    this.flashT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.bobPhase = 0;
    this.sprint = 0;
    this.aim = 0;
    this.lower = 0;
    this.vy = 0;
  }

  fired() {
    this.kick = 1;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.4;
    this.flash.scale.set(s, s, s);
  }

  // lookX / lookY: radians turned this frame.
  update(dt, p, lookX, lookY) {
    const run = p.grounded && p.mode === 'move' ? Math.min(1, p.speed() / 7) : 0;
    this.bobPhase += dt * (6 + p.speed() * 1.2) * (run > 0.05 ? 1 : 0);
    const k = damp(10, dt);
    const rate = dt > 0 ? 1 / Math.max(dt, 1 / 240) : 0;
    this.swayX += (clamp(-lookX * rate * 0.004, -0.05, 0.05) - this.swayX) * k;
    this.swayY += (clamp(lookY * rate * 0.004, -0.04, 0.04) - this.swayY) * k;
    this.sprint += ((p.sprinting && run > 0.5 ? 1 : 0) - this.sprint) * damp(9, dt);
    this.aim += ((p.aimZoom > 1.02 ? 1 : 0) - this.aim) * damp(14, dt);
    const lowered = p.mode === 'mantle' ? 1 : p.mode === 'net' || p.mode === 'rope' || p.mode === 'bars' ? 0.35 : 0;
    this.lower += (lowered - this.lower) * damp(10, dt);
    this.vy += (clamp(-p.vel.y * 0.004, -0.035, 0.035) - this.vy) * damp(8, dt);
    this.kick = Math.max(0, this.kick - dt * 14);

    const reload = Math.sin(Math.PI * p.weapon.reloadProgress);
    const bobX = Math.sin(this.bobPhase) * 0.012 * run;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * run;
    const a = this.aim;
    const g = this.gun;
    g.position.set(
      0.21 - 0.08 * a + bobX + this.swayX - 0.05 * this.sprint,
      -0.215 + 0.035 * a + bobY + this.swayY + this.vy - 0.12 * reload - 0.05 * this.sprint - 0.2 * this.lower - p.landDip * 0.25,
      -0.48 + 0.03 * this.kick + 0.05 * a,
    );
    g.rotation.set(
      0.025 + 0.06 * this.kick - 0.45 * reload - 0.25 * this.sprint - 0.5 * this.lower,
      0.06 + 0.55 * this.sprint,
      0.6 * reload + this.swayX * 2,
    );

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
    } else if (this.flash.visible) {
      this.flash.visible = false;
    }
  }

  warmup(on) {
    this.flash.visible = on;
  }

  dispose() {
    this.gun.geometry.dispose();
    for (const q of this.flash.children) q.geometry.dispose();
    this.flashMaterial.dispose();
  }
}

export function disposeViewmodelMaterial() {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}
