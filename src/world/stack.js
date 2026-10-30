import * as THREE from 'three';
import { StaticBuilder } from './staticBuilder.js';
import { Zones } from './zones.js';
import { bakeArena } from './bake.js';
import { crate, drum, pickupPads } from './parts.js';
import { MOVE } from '../config.js';
import { gfx } from '../render/gfx.js';

// Map 5: The Big Stack. A canyon floor with one giant brick smokestack in the middle and three
// round decks around it, one over another (5, 10 and 15 m), the highest holding the power gun.
// Four perches stand in the corners, two at the first deck's height and two at the second's,
// each joined to its deck by a bridge. Launch pads throw you up from the floor to the first deck
// and from the first deck to the top. Fall off and you're back on the floor with a long way up.
// The stack's base sits in an ash pit (slow, like mud). Coordinates: x east, z south, y up. The
// floor is x, z in [-28, 28].

const H = 28;
const WALL_H = 14;
const STACK_R = 3.5;
const STACK_TOP = 24;
// The decks: height (top surface) and radius.
const DECKS = [
  { y: 5, r: 9.5 },
  { y: 10, r: 7 },
  { y: 15, r: 5.5 },
];
// The perches: square blocks of this half size centered this far out on the diagonals; the
// northwest and southeast ones at the first deck's height, the others at the second's.
const PERCH = 3.5;
const PERCH_C = 19.5;
const PERCH_LOW = DECKS[0].y;
const PERCH_HIGH = DECKS[1].y;
const PIT = { half: 8, floor: -0.8, top: -0.25 };

// Launch pads: where each stands and where it throws you to (a point on the deck you land on).
// Flight times (s): long enough to clear the deck above the first one on the way up.
const PADS = [
  { at: [0, 0, -15], to: [0, DECKS[0].y, -8], time: 1.2, color: 'orange' },
  { at: [0, 0, 15], to: [0, DECKS[0].y, 8], time: 1.2, color: 'cyan' },
  { at: [-8.4, DECKS[0].y, 0], to: [-4.5, DECKS[2].y, 0], time: 1.6, color: 'orange' },
  { at: [8.4, DECKS[0].y, 0], to: [4.5, DECKS[2].y, 0], time: 1.6, color: 'cyan' },
];
const PAD_R = 1.1;

// The launch velocity that lands a throw from `at` on `to` after `time` seconds (gravity is
// heavier falling than rising: the average of the two is close enough over a whole arc).
function padVelocity(p) {
  const g = MOVE.gravity * (1 + MOVE.fallGravityMul) * 0.5;
  const T = p.time;
  return [(p.to[0] - p.at[0]) / T, (p.to[1] - p.at[1] + 0.5 * g * T * T) / T, (p.to[2] - p.at[2]) / T];
}

// Perches: [x sign, z sign, height].
const PERCHES = [
  [-1, -1, PERCH_LOW],
  [1, 1, PERCH_LOW],
  [1, -1, PERCH_HIGH],
  [-1, 1, PERCH_HIGH],
];
// The high perches are climbed by a rope on their inner face.
const ROPES = PERCHES.filter((p) => p[2] === PERCH_HIGH).map(([sx, sz]) => ({ x: sx * PERCH_C, z: sz * (PERCH_C - PERCH - 0.35) }));

const PICKUP_SPOTS = [
  { type: 'weapon', pad: 'power', pos: [0, DECKS[2].y, -4.4], respawn: 60 },
  { type: 'weapon', pad: 'field', pos: [PERCH_C, PERCH_HIGH, -PERCH_C - 1], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [-PERCH_C, PERCH_HIGH, PERCH_C + 1], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [0, DECKS[1].y, 5.3], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [-14, 0, 14], respawn: 30 },
  { type: 'grenades', count: 2, pos: [-14, 0, 0], respawn: 20 },
  { type: 'grenades', count: 2, pos: [14, 0, 0], respawn: 20 },
  { type: 'grenades', count: 2, pos: [-6, DECKS[0].y, -6], respawn: 20 },
  { type: 'grenades', count: 2, pos: [PERCH_C, PERCH_LOW, PERCH_C], respawn: 20 },
];

const DUMMY_POSTS = [
  { name: 'Canyon Dummy', post: [14, 0, 10], patrol: [0, 4], speed: 2.8, yaw: -Math.PI / 2 },
  { name: 'Deck Dummy', post: [6, DECKS[0].y, 6], yaw: Math.PI * 0.75 },
  { name: 'Perch Dummy', post: [-PERCH_C, PERCH_LOW, -PERCH_C], yaw: -Math.PI * 0.25 },
  { name: 'Ash Dummy', post: [0, PIT.floor, -6.5], patrol: [4, 0], speed: 1.6, yaw: 0 },
];

// The bots' moves the grid can't see: each launch pad, and the ropes up the high perches.
export const STACK_LINKS = [
  ...PADS.map((p) => ({ type: 'launch', a: p.at, b: p.to })),
  ...ROPES.map((r) => {
    const out = Math.sign(r.z) * 1.6;
    return { type: 'rope', a: [r.x, 0, r.z - out], b: [r.x, PERCH_HIGH, r.z + Math.sign(r.z) * 1.5], mid: [r.x, 0, r.z] };
  }),
];

export function buildStack({ scene, RAPIER, world, materials: M, bakeSize = 512, loose = false }) {
  const B = new StaticBuilder(RAPIER, world, { loose });
  const zones = new Zones();

  floor(B, M, zones);
  canyon(B, M);
  const vents = stack(B, M);
  decks(B, M);
  for (const p of PERCHES) perch(B, M, zones, ...p);
  for (const p of PADS) launchPad(B, M, zones, p);
  cover(B, M);
  pickupPads(B, M, PICKUP_SPOTS);

  const bake = bakeArena(B, { id: 'stack', half: H + 2, size: bakeSize, seed: 71 });
  const meshes = B.build(scene, gfx.vertexLight ? bake : null);
  if (gfx.bake) {
    bake.apply(M.ground);
    bake.apply(M.mud);
  }

  const spawnPoints = [
    [-10, 0, -22], [10, 0, 22], [22, 0, -8], [-22, 0, 8], [-21, 0, -6], [21, 0, 6],
    [8, 0, -22], [-8, 0, 22], [-13, 0, -13], [13, 0, 13],
    [-PERCH_C, PERCH_LOW, -PERCH_C + 1], [PERCH_C, PERCH_LOW, PERCH_C - 1],
  ].map(([x, y, z]) => ({ position: new THREE.Vector3(x, y, z), yaw: Math.atan2(x, z) }));

  const mudMap = M.mud.map;
  return {
    meshes,
    bake,
    zones,
    half: H,
    shadowHalf: H + 1,
    shadowTop: STACK_TOP,
    // (Cast from under the stack's top, so no nodes land up there where nobody can get.)
    nav: { halfX: H - 1, halfZ: H - 1, top: 19 },
    stands: [],
    screen: null,
    // The finale's podium on the top deck.
    podium: { x: 0, y: DECKS[2].y, z: 4.5 },
    spawnPoints,
    pickupSpots: PICKUP_SPOTS,
    dummyPosts: DUMMY_POSTS,
    halos: B.halos,
    surfaces: B.surfaces,
    blockers: B.blockers,
    trims: B.trims,
    loose: B.loose ?? [],
    update(dt, time, fx) {
      mudMap.offset.x = Math.sin(time * 0.05) * 0.2;
      mudMap.offset.y = time * 0.004;
      for (const v of vents) {
        v.acc += dt * v.wisps * fx.fxScale;
        for (; v.acc >= 1; v.acc--) fx.fireWisp(v.x + (Math.random() - 0.5) * v.spread, v.y, v.z + (Math.random() - 0.5) * v.spread);
      }
    },
  };
}

// The canyon floor with the ash pit round the stack's base (a hole in the floor, ash in it).
function floor(B, M, zones) {
  const g = { castShadow: false, floor: true };
  const P = PIT.half;
  B.boxMinMax(M.ground, [-H - 1, -1, -H - 1], [H + 1, 0, -P], g);
  B.boxMinMax(M.ground, [-H - 1, -1, P], [H + 1, 0, H + 1], g);
  B.boxMinMax(M.ground, [-H - 1, -1, -P], [-P, 0, P], g);
  B.boxMinMax(M.ground, [P, -1, -P], [H + 1, 0, P], g);
  B.boxMinMax(M.ground, [-P, -1.8, -P], [P, PIT.floor, P], g);
  B.boxMinMax(M.mud, [-P, PIT.floor, -P], [P, PIT.top, P], { collide: false, castShadow: false });
  zones.addMud([-P, PIT.floor - 0.2, -P], [P, PIT.top, P]);
  // A hazard curb round the pit's rim.
  for (const [a, b] of [[[-P - 0.3, 0, -P - 0.3], [P + 0.3, 0.12, -P]], [[-P - 0.3, 0, P], [P + 0.3, 0.12, P + 0.3]], [[-P - 0.3, 0, -P], [-P, 0.12, P]], [[P, 0, -P], [P + 0.3, 0.12, P]]]) {
    B.boxMinMax(M.hazard, a, b);
  }
  B.stain([-P, -P], [P, P], 2.5, 0.18);
  // The land outside, seen over the canyon's rim from the top deck.
  const O = H + 5.4;
  const land = { castShadow: false, collide: false };
  B.boxMinMax(M.ground, [-450, WALL_H - 0.6, -450], [450, WALL_H - 0.1, -O], land);
  B.boxMinMax(M.ground, [-450, WALL_H - 0.6, O], [450, WALL_H - 0.1, 450], land);
  B.boxMinMax(M.ground, [-450, WALL_H - 0.6, -O], [-O, WALL_H - 0.1, O], land);
  B.boxMinMax(M.ground, [O, WALL_H - 0.6, -O], [450, WALL_H - 0.1, O], land);
}

// The canyon walls: rock, stepped back as they rise, and invisible walls above so nobody leaves.
function canyon(B, M) {
  const T = 3;
  for (const [y0, y1, inset] of [[0, 6, 0], [6, 10, 1.2], [10, WALL_H, 2.4]]) {
    const o = H + inset;
    B.boxMinMax(M.rock, [-o - T, y0, -o - T], [o + T, y1, -o]);
    B.boxMinMax(M.rock, [-o - T, y0, o], [o + T, y1, o + T]);
    B.boxMinMax(M.rock, [-o - T, y0, -o], [-o, y1, o]);
    B.boxMinMax(M.rock, [o, y0, -o], [o + T, y1, o]);
  }
  B.collider([-H - T, WALL_H, -H - T], [H + T, 40, -H]);
  B.collider([-H - T, WALL_H, H], [H + T, 40, H + T]);
  B.collider([-H - T, WALL_H, -H], [-H, 40, H]);
  B.collider([H, WALL_H, -H], [H + T, 40, H]);
}

// The stack: a brick column from the pit floor up past the top deck, glowing firebox doors at
// its foot (north and south), iron bands, and a glowing rim at the top where the smoke comes out.
function stack(B, M) {
  B.cylinder(M.concrete, [0, PIT.floor, 0], STACK_R, STACK_TOP - PIT.floor, { segments: 24 });
  for (const y of [8, 13, 19]) {
    B.cylinder(M.metalDark, [0, y, 0], STACK_R + 0.06, 0.3, { segments: 24, collide: false });
  }
  // (The cap stands a little over the brick's top, and the embers over the cap's.)
  B.cylinder(M.metalDark, [0, STACK_TOP - 0.6, 0], STACK_R + 0.3, 0.7, { segments: 24 });
  // Soot inside the mouth, the embers deep in it.
  B.cylinder(M.metalDark, [0, STACK_TOP + 0.1, 0], STACK_R - 0.2, 0.03, { segments: 24, collide: false });
  B.cylinder(M.ember, [0, STACK_TOP + 0.13, 0], STACK_R - 1.6, 0.02, { segments: 18, collide: false, castShadow: false });
  for (const s of [-1, 1]) {
    const z = s * (STACK_R + 0.03);
    B.boxMinMax(M.metalDark, [-0.9, PIT.top, Math.min(z, z + s * 0.12)], [0.9, 2.2, Math.max(z, z + s * 0.12)], { collide: false });
    B.boxMinMax(M.ember, [-0.7, PIT.top + 0.2, Math.min(z + s * 0.12, z + s * 0.14)], [0.7, 1.9, Math.max(z + s * 0.12, z + s * 0.14)], { collide: false, castShadow: false, halo: [0, 0, s] });
    B.light([-0.7, 0, Math.min(z, z + s * 0.2)], [0.7, 1.9, Math.max(z, z + s * 0.2)], 0xff6a20, 3, 0.6);
  }
  return [{ x: 0, y: STACK_TOP + 0.4, z: 0, wisps: 6, spread: STACK_R * 1.4, acc: 0 }];
}

// The three decks: discs round the stack (it fills their middles), each on legs down to the one
// below, with a glow ring round the edge.
function decks(B, M) {
  const glows = [M.glowOrange, M.glowCyan, M.glowOrange];
  DECKS.forEach((d, i) => {
    B.cylinder(M.metal, [0, d.y - 0.3, 0], d.r, 0.3, { segments: 32 });
    B.cylinder(glows[i], [0, d.y - 0.24, 0], d.r + 0.03, 0.14, { segments: 32, collide: false, castShadow: false });
    // Legs at the edge, down to the deck below (or the floor), skipping where launch pads sit.
    const below = i === 0 ? PIT.top : DECKS[i - 1].y;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const r = d.r - 0.6;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      B.cylinder(M.metalDark, [x, below, z], 0.22, d.y - 0.3 - below, { segments: 8 });
    }
  });
  // A low rim on the top deck so the power gun's holder can duck behind it.
  const top = DECKS[2];
  for (let k = 0; k < 8; k++) {
    if (k === 2 || k === 6) continue;
    const a = (k / 8) * Math.PI * 2;
    const r = top.r - 0.25;
    B.box(M.metal, [Math.sin(a) * r, top.y + 0.45, Math.cos(a) * r], [1.9, 0.9, 0.3], { rotY: a });
  }
}

// A perch in a corner: a solid block with a glow strip round its top, a bridge to its deck along
// the diagonal, a ramp up from the floor (the low ones) or a rope (the high ones).
function perch(B, M, zones, sx, sz, top) {
  const cx = sx * PERCH_C;
  const cz = sz * PERCH_C;
  B.boxMinMax(M.concrete, [cx - PERCH, 0, cz - PERCH], [cx + PERCH, top, cz + PERCH]);
  const strip = { collide: false, castShadow: false };
  B.boxMinMax(M.hazard, [cx - PERCH - 0.02, top - 0.3, cz - PERCH - 0.02], [cx + PERCH + 0.02, top - 0.05, cz + PERCH + 0.02], strip);
  // The bridge: from the perch's inner corner to the deck at the same height, its top a hair
  // under both (so the overlaps hide inside them).
  const deck = DECKS.find((d) => d.y === top);
  const ax = cx - sx * PERCH;
  const az = cz - sz * PERCH;
  const bx = (sx * (deck.r - 0.8)) / Math.SQRT2;
  const bz = (sz * (deck.r - 0.8)) / Math.SQRT2;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  B.box(M.metal, [mx, top - 0.16, mz], [2.6, 0.3, len + 2], { rotY: yaw });
  B.box(M.glowCyan, [mx, top - 0.2, mz], [2.66, 0.1, len - 1], { rotY: yaw, collide: false, castShadow: false });
  // Railings along the open stretch.
  for (const side of [-1, 1]) {
    const ox = Math.cos(yaw) * side * 1.25;
    const oz = -Math.sin(yaw) * side * 1.25;
    B.box(M.metalDark, [mx + ox, top + 0.5, mz + oz], [0.1, 1.0, len - 2.6], { rotY: yaw });
  }
  if (top === PERCH_LOW) {
    // A ramp up beside the perch along the canyon wall, rising away from the middle to a
    // landing against the perch's outer side.
    const x = cx + sx * (PERCH + 1.5);
    const zNear = cz - sz * PERCH;
    B.ramp(M.metal, [x, 0, zNear - sz * 12], [x, top, zNear], 3);
    B.boxMinMax(M.metal, [x - 1.5, top - 0.3, cz - PERCH], [x + 1.5, top, cz + PERCH]);
  } else {
    // A rope on its inner face (toward the middle along z).
    const r = ROPES.find((q) => q.x === cx);
    B.rod(M.rope, [r.x, 0.5, r.z], [r.x, top - 0.2, r.z], 0.06, { segments: 6 });
    B.cylinder(M.rope, [r.x, 0.4, r.z], 0.11, 0.25, { collide: false, segments: 8 });
    // The beam it hangs from, out from the top of the face.
    const face = cz - sz * PERCH;
    const end = r.z - sz * 0.15;
    B.boxMinMax(M.metalDark, [r.x - 0.3, top - 0.3, Math.min(face, end)], [r.x + 0.3, top, Math.max(face, end)], { collide: false });
    zones.addRope({ x: r.x, z: r.z, y0: 0.5, y1: top - 0.2 });
  }
}

// A launch pad: a dark disc with a glowing ring, its throw a zone.
function launchPad(B, M, zones, p) {
  const [x, y, z] = p.at;
  B.cylinder(M.metalDark, [x, y, z], PAD_R + 0.2, 0.08, { segments: 16, collide: false });
  B.cylinder(p.color === 'cyan' ? M.glowCyan : M.glowOrange, [x, y + 0.08, z], PAD_R, 0.03, { segments: 16, collide: false, castShadow: false });
  B.light([x - PAD_R, y, z - PAD_R], [x + PAD_R, y + 0.2, z + PAD_R], p.color === 'cyan' ? 0x63f2ff : 0xff8a2a, 3, 0.3);
  zones.addLaunch([x - PAD_R, y - 0.5, z - PAD_R], [x + PAD_R, y + 1, z + PAD_R], padVelocity(p));
}

// Boulders, crates, drums and log piles on the floor; crates on the first deck.
function cover(B, M) {
  const rocks = [
    [-15, -6, 1.6, 0.3], [15, 6, 1.6, 0.3], [-6, 16, 1.4, 0.8], [6, -16, 1.4, 0.8],
    [-23.5, 11, 1.2, 0.2], [23.5, -11, 1.2, 0.2], [-12, 22, 1.0, 0.5], [12, -22, 1.0, 0.5],
  ];
  for (const [x, z, s, rot] of rocks) {
    B.box(M.rock, [x, s * 0.45, z], [s * 2, s * 0.9, s * 1.5], { rotY: rot });
    B.box(M.rock, [x + 0.3, s * 0.9 + s * 0.25, z - 0.2], [s * 1.2, s * 0.5, s], { rotY: rot + 0.5 });
  }
  for (const s of [-1, 1]) {
    crate(B, M, s * 11, 0, s * -11, 1.5, 0.3);
    crate(B, M, s * 12.4, 0, s * -10.2, 1.0, -0.2);
    crate(B, M, s * -11, 0, s * -11.5, 1.5, -0.4);
    drum(B, M, s * 22, s * 2);
    drum(B, M, s * 22.8, s * 2.7);
    // On the first deck, on either side of its launch pad.
    crate(B, M, s * 6.4, DECKS[0].y, s * 4.6, 1.0, 0.4);
    crate(B, M, s * -4.6, DECKS[0].y, s * 6.6, 1.0, -0.3);
  }
}
