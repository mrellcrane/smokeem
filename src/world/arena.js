import * as THREE from 'three';
import { StaticBuilder } from './staticBuilder.js';
import { Zones } from './zones.js';
import { createFire } from './fire.js';

// Map 1: Mudlark Gauntlet. A small obstacle-race arena inside tall metal walls.
// Coordinates: x east, z south, y up. The playable floor is x, z in [-30, 30].
// See GAME_DESIGN.md for the layout overview.

export const ARENA_HALF = 30;
const WALL_H = 7;

const PIT = { x0: 10, x1: 22, z0: -6, z1: 6, floor: -0.8, mudY: -0.25 };

export function buildArena({ scene, RAPIER, world, materials: M, textures }) {
  const B = new StaticBuilder(RAPIER, world);
  const zones = new Zones();
  const H = ARENA_HALF;

  // Ground, with a hole for the mud pit.
  const g = { castShadow: false };
  B.boxMinMax(M.ground, [-H - 1, -1, -H - 1], [PIT.x0, 0, H + 1], g);
  B.boxMinMax(M.ground, [PIT.x1, -1, -H - 1], [H + 1, 0, H + 1], g);
  B.boxMinMax(M.ground, [PIT.x0, -1, -H - 1], [PIT.x1, 0, PIT.z0], g);
  B.boxMinMax(M.ground, [PIT.x0, -1, PIT.z1], [PIT.x1, 0, H + 1], g);
  B.boxMinMax(M.ground, [PIT.x0, -1.8, PIT.z0], [PIT.x1, PIT.floor, PIT.z1], g);

  // Outer terrain seen over the walls from high ground. Sits below the pit floor.
  B.boxMinMax(M.ground, [-450, -2.6, -450], [450, -2.0, 450], { castShadow: false, collide: false });

  perimeter(B, M, H);
  summit(B, M, zones);
  climbingWalls(B, M);
  mudPitAndBars(B, M, zones);
  const fireTroughs = fireJump(B, M, zones);
  ropeGantry(B, M, zones);
  netBlock(B, M, zones);
  cover(B, M);
  lightPylons(B, M, H);

  const meshes = B.build(scene);

  const fire = createFire(textures, fireTroughs);
  scene.add(fire.mesh);

  const spawnPoints = [
    [-26, -17], [-4, -18], [12, -16], [27, -12], [27, 10], [20, 22],
    [6, 18], [-6, 22], [-24, 24], [-15, 10], [-15, -14], [-10, -4],
  ].map(([x, z]) => ({
    position: new THREE.Vector3(x, 0, z),
    // Face the middle of the arena.
    yaw: Math.atan2(x, z),
  }));

  const mudMap = M.mud.map;

  return {
    meshes,
    zones,
    spawnPoints,
    update(dt, time) {
      fire.update(time);
      // Slow drift so the mud looks a little alive.
      mudMap.offset.x = Math.sin(time * 0.05) * 0.2;
      mudMap.offset.y = time * 0.004;
    },
  };
}

function perimeter(B, M, H) {
  const T = 1;
  B.boxMinMax(M.metal, [-H - T, 0, -H - T], [H + T, WALL_H, -H]);
  B.boxMinMax(M.metal, [-H - T, 0, H], [H + T, WALL_H, H + T]);
  B.boxMinMax(M.metal, [-H - T, 0, -H], [-H, WALL_H, H]);
  B.boxMinMax(M.metal, [H, 0, -H], [H + T, WALL_H, H]);
  // Invisible extension so nobody double-jumps out of the arena from high ground.
  B.collider([-H - T, WALL_H, -H - T], [H + T, 40, -H]);
  B.collider([-H - T, WALL_H, H], [H + T, 40, H + T]);
  B.collider([-H - T, WALL_H, -H], [-H, 40, H]);
  B.collider([H, WALL_H, -H], [H + T, 40, H]);

  const deco = { collide: false };
  const glow = { collide: false, castShadow: false };
  const e = 0.04;
  // Hazard band along the bottom and a glow strip near the top, on the inside faces.
  B.boxMinMax(M.hazard, [-H, 0, -H], [H, 0.6, -H + e], deco);
  B.boxMinMax(M.hazard, [-H, 0, H - e], [H, 0.6, H], deco);
  B.boxMinMax(M.hazard, [-H, 0, -H], [-H + e, 0.6, H], deco);
  B.boxMinMax(M.hazard, [H - e, 0, -H], [H, 0.6, H], deco);
  B.boxMinMax(M.glowCyan, [-H, 6.4, -H], [H, 6.52, -H + e], glow);
  B.boxMinMax(M.glowCyan, [-H, 6.4, H - e], [H, 6.52, H], glow);
  B.boxMinMax(M.glowCyan, [-H, 6.4, -H], [-H + e, 6.52, H], glow);
  B.boxMinMax(M.glowCyan, [H - e, 6.4, -H], [H, 6.52, H], glow);

  // Buttresses on the north, east and west walls (the south wall has the catwalk).
  for (const p of [-20, -10, 0, 10, 20]) {
    B.boxMinMax(M.metalDark, [p - 0.6, 0, -H], [p + 0.6, WALL_H + 0.3, -H + 0.6]);
    B.boxMinMax(M.metalDark, [-H, 0, p - 0.6], [-H + 0.6, WALL_H + 0.3, p + 0.6]);
    B.boxMinMax(M.metalDark, [H - 0.6, 0, p - 0.6], [H, WALL_H + 0.3, p + 0.6]);
  }
}

// The Summit: a 6 m deck on legs in the middle, cargo nets north and south.
function summit(B, M, zones) {
  const top = 6.0;
  const deckBottom = 5.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B.boxMinMax(M.metalDark, [sx * 3.5 - 0.4, 0, sz * 3.5 - 0.4], [sx * 3.5 + 0.4, deckBottom, sz * 3.5 + 0.4]);
    }
  }
  B.boxMinMax(M.concrete, [-4, deckBottom, -4], [4, top, 4]);
  B.boxMinMax(M.hazard, [-4.02, deckBottom + 0.05, -4.02], [4.02, deckBottom + 0.3, 4.02], { collide: false });
  // Solid core under the deck for cover.
  B.boxMinMax(M.metal, [-1.2, 0, -1.2], [1.2, deckBottom, 1.2]);
  const glow = { collide: false, castShadow: false };
  B.boxMinMax(M.glowCyan, [-0.5, 1.0, -1.24], [0.5, 4.5, -1.2], glow);
  B.boxMinMax(M.glowCyan, [-0.5, 1.0, 1.2], [0.5, 4.5, 1.24], glow);
  B.boxMinMax(M.glowCyan, [-1.24, 1.0, -0.5], [-1.2, 4.5, 0.5], glow);
  B.boxMinMax(M.glowCyan, [1.2, 1.0, -0.5], [1.24, 4.5, 0.5], glow);

  // Rails: full on east and west, corners only on north and south so nets can arrive.
  const railTop = top + 0.9;
  B.boxMinMax(M.metal, [3.7, top, -4], [4, railTop, 4]);
  B.boxMinMax(M.metal, [-4, top, -4], [-3.7, railTop, 4]);
  for (const sz of [-1, 1]) {
    const z0 = sz < 0 ? -4 : 3.7;
    const z1 = sz < 0 ? -3.7 : 4;
    B.boxMinMax(M.metal, [-3.7, top, z0], [-2, railTop, z1]);
    B.boxMinMax(M.metal, [2, top, z0], [3.7, railTop, z1]);
  }

  // A-frame cargo nets.
  for (const sz of [-1, 1]) {
    const bottom = [0, 0, sz * 7.2];
    const topEdge = [0, top, sz * 4.0];
    cargoNet(B, M, zones, bottom, topEdge, 4, [0, 0, sz]);
  }
}

// Visual + zone for a cargo net between two edge centers.
function cargoNet(B, M, zones, bottom, top, width, outward) {
  zones.addNet({ bottom, top, width, outward });
  const net = zones.nets[zones.nets.length - 1];
  const hw = width / 2;
  const L = net.lateral;
  const b0 = [bottom[0] - L.x * hw, bottom[1], bottom[2] - L.z * hw];
  const b1 = [bottom[0] + L.x * hw, bottom[1], bottom[2] + L.z * hw];
  const t1 = [top[0] + L.x * hw, top[1], top[2] + L.z * hw];
  const t0 = [top[0] - L.x * hw, top[1], top[2] - L.z * hw];
  B.quad(M.net, [b0, b1, t1, t0]);
  // Frame: thick rope edges and steel bars at top and bottom.
  B.rod(M.rope, b0, t0, 0.06);
  B.rod(M.rope, b1, t1, 0.06);
  B.rod(M.steel, [b0[0], b0[1] + 0.06, b0[2]], [b1[0], b1[1] + 0.06, b1[2]], 0.06);
  B.rod(M.steel, t0, t1, 0.07);
  // Ground stakes.
  for (const p of [b0, b1]) B.box(M.metalDark, [p[0], 0.15, p[2]], [0.25, 0.3, 0.25], { collide: false });
}

// Three walls across the west lane: vault, jump + mantle, double jump + mantle.
function climbingWalls(B, M) {
  const x0 = -27;
  const x1 = -19;
  const walls = [
    { z: -8, h: 1.3 },
    { z: -1, h: 2.6 },
    { z: 6, h: 4.4 },
  ];
  for (const w of walls) {
    B.boxMinMax(M.plank, [x0, 0, w.z - 0.15], [x1, w.h, w.z + 0.15]);
    B.boxMinMax(M.steel, [x0 - 0.05, w.h, w.z - 0.2], [x1 + 0.05, w.h + 0.08, w.z + 0.2]);
    for (const x of [x0 - 0.15, x1 + 0.15]) {
      B.boxMinMax(M.metalDark, [x - 0.15, 0, w.z - 0.25], [x + 0.15, w.h + 0.3, w.z + 0.25]);
    }
    B.boxMinMax(M.hazard, [x0, 0, w.z - 0.17], [x1, 0.3, w.z + 0.17], { collide: false });
  }
}

function mudPitAndBars(B, M, zones) {
  // Mud surface. The pit floor is 0.55 m below it, so you wade.
  B.quad(
    M.mud,
    [
      [PIT.x0, PIT.mudY, PIT.z1],
      [PIT.x1, PIT.mudY, PIT.z1],
      [PIT.x1, PIT.mudY, PIT.z0],
      [PIT.x0, PIT.mudY, PIT.z0],
    ],
    { castShadow: false },
  );
  zones.addMud([PIT.x0, -1.5, PIT.z0], [PIT.x1, PIT.mudY + 0.05, PIT.z1]);
  // Hazard trim around the pit lip.
  const trim = { collide: false, castShadow: false };
  B.boxMinMax(M.hazard, [PIT.x0 - 0.3, 0, PIT.z0 - 0.3], [PIT.x1 + 0.3, 0.02, PIT.z0], trim);
  B.boxMinMax(M.hazard, [PIT.x0 - 0.3, 0, PIT.z1], [PIT.x1 + 0.3, 0.02, PIT.z1 + 0.3], trim);

  // Platforms at each end of the monkey bars.
  const top = 2.4;
  B.boxMinMax(M.concrete, [7, 0, -2], [PIT.x0, top, 2]);
  B.boxMinMax(M.concrete, [PIT.x1, 0, -2], [25, top, 2]);
  // Ramp up to the west platform from the south.
  B.ramp(M.metal, [8.5, 0, 8.6], [8.5, top, 2.0], 2.4);
  // Stairs up to the east platform from the north.
  for (let i = 0; i < 8; i++) {
    const z1 = -2 - 0.5 * i;
    B.boxMinMax(M.metalDark, [22.3, 0, z1 - 0.5], [24.7, top - 0.3 * (i + 1), z1]);
  }

  // Monkey bars frame.
  const barY = 4.7;
  const xa = 9.7;
  const xb = 22.3;
  const zr = 0.6;
  for (const x of [xa, xb]) {
    for (const z of [-zr, zr]) {
      B.boxMinMax(M.steel, [x - 0.08, top, z - 0.08], [x + 0.08, barY + 0.3, z + 0.08]);
    }
    B.rod(M.steel, [x, barY + 0.3, -zr], [x, barY + 0.3, zr], 0.06);
  }
  for (const z of [-zr, zr]) B.rod(M.steel, [xa, barY + 0.05, z], [xb, barY + 0.05, z], 0.055);
  for (let x = 10.0; x <= 22.01; x += 0.6) {
    B.rod(M.steel, [x, barY, -zr], [x, barY, zr], 0.035, { segments: 6 });
  }
  zones.addBars({ minX: 9.6, maxX: 22.4, minZ: -0.55, maxZ: 0.55, y: barY });
}

function fireJump(B, M, zones) {
  const troughs = [];
  const z0 = -27;
  const z1 = -21;
  for (const x of [-7, -1, 5]) {
    B.boxMinMax(M.metalDark, [x - 0.6, 0, z0], [x + 0.6, 0.35, z1]);
    B.boxMinMax(M.ember, [x - 0.4, 0.35, z0 + 0.2], [x + 0.4, 0.37, z1 - 0.2], { collide: false, castShadow: false });
    B.boxMinMax(M.hazard, [x - 0.62, 0.0, z0 - 0.02], [x + 0.62, 0.3, z0], { collide: false });
    B.boxMinMax(M.hazard, [x - 0.62, 0.0, z1], [x + 0.62, 0.3, z1 + 0.02], { collide: false });
    zones.addFire([x - 0.6, 0, z0], [x + 0.6, 1.8, z1]);
    troughs.push({ x, z0: z0 + 0.3, z1: z1 - 0.3, y: 0.3, height: 1.5 });
  }
  return troughs;
}

// High catwalk along the south wall, reached by three ropes or a long ramp at the east end.
function ropeGantry(B, M, zones) {
  const deckTop = 5.5;
  const zFront = 26;
  const H = ARENA_HALF;
  B.boxMinMax(M.metal, [-12, deckTop - 0.3, zFront], [14, deckTop, H]);
  for (const x of [-12, -4, 4, 12]) {
    B.boxMinMax(M.metalDark, [x - 0.25, 0, zFront + 0.05], [x + 0.25, deckTop - 0.3, zFront + 0.55]);
  }
  // Front railing with gaps where the ropes arrive.
  for (const [a, b] of [[-12, -8], [-6, -1], [1, 6], [8, 14]]) {
    B.boxMinMax(M.metal, [a, deckTop, zFront], [b, deckTop + 1.0, zFront + 0.2]);
  }
  B.boxMinMax(M.metal, [-12, deckTop, zFront], [-11.8, deckTop + 1.0, H]);
  B.boxMinMax(M.glowOrange, [-12, deckTop - 0.25, zFront - 0.03], [14, deckTop - 0.1, zFront], {
    collide: false,
    castShadow: false,
  });
  // Ramp along the wall from the southeast corner up to the catwalk's east end.
  B.ramp(M.metal, [24.6, 0, 28.5], [14, deckTop, 28.5], 3);

  // Gantry beam and posts the ropes hang from.
  const ropeZ = 25.6;
  const beamBottom = 7.35;
  B.boxMinMax(M.metalDark, [-12.75, beamBottom, ropeZ - 0.2], [12.75, beamBottom + 0.3, ropeZ + 0.2]);
  for (const x of [-12.5, 12.5]) {
    B.boxMinMax(M.metalDark, [x - 0.25, 0, ropeZ - 0.25], [x + 0.25, beamBottom + 0.3, ropeZ + 0.25]);
  }
  for (const x of [-7, 0, 7]) {
    B.rod(M.rope, [x, 0.5, ropeZ], [x, beamBottom, ropeZ], 0.06, { segments: 6 });
    B.cylinder(M.rope, [x, 0.4, ropeZ], 0.11, 0.25, { collide: false, segments: 8 });
    zones.addRope({ x, z: ropeZ, y0: 0.5, y1: beamBottom });
  }
}

// A 5 m block in the northeast with a vertical cargo net on its south face.
function netBlock(B, M, zones) {
  const top = 5.0;
  B.boxMinMax(M.metal, [16, 0, -26.5], [26, top, -22]);
  B.boxMinMax(M.metalDark, [16, top, -26.5], [16.3, top + 0.8, -22]);
  B.boxMinMax(M.metalDark, [25.7, top, -26.5], [26, top + 0.8, -22]);
  B.boxMinMax(M.hazard, [15.98, top - 0.3, -22.02], [26.02, top, -21.98], { collide: false });
  B.boxMinMax(M.glowCyan, [17, 1.5, -22.03], [17.3, 4.2, -22], { collide: false, castShadow: false });
  B.boxMinMax(M.glowCyan, [24.7, 1.5, -22.03], [25, 4.2, -22], { collide: false, castShadow: false });
  cargoNet(B, M, zones, [21, 0, -21.85], [21, top, -21.85], 5, [0, 0, 1]);
}

function crate(B, M, x, y, z, s, rotY = 0) {
  B.box(M.crate, [x, y + s / 2, z], [s, s, s], { uv: 'fit', rotY });
}

function barrier(B, M, x, z, rotY) {
  B.box(M.concrete, [x, 0.5, z], [3, 1.0, 0.6], { rotY });
  B.box(M.hazard, [x, 0.85, z], [3.02, 0.12, 0.62], { rotY, collide: false });
}

function drum(B, M, x, z) {
  B.cylinder(M.metalDark, [x, 0, z], 0.45, 1.1, { segments: 12 });
  B.cylinder(M.glowOrange, [x, 0.75, z], 0.46, 0.1, { segments: 12, collide: false, castShadow: false });
}

function cover(B, M) {
  // Northwest crate stack.
  crate(B, M, -22, 0, -22, 1.5);
  crate(B, M, -22, 1.5, -22, 1.5, 0.3);
  crate(B, M, -20.4, 0, -22.4, 1.0, 0.2);
  crate(B, M, -22.3, 0, -20.3, 1.0, -0.15);
  // Skill-jump crate west of the Summit.
  crate(B, M, -6.3, 0, 1, 1.5, 0.1);
  crate(B, M, -7.7, 0, 2.3, 1.0, -0.2);
  // Southwest barriers.
  barrier(B, M, -20, 18, 0.3);
  barrier(B, M, -15, 22, -0.4);
  barrier(B, M, -24, 14, 1.2);
  // Southeast crates.
  crate(B, M, 18, 0, 16, 1.5, 0.2);
  crate(B, M, 20, 0, 18, 1.5, -0.3);
  crate(B, M, 19.2, 1.5, 16.8, 1.0, 0.5);
  // South field.
  crate(B, M, -4, 0, 19, 1.5, 0.4);
  crate(B, M, 5, 0, 20, 1.5, -0.2);
  // Northeast approach.
  crate(B, M, 14, 0, -14, 1.5, 0.25);
  crate(B, M, 24, 0, -14, 1.5, -0.1);
  drum(B, M, 12, -11);
  drum(B, M, 12.9, -10.3);
  drum(B, M, -12, 12);
  drum(B, M, -11.2, 12.8);
  // Low walls north and south of the Summit.
  B.box(M.concrete, [0, 0.55, 13], [5, 1.1, 0.4]);
  B.box(M.concrete, [0, 0.55, -13], [5, 1.1, 0.4]);
  B.box(M.hazard, [0, 1.1, 13], [5.02, 0.06, 0.42], { collide: false });
  B.box(M.hazard, [0, 1.1, -13], [5.02, 0.06, 0.42], { collide: false });
}

function lightPylons(B, M, H) {
  const p = H - 1.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * p;
      const z = sz * p;
      B.cylinder(M.metalDark, [x, 0, z], 0.25, 12, { segments: 8 });
      B.box(M.metalDark, [x, 12.2, z], [1.6, 0.5, 0.8], { collide: false });
      B.box(M.glowCyan, [x, 11.93, z], [1.4, 0.05, 0.6], { collide: false, castShadow: false });
    }
  }
}
