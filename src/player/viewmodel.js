import * as THREE from 'three';
import { damp, clamp } from '../util/math.js';
import { partsGeometry } from '../combat/weaponModels.js';
import { GUNS } from '../combat/guns/index.js';
import { SWITCH_TIME } from '../combat/weapons.js';

// First-person weapon with gloved hands. Lives in its own scene, rendered after the world with a
// cleared depth buffer and its own camera, so it never clips into walls and keeps the same size
// in every split-screen view. One mesh per weapon in the match's set; only the held one is
// visible. Each gun's resting pose, kick and flash size come from its module (`view`).

let sharedMaterial = null;

export class Viewmodel {
  constructor(textures, armorColor, guns) {
    if (!sharedMaterial) {
      sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
      sharedMaterial.name = 'viewmodel';
    }
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.guns = {};
    this.muzzles = {};
    for (const id of guns) {
      const g = GUNS[id];
      const geom = partsGeometry([...g.parts, ...g.hands], armorColor);
      const mesh = new THREE.Mesh(geom, sharedMaterial);
      mesh.scale.setScalar(g.view.scale);
      this.muzzles[id] = new THREE.Vector3(...g.muzzle);
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
    this.setWeapon(guns[0]);

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
    this.flash.position.copy(this.muzzles[id]);
    this.flash.scale.setScalar(GUNS[id].view.flash);
  }

  fired() {
    const g = GUNS[this.current];
    this.kick = g.view.kick;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    if (g.def.pump) this.pumpT = 0.001;
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
    const pose = GUNS[id].view;

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
