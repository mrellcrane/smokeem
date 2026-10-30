import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp } from '../util/math.js';
import { BODY } from '../config.js';
import { GUNS, allParts } from '../combat/guns/index.js';
import { FINISHES, GLOVE, finishOf, partGeometry, showsAtLow } from '../combat/weaponModels.js';
import { JOINTS as BODY_JOINTS, BONES as BODY_BONES, HANDS, REGIONS, DATA } from './body/bodyMesh.js';
import { castBody } from './body/cast.js';
import { viewmodelUniforms } from './viewmodel.js';
import { envUniforms } from '../render/reflections.js';

// The contestant body: an armored soldier (a CC0 model, see body/CREDITS.md) in a Halo Mark VI
// style helmet with a big gold visor, gloved fists and a smoker canister on the back. Smooth-skinned to a 16-bone body skeleton plus
// one bone per gun in the match's set, so each body is a single draw call (plus its shadow) no
// matter how it's posed. tools/build_body.mjs turns the model into body/bodyMesh.js.
// Faces -z like the camera; its right side is +x.
// Body language (update): the legs run toward where the body is going while the torso and gun
// stay on the aim, feet plant and stay level, jumps tuck and land with a squash, and the gun
// rides at the hip, at the shoulder when firing or zoomed, or across the chest when sprinting,
// with both hands reaching for it (two-bone arm IK onto each gun's grips) and the torso turned a
// little into a bladed stance. Whatever the pose,
// the helmet stays inside the hitbox's head band, so a shot at the visible head is a headshot.
// Each body breathes on its own phase.

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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The skeleton for a body carrying these guns: the body bones plus one bone per gun, at the
// gun's grip point (each gun module's `carry`), hung off the spine.
// Dual-wield guns get a second bone for the left hand, at the mirror image of the carry.
function rig(guns) {
  const joints = { ...JOINTS };
  const parent = { ...PARENT };
  const gunBones = {};
  const leftBones = {};
  for (const id of guns) {
    const bone = `gun:${id}`;
    joints[bone] = GUNS[id].carry;
    parent[bone] = 'spine';
    gunBones[id] = bone;
    if (!GUNS[id].def.dual) continue;
    const c = GUNS[id].carry;
    joints[`${bone}:L`] = [-c[0], c[1], c[2]];
    parent[`${bone}:L`] = 'spine';
    leftBones[id] = `${bone}:L`;
  }
  return { joints, parent, gunBones, leftBones, names: [...BODY_BONES, ...Object.values(gunBones), ...Object.values(leftBones)] };
}

// Legs: rest vectors (hip socket to knee, knee to ankle) and heights, for keeping the feet on
// the ground whatever the leg angles are; plus each segment's length and rest angle (about x,
// from straight down toward the front) in the leg's swing plane, for the leg solve.
const LEG = (() => {
  const hip = v3(JOINTS.legUR);
  const knee = v3(JOINTS.legLR);
  const ankle = v3(JOINTS.footR);
  const thigh = knee.clone().sub(hip);
  const shin = ankle.clone().sub(knee);
  return {
    thigh,
    shin,
    hipsY: JOINTS.hips[1],
    lt: Math.hypot(thigh.y, thigh.z),
    ls: Math.hypot(shin.y, shin.z),
    at: Math.atan2(-thigh.z, -thigh.y),
    as: Math.atan2(-shin.z, -shin.y),
    restZ: thigh.z + shin.z,
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
// The thigh and knee turns that keep the ankle where it stands at rest with the hips `drop`
// lower and `back` behind it, the knee bending forward. Writes out.thigh and out.knee.
function legSolve(drop, back, out) {
  const L = LEG;
  const v = LEG_REST_DROP - drop;
  const z = L.restZ - back;
  const d = clamp(Math.hypot(v, z), Math.abs(L.lt - L.ls) + 0.01, L.lt + L.ls - 1e-4);
  const dir = Math.atan2(-z, v);
  const hip = Math.acos(clamp((L.lt * L.lt + d * d - L.ls * L.ls) / (2 * L.lt * d), -1, 1));
  const knee = Math.acos(clamp((L.ls * L.ls + d * d - L.lt * L.lt) / (2 * L.ls * d), -1, 1));
  out.thigh = dir + hip - L.at;
  out.knee = dir - knee - L.as - out.thigh;
  return out;
}

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
    // Which way the elbow points: the trigger arm's out and down, the support arm's down and out.
    pole: (s === 'R' ? new THREE.Vector3(0.75, -1, 0.35) : new THREE.Vector3(-0.7, -1, 0.15)).normalize(),
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
  // (Raised off the first-person glove, which sits under the gun, so the fist closes on it.)
  else left = grip([h[3][0][0], h[3][0][1] + 0.03, h[3][0][2]], new THREE.Vector3(0.45, 0.35, -0.82), new THREE.Vector3(0, 1, 0));
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
// A gun carried at least this high (the launcher, at the shoulder) rests on the pauldron in the
// aim hold all the time, sprinting too.
const SHOULDER_CARRY = 1.3;
// Every hold sits this much nearer the chest than the gun's carry point (meters, +z back), so the
// arms bend instead of reaching out straight; the launcher sits further forward on the pauldron so
// its trigger hand isn't folded up against the shoulder.
const HOLD_BACK = 0.05;
const SHOULDER_FORWARD = -0.17;
// The support shoulder comes forward (spine space, meters) as far as this when the gun's fore
// grip is out of the arm's reach, before the hand slides back along the gun.
const PROTRACT = new THREE.Vector3(0.025, -0.01, -0.07);
// Holding a gun in both hands the torso turns this far (radians, about its own axis) to bring the
// support shoulder forward, a bladed stance; the gun stays on the aim.
const TWIST = -0.22;
// How far the support hand reaches along the gun, as a share of the arm's length: at 0.88 the
// elbow stays bent about 125 degrees.
const SUPPORT_REACH = 0.88;

// Gait: one stride (half a leg cycle) covers this many meters, from walking to sprinting, so
// the feet plant instead of sliding.
const STRIDE_MIN = 0.9;
const STRIDE_MAX = 1.6;
export const strideLength = (speed) => clamp(0.55 + speed * 0.12, STRIDE_MIN, STRIDE_MAX);
// How much of the stride's leg reach the hips follow down (1 would plant the feet exactly), and
// at most how far (meters); where the helmet would drop under the head line the head-band fit
// gives the dip back.
const STRIDE_DIP = 0.35;
const STRIDE_DIP_MAX = 0.06;
// The crouch: the hips drop and sit back (meters; the legs fold to keep the feet planted) and
// the torso leans forward (radians), so the helmet lands inside the crouched capsule.
const CROUCH = { drop: 0.5, back: 0.1, lean: 0.6 };
// How the aim's pitch is shared: the spine bends with about a third of it (the arms and gun ride
// it), easing off toward spineMax, and the gun tips about its grip the rest of the way to nearly
// the aim (less when aiming down, and less again crouched, so a crouched gun stays off the floor).
const PITCH = { spine: 0.32, spineMax: 0.42, gunUp: 0.88, gunDown: 0.68, crouchDown: 0.36 };
// The head tips with part of the aim, clamped (radians from level; tipped further, the swept
// helmet stands taller than the head band), about a pivot this far above the head joint (the
// top of the neck). It then moves up or down to keep the helmet in the hitbox's head band: from
// a little under the head line (Player.headLineY: 0.32 under the capsule top) to a little over
// the top (meters).
const HEAD = { share: 0.5, down: -0.2, up: 0.3, pivot: 0.08, line: 0.32, below: 0.015, above: 0.02 };
// Idle breathing: radians of spine pitch, and radians per second (each body has its own phase).
const BREATH = { amount: 0.012, rate: 1.9 };
// The hips turn toward where the body is going (at most this far off the aim) while the spine
// turns back, so the torso and gun stay on the aim.
// Actions on top of the holds: a reload takes the support hand off the gun and the gun tips to
// it, a grenade is wound up over the shoulder and slung, a melee swings the gun butt across, a
// hit jolts the torso away from where it came from (radians, small enough to keep the helmet in
// the head band), and climbing goes hand over hand with the knees stepping up.
const RELOAD = { roll: 0.7, tip: -0.35, hand: [-0.08, -0.3, 0.16] };
const THROW = { time: 0.55, wind: [-0.02, 0.34, 0.16], sling: [0.08, 0.08, -0.56], dip: 0.1 };
const MELEE_SWING = { time: 0.4, twist: 0.4, thrust: 0.32, turn: 0.95 };
const FLINCH = { time: 0.35, back: 0.11, side: 0.09, head: 0.12 };
const CLIMB = { rate: 2.6, reach: 0.18, knee: 0.55 };
// On a Sizzler: thighs forward along the seat, shins down to the pegs (radians), the torso leaned
// over the tank, and the hands on the grips (body space: the bike's bars from where the rider's
// feet are, vehicles/sizzler.js). The gun goes on the back as for climbing.
// Dual wielding: how far each gun moves out to its side (meters).
const DUAL_APART = 0.09;
const RIDE = { thigh: 1.45, knee: -1.75, lean: 0.32, grips: { R: new THREE.Vector3(0.34, 0.86, -0.8), L: new THREE.Vector3(-0.34, 0.86, -0.8) } };
// Climbing, the gun goes on the back, muzzle up over the shoulder (spine space).
const SLING_POS = new THREE.Vector3(0.06, 0.12, 0.22);
const SLING_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0.6));

const HIP_TURN = 70 * (Math.PI / 180);
const LEAN_MAX = 8 * (Math.PI / 180);
// How far out the boots' outer edges are (meters).
const FOOT_EDGE = 0.19;
// Backpedaling starts past this move angle and stops under the second, so a stick held near a
// pure strafe doesn't swing the hips across.
const BACK_ENTER = 115 * (Math.PI / 180);
const BACK_LEAVE = 85 * (Math.PI / 180);

const _yAxis = new THREE.Vector3(0, 1, 0);
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
const _gqL = new THREE.Quaternion();
const _gpL = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _u = new THREE.Vector3();
const _h = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();
const _el = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _bounce = new THREE.Color();
// sampleLight: the light under a deck, and how much of the floor's glow a body takes.
const UNDER_LIGHT = 0.6;
const BOUNCE = 0.45;
const _sp = new THREE.Vector3();
const _qr = new THREE.Quaternion();
const _leg = { thigh: 0, knee: 0 };
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Turn an arm so its wrist reaches `target` (spine space) from `shoulder` with the elbow toward
// `pole`; writes the two segment rotations into qu (upper arm, in the spine's frame) and ql
// (forearm, in the upper arm's). Out of reach, the arm points at the target, nearly straight.
function solveArm(A, shoulder, target, pole, qu, ql) {
  _d.subVectors(target, shoulder);
  let dist = _d.length();
  _d.divideScalar(dist || 1);
  dist = clamp(dist, Math.abs(A.l1 - A.l2) + 0.01, (A.l1 + A.l2) * 0.995);
  const cosA = clamp((A.l1 * A.l1 + dist * dist - A.l2 * A.l2) / (2 * A.l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0).addScaledVector(_d, _d.y);
  _p.normalize();
  _u.copy(_d).multiplyScalar(cosA).addScaledVector(_p, sinA);
  _el.copy(shoulder).addScaledVector(_u, A.l1);
  _l.copy(shoulder).addScaledVector(_d, dist).sub(_el).normalize();
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
const GLOWS = { visor: 1, shine: 1, ember: 1, strip: 0.9 };
// How glossy each region is (aShine: 0 matte cloth to 1 the visor's glass): painted plates catch
// a highlight and a faint sky, metal more, the visor most.
const SHINES = { armor: 0.5, panel: 0.42, suit: 0.08, strip: 0, glove: 0.14, boot: 0.25, visor: 1, ember: 0, metal: 0.8, shine: 1 };
const GUN_SHINES = { [FINISHES.matte]: 0.05, [FINISHES.wood]: 0.15, [FINISHES.paint]: 0.45, [FINISHES.metal]: 0.8, [FINISHES.glow]: 0 };
const CAST_SHINE = 0.08;
// What each region's surface is made of (aKind, for the detail in bodyMaterial): 0 none (glow,
// glass, guns), 1 painted plate, 2 cloth, 3 bare metal and rubber, 4 a cast character's.
const KINDS = { armor: 1, panel: 1, suit: 2, glove: 2, boot: 3, metal: 3 };
const CAST_KIND = 4;
// How much a gun's glowing parts glow (weaponModels.js finishes).
const GUN_GLOW = 0.8;

// How far (meters) the Spartan's armor is pushed out per bone (blended by skin weight) and how
// much of that each region takes.
const BONE_BULK = { spine: 0.036, armUL: 0.032, armUR: 0.032, hips: 0.02, legUL: 0.022, legUR: 0.022, armLL: 0.014, armLR: 0.014, legLL: 0.015, legLR: 0.015, footL: 0.006, footR: 0.006 };
const REGION_BULK = { armor: 1, panel: 1, strip: 1, ember: 1, metal: 0.8, boot: 0.6, suit: 0.35 };

// The body as decoded from the generated data, once per page load and shared by every body
// (read only).
let bodyBase = null;
// character: 'spartan' (the generated mesh) or a cast.js character, built once each.
function base(character = 'spartan') {
  const cast = castBody(character);
  if (cast) {
    cast.helmet ??= helmetTable(cast);
    return cast;
  }
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
  const w8 = bytes(DATA.skinWeight);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) skinWeight[i] = w8[i] / 255;
  const skinIndex = new Uint16Array(bytes(DATA.skinIndex));
  const region = bytes(DATA.region);
  // Halo's bulk: armor pushed out along the averaged normals (so nothing cracks), most on the
  // chest and pauldrons, by each vertex's bones and region. The helmet, visor and hands stay
  // put (the head band fit and the grips depend on them).
  const bulk = (v) => {
    let b = 0;
    for (let j = 0; j < 4; j++) b += (BONE_BULK[BODY_BONES[skinIndex[v * 4 + j]]] ?? 0) * skinWeight[v * 4 + j];
    return b * (REGION_BULK[REGIONS[region[v]]] ?? 0);
  };
  // The shield shell: every vertex pushed a further 1.75 cm out along the same normal.
  const shell = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const out = bulk(v);
    for (let k = v * 3; k < v * 3 + 3; k++) {
      const dir = s8[k] / 127;
      position[k] = p16[k] / 8192 + dir * out;
      normal[k] = n8[k] / 127;
      shell[k] = position[k] + dir * 0.0175;
    }
  }
  bodyBase = {
    count: n,
    position,
    normal,
    shell,
    region,
    // Baked shade per vertex (255 = none), from the tool: occlusion, darker plate edges, the
    // visor's gradient.
    shade: DATA.shade ? bytes(DATA.shade) : null,
    skinIndex,
    skinWeight,
    index: new Uint16Array(bytes(DATA.index).buffer),
  };
  bodyBase.helmet = helmetTable(bodyBase);
  return bodyBase;
}

// The helmet's lowest and highest point (vertices on the head bone alone) relative to the head
// joint, for each tilt of the head from level (radians, + up), so update() can keep it inside the
// hitbox's head band.
const TILT = { from: -0.5, step: 0.05, n: 29 };
function helmetTable(b) {
  const head = BODY_BONES.indexOf('head');
  const [, hy, hz] = JOINTS.head;
  const lo = new Float32Array(TILT.n).fill(9);
  const hi = new Float32Array(TILT.n).fill(-9);
  const cos = Float32Array.from({ length: TILT.n }, (_, t) => Math.cos(TILT.from + t * TILT.step));
  const sin = Float32Array.from({ length: TILT.n }, (_, t) => Math.sin(TILT.from + t * TILT.step));
  for (let i = 0; i < b.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (b.skinIndex[i * 4 + k] === head) w += b.skinWeight[i * 4 + k];
    if (w < 0.99) continue;
    const y = b.position[i * 3 + 1] - hy;
    const z = b.position[i * 3 + 2] - hz;
    for (let t = 0; t < TILT.n; t++) {
      const ty = y * cos[t] - z * sin[t];
      if (ty < lo[t]) lo[t] = ty;
      if (ty > hi[t]) hi[t] = ty;
    }
  }
  return { lo, hi };
}
// One end of the helmet's range (table lo or hi) at tilt `a`.
function helmetAt(table, a) {
  const f = clamp((a - TILT.from) / TILT.step, 0, TILT.n - 1.001);
  const i = Math.floor(f);
  return table[i] + (table[i + 1] - table[i]) * (f - i);
}

// Per-vertex color, glow, shine and team color: vertex i takes entry pick(i) of the palette.
function paint(n, palette, glows, pick, team, shines, kinds = null) {
  const col = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  const glow = new Float32Array(n);
  const shine = new Float32Array(n);
  const tm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = pick(i);
    const c = palette[k];
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    glow[i] = glows[k];
    shine[i] = shines[k];
    if (kinds) kind[i] = kinds[k];
    tm[i * 3] = team.r;
    tm[i * 3 + 1] = team.g;
    tm[i * 3 + 2] = team.b;
  }
  return { col, glow, tm, shine, kind };
}

function buildGeometry(colors, inflate, r, character) {
  const geoms = [];
  // The body: the Spartan's regions take this body's colors; a cast character has its own
  // palette, with null for the player's color.
  const b = base(character);
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(inflate ? b.shell : b.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
    const palette = b.palette ? b.palette.map((e) => new THREE.Color().set(e.color ?? colors.strip)) : REGIONS.map((name) => new THREE.Color().set(colors[name]));
    const glows = b.palette ? b.palette.map((e) => e.glow ?? 0) : REGIONS.map((name) => GLOWS[name] ?? 0);
    const shines = b.palette ? b.palette.map((e) => e.shine ?? (e.glow ? 0 : CAST_SHINE)) : REGIONS.map((name) => SHINES[name] ?? 0);
    const kinds = b.palette ? b.palette.map((e) => (e.glow ? 0 : CAST_KIND)) : REGIONS.map((name) => KINDS[name] ?? 0);
    const { col, glow, tm, shine, kind } = paint(b.count, palette, glows, (i) => b.region[i], colors.armor, shines, kinds);
    if (b.shade) {
      for (let i = 0; i < b.count; i++) {
        const k = b.shade[i] / 255;
        col[i * 3] *= k;
        col[i * 3 + 1] *= k;
        col[i * 3 + 2] *= k;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Self-glow and the body's team color, for the rim light (see bodyMaterial).
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    g.setAttribute('aShine', new THREE.BufferAttribute(shine, 1));
    g.setAttribute('aTeam', new THREE.BufferAttribute(tm, 3));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(b.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(b.skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(b.index, 1));
    geoms.push(g);
  }
  // Every weapon is baked in on its own bone; the ones not held are scaled to nothing. A
  // dual-wield gun's left-hand copy is the mirror image (x flipped, winding turned back).
  const baked = [...Object.entries(r.gunBones).map(([id, bone]) => [id, bone, false]), ...Object.entries(r.leftBones).map(([id, bone]) => [id, bone, true])];
  for (const [id, bone, mirror] of baked) {
    const j = r.joints[mirror ? r.gunBones[id] : bone];
    const bi = r.names.indexOf(bone);
    for (const [c, size, color, opts] of allParts(id)) {
      if (!showsAtLow(size)) continue;
      const g = partGeometry(c, size, opts, 'lo', { offset: j, inflate: inflate ? 0.035 : 0 });
      if (mirror) mirrorX(g);
      const n = g.attributes.position.count;
      const part = [new THREE.Color().set(color ?? colors.armor)];
      const finish = finishOf(color, opts);
      const { col, glow, tm, shine, kind } = paint(n, part, [finish === FINISHES.glow ? GUN_GLOW : 0], () => 0, colors.armor, [GUN_SHINES[finish]]);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
      g.setAttribute('aShine', new THREE.BufferAttribute(shine, 1));
      g.setAttribute('aTeam', new THREE.BufferAttribute(tm, 3));
      g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
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

// Flips a geometry across x = 0 in place: positions and normals, and each triangle's winding
// so its faces still face out.
function mirrorX(g) {
  for (const name of ['position', 'normal']) {
    const a = g.attributes[name];
    for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i));
  }
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
}

// A grip for the left hand on the mirror image of a gun: the right hand's, mirrored.
const _mirrorCache = {};
function mirroredGrip(id) {
  if (_mirrorCache[id]) return _mirrorCache[id];
  const r = grips(id).right;
  return (_mirrorCache[id] = {
    wrist: new THREE.Vector3(-r.wrist.x, r.wrist.y, r.wrist.z),
    q: new THREE.Quaternion(r.q.x, -r.q.y, -r.q.z, r.q.w),
    slideMax: 0,
  });
}

// One material for every body. Blinn-Phong whose highlight follows each vertex's shine (aShine:
// matte cloth to glossy plates to the visor's glass), with a faint sky-and-ground reflection on
// the glossy parts (the visor's strongest, like a curved mirror); glowing parts ignore light and
// shadow, and a rim in the body's own color lights its silhouette, stronger with distance, so a
// far player reads as a colored person (with a glowing head) instead of a dark speck, even in
// shade.
const RIM_VERTEX = /* glsl */ `
  attribute float aGlow;
  attribute float aShine;
  attribute vec3 aTeam;
  attribute float aKind;
  varying float vGlow;
  varying float vShine;
  varying vec3 vTeam;
  varying float vKind;
  varying vec3 vRest;
`;
const RIM_HEAD = /* glsl */ `
  uniform float uLocal;
  uniform vec3 uBounce;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform samplerCube uEnv;
  uniform float uEnvOn;
  varying float vGlow;
  varying float vShine;
  varying vec3 vTeam;
  varying float vKind;
  varying vec3 vRest;
  float chHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float chNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(chHash(i), chHash(i + vec3(1, 0, 0)), f.x), mix(chHash(i + vec3(0, 1, 0)), chHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(chHash(i + vec3(0, 0, 1)), chHash(i + vec3(1, 0, 1)), f.x), mix(chHash(i + vec3(0, 1, 1)), chHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // A line a pixel or so wide where v crosses c.
  float chLine(float v, float c) {
    return 1.0 - smoothstep(0.6, 1.6, abs(v - c) / max(fwidth(v), 1e-5));
  }
`;
// Surface detail by what each part is made of (aKind), drawn in the body's rest pose (vRest, so
// it rides the armor as it moves): painted plates get panel seams (abdomen bands, the chest's
// center line, lines across the arms and legs), mottled paint, grit and chipped scratches down to
// bare metal; the undersuit a ribbed weave; bare metal and boots grit. Seams and weave fade out
// with distance, where they'd only be noise.
const KIND_COLOR = /* glsl */ `
  #include <color_fragment>
  float kPlate = 1.0 - step(0.5, abs(vKind - 1.0));
  float kCloth = 1.0 - step(0.5, abs(vKind - 2.0));
  float kBare = 1.0 - step(0.5, abs(vKind - 3.0));
  float kCast = step(3.5, vKind);
  float kNear = 1.0 - smoothstep(4.0, 14.0, length(vViewPosition));
  vec3 kq = vRest;
  float kMott = chNoise(kq * 9.0) * 0.6 + chNoise(kq * 37.0) * 0.4;
  float kGrit = chNoise(kq * 190.0);
  diffuseColor.rgb *= 1.0 + ((kMott - 0.5) * 0.16 + (kGrit - 0.5) * 0.07) * kPlate + (kGrit - 0.5) * (0.14 * kBare + 0.08 * kCast);
  // Chips and scratches through the paint.
  float kScr = smoothstep(0.82, 0.87, chNoise(kq * vec3(110.0, 10.0, 110.0))) * smoothstep(0.58, 0.72, chNoise(kq * 13.0 + 3.1));
  float kChipN = chNoise(kq * 46.0 + 7.3) * smoothstep(0.6, 0.75, chNoise(kq * 7.0 + 1.7));
  float kChip = smoothstep(0.76, 0.8, kChipN);
  // (A dark rim of lifted paint around each chip.)
  float kChipRim = smoothstep(0.7, 0.75, kChipN) - kChip;
  float kWear = max(kScr * 0.8, kChip) * kPlate;
  diffuseColor.rgb *= 1.0 - kChipRim * kPlate * 0.35;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.31, 0.33), kWear * 0.65);
  // Panel seams.
  float ax = abs(kq.x);
  float torso = 1.0 - step(0.22, ax);
  float limb = 1.0 - torso;
  float seam = 0.0;
  seam += torso * step(0.92, kq.y) * step(kq.y, 1.12) * chLine(fract((kq.y - 0.92) / 0.05 + 0.5), 0.5);
  seam += torso * chLine(kq.y, 1.125);
  seam += torso * step(1.13, kq.y) * step(kq.y, 1.42) * chLine(kq.x, 0.0);
  seam += limb * step(0.85, kq.y) * (chLine(kq.y, 1.25) + chLine(kq.y, 1.0));
  seam += step(kq.y, 0.84) * (chLine(kq.y, 0.66) + chLine(kq.y, 0.3) + chLine(kq.y, 0.56));
  seam = min(seam, 1.0) * kPlate * kNear;
  diffuseColor.rgb *= 1.0 - seam * 0.6;
  // The undersuit's weave: fine ribs across, a finer thread both ways.
  float kRib = 0.5 + 0.5 * sin(kq.y * 380.0 + chNoise(kq * 30.0) * 2.0);
  float kThread = 0.5 + 0.25 * (sin(kq.x * 1400.0) + sin(kq.z * 1400.0 + kq.y * 900.0));
  float kWeaveAA = 1.0 - smoothstep(0.25, 0.7, fwidth(kq.y * 380.0));
  diffuseColor.rgb *= 1.0 - kCloth * kWeaveAA * (kRib * 0.16 + kThread * 0.06 * (1.0 - smoothstep(0.2, 0.5, fwidth(kq.x * 1400.0))));
`;
// The plates' surface isn't a mirror-smooth shell: a broad sway and small dents nudge the normal,
// so highlights break up into a sheen and glints.
const KIND_NORMAL = /* glsl */ `
  #include <normal_fragment_maps>
  {
    vec3 q = vRest * 11.0;
    vec3 d = vec3(chNoise(q), chNoise(q + 17.3), chNoise(q + 31.7)) - 0.5;
    vec3 q2 = vRest * 95.0;
    vec3 d2 = vec3(chNoise(q2), chNoise(q2 + 7.7), chNoise(q2 + 13.1)) - 0.5;
    normal = normalize(normal + (d * 0.22 + d2 * 0.07) * (kPlate + kBare * 0.8 + kCast * 0.3) + d2 * 0.08 * kCloth);
  }
`;
const SHINE_LIGHTS = /* glsl */ `
  BlinnPhongMaterial material;
  material.diffuseColor = diffuseColor.rgb;
  // (Painted plates take a little of their own color into the highlight; worn spots and cloth dull.)
  material.specularColor = mix(vec3(0.55), diffuseColor.rgb * 0.8 + 0.18, 0.55 * kPlate);
  material.specularShininess = mix(8.0, 90.0, vShine) * (1.0 + 0.6 * kPlate);
  material.specularStrength = vShine * (1.0 - vGlow) * (1.0 - kWear * 0.6) * (1.0 - 0.6 * kCloth) * (1.0 - 0.15 * kPlate);
`;
const RIM_FRAGMENT = /* glsl */ `
  float ndv = saturate(dot(normal, normalize(vViewPosition)));
  float rim = (1.0 - ndv) * (1.0 - ndv) * mix(0.25, 0.7, smoothstep(8.0, 40.0, length(vViewPosition)));
  outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.5, vGlow) + vTeam * rim;
  // Cloth's soft sheen at grazing angles.
  outgoingLight += diffuseColor.rgb * kCloth * pow(1.0 - ndv, 4.0) * 0.5 * uLocal;
  {
    vec3 R = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
    vec3 env = mix(uGround, uSky, smoothstep(-0.2, 0.3, R.y)) + uSky * 0.6 * exp(-pow((R.y - 0.1) * 7.0, 2.0));
    float fres = (1.0 - ndv) * (1.0 - ndv) * (1.0 - ndv);
    float glass = smoothstep(0.9, 1.0, vShine);
    // The arena itself once it's captured (render/reflections.js): blurry on plates, sharp on glass.
    env = mix(env, textureLod(uEnv, R, mix(4.0, 1.0, glass)).rgb * 1.25, uEnvOn);
    outgoingLight += env * vShine * mix(0.02 + 0.2 * fres, 0.18 + 0.45 * fres, glass);
  }
`;

// The shield shell's shimmer (see the constructor). Bands run up the body in its own space; the
// pop pushes the shell out along its normals.
const SHIELD_POP = 0.3;
const SHIELD_VERTEX_HEAD = /* glsl */ `
  uniform float uPop;
  varying vec3 vShieldPos;
  varying vec3 vShieldNormal;
  varying vec3 vShieldView;
`;
const SHIELD_BEGIN = /* glsl */ `
  #include <begin_vertex>
  vShieldPos = position;
  transformed += normal * uPop * 0.07;
  vShieldNormal = normalize(transformedNormal);
`;
const SHIELD_FRAGMENT_HEAD = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;
  uniform float uPop;
  varying vec3 vShieldPos;
  varying vec3 vShieldNormal;
  varying vec3 vShieldView;
`;
const SHIELD_FRAGMENT = /* glsl */ `
  float edge = 1.0 - abs(dot(normalize(vShieldNormal), normalize(vShieldView)));
  float wave = sin(vShieldPos.x * 23.0 + uTime * 5.0) * 1.6;
  float bands = 0.5 + 0.5 * sin(vShieldPos.y * 46.0 - uTime * 16.0 + wave);
  float sparkle = step(0.93, fract(sin(dot(floor(vShieldPos * 60.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453 + uTime * 3.0));
  float a = uFlash * (0.18 + 0.82 * edge * edge) * (0.45 + 0.55 * bands) + sparkle * uFlash * 0.35;
  vec3 col = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.85), uPop * 0.55 + edge * 0.25);
  gl_FragColor = vec4(col * a * (1.0 + uPop), 1.0);
`;

// The light where a body stands (CharacterModel.sampleLight, from the arena's bake): the sky's
// fill and reflections dim in the shade of decks and walls, and glowing strips and fires nearby
// tint it, most on its underside, so bodies sit in the same light as the arena.
const LOCAL_LIGHT = /* glsl */ `
  reflectedLight.indirectDiffuse *= uLocal;
  reflectedLight.indirectSpecular *= uLocal;
  {
    vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    reflectedLight.indirectDiffuse += uBounce * diffuseColor.rgb * (0.35 + 0.65 * (0.5 - 0.5 * dot(normal, upV)));
  }
`;

// Each body has its own material (all one program) so its local light uploads with it: three only
// re-uploads a built-in material's uniforms when the material changes between draws.
function bodyMaterial(local) {
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0xffffff, shininess: 30 });
  m.name = 'character';
  m.onBeforeCompile = (shader) => {
    const v = shader.vertexShader;
    const f = shader.fragmentShader;
    if (!v.includes('#include <begin_vertex>') || !f.includes('#include <opaque_fragment>') || !f.includes('#include <lights_phong_fragment>')) {
      console.warn('character: shader chunks changed, rim light off');
      return;
    }
    // (The same sky and ground the first-person guns reflect, from the map's look.)
    shader.uniforms.uSky = viewmodelUniforms.uSky;
    shader.uniforms.uGround = viewmodelUniforms.uGround;
    shader.uniforms.uEnv = envUniforms.uEnv;
    shader.uniforms.uEnvOn = envUniforms.uEnvOn;
    shader.vertexShader = RIM_VERTEX + v.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = aGlow;\n  vShine = aShine;\n  vTeam = aTeam;\n  vKind = aKind;\n  vRest = position;');
    shader.uniforms.uLocal = local.uLocal;
    shader.uniforms.uBounce = local.uBounce;
    shader.fragmentShader =
      RIM_HEAD +
      f
        .replace('#include <color_fragment>', KIND_COLOR)
        .replace('#include <normal_fragment_maps>', KIND_NORMAL)
        .replace('#include <lights_phong_fragment>', SHINE_LIGHTS)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${LOCAL_LIGHT}`)
        .replace('#include <opaque_fragment>', `${RIM_FRAGMENT}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'character-shine-env-kind';
  return m;
}


export class CharacterModel {
  // guns: ids of every gun this body might hold this match (the match's weapon set).
  // (The visor glows at 1.5x its color: a deep gold so the top of the glass doesn't clip to yellow.)
  // character: 'spartan' or one of cast.js's (Crash, Link, Bond).
  constructor({ armor, trim = null, visor = 0xe8a832, guns = ['hickory'], character = 'spartan' }) {
    const r = (this.rig = rig(guns));
    this.character = character;
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
      // The streak of sky across the visor's glass.
      shine: new THREE.Color(visor).lerp(new THREE.Color(0xfff6e0), 0.6),
    };
    colors.panel = colors.trim;

    this.group = new THREE.Group();
    this.group.name = 'character';
    // (Turned, then tipped and rolled with a bike.)
    this.group.rotation.order = 'YXZ';
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
    // The body bones' rest offsets, for reset() after a ragdoll.
    this.restPos = BODY_BONES.map((n) => this.bones[n].position.clone());

    // The spine turns (against the hips) before it pitches with the aim. The hips roll about the
    // aim's forward axis (roll after turn), so the spine's counter-turn cancels the turn exactly
    // and the stride roll never becomes a torso nod while strafing.
    this.bones.spine.rotation.order = 'YXZ';
    this.bones.hips.rotation.order = 'ZYX';

    // Where the body stands: the shade it's in and nearby glow (sampleLight).
    this.local = { uLocal: { value: 1 }, uBounce: { value: new THREE.Color(0, 0, 0) } };
    this.mesh = new THREE.SkinnedMesh(buildGeometry(colors, false, r, character), bodyMaterial(this.local));
    this.mesh.add(this.bones.root);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(r.names.map((n) => this.bones[n]));
    this.mesh.bind(this.skeleton);
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);

    // Shield shimmer: a slightly inflated copy on the same skeleton, only drawn while flashing
    // (SHIELD_* shaders): a golden flare, brightest at the silhouette, with energy bands running up
    // the body; a break also bulges it out and flashes it white-gold (pop).
    this.shellUniforms = { uTime: { value: 0 }, uFlash: { value: 0 }, uPop: { value: 0 } };
    this.shellMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc94a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shellMaterial.name = 'shieldShell';
    this.shellMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shellUniforms);
      shader.vertexShader = SHIELD_VERTEX_HEAD + shader.vertexShader
        .replace('#include <begin_vertex>', SHIELD_BEGIN)
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vShieldView = -mvPosition.xyz;');
      shader.fragmentShader = SHIELD_FRAGMENT_HEAD + shader.fragmentShader.replace('#include <opaque_fragment>', SHIELD_FRAGMENT);
    };
    this.shellMaterial.customProgramCacheKey = () => 'shield-shimmer';
    this.popT = 9;
    this.shell = new THREE.SkinnedMesh(buildGeometry(colors, true, r, character), this.shellMaterial);
    this.shell.bind(this.skeleton, this.mesh.bindMatrix);
    this.shell.boundingSphere = this.mesh.boundingSphere;
    this.shell.visible = false;
    this.group.add(this.shell);

    this.weaponId = null;
    // The left hand's gun when dual wielding (null for none).
    this.leftId = null;
    // Each gun bone's resting place, for the holds to move it from.
    this.gunRest = {};
    for (const [id, bone] of Object.entries(r.gunBones)) this.gunRest[id] = this.bones[bone].position.clone();
    // With no gun shown, the hands still hold where a rifle would be.
    this.noGunRest = v3(DEFAULT_CARRY).sub(v3(JOINTS.spine));
    this.grips = grips(null);
    this.shoulderGun = 0;
    this.holdZ = HOLD_BACK;
    this.twoHand = 0;
    // The spine's turn for the stance, undone on the gun so it stays put.
    this.twistInv = new THREE.Quaternion();
    this.setWeapon(guns[0]);
    this.headRest = this.bones.head.position.clone();
    this.helmet = base(character).helmet;

    this.phase = 0;
    // Each body breathes on its own phase, so a crowd doesn't breathe in step.
    this.breath = Math.random() * Math.PI * 2;
    this.lands = this.airJumps = this.shots = this.throws = this.melees = this.hurts = 0;
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
    this.throwT = this.meleeT = this.hurtT = 9;
    this.hurtFwd = this.hurtSide = 0;
    this.reloadW = this.climbPhase = this.ride = this.rideArms = 0;
    this.aimW = this.sprintW = 0;
    this.gunTip = 0;
    this.shieldFlash = 0;
    this.shell.visible = false;
    // Event counters start from the first state seen.
    this.seen = false;
    // Out of a ragdoll: standing up straight, every body bone back at rest.
    this.group.quaternion.identity();
    BODY_BONES.forEach((n, i) => {
      this.bones[n].position.copy(this.restPos[i]);
      this.bones[n].quaternion.identity();
    });
  }

  // On the podium (world/finale.js), after update(): amount 1 pumps both arms over the head and
  // bounces, less claps in front.
  cheer(t, amount) {
    const B = this.bones;
    const up = amount >= 1;
    for (const [u, l, sd] of [['armUL', 'armLL', -1], ['armUR', 'armLR', 1]]) {
      if (up) {
        _e.set(-0.3, 0, sd * (2.65 + 0.25 * Math.sin(t * 7 + sd)));
        B[u].quaternion.setFromEuler(_e);
        _e.set(-0.3 - 0.3 * Math.max(0, Math.sin(t * 7 + sd)), 0, 0);
      } else {
        _e.set(-1.25, 0, sd * (0.25 + 0.18 * (0.5 + 0.5 * Math.sin(t * 9))));
        B[u].quaternion.setFromEuler(_e);
        _e.set(-0.9, 0, 0);
      }
      B[l].quaternion.setFromEuler(_e);
    }
    this.group.position.y += (up ? 0.12 : 0.04) * Math.abs(Math.sin(t * (up ? 4 : 3)));
  }

  // Smoked: the body goes limp, driven by the player's corpse (Player.updateCorpse): c.pos (the
  // feet), c.yaw, c.axis and c.tip (the fall, about a horizontal axis in body space), c.air
  // (tumbling) and c.limp (0 to 1 as it goes slack). Arms fling out and flop, the knees and
  // spine fold, the head lolls; while airborne the limbs flail.
  ragdoll(dt, c) {
    const g = this.group;
    g.position.copy(c.pos);
    _qa.setFromAxisAngle(_yAxis, c.yaw);
    _qb.setFromAxisAngle(c.axis, c.tip);
    g.quaternion.copy(_qa).multiply(_qb);
    const B = this.bones;
    const k = c.limp;
    const t = c.t;
    const fl = c.air ? 1 : Math.max(0, 1 - t * 1.5);
    const w = (f, ph) => Math.sin(t * f + ph + c.seed) * fl;
    // Shot down (not blown off its feet), the knees buckle first and the body sinks as it tips.
    const buckle = c.air ? 0 : Math.min(1, t * 5) * Math.max(0, 1 - c.tip / 1.5);
    B.hips.position.copy(this.restPos[BODY_BONES.indexOf('hips')]);
    B.hips.position.y -= 0.22 * buckle;
    B.hips.rotation.set(0.15 * k + 0.2 * w(9, 0), 0, 0.1 * w(7, 1));
    B.spine.rotation.set(c.front * 0.35 * k + 0.25 * w(8, 2), 0.25 * k * c.side, 0.15 * w(6, 3));
    B.head.rotation.set(c.front * 0.5 * k + 0.3 * w(11, 4), 0.5 * k * c.side, 0.25 * k * c.side);
    B.head.position.copy(this.restPos[BODY_BONES.indexOf('head')]);
    // Arms out to the sides and up a little, flopping.
    for (const [u, l, sd] of [['armUL', 'armLL', -1], ['armUR', 'armLR', 1]]) {
      _e.set(-0.4 * k + 0.6 * w(10, sd), 0, sd * (1.1 * k + 0.4 * w(8, 5 + sd)));
      B[u].quaternion.setFromEuler(_e);
      _e.set(-0.5 * k - 0.4 * Math.abs(w(12, sd)), 0, 0);
      B[l].quaternion.setFromEuler(_e);
      B[sd < 0 ? 'handL' : 'handR'].quaternion.identity();
    }
    // Legs fold at the knees, one more than the other.
    B.legUL.rotation.set(0.3 * k + 0.5 * w(9, 6) + 0.6 * buckle, 0, -0.12 * k);
    B.legUR.rotation.set(0.6 * k + 0.5 * w(9, 7) + 0.6 * buckle, 0, 0.12 * k);
    B.legLL.rotation.set(-0.5 * k - 0.4 * Math.abs(w(10, 8)) - 1.1 * buckle, 0, 0);
    B.legLR.rotation.set(-1.0 * k - 0.4 * Math.abs(w(10, 9)) - 1.1 * buckle, 0, 0);
    B.footL.rotation.set(0.4 * k, 0, 0);
    B.footR.rotation.set(0.4 * k, 0, 0);
    if (this.shieldFlash > 0) {
      this.shieldFlash = 0;
      this.shell.visible = false;
    }
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
    const a = Math.max(this.aimW, this.shoulderGun) * (1 - this.climb);
    const A = GUN_POSE.aim;
    gb.position.set(rest.x + A.pos[0] * a, rest.y + A.pos[1] * a, rest.z + this.holdZ + A.pos[2] * a).applyQuaternion(this.twistInv);
    gb.quaternion.setFromEuler(_e.set(A.rot[0] * a + this.gunTip, A.rot[1] * a, A.rot[2] * a)).premultiply(this.twistInv);
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
    this.shoulderGun = this.rig.gunBones[id] && GUNS[id].carry[1] >= SHOULDER_CARRY ? 1 : 0;
    this.holdZ = this.shoulderGun ? SHOULDER_FORWARD : HOLD_BACK;
    this.twoHand = this.rig.gunBones[id] && GUNS[id].hands[3] ? 1 : 0;
    // A gun outside the match's set has no bone: the body just shows no gun.
    for (const [wid, bone] of Object.entries(this.rig.gunBones)) {
      // Not exactly zero, so skinned normals never divide by zero.
      this.bones[bone].scale.setScalar(wid === id ? 1 : 1e-4);
    }
  }

  // Dual wielding: the left hand's gun (a dual-wield gun's mirrored copy), or null.
  setLeft(id) {
    const want = id && this.rig.leftBones[id] ? id : null;
    if (want === this.leftId) return;
    this.leftId = want;
    for (const [wid, bone] of Object.entries(this.rig.leftBones)) this.bones[bone].scale.setScalar(wid === want ? 1 : 1e-4);
  }

  setLayer(layer) {
    this.mesh.layers.set(layer);
    this.shell.layers.set(layer);
  }

  // strength 1: the shield broke (it pops).
  flashShield(strength) {
    this.shieldFlash = Math.max(this.shieldFlash, strength);
    if (strength >= 1) this.popT = 0;
  }

  // state: { x, y, z (feet), yaw, pitch, speed, grounded, crouched, climbing } plus optional
  // fwd and side (velocity along the facing and to the right), velY, sprinting, aiming, lands,
  // airJumps and shots (event counters), landSpeed, fireT (time since the last shot), fireHold
  // (how long after a shot the gun stays at the shoulder) and kick (the gun's recoil).
  // Training dummies pass only the basics plus fwd and side.
  update(dt, s) {
    const g = this.group;
    g.position.set(s.x, s.y, s.z);
    g.rotation.set(s.tilt ?? 0, s.yaw, s.roll ?? 0);

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
      this.throws = s.throws ?? 0;
      this.melees = s.melees ?? 0;
      this.hurts = s.hurts ?? 0;
    }
    if ((s.throws ?? 0) !== this.throws) {
      this.throws = s.throws;
      this.throwT = 0;
    }
    if ((s.melees ?? 0) !== this.melees) {
      this.melees = s.melees;
      this.meleeT = 0;
    }
    if ((s.hurts ?? 0) !== this.hurts) {
      this.hurts = s.hurts;
      this.hurtT = 0;
      this.hurtFwd = s.hurtFwd ?? 1;
      this.hurtSide = s.hurtSide ?? 0;
    }
    this.throwT += dt;
    this.meleeT += dt;
    this.hurtT += dt;
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
    this.ride += ((s.riding ? 1 : 0) - this.ride) * damp(12, dt);
    const rd = this.ride;
    // (The hands on the bars and the gun slung: not on a hog, where the rider shoots.)
    this.rideArms += ((s.rideArms ? 1 : 0) - this.rideArms) * damp(12, dt);
    const ra = this.rideArms;
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
    const stride = strideLength(speed);
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
    // (Crouched, the legs are already folded, so the tuck adds less.)
    const tuck = this.air * (0.35 + rising * 0.45 + takeoff * 0.4 - falling * 0.25) * (1 - this.crouch * 0.6);
    // Landing squash: the hips drop (up to 5 cm on a hard landing) and come back up.
    const lt = this.landT;
    const squash = this.landHard * 0.05 * (lt < 0.06 ? lt / 0.06 : Math.max(0, 1 - (lt - 0.06) / 0.2));
    // Crouching squats deep with the hips sat back; the legs fold just enough to keep the feet
    // where they stand.
    let drop = this.crouch * CROUCH.drop + squash;
    const sit = this.crouch * CROUCH.back;
    legSolve(drop, sit, _leg);
    // The hips follow the stride's leg reach down a little: planting the feet fully would bob the
    // head through the head line at a run.
    // Climbing, the knees step up in turn as the hands go over each other.
    this.climbPhase += dt * CLIMB.rate * Math.min(1.5, Math.abs(velY) + speed * 0.5) * this.climb;
    const stepL = this.climb * CLIMB.knee * (0.5 + 0.5 * Math.sin(this.climbPhase));
    const stepR = this.climb * CLIMB.knee * (0.5 - 0.5 * Math.sin(this.climbPhase));
    const swL = sw + tuck * 1.2 + dj * 0.9 + stepL;
    const swR = -sw + tuck * 0.8 + dj * 0.2 + stepR;
    const kL = -Math.max(0, -sn) * 1.1 * run - tuck * 1.6 - dj * 0.3 - stepL * 1.6;
    const kR = -Math.max(0, sn) * 1.1 * run - tuck * 1.2 - dj * 1.3 - stepR * 1.6;
    const legReach = Math.max(legDrop(swL + _leg.thigh, kL + _leg.knee), legDrop(swR + _leg.thigh, kR + _leg.knee));
    const strideDip = Math.min(STRIDE_DIP_MAX, Math.max(0, legDrop(_leg.thigh, _leg.knee) - legReach) * STRIDE_DIP) * ground;
    // The hips sit back along the way the legs face.
    B.hips.position.set(Math.sin(this.hipYaw) * sit, LEG.hipsY - drop - strideDip, Math.cos(this.hipYaw) * sit);
    B.hips.rotation.set(0, this.hipYaw, sn * 0.07 * run);

    // Lean into sideways acceleration, at most 8 degrees.
    if (dt > 0) {
      this.sideAcc += ((side - this.prevSide) / dt - this.sideAcc) * damp(6, dt);
      this.prevSide = side;
    }
    const leanTo = clamp(-this.sideAcc * 0.012, -LEAN_MAX, LEAN_MAX) * ground;
    this.lean += (leanTo - this.lean) * damp(8, dt);
    B.root.rotation.z = this.lean;
    // (Rolled about the middle of the feet, the outer boot would sink into the floor.)
    B.root.position.y = Math.abs(Math.sin(this.lean)) * FOOT_EDGE;

    // The spine turns back against the hips (so the torso faces the aim) and carries part of the
    // aim pitch, so the arms and gun follow it together; each shot kicks it up a little, and
    // standing still the chest rises and falls.
    const kick = this.kickT < 0.25 ? this.kickAmount * 0.035 * Math.exp(-this.kickT * 14) : 0;
    this.breath += dt * BREATH.rate;
    const breathe = Math.sin(this.breath) * BREATH.amount * (1 - run) * ground;
    const bend = PITCH.spineMax * Math.tanh((s.pitch * PITCH.spine) / PITCH.spineMax);
    const bump = (t, len) => (t < len ? Math.sin((Math.PI * t) / len) * (1 - t / len * 0.5) : 0);
    const flinch = bump(this.hurtT, FLINCH.time);
    const ml = this.meleeT / MELEE_SWING.time;
    // The swing: wind up turned away (first third), whip across, settle.
    const swing = ml < 1 ? (ml < 0.33 ? Math.sin((ml / 0.33) * Math.PI * 0.5) : Math.cos(((ml - 0.33) / 0.67) * Math.PI)) : 0;
    const strike = ml < 1 && ml > 0.25 ? Math.sin(((ml - 0.25) / 0.75) * Math.PI) : 0;
    B.spine.rotation.set(
      bend - this.crouch * CROUCH.lean - RIDE.lean * ra + kick + breathe - flinch * FLINCH.back * this.hurtFwd,
      -this.hipYaw + swing * MELEE_SWING.twist,
      flinch * FLINCH.side * this.hurtSide,
    );
    // The bladed stance: the torso turns about its own (bent) axis, so the bend stays on the aim.
    // (Square to the front with a gun in each hand.)
    const twist = TWIST * this.twoHand * (this.leftId ? 0 : 1) * (1 - this.sprintW * (1 - this.shoulderGun)) * (1 - this.climb) * (1 - ra);
    B.spine.quaternion.multiply(_qe.setFromAxisAngle(Y_AXIS, twist));
    this.twistInv.setFromAxisAngle(Y_AXIS, -twist);

    // The head: level in roll and turned to the aim, tipped with part of the pitch about the top
    // of the neck, then moved up or down to keep the helmet in the head band: a helmet too high
    // sinks the hips (the knees bend), one too low raises them out of a crouch or, standing,
    // lifts on the neck.
    const tilt = clamp(s.pitch * HEAD.share - flinch * FLINCH.head * this.hurtFwd, HEAD.down, HEAD.up);
    _qa.copy(B.root.quaternion).multiply(B.hips.quaternion).multiply(B.spine.quaternion);
    _qb.copy(_qa).invert();
    const qh = B.head.quaternion.copy(_qb).multiply(_qc.setFromAxisAngle(X_AXIS, tilt));
    _p.set(0, HEAD.pivot, 0).applyQuaternion(qh);
    B.head.position.copy(this.headRest).sub(_p);
    B.head.position.y += HEAD.pivot;
    _t.copy(B.head.position).applyQuaternion(B.spine.quaternion).add(B.spine.position);
    _t.applyQuaternion(B.hips.quaternion).add(B.hips.position).applyQuaternion(B.root.quaternion).add(B.root.position);
    const top = BODY.standHeight + (BODY.crouchHeight - BODY.standHeight) * this.crouch;
    const below = top - HEAD.line - HEAD.below - (_t.y + helmetAt(this.helmet.lo, tilt));
    const over = top + HEAD.above - (_t.y + helmetAt(this.helmet.hi, tilt));
    const lift = Math.max(below, Math.min(0, over));
    // (Standing, the hips first give back their own drops, the stride's dip and a landing's squash,
    // so the neck only stretches for what's left; the dip comes back without bending the legs.)
    const hipsLift = lift < 0 ? lift : Math.min(lift, Math.max(lift * this.crouch, squash + strideDip), drop + strideDip);
    if (hipsLift !== 0) {
      B.hips.position.y += hipsLift;
      const legLift = hipsLift - (hipsLift > 0 ? Math.min(hipsLift, strideDip) : 0);
      if (legLift !== 0) {
        drop -= legLift;
        legSolve(drop, sit, _leg);
      }
    }
    B.head.position.add(_p.set(0, lift - hipsLift, 0).applyQuaternion(_qb));

    const aL = swL + _leg.thigh + (RIDE.thigh - swL - _leg.thigh) * rd;
    const aR = swR + _leg.thigh + (RIDE.thigh - swR - _leg.thigh) * rd;
    const bL = kL + _leg.knee + (RIDE.knee - kL - _leg.knee) * rd;
    const bR = kR + _leg.knee + (RIDE.knee - kR - _leg.knee) * rd;
    B.legUL.rotation.x = aL;
    B.legUR.rotation.x = aR;
    // Astride something wide (a hog), the thighs go out to the sides.
    B.legUL.rotation.z = -(s.straddle ?? 0) * rd;
    B.legUR.rotation.z = (s.straddle ?? 0) * rd;
    B.legLL.rotation.x = bL;
    B.legLR.rotation.x = bR;
    // Feet stay flat through a crouch and roll heel to toe with the stride; in the air the toes
    // hang.
    const flat = _leg.thigh + _leg.knee;
    B.footL.rotation.x = (-flat - (aL + bL - flat) * 0.75) * ground + (0.3 - (aL + bL) * 0.5) * (1 - ground);
    B.footR.rotation.x = (-flat - (aR + bR - flat) * 0.75) * ground + (0.3 - (aR + bR) * 0.5) * (1 - ground);
    // (Riding, the soles sit level on the pegs.)
    if (rd > 0.001) {
      B.footL.rotation.x += (-(aL + bL) - B.footL.rotation.x) * rd;
      B.footR.rotation.x += (-(aR + bR) - B.footR.rotation.x) * rd;
    }

    // The gun: at the shoulder while firing or zoomed, across the chest while sprinting,
    // otherwise at the hip; the arms reach up instead while climbing.
    const aiming = s.aiming || (s.fireT ?? 99) < (s.fireHold ?? 0.6);
    this.aimW += ((aiming ? 1 : 0) - this.aimW) * damp(14, dt);
    this.sprintW += ((s.sprinting && !aiming && speed > 1 ? 1 : 0) - this.sprintW) * damp(8, dt);
    const k = this.climb;
    // (Slung while climbing or riding.)
    const sling = Math.max(k, ra);
    const a = Math.max(this.aimW, this.shoulderGun) * (1 - sling);
    const sp = this.sprintW * (1 - k) * (1 - this.shoulderGun);
    const A = GUN_POSE.aim;
    const S = GUN_POSE.sprint;
    const bone = this.rig.gunBones[this.weaponId];
    const rest = bone ? this.gunRest[this.weaponId] : this.noGunRest;
    // A reload tips the gun over toward the support hand (shell by shell it stays tipped).
    const reloading = (s.reload ?? 0) > 0;
    this.reloadW += ((reloading ? 1 : 0) - this.reloadW) * damp(10, dt);
    const rw = this.reloadW * (1 - k);
    const handOff = reloading ? (s.reloadShell ? Math.sin(Math.PI * s.reload) * 0.6 : Math.sin(Math.PI * s.reload)) * (1 - k) : 0;
    const tw = this.throwT / THROW.time;
    const throwing = tw < 1 ? Math.sin(Math.PI * tw) * (1 - k) : 0;
    _gp.set(
      rest.x + A.pos[0] * a + S.pos[0] * sp,
      rest.y + A.pos[1] * a + S.pos[1] * sp - THROW.dip * throwing - 0.03 * rw,
      rest.z + this.holdZ + A.pos[2] * a + S.pos[2] * sp + kick * 0.6 - MELEE_SWING.thrust * strike,
    );
    // The gun tips the rest of the way to its share of the aim on top of the spine's bend (and
    // stays level through a crouch's forward lean and the breathing); out of a sprint endSprint()
    // uses the same tip.
    const gunPitch = s.pitch * (s.pitch > 0 ? PITCH.gunUp : PITCH.gunDown + (PITCH.crouchDown - PITCH.gunDown) * this.crouch);
    this.gunTip = (gunPitch - bend) * (1 - k) + this.crouch * CROUCH.lean * 0.9 - breathe;
    _e.set(
      A.rot[0] * a + S.rot[0] * sp + kick * 0.5 + this.gunTip + RELOAD.tip * rw,
      A.rot[1] * a + S.rot[1] * sp + MELEE_SWING.turn * (swing - strike * 0.6),
      A.rot[2] * a + S.rot[2] * sp + RELOAD.roll * rw,
    );
    // (Undoing the stance's turn, in the spine's frame.)
    _gq.setFromEuler(_e).premultiply(this.twistInv);
    _gp.applyQuaternion(this.twistInv);
    if (sling > 0.001) {
      _gp.lerp(SLING_POS, sling);
      _gq.slerp(SLING_Q, sling);
    }
    // Riding: the spine's frame in body space, to put the hands on the bike's grips.
    if (ra > 0.001) {
      _qr.copy(B.root.quaternion).multiply(B.hips.quaternion).multiply(B.spine.quaternion).invert();
      _sp.copy(B.spine.position).applyQuaternion(B.hips.quaternion).add(B.hips.position).applyQuaternion(B.root.quaternion).add(B.root.position);
    }
    // Dual wielding: the guns held a little apart, the left one the right one's mirror image.
    if (this.leftId) _gp.x += DUAL_APART;
    if (bone) {
      B[bone].position.copy(_gp);
      B[bone].quaternion.copy(_gq);
    }
    const leftBone = this.leftId ? this.rig.leftBones[this.leftId] : null;
    if (leftBone) {
      _gpL.set(-_gp.x, _gp.y, _gp.z);
      _gqL.set(_gq.x, -_gq.y, -_gq.z, _gq.w);
      B[leftBone].position.copy(_gpL);
      B[leftBone].quaternion.copy(_gqL);
    }
    // Both hands on the gun (spine space), or reaching up to climb. When the gun's fore grip is
    // out of reach the support shoulder comes forward, then the hand slides back along the gun.
    for (const sd of SIDES) {
      const arm = ARM[sd];
      // (The left hand on the left gun when there is one.)
      const dualL = sd === 'L' && leftBone;
      const gr = sd === 'R' ? this.grips.right : dualL ? mirroredGrip(this.leftId) : this.grips.left;
      const gq = dualL ? _gqL : _gq;
      _t.copy(gr.wrist).applyQuaternion(gq).add(dualL ? _gpL : _gp);
      _sh.copy(arm.shoulder);
      // The support hand leaves the gun: down to the belt for a reload, over the shoulder and out
      // for a throw (a free hand, so it doesn't slide along the gun).
      let free = 0;
      if (sd === 'L' && !dualL) {
        if (handOff > 0) {
          _t.x += RELOAD.hand[0] * handOff;
          _t.y += RELOAD.hand[1] * handOff;
          _t.z += RELOAD.hand[2] * handOff;
          free = handOff;
        }
        if (throwing > 0) {
          const W = THROW.wind;
          const L = THROW.sling;
          // Wound up behind the head for the first 40%, then slung forward.
          const u = clamp((tw - 0.4) / 0.35, 0, 1);
          _o.set(W[0] + (L[0] - W[0]) * u, W[1] + (L[1] - W[1]) * u, W[2] + (L[2] - W[2]) * u).add(_sh);
          _t.lerp(_o, throwing);
          free = Math.max(free, throwing);
        }
      }
      if (gr.slideMax > 0 && free < 0.05) {
        // (Short of full reach, so the elbow keeps a bend.)
        const reach = (arm.l1 + arm.l2) * SUPPORT_REACH;
        _sh.addScaledVector(PROTRACT, clamp((_t.distanceTo(_sh) - reach) / 0.15, 0, 1) * (1 - k));
        _z.set(0, 0, 1).applyQuaternion(_gq);
        _o.subVectors(_t, _sh);
        const c = _o.lengthSq() - reach * reach;
        if (c > 0) {
          const bz = _o.dot(_z);
          const disc = bz * bz - c;
          _t.addScaledVector(_z, clamp(disc >= 0 ? -bz - Math.sqrt(disc) : -bz, 0, gr.slideMax));
        }
      }
      B[arm.upper].position.copy(_sh);
      solveArm(arm, _sh, _t, arm.pole, _qa, _qb);
      // The hand turns to its grip: its rest frame onto the grip's, as seen from the forearm.
      _qf.copy(gq).multiply(gr.q).multiply(arm.handRestInv);
      _qg.copy(_qa).multiply(_qb).invert().multiply(_qf);
      const qu = B[arm.upper].quaternion;
      const ql = B[arm.lower].quaternion;
      const qw = B[arm.hand].quaternion;
      if (k > 0.001) {
        // Hand over hand: each arm reaches full height in turn.
        const reachUp = 0.97 - CLIMB.reach * (0.5 + 0.5 * Math.sin(this.climbPhase + (sd === 'L' ? 0 : Math.PI)));
        _t.copy(_sh).addScaledVector(arm.upDir, (arm.l1 + arm.l2) * reachUp);
        solveArm(arm, _sh, _t, arm.upPole, _qd, _qe);
        qu.slerpQuaternions(_qa, _qd, k);
        ql.slerpQuaternions(_qb, _qe, k);
        qw.identity().slerp(_qg, 1 - k);
      } else if (ra > 0.001) {
        _t.copy(RIDE.grips[sd]).sub(_sp).applyQuaternion(_qr);
        solveArm(arm, _sh, _t, arm.pole, _qd, _qe);
        qu.slerpQuaternions(_qa, _qd, ra);
        ql.slerpQuaternions(_qb, _qe, ra);
        qw.identity().slerp(_qg, 1 - ra);
      } else {
        qu.copy(_qa);
        ql.copy(_qb);
        qw.copy(_qg);
      }
    }

    this.popT += dt;
    if (this.shieldFlash > 0) {
      const u = this.shellUniforms;
      this.shell.visible = true;
      u.uFlash.value = Math.min(1, this.shieldFlash);
      u.uTime.value += dt;
      u.uPop.value = this.popT < SHIELD_POP ? Math.sin((this.popT / SHIELD_POP) * Math.PI) : 0;
      this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    } else if (this.shell.visible) {
      this.shell.visible = false;
    }
  }

  // Force every part visible for shader warm-up.
  warmup(on) {
    this.shell.visible = on;
    this.shellUniforms.uFlash.value = on ? 0.5 : 0;
  }

  // The light where the body stands (x, y feet, z), eased over a moment so moving between sun and
  // shade isn't a pop. Under something (a deck over the floor the bake knows), it's in shade.
  sampleLight(bake, x, y, z, dt) {
    if (!bake) return;
    let light = bake.lightAt(x, z);
    if (y < bake.groundAt(x, z) - 1) light = Math.min(light, UNDER_LIGHT);
    bake.glowAt(x, z, _bounce);
    const k = dt > 0 ? damp(5, dt) : 1;
    const u = this.local;
    u.uLocal.value += (light - u.uLocal.value) * k;
    u.uBounce.value.lerp(_bounce.multiplyScalar(BOUNCE), k);
  }

  dispose() {
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.shell.geometry.dispose();
    this.shellMaterial.dispose();
  }
}
