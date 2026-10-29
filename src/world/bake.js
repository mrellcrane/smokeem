import * as THREE from 'three';
import { mulberry32 } from '../util/rng.js';

// Baked arena light, early-2000s lightmap style. From the solids and glow sources StaticBuilder
// recorded it rasterizes, on a grid over the arena:
// - soft contact shadows on the floor around everything that stands on it, and darker floor
//   under decks and catwalks,
// - gentle large-scale tone variation (so the floor tiling doesn't show) plus damp and soot
//   stains the map asks for,
// - colored light pools under glowing strips and fires.
// It all goes into one small RGBA texture that the ground and mud materials read (RGB is glow / 2,
// A is light * tone / 1.25). It's computed once per map and size: later matches reuse it.
// The arrays stay around for the per-vertex shading of static geometry (StaticBuilder.build).

// Contact shadow: blur radii (meters) of the height field, and the darkest the floor gets.
const NEAR_R = 0.5;
const FAR_R = 2;
const MIN_LIGHT = 0.55;
// A solid stands on the floor if its bottom is within this of it, and overhangs it (deck,
// catwalk) if its bottom is more than OVERHANG above it.
const STANDING = 0.3;
const OVERHANG = 1.5;
// Large-scale tone variation, +-.
const MACRO = 0.07;
// Index cell size for floorBelow, meters.
const CELL = 4;

const cache = new Map();

// B: the StaticBuilder with everything added (before build()). half: the grid covers x and z in
// [-half, half]. size: texels per side.
export function bakeArena(B, { id, half = 32, size = 512, seed = 1 }) {
  const key = `${id}:${size}`;
  let bake = cache.get(key);
  if (!bake) {
    const t0 = performance.now();
    bake = new ArenaBake(B, half, size, seed);
    bake.ms = Math.round(performance.now() - t0);
    cache.set(key, bake);
  }
  return bake;
}

const _col = new THREE.Color();
const _hit = { lo: 0, hi: 0 };

class ArenaBake {
  constructor(B, half, N, seed) {
    this.half = half;
    this.N = N;
    this.cell = (half * 2) / N;
    this.solids = B.solids.map(prepSolid);
    this.index = this.buildIndex();
    const n = N * N;
    // G: floor height. S: top of whatever stands on the floor (G where nothing does).
    // O: 1 where something overhangs the floor.
    this.G = new Float32Array(n);
    this.S = new Float32Array(n);
    this.O = new Float32Array(n);
    this.raster();
    // Contact light (1 open floor, down to MIN_LIGHT) and the tone/stain multiplier.
    this.light = new Float32Array(n);
    this.tone = new Float32Array(n).fill(1);
    this.glow = new Float32Array(n * 3);
    this.contact();
    this.macro(seed, B.stains);
    this.glowPools(B.lights);
    this.texture = this.pack();
    this.rect = new THREE.Vector3(-half, -half, 1 / (half * 2));
  }

  // Texel index of a world point, or -1 outside the grid.
  texel(x, z) {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return -1;
    return j * this.N + i;
  }

  // Floor contact light at a world point (1 outside the grid).
  lightAt(x, z) {
    const t = this.texel(x, z);
    return t < 0 ? 1 : this.light[t];
  }

  // Height of the highest solid top at or below y under (x, z); y itself when the point is
  // inside a solid; -Infinity over nothing.
  floorBelow(x, y, z) {
    const list = this.index.get(this.cellKey(x, z));
    if (!list) return -Infinity;
    let best = -Infinity;
    for (const s of list) {
      if (!columnHit(s, x, z, _hit)) continue;
      if (_hit.hi <= y + 1e-3) best = Math.max(best, _hit.hi);
      else if (_hit.lo < y) return y;
    }
    return best;
  }

  cellKey(x, z) {
    return Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
  }

  buildIndex() {
    const index = new Map();
    for (const s of this.solids) {
      for (let cx = Math.floor(s.minX / CELL); cx <= Math.floor(s.maxX / CELL); cx++) {
        for (let cz = Math.floor(s.minZ / CELL); cz <= Math.floor(s.maxZ / CELL); cz++) {
          const k = cx * 4096 + cz;
          let list = index.get(k);
          if (!list) index.set(k, (list = []));
          list.push(s);
        }
      }
    }
    return index;
  }

  // Calls fn(t, x, z) for every texel whose center lies in the given world rectangle.
  forTexels(minX, maxX, minZ, maxZ, fn) {
    const { N, cell, half } = this;
    const i0 = Math.max(0, Math.ceil((minX + half) / cell - 0.5));
    const i1 = Math.min(N - 1, Math.floor((maxX + half) / cell - 0.5));
    const j0 = Math.max(0, Math.ceil((minZ + half) / cell - 0.5));
    const j1 = Math.min(N - 1, Math.floor((maxZ + half) / cell - 0.5));
    for (let j = j0; j <= j1; j++) {
      const z = (j + 0.5) * cell - half;
      for (let i = i0; i <= i1; i++) fn(j * N + i, (i + 0.5) * cell - half, z);
    }
  }

  raster() {
    const { G, S, O } = this;
    G.fill(-Infinity);
    for (const s of this.solids) {
      if (!s.floor) continue;
      this.forTexels(s.minX, s.maxX, s.minZ, s.maxZ, (t, x, z) => {
        if (columnHit(s, x, z, _hit)) G[t] = Math.max(G[t], _hit.hi);
      });
    }
    for (let t = 0; t < G.length; t++) {
      if (G[t] === -Infinity) G[t] = 0;
      S[t] = G[t];
    }
    for (const s of this.solids) {
      if (s.floor) continue;
      this.forTexels(s.minX, s.maxX, s.minZ, s.maxZ, (t, x, z) => {
        if (!columnHit(s, x, z, _hit)) return;
        if (_hit.lo <= G[t] + STANDING) S[t] = Math.max(S[t], _hit.hi);
        else if (_hit.lo > G[t] + OVERHANG) O[t] = 1;
      });
    }
  }

  contact() {
    const { G, light, N } = this;
    const near = blur(this.S, N, Math.round(NEAR_R / this.cell));
    // The wide blurs run on a 4x coarser grid: they're smooth anyway.
    const far = blurCoarse(this.S, N, FAR_R / this.cell, 4);
    const over = blurCoarse(this.O, N, FAR_R / this.cell, 4);
    for (let t = 0; t < light.length; t++) {
      const a = clamp01(near[t] - G[t]);
      const b = clamp01((far[t] - G[t]) / 2);
      light[t] = Math.max(MIN_LIGHT, 1 - 0.5 * a - 0.3 * b - 0.35 * over[t]);
    }
  }

  // Tone variation from two octaves of value noise, then the map's stains (outside their
  // rectangles, fading out over `width`).
  macro(seed, stains) {
    const { tone, N, cell, half } = this;
    const fine = new NoiseLattice(half, 8, seed);
    const coarse = new NoiseLattice(half, 20, seed + 7);
    for (let j = 0; j < N; j++) {
      const z = (j + 0.5) * cell - half;
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * cell - half;
        tone[j * N + i] = 1 + MACRO * (0.55 * fine.at(x, z) + 0.45 * coarse.at(x, z));
      }
    }
    for (const st of stains) {
      const w = st.width;
      this.forTexels(st.min[0] - w, st.max[0] + w, st.min[1] - w, st.max[1] + w, (t, x, z) => {
        const dx = Math.max(st.min[0] - x, 0, x - st.max[0]);
        const dz = Math.max(st.min[1] - z, 0, z - st.max[1]);
        const d = Math.hypot(dx, dz);
        if (d <= 0 || d >= w) return;
        const f = 1 - d / w;
        tone[t] *= 1 + st.amount * f * f * (3 - 2 * f);
      });
    }
  }

  // Each glow source adds color * k / (1 + (d / r)^2) on the floor, eased to 0 at 4r.
  glowPools(lights) {
    const { G, glow } = this;
    for (const L of lights) {
      _col.set(L.color);
      const reach = 4 * L.radius;
      const r2 = L.radius * L.radius;
      this.forTexels(L.min[0] - reach, L.max[0] + reach, L.min[2] - reach, L.max[2] + reach, (t, x, z) => {
        const y = G[t];
        const dx = Math.max(L.min[0] - x, 0, x - L.max[0]);
        const dy = Math.max(L.min[1] - y, 0, y - L.max[1]);
        const dz = Math.max(L.min[2] - z, 0, z - L.max[2]);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= reach * reach) return;
        const f = L.k * (1 / (1 + d2 / r2) - 1 / 17) * (17 / 16);
        glow[t * 3] += _col.r * f;
        glow[t * 3 + 1] += _col.g * f;
        glow[t * 3 + 2] += _col.b * f;
      });
    }
  }

  pack() {
    const { N, light, tone, glow } = this;
    // (Uint8ClampedArray clamps and rounds on its own.)
    const data = new Uint8ClampedArray(N * N * 4);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const t = j * N + i;
        const o = t * 4;
        // The edge stays neutral, so clamped samples past the grid change nothing.
        if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
          data[o + 3] = 204;
          continue;
        }
        data[o] = glow[t * 3] * 127.5;
        data[o + 1] = glow[t * 3 + 1] * 127.5;
        data[o + 2] = glow[t * 3 + 2] * 127.5;
        data[o + 3] = light[t] * tone[t] * 204;
      }
    }
    const tex = new THREE.DataTexture(new Uint8Array(data.buffer), N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.name = 'arenaBake';
    tex.needsUpdate = true;
    return tex;
  }

  // Make a floor material (Lambert or Phong, drawn from merged world-space geometry) read the
  // bake: the light multiplies the surface color, so contact shadows show in full sun too, and
  // the glow is added on top. Outside the grid (the far terrain) nothing changes.
  apply(material) {
    const bake = this;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uArenaBake = { value: bake.texture };
      shader.uniforms.uArenaRect = { value: bake.rect };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uArenaRect;\nvarying vec2 vArenaUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvArenaUv = (position.xz - uArenaRect.xy) * uArenaRect.z;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uArenaBake;\nvarying vec2 vArenaUv;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
	vec4 arenaBake = texture2D(uArenaBake, vArenaUv);
	float arenaIn = step(max(abs(vArenaUv.x - 0.5), abs(vArenaUv.y - 0.5)), 0.5);
	diffuseColor.rgb *= mix(1.0, arenaBake.a * 1.25, arenaIn);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          // (Half-desaturated surface color, so cyan light still reads on orange dirt.)
          `#include <emissivemap_fragment>
	vec3 arenaAlbedo = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3333))), 0.5);
	totalEmissiveRadiance += arenaBake.rgb * 2.0 * arenaAlbedo * arenaIn;`,
        );
      if (!shader.fragmentShader.includes('arenaBake.a') || !shader.vertexShader.includes('vArenaUv =')) {
        console.warn('arena bake: shader chunks changed, floor drawn without it');
      }
    };
    material.customProgramCacheKey = () => 'arenaBake';
  }
}

// Flattens a recorded solid: world bounds plus what columnHit needs.
function prepSolid(r) {
  const s = { ...r };
  if (r.cyl) {
    s.minX = r.x - r.r;
    s.maxX = r.x + r.r;
    s.minZ = r.z - r.r;
    s.maxZ = r.z + r.r;
    return s;
  }
  if (r.quat) {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...r.quat));
    const e = m.elements;
    // Local axes in world space (matrix columns).
    s.ax = [e[0], e[1], e[2]];
    s.ay = [e[4], e[5], e[6]];
    s.az = [e[8], e[9], e[10]];
    const ex = Math.abs(e[0]) * r.hx + Math.abs(e[4]) * r.hy + Math.abs(e[8]) * r.hz;
    const ez = Math.abs(e[2]) * r.hx + Math.abs(e[6]) * r.hy + Math.abs(e[10]) * r.hz;
    s.minX = r.x - ex;
    s.maxX = r.x + ex;
    s.minZ = r.z - ez;
    s.maxZ = r.z + ez;
    return s;
  }
  s.minX = r.x - r.hx;
  s.maxX = r.x + r.hx;
  s.minZ = r.z - r.hz;
  s.maxZ = r.z + r.hz;
  return s;
}

// Where the vertical line through (x, z) passes through solid s: sets out.lo and out.hi (world y)
// and returns true, or returns false when it misses.
function columnHit(s, x, z, out) {
  if (s.cyl) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz > s.r * s.r) return false;
    out.lo = s.y - s.hy;
    out.hi = s.y + s.hy;
    return true;
  }
  if (!s.ax) {
    if (Math.abs(x - s.x) > s.hx || Math.abs(z - s.z) > s.hz) return false;
    out.lo = s.y - s.hy;
    out.hi = s.y + s.hy;
    return true;
  }
  // Oriented box: slab test along the line (x, t, z), t being world y.
  const px = x - s.x;
  const py = -s.y;
  const pz = z - s.z;
  let lo = -Infinity;
  let hi = Infinity;
  for (const [a, h] of [[s.ax, s.hx], [s.ay, s.hy], [s.az, s.hz]]) {
    const p = px * a[0] + py * a[1] + pz * a[2];
    const d = a[1];
    if (Math.abs(d) < 1e-6) {
      if (Math.abs(p) > h) return false;
      continue;
    }
    let t0 = (-h - p) / d;
    let t1 = (h - p) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    if (lo > hi) return false;
  }
  out.lo = lo;
  out.hi = hi;
  return true;
}

// Three passes of a separable box blur (close to a Gaussian with sigma ~ r), edges clamped.
// Both directions walk memory in row order (columns keep one running sum each), which is
// several times faster than striding down columns.
function blur(src, N, r) {
  let a = Float32Array.from(src);
  if (r < 1) return a;
  let b = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  const last = N - 1;
  const sums = new Float64Array(N);
  for (let pass = 0; pass < 3; pass++) {
    // Along rows.
    for (let row = 0; row < N; row++) {
      const base = row * N;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[base + (k < 0 ? 0 : k > last ? last : k)];
      for (let k = 0; k < N; k++) {
        b[base + k] = sum * inv;
        const add = k + r + 1;
        const sub = k - r;
        sum += a[base + (add > last ? last : add)] - a[base + (sub < 0 ? 0 : sub)];
      }
    }
    // Along columns.
    sums.fill(0);
    for (let k = -r; k <= r; k++) {
      const base = (k < 0 ? 0 : k > last ? last : k) * N;
      for (let i = 0; i < N; i++) sums[i] += b[base + i];
    }
    for (let k = 0; k < N; k++) {
      const out = k * N;
      const add = Math.min(last, k + r + 1) * N;
      const sub = Math.max(0, k - r) * N;
      for (let i = 0; i < N; i++) {
        a[out + i] = sums[i] * inv;
        sums[i] += b[add + i] - b[sub + i];
      }
    }
  }
  return a;
}

// blur() on a grid f times coarser (block averages), read back bilinearly at full size.
// r is in full-size texels.
function blurCoarse(src, N, r, f) {
  const n = N / f;
  const small = new Float32Array(n * n);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) small[((j / f) | 0) * n + ((i / f) | 0)] += src[j * N + i];
  }
  for (let t = 0; t < small.length; t++) small[t] /= f * f;
  const b = blur(small, n, Math.round(r / f));
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const v = Math.min(n - 1, Math.max(0, (j + 0.5) / f - 0.5));
    const j0 = Math.min(n - 2, v | 0);
    const tv = v - j0;
    for (let i = 0; i < N; i++) {
      const u = Math.min(n - 1, Math.max(0, (i + 0.5) / f - 0.5));
      const i0 = Math.min(n - 2, u | 0);
      const tu = u - i0;
      const o = j0 * n + i0;
      const top = b[o] + (b[o + 1] - b[o]) * tu;
      const bottom = b[o + n] + (b[o + n + 1] - b[o + n]) * tu;
      out[j * N + i] = top + (bottom - top) * tv;
    }
  }
  return out;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Smooth value noise in [-1, 1] over [-half, half], with features about `scale` meters apart.
class NoiseLattice {
  constructor(half, scale, seed) {
    const rand = mulberry32(seed);
    this.half = half;
    this.inv = 1 / scale;
    this.n = Math.ceil((half * 2) / scale) + 2;
    this.v = Float32Array.from({ length: this.n * this.n }, () => rand() * 2 - 1);
  }

  at(x, z) {
    const fx = (x + this.half) * this.inv;
    const fz = (z + this.half) * this.inv;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    let tx = fx - ix;
    let tz = fz - iz;
    tx = tx * tx * (3 - 2 * tx);
    tz = tz * tz * (3 - 2 * tz);
    const { v, n } = this;
    const o = iz * n + ix;
    const a = v[o];
    const b = v[o + 1];
    const c = v[o + n];
    const d = v[o + n + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
}
