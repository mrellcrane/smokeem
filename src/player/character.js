import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp } from '../util/math.js';
import { GUNS, allParts } from '../combat/guns/index.js';
import { GLOVE, GLOW, SCREEN } from '../combat/weaponModels.js';
import { JOINTS as BODY_JOINTS, BONES as BODY_BONES, HANDS, REGIONS, DATA } from './body/bodyMesh.js';

// The contestant body: an armored soldier (a CC0 model, see body/CREDITS.md) with a wraparound
// amber visor and a smoker canister on the back. Smooth-skinned to a 16-bone body skeleton plus
// one bone per gun in the match's set, so each body is a single draw call (plus its shadow) no
// matter how it's posed. tools/build_body.mjs turns the model into body/bodyMesh.js.
// Faces -z like the camera; its right side is +x.
// Body language (update): the legs run toward where the body is going while the torso and gun
// stay on the aim, feet plant and stay level, jumps tuck and land with a squash, and the gun
// rides at the hip, at the shoulder when firing or zoomed, or across the chest when sprinting,
// with both hands reaching for it (two-bone arm IK onto each gun's grips).

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
  footL: 'legLL',
  footR: 'legLR',
  handL: 'armLL',
  handR: 'armLR',
};
const JOINTS = Object.fromEntries(BODY_BONES.map((n) => [n, BODY_JOINTS[n]]));
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

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

// Legs: rest vectors (hip socket to knee, knee to ankle) and heights, for keeping the feet on
// the ground whatever the leg angles are.
const LEG = (() => {
  const hip = v3(JOINTS.legUR);
  const knee = v3(JOINTS.legLR);
  const ankle = v3(JOINTS.footR);
  return {
    thigh: knee.clone().sub(hip),
    shin: ankle.clone().sub(knee),
    hipsY: JOINTS.hips[1],
    socketDrop: JOINTS.hips[1] - hip.y,
    ankleY: ankle.y,
  };
})();
// How far below the hip socket the ankle sits with the thigh turned `a` and the knee `b` (radians
// about x; the hips' small roll and turn are left out).
function legDrop(a, b) {
  const t = LEG.thigh;
  const s = LEG.shin;
  return -(t.y * Math.cos(a) - t.z * Math.sin(a)) - (s.y * Math.cos(a + b) - s.z * Math.sin(a + b));
}
const LEG_REST_DROP = legDrop(0, 0);

// Arms: two-bone IK in the spine's frame (arms and guns both hang off the spine). Each segment
// turns from its own rest direction (the model's slight A-pose), and the upper arm's twist keeps
// the elbow hinge in the plane the elbow bends in, so it folds like a person's.
const FORWARD = new THREE.Vector3(0, 0, -1);
// The rotation taking x to `axis` and y to `palm` (made square to the axis).
function frame(axis, palm) {
  const x = axis.clone().normalize();
  const y = palm.clone().addScaledVector(x, -palm.dot(x)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
}
const ARM = {};
const SIDES = ['R', 'L'];
for (const s of ['L', 'R']) {
  const sh = v3(JOINTS[`armU${s}`]);
  const el = v3(JOINTS[`armL${s}`]);
  const wr = v3(JOINTS[`hand${s}`]);
  const restU = el.clone().sub(sh).normalize();
  const restL = wr.clone().sub(el).normalize();
  const restH = restU.clone().cross(FORWARD).normalize();
  const m = new THREE.Matrix4().makeBasis(restU, restH, restU.clone().cross(restH));
  const sign = s === 'R' ? 1 : -1;
  ARM[s] = {
    upper: `armU${s}`,
    lower: `armL${s}`,
    hand: `hand${s}`,
    handRestInv: frame(v3(HANDS[s].axis), v3(HANDS[s].palm)).invert(),
    shoulder: sh.clone().sub(v3(JOINTS.spine)),
    l1: sh.distanceTo(el),
    l2: el.distanceTo(wr),
    restL,
    restInv: new THREE.Quaternion().setFromRotationMatrix(m).invert(),
    // Which way the elbow points: the trigger arm's out and down, the support arm's down.
    pole: (s === 'R' ? new THREE.Vector3(0.75, -1, 0.35) : new THREE.Vector3(-0.45, -1, 0.15)).normalize(),
    // Climbing: reaching up, elbows out and back.
    upDir: new THREE.Vector3(0.05 * sign, 1, -0.25).normalize(),
    upPole: new THREE.Vector3(0.5 * sign, 0, 1).normalize(),
  };
}

// Where the hands go on each gun, in gun space: each fist closes on the first-person glove box
// (each gun's `hands`: the trigger hand first, the support hand fourth). The trigger hand
// wraps the grip from the right, knuckles up and forward; the support hand cradles the gun from
// below (or holds a carry handle from above), fingers forward and to the right. A one-handed gun
// gets the support hand cupped under the trigger hand. Each grip: the wrist's place and the
// hand's turn in gun space.
const FIST = 0.075; // wrist to the middle of the curled fist
function grip(center, axis, palm) {
  const q = frame(axis, palm);
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  return { wrist: v3(center).addScaledVector(x, -FIST).addScaledVector(y, -0.025), q };
}
const _gripCache = {};
function grips(id) {
  const key = id ?? 'none';
  if (_gripCache[key]) return _gripCache[key];
  const h = GUNS[id]?.hands ?? GUNS.hickory.hands;
  const r = h[0][0];
  const right = grip(r, new THREE.Vector3(-0.25, 0.55, -0.8), new THREE.Vector3(-1, 0, 0));
  let left;
  if (!h[3]) left = grip([r[0] - 0.035, r[1] - 0.06, r[2] + 0.01], new THREE.Vector3(0.5, 0.4, -0.75), new THREE.Vector3(0.3, 1, 0));
  else if (h[3][0][1] > 0.05) left = grip(h[3][0], new THREE.Vector3(0.5, -0.2, -0.85), new THREE.Vector3(0, -1, 0));
  else left = grip(h[3][0], new THREE.Vector3(0.45, 0.35, -0.82), new THREE.Vector3(0, 1, 0));
  // How far back along the gun the support hand may slide when the arm can't reach its grip.
  left.slideMax = h[3] ? Math.max(0, r[2] - h[3][0][2] - 0.08) : 0;
  return (_gripCache[key] = { right, left });
}
const DEFAULT_CARRY = GUNS.hickory.carry;

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
// How much of the stride's leg reach the hips follow down (1 would plant the feet exactly).
const STRIDE_DIP = 0.35;
// The crouch: thighs, knees (radians) and the torso's forward lean. Deep enough that the helmet
// stays inside the crouched capsule (1.2 m) and above its head line (0.88 m).
const CROUCH = { thigh: 1.45, knee: -2.45, lean: 0.45 };
// How the aim's pitch is shared: the spine bends with part of it (the arms and gun ride it), the
// head nods the rest of the way to the aim, and the gun tips about its grip to nearly the aim
// (less when aiming down, so a crouched gun stays off the floor).
const PITCH = { spine: 0.38, head: 0.47, gunUp: 0.5, gunDown: 0.3 };
// The hips turn toward where the body is going (at most this far off the aim) while the spine
// turns back, so the torso and gun stay on the aim.
const HIP_TURN = 70 * (Math.PI / 180);
const LEAN_MAX = 8 * (Math.PI / 180);
// Backpedaling starts past this move angle and stops under the second, so a stick held near a
// pure strafe doesn't swing the hips across.
const BACK_ENTER = 115 * (Math.PI / 180);
const BACK_LEAVE = 85 * (Math.PI / 180);

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _qg = new THREE.Quaternion();
const _z = new THREE.Vector3();
const _o = new THREE.Vector3();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _gq = new THREE.Quaternion();
const _gp = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _u = new THREE.Vector3();
const _h = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();
const _el = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Turn an arm so its wrist reaches `target` (spine space) with the elbow toward `pole`; writes
// the two segment rotations into qu (upper arm, in the spine's frame) and ql (forearm, in the
// upper arm's). Out of reach, the arm points at the target, nearly straight.
function solveArm(A, target, pole, qu, ql) {
  _d.subVectors(target, A.shoulder);
  let dist = _d.length();
  _d.divideScalar(dist || 1);
  dist = clamp(dist, Math.abs(A.l1 - A.l2) + 0.01, (A.l1 + A.l2) * 0.995);
  const cosA = clamp((A.l1 * A.l1 + dist * dist - A.l2 * A.l2) / (2 * A.l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0).addScaledVector(_d, _d.y);
  _p.normalize();
  _u.copy(_d).multiplyScalar(cosA).addScaledVector(_p, sinA);
  _el.copy(A.shoulder).addScaledVector(_u, A.l1);
  _l.copy(A.shoulder).addScaledVector(_d, dist).sub(_el).normalize();
  _h.crossVectors(_p, _d).normalize();
  _w.crossVectors(_u, _h);
  _m.makeBasis(_u, _h, _w);
  qu.setFromRotationMatrix(_m).multiply(A.restInv);
  _qc.copy(qu).invert();
  _l.applyQuaternion(_qc);
  ql.setFromUnitVectors(A.restL, _l);
}

// The undersuit is mid charcoal, so the armor's color and the body's shape read against dark
// walls and shade. Gloves match the first-person ones.
const SUIT = 0x454b54;
const BOOT = 0x2c2f35;
const METAL = 0x33373c;
const EMBER = 0xff7a1a;

// How much a part glows on its own (ignores light and shadow): visor and canister ember ring
// fully, the team-color light strips a little less, glowing bits of the held gun some.
const GLOWS = { visor: 1, ember: 1, strip: 0.9 };
const GUN_GLOWS = { [GLOW]: 0.8, [SCREEN]: 0.8 };

// The body as decoded from the generated data, once per page load and shared by every body
// (read only).
let bodyBase = null;
function base() {
  if (bodyBase) return bodyBase;
  const bytes = (s) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const n = DATA.count;
  const p16 = new Int16Array(bytes(DATA.position).buffer);
  const n8 = new Int8Array(bytes(DATA.normal).buffer);
  const s8 = new Int8Array(bytes(DATA.shell).buffer);
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  // The shield shell: every vertex pushed 1.75 cm out along the average normal at its place.
  const shell = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    position[i] = p16[i] / 8192;
    normal[i] = n8[i] / 127;
    shell[i] = position[i] + (s8[i] / 127) * 0.0175;
  }
  const w8 = bytes(DATA.skinWeight);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) skinWeight[i] = w8[i] / 255;
  bodyBase = {
    count: n,
    position,
    normal,
    shell,
    region: bytes(DATA.region),
    skinIndex: new Uint16Array(bytes(DATA.skinIndex)),
    skinWeight,
    index: new Uint16Array(bytes(DATA.index).buffer),
  };
  return bodyBase;
}

// Per-vertex color, glow and team color: vertex i takes entry pick(i) of the palette.
function paint(n, palette, glows, pick, team) {
  const col = new Float32Array(n * 3);
  const glow = new Float32Array(n);
  const tm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = pick(i);
    const c = palette[k];
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    glow[i] = glows[k];
    tm[i * 3] = team.r;
    tm[i * 3 + 1] = team.g;
    tm[i * 3 + 2] = team.b;
  }
  return { col, glow, tm };
}

function buildGeometry(colors, inflate, r) {
  const geoms = [];
  // The body.
  const b = base();
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(inflate ? b.shell : b.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
    const palette = REGIONS.map((name) => new THREE.Color().set(colors[name]));
    const glows = REGIONS.map((name) => GLOWS[name] ?? 0);
    const { col, glow, tm } = paint(b.count, palette, glows, (i) => b.region[i], colors.armor);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Self-glow and the body's team color, for the rim light (see bodyMaterial).
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    g.setAttribute('aTeam', new THREE.BufferAttribute(tm, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(b.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(b.skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(b.index, 1));
    geoms.push(g);
  }
  // Every weapon is baked in on its own bone; the ones not held are scaled to nothing.
  for (const [id, bone] of Object.entries(r.gunBones)) {
    const j = r.joints[bone];
    const bi = r.names.indexOf(bone);
    for (const [c, size, color] of allParts(id)) {
      const pad = inflate ? 0.035 : 0;
      const g = new THREE.BoxGeometry(size[0] + pad, size[1] + pad, size[2] + pad);
      g.deleteAttribute('uv');
      g.translate(j[0] + c[0], j[1] + c[1], j[2] + c[2]);
      const n = g.attributes.position.count;
      const part = [new THREE.Color().set(color ?? colors.armor)];
      const { col, glow, tm } = paint(n, part, [color === null ? 0 : GUN_GLOWS[color] ?? 0], () => 0, colors.armor);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
      g.setAttribute('aTeam', new THREE.BufferAttribute(tm, 3));
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
      ember: EMBER,
      glove: GLOVE,
      // Light strips: the armor color, lifted toward white.
      strip: armorColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
    };
    colors.panel = colors.trim;

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

    // The spine turns (against the hips) before it pitches with the aim. The hips roll about the
    // aim's forward axis (roll after turn), so the spine's counter-turn cancels the turn exactly
    // and the stride roll never becomes a torso nod while strafing.
    this.bones.spine.rotation.order = 'YXZ';
    this.bones.hips.rotation.order = 'ZYX';

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
    // With no gun shown, the hands still hold where a rifle would be.
    this.noGunRest = v3(DEFAULT_CARRY).sub(v3(JOINTS.spine));
    this.grips = grips(null);
    this.setWeapon(guns[0]);

    this.phase = 0;
    this.lands = this.airJumps = this.shots = 0;
    this.reset();
  }

  // Back to a standing rest (a new body, or a respawn): nothing smoothed or counted carries
  // over from the last life.
  reset() {
    this.crouch = this.air = this.climb = this.airT = 0;
    this.hipYaw = this.back = this.lean = 0;
    this.backOn = false;
    this.prevSide = this.sideAcc = 0;
    this.landT = this.kickT = this.djT = 9;
    this.landHard = this.kickAmount = 0;
    this.aimW = this.sprintW = 0;
    this.gunTip = 0;
    this.shieldFlash = 0;
    this.shell.visible = false;
    // Event counters start from the first state seen.
    this.seen = false;
  }

  // A shot fired out of a sprint: drop the sprint hold now and move the gun bone, so this very
  // shot's third-person flash and tracer already leave the gun at the hold (the arms follow on
  // the next update).
  endSprint() {
    if (this.sprintW === 0) return;
    this.sprintW = 0;
    const bone = this.rig.gunBones[this.weaponId];
    if (!bone) return;
    const gb = this.bones[bone];
    const rest = this.gunRest[this.weaponId];
    const a = this.aimW * (1 - this.climb);
    const A = GUN_POSE.aim;
    gb.position.set(rest.x + A.pos[0] * a, rest.y + A.pos[1] * a, rest.z + A.pos[2] * a);
    gb.rotation.set(A.rot[0] * a + this.gunTip, A.rot[1] * a, A.rot[2] * a);
    // (The spine's world matrix is current from the last render.)
    gb.updateWorldMatrix(false, false);
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
    this.grips = grips(this.rig.gunBones[id] ? id : null);
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
  // fwd and side (velocity along the facing and to the right), velY, sprinting, aiming, lands,
  // airJumps and shots (event counters), landSpeed, fireT (time since the last shot), fireHold
  // (how long after a shot the gun stays at the shoulder) and kick (the gun's recoil).
  // Training dummies pass only the basics plus fwd and side.
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
      this.shots = s.shots ?? 0;
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
    if ((s.shots ?? 0) !== this.shots) {
      this.shots = s.shots;
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
    this.backOn = speed > 0.5 && Math.abs(ang) > (this.backOn ? BACK_LEAVE : BACK_ENTER);
    const back = this.backOn;
    if (back) ang -= Math.sign(ang) * Math.PI;
    const turn = speed > 0.5 ? -clamp(ang, -HIP_TURN, HIP_TURN) : 0;
    this.hipYaw += (turn * ground - this.hipYaw) * damp(9, dt);
    this.back += ((back ? 1 : 0) - this.back) * damp(9, dt);
    // Feet plant: the cycle advances with the distance covered.
    const stride = clamp(0.55 + speed * 0.12, STRIDE_MIN, STRIDE_MAX);
    this.phase += ((speed * dt) / stride) * Math.PI * (this.back > 0.5 ? -1 : 1);
    const run = Math.min(1, speed / 5) * ground * (1 - this.crouch * 0.6);
    const sn = Math.sin(this.phase);
    const sw = sn * 0.75 * run;

    // Air: a quick takeoff crouch, a tuck while rising, legs reaching down when falling, and a
    // knee kick on the double jump.
    const rising = clamp(velY / 6, 0, 1);
    const falling = clamp(-velY / 8, 0, 1);
    const takeoff = this.airT > 0 && this.airT < 0.08 ? 1 - this.airT / 0.08 : 0;
    const dj = this.djT < 0.3 ? Math.sin((this.djT / 0.3) * Math.PI) : 0;
    const tuck = this.air * (0.35 + rising * 0.45 + takeoff * 0.4 - falling * 0.25);
    // Landing squash: the knees give (up to about 8 cm of hip drop on a hard landing) and come
    // back up.
    const lt = this.landT;
    const squash = this.landHard * 0.25 * (lt < 0.06 ? lt / 0.06 : Math.max(0, 1 - (lt - 0.06) / 0.2));
    // Crouching squats deep (the crouched capsule is only 1.2 m tall).
    const thighBend = this.crouch * CROUCH.thigh + squash;
    const kneeBend = this.crouch * CROUCH.knee - squash * 1.7;

    const aL = sw + tuck * 1.2 + dj * 0.9 + thighBend;
    const aR = -sw + tuck * 0.8 + dj * 0.2 + thighBend;
    const bL = -Math.max(0, -sn) * 1.1 * run - tuck * 1.6 - dj * 0.3 + kneeBend;
    const bR = -Math.max(0, sn) * 1.1 * run - tuck * 1.2 - dj * 1.3 + kneeBend;
    B.legUL.rotation.x = aL;
    B.legUR.rotation.x = aR;
    B.legLL.rotation.x = bL;
    B.legLR.rotation.x = bR;
    // The hips drop as far as the knees bend (crouch, landing squash), so the feet stay on the
    // floor, and part of the way with the stride: planting the feet fully would bob the head
    // through the head line at a run.
    const bent = legDrop(thighBend, kneeBend);
    const strideDip = Math.max(0, bent - Math.max(legDrop(aL, bL), legDrop(aR, bR)));
    B.hips.position.y = LEG.hipsY - (LEG_REST_DROP - bent) - strideDip * STRIDE_DIP * ground;
    B.hips.rotation.set(0, this.hipYaw, sn * 0.07 * run);
    // Feet stay flat through a crouch and roll heel to toe with the stride; in the air the toes
    // hang.
    const flat = thighBend + kneeBend;
    B.footL.rotation.x = (-flat - (aL + bL - flat) * 0.75) * ground + (0.3 - (aL + bL) * 0.5) * (1 - ground);
    B.footR.rotation.x = (-flat - (aR + bR - flat) * 0.75) * ground + (0.3 - (aR + bR) * 0.5) * (1 - ground);

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
    B.spine.rotation.set(s.pitch * PITCH.spine - this.crouch * CROUCH.lean + kick, -this.hipYaw, 0);
    B.head.rotation.x = s.pitch * PITCH.head + this.crouch * CROUCH.lean * 0.6;

    // The gun: at the shoulder while firing or zoomed, across the chest while sprinting,
    // otherwise at the hip; the arms reach up instead while climbing.
    const aiming = s.aiming || (s.fireT ?? 99) < (s.fireHold ?? 0.6);
    this.aimW += ((aiming ? 1 : 0) - this.aimW) * damp(14, dt);
    this.sprintW += ((s.sprinting && !aiming && speed > 1 ? 1 : 0) - this.sprintW) * damp(8, dt);
    const k = this.climb;
    const a = this.aimW * (1 - k);
    const sp = this.sprintW * (1 - k);
    const A = GUN_POSE.aim;
    const S = GUN_POSE.sprint;
    const bone = this.rig.gunBones[this.weaponId];
    const rest = bone ? this.gunRest[this.weaponId] : this.noGunRest;
    _gp.set(
      rest.x + A.pos[0] * a + S.pos[0] * sp,
      rest.y + A.pos[1] * a + S.pos[1] * sp,
      rest.z + A.pos[2] * a + S.pos[2] * sp + kick * 0.6,
    );
    // The gun tips with the aim on top of the spine's pitch (and stays level through a crouch's
    // forward lean); out of a sprint endSprint() uses the same tip.
    this.gunTip = s.pitch * (s.pitch > 0 ? PITCH.gunUp : PITCH.gunDown) * (1 - k) + this.crouch * CROUCH.lean * 0.9;
    _e.set(A.rot[0] * a + S.rot[0] * sp + kick * 0.5 + this.gunTip, A.rot[1] * a + S.rot[1] * sp, A.rot[2] * a + S.rot[2] * sp);
    if (bone) {
      B[bone].position.copy(_gp);
      B[bone].rotation.copy(_e);
    }
    // Both hands on the gun (spine space), or reaching up to climb. The support hand slides back
    // along the gun when its grip is out of reach.
    _gq.setFromEuler(_e);
    for (const sd of SIDES) {
      const arm = ARM[sd];
      const gr = sd === 'R' ? this.grips.right : this.grips.left;
      _t.copy(gr.wrist).applyQuaternion(_gq).add(_gp);
      if (gr.slideMax > 0) {
        _z.set(0, 0, 1).applyQuaternion(_gq);
        _o.subVectors(_t, arm.shoulder);
        const reach = (arm.l1 + arm.l2) * 0.97;
        const c = _o.lengthSq() - reach * reach;
        if (c > 0) {
          const bz = _o.dot(_z);
          const disc = bz * bz - c;
          _t.addScaledVector(_z, clamp(disc >= 0 ? -bz - Math.sqrt(disc) : -bz, 0, gr.slideMax));
        }
      }
      solveArm(arm, _t, arm.pole, _qa, _qb);
      // The hand turns to its grip: its rest frame onto the grip's, as seen from the forearm.
      _qf.copy(_gq).multiply(gr.q).multiply(arm.handRestInv);
      _qg.copy(_qa).multiply(_qb).invert().multiply(_qf);
      const qu = B[arm.upper].quaternion;
      const ql = B[arm.lower].quaternion;
      const qh = B[arm.hand].quaternion;
      if (k > 0.001) {
        _t.copy(arm.shoulder).addScaledVector(arm.upDir, (arm.l1 + arm.l2) * 0.97);
        solveArm(arm, _t, arm.upPole, _qd, _qe);
        qu.slerpQuaternions(_qa, _qd, k);
        ql.slerpQuaternions(_qb, _qe, k);
        qh.identity().slerp(_qg, 1 - k);
      } else {
        qu.copy(_qa);
        ql.copy(_qb);
        qh.copy(_qg);
      }
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
