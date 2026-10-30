import * as THREE from 'three';
import { StaticBuilder } from './staticBuilder.js';
import { Zones } from './zones.js';
import { bakeArena } from './bake.js';
import { crate, barrier, drum, pickupPads } from './parts.js';
import { gfx } from '../render/gfx.js';
import { mulberry32 } from '../util/rng.js';
import { MOVE } from '../config.js';

// Map 3: Smokehouse Creek (owner pick: Halo's Valhalla shape). A grass valley with two rival
// smokehouses facing each other from plateaus at its ends, a creek down the middle (wade it, or
// take a bridge or the stepping stones), a hill on each flank with boulders for cover, and a
// launch pad in front of each base that throws you out toward the middle. Rimmed by steep slopes.
// Coordinates: x east, z south, y up; the playable valley is x in [-50, 50], z in [-32, 32].

const HX = 50;
const HZ = 32;
// The bases' plateau, the water's surface and the creek bed.
const PLATEAU = 3;
const WATER = -0.5;
const BED = -1.3;
// The bases: the middle of each, and its footprint's half sizes; floor and roof heights.
const BASE_X = 42;
const BASE_HX = 6;
const BASE_HZ = 6;
const ROOF = PLATEAU + 4.2;
// Launch pads: where each sits (west one; the east one mirrors) and where it throws you.
const PAD_X = 31;
const PAD_TO_X = 8;
const PAD_TIME = 1.75;
// Bridges across the creek.
const BRIDGE_Z = 10;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bump = (x, z, cx, cz, r, hgt) => hgt * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));

// The ground's height anywhere (also used for placing things on it).
export function heightAt(x, z) {
  const ax = Math.abs(x);
  let h = PLATEAU * smooth(24, 33, ax);
  // The creek's valley, with a flat bed.
  h += -2.6 * Math.exp(-((x / 5.5) ** 2));
  // A hill on each flank (on both sides of the creek) and a low rise in front of each base.
  h += bump(x, z, -16, 19, 5.5, 4.2) + bump(x, z, 16, -19, 5.5, 4.2) + bump(x, z, 15, 20, 4.5, 2.4) + bump(x, z, -15, -20, 4.5, 2.4);
  h += bump(x, z, -24, 0, 4, 0.8) + bump(x, z, 24, 0, 4, 0.8);
  // Rolling.
  h += 0.35 * Math.sin(x * 0.31 + 1.3) * Math.sin(z * 0.27) + 0.22 * Math.sin(x * 0.13 - z * 0.19 + 0.7);
  // The rim: steep slopes all round.
  // (The higher of the two, so the corners don't stack into peaks.)
  h += 9 * Math.max(smooth(26, 31.5, Math.abs(z)), smooth(44.5, 49.5, ax));
  // The bases sit on flat ground.
  const flat = smooth(BASE_HX + 4.5, BASE_HX + 1.5, Math.abs(ax - BASE_X)) * smooth(BASE_HZ + 4.5, BASE_HZ + 1.5, Math.abs(z));
  h += (PLATEAU - h) * flat;
  // So do the launch pads.
  const pad = smooth(3.5, 1.8, Math.abs(ax - PAD_X)) * smooth(3.5, 1.8, Math.abs(z));
  h += (heightOfPad() - h) * pad;
  return Math.max(BED, h);
}
// (The pads sit on the plateau's edge.)
function heightOfPad() {
  return PLATEAU * smooth(24, 33, PAD_X) - 2.6 * Math.exp(-((PAD_X / 5.5) ** 2));
}

// The ground: a 1 m grid, drawn with the meadow texture and lit per vertex by its slope, darker
// and browner in the creek bed and grayer on the steep rim; collision is the same triangles.
function terrain(B, M, RAPIER, world) {
  const nx = HX * 2 + 1;
  const nz = HZ * 2 + 1;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const col = new Float32Array(nx * nz * 3);
  const tile = M.grass.userData.tile;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i - HX;
      const z = j - HZ;
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = heightAt(x, z);
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / tile;
      uv[k * 2 + 1] = -z / tile;
    }
  }
  const index = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(index);
  geom.computeVertexNormals();
  const nor = geom.attributes.normal;
  const rand = mulberry32(37);
  for (let k = 0; k < nx * nz; k++) {
    const y = pos[k * 3 + 1];
    const ny = nor.getY(k);
    // Slopes a little darker; wet banks and the bed browner; the steep rim rockier.
    let r = 0.78 + 0.22 * ny;
    let g = r;
    let b = r;
    const wet = smooth(0.2, -0.9, y);
    r *= 1 - 0.12 * wet;
    g *= 1 - 0.28 * wet;
    b *= 1 - 0.38 * wet;
    const steep = smooth(0.85, 0.6, ny);
    r = r * (1 - steep) + 0.82 * steep;
    g = g * (1 - steep) + 0.78 * steep;
    b = b * (1 - steep) + 0.76 * steep;
    const n = 0.94 + rand() * 0.08;
    col[k * 3] = r * n;
    col[k * 3 + 1] = g * n;
    col[k * 3 + 2] = b * n;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  B._add(M.grass, geom, false, null, false);
  // Collision: the same triangles.
  const c = world.createCollider(RAPIER.ColliderDesc.trimesh(pos.slice(), new Uint32Array(index)));
  B.surfaces.set(c.handle, 'dirt');
}

// A boulder: a squashed, turned icosahedron, gray, lit from above; solid (a box collider inside).
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function boulder(B, M, RAPIER, world, rand, x, z, r) {
  const y = heightAt(x, z);
  const g = new THREE.IcosahedronGeometry(1, 1);
  _s.set(r * (0.9 + rand() * 0.4), r * (0.6 + rand() * 0.3), r * (0.9 + rand() * 0.4));
  _q.setFromEuler(_e.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4));
  g.applyMatrix4(_m.compose(_p.set(x, y + _s.y * 0.45, z), _q, _s));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 2, uv.getY(i) * r);
  g.setIndex([...Array(g.attributes.position.count).keys()]);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const t = 0.85 + rand() * 0.15;
  for (let i = 0; i < pos.count; i++) {
    const lit = (0.6 + 0.4 * Math.min(1, (pos.getY(i) - y) / (_s.y * 1.2))) * t;
    col[i * 3] = lit * 0.92;
    col[i * 3 + 1] = lit * 0.9;
    col[i * 3 + 2] = lit * 0.86;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  B._add(M.concrete, g, true);
  // Solid: a box a little inside the rock's shape.
  const hx = _s.x * 0.72;
  const hz = _s.z * 0.72;
  const hy = _s.y * 0.75;
  const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y + hy * 0.6, z).setRotation(_q));
  B.surfaces.set(c.handle, 'concrete');
}

// One smokehouse. s: -1 the west (orange) one, 1 the east (cyan) one. A ground floor with a wide
// door toward the creek and doors on both sides, a smoker inside, a roof deck behind a parapet
// reached by a ramp along the south side, a porch roof over the front, and a smokestack.
function smokehouse(B, M, s) {
  const cx = s * BASE_X;
  const x0 = cx - BASE_HX;
  const x1 = cx + BASE_HX;
  const z0 = -BASE_HZ;
  const z1 = BASE_HZ;
  const y0 = PLATEAU;
  const team = s < 0 ? M.glowOrange : M.glowCyan;
  const front = s < 0 ? x1 : x0;
  const back = s < 0 ? x0 : x1;
  const fx = (a, b) => [Math.min(a, b), Math.max(a, b)];
  const T = 0.4;
  const H = ROOF - y0;
  // Foundation slab (floor for the bake), a little proud of the ground.
  B.boxMinMax(M.concrete, [x0 - 0.6, y0 - 1.2, z0 - 0.6], [x1 + 0.6, y0 + 0.1, z1 + 0.6], { floor: true });
  const yF = y0 + 0.1;
  // Back wall.
  B.boxMinMax(M.metal, [Math.min(back, back - s * T), yF, z0], [Math.max(back, back - s * T), ROOF, z1]);
  // Front wall with a wide door in the middle (4 m), a lintel over it.
  const [fa, fb] = fx(front, front + s * T);
  B.boxMinMax(M.metal, [fa, yF, z0], [fb, ROOF, -2]);
  B.boxMinMax(M.metal, [fa, yF, 2], [fb, ROOF, z1]);
  B.boxMinMax(M.metal, [fa, yF + 2.9, -2], [fb, ROOF, 2]);
  // Side walls, each with a door (1.6 m) near the front.
  const dx = front - s * 3.4;
  for (const z of [z0, z1]) {
    const [za, zb] = fx(z, z - Math.sign(z) * T);
    const [da, db] = fx(dx - 0.8, dx + 0.8);
    B.boxMinMax(M.metal, [x0, yF, za], [da, ROOF, zb]);
    B.boxMinMax(M.metal, [db, yF, za], [x1, ROOF, zb]);
    B.boxMinMax(M.metal, [da, yF + 2.4, za], [db, ROOF, zb]);
  }
  // The roof deck and its parapet (a gap at the ramp's top on the south side).
  B.boxMinMax(M.concrete, [x0, ROOF, z0], [x1, ROOF + 0.3, z1], { floor: true });
  const P = ROOF + 0.3;
  B.boxMinMax(M.metalDark, [x0, P, z0], [x1, P + 0.9, z0 + 0.3]);
  B.boxMinMax(M.metalDark, [x0, P, z1 - 0.3], [x1, P + 0.9, z1]);
  const [ra, rb] = fx(front, front - s * 0.3);
  B.boxMinMax(M.metalDark, [ra, P, z0], [rb, P + 0.9, z1 - 3]);
  const [ba, bb] = fx(back, back + s * 0.3);
  B.boxMinMax(M.metalDark, [ba, P, z0], [bb, P + 0.9, z1]);
  // Team color strips along the parapet's top and over the front door.
  B.boxMinMax(team, [x0, P + 0.9, z0], [x1, P + 0.96, z0 + 0.3], { collide: false, castShadow: false });
  B.boxMinMax(team, [x0, P + 0.9, z1 - 0.3], [x1, P + 0.96, z1], { collide: false, castShadow: false });
  const [ga, gb] = fx(front + s * T, front + s * (T + 0.04));
  B.boxMinMax(team, [ga, yF + 3.0, -1.8], [gb, yF + 3.2, 1.8], { collide: false, castShadow: false, halo: [s < 0 ? 1 : -1, 0, 0] });
  // The ramp up the south side, outside, from the front corner to the roof's gap.
  const rx0 = front + s * 0.6;
  const rx1 = front - s * (BASE_HX * 2 - 3.5);
  B.ramp(M.metalDark, [rx0, yF, z1 + 1.4], [rx1 + s * 0.2, P, z1 + 1.4], 2.2);
  B.boxMinMax(M.metalDark, [Math.min(rx1, rx1 - s * 2.6), P - 0.3, z1 - 3], [Math.max(rx1, rx1 - s * 2.6), P, z1 + 2.5]);
  // Porch roof over the front door, on two posts.
  const [pa, pb] = fx(front + s * T, front + s * 3.2);
  B.boxMinMax(M.paint, [pa, ROOF - 0.9, -3.5], [pb, ROOF - 0.6, 3.5]);
  for (const z of [-3.2, 3.2]) B.cylinder(M.steel, [front + s * 2.9, yF, z], 0.14, ROOF - 0.9 - yF, { segments: 8 });
  // Inside: the smoker against the back wall, and a crate to stand behind.
  const sx = back + s * 1.6;
  B.boxMinMax(M.metalDark, [sx - 1.1, yF, -1.6], [sx + 1.1, yF + 1.6, 1.6]);
  B.boxMinMax(M.ember, [Math.min(sx + s * 1.1, sx + s * 1.13), yF + 0.5, -0.9], [Math.max(sx + s * 1.1, sx + s * 1.13), yF + 1.1, 0.9], { collide: false, castShadow: false, halo: [s, 0, 0] });
  // The smokestack, out the back of the roof.
  const stX = back + s * 1.4;
  B.cylinder(M.metal, [stX, P, -3.5], 0.85, 7, { segments: 12 });
  B.cylinder(team, [stX, P + 6.6, -3.5], 0.88, 0.25, { segments: 12, collide: false, castShadow: false });
  return [
    { x: stX, y: P + 7.1, z: -3.5, wisps: 1.6, acc: Math.random() },
    { x: sx, y: yF + 1.7, z: 0, wisps: 0.5, acc: Math.random() },
  ];
}

// A plank bridge over the creek at z, on low ramps from each bank.
function bridge(B, M, z) {
  const y = 0.35;
  B.boxMinMax(M.plank, [-6.5, y - 0.25, z - 1.6], [6.5, y, z + 1.6], { floor: true });
  for (const s of [-1, 1]) {
    const bank = heightAt(s * 9.5, z);
    B.ramp(M.plank, [s * 6.3, y, z], [s * 9.5, bank, z], 3.2, 0.25);
    // Railings.
    for (const rz of [z - 1.55, z + 1.55]) B.boxMinMax(M.plank, [-6.5, y, rz - 0.06], [6.5, y + 0.9, rz + 0.06], { castShadow: true });
  }
  for (const x of [-4, 0, 4]) for (const rz of [z - 1.4, z + 1.4]) B.cylinder(M.plank, [x, BED - 0.2, rz], 0.18, y - BED, { segments: 8 });
}

const PICKUP_SPOTS = [
  // The power gun on the stepping-stone island in the middle of the creek.
  { type: 'weapon', pad: 'power', pos: [0, 0.05, 0], respawn: 60 },
  { type: 'weapon', pad: 'field', pos: [-16, heightAt(-16, 19), 19], respawn: 30 },
  { type: 'weapon', pad: 'field', pos: [16, heightAt(16, -19), -19], respawn: 30 },
  { type: 'grenades', count: 2, pos: [-BASE_X, ROOF + 0.3, 0], respawn: 20 },
  { type: 'grenades', count: 2, pos: [BASE_X, ROOF + 0.3, 0], respawn: 20 },
  { type: 'grenades', count: 2, pos: [0, 0.35, BRIDGE_Z], respawn: 20 },
  { type: 'grenades', count: 2, pos: [0, 0.35, -BRIDGE_Z], respawn: 20 },
];

const DUMMY_POSTS = [
  { name: 'Creek Dummy', post: [-12, heightAt(-12, 4), 4], patrol: [0, 4], speed: 2.6, yaw: Math.PI / 2 },
  { name: 'Hill Dummy', post: [-16, heightAt(-16, 17), 17], yaw: Math.PI / 2 },
  { name: 'Bridge Dummy', post: [3, 0.35, BRIDGE_Z], patrol: [3, 0], speed: 2.2, yaw: -Math.PI / 2 },
  { name: 'Porch Dummy', post: [BASE_X - 8.5, PLATEAU + 0.1, 2], yaw: -Math.PI / 2 },
  { name: 'Roof Dummy', post: [BASE_X, ROOF + 0.3, -2], yaw: -Math.PI / 2 },
];

// Where each launch pad throws you: up and out toward the middle, landing at PAD_TO_X.
function padVelocity(s) {
  const from = heightOfPad();
  const to = heightAt(s * PAD_TO_X, 0);
  const g = MOVE.gravity * (1 + MOVE.fallGravityMul) * 0.5;
  const T = PAD_TIME;
  return [(-s * (PAD_X - PAD_TO_X)) / T, (to - from + 0.5 * g * T * T) / T, 0];
}

// The bots' moves the grid can't see: each launch pad, onto it and out to where it lands.
export const VALLEY_LINKS = [-1, 1].map((s) => ({
  type: 'launch',
  a: [s * PAD_X, heightOfPad(), 0],
  b: [s * PAD_TO_X, heightAt(s * PAD_TO_X, 0), 0],
}));

export function buildValley({ scene, RAPIER, world, materials: M, bakeSize = 512 }) {
  const B = new StaticBuilder(RAPIER, world);
  const zones = new Zones();
  const rand = mulberry32(53);

  terrain(B, M, RAPIER, world);
  // The creek: wade it (slow, weak jumps, like mud); shots stop at the water.
  zones.addMud([-5.5, BED - 0.5, -HZ - 2], [5.5, WATER, HZ + 2], WATER);
  // Stepping stones across the middle, and the island the power gun sits on.
  B.cylinder(M.concrete, [0, BED, 0], 1.6, 0.05 - BED, { segments: 12 });
  for (const x of [-4.6, -2.6, 2.6, 4.6]) B.cylinder(M.concrete, [x, BED, (rand() - 0.5) * 0.8], 0.6, WATER + 0.25 - BED, { segments: 9 });
  for (const s of [-1, 1]) bridge(B, M, s * BRIDGE_Z);

  // The two smokehouses, and their smoke.
  const vents = [...smokehouse(B, M, -1), ...smokehouse(B, M, 1)];

  // Launch pads: a glowing ring in its team color, the throw going out toward the middle.
  for (const s of [-1, 1]) {
    const x = s * PAD_X;
    const y = heightOfPad();
    B.cylinder(M.metalDark, [x, y - 0.2, 0], 1.5, 0.3, { segments: 16 });
    B.cylinder(s < 0 ? M.glowOrange : M.glowCyan, [x, y + 0.1, 0], 1.25, 0.04, { segments: 16, collide: false, castShadow: false });
    B.light([x - 1.3, y, -1.3], [x + 1.3, y + 0.2, 1.3], s < 0 ? 0xff8a2a : 0x63f2ff, 3, 0.3);
    zones.addLaunch([x - 1.2, y - 0.5, -1.2], [x + 1.2, y + 1, 1.2], padVelocity(s));
  }

  // Boulders: clusters on the hills, along the creek banks and scattered over the open ground.
  const rocks = [
    [-16, 19, 1.4], [-14, 21.5, 0.9], [-18.5, 17, 1.0], [16, -19, 1.4], [14, -21.5, 0.9], [18.5, -17, 1.0],
    [15, 20, 1.1], [-15, -20, 1.1], [-8, -4, 0.9], [8, 4, 0.9], [-8.5, 14, 0.8], [8.5, -14, 0.8],
    [-24, -12, 1.2], [24, 12, 1.2], [-26, 10, 0.9], [26, -10, 0.9], [-20, 4, 0.7], [20, -4, 0.7],
    [-11, -22, 1.0], [11, 22, 1.0], [-30, 18, 1.3], [30, -18, 1.3], [-32, -20, 1.1], [32, 20, 1.1],
  ];
  for (const [x, z, r] of rocks) boulder(B, M, RAPIER, world, rand, x, z, r);
  // A few crates and drums by the bases.
  // (Each sunk a little into the slope it stands on.)
  const at = (x, z) => heightAt(x, z) - 0.1;
  for (const s of [-1, 1]) {
    crate(B, M, s * (BASE_X - 10), at(s * (BASE_X - 10), -7), -7, 1.5, 0.3);
    crate(B, M, s * (BASE_X - 11), at(s * (BASE_X - 11), -8.2), -8.2, 1.0, -0.2);
    drum(B, M, s * (BASE_X - 9), 7.5, at(s * (BASE_X - 9), 7.5));
    barrier(B, M, s * (BASE_X - 14), 4.5, Math.PI / 2 + s * 0.3, at(s * (BASE_X - 14), 4.5));
  }
  // Invisible walls round the valley and a ceiling.
  B.collider([-HX - 2, -5, -HZ - 2], [-HX, 30, HZ + 2]);
  B.collider([HX, -5, -HZ - 2], [HX + 2, 30, HZ + 2]);
  B.collider([-HX, -5, -HZ - 2], [HX, 30, -HZ]);
  B.collider([-HX, -5, HZ], [HX, 30, HZ + 2]);
  B.collider([-HX - 2, 30, -HZ - 2], [HX + 2, 31, HZ + 2]);

  pickupPads(B, M, PICKUP_SPOTS);
  // Damp ground along the creek.
  B.stain([-6.5, -HZ], [6.5, HZ], 2.5, 0.12);

  const bake = bakeArena(B, { id: 'valley', half: HX + 2, size: bakeSize, seed: 41 });
  const meshes = B.build(scene, gfx.vertexLight ? bake : null);
  if (gfx.bake) bake.apply(M.grass);

  // The water: one plane over the creek.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(11, HZ * 2 + 4).rotateX(-Math.PI / 2), M.water);
  water.position.set(0, WATER, 0);
  water.name = 'creek';
  water.renderOrder = 2;
  scene.add(water);

  const spawnPoints = [
    [-BASE_X, PLATEAU + 0.1, -3], [-BASE_X + 2, PLATEAU + 0.1, 3], [-BASE_X + 1, ROOF + 0.3, -2], [-BASE_X - 9, PLATEAU, 9],
    [BASE_X, PLATEAU + 0.1, 3], [BASE_X - 2, PLATEAU + 0.1, -3], [BASE_X - 1, ROOF + 0.3, 2], [BASE_X + 9, PLATEAU, -9],
    [-20, 0, 24], [20, 0, -24], [-22, 0, -16], [22, 0, 16],
  ].map(([x, y, z]) => {
    const yy = y === 0 ? heightAt(x, z) : y;
    return { position: new THREE.Vector3(x, yy, z), yaw: Math.atan2(x, z * 0.3) };
  });

  return {
    meshes,
    bake,
    zones,
    half: HX,
    shadowHalf: HX + 2,
    shadowTop: 16,
    // The bots' sampled area (navgraph.js): the whole valley, casting down from above the stacks.
    nav: { halfX: 49, halfZ: 31, top: 18 },
    stands: [],
    screen: null,
    podium: { x: 0, y: 0.05, z: 0 },
    // A Sizzler by each smokehouse's north front corner, facing the valley.
    vehicles: [-1, 1].map((s) => ({ pos: [s * 35, heightAt(s * 35, -9.5) + 0.05, -9.5], yaw: (s * Math.PI) / 2 })),
    spawnPoints,
    pickupSpots: PICKUP_SPOTS,
    dummyPosts: DUMMY_POSTS,
    halos: B.halos,
    surfaces: B.surfaces,
    blockers: B.blockers,
    trims: B.trims,
    update(dt, time, fx) {
      for (const v of vents) {
        v.acc += dt * v.wisps;
        while (v.acc >= 1) {
          v.acc -= 1;
          fx.fireWisp(v.x + (Math.random() - 0.5) * 0.4, v.y, v.z + (Math.random() - 0.5) * 0.4);
        }
      }
    },
  };
}
