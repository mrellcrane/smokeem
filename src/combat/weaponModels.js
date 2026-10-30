import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared helpers and colors for the guns (each gun's parts live in its module under
// src/combat/guns/). Gun space: barrel along -z, origin at the grip, meters.
// Each part: [center, size, color, options?]. A null color means "the owner's armor color".
// Options (all optional):
//   shape: 'box' (default) or 'cyl' (an elliptic cylinder whose diameters and length are `size`).
//   axis: the cylinder's long axis, 'x', 'y' or 'z' (default 'z', along the barrel).
//   taper: the cross section's scale at the far end (-z for a box, the -axis end for a
//     cylinder), a number or [x, y]: muzzle brakes, stocks, grips.
//   rot: [x, y, z] radians about the part's center (XYZ order), applied after the taper.
//   bevel: chamfer width in meters (default: about a sixth of the smallest side, at most 6 mm;
//     0 for none). Chamfers catch the light as worn, lighter edges.
//   bore: a dark disk this fraction of the radius in the cylinder's far cap (barrels).
//   seg: a cylinder's sides at high detail (default from its size).
//   finish: 'metal', 'wood', 'paint', 'matte' or 'glow' (default from the color; see FINISH).
// Detail 'hi' (first person, pickups, pictures) has chamfers and round cylinders; 'lo' (the
// third-person guns baked into every body) is plain boxes and six-sided cylinders.

export const METAL = 0x464c53;
export const METAL_LIGHT = 0x666e77;
export const WOOD = 0x8a5a33;
export const WOOD_DARK = 0x6e4526;
export const GLOW = 0xffa040;
export const OLIVE = 0x5e6b48;
export const ORANGE = 0xff7a1a;
export const SHELL_RED = 0xb02a20;
export const SCREEN = 0x63f2ff;
export const GLOVE = 0x24272c;
export const RUBBER = 0x2c2e31;
export const BRASS = 0xb08a3e;
export const BORE = 0x0c0c0e;

// How each surface takes light in first person (the viewmodel material's aFinish attribute):
// matte cloth and rubber, wood with grain, painted or plastic, bare metal, self-lit glow.
export const FINISHES = { matte: 0, wood: 1, paint: 2, metal: 3, glow: 4 };
const FINISH = {
  [METAL]: 'metal',
  [METAL_LIGHT]: 'metal',
  [BRASS]: 'metal',
  [BORE]: 'metal',
  [WOOD]: 'wood',
  [WOOD_DARK]: 'wood',
  [GLOVE]: 'matte',
  [RUBBER]: 'matte',
  [GLOW]: 'glow',
  [SCREEN]: 'glow',
};
export function finishOf(color, opts) {
  return FINISHES[opts?.finish ?? FINISH[color] ?? 'paint'];
}

// Vertex tags: a plain face, a chamfer (lighter, worn) or the bore (dark).
const FACE = 0;
const EDGE = 1;
const HOLE = 2;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();

// A flat-shaded triangle soup: positions, normals and a tag per vertex.
class Soup {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.tag = [];
  }

  // A convex polygon (points as [x, y, z]) with its normal facing away from `inside`.
  poly(pts, tag, inside = [0, 0, 0]) {
    _a.set(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
    _b.set(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-14 && pts.length > 3) {
      _b.set(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]);
      _n.crossVectors(_a, _b);
    }
    if (_n.lengthSq() < 1e-14) return;
    _n.normalize();
    _c.set(0, 0, 0);
    for (const p of pts) _c.x += p[0], _c.y += p[1], _c.z += p[2];
    _c.multiplyScalar(1 / pts.length).sub(_a.fromArray(inside));
    const flip = _n.dot(_c) < 0;
    if (flip) _n.negate();
    for (let i = 1; i + 1 < pts.length; i++) {
      const tri = flip ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]];
      for (const p of tri) {
        this.pos.push(p[0], p[1], p[2]);
        this.nrm.push(_n.x, _n.y, _n.z);
        this.tag.push(tag);
      }
    }
  }

  // A triangle with its own vertex normals (smooth cylinder sides).
  smooth(pts, nrms, tag) {
    for (let i = 0; i < 3; i++) {
      this.pos.push(...pts[i]);
      this.nrm.push(...nrms[i]);
      this.tag.push(tag);
    }
  }
}

function taperOf(t) {
  if (t === undefined || t === null) return null;
  return Array.isArray(t) ? t : [t, t];
}

// A box (half sizes hx, hy, hz) with its edges chamfered by b, into the soup.
function chamferBox(soup, hx, hy, hz, b, taper) {
  b = Math.min(b, hx * 0.45, hy * 0.45, hz * 0.45);
  const tp = taperOf(taper);
  // The far end (-z) is scaled by the taper, the near end (+z) is not.
  const at = (x, y, z) => {
    if (!tp) return [x, y, z];
    const t = (hz - z) / (2 * hz);
    return [x * (1 + (tp[0] - 1) * t), y * (1 + (tp[1] - 1) * t), z];
  };
  if (b <= 1e-4) {
    for (const s of [-1, 1]) {
      soup.poly([at(s * hx, -hy, -hz), at(s * hx, hy, -hz), at(s * hx, hy, hz), at(s * hx, -hy, hz)], FACE);
      soup.poly([at(-hx, s * hy, -hz), at(hx, s * hy, -hz), at(hx, s * hy, hz), at(-hx, s * hy, hz)], FACE);
      soup.poly([at(-hx, -hy, s * hz), at(hx, -hy, s * hz), at(hx, hy, s * hz), at(-hx, hy, s * hz)], FACE);
    }
    return;
  }
  // Per corner (sx, sy, sz): the point on its x face, its y face and its z face.
  const X = (sx, sy, sz) => at(sx * hx, sy * (hy - b), sz * (hz - b));
  const Y = (sx, sy, sz) => at(sx * (hx - b), sy * hy, sz * (hz - b));
  const Z = (sx, sy, sz) => at(sx * (hx - b), sy * (hy - b), sz * hz);
  const S = [-1, 1];
  for (const s of S) {
    soup.poly([X(s, -1, -1), X(s, 1, -1), X(s, 1, 1), X(s, -1, 1)], FACE);
    soup.poly([Y(-1, s, -1), Y(1, s, -1), Y(1, s, 1), Y(-1, s, 1)], FACE);
    soup.poly([Z(-1, -1, s), Z(1, -1, s), Z(1, 1, s), Z(-1, 1, s)], FACE);
  }
  for (const s of S) {
    for (const t of S) {
      // Edges along z, along y and along x.
      soup.poly([X(s, t, -1), X(s, t, 1), Y(s, t, 1), Y(s, t, -1)], EDGE);
      soup.poly([X(s, -1, t), X(s, 1, t), Z(s, 1, t), Z(s, -1, t)], EDGE);
      soup.poly([Y(-1, s, t), Y(1, s, t), Z(1, s, t), Z(-1, s, t)], EDGE);
    }
  }
  for (const sx of S) for (const sy of S) for (const sz of S) soup.poly([X(sx, sy, sz), Y(sx, sy, sz), Z(sx, sy, sz)], EDGE);
}

// A cylinder along z (radii rx, ry, half length hz) with chamfered caps, into the soup.
function cylinder(soup, rx, ry, hz, b, seg, taper, bore) {
  const tp = taperOf(taper) ?? [1, 1];
  b = Math.min(b, Math.min(rx, ry) * 0.4, hz * 0.45);
  const ring = (z, inset, scale) => {
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push([Math.cos(a) * (rx * scale[0] - inset), Math.sin(a) * (ry * scale[1] - inset), z]);
    }
    return pts;
  };
  const far = tp;
  const near = [1, 1];
  // Sides, smooth: from just inside the near cap to just inside the far one.
  const zn = hz - b;
  const zf = -hz + b;
  const sn = near;
  const sf = [1 + (far[0] - 1) * ((hz - zf) / (2 * hz)), 1 + (far[1] - 1) * ((hz - zf) / (2 * hz))];
  const sn2 = [1 + (far[0] - 1) * ((hz - zn) / (2 * hz)), 1 + (far[1] - 1) * ((hz - zn) / (2 * hz))];
  const A = ring(zn, 0, sn2);
  const B = ring(zf, 0, sf);
  // Side normals lean toward the near end as the far end narrows.
  const lean = ((rx + ry) / 2) * (1 - (far[0] + far[1]) / 2) / (2 * hz - 2 * b || 1);
  const nrm = (i) => {
    const a = (i / seg) * Math.PI * 2;
    const v = new THREE.Vector3(Math.cos(a) / rx, Math.sin(a) / ry, lean).normalize();
    return [v.x, v.y, v.z];
  };
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    soup.smooth([A[i], B[i], B[j]], [nrm(i), nrm(i), nrm(j)], FACE);
    soup.smooth([A[i], B[j], A[j]], [nrm(i), nrm(j), nrm(j)], FACE);
  }
  // Caps: a chamfer ring, then the flat face (the far one with its bore).
  for (const [z, edge, s, sign] of [[hz, A, sn, 1], [-hz, B, far, -1]]) {
    const inner = ring(z, b, s);
    const inside = [0, 0, z - sign * b * 2];
    if (b > 1e-4) {
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        soup.poly([edge[i], edge[j], inner[j], inner[i]], EDGE, inside);
      }
    }
    const cap = b > 1e-4 ? inner : edge.map((p) => [p[0], p[1], z]);
    if (sign < 0 && bore) {
      const hole = cap.map((p) => [p[0] * bore, p[1] * bore, z]);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        soup.poly([cap[i], cap[j], hole[j], hole[i]], FACE, inside);
      }
      soup.poly(hole.map((p) => [p[0], p[1], z + 0.0005]), HOLE, inside);
    } else {
      soup.poly(cap, FACE, inside);
    }
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

// Whether a part is worth drawing at low detail: slots, serrations, triggers and other small
// or paper-thin bits can't be seen on someone across the arena.
export function showsAtLow(size) {
  return Math.max(size[0], size[1], size[2]) >= 0.035 && Math.min(size[0], size[1], size[2]) > 0.004;
}

// One part's surface as { pos, nrm, tag } arrays, centered at its center and turned.
export function partShape(size, opts = {}, detail = 'hi') {
  const soup = new Soup();
  const hi = detail === 'hi';
  if (opts.shape === 'cyl') {
    const axis = opts.axis ?? 'z';
    // Diameters across, length along: in the cylinder's own frame (long axis z).
    const [dx, dy, len] = axis === 'z' ? size : axis === 'x' ? [size[2], size[1], size[0]] : [size[0], size[2], size[1]];
    const r = Math.max(dx, dy) / 2;
    const seg = hi ? (opts.seg ?? Math.max(8, Math.min(24, Math.round((r * Math.PI * 2) / 0.012)))) : r > 0.03 ? 8 : r > 0.012 ? 6 : 4;
    const b = hi ? (opts.bevel ?? Math.min(0.004, Math.min(dx, dy) * 0.12)) : 0;
    cylinder(soup, dx / 2, dy / 2, len / 2, b, seg, opts.taper, hi ? opts.bore : 0);
    // Turn the cylinder's z onto its axis.
    if (axis !== 'z') {
      const m = axis === 'x' ? new THREE.Matrix4().makeRotationY(-Math.PI / 2) : new THREE.Matrix4().makeRotationX(Math.PI / 2);
      transform(soup, m);
    }
  } else {
    const min = Math.min(size[0], size[1], size[2]);
    const b = hi ? (opts.bevel ?? (min < 0.012 ? 0 : Math.min(0.006, min * 0.16))) : 0;
    chamferBox(soup, size[0] / 2, size[1] / 2, size[2] / 2, b, opts.taper);
  }
  if (opts.rot) {
    _q.setFromEuler(_e.set(opts.rot[0], opts.rot[1], opts.rot[2]));
    transform(soup, _m.compose(_v.set(0, 0, 0), _q, _one));
  }
  return soup;
}

function transform(soup, m) {
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < soup.pos.length; i += 3) {
    _v.fromArray(soup.pos, i).applyMatrix4(m).toArray(soup.pos, i);
    _v.fromArray(soup.nrm, i).applyMatrix3(nm).normalize().toArray(soup.nrm, i);
  }
}

// A part as a BufferGeometry (indexed, so it merges with indexed meshes): position and normal,
// centered at `center` (scaled), plus `tags` (a plain array) for whoever paints it.
export function partGeometry(center, size, opts, detail = 'hi', { offset = [0, 0, 0], scale = 1, inflate = 0 } = {}) {
  const s = [size[0] * scale + inflate, size[1] * scale + inflate, size[2] * scale + inflate];
  const soup = partShape(s, opts ?? {}, detail);
  const n = soup.pos.length / 3;
  const pos = new Float32Array(soup.pos);
  for (let i = 0; i < n; i++) {
    pos[i * 3] += offset[0] + center[0] * scale;
    pos[i * 3 + 1] += offset[1] + center[1] * scale;
    pos[i * 3 + 2] += offset[2] + center[2] * scale;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(soup.nrm), 3));
  // Low detail has only plain faces: share the corners a face's triangles have in common.
  if (detail !== 'hi') {
    const shared = mergeVertices(g);
    g.dispose();
    shared.userData.tags = new Array(shared.attributes.position.count).fill(FACE);
    return shared;
  }
  const index = new (n > 65535 ? Uint32Array : Uint16Array)(n);
  for (let i = 0; i < n; i++) index[i] = i;
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.userData.tags = soup.tag;
  return g;
}

// The color a part's vertex is painted: chamfers lighter (worn metal shines more than paint or
// wood), the bore near black.
const _col = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
export function tagColor(out, base, tag, finish) {
  out.copy(base);
  if (tag === EDGE) {
    if (finish === FINISHES.metal) out.lerp(_white, 0.18).multiplyScalar(1.15);
    else if (finish !== FINISHES.glow) out.lerp(_white, 0.06).multiplyScalar(1.08);
  } else if (tag === HOLE) {
    out.multiplyScalar(0.12);
  }
  return out;
}

// Merge parts into one vertex-colored geometry, with each vertex's finish (aFinish) for the
// first-person material. `extra` adds skinning or other attributes per vertex:
// extra(geometry, vertexCount).
export function partsGeometry(parts, armorColor, { offset = [0, 0, 0], scale = 1, inflate = 0, extra = null, detail = 'hi' } = {}) {
  const geoms = [];
  const base = new THREE.Color();
  for (const [center, size, color, opts] of parts) {
    const g = partGeometry(center, size, opts, detail, { offset, scale, inflate });
    base.set(color ?? armorColor);
    const finish = finishOf(color, opts);
    const tags = g.userData.tags;
    const n = tags.length;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) tagColor(_col, base, tags[i], finish).toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aFinish', new THREE.BufferAttribute(new Float32Array(n).fill(finish), 1));
    if (extra) extra(g, n);
    geoms.push(g);
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

// Charcoal briquette grenade: a squat rounded-ish block with glowing seams.
export function briquetteGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.16, 0.09, 0.16], 0x2a2420],
      [[0, 0, 0], [0.13, 0.11, 0.13], 0x2f2925],
      [[0, 0.0, 0.081], [0.1, 0.012, 0.002], 0xff6a1a],
      [[0.081, 0.0, 0], [0.002, 0.012, 0.1], 0xff6a1a],
    ],
    0x2a2420,
  );
}

// Chimney coal: a smaller briquette with brighter seams.
export function coalGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.11, 0.07, 0.11], 0x2a2420],
      [[0, 0, 0.056], [0.08, 0.012, 0.002], 0xffa040],
      [[0.056, 0, 0], [0.002, 0.012, 0.08], 0xffa040],
      [[0, 0.036, 0], [0.06, 0.002, 0.06], 0xff7a1a],
    ],
    0x2a2420,
  );
}

// A sticky bomb: a dark ball (a box with its corners capped) studded with grip spikes and a
// red glow band, TF2 style.
export function stickyGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.1, 0.1, 0.1], 0x2b2d31],
      [[0, 0, 0], [0.12, 0.06, 0.06], 0x2b2d31],
      [[0, 0, 0], [0.06, 0.12, 0.06], 0x2b2d31],
      [[0, 0, 0], [0.06, 0.06, 0.12], 0x2b2d31],
      [[0, 0, 0], [0.104, 0.018, 0.104], 0xff3a24],
      [[0, 0.07, 0], [0.02, 0.03, 0.02], 0x8a9099],
      [[0, -0.07, 0], [0.02, 0.03, 0.02], 0x8a9099],
    ],
    0x2b2d31,
  );
}

// Smoke Signal rocket: fat body, nose, four fins. Points along -z.
export function missileGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.11, 0.11, 0.46], 0xd8d2c4],
      [[0, 0, -0.27], [0.08, 0.08, 0.08], ORANGE],
      [[0, 0, -0.32], [0.045, 0.045, 0.04], ORANGE],
      [[0, 0.09, 0.18], [0.012, 0.08, 0.12], METAL],
      [[0, -0.09, 0.18], [0.012, 0.08, 0.12], METAL],
      [[0.09, 0, 0.18], [0.08, 0.012, 0.12], METAL],
      [[-0.09, 0, 0.18], [0.08, 0.012, 0.12], METAL],
      [[0, 0, -0.05], [0.115, 0.115, 0.04], ORANGE],
    ],
    0xd8d2c4,
  );
}

// Swarm Jar jar in flight: pale amber glass, a dark lid and bugs inside.
export const JAR_AMBER = 0xd9b45a;
export function jarGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.12, 0.13, 0.12], JAR_AMBER],
      [[0, 0.078, 0], [0.1, 0.026, 0.1], WOOD_DARK],
      [[0.02, -0.01, 0.061], [0.018, 0.018, 0.002], 0x2a1c10],
      [[-0.025, 0.025, 0.061], [0.018, 0.018, 0.002], 0x2a1c10],
    ],
    JAR_AMBER,
  );
}

// One bug: a small dark body with orange-tinted wings (big enough to read across a fight).
export function bugGeometry() {
  return partsGeometry(
    [
      [[0, 0, 0], [0.05, 0.04, 0.07], 0x22180f],
      [[0, 0.022, 0], [0.12, 0.006, 0.04], 0xa86a2a],
    ],
    0x2a1e14,
  );
}
