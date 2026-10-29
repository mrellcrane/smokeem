import * as THREE from 'three';
import { damp, clamp } from '../util/math.js';
import { GUN_PARTS, HAND_PARTS, MUZZLES, partsGeometry } from '../combat/weaponModels.js';
import { SWITCH_TIME } from '../combat/weapons.js';

// First-person weapon with gloved hands. Lives in its own scene, rendered after the world with a
// cleared depth buffer and its own camera, so it never clips into walls and keeps the same size
// in every split-screen view. One mesh per weapon; only the held one is visible.

// Resting pose per weapon in viewmodel-camera space.
const POSES = {
  hickory: { pos: [0.21, -0.215, -0.48], rot: [0.025, 0.06, 0], scale: 0.72 },
  mesquite: { pos: [0.21, -0.22, -0.46], rot: [0.025, 0.06, 0], scale: 0.72 },
  smokeSignal: { pos: [0.27, -0.2, -0.56], rot: [0.02, 0.05, 0], scale: 0.6 },
};

const KICK = { hickory: 1, mesquite: 2.2, smokeSignal: 2.6 };

let sharedMaterial = null;

export class Viewmodel {
  constructor(textures, armorColor) {
    if (!sharedMaterial) {
      sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
      sharedMaterial.name = 'viewmodel';
    }
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.guns = {};
    for (const id of Object.keys(GUN_PARTS)) {
      const geom = partsGeometry([...GUN_PARTS[id], ...HAND_PARTS[id]], armorColor);
      const mesh = new THREE.Mesh(geom, sharedMaterial);
      mesh.scale.setScalar(POSES[id].scale);
      mesh.visible = false;
      this.root.add(mesh);
      this.guns[id] = mesh;
    }

    this.flashMaterial = new THREE.MeshBasicMaterial({
      map: textures.flash,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flashMaterial.name = 'muzzleFlash';
    this.flash = new THREE.Group();
    const flashGeom = new THREE.PlaneGeometry(0.2, 0.2);
    for (const ry of [0, Math.PI / 2]) {
      // Front-facing star plus a side-on streak.
      const q = new THREE.Mesh(flashGeom, this.flashMaterial);
      q.rotation.y = ry;
      this.flash.add(q);
    }
    this.flash.visible = false;

    this.current = null;
    this.gun = null;
    this.setWeapon('hickory');

    this.kick = 0;
    this.flashT = 0;
    this.bashT = 0;
    this.tossT = 0;
    this.pumpT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.bobPhase = 0;
    this.sprint = 0;
    this.aim = 0;
    this.lower = 0;
    this.vy = 0;
  }

  setWeapon(id) {
    if (id === this.current) return;
    if (this.gun) this.gun.visible = false;
    this.current = id;
    this.gun = this.guns[id];
    this.gun.visible = true;
    this.gun.add(this.flash);
    this.flash.position.copy(MUZZLES[id]);
    this.flash.scale.setScalar(id === 'hickory' ? 1 : 1.8);
  }

  fired() {
    this.kick = KICK[this.current] ?? 1;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    if (this.current === 'mesquite') this.pumpT = 0.001;
  }

  bash() {
    this.bashT = 0.001;
  }

  toss() {
    this.tossT = 0.001;
  }

  // lookX / lookY: radians turned this frame.
  update(dt, p, lookX, lookY) {
    this.root.visible = p.alive && !p.guiding;
    const id = p.weapon.def.id;
    this.setWeapon(id);
    const pose = POSES[id];

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
    this.kick = Math.max(0, this.kick - dt * 12);

    const curve = (t) => (t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0);
    const advance = (t, dur) => (t > 0 ? (t + dt / dur >= 1 ? 0 : t + dt / dur) : 0);
    this.bashT = advance(this.bashT, 0.3);
    this.tossT = advance(this.tossT, 0.45);
    this.pumpT = advance(this.pumpT, 0.65);
    const bash = curve(this.bashT);
    const toss = curve(this.tossT);
    const pump = this.pumpT > 0.25 ? curve((this.pumpT - 0.25) / 0.75) : 0;
    const reload = Math.sin(Math.PI * p.weapon.reloadProgress);
    const sw = p.switchT > 0 ? Math.min(1, p.switchT / SWITCH_TIME) : 0;

    const bobX = Math.sin(this.bobPhase) * 0.012 * run;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * run;
    const a = this.aim;
    const g = this.gun;
    const [px, py, pz] = pose.pos;
    const [rx, ry, rz] = pose.rot;
    g.position.set(
      px - 0.08 * a + bobX + this.swayX - 0.05 * this.sprint - 0.04 * bash,
      py + 0.035 * a + bobY + this.swayY + this.vy - 0.12 * reload - 0.05 * this.sprint - 0.2 * this.lower -
        p.landDip * 0.25 - 0.3 * sw - 0.16 * toss + 0.03 * bash,
      pz + 0.012 * this.kick + 0.05 * a - 0.14 * bash + 0.04 * pump,
    );
    g.rotation.set(
      rx + 0.035 * this.kick - 0.45 * reload - 0.25 * this.sprint - 0.5 * this.lower - 0.9 * sw - 0.35 * toss + 0.12 * pump - 0.25 * bash,
      ry + 0.55 * this.sprint + 0.3 * bash,
      rz + 0.6 * reload + this.swayX * 2 + 0.5 * bash,
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
    for (const m of Object.values(this.guns)) m.visible = on || m === this.gun;
  }

  dispose() {
    for (const m of Object.values(this.guns)) m.geometry.dispose();
    this.flash.children[0].geometry.dispose();
    this.flashMaterial.dispose();
  }
}

export function disposeViewmodelMaterial() {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}
