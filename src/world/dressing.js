import * as THREE from 'three';
import { mulberry32 } from '../util/rng.js';

// Set dressing: things that make the maps feel like a working game show and smokehouse without
// changing how they play. Almost all of it is looks only (no colliders), kept to walls, wall tops
// and the air over the floor, and built from materials the map already draws, so it costs no
// extra draw calls. Each function returns smoke vents ({ x, y, z }) for the map's update to puff.

const deco = { collide: false };
const glow = { collide: false, castShadow: false, bakeLight: false };

// A sponsor board flat on a wall: a dark frame, a pale panel, an orange bar with a cyan strip
// under it. (x, z): the middle of the board on the wall's face; n: the way the wall faces.
function board(B, M, x, z, n, w = 6.4) {
  const along = n[0] === 0;
  const box = (mat, du, y0, y1, d0, d1, opts) => {
    const u0 = -w / 2 + du;
    const u1 = w / 2 - du;
    if (along) B.boxMinMax(mat, [x + u0, y0, Math.min(z + n[1] * d0, z + n[1] * d1)], [x + u1, y1, Math.max(z + n[1] * d0, z + n[1] * d1)], opts);
    else B.boxMinMax(mat, [Math.min(x + n[0] * d0, x + n[0] * d1), y0, z + u0], [Math.max(x + n[0] * d0, x + n[0] * d1), y1, z + u1], opts);
  };
  box(M.metalDark, 0, 2.3, 4.7, 0.0, 0.1, deco);
  box(M.concrete, 0.18, 2.48, 4.52, 0.1, 0.13, deco);
  box(M.glowOrange, 0.5, 3.55, 4.1, 0.13, 0.15, glow);
  box(M.glowCyan, 1.4, 3.05, 3.2, 0.13, 0.15, glow);
  box(M.metalDark, 2.2, 2.7, 2.85, 0.13, 0.15, deco);
}

// A TV camera on a tripod on a wall top, aimed at (tx, tz).
function tvCamera(B, M, x, y, z, tx, tz) {
  const yaw = Math.atan2(-(tx - x), -(tz - z));
  for (let i = 0; i < 3; i++) {
    const a = yaw + (i * Math.PI * 2) / 3;
    B.rod(M.metalDark, [x + Math.sin(a) * 0.55, y, z + Math.cos(a) * 0.55], [x, y + 1.3, z], 0.035, { segments: 5 });
  }
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  B.box(M.metalDark, [x, y + 1.55, z], [0.5, 0.45, 0.85], { ...deco, rotY: yaw });
  B.box(M.metal, [x, y + 1.86, z + 0.05], [0.18, 0.16, 0.5], { ...deco, rotY: yaw });
  B.rod(M.metalDark, [x + fx * 0.42, y + 1.55, z + fz * 0.42], [x + fx * 0.78, y + 1.55, z + fz * 0.78], 0.13, { segments: 10 });
  B.box(M.glowCyan, [x + fx * 0.79, y + 1.55, z + fz * 0.79], [0.2, 0.2, 0.02], { ...glow, rotY: yaw });
  B.box(M.ember, [x - fx * 0.2, y + 1.82, z - fz * 0.2], [0.08, 0.08, 0.08], { ...glow, rotY: yaw });
}

// A drum smoker (legs, a lid, a chimney, glowing vents at the bottom). Returns its chimney top.
function drumSmoker(B, M, x, y, z) {
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) B.rod(M.metalDark, [x + dx, y, z + dz], [x + dx * 0.8, y + 0.45, z + dz * 0.8], 0.03, { segments: 5 });
  B.cylinder(M.metalDark, [x, y + 0.4, z], 0.45, 1.0, { segments: 14, collide: false });
  B.cylinder(M.metal, [x, y + 1.4, z], 0.47, 0.12, { segments: 14, collide: false });
  B.cylinder(M.metal, [x, y + 1.52, z], 0.3, 0.08, { segments: 12, collide: false });
  B.cylinder(M.metalDark, [x + 0.18, y + 1.5, z], 0.07, 0.5, { segments: 8, collide: false });
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    B.box(M.ember, [x + Math.sin(a) * 0.45, y + 0.52, z + Math.cos(a) * 0.45], [0.14, 0.05, 0.03], { ...glow, rotY: a });
  }
  return { x: x + 0.18, y: y + 2.05, z };
}

// A low-poly rock (or pebble) of radius r sunk a little into the ground at (x, y, z): an
// icosahedron squashed and turned at random, flat-shaded, in the map's concrete.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
// Rocks take the dirt's tones (the concrete texture times these), darker for small pebbles,
// with their own light baked in: lit tops, darker toward the ground.
const ROCK_TINTS = [
  [0.78, 0.62, 0.5],
  [0.7, 0.58, 0.5],
  [0.85, 0.72, 0.6],
];
function rock(B, M, rand, x, y, z, r) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  _s.set(r * (0.8 + rand() * 0.5), r * (0.45 + rand() * 0.35), r * (0.8 + rand() * 0.5));
  _q.setFromEuler(_e.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5));
  g.applyMatrix4(_m.compose(_p.set(x, y + _s.y * 0.35, z), _q, _s));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 2, uv.getY(i) * r);
  // (Indexed like the boxes it merges with.)
  g.setIndex([...Array(g.attributes.position.count).keys()]);
  const t = ROCK_TINTS[Math.floor(rand() * ROCK_TINTS.length)];
  const k = r < 0.12 ? 0.75 : 1;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const lit = (0.62 + 0.38 * Math.min(1, (pos.getY(i) - y) / (r * 0.6))) * (0.85 + 0.15 * nor.getY(i)) * k;
    col[i * 3] = t[0] * lit;
    col[i * 3 + 1] = t[1] * lit;
    col[i * 3 + 2] = t[2] * lit;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  B._add(M.concrete, g, true);
}

// Rocks piled along the inside foot of a square arena's walls (half size H), pebbles scattered
// over the open ground, keeping clear of `keep` circles ([x, z, radius]) and of the boxes in
// `skip` ([x0, z0, x1, z1]).
function scatterRocks(B, M, H, { keep = [], skip = [], seed = 5 }) {
  const rand = mulberry32(seed);
  const clear = (x, z) => keep.every(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) > kr) && skip.every(([x0, z0, x1, z1]) => x < x0 || x > x1 || z < z0 || z > z1);
  for (let i = 0; i < 220; i++) {
    const side = Math.floor(rand() * 4);
    const along = (rand() * 2 - 1) * (H - 1);
    const off = H - 0.3 - rand() * rand() * 1.6;
    const [x, z] = side === 0 ? [along, -off] : side === 1 ? [along, off] : side === 2 ? [-off, along] : [off, along];
    if (!clear(x, z)) continue;
    const r = 0.12 + rand() * rand() * 0.4;
    rock(B, M, rand, x, 0, z, r);
    // Often a smaller one leaning on it.
    if (rand() < 0.5) rock(B, M, rand, x + (rand() - 0.5) * r * 2.5, 0, z + (rand() - 0.5) * r * 2.5, r * 0.5);
  }
  for (let i = 0; i < 520; i++) {
    const x = (rand() * 2 - 1) * (H - 1);
    const z = (rand() * 2 - 1) * (H - 1);
    if (!clear(x, z)) continue;
    rock(B, M, rand, x, 0, z, 0.04 + rand() * 0.07);
  }
}

// Mudlark Gauntlet: sponsor boards on the walls, TV cameras on the corners, drum smokers on the
// wall tops, cable runs along the foot of the walls, rocks and pebbles on the ground, damp and
// scorched patches baked into the floor. keep: [x, z, r] circles to leave clear of rocks
// (pickup pads, spawns); skip: [x0, z0, x1, z1] boxes (the mud pit, the Summit).
export function dressMudlark(B, M, H, wallH, { keep = [], skip = [] } = {}) {
  const vents = [];
  scatterRocks(B, M, H, { keep, skip, seed: 5 });
  // Trodden, damp and scorched patches in the floor bake.
  const rand = mulberry32(17);
  for (let i = 0; i < 14; i++) {
    const x = (rand() * 2 - 1) * (H - 4);
    const z = (rand() * 2 - 1) * (H - 4);
    const w = 0.6 + rand() * 1.6;
    B.stain([x - w, z - w * 0.6], [x + w, z + w * 0.6], 0.8 + rand(), 0.05 + rand() * 0.06);
  }
  for (const c of [-25, -15, -5, 5, 15, 25]) board(B, M, c, -H, [0, 1]);
  for (const c of [-15, -5, 5, 15]) {
    board(B, M, -H, c, [1, 0]);
    board(B, M, H, c, [-1, 0]);
  }
  const top = wallH;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) tvCamera(B, M, sx * (H + 0.5), top, sz * (H + 0.5), 0, 0);
    for (const z of [-24, 24]) vents.push(drumSmoker(B, M, sx * (H + 0.5), top, z));
  }
  // Cable runs at the foot of the east and west walls, from the corner pylons in.
  for (const sx of [-1, 1]) {
    const x = sx * (H - 0.35);
    for (const [z0, z1] of [[-H + 2, -6], [6, H - 2]]) {
      B.boxMinMax(M.metalDark, [x - 0.06, 0, z0], [x + 0.06, 0.07, z1], { ...deco, castShadow: false });
      B.boxMinMax(M.metalDark, [x + sx * 0.12 - 0.04, 0, z0 + 1], [x + sx * 0.12 + 0.04, 0.05, z1 - 1], { ...deco, castShadow: false });
    }
  }
  return vents;
}

// A string of smoked sausages hanging from a hook: a chain down from `top`, then links.
function links(B, M, x, top, z, n) {
  B.rod(M.metalDark, [x, top, z], [x, top - 0.6, z], 0.015, { segments: 4, castShadow: false });
  let y = top - 0.6;
  for (let i = 0; i < n; i++) {
    const lean = (i % 2 ? 1 : -1) * 0.1;
    B.rod(M.paint, [x + lean, y, z], [x - lean, y - 0.4, z], 0.08, { segments: 7 });
    y -= 0.44;
  }
}

// Smokestack Works: sausages hanging under the trusses, gauges on the end-wall pipes, warning
// boards on the end walls, pallet stacks in the corners (these collide: they're cover), and on
// the floor a hazard-striped keep-clear border round the smoker, forklift lane lines along the
// belts, drains, and tire scuffs baked in.
export function dressFactory(B, M, { HX, HZ, truss, crate }) {
  // (Casting shadows like the rest of their materials, so they merge into the same draws.)
  const flat = { collide: false };
  // Keep-clear border: a striped band 0.4 m wide, 0.8 m out from the smoker's sides.
  for (const [x0, z0, x1, z1] of [[-5.5, -4.5, 5.5, -4.1], [-5.5, 4.1, 5.5, 4.5], [-5.5, -4.1, -5.1, 4.1], [5.1, -4.1, 5.5, 4.1]]) {
    B.boxMinMax(M.hazard, [x0, 0, z0], [x1, 0.012, z1], flat);
  }
  // Lane lines along the inner side of each belt line, dashed.
  for (const z of [-8.4, 8.4]) {
    for (let x = -20; x < 20; x += 2) B.boxMinMax(M.paint, [x, 0, z - 0.06], [x + 1.2, 0.01, z + 0.06], flat);
  }
  // Drains.
  for (const [x, z] of [[-12, 0], [12, 0], [-24, 6], [24, -6], [0, 17], [0, -17]]) {
    B.box(M.metalDark, [x, 0.008, z], [0.8, 0.016, 0.8], flat);
    B.stain([x - 0.6, z - 0.6], [x + 0.6, z + 0.6], 0.8, 0.1);
  }
  // Tire scuffs down the aisles.
  for (const z of [-6.8, 6.8, -16.5, 16.5]) B.stain([-25, z - 0.35], [25, z + 0.35], 0.5, 0.045);

  // From the trusses' bottom chords, between the hanging lamps (z 7 and 15) and clear of the
  // jumbotron over the smoker.
  for (let x = -24; x <= 24; x += 6) {
    if (x === 0) continue;
    for (const z of [-11, -3, 3, 11]) {
      if (Math.abs(x) <= 6 && Math.abs(z) <= 3) continue;
      const n = 3 + (((x + 30) * 7 + (z + 30) * 3) % 3);
      links(B, M, x, truss, z, n);
      links(B, M, x, truss, z + 0.3, n - 1);
    }
  }
  for (const sx of [-1, 1]) {
    const px = sx * (HX - 0.4);
    // A gauge on each pipe drop, facing into the hall.
    for (const z of [-14, 8]) {
      const fx = px - sx * 0.3;
      B.box(M.metalDark, [fx, 1.6, z], [0.12, 0.42, 0.42], deco);
      B.box(M.glowOrange, [fx - sx * 0.065, 1.6, z], [0.01, 0.3, 0.3], glow);
      B.box(M.metalDark, [fx - sx * 0.072, 1.66, z + 0.04], [0.01, 0.14, 0.025], deco);
    }
    // Hazard-striped warning boards low on the end walls.
    for (const z of [-4, 4]) {
      const wx = sx * HX;
      B.boxMinMax(M.metalDark, [Math.min(wx, wx - sx * 0.08), 1.6, z - 1.3], [Math.max(wx, wx - sx * 0.08), 3.2, z + 1.3], deco);
      B.boxMinMax(M.hazard, [Math.min(wx - sx * 0.08, wx - sx * 0.1), 1.75, z - 1.15], [Math.max(wx - sx * 0.08, wx - sx * 0.1), 3.05, z + 1.15], deco);
    }
    // Pallet stacks in the corners under the catwalks' ladder ends (the stairs fill the others).
    for (const sz of [-1, 1]) {
      if (sz === sx) continue;
      const x = sx * (HX - 1.4);
      const z = sz * (HZ - 1.4);
      crate(B, M, x, 0, z, 1.4, 0.1 * sx);
      crate(B, M, x - sx * 0.1, 1.4, z + sz * 0.05, 1.1, -0.2 * sz);
      crate(B, M, x - sx * 1.5, 0, z, 1.0, 0.3);
    }
  }
  return [];
}
