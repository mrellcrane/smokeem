import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp } from '../util/math.js';

// The contestant body: chunky armor, a wide amber visor and a smoker canister on the back.
// Built from boxes, rigidly skinned to a 13-bone skeleton so each body is a single draw call
// (plus its shadow) no matter how it's posed. Faces -z like the camera; its right side is +x.

const JOINTS = {
  root: [0, 0, 0],
  hips: [0, 0.95, 0],
  spine: [0, 1.05, 0],
  head: [0, 1.5, 0],
  armUL: [-0.31, 1.43, 0],
  armLL: [-0.31, 1.13, 0],
  armUR: [0.31, 1.43, 0],
  armLR: [0.31, 1.13, 0],
  legUL: [-0.12, 0.92, 0],
  legLL: [-0.12, 0.5, 0],
  legUR: [0.12, 0.92, 0],
  legLR: [0.12, 0.5, 0],
  gun: [0.12, 1.28, -0.28],
};
const PARENT = {
  hips: 'root',
  spine: 'hips',
  head: 'spine',
  armUL: 'spine',
  armLL: 'armUL',
  armUR: 'spine',
  armLR: 'armUR',
  legUL: 'hips',
  legLL: 'legUL',
  legUR: 'hips',
  legLR: 'legUR',
  gun: 'spine',
};
const BONES = Object.keys(JOINTS);

// Arm poses as rotations of the rest pose (arms hanging straight down). Each segment is aimed
// at a direction in spine space; forearm rotations are relative to their upper arm.
const DOWN = new THREE.Vector3(0, -1, 0);
function aim(x, y, z) {
  return new THREE.Quaternion().setFromUnitVectors(DOWN, new THREE.Vector3(x, y, z).normalize());
}
function relative(parent, child) {
  return parent.clone().invert().multiply(child);
}
const ARM_POSE = (() => {
  const holdUR = aim(-0.3, -0.75, -0.6);
  const holdUL = aim(0.5, -0.5, -0.7);
  const up = aim(0.05, 1, -0.25);
  return {
    holdUR,
    holdLR: relative(holdUR, aim(-0.15, 0.05, -1)),
    holdUL,
    holdLL: relative(holdUL, aim(0.3, 0.1, -0.95)),
    upU: up,
    upL: new THREE.Quaternion(),
  };
})();

const SUIT = 0x2b2f35;
const BOOT = 0x1d1f23;
const METAL = 0x33373c;
const WOOD = 0x8a5a33;

// [bone, center, size, colorKey]
function parts() {
  const P = [
    ['hips', [0, 0.93, 0], [0.4, 0.18, 0.26], 'suit'],
    ['hips', [0, 1.0, 0], [0.42, 0.06, 0.28], 'trim'],
    ['spine', [0, 1.24, 0], [0.46, 0.42, 0.28], 'armor'],
    ['spine', [0, 1.28, -0.15], [0.38, 0.3, 0.04], 'trim'],
    ['spine', [0, 1.25, 0.2], [0.24, 0.36, 0.14], 'suit'],
    ['spine', [0, 1.38, 0.275], [0.12, 0.05, 0.02], 'visor'],
    ['head', [0, 1.53, 0], [0.14, 0.06, 0.14], 'suit'],
    ['head', [0, 1.66, 0], [0.28, 0.27, 0.3], 'armor'],
    ['head', [0, 1.67, -0.152], [0.23, 0.08, 0.02], 'visor'],
    ['head', [0, 1.81, 0.02], [0.06, 0.04, 0.2], 'trim'],
  ];
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const x = 0.33 * s;
    const lx = 0.12 * s;
    P.push(
      [`armU${side}`, [x, 1.44, 0], [0.18, 0.12, 0.26], 'armor'],
      [`armU${side}`, [x, 1.29, 0], [0.12, 0.28, 0.13], 'suit'],
      [`armL${side}`, [x, 0.99, 0], [0.13, 0.28, 0.14], 'armor'],
      [`armL${side}`, [x, 0.82, 0], [0.1, 0.09, 0.1], 'suit'],
      [`legU${side}`, [lx, 0.71, 0], [0.17, 0.4, 0.2], 'suit'],
      [`legU${side}`, [lx, 0.53, -0.1], [0.15, 0.1, 0.05], 'armor'],
      [`legL${side}`, [lx, 0.28, 0], [0.16, 0.42, 0.19], 'armor'],
      [`legL${side}`, [lx, 0.05, -0.03], [0.18, 0.1, 0.28], 'boot'],
    );
  }
  // Rifle held at the chest.
  P.push(
    ['gun', [0.12, 1.28, -0.4], [0.08, 0.12, 0.46], 'metal'],
    ['gun', [0.12, 1.25, -0.08], [0.07, 0.11, 0.2], 'wood'],
    ['gun', [0.12, 1.27, -0.56], [0.09, 0.08, 0.2], 'wood'],
    ['gun', [0.12, 1.29, -0.72], [0.04, 0.04, 0.16], 'metal'],
    ['gun', [0.12, 1.17, -0.36], [0.06, 0.14, 0.08], 'metal'],
  );
  return P;
}

function buildGeometry(colors, inflate) {
  const geoms = [];
  const c = new THREE.Color();
  for (const [bone, center, size, key] of parts()) {
    const pad = inflate ? 0.035 : 0;
    const g = new THREE.BoxGeometry(size[0] + pad, size[1] + pad, size[2] + pad);
    g.deleteAttribute('uv');
    g.translate(center[0], center[1], center[2]);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    c.set(colors[key]);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const bi = BONES.indexOf(bone);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geoms.push(g);
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

let sharedMaterial = null;
function bodyMaterial() {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    sharedMaterial.name = 'character';
  }
  return sharedMaterial;
}

export function disposeCharacterMaterial() {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}

export class CharacterModel {
  constructor({ armor, trim = null, visor = 0xffb347 }) {
    const armorColor = new THREE.Color(armor);
    const colors = {
      armor: armorColor,
      trim: trim ?? armorColor.clone().multiplyScalar(0.62),
      visor,
      suit: SUIT,
      boot: BOOT,
      metal: METAL,
      wood: WOOD,
    };

    this.group = new THREE.Group();
    this.group.name = 'character';
    this.bones = {};
    for (const name of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      this.bones[name] = b;
    }
    for (const name of BONES) {
      const j = JOINTS[name];
      const parent = PARENT[name];
      if (parent) {
        const pj = JOINTS[parent];
        this.bones[name].position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]);
        this.bones[parent].add(this.bones[name]);
      }
    }

    this.mesh = new THREE.SkinnedMesh(buildGeometry(colors, false), bodyMaterial());
    this.mesh.add(this.bones.root);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(BONES.map((n) => this.bones[n]));
    this.mesh.bind(this.skeleton);
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);

    // Shield shimmer: a slightly inflated copy on the same skeleton, only drawn while flashing.
    this.shellMaterial = new THREE.MeshBasicMaterial({
      color: 0x8ff4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shellMaterial.name = 'shieldShell';
    this.shell = new THREE.SkinnedMesh(buildGeometry(colors, true), this.shellMaterial);
    this.shell.bind(this.skeleton, this.mesh.bindMatrix);
    this.shell.boundingSphere = this.mesh.boundingSphere;
    this.shell.visible = false;
    this.group.add(this.shell);

    this.shieldFlash = 0;
    this.phase = 0;
    this.crouch = 0;
    this.air = 0;
    this.climb = 0;
  }

  setLayer(layer) {
    this.mesh.layers.set(layer);
    this.shell.layers.set(layer);
  }

  flashShield(strength) {
    this.shieldFlash = Math.max(this.shieldFlash, strength);
  }

  // state: { x, y, z (feet), yaw, pitch, speed, grounded, crouched, climbing }
  update(dt, s) {
    const g = this.group;
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.yaw;

    const B = this.bones;
    this.crouch += ((s.crouched ? 1 : 0) - this.crouch) * damp(12, dt);
    this.air += ((s.grounded || s.climbing ? 0 : 1) - this.air) * damp(10, dt);
    this.climb += ((s.climbing ? 1 : 0) - this.climb) * damp(10, dt);
    const run = Math.min(1, s.speed / 7);
    this.phase += dt * (4 + s.speed * 1.1);
    const sw = Math.sin(this.phase) * 0.75 * run * (1 - this.air);

    B.hips.position.y = 0.95 - this.crouch * 0.32;
    B.legUL.rotation.x = sw + this.air * 0.6 + this.crouch * 1.0;
    B.legUR.rotation.x = -sw + this.air * 0.3 + this.crouch * 1.0;
    B.legLL.rotation.x = -Math.max(0, -Math.sin(this.phase)) * 1.1 * run * (1 - this.air) - this.air * 0.9 - this.crouch * 1.7;
    B.legLR.rotation.x = -Math.max(0, Math.sin(this.phase)) * 1.1 * run * (1 - this.air) - this.air * 0.5 - this.crouch * 1.7;

    // Spine carries the aim pitch, so the arms and rifle follow it together.
    const pitch = s.pitch;
    B.spine.rotation.x = pitch * 0.5 - this.crouch * 0.25;
    B.head.rotation.x = pitch * 0.35;

    // Arms hold the rifle; while climbing they reach up instead.
    const k = this.climb;
    B.armUR.quaternion.slerpQuaternions(ARM_POSE.holdUR, ARM_POSE.upU, k);
    B.armLR.quaternion.slerpQuaternions(ARM_POSE.holdLR, ARM_POSE.upL, k);
    B.armUL.quaternion.slerpQuaternions(ARM_POSE.holdUL, ARM_POSE.upU, k);
    B.armLL.quaternion.slerpQuaternions(ARM_POSE.holdLL, ARM_POSE.upL, k);

    if (this.shieldFlash > 0) {
      this.shell.visible = true;
      this.shellMaterial.opacity = Math.min(1, this.shieldFlash) * 0.8;
      this.shieldFlash = Math.max(0, this.shieldFlash - dt * 4);
    } else if (this.shell.visible) {
      this.shell.visible = false;
    }
  }

  // Force every part visible for shader warm-up.
  warmup(on) {
    this.shell.visible = on;
    this.shellMaterial.opacity = on ? 0.5 : 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.shell.geometry.dispose();
    this.shellMaterial.dispose();
  }
}
