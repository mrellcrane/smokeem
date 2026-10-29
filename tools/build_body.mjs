// Builds src/player/body/bodyMesh.js, the contestant body, from a CC0 model: "Futuristic 3D
// Soldier" by rickomax (https://opengameart.org/content/futuristic-3d-soldier). Credits and
// license: src/player/body/CREDITS.md.
//
// Usage: node tools/build_body.mjs <model.FBX> <diffuse.png> [--debug out.json]
// (model.FBX and diffuse.png are in soldier_1.zip on that page.)
//
// Steps:
// 1. Load the mesh and stand it 1.8 m tall on the origin, facing -z (the game's body space).
// 2. Name each face's color region from the texture (armor plates, undersuit, the yellow bands
//    become trim), plus the gloves, boot soles and helmet crest by shape. Curl the fingers into
//    a grip.
// 3. Weight every vertex to the game's bones: the nearest limb first, then smooth blends across
//    each joint, so elbows, knees, shoulders and hips bend like a person's. The helmet rides the
//    head alone and the shoulder pads the torso.
// 4. Move the rest pose onto the game's rig (src/player/character.js builds its skeleton from
//    the joints written here): the body a little shorter so the shoulders stay under the head
//    line (1.48 m), the helmet a little bigger above it, the arms longer. The arms keep the
//    model's slight A-pose; the game turns each arm segment from its own rest direction.
// 5. Recompute normals on the final shape (smooth within 50 degrees, creases kept).
// 6. Add a wraparound visor band and thin light strips fitted to the surface by rays, and the
//    smoker canister with its ember ring on the back.
// 7. Write positions, normals, the shield shell's push directions, triangles, color regions,
//    skin weights, the joints and the hands' rest frames.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const args = process.argv.slice(2);
const debugAt = args.indexOf('--debug');
const debugOut = debugAt >= 0 ? args.splice(debugAt, 2)[1] : null;
const [fbxPath, texPath] = args;
if (!fbxPath || !texPath) {
  console.error('usage: node tools/build_body.mjs <model.FBX> <diffuse.png> [--debug out.json]');
  process.exit(1);
}
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '../src/player/body/bodyMesh.js');

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// 1. Load and stand up.

function loadSource() {
  const buf = fs.readFileSync(fbxPath);
  const warn = console.warn;
  console.warn = () => {};
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  console.warn = warn;
  obj.updateMatrixWorld(true);
  let mesh = null;
  obj.traverse((o) => {
    if (o.isMesh) mesh = o;
  });
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const s = 1.8 / (bb.max.y - bb.min.y);
  g.translate(0, -bb.min.y, 0);
  g.scale(s, s, s);
  // The model faces +z; the game's bodies face -z with their right side on +x.
  g.rotateY(Math.PI);
  return g;
}

// Minimal PNG reader (8-bit RGB or RGBA, not interlaced), enough for the texture.
function readPNG(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  let w = 0;
  let h = 0;
  let bpp = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      bpp = { 2: 3, 6: 4 }[d[9]];
      if (d[8] !== 8 || !bpp || d[12] !== 0) throw new Error('png: only 8-bit RGB(A), not interlaced');
    } else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return {
    sample(u, v) {
      const x = clamp(Math.floor((u - Math.floor(u)) * w), 0, w - 1);
      const y = clamp(Math.floor((1 - (v - Math.floor(v))) * h), 0, h - 1);
      const i = (y * w + x) * bpp;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}

// The texture is flat color regions: white plates, slate undersuit, pale green-grey panels,
// yellow strips and red eye slashes (the visor band covers those).
function regionOfColor([r, g, b]) {
  if (r > 190 && g > 170 && b < 90) return 'strip';
  if (r > 200 && g < 80) return 'armor';
  if (r > 232 && g > 232 && b > 232) return 'armor';
  if (g > 185 && r > 175 && g > b + 8) return 'panel';
  if (r > 175 && g > 175) return 'armor';
  return 'suit';
}

// ---------------------------------------------------------------------------------------------
// 2. Weld, and name regions.

function weld(g) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  const ids = new Map();
  const pos = [];
  const corner = []; // per triangle corner: { v, n, uv }
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    if (!ids.has(k)) {
      ids.set(k, pos.length);
      pos.push(V(p.getX(i), p.getY(i), p.getZ(i)));
    }
    corner.push({ v: ids.get(k), n: V(n.getX(i), n.getY(i), n.getZ(i)).normalize(), uv: [uv.getX(i), uv.getY(i)] });
  }
  const tris = [];
  for (let i = 0; i < corner.length; i += 3) tris.push([corner[i], corner[i + 1], corner[i + 2]]);
  return { pos, tris };
}

// Source-space joints (the model as loaded, 1.8 m tall, right side on +x), placed by eye on
// ortho renders, then centered in the limb by refineJoint.
const SRC = {
  hips: V(0, 0.92, 0),
  spine: V(0, 1.04, 0),
  neck: V(0, 1.5, -0.01),
  shoulder: V(0.215, 1.45, 0),
  elbow: V(0.31, 1.27, 0),
  wrist: V(0.425, 0.97, 0),
  fingers: V(0.45, 0.78, 0),
  hip: V(0.11, 0.875, 0),
  knee: V(0.125, 0.49, 0),
  ankle: V(0.135, 0.13, 0),
  toe: V(0.14, 0.03, -0.17),
};

// Center a limb joint in its cross-section: the middle of the vertices within 2 cm of the
// plane through the joint across the limb.
function refineJoint(pos, j, axis, reach = 0.12) {
  const a = axis.clone().normalize();
  const min = V(9, 9, 9);
  const max = V(-9, -9, -9);
  let n = 0;
  const d = V();
  for (const p of pos) {
    d.subVectors(p, j);
    const along = d.dot(a);
    if (Math.abs(along) > 0.02) continue;
    if (d.addScaledVector(a, -along).length() > reach) continue;
    if (Math.sign(p.x) !== Math.sign(j.x)) continue;
    min.min(p);
    max.max(p);
    n++;
  }
  if (n < 4) return j.clone();
  const c = min.add(max).multiplyScalar(0.5);
  // Keep the joint's place along the limb, center it across.
  const off = c.sub(j);
  return j.clone().add(off.addScaledVector(a, -off.dot(a)));
}

function segDist(p, a, b) {
  const ab = V().subVectors(b, a);
  const t = clamp(V().subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
  return { d: p.distanceTo(a.clone().addScaledVector(ab, t)), t };
}

// ---------------------------------------------------------------------------------------------

const src = weld(loadSource());
const tex = readPNG(texPath);
console.log('source', src.pos.length, 'vertices,', src.tris.length, 'triangles');

// Refine the limb joints (right side), then mirror.
{
  const J = SRC;
  J.elbow = refineJoint(src.pos, J.elbow, V().subVectors(J.wrist, J.shoulder));
  J.wrist = refineJoint(src.pos, J.wrist, V().subVectors(J.wrist, J.elbow), 0.08);
  J.knee = refineJoint(src.pos, J.knee, V().subVectors(J.ankle, J.hip));
  J.ankle = refineJoint(src.pos, J.ankle, V().subVectors(J.ankle, J.knee), 0.09);
  for (const k of ['elbow', 'wrist', 'knee', 'ankle']) console.log('joint', k, J[k].toArray().map((x) => x.toFixed(3)).join(', '));
}
const side = (s, v) => V(v.x * s, v.y, v.z);

// Hands: the long axis (wrist to fingertips) and the palm's facing (the model hangs its hands
// palms in, thumbs forward). s: +1 right hand, -1 left.
const FORWARD = V(0, 0, -1);
function handFrame(s) {
  const w = side(s, SRC.wrist);
  const axis = V().subVectors(side(s, SRC.fingers), w).normalize();
  const palm = V().crossVectors(axis, FORWARD).normalize().multiplyScalar(-s);
  return { w, axis, palm };
}
const isHand = (p) => {
  const s = Math.sign(p.x) || 1;
  const h = handFrame(s);
  return Math.abs(p.x) > 0.3 && p.y < 1.1 && V().subVectors(p, h.w).dot(h.axis) > -0.005;
};
// Curl the fingers into a loose fist, so the hands read as gripping the gun: past the knuckles
// each point turns toward the palm, more the further out it is.
const KNUCKLE = 0.085;
const CURL = 1.5;
{
  const R = new THREE.Quaternion();
  let dMax = 0;
  const curled = new Map();
  for (let i = 0; i < src.pos.length; i++) {
    const p = src.pos[i];
    if (!isHand(p)) continue;
    const h = handFrame(Math.sign(p.x) || 1);
    const d = V().subVectors(p, h.w).dot(h.axis);
    dMax = Math.max(dMax, d);
    if (d <= KNUCKLE) continue;
    const axis = V().crossVectors(h.axis, h.palm).normalize();
    const pivot = h.w.clone().addScaledVector(h.axis, KNUCKLE).addScaledVector(h.palm, 0.012);
    R.setFromAxisAngle(axis, CURL * smooth(KNUCKLE, KNUCKLE + 0.1, d));
    p.sub(pivot).applyQuaternion(R).add(pivot);
    curled.set(i, R.clone());
  }
  for (const t of src.tris) for (const c of t) if (curled.has(c.v)) c.n.applyQuaternion(curled.get(c.v));
  console.log('hands: length', dMax.toFixed(3), 'curled', curled.size, 'points');
}

// Bones, in the order the game's skeleton lists them (character.js BODY_BONES).
const BONES = ['root', 'hips', 'spine', 'head', 'armUL', 'armLL', 'armUR', 'armLR', 'legUL', 'legLL', 'legUR', 'legLR', 'footL', 'footR', 'handL', 'handR'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));

// Each bone's segment and reach in source space, for the first pass (nearest limb).
function segments() {
  const J = SRC;
  const S = {
    hips: [V(0, 0.8, 0.0), V(0, 0.98, 0.0), 0.15],
    spine: [V(0, 1.02, 0.0), V(0, 1.42, 0.0), 0.17],
    head: [V(0, 1.55, -0.01), V(0, 1.72, 0.0), 0.12],
  };
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    S[`armU${L}`] = [side(s, J.shoulder), side(s, J.elbow), 0.075];
    S[`armL${L}`] = [side(s, J.elbow), side(s, J.fingers), 0.07];
    S[`legU${L}`] = [side(s, J.hip), side(s, J.knee), 0.1];
    S[`legL${L}`] = [side(s, J.knee), side(s, J.ankle), 0.085];
    S[`foot${L}`] = [side(s, J.ankle), side(s, J.toe), 0.07];
  }
  return S;
}

// ---------------------------------------------------------------------------------------------
// Regions per face.

const region = src.tris.map((t) => {
  // Sample the texture at the face's center and toward each corner; most votes wins.
  const votes = {};
  const cu = (t[0].uv[0] + t[1].uv[0] + t[2].uv[0]) / 3;
  const cv = (t[0].uv[1] + t[1].uv[1] + t[2].uv[1]) / 3;
  const pts = [[cu, cv], ...t.map((c) => [cu + (c.uv[0] - cu) * 0.6, cv + (c.uv[1] - cv) * 0.6])];
  for (const [u, v] of pts) {
    const r = regionOfColor(tex.sample(u, v));
    votes[r] = (votes[r] ?? 0) + (u === cu ? 1.5 : 1);
  }
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
});

const N = src.pos.length;
const nbr = Array.from({ length: N }, () => new Set());
for (const t of src.tris) {
  for (let k = 0; k < 3; k++) {
    nbr[t[k].v].add(t[(k + 1) % 3].v);
    nbr[t[k].v].add(t[(k + 2) % 3].v);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Weights.

const SEG = segments();
// The helmet: everything inside this ellipsoid above the neck rides the head bone alone.
const HELMET = { c: V(0, 1.668, -0.045), r: V(0.115, 0.165, 0.15) };
const inHelmet = (p) =>
  p.y > 1.515 && ((p.x - HELMET.c.x) / HELMET.r.x) ** 2 + ((p.y - HELMET.c.y) / HELMET.r.y) ** 2 + ((p.z - HELMET.c.z) / HELMET.r.z) ** 2 < 1;
// Shoulder pads ride the torso (as the old box pads did), so they stay on the shoulders when the
// gun comes up; the arm swings out from under them.
const armAxisDist = (p) => {
  const s = Math.sign(p.x) || 1;
  const a = side(s, SRC.shoulder);
  const d = V().subVectors(side(s, SRC.elbow), a).normalize();
  const q = V().subVectors(p, a);
  return q.addScaledVector(d, -q.dot(d)).length();
};
const isPad = (p) => p.y > 1.36 && Math.abs(p.x) > 0.165 && armAxisDist(p) > 0.085 && !inHelmet(p);

const primary = new Int32Array(N);
const pinned = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const p = src.pos[i];
  if (inHelmet(p)) {
    primary[i] = B.head;
    pinned[i] = 1;
    continue;
  }
  if (isPad(p)) {
    primary[i] = B.spine;
    pinned[i] = 1;
    continue;
  }
  let best = -1;
  let bd = 1e9;
  for (const [name, [a, b, r]] of Object.entries(SEG)) {
    const isL = name.endsWith('L');
    const isR = name.endsWith('R');
    if ((isL && p.x > 0.01) || (isR && p.x < -0.01)) continue;
    const d = segDist(p, a, b).d - r;
    if (d < bd) {
      bd = d;
      best = B[name];
    }
  }
  primary[i] = best;
}

const W = Array.from({ length: N }, (_, i) => {
  const w = new Float32Array(BONES.length);
  w[primary[i]] = 1;
  return w;
});
// Joint blends: across each joint the child bone's weight rises from 0 to 1 over [lo, hi]
// meters along the child's direction. Vertices on the parent only join in when they sit on the
// child's axis (so the chest never follows the arm).
// Joints are blended root first: a parent-side vertex past the start of the blend (and near the
// child's axis) joins in, a child-side vertex short of its end does too (so a heel first put on
// the shin still ends up on the foot).
const zone = new Float32Array(N); // how close to some joint, for smoothing
function blend(P, C, J, D, lo, hi, axisR = Infinity) {
  const d = D.clone().normalize();
  for (let i = 0; i < N; i++) {
    if (pinned[i]) continue;
    const pr = primary[i];
    if (pr !== P && pr !== C) continue;
    const q = V().subVectors(src.pos[i], J);
    const t = q.dot(d);
    if (pr === P && (t <= lo || q.addScaledVector(d, -t).length() > axisR)) continue;
    if (pr === C && t >= hi) continue;
    const w = smooth(lo, hi, t);
    W[i].fill(0);
    W[i][C] = w;
    W[i][P] = 1 - w;
    if (t > lo - 0.03 && t < hi + 0.03) zone[i] = 1;
  }
}
blend(B.hips, B.spine, V(0, 0.99, 0), V(0, 1, 0), -0.06, 0.06);
blend(B.spine, B.head, V(0, 1.505, 0), V(0, 1, 0), -0.025, 0.03, 0.09);
for (const s of [-1, 1]) {
  const L = s < 0 ? 'L' : 'R';
  const J = SRC;
  blend(B.spine, B[`armU${L}`], side(s, J.shoulder), V().subVectors(side(s, J.elbow), side(s, J.shoulder)), -0.03, 0.05, 0.09);
  blend(B[`armU${L}`], B[`armL${L}`], side(s, J.elbow), V().subVectors(side(s, J.wrist), side(s, J.elbow)), -0.035, 0.035);
  blend(B[`armL${L}`], B[`hand${L}`], side(s, J.wrist), handFrame(s).axis, -0.01, 0.02);
  blend(B.hips, B[`legU${L}`], side(s, J.hip), V().subVectors(side(s, J.knee), side(s, J.hip)), -0.05, 0.05, 0.13);
  blend(B[`legU${L}`], B[`legL${L}`], side(s, J.knee), V().subVectors(side(s, J.ankle), side(s, J.knee)), -0.04, 0.04);
  blend(B[`legL${L}`], B[`foot${L}`], side(s, J.ankle), V(0, -1, 0), -0.02, 0.03);
}
// Smooth the blends over the surface a little, so seams between neighbors with different
// first-pass bones soften too.
for (let it = 0; it < 3; it++) {
  const next = W.map((w) => w.slice());
  for (let i = 0; i < N; i++) {
    if (pinned[i] || !zone[i]) continue;
    const acc = new Float32Array(BONES.length);
    let n = 0;
    for (const j of nbr[i]) {
      for (let b = 0; b < BONES.length; b++) acc[b] += W[j][b];
      n++;
    }
    for (let b = 0; b < BONES.length; b++) next[i][b] = 0.5 * W[i][b] + (0.5 * acc[b]) / n;
  }
  for (let i = 0; i < N; i++) W[i] = next[i];
}
// Keep the four strongest, summing to 1.
const skin = W.map((w) => {
  const top = [...w].map((x, b) => [b, x]).filter(([, x]) => x > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, [, x]) => s + x, 0);
  return top.map(([b, x]) => [b, x / sum]);
});

// ---------------------------------------------------------------------------------------------
// 4. The game's rest pose. The body below the neck is scaled down a little about the feet, so
// the shoulder pads and collar end at about the head line (1.48 m); the helmet keeps its crown
// at 1.80 m. Arms keep the model's slight A-pose: the game poses each arm segment from its own
// rest direction.
// The model's arms are short for holding a rifle in both hands, so the upper arm is stretched
// along its length (more undersuit shows under the pad) and the forearm a little; the hands keep
// their size.
const K_BODY = 0.955;
const K_ARM_U = 1.25;
const K_ARM_L = 1.06;
const stretch = {};
for (const s of [-1, 1]) {
  const L = s < 0 ? 'L' : 'R';
  const S = side(s, SRC.shoulder);
  const E = side(s, SRC.elbow);
  const Wr = side(s, SRC.wrist);
  const aU = V().subVectors(E, S).normalize();
  const lU = E.distanceTo(S);
  const aL = V().subVectors(Wr, E).normalize();
  const lL = Wr.distanceTo(E);
  stretch[B[`armU${L}`]] = (v) => v.clone().addScaledVector(aU, (K_ARM_U - 1) * clamp(V().subVectors(v, S).dot(aU), 0, lU));
  stretch[B[`armL${L}`]] = (v) =>
    v
      .clone()
      .addScaledVector(aU, (K_ARM_U - 1) * lU)
      .addScaledVector(aL, (K_ARM_L - 1) * clamp(V().subVectors(v, E).dot(aL), 0, lL));
}
// The helmet grows 14% about its crown, so it sits lower on a shorter neck and reads bigger.
const K_HEAD = 1.14;
const CROWN = V(0, 1.8, -0.045);
for (const s of [-1, 1]) {
  const L = s < 0 ? 'L' : 'R';
  stretch[B[`hand${L}`]] = stretch[B[`armL${L}`]];
}
const boneToGame = (b, p) => {
  if (b === B.head) return p.clone().sub(CROWN).multiplyScalar(K_HEAD).add(CROWN);
  return (stretch[b] ? stretch[b](p) : p.clone()).multiplyScalar(K_BODY);
};
const toGame = (p, w) => {
  const out = V();
  for (const [b, x] of w) out.addScaledVector(boneToGame(b, p), x);
  return out;
};
const pos = src.pos.map((p, i) => toGame(p, skin[i]));
const J = {};
J.root = V();
J.hips = SRC.hips.clone().multiplyScalar(K_BODY);
J.spine = SRC.spine.clone().multiplyScalar(K_BODY);
J.head = boneToGame(B.head, SRC.neck);
for (const s of [-1, 1]) {
  const L = s < 0 ? 'L' : 'R';
  J[`armU${L}`] = side(s, SRC.shoulder).multiplyScalar(K_BODY);
  J[`armL${L}`] = boneToGame(B[`armU${L}`], side(s, SRC.elbow));
  J[`hand${L}`] = boneToGame(B[`armL${L}`], side(s, SRC.wrist));
  J[`legU${L}`] = side(s, SRC.hip).multiplyScalar(K_BODY);
  J[`legL${L}`] = side(s, SRC.knee).multiplyScalar(K_BODY);
  J[`foot${L}`] = side(s, SRC.ankle).multiplyScalar(K_BODY);
}

// ---------------------------------------------------------------------------------------------
// Output mesh: one vertex per (source vertex, normal, region), plus the added parts.

const REGIONS = ['armor', 'suit', 'panel', 'strip', 'glove', 'boot', 'visor', 'ember', 'metal'];
const R = Object.fromEntries(REGIONS.map((n, i) => [n, i]));
const mesh = { pos: [], nrm: [], reg: [], skin: [], idx: [] };
const vkey = new Map();
function emit(p, n, region, w, key = null) {
  if (key !== null && vkey.has(key)) return vkey.get(key);
  const i = mesh.pos.length;
  mesh.pos.push(p.clone());
  mesh.nrm.push(n.clone().normalize());
  mesh.reg.push(R[region]);
  mesh.skin.push(w);
  if (key !== null) vkey.set(key, i);
  return i;
}

// Normals, recomputed on the final shape: each corner averages the faces around its vertex that
// meet it at less than SMOOTH_ANGLE (weighted by the corner angle), so curved plates shade round
// while creases and plate edges stay sharp.
const SMOOTH_ANGLE = (50 * Math.PI) / 180;
const faceN = src.tris.map((t) => {
  const [a, b, c] = t.map((k) => pos[k.v]);
  return V().subVectors(b, a).cross(V().subVectors(c, a)).normalize();
});
const cornerW = src.tris.map((t) =>
  t.map((_, k) => {
    const p = pos[t[k].v];
    const a = V().subVectors(pos[t[(k + 1) % 3].v], p).normalize();
    const b = V().subVectors(pos[t[(k + 2) % 3].v], p).normalize();
    return Math.acos(clamp(a.dot(b), -1, 1));
  }),
);
const facesAt = Array.from({ length: N }, () => []);
src.tris.forEach((t, f) => t.forEach((c, k) => facesAt[c.v].push([f, k])));
const cosSmooth = Math.cos(SMOOTH_ANGLE);
// Around each vertex, faces that share an edge there and meet at less than the angle join one
// smoothing group; each group gets one normal.
const cornerN = src.tris.map(() => [null, null, null]);
for (let v = 0; v < N; v++) {
  const fs = facesAt[v];
  const group = fs.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const [f] = fs[i];
      const [g] = fs[j];
      const shared = src.tris[f].filter((c) => src.tris[g].some((d) => d.v === c.v)).length;
      if (shared >= 2 && faceN[f].dot(faceN[g]) > cosSmooth) group[find(i)] = find(j);
    }
  }
  const sums = new Map();
  fs.forEach(([f, k], i) => {
    const r = find(i);
    if (!sums.has(r)) sums.set(r, V());
    sums.get(r).addScaledVector(faceN[f], cornerW[f][k]);
  });
  fs.forEach(([f, k], i) => (cornerN[f][k] = sums.get(find(i)).clone().normalize()));
}

// Gloves: everything past the wrist. Soles: the bottom 3 cm of the boots.
const handT = (p) => {
  const s = Math.sign(p.x) || 1;
  const d = V().subVectors(side(s, SRC.fingers), side(s, SRC.wrist)).normalize();
  return V().subVectors(p, side(s, SRC.wrist)).dot(d);
};
for (let f = 0; f < src.tris.length; f++) {
  const t = src.tris[f];
  let reg = region[f];
  const ps = t.map((c) => src.pos[c.v]);
  const bones = t.map((c) => skin[c.v][0][0]);
  const mid = ps[0].clone().add(ps[1]).add(ps[2]).divideScalar(3);
  if (ps.every((p) => Math.abs(p.x) > 0.3 && p.y < 1.1 && handT(p) > -0.005)) reg = 'glove';
  else if (ps.every((p) => p.y < 0.03)) reg = 'boot';
  // The model's yellow bands down the torso's sides and upper arms take the trim color (a bot's
  // second color).
  else if (reg === 'strip') reg = 'panel';
  // The fin sweeping back off the helmet's crown is the crest, in trim.
  else if (bones.every((b) => b === B.head) && mid.y > 1.715 && mid.z > 0.0) reg = 'panel';
  const ids = t.map((c, k) => {
    const n = cornerN[f][k];
    const key = `${c.v}|${Math.round(n.x * 40)},${Math.round(n.y * 40)},${Math.round(n.z * 40)}|${reg}`;
    return emit(pos[c.v], n, reg, skin[c.v], key);
  });
  mesh.idx.push(...ids);
}
const bodyVerts = mesh.pos.length;

// ---------------------------------------------------------------------------------------------
// 6. Added parts.

// Rays against the model's surface (game space), for fitting the visor and the light strips;
// only triangles wholly on the given bones count.
function trisOn(bones) {
  const out = [];
  for (const t of src.tris) {
    if (t.every((c) => bones.includes(skin[c.v][0][0]) && skin[c.v][0][1] > 0.99)) out.push(t.map((c) => pos[c.v]));
  }
  return out;
}
const _ray = new THREE.Ray();
const _hit = V();
function cast(tris, o, d) {
  _ray.set(o, d);
  let best = null;
  let bt = Infinity;
  for (const [a, b, c] of tris) {
    const h = _ray.intersectTriangle(a, b, c, false, _hit);
    if (h) {
      const t = h.distanceTo(o);
      if (t < bt) {
        bt = t;
        best = h.clone();
      }
    }
  }
  if (!best) throw new Error(`ray from ${o.toArray()} along ${d.toArray()} missed`);
  return best;
}

const W_HEAD = [[B.head, 1]];
const W_SPINE = [[B.spine, 1]];

// Corners counterclockwise seen from outside; flat or given normals.
function addQuad(a, b, c, d, region, w, flat = true, normals = null) {
  const n = flat ? V().subVectors(b, a).cross(V().subVectors(d, a)).normalize() : null;
  const ids = [a, b, c, d].map((p, k) => emit(p, normals ? normals[k] : n, region, w));
  mesh.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
}

// A band laid over the surface. grid[i] = [edge0, edge1], each { h: a surface point, out: the
// outward direction there }. The band stands `lift` proud of the surface and its sides and ends
// run `sink` into it; the face inside the body is left out (nothing ever sees it, and the body
// around it closes the shape for the shadow pass).
function band(grid, region, w, lift, sink) {
  const n = grid.length;
  const P = (i, e, off) => grid[i][e].h.clone().addScaledVector(grid[i][e].out, off);
  const outN = grid.map((c, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const along = V().subVectors(P(b, 0, 0).add(P(b, 1, 0)), P(a, 0, 0).add(P(a, 1, 0)));
    const nn = along.cross(V().subVectors(P(i, 1, 0), P(i, 0, 0))).normalize();
    return nn.dot(V().addVectors(c[0].out, c[1].out)) < 0 ? nn.negate() : nn;
  });
  const across = grid.map((c, i) => V().subVectors(P(i, 1, 0), P(i, 0, 0)).normalize());
  // Triangles wound to face along `out`.
  const tri = (a, b, c, out) => {
    const fn = V().subVectors(mesh.pos[b], mesh.pos[a]).cross(V().subVectors(mesh.pos[c], mesh.pos[a]));
    mesh.idx.push(...(fn.dot(out) < 0 ? [a, c, b] : [a, b, c]));
  };
  const strip = (e0, o0, e1, o1, normal, out) => {
    const A = grid.map((_, i) => emit(P(i, e0, o0), normal(i), region, w));
    const Bv = grid.map((_, i) => emit(P(i, e1, o1), normal(i), region, w));
    for (let i = 0; i < n - 1; i++) {
      tri(A[i], Bv[i], Bv[i + 1], out(i));
      tri(A[i], Bv[i + 1], A[i + 1], out(i));
    }
  };
  strip(0, lift, 1, lift, (i) => outN[i], (i) => outN[i]);
  strip(1, lift, 1, -sink, (i) => across[i], (i) => across[i]);
  strip(0, lift, 0, -sink, (i) => across[i].clone().negate(), (i) => across[i].clone().negate());
  for (const [i, j] of [[0, 1], [n - 1, n - 2]]) {
    const dir = V().subVectors(P(i, 0, 0).add(P(i, 1, 0)), P(j, 0, 0).add(P(j, 1, 0))).normalize();
    addQuad(P(i, 0, -sink), P(i, 1, -sink), P(i, 1, lift), P(i, 0, lift), region, w);
    // (addQuad winds by its corner order; fix it up to face along dir.)
    const k = mesh.idx.length - 6;
    const [a, b, c] = mesh.idx.slice(k, k + 3);
    const fn = V().subVectors(mesh.pos[b], mesh.pos[a]).cross(V().subVectors(mesh.pos[c], mesh.pos[a]));
    if (fn.dot(dir) < 0) {
      for (const q of [k, k + 3]) [mesh.idx[q + 1], mesh.idx[q + 2]] = [mesh.idx[q + 2], mesh.idx[q + 1]];
      for (let v = mesh.pos.length - 4; v < mesh.pos.length; v++) mesh.nrm[v].negate();
    }
  }
}

// The visor: a band around the front of the helmet at eye height, cast out from inside the
// head. The bottom edge dips a little in the middle.
function buildVisor() {
  const tris = trisOn([B.head]);
  const cols = 17;
  const span = (84 * Math.PI) / 180;
  const c = boneToGame(B.head, HELMET.c);
  const grid = [];
  for (let i = 0; i < cols; i++) {
    const u = (i / (cols - 1)) * 2 - 1;
    const th = u * span;
    const d = V(Math.sin(th), 0, -Math.cos(th));
    const au = Math.abs(u);
    const yTop = 1.682 - 0.012 * au * au;
    const yBot = 1.608 + 0.03 * au ** 1.4;
    grid.push([yBot, yTop].map((y) => ({ h: cast(tris, V(0, y, c.z + 0.01), d), out: d })));
  }
  band(grid, 'visor', W_HEAD, 0.008, 0.02);
}

// Thin light strips in the body's own color: two down the chest plate and one along the outside
// of each shoulder pad, cast in from outside.
function buildStrips() {
  const tris = trisOn([B.spine]);
  const half = 0.007;
  for (const s of [-1, 1]) {
    const chest = [];
    for (let k = 0; k <= 4; k++) {
      const y = 1.255 + k * 0.03;
      const out = V(0, 0, -1);
      chest.push([-half, half].map((dx) => ({ h: cast(tris, V(0.105 * s + dx, y, -1), V(0, 0, 1)), out })));
    }
    band(chest, 'strip', W_SPINE, 0.003, 0.012);
    const pad = [];
    for (let k = 0; k <= 3; k++) {
      const z = -0.05 + k * 0.055;
      const out = V(s, 0, 0);
      pad.push([-half, half].map((dy) => ({ h: cast(tris, V(s, 1.44 + dy, z), V(-s, 0, 0)), out })));
    }
    band(pad, 'strip', W_SPINE, 0.003, 0.012);
  }
}

// A cylinder along y (closed: side, top and bottom caps), as a three geometry merged in.
function addCylinder(center, r, h, region, w, segs = 12, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, segs, 1, false);
  g.translate(center.x, center.y, center.z);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const base = mesh.pos.length;
  for (let i = 0; i < p.count; i++) emit(V(p.getX(i), p.getY(i), p.getZ(i)), V(n.getX(i), n.getY(i), n.getZ(i)), region, w);
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i++) mesh.idx.push(base + ix[i]);
}

// The back plate's surface at the middle of the back (game space), by a ray from behind.
function backZ(y) {
  _ray.set(V(0, y, 1), V(0, 0, -1));
  let best = -Infinity;
  for (const t of src.tris) {
    const a = pos[t[0].v];
    const b = pos[t[1].v];
    const c = pos[t[2].v];
    const h = _ray.intersectTriangle(a, b, c, false, _hit);
    if (h && h.z > best) best = h.z;
  }
  return best;
}

buildVisor();
buildStrips();
// The smoker canister on the back, with its glowing ember ring and a metal cap.
{
  const zb = backZ(1.22);
  const r = 0.068;
  const c = V(0, 1.2, zb + r - 0.025);
  addCylinder(c, r, 0.3, 'suit', W_SPINE, 12);
  addCylinder(V(c.x, 1.085, c.z), r + 0.007, 0.03, 'ember', W_SPINE, 12);
  addCylinder(V(c.x, 1.36, c.z), r * 0.8, 0.025, 'metal', W_SPINE, 12, r * 0.65);
  console.log('canister at z', c.z.toFixed(3), 'back plate at', zb.toFixed(3));
}

// ---------------------------------------------------------------------------------------------
// Shield shell directions: the average normal of every vertex at the same place, so the
// inflated copy has no cracks along hard edges.
const shellN = (() => {
  const groups = new Map();
  const key = (p) => `${Math.round(p.x * 2000)},${Math.round(p.y * 2000)},${Math.round(p.z * 2000)}`;
  mesh.pos.forEach((p, i) => {
    const k = key(p);
    if (!groups.has(k)) groups.set(k, V());
    groups.get(k).add(mesh.nrm[i]);
  });
  return mesh.pos.map((p) => groups.get(key(p)).clone().normalize());
})();

// ---------------------------------------------------------------------------------------------
// 7. Write.

const n = mesh.pos.length;
const P16 = new Int16Array(n * 3);
const N8 = new Int8Array(n * 3);
const S8 = new Int8Array(n * 3);
const REG = new Uint8Array(n);
const SI = new Uint8Array(n * 4);
const SW = new Uint8Array(n * 4);
for (let i = 0; i < n; i++) {
  const p = mesh.pos[i];
  P16.set([Math.round(p.x * 8192), Math.round(p.y * 8192), Math.round(p.z * 8192)], i * 3);
  const q = mesh.nrm[i];
  N8.set([Math.round(q.x * 127), Math.round(q.y * 127), Math.round(q.z * 127)], i * 3);
  const s = shellN[i];
  S8.set([Math.round(s.x * 127), Math.round(s.y * 127), Math.round(s.z * 127)], i * 3);
  REG[i] = mesh.reg[i];
  const w = mesh.skin[i];
  let left = 255;
  w.forEach(([b, x], k) => {
    SI[i * 4 + k] = b;
    const q8 = k === w.length - 1 ? left : Math.round(x * 255);
    SW[i * 4 + k] = q8;
    left -= q8;
  });
}
const I16 = new Uint16Array(mesh.idx);
const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const round = (v) => v.toArray().map((x) => +x.toFixed(4));
const joints = Object.fromEntries(Object.entries(J).map(([k, v]) => [k, round(v)]));
const hands = Object.fromEntries(
  [-1, 1].map((s) => {
    const h = handFrame(s);
    return [s < 0 ? 'L' : 'R', { axis: round(h.axis), palm: round(h.palm) }];
  }),
);
const file = `// Generated by tools/build_body.mjs from "Futuristic 3D Soldier" by rickomax (CC0, see
// CREDITS.md next to this file). Do not edit by hand: change the tool and run it again.
// Body space, meters: feet at the origin, facing -z, right side on +x.
// ${n} vertices (${bodyVerts} from the model), ${I16.length / 3} triangles.

// Bone positions at rest (character.js builds its skeleton from these); the hands' bones sit at
// the wrists.
export const JOINTS = ${JSON.stringify(joints)};

// Each hand at rest: its long axis (wrist to knuckles) and the way its palm faces.
export const HANDS = ${JSON.stringify(hands)};

// Bone order of skinIndex.
export const BONES = ${JSON.stringify(BONES)};

// Color region of each vertex, an index into this list.
export const REGIONS = ${JSON.stringify(REGIONS)};

// Little-endian base64: position Int16 x3 (1/8192 m), normal and shell (the shield shell's
// push direction) Int8 x3 (1/127), region Uint8, skinIndex Uint8 x4, skinWeight Uint8 x4
// (sum 255), index Uint16.
export const DATA = {
  count: ${n},
  position: '${b64(P16)}',
  normal: '${b64(N8)}',
  shell: '${b64(S8)}',
  region: '${b64(REG)}',
  skinIndex: '${b64(SI)}',
  skinWeight: '${b64(SW)}',
  index: '${b64(I16)}',
};
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, file);
console.log(`wrote ${OUT}: ${n} vertices (${bodyVerts} from the model), ${I16.length / 3} triangles, ${(file.length / 1024).toFixed(1)} KB`);
for (const [k, v] of Object.entries(joints)) console.log('  ', k.padEnd(6), v.join(', '));

if (debugOut) {
  const counts = {};
  for (const r of mesh.reg) counts[REGIONS[r]] = (counts[REGIONS[r]] ?? 0) + 1;
  console.log('regions', JSON.stringify(counts));
  fs.writeFileSync(
    debugOut,
    JSON.stringify({
      pos: mesh.pos.flatMap((p) => round(p)),
      tri: mesh.idx,
      primary: mesh.skin.map((w) => w[0][0]),
      weights: mesh.skin.flatMap((w) => {
        const a = [0, 0, 0, 0, 0, 0, 0, 0];
        w.forEach(([b, x], k) => {
          a[k] = b;
          a[4 + k] = x;
        });
        return a;
      }),
      region: Array.from({ length: mesh.idx.length / 3 }, (_, f) => REGIONS[mesh.reg[mesh.idx[f * 3]]]),
      bones: BONES,
      joints: Object.fromEntries(Object.entries(J).map(([k, v]) => [k, v.toArray()])),
    }),
  );
  console.log('debug written', debugOut);
}

