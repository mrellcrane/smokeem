import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp } from '../util/math.js';
import { GUNS, allParts } from '../combat/guns/index.js';
import { GLOW, SCREEN } from '../combat/weaponModels.js';

// The contestant body: chunky armor, a wide amber visor and a smoker canister on the back.
// Built from boxes, rigidly skinned to a 12-bone body skeleton plus one bone per gun in the
// match's set, so each body is a single draw call (plus its shadow) no matter how it's posed.
// Faces -z like the camera; its right side is +x.
// Body language (update): the legs run toward where the body is going while the torso and gun
// stay on the aim, feet plant, jumps tuck and land with a squash, and the gun rides at the hip,
// at the shoulder when firing or zoomed, or across the chest when sprinting.

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
// Three holds: at the hip (walking around), at the shoulder (firing or zoomed), and across the
// chest (sprinting); plus arms up for climbing.
const ARM_POSE = (() => {
  const pose = (ur, lr, ul, ll) => {
    const UR = aim(...ur);
    const UL = aim(...ul);
    return { UR, LR: relative(UR, aim(...lr)), UL, LL: relative(UL, aim(...ll)) };
  };
  const up = aim(0.05, 1, -0.25);
  return {
    hold: pose([-0.3, -0.75, -0.6], [-0.15, 0.05, -1], [0.5, -0.5, -0.7], [0.3, 0.1, -0.95]),
    aim: pose([-0.25, -0.55, -0.8], [-0.1, 0.2, -1], [0.55, -0.4, -0.75], [0.25, 0.28, -0.95]),
    sprint: pose([-0.1, -0.85, -0.45], [-0.75, 0.25, -0.6], [0.35, -0.8, -0.4], [0.7, 0.45, -0.55]),
    up: { UR: up, LR: new THREE.Quaternion(), UL: up, LL: new THREE.Quaternion() },
  };
})();
// Where the held gun sits for each hold, relative to its carry point (meters) and turned
// (radians, x then y then z).
const GUN_POSE = {
  aim: { pos: [-0.05, 0.15, -0.04], rot: [0.04, 0, 0] },
  sprint: { pos: [-0.07, -0.04, 0.06], rot: [-0.45, 0.85, 0.35] },
};

// Gait: one stride (half a leg cycle) covers this many meters, from walking to sprinting, so
// the feet plant instead of sliding.
const STRIDE_MIN = 0.9;
const STRIDE_MAX = 1.6;
// The hips turn toward where the body is going (at most this far off the aim) while the spine
// turns back, so the torso and gun stay on the aim.
const HIP_TURN = 70 * (Math.PI / 180);
const LEAN_MAX = 8 * (Math.PI / 180);

const ARM_BONES = [['UR', 'armUR'], ['LR', 'armLR'], ['UL', 'armUL'], ['LL', 'armLL']];
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _e = new THREE.Euler();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
      // Big shoulder pads with a light strip on the outside. They ride the torso, not the
      // arm, so they stay on the shoulders when the gun comes up.
      ['spine', [x + 0.01 * s, 1.45, 0], [0.22, 0.16, 0.28], 'armor'],
      ['spine', [x + 0.121 * s, 1.45, 0], [0.012, 0.045, 0.22], 'strip'],
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

    // The spine turns (against the hips) before it pitches with the aim.
    this.bones.spine.rotation.order = 'YXZ';

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
    // Each gun bone's resting place, for the holds to move it from.
    this.gunRest = {};
    for (const [id, bone] of Object.entries(r.gunBones)) this.gunRest[id] = this.bones[bone].position.clone();
    this.setWeapon(guns[0]);

    this.shieldFlash = 0;
    this.phase = 0;
    this.crouch = 0;
    this.air = 0;
    this.climb = 0;
    this.hipYaw = 0;
    this.back = 0;
    this.lean = 0;
    this.prevSide = 0;
    this.sideAcc = 0;
    this.airT = 0;
    this.lands = 0;
    this.landT = 9;
    this.landHard = 0;
    this.airJumps = 0;
    this.kickT = 9;
    this.kickAmount = 0;
    this.shotT = -1;
    this.aimW = 0;
    this.sprintW = 0;
    this.djT = 9;
    // Event counters start from the first state seen.
    this.seen = false;
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    // The old gun goes back to its rest (it's hidden, but its bone keeps the hold's offset).
    const old = this.rig.gunBones[this.weaponId];
    if (old) {
      this.bones[old].position.copy(this.gunRest[this.weaponId]);
      this.bones[old].rotation.set(0, 0, 0);
    }
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

  // state: { x, y, z (feet), yaw, pitch, speed, grounded, crouched, climbing } plus optional
  // fwd and side (velocity along the facing and to the right), velY, sprinting, aiming, lands
  // and airJumps (event counters), landSpeed, shotT (game time of the last shot), fireT (time
  // since it) and kick (the gun's recoil). Training dummies pass only the basics.
  update(dt, s) {
    const g = this.group;
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.yaw;

    const B = this.bones;
    const speed = s.speed;
    const fwd = s.fwd ?? speed;
    const side = s.side ?? 0;
    const velY = s.velY ?? 0;
    // Events since the last frame.
    if (!this.seen) {
      this.seen = true;
      this.lands = s.lands ?? 0;
      this.airJumps = s.airJumps ?? 0;
      this.shotT = s.shotT ?? -1;
    }
    if ((s.lands ?? 0) !== this.lands) {
      this.lands = s.lands;
      this.landT = 0;
      this.landHard = clamp(((s.landSpeed ?? 0) - 3) / 10, 0, 1);
    }
    let kicked = false;
    if ((s.airJumps ?? 0) !== this.airJumps) {
      this.airJumps = s.airJumps;
      kicked = true;
    }
    if ((s.shotT ?? -1) !== this.shotT) {
      this.shotT = s.shotT;
      this.kickT = 0;
      this.kickAmount = s.kick ?? 1;
    }
    this.landT += dt;
    this.kickT += dt;
    this.djT = kicked ? 0 : this.djT + dt;

    this.crouch += ((s.crouched ? 1 : 0) - this.crouch) * damp(12, dt);
    this.air += ((s.grounded || s.climbing ? 0 : 1) - this.air) * damp(10, dt);
    this.climb += ((s.climbing ? 1 : 0) - this.climb) * damp(10, dt);
    this.airT = s.grounded || s.climbing ? 0 : this.airT + dt;
    const ground = (1 - this.air) * (1 - this.climb);

    // Which way the legs run: the move direction off the facing (0 ahead, + to the right);
    // backpedaling runs the legs backward, facing the aim.
    let ang = Math.atan2(side, fwd);
    const back = speed > 0.5 && Math.abs(ang) > 1.75;
    if (back) ang -= Math.sign(ang) * Math.PI;
    const turn = speed > 0.5 ? -clamp(ang, -HIP_TURN, HIP_TURN) : 0;
    this.hipYaw += (turn * ground - this.hipYaw) * damp(9, dt);
    this.back += ((back ? 1 : 0) - this.back) * damp(9, dt);
    // Feet plant: the cycle advances with the distance covered.
    const stride = clamp(0.55 + speed * 0.12, STRIDE_MIN, STRIDE_MAX);
    this.phase += ((speed * dt) / stride) * Math.PI * (this.back > 0.5 ? -1 : 1);
    const run = Math.min(1, speed / 5) * ground * (1 - this.crouch * 0.4);
    const sn = Math.sin(this.phase);
    const sw = sn * 0.75 * run;

    // Air: a quick takeoff crouch, a tuck while rising, legs reaching down when falling, and a
    // knee kick on the double jump.
    const rising = clamp(velY / 6, 0, 1);
    const falling = clamp(-velY / 8, 0, 1);
    const takeoff = this.airT > 0 && this.airT < 0.08 ? 1 - this.airT / 0.08 : 0;
    const dj = this.djT < 0.3 ? Math.sin((this.djT / 0.3) * Math.PI) : 0;
    const tuck = this.air * (0.35 + rising * 0.45 + takeoff * 0.4 - falling * 0.25);
    // Landing squash: the hips drop (up to 8 cm on a hard landing) and come back up.
    const lt = this.landT;
    const squash = this.landHard * 0.08 * (lt < 0.06 ? lt / 0.06 : Math.max(0, 1 - (lt - 0.06) / 0.2));
    const bend = this.crouch + squash / 0.32;

    B.hips.position.y = 0.95 - this.crouch * 0.32 - squash - Math.abs(Math.cos(this.phase)) * 0.03 * run;
    B.hips.rotation.y = this.hipYaw;
    B.hips.rotation.z = sn * 0.07 * run;
    B.legUL.rotation.x = sw + tuck * 1.2 + dj * 0.9 + bend * 1.0;
    B.legUR.rotation.x = -sw + tuck * 0.8 + dj * 0.2 + bend * 1.0;
    B.legLL.rotation.x = -Math.max(0, -sn) * 1.1 * run - tuck * 1.6 - dj * 0.3 - bend * 1.7;
    B.legLR.rotation.x = -Math.max(0, sn) * 1.1 * run - tuck * 1.2 - dj * 1.3 - bend * 1.7;

    // Lean into sideways acceleration, at most 8 degrees.
    if (dt > 0) {
      this.sideAcc += ((side - this.prevSide) / dt - this.sideAcc) * damp(6, dt);
      this.prevSide = side;
    }
    const leanTo = clamp(-this.sideAcc * 0.012, -LEAN_MAX, LEAN_MAX) * ground;
    this.lean += (leanTo - this.lean) * damp(8, dt);
    B.root.rotation.z = this.lean;

    // The spine turns back against the hips (so the torso faces the aim) and carries the aim
    // pitch, so the arms and gun follow it together; each shot kicks it up a little.
    const kick = this.kickT < 0.25 ? this.kickAmount * 0.035 * Math.exp(-this.kickT * 14) : 0;
    B.spine.rotation.y = -this.hipYaw;
    B.spine.rotation.x = s.pitch * 0.5 - this.crouch * 0.25 + kick;
    B.head.rotation.x = s.pitch * 0.35;

    // The gun: at the shoulder while firing or zoomed, across the chest while sprinting,
    // otherwise at the hip; the arms reach up instead while climbing.
    const aiming = s.aiming || (s.fireT ?? 99) < 0.6;
    this.aimW += ((aiming ? 1 : 0) - this.aimW) * damp(14, dt);
    this.sprintW += ((s.sprinting && !aiming && speed > 1 ? 1 : 0) - this.sprintW) * damp(8, dt);
    const k = this.climb;
    for (const [seg, name] of ARM_BONES) {
      _qa.slerpQuaternions(ARM_POSE.hold[seg], ARM_POSE.aim[seg], this.aimW);
      _qb.copy(_qa).slerp(ARM_POSE.sprint[seg], this.sprintW);
      B[name].quaternion.slerpQuaternions(_qb, ARM_POSE.up[seg], k);
    }
    const bone = this.rig.gunBones[this.weaponId];
    if (bone) {
      const gb = B[bone];
      const rest = this.gunRest[this.weaponId];
      const a = this.aimW * (1 - k);
      const sp = this.sprintW * (1 - k);
      const A = GUN_POSE.aim;
      const S = GUN_POSE.sprint;
      gb.position.set(
        rest.x + A.pos[0] * a + S.pos[0] * sp,
        rest.y + A.pos[1] * a + S.pos[1] * sp,
        rest.z + A.pos[2] * a + S.pos[2] * sp + kick * 0.6,
      );
      _e.set(A.rot[0] * a + S.rot[0] * sp + kick * 0.5, A.rot[1] * a + S.rot[1] * sp, A.rot[2] * a + S.rot[2] * sp);
      gb.rotation.copy(_e);
    }

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
