import * as THREE from 'three';
import { SIZZLER, SMOKE_RING, DRUM_ROLL, BIG_HOG, MOVE, BODY } from '../config.js';
import { Vitals } from '../combat/vitals.js';
import { dealDamage } from '../combat/damage.js';
import { explode } from '../combat/explosions.js';
import { partsGeometry, METAL, METAL_LIGHT, RUBBER, GLOW, ORANGE } from '../combat/weaponModels.js';
import { clamp, damp, DEG } from '../util/math.js';
import { gfx } from '../render/gfx.js';

// Vehicles, one class for every type (TYPES below: the tuning block in config.js, the model, the
// seat, and what it does besides drive). The Sizzler: a one-seat motorcycle with twin guns under
// the bars. The Smoke Ring: a hovercraft that floats over water too, slides sideways on A/D and
// throws ember bolts. The Drum Roll: a giant rolling smoker drum you ride inside (hidden, and
// sheltered), that rams, bounces off walls and slams the ground. The Big Hog: a pig you ride and
// shoot your own gun from, in first person, that charges.
//
// The Sizzler: Arcade handling: it turns
// toward where the rider looks (A/D or the left stick also steer it directly), throttle on
// forward and back, boost on sprint, a hop on jump. Its own hull takes damage (no shields, no
// regen) and blows up when it's gone, taking the rider with it; running into people at speed
// smokes them (splatter). Bikes come back to their spot after they're destroyed or left empty
// away from it for a while.
//
// Physics: a kinematic body moved by its own character controller (a ball, so turning never
// wedges it into a wall) plus a box the size of the bike for shots and blasts (the one collider
// registered as an entity). The rider's capsule rides along on the seat and stays hittable.
// Drawn as two instanced meshes (frames and wheels) shared by every bike.

export const SIZZLER_WEAPON = { id: 'sizzler', name: 'Sizzler' };
const SMOKE_RING_WEAPON = { id: 'smokeRing', name: 'Smoke Ring' };
const DRUM_WEAPON = { id: 'drumRoll', name: 'Drum Roll' };
const HOG_WEAPON = { id: 'bigHog', name: 'Big Hog' };

const PAINT = 0xc23a1a;
const CREAM = 0xe8dcc0;
const WHEEL_R = 0.36;
const WHEEL_Z = 0.75;
const SEAT_Z = 0.3;
// The rider's feet sit this far above the bike's ground point (the body is posed seated).
const SEAT_FEET = 0.12;
// Muzzles (bike space: x right, y up, -z ahead).
const MUZZLES = [new THREE.Vector3(-0.3, 0.72, -1.24), new THREE.Vector3(0.3, 0.72, -1.24)];
// The ball floats this far over the ground (the ground ray carries the bike), so terrain's
// creases and gentle slopes never catch it; it only meets walls, rocks and the like.
const BALL_LIFT = 0.35;
// Ground under the bike: how far it snaps down to stay on it (the steepest slope it drives up is
// the type's `maxSlope`, 40 degrees by default). The probe is a ball cast down from PROBE_UP over
// the ground (so it steps up anything lower than the floating ball's bottom and catches rocks
// and edges a single ray would miss).
const SNAP = 0.3;
const PROBE_R = 0.4;
const PROBE_UP = 0.75;
// Climbing a slope pulls it back by this share of gravity along the slope (and going down speeds
// it up).
const SLOPE_PULL = 0.35;
const GRAVITY = MOVE.gravity * 1.3;
// Exhaust stack tops (smoke while the engine runs, embers on a boost).
const STACKS = [new THREE.Vector3(-0.2, 1.22, 0.6), new THREE.Vector3(0.2, 1.22, 0.6)];

// The frame, tank (a little red smoker drum), seat, guns and trim. Bike space, ground at y 0.
const FRAME_PARTS = [
  [[0, 0.6, 0.02], [0.16, 0.14, 1.22], METAL],
  [[0, 0.45, 0.06], [0.34, 0.3, 0.5], METAL_LIGHT],
  [[0, 0.47, 0.06], [0.36, 0.06, 0.4], METAL],
  [[0, 0.82, -0.18], [0.44, 0.38, 0.62], PAINT, { shape: 'cyl', axis: 'z', seg: 18 }],
  [[0, 0.82, -0.18], [0.46, 0.4, 0.05], METAL, { shape: 'cyl', axis: 'z', seg: 18 }],
  [[0, 0.82, -0.44], [0.46, 0.4, 0.04], METAL, { shape: 'cyl', axis: 'z', seg: 18 }],
  [[0, 1.02, -0.18], [0.12, 0.05, 0.08], CREAM],
  [[0, 0.88, 0.36], [0.3, 0.1, 0.55], RUBBER],
  [[0, 0.8, 0.72], [0.26, 0.06, 0.46], PAINT],
  [[0, 0.8, 0.95], [0.18, 0.05, 0.02], 0xff3020, { finish: 'glow' }],
  // Swingarm and footpegs.
  [[-0.13, 0.42, 0.44], [0.04, 0.06, 0.62], METAL],
  [[0.13, 0.42, 0.44], [0.04, 0.06, 0.62], METAL],
  [[-0.25, 0.36, 0.12], [0.14, 0.04, 0.05], METAL_LIGHT],
  [[0.25, 0.36, 0.12], [0.14, 0.04, 0.05], METAL_LIGHT],
  // Side panels with an ember strip each.
  [[-0.19, 0.62, 0.3], [0.04, 0.22, 0.36], PAINT],
  [[0.19, 0.62, 0.3], [0.04, 0.22, 0.36], PAINT],
  [[-0.176, 0.48, 0.06], [0.004, 0.03, 0.44], GLOW],
  [[0.176, 0.48, 0.06], [0.004, 0.03, 0.44], GLOW],
  // Fork, bars and grips, headlight.
  [[-0.13, 0.66, -0.66], [0.06, 0.66, 0.06], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [-0.32, 0, 0] }],
  [[0.13, 0.66, -0.66], [0.06, 0.66, 0.06], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [-0.32, 0, 0] }],
  [[0, 1.0, -0.56], [0.3, 0.08, 0.1], METAL],
  [[0, 1.08, -0.52], [0.72, 0.05, 0.05], METAL, { shape: 'cyl', axis: 'x' }],
  [[-0.34, 1.08, -0.52], [0.12, 0.07, 0.07], RUBBER, { shape: 'cyl', axis: 'x' }],
  [[0.34, 1.08, -0.52], [0.12, 0.07, 0.07], RUBBER, { shape: 'cyl', axis: 'x' }],
  [[0, 0.93, -0.78], [0.22, 0.22, 0.12], METAL, { shape: 'cyl', axis: 'z' }],
  [[0, 0.93, -0.845], [0.17, 0.17, 0.02], 0xffe8b0, { shape: 'cyl', axis: 'z', finish: 'glow' }],
  [[0, 0.8, -0.76], [0.24, 0.05, 0.46], PAINT],
  // The twin guns, either side of the front wheel, with their ember strips.
  [[-0.3, 0.72, -0.78], [0.13, 0.13, 0.52], METAL],
  [[0.3, 0.72, -0.78], [0.13, 0.13, 0.52], METAL],
  [[-0.3, 0.72, -1.1], [0.07, 0.07, 0.28], METAL_LIGHT, { shape: 'cyl', axis: 'z', bore: 0.6 }],
  [[0.3, 0.72, -1.1], [0.07, 0.07, 0.28], METAL_LIGHT, { shape: 'cyl', axis: 'z', bore: 0.6 }],
  [[-0.3, 0.79, -0.78], [0.03, 0.008, 0.4], GLOW],
  [[0.3, 0.79, -0.78], [0.03, 0.008, 0.4], GLOW],
  [[-0.22, 0.72, -0.62], [0.12, 0.05, 0.06], METAL],
  [[0.22, 0.72, -0.62], [0.12, 0.05, 0.06], METAL],
  // Exhaust stacks (it's a smoker), leaning back, ember rims.
  [[-0.2, 0.95, 0.52], [0.09, 0.56, 0.09], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
  [[0.2, 0.95, 0.52], [0.09, 0.56, 0.09], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
  [[-0.2, 1.21, 0.6], [0.1, 0.03, 0.1], GLOW, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
  [[0.2, 1.21, 0.6], [0.1, 0.03, 0.1], GLOW, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
];
// One wheel about its axle (x): a fat tire, a hub and a spoke bar so you can see it turn.
const WHEEL_PARTS = [
  [[0, 0, 0], [0.2, WHEEL_R * 2, WHEEL_R * 2], RUBBER, { shape: 'cyl', axis: 'x', seg: 20 }],
  [[0, 0, 0], [0.22, 0.34, 0.34], METAL_LIGHT, { shape: 'cyl', axis: 'x', seg: 14 }],
  [[0, 0, 0], [0.23, 0.05, 0.4], PAINT],
  [[0, 0, 0], [0.23, 0.4, 0.05], METAL],
];

// The Smoke Ring: a round hover saucer (its rim painted, a glowing ring under it), a seat and
// bars on top, an ember gun on each side, two fins and an exhaust at the back. Drawn `hover`
// over its ground point.
const RING = 0x3a6a8a;
const RING_PARTS = [
  [[0, 0.15, 0], [1.7, 0.3, 1.7], RING, { shape: 'cyl', axis: 'y', seg: 24, taper: 0.82 }],
  [[0, 0.32, 0], [1.3, 0.08, 1.3], METAL, { shape: 'cyl', axis: 'y', seg: 24 }],
  [[0, -0.02, 0], [1.4, 0.04, 1.4], 0xff7a2a, { shape: 'cyl', axis: 'y', seg: 24, finish: 'glow' }],
  [[0, -0.04, 0], [0.9, 0.04, 0.9], METAL, { shape: 'cyl', axis: 'y', seg: 18 }],
  // The saddle up on a post (the rider's boots on the deck), the steering post and its bars.
  [[0, 0.7, 0.24], [0.16, 0.7, 0.2], METAL_LIGHT],
  [[0, 1.1, 0.26], [0.34, 0.14, 0.56], RUBBER],
  [[0, 0.78, -0.5], [0.12, 0.84, 0.12], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [-0.25, 0, 0] }],
  [[0, 0.5, -0.46], [0.5, 0.28, 0.36], RING],
  [[0, 1.22, -0.6], [0.7, 0.05, 0.05], METAL, { shape: 'cyl', axis: 'x' }],
  [[-0.33, 1.22, -0.6], [0.1, 0.07, 0.07], RUBBER, { shape: 'cyl', axis: 'x' }],
  [[0.33, 1.22, -0.6], [0.1, 0.07, 0.07], RUBBER, { shape: 'cyl', axis: 'x' }],
  [[0, 0.56, -0.645], [0.3, 0.08, 0.03], 0xfff0c0, { finish: 'glow' }],
  // An ember gun each side, two fins and the exhaust at the back.
  [[-0.72, 0.28, -0.2], [0.16, 0.16, 0.7], METAL],
  [[0.72, 0.28, -0.2], [0.16, 0.16, 0.7], METAL],
  [[-0.72, 0.28, -0.6], [0.09, 0.09, 0.2], ORANGE, { shape: 'cyl', axis: 'z', finish: 'glow' }],
  [[0.72, 0.28, -0.6], [0.09, 0.09, 0.2], ORANGE, { shape: 'cyl', axis: 'z', finish: 'glow' }],
  [[-0.28, 0.5, 0.72], [0.04, 0.32, 0.3], RING, { rot: [0, 0, 0.25] }],
  [[0.28, 0.5, 0.72], [0.04, 0.32, 0.3], RING, { rot: [0, 0, -0.25] }],
  [[0, 0.32, 0.82], [0.26, 0.26, 0.12], METAL_LIGHT, { shape: 'cyl', axis: 'z', bore: 0.7 }],
  [[0, 0.32, 0.86], [0.2, 0.2, 0.02], 0xff7a2a, { shape: 'cyl', axis: 'z', finish: 'glow' }],
];
const RING_MUZZLES = [new THREE.Vector3(-0.72, 0.28, -0.72), new THREE.Vector3(0.72, 0.28, -0.72)];
const RING_VENTS = [new THREE.Vector3(0, 0.32, 0.9)];

// The Drum Roll: a big smoker drum on its side (rolling about x), steel bands, end caps with a
// vent and a glowing grate each side, a handle. Drawn as the "wheel" (it all rolls).
const DRUM = 0x2a2c30;
const DRUM_R = 0.95;
const DRUM_PARTS = [
  [[0, 0, 0], [1.6, DRUM_R * 2, DRUM_R * 2], DRUM, { shape: 'cyl', axis: 'x', seg: 22 }],
  [[-0.52, 0, 0], [0.08, DRUM_R * 2 + 0.04, DRUM_R * 2 + 0.04], METAL_LIGHT, { shape: 'cyl', axis: 'x', seg: 22 }],
  [[0.52, 0, 0], [0.08, DRUM_R * 2 + 0.04, DRUM_R * 2 + 0.04], METAL_LIGHT, { shape: 'cyl', axis: 'x', seg: 22 }],
  [[0, 0, 0], [0.06, DRUM_R * 2 + 0.04, DRUM_R * 2 + 0.04], 0xc23a1a, { shape: 'cyl', axis: 'x', seg: 22 }],
  [[-0.81, 0, 0], [0.04, 1.2, 1.2], METAL, { shape: 'cyl', axis: 'x', seg: 18 }],
  [[0.81, 0, 0], [0.04, 1.2, 1.2], METAL, { shape: 'cyl', axis: 'x', seg: 18 }],
  [[-0.84, 0, 0], [0.02, 0.5, 0.5], 0xff6a1a, { shape: 'cyl', axis: 'x', seg: 14, finish: 'glow' }],
  [[0.84, 0, 0], [0.02, 0.5, 0.5], 0xff6a1a, { shape: 'cyl', axis: 'x', seg: 14, finish: 'glow' }],
  [[-0.855, 0, 0], [0.02, 0.5, 0.06], METAL],
  [[0.855, 0, 0], [0.02, 0.5, 0.06], METAL],
  [[0, DRUM_R + 0.06, 0], [0.4, 0.06, 0.1], METAL_LIGHT],
  [[0, -DRUM_R - 0.06, 0], [0.4, 0.06, 0.1], METAL_LIGHT],
];

// The Big Hog: a big pink pig (a chunky round body, a head with a snout, ears and a curly tail),
// a saddle on its back. Its legs are the "wheels": each swings about its hip with the gait.
const PINK = 0xe8a0a8;
const PINK_DARK = 0xc77a86;
const HOG_PARTS = [
  // A barrel of a body, the shoulders narrowing toward the head and the rump rounding off.
  [[0, 0.88, 0.1], [0.9, 0.8, 0.9], PINK, { shape: 'cyl', axis: 'z', seg: 20 }],
  [[0, 0.89, -0.5], [0.9, 0.8, 0.32], PINK, { shape: 'cyl', axis: 'z', seg: 20, taper: 0.8 }],
  [[0, 0.88, 0.7], [0.9, 0.8, 0.3], PINK, { shape: 'cyl', axis: 'z', seg: 20, taper: 0.62, rot: [0, Math.PI, 0] }],
  // The head, its snout, nostrils, eyes and floppy ears.
  [[0, 1.0, -0.86], [0.62, 0.58, 0.42], PINK, { shape: 'cyl', axis: 'z', seg: 16, taper: 0.8 }],
  [[0, 0.94, -1.12], [0.3, 0.24, 0.12], PINK_DARK, { shape: 'cyl', axis: 'z', seg: 14 }],
  [[-0.06, 0.94, -1.186], [0.05, 0.08, 0.012], 0x5a2a30, { bevel: 0 }],
  [[0.06, 0.94, -1.186], [0.05, 0.08, 0.012], 0x5a2a30, { bevel: 0 }],
  [[-0.13, 1.1, -1.074], [0.07, 0.08, 0.015], 0x141414, { finish: 'metal', bevel: 0 }],
  [[0.13, 1.1, -1.074], [0.07, 0.08, 0.015], 0x141414, { finish: 'metal', bevel: 0 }],
  [[-0.26, 1.27, -0.78], [0.22, 0.06, 0.26], PINK_DARK, { rot: [0.6, 0, 0.6] }],
  [[0.26, 1.27, -0.78], [0.22, 0.06, 0.26], PINK_DARK, { rot: [0.6, 0, -0.6] }],
  // A curly tail.
  [[0, 1.04, 0.88], [0.06, 0.06, 0.16], PINK_DARK, { rot: [0.9, 0, 0] }],
  [[0, 1.13, 0.95], [0.06, 0.12, 0.06], PINK_DARK],
  // The saddle and its blanket, a strap round the belly.
  [[0, 1.33, 0.0], [0.56, 0.1, 0.6], 0x6a3a1e, { bevel: 0.03 }],
  [[0, 1.29, 0.0], [0.84, 0.04, 0.72], 0xc23a1a],
  [[0, 0.88, 0.0], [0.93, 0.83, 0.08], 0x4a2a14, { shape: 'cyl', axis: 'z', seg: 20 }],
];
// One leg about its hip (the pivot at the origin): a thick pink leg and a dark hoof.
const HOG_LEG_PARTS = [
  [[0, -0.22, 0], [0.26, 0.5, 0.26], PINK, { shape: 'cyl', axis: 'y', seg: 10, taper: 0.8 }],
  [[0, -0.5, 0], [0.24, 0.08, 0.26], 0x3a2a24, { shape: 'cyl', axis: 'y', seg: 10 }],
];

// The vehicle types. S: the tuning block (config.js); weapon: who the kill feed credits; frame and
// wheel: models (null for none); wheels: where each "wheel" goes (bike space) and how it moves
// (roll: about its axle with the speed; steer: also turned by the steering; gait: a leg swinging
// with the stride, `phase` its place in the step); ball and box: the floating ball's radius and
// lift, the shot box's half sizes and height; seat: how far behind the middle and how high the
// rider's feet are (or `center`: the capsule's middle that high, curled up inside); nose: how
// far ahead of the middle the bumper is; span: how far apart the ground probes for the pitch are;
// muzzles; stacks: where its smoke comes out; engine: its sound's pitch (null: none); and what it
// does besides drive: hideRider, riderShoots (the rider's own gun, in first person), hover.
export const TYPES = {
  sizzler: {
    name: 'Sizzler', S: SIZZLER, weapon: SIZZLER_WEAPON, paint: PAINT,
    frame: FRAME_PARTS, wheel: WHEEL_PARTS,
    wheels: [{ at: [0, WHEEL_R, -WHEEL_Z], roll: WHEEL_R, steer: true }, { at: [0, WHEEL_R, WHEEL_Z], roll: WHEEL_R }],
    ball: [0.48, BALL_LIFT], box: [0.48, 0.5, 1.08], boxY: 0.62, seat: { z: SEAT_Z, feet: SEAT_FEET }, nose: 1.1, span: WHEEL_Z,
    muzzles: MUZZLES, stacks: STACKS, engine: 1, tracer: 0xffb24a,
  },
  smokeRing: {
    name: 'Smoke Ring', S: SMOKE_RING, weapon: SMOKE_RING_WEAPON, paint: RING,
    frame: RING_PARTS, wheel: null, wheels: [],
    ball: [0.75, 0.45], box: [0.85, 0.3, 0.85], boxY: 0.62, seat: { z: 0.24, feet: 0.36 }, nose: 0.9, span: 0.7,
    muzzles: RING_MUZZLES, stacks: RING_VENTS, engine: 1.45, tracer: 0xff6a2a, tracerWidth: 0.06, hover: true,
  },
  drumRoll: {
    name: 'Drum Roll', S: DRUM_ROLL, weapon: DRUM_WEAPON, paint: DRUM,
    frame: null, wheel: DRUM_PARTS, wheels: [{ at: [0, DRUM_R, 0], roll: DRUM_R }],
    ball: [0.85, 0.3], box: [0.85, DRUM_R, DRUM_R], boxY: DRUM_R, seat: { center: DRUM_R }, nose: 0.6, span: 0,
    muzzles: [], stacks: [], engine: 0.55, hideRider: true, ramReach: 1.0,
  },
  bigHog: {
    name: 'Big Hog', S: BIG_HOG, weapon: HOG_WEAPON, paint: PINK,
    frame: HOG_PARTS, wheel: HOG_LEG_PARTS,
    wheels: [
      { at: [-0.28, 0.56, -0.5], gait: 0 }, { at: [0.28, 0.56, -0.5], gait: Math.PI },
      { at: [-0.28, 0.56, 0.55], gait: Math.PI }, { at: [0.28, 0.56, 0.55], gait: 0 },
    ],
    ball: [0.6, 0.35], box: [0.48, 0.45, 1.1], boxY: 0.9, seat: { z: 0.0, feet: 0.57 }, nose: 1.2, span: 0.55, straddle: 0.5,
    muzzles: [], stacks: [], engine: null, riderShoots: true, firstPerson: true,
  },
};
export const VEHICLE_TYPES = Object.keys(TYPES);

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _a = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _down = new THREE.Vector3(0, -1, 0);
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };
const NO_ROT = { x: 0, y: 0, z: 0, w: 1 };
const DOWN = { x: 0, y: -1, z: 0 };

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Phong with vertex colors, and glow parts (aFinish 4) lit on their own.
function bikeMaterial() {
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x3a3a3a });
  m.name = 'sizzler';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFinish;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aFinish > 3.5 ? 1.0 : 0.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 1.6;');
  };
  m.customProgramCacheKey = () => 'sizzler';
  return m;
}

class Bike {
  constructor(vehicles, spot, index) {
    const game = vehicles.game;
    const { RAPIER, world } = game.physics;
    this.vehicles = vehicles;
    this.game = game;
    this.kind = 'vehicle';
    const T = (this.T = TYPES[spot.type] ?? TYPES.sizzler);
    const S = (this.S = T.S);
    this.type = spot.type in TYPES ? spot.type : 'sizzler';
    this.name = T.name;
    this.index = index;
    this.spot = spot;
    this.vitals = new Vitals({ maxShield: 0, maxHealth: S.health, shieldDelay: Infinity, shieldRechargeRate: 0, healthRegenRate: 0 });
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.ball = world.createCollider(RAPIER.ColliderDesc.ball(T.ball[0]).setTranslation(0, T.ball[1] + T.ball[0], 0), this.body);
    this.box = world.createCollider(RAPIER.ColliderDesc.cuboid(...T.box).setTranslation(0, T.boxY, 0), this.body);
    game.registerEntity(this.box, this);
    this.cc = world.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    const slope = S.maxSlope ?? 40;
    this.cc.setMaxSlopeClimbAngle(slope * DEG);
    this.cc.setMinSlopeSlideAngle(slope * DEG);
    // (The ground ray's limit is a little under the ball's, so the ray stops it first.)
    this.maxSlopeY = Math.cos((slope - 2) * DEG);
    this.filter = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    // The ground ray: level geometry only (not bodies, not this bike).
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.probe = new RAPIER.Ball(PROBE_R);
    this.probeAt = { x: 0, y: 0, z: 0 };
    this.notBody = (c) => !game.entities.has(c.handle);
    this.ground = { y: 0, ny: 1, nx: 0, nz: 0 };
    // (Not its own box, and not its rider.)
    this.ignore = (c) => c.handle !== this.box.handle && c.handle !== this.rider?.collider.handle;
    this.desired = { x: 0, y: 0, z: 0 };
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.rider = null;
    // Who rode it last (a bike rolling on empty still splatters for them).
    this.lastRider = null;
    this.engine = null;
    this.reset();
  }

  get alive() {
    return this.vitals.alive;
  }

  // Back in its spot, whole and cool.
  reset() {
    const s = this.spot;
    this.pos.copy(s.pos);
    this.prevPos.copy(s.pos);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = s.yaw;
    this.pitch = this.prevPitch = 0;
    this.roll = this.prevRoll = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.grounded = true;
    this.airT = 0;
    // How fast the ground under us was rising (m/s): leaving it, we keep that (off a ramp's lip).
    this.climb = 0;
    this.vitals.reset();
    this.heat = 0;
    this.overheatT = 0;
    this.ventT = 0;
    this.boost = 1;
    this.boostWait = 0;
    this.boosting = false;
    this.shotT = 0;
    this.barrel = 0;
    this.spin = 0;
    // The hog's legs (strides taken), its charge, and the drum's slam (seconds until ready).
    this.stride = 0;
    this.chargeT = this.chargeWait = 0;
    this.slamWait = 0;
    this.boost2 = 1;
    this.throttle = 0;
    this.emptyT = 0;
    this.deadT = 0;
    this.lastRider = null;
    this.bumped = new Map();
    this.box.setEnabled(true);
    this.ball.setEnabled(true);
    this.place();
  }

  place() {
    this.body.setTranslation(this.pos, true);
    this.body.setNextKinematicTranslation(this.pos);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.body.setRotation(_q, true);
    this.body.setNextKinematicRotation(_q);
  }

  // ---------------------------------------------------------------- target interface

  headLineY() {
    return Infinity;
  }

  centerPosition(out) {
    return out.set(this.pos.x, this.pos.y + this.T.boxY, this.pos.z);
  }

  facing(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  distanceToBody(p) {
    return Math.max(0, p.distanceTo(this.centerPosition(_v)) - 0.7);
  }

  // Shots on the hull: the rider hears about it (bots turn to look).
  onDamaged(res, info) {
    if (this.rider && info.attacker && info.attacker !== this.rider) this.rider.brain?.onHurt(info.attacker);
  }

  // Blown up: a blast that smokes the rider (credited to whoever finished the bike), then gone
  // until it respawns.
  die(info) {
    const game = this.game;
    const rider = this.rider;
    const S = this.S;
    this.centerPosition(_a);
    const attacker = info?.attacker ?? null;
    if (S.blast) {
      if (rider) this.vehicles.dismount(rider, true);
      if (rider?.alive) dealDamage(game, rider, 1e6, { attacker, weapon: info?.weapon ?? this.T.weapon, cause: 'explosion', point: _a });
      explode(game, _a, { ...S.blast, tint: 0xff8a3a }, { attacker, weapon: this.T.weapon });
      game.fx.deathPuff(_a.x, this.pos.y, _a.z);
    } else {
      // (The hog: it collapses and throws its rider off.)
      if (rider) this.vehicles.dismount(rider);
      game.sfx.play('oink', { at: _a, volume: 1.4, rate: 0.7 });
      game.fx.deathPuff(_a.x, this.pos.y, _a.z, this.T.paint);
    }
    this.box.setEnabled(false);
    this.ball.setEnabled(false);
    this.deadT = 0;
    this.vel.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- driving

  tick(dt) {
    const S = this.S;
    const T = this.T;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.prevRoll = this.roll;
    if (!this.alive) {
      // Back after a while, once nobody's standing in its spot.
      if ((this.deadT += dt) >= S.respawn && this.vehicles.spotClear(this)) this.reset();
      return;
    }
    // In a Gravity Gun (combat/gravity.js carries it, rider and all).
    if (this.heldBy) return;
    const r = this.rider;
    const inp = r ? r.input : null;
    const pressed = r ? r.ridePressed : null;

    // Left empty away from its spot: back home after a while.
    if (!r) {
      const away = this.pos.distanceTo(this.spot.pos) > 3;
      this.emptyT = away ? this.emptyT + dt : 0;
      if (this.emptyT > S.abandoned && this.vehicles.spotClear(this)) {
        this.reset();
        return;
      }
    }

    // Steering: A/D (or the left stick) turn the rider's view, and the bike turns toward the view.
    // (A hovercraft slides sideways on them instead.)
    if (r && inp.moveX && !S.strafe) {
      r.yaw = wrap(r.yaw - inp.moveX * S.steer * dt);
    }
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    let vF = this.vel.x * _f.x + this.vel.z * _f.z;
    if (r) {
      const k = this.grounded ? clamp(S.slowTurn + Math.abs(vF) / 6, S.slowTurn, 1) : S.airTurn;
      const max = S.turn * k * dt;
      // (A bot can drive one way and aim another, within the guns' swing: driveYaw.)
      const d = clamp(wrap((r.driveYaw ?? r.yaw) - this.yaw), -max, max);
      this.yaw = wrap(this.yaw + d);
      this.yawRate = d / dt;
    } else {
      this.yawRate = 0;
    }
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _r.set(-_f.z, 0, _f.x);
    vF = this.vel.x * _f.x + this.vel.z * _f.z;
    let vS = this.vel.x * _r.x + this.vel.z * _r.z;

    let throttle = inp ? inp.moveY : 0;
    _v.copy(this.pos);
    // (A hovercraft floats over the mud and the water.)
    const inMud = !T.hover && this.game.zones.inMud(_v);
    if (S.charge) {
      // The hog's charge: sprint sets it off (when it's ready), flat out ahead for a while.
      const C = S.charge;
      this.chargeWait = Math.max(0, this.chargeWait - dt);
      if (this.chargeT > 0) {
        this.chargeT -= dt;
      } else if (pressed?.sprint && this.chargeWait <= 0 && this.grounded && !inMud) {
        this.chargeT = C.time;
        this.chargeWait = C.time + C.cooldown;
        this.game.sfx.play('oink', { at: this.pos, source: r, volume: 1.2 });
      }
      this.boosting = this.chargeT > 0;
      this.boost = 1 - this.chargeWait / (C.time + C.cooldown);
      if (this.boosting) throttle = 1;
    } else {
      this.boosting = !!inp && inp.held.sprint && throttle > 0.2 && this.boost > 0 && this.grounded && !inMud;
      if (this.boosting) {
        this.boost = Math.max(0, this.boost - dt / S.boostTank);
        this.boostWait = S.boostPause;
      } else if ((this.boostWait -= dt) <= 0) {
        this.boost = Math.min(1, this.boost + S.boostRefill * dt);
      }
    }
    this.throttle = throttle;
    if (this.grounded) {
      let max = this.boosting ? (S.charge ? S.charge.speed : S.boostSpeed) : S.topSpeed;
      if (inMud) max = Math.min(max, S.mudSpeed);
      if (throttle > 0.05) {
        const want = max * throttle;
        if (vF < 0) vF = Math.min(0, vF + S.brake * dt);
        else if (vF < want) vF = Math.min(want, vF + (this.boosting ? S.boostAccel * (S.charge ? 3 : 1) : S.accel) * dt);
        else vF = Math.max(want, vF - S.overDrag * dt);
      } else if (throttle < -0.05) {
        if (vF > 0.3) vF = Math.max(0, vF + S.brake * throttle * dt);
        else vF = Math.max(-S.reverseSpeed * -throttle, vF + S.accel * 0.6 * throttle * dt);
      } else {
        const c = (r ? S.coast : S.coast * 3) * dt;
        vF = Math.abs(vF) <= c ? 0 : vF - Math.sign(vF) * c;
      }
      if (inMud && Math.abs(vF) > S.mudSpeed) vF -= Math.sign(vF) * S.overDrag * 2 * dt;
      if (S.strafe && inp && Math.abs(inp.moveX) > 0.05) {
        // Sliding sideways (toward the stick, as fast as `strafe`).
        const want = inp.moveX * S.strafe;
        vS += clamp(want - vS, -S.accel * dt, S.accel * dt);
      } else {
        vS *= Math.exp(-S.grip * dt);
      }
      // Hills pull it back going up and push it going down.
      vF -= GRAVITY * Math.sin(this.pitch) * SLOPE_PULL * dt;
      if (pressed?.jump && S.hop > 0) {
        this.vel.y = S.hop + Math.max(0, this.climb);
        this.grounded = false;
        this.game.sfx.play(S.charge ? 'oink' : 'wallKick', { at: this.pos, source: r, rate: S.charge ? 1.15 : 0.7 });
      } else {
        this.vel.y = 0;
      }
    } else {
      this.vel.y = Math.max(-MOVE.maxFallSpeed, this.vel.y - GRAVITY * dt);
    }
    this.vel.x = _f.x * vF + _r.x * vS;
    this.vel.z = _f.z * vF + _r.z * vS;

    // The drum's slam: the trigger shoves and hurts everyone close by (not its rider).
    if (S.slam) {
      this.slamWait = Math.max(0, this.slamWait - dt);
      if (pressed?.fire && this.slamWait <= 0) this.slam();
      this.boost2 = 1 - this.slamWait / S.slam.cooldown;
    }

    this.runInto(vF, dt);

    // Move. The ball (floating over the ground) takes walls, rocks and the rest of the level; a
    // ray down from the middle finds the ground the bike rides on.
    const d = this.desired;
    d.x = this.vel.x * dt;
    d.y = this.grounded ? 0 : this.vel.y * dt;
    d.z = this.vel.z * dt;
    this.cc.computeColliderMovement(this.ball, d, this.filter, undefined, this.ignore);
    const m = this.cc.computedMovement();
    const oldY = this.pos.y;
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    // Hitting a wall eats the speed into it (the drum bounces off instead, keeping `bounce` of it).
    const want = Math.hypot(d.x, d.z);
    if (want > 1e-4) {
      const blocked = Math.hypot(m.x, m.z) < want * 0.6;
      if (blocked && want / dt > 9) {
        this.game.sfx.play('smash', { at: this.pos, volume: 0.5, rate: S.bounce ? 0.6 : 0.8 });
        r?.addShake?.(0.4);
      }
      // (The wall's normal, roughly: back against what didn't happen.)
      const bx = d.x - m.x;
      const bz = d.z - m.z;
      const bl = Math.hypot(bx, bz);
      if (S.bounce && blocked && bl > want * 0.3 && want / dt > 4) {
        const nx = -bx / bl;
        const nz = -bz / bl;
        const into = this.vel.x * nx + this.vel.z * nz;
        if (into < 0) {
          this.vel.x = (this.vel.x - 2 * into * nx) * S.bounce;
          this.vel.z = (this.vel.z - 2 * into * nz) * S.bounce;
        }
      } else {
        this.vel.x = m.x / dt;
        this.vel.z = m.z / dt;
      }
    }
    const wasAir = !this.grounded;
    const fall = -this.vel.y;
    const g = this.groundBelow();
    if (this.grounded) {
      if (g && g.ny < this.maxSlopeY && g.y > oldY + 0.02 && g.nx * this.vel.x + g.nz * this.vel.z < 0) {
        // Too steep to drive up: it stops it like a wall, keeping the speed along it.
        this.pos.x -= m.x;
        this.pos.z -= m.z;
        const h = Math.hypot(g.nx, g.nz) || 1;
        const into = (this.vel.x * g.nx + this.vel.z * g.nz) / h;
        this.vel.x -= (into * g.nx) / h;
        this.vel.z -= (into * g.nz) / h;
      } else if (g && g.y >= this.pos.y - SNAP && !(this.climb > 2.5 && g.y < oldY + (this.climb - GRAVITY * dt) * dt - 0.02)) {
        this.pos.y = g.y;
      } else {
        // The ground dropped away (or fell off faster than our climb's arc): fly, carrying the
        // climb (off a ramp's lip or a crest at speed).
        this.grounded = false;
        this.vel.y = Math.max(0, this.climb);
      }
      if (this.grounded) this.climb = clamp((this.pos.y - oldY) / dt, -20, 20);
    } else if (g && this.vel.y <= 0 && this.pos.y <= g.y + 0.02) {
      this.pos.y = g.y;
      this.grounded = true;
      this.climb = 0;
    }
    if (this.grounded) {
      this.vel.y = 0;
      if (wasAir && this.airT > 0.25) {
        this.game.sfx.play('stepMetal', { at: this.pos, source: r, volume: Math.min(1.2, 0.4 + fall / 12), rate: 0.6 });
        if (r) r.addShake(Math.min(0.6, fall / 25));
      }
      this.airT = 0;
    } else {
      this.airT += dt;
      // Bumped the head on something: stop rising.
      if (this.vel.y > 0 && m.y < d.y * 0.5) this.vel.y = 0;
    }

    this.lean(dt, vF);
    this.spin += (vF * dt) / (T.wheels[0]?.roll || 1);
    this.stride += (Math.abs(vF) * dt) / (1.2 + Math.abs(vF) * 0.12);
    this.body.setNextKinematicTranslation(this.pos);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.body.setNextKinematicRotation(_q);

    if (r) {
      this.seat(r);
      // What the reticle is on (it turns red, and controllers slow down over it).
      if (!r.isBot) {
        this.vehicles.aimPoint(r, this);
        r.aimTarget = this.vehicles.aimEntity;
      }
      if (S.gun) this.shoot(dt, inp);
    } else if (S.gun) {
      this.heatDown(dt);
    }
    if (this.pos.y < -20) dealDamage(this.game, this, 1e6, { cause: 'fell' });
  }

  // Nose up and down with the ground under the wheels (or the arc in the air), leaning into turns.
  lean(dt, vF) {
    let pitch = 0;
    const span = this.T.span;
    if (!span) {
      // (A drum stays upright: it only rolls.)
    } else if (this.grounded) {
      const fy = this.groundAt(-span);
      const by = this.groundAt(span);
      if (fy !== null && by !== null) pitch = Math.atan2(fy - by, span * 2);
    } else {
      pitch = clamp(Math.atan2(this.vel.y, Math.max(4, Math.abs(vF))) * 0.6, -0.5, 0.5);
    }
    this.pitch += (pitch - this.pitch) * damp(this.grounded ? 14 : 4, dt);
    const roll = !span ? 0 : this.grounded ? clamp(this.yawRate * vF * 0.035 * (this.T.leanIn ?? 1), -0.45, 0.45) : this.roll * 0.98;
    this.roll += (roll - this.roll) * damp(6, dt);
    this.steer += (clamp(this.yawRate * 0.18, -0.4, 0.4) - this.steer) * damp(10, dt);
  }

  // The ground under the bike: its height (the probe ball's lowest point where it lands) and the
  // slope under the middle (a ray; flat if the ray finds nothing), in this.ground; or null.
  groundBelow() {
    const world = this.game.physics.world;
    const reach = this.grounded ? SNAP + 0.05 : Math.max(0.05, -this.vel.y * (1 / 60) + 0.05);
    const at = this.probeAt;
    at.x = this.pos.x;
    at.y = this.pos.y + PROBE_UP;
    at.z = this.pos.z;
    const hit = world.castShape(at, NO_ROT, DOWN, this.probe, 0, PROBE_UP - PROBE_R + reach, false, this.filter, undefined, undefined, this.body, this.notBody);
    const g = this.ground;
    // A hovercraft rides on the water and the mud's surface (no collider there).
    if (this.T.hover) {
      _v.copy(this.pos);
      const top = this.game.zones.mudTop(_v, reach + 0.05);
      if (top !== null && (!hit || top > at.y - (hit.time_of_impact ?? hit.timeOfImpact) - PROBE_R)) {
        g.y = top;
        g.nx = g.nz = 0;
        g.ny = 1;
        return g;
      }
    }
    if (!hit) return null;
    g.y = at.y - (hit.time_of_impact ?? hit.timeOfImpact) - PROBE_R;
    const ray = this.ray;
    ray.origin.x = at.x;
    ray.origin.y = at.y;
    ray.origin.z = at.z;
    const r = world.castRayAndGetNormal(ray, PROBE_UP + reach + 0.3, true, this.filter, undefined, undefined, this.body, this.notBody);
    g.nx = r ? r.normal.x : 0;
    g.ny = r ? r.normal.y : 1;
    g.nz = r ? r.normal.z : 0;
    return g;
  }

  // The ground's height under a point `z` along the bike (bike space), or null.
  groundAt(z) {
    _v.set(Math.sin(this.yaw) * z, 0, Math.cos(this.yaw) * z).add(this.pos);
    _v.y += 0.9;
    const hit = this.game.surfaceNear(_v, _down, 1.8, _hit);
    return hit ? hit.point.y : null;
  }

  // Running into people: a shove and a hit, or a splatter at speed.
  runInto(vF, dt) {
    const S = this.S;
    const speed = Math.abs(vF);
    if (speed < S.bump) return;
    const dir = Math.sign(vF);
    const killer = this.rider ?? this.lastRider;
    const now = this.game.time;
    _a.set(-Math.sin(this.yaw) * this.T.nose * 0.6 * dir, 0, -Math.cos(this.yaw) * this.T.nose * 0.6 * dir).add(this.pos);
    // (Players, and the training dummies too.)
    const targets = this.game.dummies.length ? [...this.game.players, ...this.game.dummies] : this.game.players;
    for (const p of targets) {
      if (!p.alive || p === this.rider || p.vehicle) continue;
      p.centerPosition(_v2);
      const feet = p.feetY();
      if (feet > this.pos.y + 1.3 || feet + (p.height ?? BODY.standHeight) < this.pos.y) continue;
      const dx = _v2.x - _a.x;
      const dz = _v2.z - _a.z;
      const reach = (p.radius ?? BODY.radius) + (this.T.ramReach ?? 0.55) + speed * dt;
      if (dx * dx + dz * dz > reach * reach) continue;
      // Only what's ahead (or behind, reversing).
      if ((dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) * dir < -0.3) continue;
      if (now - (this.bumped.get(p) ?? -9) < 0.6) continue;
      this.bumped.set(p, now);
      _v.set(-Math.sin(this.yaw) * dir, 0.35, -Math.cos(this.yaw) * dir).normalize();
      const info = { attacker: killer && killer !== p ? killer : null, weapon: this.T.weapon, cause: 'splatter', point: this.pos, dir: _v };
      if (speed >= S.splatter) {
        this.game.sfx.play('smash', { at: _v2, volume: 1 });
        const res = dealDamage(this.game, p, 1e6, info);
        if (res) this.rider?.onHitConfirmed(res, false);
      } else {
        this.game.sfx.play('bash', { at: _v2 });
        p.knockback?.(_v, speed * 0.9);
        const res = dealDamage(this.game, p, S.bumpDamage * (speed / S.splatter), info);
        if (res) this.rider?.onHitConfirmed(res, false);
        this.vel.multiplyScalar(0.55);
      }
    }
  }

  // The drum slams down: everyone close by (in reach of it, not behind cover) is shoved away and
  // hurt, more the closer they are.
  slam() {
    const L = this.S.slam;
    const game = this.game;
    const r = this.rider;
    this.slamWait = L.cooldown;
    _a.set(this.pos.x, this.pos.y + 0.4, this.pos.z);
    const targets = game.dummies.length ? [...game.players, ...game.dummies] : game.players;
    for (const p of targets) {
      if (!p.alive || p === r) continue;
      p.centerPosition(_v2);
      const d = _v2.distanceTo(_a);
      if (d > L.radius) continue;
      _v.subVectors(_v2, _a);
      if (game.surfaceNear(_a, _v.normalize(), d, _hit)) continue;
      const k = 1 - (d / L.radius) * 0.6;
      _v.y = 0;
      if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
      _v.normalize();
      _v.y = 0.7;
      _v.normalize();
      p.knockback?.(_v, L.knockback * k);
      const res = dealDamage(game, p, L.damage * k, { attacker: r, weapon: this.T.weapon, cause: 'explosion', point: _a, dir: _v });
      if (res) r?.onHitConfirmed(res, false);
    }
    _v.set(this.pos.x, this.pos.y + 0.15, this.pos.z);
    const floor = this.grounded ? { point: _v, normal: THREE.Object3D.DEFAULT_UP } : null;
    game.fx.explosion(_a, L.radius, { tint: 0xff9a40, ring: floor });
    game.sfx.play('boom', { at: _a, source: r, volume: 0.8, rate: 1.3 });
    game.sfx.play('smash', { at: _a, source: r, volume: 1, rate: 0.6 });
    game.noise(r, 40);
    r?.addShake(0.7);
    // (A little bounce up off it.)
    if (this.grounded) {
      this.vel.y = 3.5;
      this.grounded = false;
    }
  }

  // The rider on the seat: their capsule rides along (and stays hittable).
  seat(p) {
    const st = this.T.seat;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const z = st.z ?? 0;
    // (Curled up inside: the capsule's middle at `center`.)
    const y = st.center !== undefined ? st.center : st.feet + p.halfHeight + p.radius;
    p.center.set(this.pos.x + s * z, this.pos.y + y + this.lift(), this.pos.z + c * z);
    p.vel.copy(this.vel);
    p.grounded = this.grounded;
    p.body.setNextKinematicTranslation(p.center);
  }

  // ---------------------------------------------------------------- guns

  heatDown(dt) {
    if (this.overheatT > 0) {
      this.overheatT -= dt;
      this.heat = Math.max(0, this.overheatT / this.S.gun.cool);
      return;
    }
    if ((this.ventT -= dt) <= 0) this.heat = Math.max(0, this.heat - this.S.gun.vent * dt);
  }

  get overheated() {
    return this.overheatT > 0;
  }

  shoot(dt, inp) {
    const G = this.S.gun;
    this.shotT -= dt;
    if (!inp.held.fire || this.overheatT > 0) {
      this.heatDown(dt);
      if (this.shotT < 0) this.shotT = 0;
      return;
    }
    while (this.shotT <= 0 && this.overheatT <= 0) {
      this.shotT += 1 / G.rate;
      this.fire();
      this.heat += G.heatPerShot;
      this.ventT = G.ventDelay;
      if (this.heat >= 1) {
        this.heat = 1;
        this.overheatT = G.cool;
        this.game.sfx.play('vent', { at: this.pos, source: this.rider, volume: 1.4 });
      }
    }
  }

  // One round from the next barrel toward what the rider's reticle is on, kept within the guns'
  // swing off the bike's heading.
  fire() {
    const G = this.S.gun;
    const T = this.T;
    const game = this.game;
    const p = this.rider;
    const aim = this.vehicles.aimPoint(p, this);
    const muzzle = this.muzzle(this.barrel, _a);
    this.barrel = (this.barrel + 1) % T.muzzles.length;
    _v.subVectors(aim, muzzle);
    const len = _v.length();
    if (len < 1e-3) _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    else _v.divideScalar(len);
    // Clamp to the swing (yaw off the heading) and the pitch limits.
    let yawOff = wrap(Math.atan2(-_v.x, -_v.z) - this.yaw);
    yawOff = clamp(yawOff, -G.swing, G.swing);
    const pitch = clamp(Math.asin(clamp(_v.y, -1, 1)), this.pitch - G.pitchDown, this.pitch + G.pitchUp);
    const ya = this.yaw + yawOff;
    // Spread.
    const sp = G.spread * DEG * Math.sqrt(Math.random());
    const ang = Math.random() * Math.PI * 2;
    const yaw2 = ya + Math.cos(ang) * sp;
    const pitch2 = pitch + Math.sin(ang) * sp;
    _f.set(-Math.sin(yaw2) * Math.cos(pitch2), Math.sin(pitch2), -Math.cos(yaw2) * Math.cos(pitch2));
    const hit = game.castShot(muzzle, _f, G.range, this.box);
    _v2.copy(muzzle).addScaledVector(_f, hit.hit ? hit.distance : G.range);
    const tw = T.tracerWidth ?? 0.035;
    game.fx.tracer(muzzle, _v2, T.tracer, tw, { linger: 0.05 });
    game.replay?.shot(p, muzzle, _v2, T.tracer, tw, 0.05);
    if (gfx.thirdPersonFlashes) game.fx.muzzleFlash(muzzle, _f, T.tracer, 0.32, -1);
    game.sfx.play('smg', { at: muzzle, source: p, volume: 0.75, rate: (T.gunPitch ?? 0.82) + Math.random() * 0.06 });
    if (game.swarms.count) game.swarms.shot(muzzle, _f, hit.hit ? hit.distance : G.range, G.damage, p);
    game.noise(p, 30);
    if (!hit.hit) return;
    if (hit.entity) {
      if (hit.entity.kind === 'vehicle') game.fx.impactWorld(hit.point, hit.normal, 'metal');
      else game.fx.impactBody(hit.point, hit.normal, hit.entity.vitals.shield > 0);
      const res = dealDamage(game, hit.entity, G.damage, { attacker: p, weapon: T.weapon, point: hit.point, dir: _f });
      if (res) p.onHitConfirmed(res, false);
    } else {
      const surface = game.trimFace(hit.point, hit.normal, hit.surface);
      game.fx.impactWorld(hit.point, hit.normal, surface);
      if (this.barrel === 0) game.fx.mark(hit.point, hit.normal, surface);
    }
  }

  // A barrel's muzzle in the world, as of this tick.
  muzzle(i, out) {
    _e.set(this.pitch, this.yaw, this.roll);
    _q.setFromEuler(_e);
    return out.copy(this.T.muzzles[i]).applyQuaternion(_q).add(this.pos);
  }

  // ---------------------------------------------------------------- looks

  // How far over its ground point it's drawn: a hovercraft floats, bobbing a little.
  lift() {
    const h = this.S.hover;
    return h ? h + Math.sin(this.game.time * 2.4 + this.index) * 0.04 : 0;
  }

  // The bike's matrix for drawing, between the last tick and this one.
  matrix(alpha, out) {
    _v.lerpVectors(this.prevPos, this.pos, alpha);
    _v.y += this.lift();
    const yaw = this.prevYaw + wrap(this.yaw - this.prevYaw) * alpha;
    _e.set(this.prevPitch + (this.pitch - this.prevPitch) * alpha, yaw, this.prevRoll + (this.roll - this.prevRoll) * alpha);
    _q.setFromEuler(_e);
    return out.compose(_v, _q, _one);
  }

  // The drawn heading (for the rider's body).
  drawnYaw(alpha) {
    return this.prevYaw + wrap(this.yaw - this.prevYaw) * alpha;
  }

  dispose() {
    const world = this.game.physics.world;
    world.removeCharacterController(this.cc);
    world.removeRigidBody(this.body);
  }
}

// Every vehicle on the map, their meshes, mounting and the riders' chase camera.
export class Vehicles {
  // spots: [{ pos: [x, y, z], yaw, type }], from the map's build (arena.vehicles).
  constructor(game, spots) {
    this.game = game;
    this.bikes = spots.map((s, i) => new Bike(this, { pos: new THREE.Vector3(...s.pos), yaw: s.yaw, type: s.type }, i));
    const mat = (this.material = bikeMaterial());
    // One frame mesh and one wheel mesh per type on the map (wheels: legs and drums too).
    this.meshes = [];
    this.meshList = [];
    for (const type of VEHICLE_TYPES) {
      const n = this.bikes.filter((b) => b.type === type).length;
      if (!n) continue;
      const T = TYPES[type];
      const set = { type, T, frame: null, wheel: null };
      if (T.frame) set.frame = new THREE.InstancedMesh(partsGeometry(T.frame, T.paint), mat, n);
      if (T.wheel) set.wheel = new THREE.InstancedMesh(partsGeometry(T.wheel, T.paint), mat, n * T.wheels.length);
      for (const m of [set.frame, set.wheel]) {
        if (!m) continue;
        m.name = `${type}${m === set.frame ? 'Frames' : 'Wheels'}`;
        m.castShadow = true;
        m.receiveShadow = true;
        // (They move all over the map.)
        m.frustumCulled = false;
        game.scene.add(m);
        this.meshList.push(m);
      }
      this.meshes.push(set);
    }
    this._aim = new THREE.Vector3();
    this.aimEntity = null;
    this.updateVisuals(0, 1);
  }

  tick(dt) {
    for (const b of this.bikes) b.tick(dt);
  }

  // A player standing by a free vehicle: offer it, and get on when they press interact.
  touch(p, pressed) {
    p.vehiclePrompt = null;
    if (p.mode !== 'move' || p.guiding || p.pickupPrompt) return;
    let best = null;
    let bd = Infinity;
    for (const b of this.bikes) {
      if (!b.alive || b.rider || b.heldBy) continue;
      const z = b.T.seat.z ?? 0;
      const dx = b.pos.x + Math.sin(b.yaw) * z - p.center.x;
      const dz = b.pos.z + Math.cos(b.yaw) * z - p.center.z;
      const dy = b.pos.y - p.feetY();
      if (Math.abs(dy) > 1.2) continue;
      const d = dx * dx + dz * dz;
      const R = b.S.reach;
      if (d < R * R && d < bd) {
        bd = d;
        best = b;
      }
    }
    p.vehiclePrompt = best;
    if (best && pressed.interact) this.mount(p, best);
  }

  mount(p, b) {
    p.vehiclePrompt = null;
    p.vehicle = b;
    b.rider = p;
    b.lastRider = p;
    b.emptyT = 0;
    p.ridePressed = null;
    p.endRide?.(false);
    p.startRide(b);
    b.seat(p);
    p.prevCenter.copy(p.center);
    this.game.sfx.play(b.T.riderShoots ? 'oink' : 'swap', { at: b.pos, source: p });
  }

  // Off, beside it (whichever side has room). `dead`: the rider is going down with it.
  dismount(p, dead = false) {
    const b = p.vehicle;
    if (!b) return;
    b.rider = null;
    p.vehicle = null;
    p.driveYaw = null;
    p.endRide(dead);
    if (dead) return;
    const s = Math.sin(b.yaw);
    const c = Math.cos(b.yaw);
    const y = b.pos.y + 0.1;
    const side = b.T.box[0] + 0.75;
    const back = b.T.box[2] + 0.8;
    // Left, right, behind, then on top.
    const spots = [[-c * side, s * side], [c * side, -s * side], [s * back, c * back]];
    let placed = false;
    for (const [ox, oz] of spots) {
      const x = b.pos.x + ox;
      const z = b.pos.z + oz;
      if (!p.overlaps(p.standShape, x, y + p.halfHeight + p.radius + 0.05, z)) {
        p.center.set(x, y + p.halfHeight + p.radius + 0.05, z);
        placed = true;
        break;
      }
    }
    if (!placed) p.center.set(b.pos.x, b.pos.y + b.T.boxY * 2 + 0.2 + p.halfHeight + p.radius, b.pos.z);
    p.prevCenter.copy(p.center);
    p.body.setTranslation(p.center, true);
    p.body.setNextKinematicTranslation(p.center);
    // Hop off with some of its speed.
    p.vel.set(b.vel.x * 0.4, 2, b.vel.z * 0.4);
    p.grounded = false;
    this.game.sfx.play('swap', { at: b.pos, source: p });
  }

  // Nobody (no player, no other vehicle) in a vehicle's spot, so it can come back there.
  spotClear(b) {
    const s = b.spot.pos;
    for (const p of this.game.players) if (p.alive && Math.hypot(p.center.x - s.x, p.center.z - s.z) < 2.2) return false;
    for (const o of this.bikes) if (o !== b && o.alive && Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 2.6) return false;
    return true;
  }

  // Where a rider's reticle is: the first thing along the chase camera's center line, cast from
  // just past the rider (so nothing between the camera and the bike gets in the way). Bots have
  // no camera: from their eye.
  aimPoint(p, b) {
    const range = b.S.gun?.range ?? 70;
    _f.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    if (p.isBot || !p.camDist) p.eyePosition(_v);
    else _v.copy(p.camera.position).addScaledVector(_f, p.camDist + 0.3);
    const hit = this.game.castShot(_v, _f, range, p.collider);
    this.aimEntity = hit.hit && hit.entity && hit.entity !== b && hit.entity.alive ? hit.entity : null;
    return this._aim.copy(_v).addScaledVector(_f, hit.hit && hit.entity !== b ? hit.distance : range);
  }

  // A rider's chase camera: behind and above, looking where they aim, pulled in by walls.
  camera(p, cam, alpha, dt) {
    const b = p.vehicle;
    const S = b.S;
    _v.lerpVectors(b.prevPos, b.pos, alpha);
    _v.y += S.camPivot + b.lift();
    _f.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    // Back along the aim and up a little.
    _a.copy(_f).multiplyScalar(-S.camBack);
    _a.y += S.camUp;
    const len = _a.length();
    _a.divideScalar(len);
    const hit = this.game.surfaceNear(_v, _a, len + 0.3, _hit);
    const dist = hit ? Math.max(0.6, hit.point.distanceTo(_v) - 0.3) : len;
    cam.position.copy(_v).addScaledVector(_a, dist);
    // (How far ahead of the camera the rider is, along the aim: the reticle's ray starts past them.)
    p.camDist = Math.max(0, _v.sub(cam.position).dot(_f));
    // Look along the aim from there, tipped down a little so the bike sits in view; the reticle
    // is drawn as far above the middle (Hud), on the aim's line.
    cam.rotation.set(p.pitch - S.camTilt, p.yaw, 0);
  }

  updateVisuals(dt, alpha) {
    for (const set of this.meshes) {
      const T = set.T;
      let n = 0;
      let w = 0;
      for (const b of this.bikes) {
        if (b.type !== set.type || !b.alive) continue;
        b.matrix(alpha, _m);
        if (set.frame) set.frame.setMatrixAt(n++, _m);
        if (set.wheel) {
          const speed = Math.hypot(b.vel.x, b.vel.z);
          for (const wh of T.wheels) {
            if (wh.gait !== undefined) {
              // A leg swinging about its hip with the stride (still when standing).
              _e.set(Math.sin(b.stride * Math.PI * 2 + wh.gait) * 0.6 * Math.min(1, speed / 3), 0, 0);
            } else {
              _e.set(-b.spin, wh.steer ? b.steer : 0, 0);
            }
            _q.setFromEuler(_e);
            _m2.compose(_v.fromArray(wh.at), _q, _one);
            set.wheel.setMatrixAt(w++, _m2.premultiply(_m));
          }
        }
        // Smoke from the stacks while the engine runs (thicker on the throttle), embers on a boost.
        if (dt > 0 && b.rider && T.stacks.length) {
          b.smokeAcc = (b.smokeAcc ?? 0) + dt * (3 + Math.abs(b.throttle) * 6 + (b.boosting ? 10 : 0));
          while (b.smokeAcc >= 1) {
            b.smokeAcc -= 1;
            const s = T.stacks[(Math.random() * T.stacks.length) | 0];
            _v.copy(s).applyMatrix4(_m);
            if (b.boosting && Math.random() < 0.6) this.game.fx.fireEmber(_v.x, _v.y, _v.z);
            else this.game.fx.fireWisp(_v.x, _v.y, _v.z);
          }
        }
        this.engineSound(b);
      }
      for (const [m, c] of [[set.frame, n], [set.wheel, w]]) {
        if (!m) continue;
        m.count = c;
        m.visible = c > 0;
        m.instanceMatrix.needsUpdate = true;
      }
    }
    for (const b of this.bikes) if (!b.alive && b.engine) this.game.sfx.setEngine(b.engine, b.pos, null, 0, 0);
  }

  // The engine idles while someone's on, revving with speed and the throttle (a hog has none).
  engineSound(b) {
    if (!b.T.engine) return;
    const sfx = this.game.sfx;
    if (!b.engine) b.engine = sfx.engine?.() ?? null;
    if (!b.engine) return;
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const rev = clamp(speed / b.S.boostSpeed + Math.max(0, b.throttle) * 0.15 + (b.boosting ? 0.15 : 0), 0, 1.2);
    sfx.setEngine(b.engine, b.pos, b.rider, rev, b.rider && this.game.state === 'playing' ? 1 : 0, b.T.engine);
  }

  // Paused or over: every engine quiet (they come back with the next frame of play).
  silence() {
    for (const b of this.bikes) if (b.engine) this.game.sfx.setEngine(b.engine, b.pos, null, 0, 0);
  }

  // One of each drawn in front of the camera for the shader warm-up.
  warmup(on, at) {
    if (!on) {
      this.updateVisuals(0, 1);
      return;
    }
    _m.compose(at, _q.identity(), _one);
    for (const m of this.meshList) {
      m.setMatrixAt(0, _m);
      m.count = 1;
      m.visible = true;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const b of this.bikes) {
      if (b.engine) this.game.sfx.stopEngine(b.engine);
      b.dispose();
    }
    for (const m of this.meshList) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.material.dispose();
  }
}
