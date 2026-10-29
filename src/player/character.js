import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp } from '../util/math.js';
import { GUNS, allParts } from '../combat/guns/index.js';
import { GLOW, SCREEN } from '../combat/weaponModels.js';

// The contestant body: chunky armor, a wide amber visor and a smoker canister on the back.
// Built from boxes, rigidly skinned to a 12-bone body skeleton plus one bone per gun in the
// match's set, so each body is a single draw call (plus its shadow) no matter how it's posed.
// Faces -z like the camera; its right side is +x.

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
};
const BODY_BONES = Object.keys(JOINTS);

// The skeleton for a body carrying these guns: the body bones plus one bone per gun, at the
// gun's grip point (each gun module's `carry`), hung off the spine.
function rig(guns) {
  const joints = { ...JOINTS };
  const parent = { ...PARENT };
  const gunBones = {};
  for (const id of guns) {
    const bone = `gun:${id}`;
    joints[bone] = GUNS[id].carry;
    parent[bone] = 'spine';
    gunBones[id] = bone;
  }
  return { joints, parent, gunBones, names: [...BODY_BONES, ...Object.values(gunBones)] };
}

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

// The undersuit is mid charcoal, so the armor's color and the body's shape read against dark
// walls and shade.
const SUIT = 0x454b54;
const BOOT = 0x2c2f35;
const METAL = 0x33373c;
const WOOD = 0x8a5a33;
const EMBER = 0xff7a1a;

// How much a part glows on its own (ignores light and shadow): visor and canister ember ring
// fully, the team-color light strips a little less, glowing bits of the held gun some.
const GLOWS = { visor: 1, ember: 1, strip: 0.9 };
const GUN_GLOWS = { [GLOW]: 0.8, [SCREEN]: 0.8 };

// [bone, center, size, colorKey]
function parts(r) {
  const P = [
    ['hips', [0, 0.93, 0], [0.4, 0.18, 0.26], 'suit'],
    // Belt with two pouches.
    ['hips', [0, 1.0, 0], [0.43, 0.065, 0.29], 'trim'],
    ['hips', [-0.15, 0.95, -0.15], [0.09, 0.09, 0.05], 'boot'],
    ['hips', [0.15, 0.95, -0.15], [0.09, 0.09, 0.05], 'boot'],
    ['spine', [0, 1.24, 0], [0.46, 0.42, 0.28], 'armor'],
    // Layered chest plate with two light strips.
    ['spine', [0, 1.28, -0.15], [0.38, 0.3, 0.04], 'trim'],
    ['spine', [0, 1.33, -0.18], [0.3, 0.15, 0.03], 'armor'],
    ['spine', [-0.13, 1.2, -0.172], [0.035, 0.16, 0.012], 'strip'],
    ['spine', [0.13, 1.2, -0.172], [0.035, 0.16, 0.012], 'strip'],
    // Smoker canister on the back: ember ring, and a hose up to the helmet.
    ['spine', [0, 1.25, 0.21], [0.26, 0.4, 0.16], 'suit'],
    ['spine', [0, 1.13, 0.21], [0.28, 0.045, 0.18], 'ember'],
    ['spine', [0, 1.47, 0.21], [0.14, 0.04, 0.1], 'metal'],
    ['spine', [0.09, 1.5, 0.15], [0.045, 0.2, 0.045], 'boot'],
    ['head', [0, 1.53, 0], [0.14, 0.06, 0.14], 'suit'],
    // Helmet with a wide visor and a crest.
    ['head', [0, 1.66, 0], [0.3, 0.29, 0.32], 'armor'],
    ['head', [0, 1.67, -0.162], [0.25, 0.1, 0.02], 'visor'],
    ['head', [0, 1.82, 0.02], [0.07, 0.06, 0.24], 'trim'],
  ];
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const x = 0.33 * s;
    const lx = 0.12 * s;
    P.push(
      // Big shoulder pads with a light strip on the outside.
      [`armU${side}`, [x + 0.01 * s, 1.45, 0], [0.22, 0.16, 0.28], 'armor'],
      [`armU${side}`, [x + 0.121 * s, 1.45, 0], [0.012, 0.045, 0.22], 'strip'],
      [`armU${side}`, [x, 1.29, 0], [0.12, 0.28, 0.13], 'suit'],
      [`armL${side}`, [x, 0.99, 0], [0.13, 0.28, 0.14], 'armor'],
      [`armL${side}`, [x, 0.82, 0], [0.1, 0.09, 0.1], 'suit'],
      [`legU${side}`, [lx, 0.71, 0], [0.17, 0.4, 0.2], 'suit'],
      // Thigh plate and knee pad.
      [`legU${side}`, [lx, 0.76, -0.105], [0.15, 0.22, 0.035], 'armor'],
      [`legU${side}`, [lx, 0.53, -0.1], [0.17, 0.12, 0.06], 'armor'],
      [`legL${side}`, [lx, 0.28, 0], [0.16, 0.42, 0.19], 'armor'],
      [`legL${side}`, [lx, 0.05, -0.03], [0.18, 0.1, 0.28], 'boot'],
    );
  }
  // Every weapon is baked in on its own bone; the ones not held are scaled to nothing.
  for (const [id, bone] of Object.entries(r.gunBones)) {
    const j = r.joints[bone];
    for (const [c, size, color] of allParts(id)) {
      P.push([bone, [j[0] + c[0], j[1] + c[1], j[2] + c[2]], size, color ?? 'armor']);
    }
  }
  return P;
}

function buildGeometry(colors, inflate, r) {
  const geoms = [];
  const c = new THREE.Color();
  for (const [bone, center, size, key] of parts(r)) {
    const pad = inflate ? 0.035 : 0;
    const g = new THREE.BoxGeometry(size[0] + pad, size[1] + pad, size[2] + pad);
    g.deleteAttribute('uv');
    g.translate(center[0], center[1], center[2]);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    c.set(typeof key === 'string' ? colors[key] : key);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Self-glow and the body's team color, for the rim light (see bodyMaterial).
    const glow = new Float32Array(n).fill(typeof key === 'string' ? GLOWS[key] ?? 0 : GUN_GLOWS[key] ?? 0);
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    const team = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.armor.toArray(team, i * 3);
    g.setAttribute('aTeam', new THREE.BufferAttribute(team, 3));
    const bi = r.names.indexOf(bone);
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

// One material for every body. On top of Lambert: glowing parts ignore light and shadow, and a
// rim in the body's own color lights its silhouette, stronger with distance, so a far player
// reads as a colored person (with a glowing head) instead of a dark speck, even in shade.
const RIM_VERTEX = /* glsl */ `
  attribute float aGlow;
  attribute vec3 aTeam;
  varying float vGlow;
  varying vec3 vTeam;
`;
const RIM_FRAGMENT = /* glsl */ `
  float ndv = saturate(dot(normal, normalize(vViewPosition)));
  float rim = (1.0 - ndv) * (1.0 - ndv) * mix(0.25, 0.7, smoothstep(8.0, 40.0, length(vViewPosition)));
  outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.5, vGlow) + vTeam * rim;
`;

let sharedMaterial = null;
function bodyMaterial() {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    sharedMaterial.name = 'character';
    sharedMaterial.onBeforeCompile = (shader) => {
      const v = shader.vertexShader;
      const f = shader.fragmentShader;
      if (!v.includes('#include <begin_vertex>') || !f.includes('#include <opaque_fragment>')) {
        console.warn('character: shader chunks changed, rim light off');
        return;
      }
      shader.vertexShader = RIM_VERTEX + v.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = aGlow;\n  vTeam = aTeam;');
      shader.fragmentShader =
        'varying float vGlow;\nvarying vec3 vTeam;\n' + f.replace('#include <opaque_fragment>', `${RIM_FRAGMENT}\n#include <opaque_fragment>`);
    };
    sharedMaterial.customProgramCacheKey = () => 'character-rim';
  }
  return sharedMaterial;
}

export function disposeCharacterMaterial() {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}

export class CharacterModel {
  // guns: ids of every gun this body might hold this match (the match's weapon set).
  constructor({ armor, trim = null, visor = 0xffb347, guns = ['hickory'] }) {
    const r = (this.rig = rig(guns));
    const armorColor = new THREE.Color(armor);
    const colors = {
      armor: armorColor,
      trim: trim ?? armorColor.clone().multiplyScalar(0.62),
      visor,
      suit: SUIT,
      boot: BOOT,
      metal: METAL,
      wood: WOOD,
      ember: EMBER,
      // Light strips: the armor color, lifted toward white.
      strip: armorColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
    };

    this.group = new THREE.Group();
    this.group.name = 'character';
    this.bones = {};
    for (const name of r.names) {
      const b = new THREE.Bone();
      b.name = name;
      this.bones[name] = b;
    }
    for (const name of r.names) {
      const j = r.joints[name];
      const parent = r.parent[name];
      if (parent) {
        const pj = r.joints[parent];
        this.bones[name].position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]);
        this.bones[parent].add(this.bones[name]);
      }
    }

    this.mesh = new THREE.SkinnedMesh(buildGeometry(colors, false, r), bodyMaterial());
    this.mesh.add(this.bones.root);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(r.names.map((n) => this.bones[n]));
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
    this.shell = new THREE.SkinnedMesh(buildGeometry(colors, true, r), this.shellMaterial);
    this.shell.bind(this.skeleton, this.mesh.bindMatrix);
    this.shell.boundingSphere = this.mesh.boundingSphere;
    this.shell.visible = false;
    this.group.add(this.shell);

    this.weaponId = null;
    this.setWeapon(guns[0]);

    this.shieldFlash = 0;
    this.phase = 0;
    this.crouch = 0;
    this.air = 0;
    this.climb = 0;
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    // A gun outside the match's set has no bone: the body just shows no gun.
    for (const [wid, bone] of Object.entries(this.rig.gunBones)) {
      // Not exactly zero, so skinned normals never divide by zero.
      this.bones[bone].scale.setScalar(wid === id ? 1 : 1e-4);
    }
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
