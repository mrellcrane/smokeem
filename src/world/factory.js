import * as THREE from 'three';
import { StaticBuilder } from './staticBuilder.js';
import { Zones } from './zones.js';
import { createFire } from './fire.js';
import { bakeArena } from './bake.js';
import { crate, barrier, drum, pickupPads, grandstands } from './parts.js';
import { gfx } from '../render/gfx.js';
import { dressFactory } from './dressing.js';
import { createShafts } from './shafts.js';
import { FACTORY_LOOK } from './looks.js';

// Map 2: Smokestack Works. An indoor smokehouse factory turned into a game-show arena: a long
// hall under a trussed roof with skylights, a giant smoker in the middle (the power pad on its
// deck, bridges to it from catwalks along both long walls), conveyor belts carrying you along,
// pallet racks in the west, a grease vat with a hook rail across it in the east, and the crowd
// in stands above the long walls. Coordinates: x east, z south, y up. The floor is x in
// [-30, 30], z in [-22, 22]. See GAME_DESIGN.md for the layout overview.

const HX = 30;
const HZ = 22;
// The long walls (the stands rise behind them), the trusses' bottom and the roof.
const WALL_H = 7;
const TRUSS = 14;
const ROOF = 16;
// Catwalks, bridges and the smoker's deck.
const DECK = 5;
// The catwalks' inner edge, and the bridges' half width (room for the bots' nav grid, whose
// columns run at odd x: a node at x = 1 needs the railing past 1.36).
const WALK = 18.5;
const BRIDGE = 1.6;
const VAT = { x0: 16, x1: 26, z0: -4.5, z1: 4.5, floor: -0.8, top: -0.25 };
const DOCK = 2.4;
// The roof's open skylight bands (z ranges), the full length of the hall.
const SKYLIGHTS = [[-15, -11], [-2.5, 2.5], [11, 15]];
const BELT_SPEED = 2;
// The stands reach this far out from the middle (grandstands: 5 tiers of 1.6 m past the wall).
const OUTER = HZ + 1 + 5 * 1.6 + 1;

const PICKUP_SPOTS = [
  { type: 'weapon', pad: 'power', pos: [2.0, DECK, 2.0], respawn: 60 },
  { type: 'weapon', pad: 'field', pos: [-21.5, 0, -2.75], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [20, 0, 16], respawn: 30 },
  { type: 'grenades', count: 2, pos: [14, DECK, -20.3], respawn: 20 },
  { type: 'grenades', count: 2, pos: [-14, DECK, 20.3], respawn: 20 },
  { type: 'grenades', count: 2, pos: [14, DOCK, 1.2], respawn: 20 },
  { type: 'grenades', count: 2, pos: [-6, 0, 15], respawn: 20 },
];

const DUMMY_POSTS = [
  { name: 'Training Dummy', post: [-4, 0, -15], patrol: [5, 0], speed: 3.2, yaw: 0 },
  { name: 'Aisle Dummy', post: [-21.5, 0, 2.75], patrol: [4, 0], speed: 2.6, yaw: -Math.PI / 2 },
  { name: 'Smoker Dummy', post: [-2, DECK, -1.5], yaw: Math.PI },
  { name: 'Catwalk Dummy', post: [-8, DECK, -20.3], yaw: 0 },
  { name: 'Grease Dummy', post: [21, VAT.floor, 0], patrol: [0, 3.5], speed: 1.6, yaw: Math.PI / 2 },
  { name: 'Dock Dummy', post: [14, DOCK, -1], yaw: -Math.PI / 2 },
];

export function buildFactory({ scene, RAPIER, world, materials: M, textures, bakeSize = 512, preset = null }) {
  const B = new StaticBuilder(RAPIER, world);
  const zones = new Zones();

  // Floor slab, with a hole for the grease vat.
  const g = { castShadow: false, floor: true };
  B.boxMinMax(M.slab, [-HX - 1, -1, -HZ - 1], [VAT.x0, 0, HZ + 1], g);
  B.boxMinMax(M.slab, [VAT.x1, -1, -HZ - 1], [HX + 1, 0, HZ + 1], g);
  B.boxMinMax(M.slab, [VAT.x0, -1, -HZ - 1], [VAT.x1, 0, VAT.z0], g);
  B.boxMinMax(M.slab, [VAT.x0, -1, VAT.z1], [VAT.x1, 0, HZ + 1], g);
  B.boxMinMax(M.metalDark, [VAT.x0, -1.8, VAT.z0], [VAT.x1, VAT.floor, VAT.z1], g);

  shell(B, M);
  const stands = gfx.show ? grandstands(B, M, { hx: HX, hz: HZ, wallH: WALL_H, sides: [['z', -1], ['z', 1]], inset: 1 }) : [];
  roof(B, M);
  for (const s of [-1, 1]) catwalk(B, M, zones, s);
  const fires = smoker(B, M, zones);
  for (const s of [-1, 1]) bridge(B, M, s);
  const hoods = [];
  for (const s of [-1, 1]) belts(B, M, zones, s, hoods);
  racks(B, M);
  greaseVat(B, M, zones);
  cover(B, M);
  lamps(B, M);
  dressFactory(B, M, { HX, HZ, truss: TRUSS, crate });
  if (gfx.show) jumbotron(B, M);
  pickupPads(B, M, PICKUP_SPOTS);

  // Grease and oil on the floor: around the vat and under the belts.
  B.stain([VAT.x0, VAT.z0], [VAT.x1, VAT.z1], 1.8, 0.16);
  for (const s of [-1, 1]) B.stain([-21, s * 10 - 1.1], [21, s * 10 + 1.1], 1.2, 0.08);

  const bake = bakeArena(B, { id: 'factory', half: OUTER, size: bakeSize, seed: 23 });
  const meshes = B.build(scene, gfx.vertexLight ? bake : null);
  if (gfx.bake) {
    bake.apply(M.slab);
    bake.apply(M.grease);
  }

  const fire = createFire(textures, fires);
  scene.add(fire.mesh);

  // Sunbeams down through the skylight bands, one per truss bay.
  let shafts = null;
  if (gfx.shafts && preset?.shafts !== false) {
    const openings = [];
    for (let x = -30; x < 30; x += 6) {
      for (const [z0, z1] of SKYLIGHTS) openings.push({ x0: x + (x > -30 ? 0.15 : 0), x1: x + 6 - (x + 6 < 30 ? 0.15 : 0), z0, z1 });
    }
    shafts = createShafts({ openings, top: ROOF - 0.4, sunDir: FACTORY_LOOK.sun.dir });
    scene.add(shafts.group);
  }

  const spawnPoints = [
    [-25, 0, -15], [-11, 0, -16], [10, 0, -16], [25, 0, -15], [25, 0, 15], [11, 0, 16],
    [-10, 0, 16], [-25, 0, 15], [-12, 0, -3], [9, 0, 5], [-10, DECK, -20.3], [10, DECK, 20.3],
  ].map(([x, y, z]) => ({ position: new THREE.Vector3(x, y, z), yaw: Math.atan2(x, z) }));

  const greaseMap = M.grease.map;
  const beltMap = M.belt.map;
  // Smoke out of the smoker's stacks and the belt hoods, embers off the grates (per second).
  const vents = [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: sx * 3.5, y: DECK + 1.3, z: sz * 2.6, wisps: 0.7, acc: Math.random() }))),
    ...hoods.map((h) => ({ x: h.x, y: h.y, z: h.z, wisps: 0.5, acc: Math.random() })),
  ];
  const grates = fires.map(() => ({ embers: Math.random() }));

  return {
    meshes,
    bake,
    zones,
    half: HX,
    shadowHalf: OUTER,
    shadowTop: ROOF + 0.3,
    stands,
    // The big screen: a four-sided jumbotron hanging over the smoker.
    screen: {
      w: 6,
      h: 3,
      faces: [
        { pos: [0, 12.1, 3.13], yaw: 0 },
        { pos: [3.13, 12.1, 0], yaw: Math.PI / 2 },
        { pos: [0, 12.1, -3.13], yaw: Math.PI },
        { pos: [-3.13, 12.1, 0], yaw: -Math.PI / 2 },
      ],
    },
    podium: { x: 0, y: DECK, z: 0 },
    spawnPoints,
    pickupSpots: PICKUP_SPOTS,
    dummyPosts: DUMMY_POSTS,
    halos: B.halos,
    surfaces: B.surfaces,
    blockers: B.blockers,
    trims: B.trims,
    update(dt, time, fx) {
      fire.update(time);
      shafts?.update(time);
      greaseMap.offset.x = Math.sin(time * 0.04) * 0.15;
      greaseMap.offset.y = time * 0.002;
      // The belts run east on the north line and west on the south line (one texture: the
      // south line's boxes are turned around, so the same scroll runs the other way there).
      beltMap.offset.x = (time * BELT_SPEED) % 1;
      for (const v of vents) {
        v.acc += dt * v.wisps * fx.fxScale;
        for (; v.acc >= 1; v.acc--) fx.fireWisp(v.x + (Math.random() - 0.5) * 0.3, v.y, v.z + (Math.random() - 0.5) * 0.3);
      }
      for (let i = 0; i < fires.length; i++) {
        const tr = fires[i];
        const acc = grates[i];
        acc.embers += dt * 3 * fx.fxScale;
        for (; acc.embers >= 1; acc.embers--) {
          fx.fireEmber(tr.x + (Math.random() - 0.5) * 0.7, tr.y + 0.3 + Math.random() * 0.6, tr.z0 + Math.random() * (tr.z1 - tr.z0));
        }
      }
    },
  };
}

// A box given in the north half's coordinates, turned half a turn about the middle for the
// south half (s = 1): the layout is the same either way round.
function half(B, mat, min, max, opts, s) {
  if (s < 0) {
    B.boxMinMax(mat, min, max, opts);
    return;
  }
  B.boxMinMax(mat, [-max[0], min[1], -max[2]], [-min[0], max[1], -min[2]], opts);
}
const flip = (p, s) => (s < 0 ? p : [-p[0], p[1], -p[2]]);

// Walls, the stands' back wall, columns, windows, pipes and the invisible blockers.
function shell(B, M) {
  const T = 1;
  // Long walls (the stands are behind them) and the end walls, which go up to the roof.
  B.boxMinMax(M.metal, [-HX - T, 0, -HZ - T], [HX + T, WALL_H, -HZ]);
  B.boxMinMax(M.metal, [-HX - T, 0, HZ], [HX + T, WALL_H, HZ + T]);
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -HX - T : HX;
    B.boxMinMax(M.concrete, [x0, 0, -OUTER], [x0 + T, WALL_H, OUTER]);
    B.boxMinMax(M.metal, [x0, WALL_H, -OUTER], [x0 + T, ROOF, OUTER], { collide: false });
  }
  // Behind the stands, up to the roof (looks only: nobody gets there).
  for (const sz of [-1, 1]) {
    const z0 = sz < 0 ? -OUTER - T : OUTER;
    B.boxMinMax(M.concrete, [-HX, WALL_H - 4, z0], [HX, ROOF, z0 + T], { collide: false, castShadow: false });
  }
  // Nobody double-jumps over a wall or into the roof.
  B.collider([-HX - T, WALL_H, -HZ - T], [HX + T, 40, -HZ]);
  B.collider([-HX - T, WALL_H, HZ], [HX + T, 40, HZ + T]);
  B.collider([-HX - T, WALL_H, -HZ], [-HX, 40, HZ]);
  B.collider([HX, WALL_H, -HZ], [HX + T, 40, HZ]);
  B.collider([-HX - T, ROOF + 0.2, -HZ - T], [HX + T, ROOF + 1.2, HZ + T]);

  const deco = { collide: false };
  const glow = { collide: false, castShadow: false };
  const e = 0.04;
  // Hazard band along the bottom of every wall, and a cyan strip along the long walls' tops.
  B.boxMinMax(M.hazard, [-HX, 0, -HZ], [HX, 0.6, -HZ + e], deco);
  B.boxMinMax(M.hazard, [-HX, 0, HZ - e], [HX, 0.6, HZ], deco);
  B.boxMinMax(M.hazard, [-HX, 0, -HZ], [-HX + e, 0.6, HZ], deco);
  B.boxMinMax(M.hazard, [HX - e, 0, -HZ], [HX, 0.6, HZ], deco);
  B.boxMinMax(M.glowCyan, [-HX, 6.4, -HZ], [HX, 6.52, -HZ + e], { ...glow, halo: [0, 0, 1] });
  B.boxMinMax(M.glowCyan, [-HX, 6.4, HZ - e], [HX, 6.52, HZ], { ...glow, halo: [0, 0, -1] });

  // Steel columns under every truss along the long walls, up past the stands' front.
  for (let x = -24; x <= 24; x += 6) {
    for (const sz of [-1, 1]) {
      const z0 = sz < 0 ? -HZ - 0.4 : HZ - 0.3;
      B.boxMinMax(M.metalDark, [x - 0.35, 0, z0], [x + 0.35, TRUSS, z0 + 0.7]);
    }
  }

  // High windows in the end walls: pale daylight panes between mullions.
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? -HX + e : HX - e;
    for (const [z0, z1] of [[-19, -11], [-5, 5], [11, 19]]) {
      B.boxMinMax(M.window, [Math.min(x, x - sx * e), 9, z0], [Math.max(x, x - sx * e), 13, z1], { ...glow, bakeLight: false });
      for (let z = z0; z <= z1 + 1e-3; z += 2) {
        B.boxMinMax(M.metalDark, [Math.min(x, x - sx * 0.12), 8.9, z - 0.08], [Math.max(x, x - sx * 0.12), 13.1, z + 0.08], deco);
      }
      for (const y of [8.85, 11, 13]) {
        B.boxMinMax(M.metalDark, [Math.min(x, x - sx * 0.12), y, z0 - 0.08], [Math.max(x, x - sx * 0.12), y + 0.15, z1 + 0.08], deco);
      }
    }
    // Pipes along the end walls under the windows, and drops down to the floor.
    const px = sx * (HX - 0.4);
    for (const [y, r] of [[7.7, 0.24], [8.3, 0.16]]) B.rod(M.steel, [px, y, -HZ], [px, y, HZ], r, { segments: 10 });
    for (const z of [-14, 8]) {
      B.rod(M.steel, [px, 0, z], [px, 7.7, z], 0.24, { segments: 10 });
      B.cylinder(M.metalDark, [px, 0, z], 0.36, 0.5, { segments: 10, collide: false });
    }
  }
}

// Trusses every 6 m across the hall (bottom chord, top chord, posts and braces), roof panels
// with three open skylight bands along the hall.
function roof(B, M) {
  const deco = { collide: false };
  const top = ROOF - 0.35;
  for (let x = -24; x <= 24; x += 6) {
    B.boxMinMax(M.metalDark, [x - 0.15, TRUSS, -OUTER], [x + 0.15, TRUSS + 0.3, OUTER], deco);
    B.boxMinMax(M.metalDark, [x - 0.15, top - 0.3, -OUTER], [x + 0.15, top, OUTER], deco);
    for (let z = -OUTER + 4; z < OUTER; z += 4) {
      B.rod(M.metalDark, [x, TRUSS + 0.3, z], [x, top - 0.3, z], 0.07, { segments: 6 });
      B.rod(M.metalDark, [x, TRUSS + 0.3, z - 4], [x, top - 0.3, z], 0.06, { segments: 6 });
    }
  }
  // Purlins along the hall, and the panels.
  for (const z of [-OUTER + 1, -24, -17, -9, 0, 9, 17, 24, OUTER - 1]) {
    B.boxMinMax(M.metalDark, [-HX, top, z - 0.1], [HX, top + 0.25, z + 0.1], deco);
  }
  // (The gaps between these are the skylights, SKYLIGHTS.)
  for (const [z0, z1] of [[-OUTER - 1, -15], [-11, -2.5], [2.5, 11], [15, OUTER + 1]]) {
    B.boxMinMax(M.metal, [-HX - 1, ROOF - 0.1, z0], [HX + 1, ROOF + 0.1, z1], deco);
  }
}

// A catwalk along a long wall at deck height: stairs at one end, a ladder at the other, a
// railing with gaps for the bridge and the ladder, and an orange strip along its front.
// s = -1 north (stairs west, ladder east), 1 south (turned half a turn).
function catwalk(B, M, zones, s) {
  const front = -WALK;
  const stairEnd = -20.5;
  half(B, M.metal, [stairEnd, DECK - 0.3, -HZ], [HX, DECK, front], {}, s);
  // Posts under the front edge.
  for (const x of [-18, -12, -6, 6, 12, 18, 24]) {
    half(B, M.metalDark, [x - 0.18, 0, front - 0.5], [x + 0.18, DECK - 0.3, front - 0.14], {}, s);
  }
  // Railing: gaps at the bridge and the ladder.
  for (const [a, b] of [[stairEnd, -BRIDGE], [BRIDGE, 26.9], [29.1, HX]]) {
    half(B, M.metal, [a, DECK, front - 0.12], [b, DECK + 1.0, front], {}, s);
  }
  half(B, M.glowOrange, [stairEnd, DECK - 0.25, front], [HX, DECK - 0.1, front + 0.03], { collide: false, castShadow: false, halo: s < 0 ? [0, 0, 1] : [0, 0, -1] }, s);
  // Stairs up from the west end, along the wall: 17 steps.
  const n = 17;
  for (let i = 0; i < n; i++) {
    const x0 = -29 + 0.5 * i;
    half(B, M.metalDark, [x0, 0, -HZ], [x0 + 0.5, (DECK * (i + 1)) / n, -19.6], {}, s);
  }
  half(B, M.hazard, [-29, 0, -19.62], [stairEnd, 0.3, -19.58], { collide: false }, s);
  // Ladder at the east end, hanging just in front of the catwalk.
  const [lx, , lz] = flip([28, 0, front + 0.4], s);
  zones.addRope({ x: lx, z: lz, y0: 0.5, y1: DECK + 1.85 });
  const side = flip([0.32, 0, 0], s)[0];
  for (const d of [-side, side]) B.rod(M.steel, [lx + d, 0, lz], [lx + d, DECK + 1.6, lz], 0.04, { segments: 6 });
  for (let y = 0.3; y < DECK + 1.4; y += 0.32) B.rod(M.steel, [lx - side, y, lz], [lx + side, y, lz], 0.025, { segments: 5 });
}

// The giant smoker in the middle: a black steel body with glowing firebox doors east and west
// (burning grates in front of them), a deck at catwalk height with smoke stacks at the corners
// and railings, open north and south where the bridges arrive. Returns the grates for the fire.
function smoker(B, M, zones) {
  B.boxMinMax(M.metalDark, [-4, 0, -3], [4, DECK - 0.4, 3]);
  B.boxMinMax(M.metal, [-4.3, DECK - 0.4, -3.3], [4.3, DECK, 3.3]);
  B.boxMinMax(M.hazard, [-4.32, DECK - 0.35, -3.32], [4.32, DECK - 0.1, 3.32], { collide: false });
  // Ribs down the long sides.
  for (const x of [-3, -1, 1, 3]) {
    for (const sz of [-1, 1]) B.boxMinMax(M.steel, [x - 0.1, 0, sz < 0 ? -3.08 : 3], [x + 0.1, DECK - 0.4, sz < 0 ? -3 : 3.08], { collide: false });
  }
  // Railings: full east and west, corners only north and south.
  const rail = DECK + 0.9;
  B.boxMinMax(M.metal, [4.0, DECK, -3.3], [4.3, rail, 3.3]);
  B.boxMinMax(M.metal, [-4.3, DECK, -3.3], [-4.0, rail, 3.3]);
  for (const sz of [-1, 1]) {
    const z0 = sz < 0 ? -3.3 : 3.0;
    B.boxMinMax(M.metal, [-4.0, DECK, z0], [-BRIDGE, rail, z0 + 0.3]);
    B.boxMinMax(M.metal, [BRIDGE, DECK, z0], [4.0, rail, z0 + 0.3]);
  }
  // Smoke stacks at the corners of the deck.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B.boxMinMax(M.metalDark, [sx * 3.5 - 0.35, DECK, sz * 2.6 - 0.35], [sx * 3.5 + 0.35, DECK + 1.2, sz * 2.6 + 0.35]);
      B.boxMinMax(M.ember, [sx * 3.5 - 0.25, DECK + 1.2, sz * 2.6 - 0.25], [sx * 3.5 + 0.25, DECK + 1.22, sz * 2.6 + 0.25], { collide: false, castShadow: false });
    }
  }
  // Firebox doors and the grates in front of them.
  const grates = [];
  for (const sx of [-1, 1]) {
    const f = sx * 4;
    B.boxMinMax(M.steel, [Math.min(f, f + sx * 0.08), 0.4, -1.6], [Math.max(f, f + sx * 0.08), 2.3, 1.6], { collide: false });
    B.boxMinMax(M.ember, [Math.min(f + sx * 0.08, f + sx * 0.1), 0.6, -1.4], [Math.max(f + sx * 0.08, f + sx * 0.1), 2.1, 1.4], { collide: false, castShadow: false, halo: [sx, 0, 0], bakeLight: false });
    // Grill bars over the glow.
    for (let z = -1.2; z <= 1.21; z += 0.4) B.rod(M.metalDark, [f + sx * 0.14, 0.6, z], [f + sx * 0.14, 2.1, z], 0.04, { segments: 5 });
    const x = sx * 5;
    B.boxMinMax(M.metalDark, [x - 0.6, 0, -2], [x + 0.6, 0.35, 2]);
    B.boxMinMax(M.ember, [x - 0.4, 0.35, -1.8], [x + 0.4, 0.37, 1.8], { collide: false, castShadow: false });
    for (const z of [-2.02, 2]) B.boxMinMax(M.hazard, [x - 0.62, 0, z], [x + 0.62, 0.3, z + 0.02], { collide: false });
    zones.addFire([x - 0.6, 0, -2], [x + 0.6, 1.8, 2]);
    B.light([x - 0.4, 0.4, -1.8], [x + 0.4, 1.2, 1.8], 0xff6a20, 2.5, 0.5);
    B.light([f, 0.6, -1.4], [f + sx * 0.1, 2.1, 1.4], 0xff5a18, 2, 0.4);
    B.stain([x - 0.6, -2], [x + 0.6, 2], 1.2, 0.15);
    grates.push({ x, z0: -1.7, z1: 1.7, y: 0.3, height: 1.5 });
  }
  return grates;
}

// A bridge from a catwalk to the smoker's deck, with railings and a pillar halfway.
function bridge(B, M, s) {
  const b = BRIDGE;
  half(B, M.metal, [-b, DECK - 0.3, -WALK], [b, DECK, -3.3], {}, s);
  for (const x of [-b, b - 0.12]) half(B, M.metal, [x, DECK, -WALK], [x + 0.12, DECK + 1.0, -3.3], {}, s);
  half(B, M.metalDark, [-0.35, 0, -11.35], [0.35, DECK - 0.3, -10.65], {}, s);
  half(B, M.glowOrange, [-b, DECK - 0.25, -WALK + 0.2], [-b + 0.03, DECK - 0.1, -3.5], { collide: false, castShadow: false, bakeLight: false }, s);
  half(B, M.glowOrange, [b - 0.03, DECK - 0.25, -WALK + 0.2], [b, DECK - 0.1, -3.5], { collide: false, castShadow: false, bakeLight: false }, s);
}

// Conveyor belts across the hall, west and east of the middle, at z = 10 s; the north line runs
// east, the south line west. Each has a smoke hood over its outer end. hoods: gets where the
// hoods' smoke comes out.
function belts(B, M, zones, s, hoods) {
  const z = s * 10;
  const vx = -s * BELT_SPEED;
  for (const [x0, x1] of [[-21, -8], [8, 21]]) {
    B.boxMinMax(M.metalDark, [x0, 0, z - 1.1], [x1, 0.82, z + 1.1]);
    // (Turned half a turn on the south line, so its texture runs the other way.)
    B.box(M.belt, [(x0 + x1) / 2, 0.885, z], [x1 - x0, 0.13, 1.9], { rotY: s > 0 ? Math.PI : 0 });
    B.boxMinMax(M.hazard, [x0, 0.6, z - 1.12], [x1, 0.82, z - 1.1], { collide: false });
    B.boxMinMax(M.hazard, [x0, 0.6, z + 1.1], [x1, 0.82, z + 1.12], { collide: false });
    for (const x of [x0 + 0.1, x1 - 0.1]) B.rod(M.steel, [x, 0.82, z - 1.0], [x, 0.82, z + 1.0], 0.14, { segments: 10 });
    zones.addBelt([x0, 0.85, z - 1.0], [x1, 1.4, z + 1.0], [vx, 0]);
  }
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -24 : 21;
    B.boxMinMax(M.metal, [x0, 0, z - 1.6], [x0 + 3, 3.4, z + 1.6]);
    // The opening the belt runs into.
    const fx = sx < 0 ? x0 + 3 : x0;
    B.boxMinMax(M.ember, [Math.min(fx, fx - sx * 0.04), 1.0, z - 0.9], [Math.max(fx, fx - sx * 0.04), 2.2, z + 0.9], { collide: false, castShadow: false, halo: [-sx, 0, 0], bakeLight: false });
    B.light([Math.min(fx, fx - sx * 0.04), 1.0, z - 0.9], [Math.max(fx, fx - sx * 0.04), 2.2, z + 0.9], 0xff5a18, 1.6, 0.35);
    // Hanging strips (the smokehouse's curtain) over the opening, above the belt.
    for (let dz = -0.75; dz <= 0.76; dz += 0.3) {
      B.boxMinMax(M.metalDark, [Math.min(fx - sx * 0.08, fx - sx * 0.12), 1.15, z + dz - 0.1], [Math.max(fx - sx * 0.08, fx - sx * 0.12), 2.2, z + dz + 0.1], { collide: false, castShadow: false });
    }
    B.boxMinMax(M.metalDark, [x0 + 1, 3.4, z - 0.5], [x0 + 2, 4.6, z + 0.5]);
    hoods.push({ x: x0 + 1.5, y: 4.7, z });
  }
}

// Pallet racks in the west: three rows of six bays, two shelves of crates each and a deck on
// top you can climb onto (3.6 m: double jump and mantle).
function racks(B, M) {
  const top = 3.6;
  let k = 0;
  for (const z of [-5.5, 0, 5.5]) {
    const x0 = -27.2;
    const bay = 1.8;
    for (let i = 0; i <= 6; i++) {
      const x = x0 + i * bay;
      for (const dz of [-0.6, 0.6]) B.boxMinMax(M.paint, [x - 0.06, 0, z + dz - 0.06], [x + 0.06, top - 0.15, z + dz + 0.06]);
    }
    for (const y of [1.65, top - 0.27]) {
      for (const dz of [-0.6, 0.6]) B.boxMinMax(M.paint, [x0, y, z + dz - 0.06], [x0 + 6 * bay, y + 0.12, z + dz + 0.06], { collide: false });
    }
    B.boxMinMax(M.metalDark, [x0 - 0.06, top - 0.15, z - 0.66], [x0 + 6 * bay + 0.06, top, z + 0.66]);
    B.boxMinMax(M.plank, [x0, 1.77, z - 0.6], [x0 + 6 * bay, 1.85, z + 0.6]);
    for (let i = 0; i < 6; i++) {
      const cx = x0 + (i + 0.5) * bay;
      // A gap here and there to peek through.
      if ((i + k) % 5 !== 3) crate(B, M, cx, 0, z, 1.3, ((i * 7 + k) % 5 - 2) * 0.03);
      else drum(B, M, cx, z);
      if ((i + k) % 4 !== 1) crate(B, M, cx, 1.85, z, 1.15, ((i * 3 + k) % 5 - 2) * 0.04);
      k++;
    }
  }
}

// The grease vat in the east: wade through it (slow, weak jumps) or swing across on the hook
// rail between two loading docks.
function greaseVat(B, M, zones) {
  B.quad(
    M.grease,
    [
      [VAT.x0, VAT.top, VAT.z1],
      [VAT.x1, VAT.top, VAT.z1],
      [VAT.x1, VAT.top, VAT.z0],
      [VAT.x0, VAT.top, VAT.z0],
    ],
    { castShadow: false },
  );
  zones.addMud([VAT.x0, -1.5, VAT.z0], [VAT.x1, VAT.top + 0.05, VAT.z1], VAT.top);
  const trim = { collide: false };
  B.boxMinMax(M.hazard, [VAT.x0 - 0.3, 0, VAT.z0 - 0.3], [VAT.x1, 0.02, VAT.z0], trim);
  B.boxMinMax(M.hazard, [VAT.x0 - 0.3, 0, VAT.z1], [VAT.x1, 0.02, VAT.z1 + 0.3], trim);

  // Loading docks at each end.
  B.boxMinMax(M.concrete, [12, 0, -2], [VAT.x0, DOCK, 2]);
  B.boxMinMax(M.concrete, [VAT.x1, 0, -2], [HX, DOCK, 2]);
  B.boxMinMax(M.hazard, [12, DOCK - 0.25, -2.02], [VAT.x0, DOCK, 2.02], trim);
  // Stairs down north from the west dock, a ramp down south along the wall from the east one.
  for (let i = 0; i < 8; i++) {
    const z1 = -2 - 0.5 * i;
    B.boxMinMax(M.metalDark, [12.3, 0, z1 - 0.5], [15.7, DOCK - 0.3 * (i + 1), z1]);
  }
  B.ramp(M.metal, [28.8, DOCK, 2.0], [28.8, 0, 8.6], 2.4);

  // The hook rail: a frame on the docks and rungs to hang from.
  const barY = 4.7;
  const xa = VAT.x0 - 0.3;
  const xb = VAT.x1 + 0.3;
  const zr = 0.6;
  for (const x of [xa, xb]) {
    for (const z of [-zr, zr]) B.boxMinMax(M.paint, [x - 0.08, DOCK, z - 0.08], [x + 0.08, barY + 0.3, z + 0.08]);
    B.rod(M.steel, [x, barY + 0.3, -zr], [x, barY + 0.3, zr], 0.06);
  }
  for (const z of [-zr, zr]) B.rod(M.steel, [xa, barY + 0.05, z], [xb, barY + 0.05, z], 0.055);
  for (let x = VAT.x0; x <= VAT.x1 + 0.01; x += 0.6) B.rod(M.steel, [x, barY, -zr], [x, barY, zr], 0.035, { segments: 6 });
  // Meat hooks hanging off the rail now and then.
  for (const x of [17.5, 20.5, 23.5]) {
    B.rod(M.steel, [x, barY - 0.05, 0], [x, barY - 0.9, 0], 0.02, { segments: 4 });
    B.rod(M.steel, [x, barY - 0.9, 0], [x + 0.12, barY - 1.05, 0], 0.025, { segments: 4 });
  }
  zones.addBars({ minX: xa - 0.1, maxX: xb + 0.1, minZ: -0.7, maxZ: 0.7, y: barY });
}

// A press: a heavy machine block with a glowing gauge window.
function press(B, M, x, z, s) {
  half(B, M.metal, [x - 1.6, 0, z - 1.6], [x + 1.6, 0.8, z + 1.6], {}, s);
  half(B, M.metalDark, [x - 1.2, 0.8, z - 1.2], [x + 1.2, 3.6, z + 1.2], {}, s);
  half(B, M.paint, [x - 1.35, 3.6, z - 1.35], [x + 1.35, 4.0, z + 1.35], {}, s);
  half(B, M.glowOrange, [x - 0.5, 2.2, z + 1.2], [x + 0.5, 2.6, z + 1.23], { collide: false, castShadow: false, halo: s < 0 ? [0, 0, 1] : [0, 0, -1] }, s);
}

function cover(B, M) {
  for (const s of [-1, 1]) {
    const c = (x, y, z, size, rot) => {
      const [px, , pz] = flip([x, 0, z], s);
      crate(B, M, px, y, pz, size, rot);
    };
    const d = (x, z) => {
      const [px, , pz] = flip([x, 0, z], s);
      drum(B, M, px, pz);
    };
    // Between the north belt line and the catwalk.
    press(B, M, 15, -15, s);
    c(22, 0, -14.5, 1.5, 0.2);
    c(23.4, 0, -15.6, 1.0, -0.3);
    c(22.3, 1.5, -14.8, 1.0, 0.4);
    d(8, -16);
    d(8.9, -15.3);
    d(-9.8, -14.8);
    d(-9, -15.6);
    c(-15.5, 0, -14.5, 1.5, -0.15);
    c(-4.5, 0, -15.8, 1.0, 0.3);
    // Under the bridge, between the smoker and the belts.
    const [bx, , bz] = flip([-5.5, 0, -7], s);
    barrier(B, M, bx, bz, s < 0 ? 0.2 : 0.2 + Math.PI);
    c(5.2, 0, -6.6, 1.0, 0.25);
  }
  // A crate stack by the smoker for the skill jump onto its deck.
  crate(B, M, -6.8, 0, 4.4, 1.5, 0.1);
  crate(B, M, -7.9, 0, 5.4, 1.0, -0.2);
  // By the vat.
  drum(B, M, 13, 6);
  drum(B, M, 13.8, 6.7);
  crate(B, M, 25, 0, -7, 1.5, 0.15);
}

// Lamps hanging from the trusses, each with a warm pool of light on the floor.
function lamps(B, M) {
  const spots = [];
  for (const x of [-18, -6, 6, 18]) for (const z of [-7, 7]) spots.push([x, z]);
  for (const x of [-12, 12]) for (const z of [-15, 15]) spots.push([x, z]);
  for (const [x, z] of spots) {
    const y = 11.2;
    B.rod(M.steel, [x, y + 0.4, z], [x, TRUSS, z], 0.02, { segments: 4 });
    B.cylinder(M.metalDark, [x, y + 0.05, z], 0.45, 0.35, { segments: 12, collide: false });
    B.cylinder(M.lamp, [x, y, z], 0.4, 0.05, { segments: 12, collide: false, castShadow: false });
    B.light([x - 1, 0, z - 1], [x + 1, 0.2, z + 1], 0xffd59a, 3.2, 0.22);
  }
}

// The four-sided screen over the smoker (its faces are world/show.js), on cables up to the truss.
function jumbotron(B, M) {
  const deco = { collide: false, castShadow: false };
  B.boxMinMax(M.metalDark, [-3.1, 10.5, -3.1], [3.1, 13.7, 3.1], deco);
  // An orange rim around its bottom edge.
  const rim = { ...deco, bakeLight: false };
  for (const s of [-1, 1]) {
    B.boxMinMax(M.glowOrange, [-3.12, 10.45, s * 3.1 - 0.02], [3.12, 10.6, s * 3.1 + 0.02], rim);
    B.boxMinMax(M.glowOrange, [s * 3.1 - 0.02, 10.45, -3.12], [s * 3.1 + 0.02, 10.6, 3.12], rim);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) B.rod(M.steel, [sx * 2.6, 13.7, sz * 2.6], [0, TRUSS, sz * 2.9], 0.03, { segments: 4, castShadow: false });
  }
}
