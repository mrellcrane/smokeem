import * as THREE from 'three';
import { StaticBuilder } from './staticBuilder.js';
import { Zones } from './zones.js';
import { createFire } from './fire.js';
import { bakeArena } from './bake.js';
import { crate, barrier, drum, pickupPads, grandstands, STAND_TIERS, TIER_DEPTH } from './parts.js';
import { gfx } from '../render/gfx.js';

// Map 4: Cook-Off Yard. A barbecue competition's grounds inside tall walls, built for precision
// fights: two judging towers in opposite corners looking down the yard, a long smoker shed in
// the middle (tight inside, the power pad on its roof, open to both towers), loading docks along
// the end walls, food trucks and log piles for cover in the open, and two fire pits. The layout
// is the same turned half a turn about the middle (northwest tower, southeast tower).
// Coordinates: x east, z south, y up. The floor is x in [-32, 32], z in [-24, 24].

const HX = 32;
const HZ = 24;
const WALL_H = 7;
// The towers' decks, the shed's roof and the docks' tops.
const DECK = 6;
const ROOF = 3.5;
const DOCK = 1.6;
// The shed: half its length and depth, its walls' thickness and height.
const SHED_X = 11;
const SHED_Z = 3.5;
const SHED_T = 0.3;
const SHED_H = 3.2;

const PICKUP_SPOTS = [
  { type: 'weapon', pad: 'power', pos: [0, ROOF, 0], respawn: 60 },
  { type: 'weapon', pad: 'field', pos: [-28.5, DECK, -19.5], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [28.5, DECK, 19.5], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [-30, DOCK, 17], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [30, DOCK, -17], respawn: 30 },
  { type: 'grenades', count: 2, pos: [0, 0, 0], respawn: 20 },
  { type: 'grenades', count: 2, pos: [-15, 0, 15], respawn: 20 },
  { type: 'grenades', count: 2, pos: [15, 0, -15], respawn: 20 },
];

const DUMMY_POSTS = [
  { name: 'Yard Dummy', post: [-12, 0, -12], patrol: [4, 0], speed: 3, yaw: 0 },
  { name: 'Shed Dummy', post: [0, 0, 1.8], patrol: [3, 0], speed: 2, yaw: 0 },
  { name: 'Truck Dummy', post: [0, 0, 11.5], patrol: [4, 0], speed: 2.6, yaw: Math.PI },
  { name: 'Tower Dummy', post: [26.5, DECK, 16], yaw: Math.PI * 0.75 },
  { name: 'Dock Dummy', post: [29.5, DOCK, -13], yaw: -Math.PI / 2 },
];

// Both halves: `s` is 1 for the southeast half and -1 for the northwest, which is the same
// turned half a turn (x and z both flip). These turn a point, and a box given by two corners.
const P = (s, x, z) => [s * x, s * z];
function boxS(B, mat, s, min, max, opts) {
  const [x0, z0] = P(s, min[0], min[2]);
  const [x1, z1] = P(s, max[0], max[2]);
  B.boxMinMax(mat, [Math.min(x0, x1), min[1], Math.min(z0, z1)], [Math.max(x0, x1), max[1], Math.max(z0, z1)], opts);
}

export function buildYard({ scene, RAPIER, world, materials: M, textures, bakeSize = 512, loose = false, bevel = false, ao = false }) {
  const B = new StaticBuilder(RAPIER, world, { loose, bevel, ao });
  const zones = new Zones();

  // Ground, and the land outside seen over the walls from the towers.
  B.boxMinMax(M.ground, [-HX - 1, -1, -HZ - 1], [HX + 1, 0, HZ + 1], { castShadow: false, floor: true });
  B.boxMinMax(M.ground, [-450, -2.6, -450], [450, -2.0, 450], { castShadow: false, collide: false });

  perimeter(B, M);
  const stands = gfx.show ? grandstands(B, M, { hx: HX, hz: HZ, wallH: WALL_H, sides: [['z', -1], ['z', 1]], inset: 2 }) : [];
  if (gfx.show) screenFrame(B, M);
  for (const s of [-1, 1]) {
    tower(B, M, s);
    dock(B, M, s);
    truck(B, M, s);
    logPile(B, M, s);
  }
  shed(B, M);
  const pits = firePits(B, M, zones);
  cover(B, M);
  pickupPads(B, M, PICKUP_SPOTS);

  // Soot round the fire pits, grease under the trucks' serving windows.
  for (const s of [-1, 1]) {
    const [x, z] = P(s, 0, 13.2);
    B.stain([x - 2.5, z - 0.6], [x + 2.5, z + 0.6], 1.2, 0.08);
  }

  const bake = bakeArena(B, { id: 'yard', half: HX + 2, size: bakeSize, seed: 57 });
  const meshes = B.build(scene, gfx.vertexLight ? bake : null);
  if (gfx.bake) bake.apply(M.ground);

  const fire = createFire(textures, pits);
  scene.add(fire.mesh);

  const spawnPoints = [
    [-26, 0, 2], [26, 0, -2], [-19, 0, -21], [19, 0, 21], [-9, 0, -20], [9, 0, 20],
    [-24, 0, 22], [24, 0, -22], [-14, 0, 17], [14, 0, -17], [-7, 0, -9], [7, 0, 9],
    [-28, DECK, -17], [28, DECK, 17],
  ].map(([x, y, z]) => ({ position: new THREE.Vector3(x, y, z), yaw: Math.atan2(x, z) }));

  // Smoke out of the shed's smoker stacks and the trucks' chimneys (per second).
  const vents = [
    ...[-1, 1].map((s) => ({ x: s * 6.5, y: ROOF + 1.3, z: 0, wisps: 1.2, acc: Math.random() })),
    ...[-1, 1].map((s) => ({ x: s * 2.5, y: 3.75, z: s * 15, wisps: 0.6, acc: Math.random() })),
  ];

  return {
    meshes,
    bake,
    zones,
    half: HX,
    shadowHalf: HX + 1,
    shadowTop: 10,
    nav: { halfX: HX - 1, halfZ: HZ - 1, top: 12 },
    stands,
    screen: { w: 18, h: 9, faces: [{ pos: [0, 16.5, SCREEN_Z + 0.02], yaw: 0 }] },
    // The finale's podium on the shed's roof.
    podium: { x: 0, y: ROOF, z: 0 },
    spawnPoints,
    pickupSpots: PICKUP_SPOTS,
    dummyPosts: DUMMY_POSTS,
    halos: B.halos,
    surfaces: B.surfaces,
    blockers: B.blockers,
    trims: B.trims,
    loose: B.loose ?? [],
    update(dt, time, fx) {
      fire.update(time);
      for (const tr of pits) {
        tr.embers = (tr.embers ?? Math.random()) + dt * 3 * fx.fxScale;
        tr.wisps = (tr.wisps ?? Math.random()) + dt * fx.fxScale;
        for (; tr.embers >= 1; tr.embers--) fx.fireEmber(tr.x + (Math.random() - 0.5) * 0.7, tr.y + 0.3 + Math.random() * 0.6, tr.z0 + Math.random() * (tr.z1 - tr.z0));
        for (; tr.wisps >= 1; tr.wisps--) fx.fireWisp(tr.x + (Math.random() - 0.5) * 0.7, tr.y + tr.height * 0.8, tr.z0 + Math.random() * (tr.z1 - tr.z0));
      }
      for (const v of vents) {
        v.acc += dt * v.wisps * fx.fxScale;
        for (; v.acc >= 1; v.acc--) fx.fireWisp(v.x + (Math.random() - 0.5) * 0.3, v.y, v.z + (Math.random() - 0.5) * 0.3);
      }
    },
  };
}

// The walls, with a hazard band low and a glow strip high on their inside faces, and invisible
// walls above them so nobody jumps out from a tower.
function perimeter(B, M) {
  const T = 1;
  B.boxMinMax(M.metal, [-HX - T, 0, -HZ - T], [HX + T, WALL_H, -HZ]);
  B.boxMinMax(M.metal, [-HX - T, 0, HZ], [HX + T, WALL_H, HZ + T]);
  B.boxMinMax(M.metal, [-HX - T, 0, -HZ], [-HX, WALL_H, HZ]);
  B.boxMinMax(M.metal, [HX, 0, -HZ], [HX + T, WALL_H, HZ]);
  B.collider([-HX - T, WALL_H, -HZ - T], [HX + T, 40, -HZ]);
  B.collider([-HX - T, WALL_H, HZ], [HX + T, 40, HZ + T]);
  B.collider([-HX - T, WALL_H, -HZ], [-HX, 40, HZ]);
  B.collider([HX, WALL_H, -HZ], [HX + T, 40, HZ]);
  const deco = { collide: false };
  const glow = { collide: false, castShadow: false };
  const e = 0.04;
  // (The bands stop short of each other at the corners, so none overlap.)
  B.boxMinMax(M.hazard, [-HX + e, 0, -HZ], [HX - e, 0.6, -HZ + e], deco);
  B.boxMinMax(M.hazard, [-HX + e, 0, HZ - e], [HX - e, 0.6, HZ], deco);
  B.boxMinMax(M.hazard, [-HX, 0, -HZ], [-HX + e, 0.6, HZ], deco);
  B.boxMinMax(M.hazard, [HX - e, 0, -HZ], [HX, 0.6, HZ], deco);
  B.boxMinMax(M.glowOrange, [-HX + 2, WALL_H - 0.5, -HZ], [HX - 2, WALL_H - 0.35, -HZ + e], { ...glow, halo: [0, 0, 1] });
  B.boxMinMax(M.glowOrange, [-HX + 2, WALL_H - 0.5, HZ - e], [HX - 2, WALL_H - 0.35, HZ], { ...glow, halo: [0, 0, -1] });
}

const SCREEN_Z = -(HZ + 1 + STAND_TIERS * TIER_DEPTH) + 0.3;
function screenFrame(B, M) {
  const deco = { collide: false, castShadow: false };
  B.boxMinMax(M.metalDark, [-9.4, 11.6, SCREEN_Z - 0.6], [9.4, 21.4, SCREEN_Z], deco);
  for (const x of [-7, 7]) B.boxMinMax(M.metalDark, [x - 0.4, WALL_H - 4, SCREEN_Z - 0.5], [x + 0.4, 11.6, SCREEN_Z + 0.1], deco);
}

// A judging tower in the corner (southeast for s = 1): a deck at 6 m over a solid core, open
// underneath at the front, with a waist-high parapet along its two open edges and a ramp up
// along the end wall. The deck looks down the whole yard and onto the shed's roof.
function tower(B, M, s) {
  const x0 = 23.5;
  const z0 = 13.5;
  // The core (against both walls) and the legs at the open corner.
  boxS(B, M.concrete, s, [26.5, 0, 17], [HX, DECK - 0.3, HZ]);
  boxS(B, M.metalDark, s, [x0, 0, z0], [x0 + 0.5, DECK - 0.3, z0 + 0.5]);
  boxS(B, M.metalDark, s, [x0, 0, HZ - 0.5], [x0 + 0.5, DECK - 0.3, HZ]);
  boxS(B, M.metalDark, s, [HX - 3.5, 0, z0], [HX - 3, DECK - 0.3, z0 + 0.5]);
  // The deck.
  boxS(B, M.metal, s, [x0, DECK - 0.3, z0], [HX, DECK, HZ]);
  // A glow strip under its front edges.
  boxS(B, M.glowCyan, s, [x0, DECK - 0.28, z0 - 0.03], [HX - 3.5, DECK - 0.12, z0], { collide: false, castShadow: false, halo: [0, 0, -s] });
  boxS(B, M.glowCyan, s, [x0 - 0.03, DECK - 0.28, z0], [x0, DECK - 0.12, HZ], { collide: false, castShadow: false, halo: [-s, 0, 0] });
  // The parapet: along the front (a gap where the ramp arrives) and the side, with a gap in the
  // middle of the side to drop down through.
  const P1 = DECK + 1.05;
  boxS(B, M.metal, s, [x0, DECK, z0], [HX - 3.2, P1, z0 + 0.25]);
  boxS(B, M.metal, s, [x0, DECK, z0 + 0.25], [x0 + 0.25, P1, 17.5]);
  boxS(B, M.metal, s, [x0, DECK, 20], [x0 + 0.25, P1, HZ]);
  boxS(B, M.hazard, s, [x0 - 0.01, P1 - 0.12, z0 - 0.01], [HX - 3.19, P1 + 0.01, z0 + 0.26], { collide: false });
  // The judges' table and a scoreboard on the back wall.
  boxS(B, M.plank, s, [27, DECK, 21.5], [30.5, DECK + 0.85, 22.4]);
  boxS(B, M.metalDark, s, [26.5, DECK + 1.8, HZ - 0.3], [31, DECK + 3.2, HZ - 0.05], { collide: false });
  boxS(B, M.glowOrange, s, [26.8, DECK + 2.0, HZ - 0.32], [30.7, DECK + 3.0, HZ - 0.3], { collide: false, castShadow: false, halo: [0, 0, -s] });
  // The ramp up along the end wall, from the middle of the yard's side to the deck.
  const [rx, rz0] = P(s, HX - 1.5, 0);
  const [, rz1] = P(s, HX - 1.5, z0);
  B.ramp(M.metal, [rx, 0, rz0], [rx, DECK, rz1], 3);
  // Its outer rail.
  const rail = s > 0 ? [HX - 3.2, HX - 3] : [-HX + 3, -HX + 3.2];
  for (let i = 0; i < 4; i++) {
    const zA = (z0 * i) / 4;
    const zB = (z0 * (i + 1)) / 4;
    const y = (DECK * (i + 1)) / 4;
    B.boxMinMax(M.metalDark, [rail[0], 0, Math.min(s * zA, s * zB)], [rail[1], y + 1.0, Math.max(s * zA, s * zB)]);
  }
}

// A loading dock along the end wall (the west one for s = -1), with a ramp up to it from the
// yard, crates on it and a field pad at its far end.
function dock(B, M, s) {
  const x0 = 27;
  boxS(B, M.concrete, s, [x0, 0, -20], [HX, DOCK, -5]);
  boxS(B, M.hazard, s, [x0 - 0.01, DOCK - 0.25, -20], [x0, DOCK - 0.05, -5], { collide: false });
  const [ax, az] = P(s, 21.5, -12.5);
  const [bx, bz] = P(s, x0, -12.5);
  B.ramp(M.metal, [ax, 0, az], [bx, DOCK, bz], 3);
  const [cx, cz] = P(s, 30.2, -7);
  crate(B, M, cx, DOCK, cz, 1.5, 0.2);
  const [dx, dz] = P(s, 29.4, -9.2);
  crate(B, M, dx, DOCK, dz, 1.0, -0.3);
  // A rolled-up door behind it in the wall.
  boxS(B, M.metalDark, s, [HX - 0.06, 0, -18], [HX, 4.2, -10], { collide: false });
}

// A food truck in the open (north of the middle for s = -1), its serving window toward the shed.
function truck(B, M, s) {
  const zA = 13.8;
  const zB = 16.2;
  boxS(B, M.steel, s, [-3.5, 0.6, zA], [3.5, 3.1, zB]);
  boxS(B, M.paint, s, [-3.5 - 1.7, 0.6, zA + 0.1], [-3.5, 2.4, zB - 0.1]);
  // The cab's windshield.
  boxS(B, M.metalDark, s, [-5.22, 1.6, zA + 0.3], [-5.2, 2.2, zB - 0.3], { collide: false });
  // Wheels (and a skirt so nobody gets wedged under it).
  for (const x of [-4.4, -2.4, 2.4]) {
    boxS(B, M.metalDark, s, [x - 0.4, 0, zA - 0.02], [x + 0.4, 0.8, zA + 0.3]);
    boxS(B, M.metalDark, s, [x - 0.4, 0, zB - 0.3], [x + 0.4, 0.8, zB + 0.02]);
  }
  boxS(B, M.metalDark, s, [-5, 0, zA + 0.4], [3.4, 0.6, zB - 0.4]);
  // The serving window, glowing, and its awning.
  boxS(B, M.glowOrange, s, [-2, 1.4, zA - 0.03], [2, 2.3, zA], { collide: false, castShadow: false, halo: [0, 0, -s] });
  boxS(B, M.paint, s, [-2.3, 2.5, zA - 1.0], [2.3, 2.6, zA], { collide: false });
  boxS(B, M.plank, s, [-2.2, 1.2, zA - 0.4], [2.2, 1.3, zA]);
  // The chimney.
  const [cx, cz] = P(s, 2.5, 15);
  B.cylinder(M.metalDark, [cx, 3.1, cz], 0.18, 0.65, { segments: 8 });
}

// Logs stacked for the smokers: three on the ground, two on them.
function logPile(B, M, s) {
  const [x, z] = P(s, 15, -10);
  const r = 0.32;
  for (const [ox, y] of [[-0.66, r], [0, r], [0.66, r], [-0.33, r * 2.7], [0.33, r * 2.7]]) {
    B.rod(M.plank, [x + ox, y, z - 1.6], [x + ox, y, z + 1.6], r, { segments: 10 });
  }
  // (Rods have no collider: one box for the pile.)
  B.box(M.plank, [x, 0.6, z], [2.0, 1.2, 3.2], { visible: false });
}

// The smoker shed in the middle: long and narrow, open at both ends, one door in each long wall
// (north at the east end, south at the west end), windows to shoot through, two cabinet smokers
// inside, and a flat roof with the power pad, reached by a ramp along each long wall.
function shed(B, M) {
  const yWin0 = 1.2;
  const yWin1 = 2.2;
  // One long wall: z from zIn to zOut, a door and windows (x ranges).
  const wall = (zIn, zOut, door, windows) => {
    const z0 = Math.min(zIn, zOut);
    const z1 = Math.max(zIn, zOut);
    const cuts = (gaps) => {
      const out = [];
      let x = -SHED_X;
      for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
        if (a > x) out.push([x, a]);
        x = b;
      }
      if (x < SHED_X) out.push([x, SHED_X]);
      return out;
    };
    for (const [a, b] of cuts([door])) B.boxMinMax(M.plank, [a, 0, z0], [b, yWin0, z1]);
    for (const [a, b] of cuts([door, ...windows])) B.boxMinMax(M.plank, [a, yWin0, z0], [b, yWin1, z1]);
    B.boxMinMax(M.plank, [-SHED_X, yWin1, z0], [SHED_X, SHED_H, z1]);
  };
  wall(-SHED_Z + SHED_T, -SHED_Z, [4, 6], [[-8.5, -6.5], [-2, 0], [7.5, 9.5]]);
  wall(SHED_Z - SHED_T, SHED_Z, [-6, -4], [[6.5, 8.5], [0, 2], [-9.5, -7.5]]);
  // The roof (overhanging a little) and a glow strip along its long edges.
  B.boxMinMax(M.metal, [-SHED_X - 0.3, SHED_H, -SHED_Z - 0.3], [SHED_X + 0.3, ROOF, SHED_Z + 0.3]);
  for (const z of [-1, 1]) {
    const zz = z * (SHED_Z + 0.3);
    B.boxMinMax(M.glowOrange, [-SHED_X, SHED_H + 0.06, Math.min(zz, zz + z * 0.03)], [SHED_X, SHED_H + 0.2, Math.max(zz, zz + z * 0.03)], { collide: false, castShadow: false, halo: [0, 0, z] });
  }
  // Posts at the open ends (a little proud of the walls' ends all round).
  for (const x of [-SHED_X - 0.05, SHED_X - 0.35]) {
    for (const z of [-SHED_Z - 0.05, SHED_Z - 0.35]) B.boxMinMax(M.metalDark, [x, 0, z], [x + 0.4, SHED_H, z + 0.4]);
  }
  // Two cabinet smokers, their stacks up through the roof, glowing doors toward the ends.
  for (const s of [-1, 1]) {
    const x = s * 6.5;
    B.box(M.metalDark, [x, 0.75, 0], [1.4, 1.5, 1.2]);
    B.box(M.ember, [x + s * 0.71, 0.55, 0], [0.02, 0.5, 0.7], { collide: false, castShadow: false, halo: [s, 0, 0] });
    B.cylinder(M.metalDark, [x, 1.5, 0], 0.16, ROOF + 1.2 - 1.5, { segments: 8 });
    B.light([x - 0.7, 0.2, -0.6], [x + 0.7, 1.2, 0.6], 0xff7030, 2.2, 0.45);
  }
  // A long prep table along the middle, between the smokers.
  B.box(M.plank, [0, 0.45, -1.4], [5, 0.9, 0.8]);
  // The ramps to the roof: along the north wall rising west, along the south wall rising east.
  B.ramp(M.metal, [1.5, 0, -5.25], [-10.5, ROOF, -5.25], 2.4);
  B.ramp(M.metal, [-1.5, 0, 5.25], [10.5, ROOF, 5.25], 2.4);
  // Landings at their tops, joined to the roof's edge.
  B.boxMinMax(M.metal, [-SHED_X - 0.3, ROOF - 0.3, -6.45], [-10.5, ROOF, -SHED_Z - 0.3]);
  B.boxMinMax(M.metal, [10.5, ROOF - 0.3, SHED_Z + 0.3], [SHED_X + 0.3, ROOF, 6.45]);
}

// A fire pit on each side of the shed: a grate of coals between low steel curbs.
function firePits(B, M, zones) {
  const pits = [];
  for (const s of [-1, 1]) {
    const x = s * 17;
    const z0 = -2.2;
    const z1 = 2.2;
    B.boxMinMax(M.metalDark, [x - 0.65, 0, z0], [x + 0.65, 0.35, z1]);
    B.boxMinMax(M.ember, [x - 0.45, 0.35, z0 + 0.2], [x + 0.45, 0.37, z1 - 0.2], { collide: false, castShadow: false });
    B.boxMinMax(M.hazard, [x - 0.67, 0, z0 - 0.02], [x + 0.67, 0.3, z0], { collide: false });
    B.boxMinMax(M.hazard, [x - 0.67, 0, z1], [x + 0.67, 0.3, z1 + 0.02], { collide: false });
    zones.addFire([x - 0.65, 0, z0], [x + 0.65, 1.8, z1]);
    B.light([x - 0.45, 0.4, z0 + 0.2], [x + 0.45, 1.2, z1 - 0.2], 0xff6a20, 2.5, 0.5);
    B.stain([x - 0.65, z0], [x + 0.65, z1], 1.2, 0.15);
    pits.push({ x, z0: z0 + 0.3, z1: z1 - 0.3, y: 0.3, height: 1.4 });
  }
  return pits;
}

// Crates, barriers and drums: cover on the way between the towers, the docks and the shed.
function cover(B, M) {
  for (const s of [-1, 1]) {
    const at = (x, z) => P(s, x, z);
    const c = (x, z, size, rot, y = 0) => {
      const [px, pz] = at(x, z);
      crate(B, M, px, y, pz, size, rot);
    };
    // Out in front of the shed's ends.
    const [b1x, b1z] = at(14.5, 6.5);
    barrier(B, M, b1x, b1z, 0.5);
    const [b2x, b2z] = at(21, 3.5);
    barrier(B, M, b2x, b2z, Math.PI / 2 + 0.2);
    // Below the tower, a stack to climb toward it.
    c(18, 11, 1.5, 0.2);
    c(18.8, 11.4, 1.0, -0.3, 1.5);
    c(16.5, 12.2, 1.0, 0.4);
    // The open yard by the trucks.
    c(8, 10, 1.5, 0.35);
    c(-9, 19.5, 1.5, -0.2);
    c(-11, 21, 1.0, 0.1);
    const [d1x, d1z] = at(6.5, 13.3);
    drum(B, M, d1x, d1z);
    const [d2x, d2z] = at(7.3, 12.6);
    drum(B, M, d2x, d2z);
    // Between the dock's ramp and the middle.
    const [b3x, b3z] = at(20, -17);
    barrier(B, M, b3x, b3z, -0.3);
    c(10, -20, 1.5, 0.2);
  }
}
