import * as THREE from 'three';
import { mulberry32 } from '../util/rng.js';

// Every texture in the game is drawn here on a canvas at load time. All tile seamlessly.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // Painting reads pixels back (grain), which is much faster from a CPU-side canvas.
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function toTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

// Per-pixel brightness noise. Seamless by nature.
function grain(ctx, w, h, amount, rand) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// Draws a shape at (x, y) plus its wrapped copies so it tiles across edges.
function wrapped(ctx, w, h, x, y, draw) {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      draw(ctx, x + ox, y + oy);
    }
  }
}

function blobs(ctx, w, h, rand, count, rMin, rMax, colors, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rMin + rand() * (rMax - rMin);
    ctx.globalAlpha = alpha * (0.5 + rand() * 0.5);
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    wrapped(ctx, w, h, x, y, (c, px, py) => {
      c.beginPath();
      c.ellipse(px, py, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      c.fill();
    });
  }
  ctx.globalAlpha = 1;
}

// Weathering, Halo's grit: what years outdoors and in a smokehouse leave on a surface.

// Rain streaks running down from the top of the tile (or from random points), soft and wobbly.
function streaks(ctx, S, rand, count, color, alpha, { fromTop = true } = {}) {
  const k = S / 256;
  for (let i = 0; i < count; i++) {
    const x = rand() * S;
    const y0 = fromTop ? 0 : rand() * S;
    const len = (0.25 + rand() * 0.65) * S;
    const w = (1.5 + rand() * 5) * k;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, color.replace('A', (alpha * (0.6 + rand() * 0.4)).toFixed(3)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    const lean = (rand() - 0.5) * 4 * k;
    wrapped(ctx, S, S, x, y0, (cc, px, py) => {
      cc.beginPath();
      cc.moveTo(px - w / 2, py);
      cc.lineTo(px + w / 2, py);
      cc.lineTo(px + lean + w * (0.2 + rand() * 0.3), py + len);
      cc.lineTo(px + lean - w * (0.2 + rand() * 0.3), py + len);
      cc.closePath();
      cc.fill();
    });
  }
}

// Big soft stains: grime, soot and damp, darker in the middle.
function stains(ctx, S, rand, count, rMin, rMax, rgb, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = rMin + rand() * (rMax - rMin);
    wrapped(ctx, S, S, x, y, (cc, px, py) => {
      const g = cc.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${rgb},${(alpha * (0.6 + rand() * 0.4)).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      cc.fillStyle = g;
      cc.beginPath();
      cc.ellipse(px, py, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
      cc.fill();
    });
  }
}

// Scratches: thin bright lines where paint was scraped to bare metal.
function scratches(ctx, S, rand, count, color, alpha) {
  const k = S / 256;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = (4 + rand() * 22) * k;
    const a = rand() * Math.PI;
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    ctx.lineWidth = (0.5 + rand() * 0.9) * k;
    wrapped(ctx, S, S, x, y, (cc, px, py) => {
      cc.beginPath();
      cc.moveTo(px, py);
      cc.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      cc.stroke();
    });
  }
  ctx.globalAlpha = 1;
}

// The world-space grime map (materials.js grime): R is big blotchy patches, G is the same
// stretched downward into streaks (for walls). Data, not color; values around the middle.
function grimeMap() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(97);
  // Value noise on wrapping grids, summed over octaves.
  const octave = (n) => {
    const g = Array.from({ length: n * n }, () => rand());
    return (x, y) => {
      const fx = (x / S) * n;
      const fy = (y / S) * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j + n) % n) * n + ((i + n) % n)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const o = [octave(4), octave(8), octave(16), octave(32), octave(64)];
  const w = [0.42, 0.26, 0.16, 0.1, 0.06];
  const st = [octave(24), octave(48)];
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (let i = 0; i < o.length; i++) v += o[i](x, y) * w[i];
      // Push it into patches: mostly clean, some properly dirty.
      v = Math.min(1, Math.max(0, (v - 0.24) * 1.9));
      // Streaks: noise that only changes slowly downward (y), quickly across.
      const s = st[0](x, y * 0.08) * 0.65 + st[1](x, y * 0.12) * 0.35;
      const i4 = (y * S + x) * 4;
      img.data[i4] = Math.round(v * 255);
      img.data[i4 + 1] = Math.round(Math.min(1, Math.max(0, (s - 0.3) * 2)) * 255);
      img.data[i4 + 2] = 0;
      img.data[i4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// Relief: every painter below also paints a grayscale height canvas with the same shapes
// (128 flat, seams and gaps lower, rivets and pebbles higher). relief() then shades the color
// by the height's slope toward a light direction, so raised details catch light on one side and
// shadow on the other, painted in at no shader cost. It also turns the same slopes into a normal
// map (kept per texture in `normals`), which the High preset hands to the materials so the
// details answer the real sun too.

function heightCanvas(S) {
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = gray(128);
  ctx.fillRect(0, 0, S, S);
  return [c, ctx];
}

function gray(v) {
  return `rgb(${v},${v},${v})`;
}

// light: [x, y] toward the light in canvas coordinates (y down). Walls are lit from above
// ([0, -1]: world UVs keep v pointing up on every wall face); the ground from the sun's azimuth.
// grain: per-pixel brightness noise added in the same pass (like grain()).
const WALL_LIGHT = [0, -1];
function relief(ctx, hctx, S, light, strength = 0.35, { grain: noise = 0, rand = null } = {}) {
  const img = ctx.getImageData(0, 0, S, S);
  const c = img.data;
  const hd = hctx.getImageData(0, 0, S, S).data;
  // Softened by a wrapped 3 x 3 blur, so edges shade over a pixel or two and tiles stay seamless.
  // (Neighbor indices are precomputed so the loops need no modulo.)
  const left = new Int32Array(S);
  const right = new Int32Array(S);
  for (let x = 0; x < S; x++) {
    left[x] = (x - 1 + S) % S;
    right[x] = (x + 1) % S;
  }
  const h0 = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) h0[i] = hd[i * 4];
  // Rows first, then columns.
  const hr = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const o = y * S;
    for (let x = 0; x < S; x++) hr[o + x] = h0[o + left[x]] + h0[o + x] + h0[o + right[x]];
  }
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const up = left[y] * S;
    const o = y * S;
    const dn = right[y] * S;
    for (let x = 0; x < S; x++) h[o + x] = (hr[up + x] + hr[o + x] + hr[dn + x]) / 9;
  }
  // Slopes per 256-px texel, so a texture shades the same at any size.
  const k = (S / 256) * 0.5;
  const [lx, ly] = light;
  const sk = strength / 16;
  // Grain from a small table of random values walked at a stride, instead of a random call
  // per texel (the slow part at 512 px).
  const NOISE = 4093;
  const table = new Float32Array(NOISE);
  for (let i = 0; i < NOISE; i++) table[i] = noise && rand ? (rand() - 0.5) * noise : 0;
  let ni = 0;
  for (let y = 0; y < S; y++) {
    // A random start per row: walking straight through the table would repeat it every 4093
    // texels (8 rows less 3 px at 512), a slanted lattice instead of grain.
    if (rand) ni = Math.floor(rand() * NOISE);
    const up = left[y] * S;
    const o = y * S;
    const dn = right[y] * S;
    for (let x = 0; x < S; x++) {
      const gx = h[o + right[x]] - h[o + left[x]];
      const gy = h[dn + x] - h[up + x];
      const n = table[ni];
      ni += 1777;
      if (ni >= NOISE) ni -= NOISE;
      const i = (o + x) * 4;
      if (gx === 0 && gy === 0) {
        c[i] += n;
        c[i + 1] += n;
        c[i + 2] += n;
        continue;
      }
      // Facing the light where the height falls away toward it.
      let f = 1 - sk * k * (gx * lx + gy * ly);
      f = f < 0.55 ? 0.55 : f > 1.5 ? 1.5 : f;
      c[i] = c[i] * f + n;
      c[i + 1] = c[i + 1] * f + n;
      c[i + 2] = c[i + 2] * f + n;
    }
  }
  ctx.putImageData(img, 0, 0);
  lastNormal = normalCanvas(h, S, left, right);
}

// Tangent-space normals from the blurred heights (x along u, y along v: the canvas's y runs
// down, against v).
const NORMAL_SLOPE = 0.012;
let lastNormal = null;
function normalCanvas(h, S, left, right) {
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const s = NORMAL_SLOPE * (S / 256);
  for (let y = 0; y < S; y++) {
    const up = left[y] * S;
    const o = y * S;
    const dn = right[y] * S;
    for (let x = 0; x < S; x++) {
      const nx = -(h[o + right[x]] - h[o + left[x]]) * s;
      const ny = (h[dn + x] - h[up + x]) * s;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (o + x) * 4;
      d[i] = (nx * l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * l * 0.5 + 0.5) * 255;
      d[i + 2] = (l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// A shape drawn on both canvases: color on ctx, height level on hctx (null: color only).
function both(ctx, hctx, color, level, draw) {
  ctx.fillStyle = color;
  draw(ctx);
  if (level !== null) {
    hctx.fillStyle = gray(level);
    draw(hctx);
  }
}

function circle(x, y, r) {
  return (c) => {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  };
}

// A hairline crack: a jittered random walk, dark and low, wrapped across tile edges.
function crack(ctx, hctx, S, rand, length, color) {
  let x = rand() * S;
  let y = rand() * S;
  let a = rand() * Math.PI * 2;
  const pts = [[x, y]];
  const step = S / 64;
  for (let i = 0; i < length; i++) {
    a += (rand() - 0.5) * 0.7;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  for (const [c, style, w] of [[ctx, color, S / 256], [hctx, gray(110), S / 256]]) {
    c.strokeStyle = style;
    c.lineWidth = w;
    c.globalAlpha = c === ctx ? 0.55 : 1;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        c.beginPath();
        pts.forEach(([px, py], i) => (i ? c.lineTo(px + ox, py + oy) : c.moveTo(px + ox, py + oy)));
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }
}

// Stenciled digits as vector strokes (no fonts): 7-segment style, `h` tall, at (x, y) top-left.
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
function stencilDigits(ctx, text, x, y, h, color, alpha) {
  const w = h * 0.55;
  const t = h * 0.13;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (const ch of text) {
    const seg = SEGMENTS[ch] ?? '';
    const r = {
      a: [x, y, w, t], b: [x + w - t, y, t, h / 2], c: [x + w - t, y + h / 2, t, h / 2], d: [x, y + h - t, w, t],
      e: [x, y + h / 2, t, h / 2], f: [x, y, t, h / 2], g: [x, y + h / 2 - t / 2, w, t],
    };
    // Stencil bridges: small gaps where strokes meet.
    for (const sname of seg) {
      const [rx, ry, rw, rh] = r[sname];
      ctx.fillRect(rx + (rw > rh ? t * 0.6 : 0), ry + (rh > rw ? t * 0.6 : 0), rw - (rw > rh ? t * 1.2 : 0), rh - (rh > rw ? t * 1.2 : 0));
    }
    x += w + h * 0.25;
  }
  ctx.globalAlpha = 1;
}

// The ground is lit from the sun's azimuth. Box tops (StaticBuilder's worldUvBox) map world -x
// across the canvas and world -z down it, and the sun sits at (38, 60, 26). (Walls' light from
// above lands on tops as light from +z, the sun's side.)
const GROUND_LIGHT = (() => {
  const l = Math.hypot(38, 26);
  return [-38 / l, -26 / l];
})();

function ground(S) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(11);
  ctx.fillStyle = '#9a6a48';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 70, 8 * k, 34 * k, ['#7d5236', '#ab7a52', '#8c5e3e'], 0.35);
  blobs(ctx, S, S, rand, 400 * k * k, 0.6 * k, 2.2 * k, ['#5c3b26', '#c89a72', '#6e4a33'], 0.8);
  // Pebbles: a few, raised, close to the dirt's own tones; bigger ones rarer.
  for (let i = 0; i < 70 * k * k; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = (0.7 + rand() * rand() * 2.6) * k;
    const tone = ['#a8805e', '#86603f', '#9c8a76', '#8f6849'][Math.floor(rand() * 4)];
    const level = 140 + Math.floor(rand() * 35);
    ctx.globalAlpha = 0.75;
    wrapped(ctx, S, S, x, y, (cc, px, py) => both(cc, hctx, tone, level, circle(px, py, r)));
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < 3; i++) crack(ctx, hctx, S, rand, 10 + Math.floor(rand() * 12), '#5a3c28');
  relief(ctx, hctx, S, GROUND_LIGHT, 0.25, { grain: 22, rand });
  return toTexture(c);
}

// Smokehouse Creek's meadow (one 4 m tile): green-brown grass with darker clumps, bare dirt
// patches, and short blade strokes raised a little, lit from the sun's side.
function grass(S) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(71);
  ctx.fillStyle = '#5d7438';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 60, 10 * k, 38 * k, ['#4f6630', '#6b8442', '#58703a'], 0.4);
  // Bare dirt showing through here and there.
  blobs(ctx, S, S, rand, 10, 6 * k, 18 * k, ['#6e5a3c', '#7a6644'], 0.45);
  // Blades: short strokes leaning every which way, lighter tips.
  for (let i = 0; i < 1400 * k * k; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const len = (2 + rand() * 4) * k;
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.4;
    const tone = ['#3f5626', '#7c9450', '#66803c', '#8aa058', '#4a6230'][Math.floor(rand() * 5)];
    const level = 130 + Math.floor(rand() * 40);
    wrapped(ctx, S, S, x, y, (cc, px, py) =>
      both(cc, hctx, tone, level, (q) => {
        q.lineWidth = 0.9 * k;
        q.strokeStyle = q.fillStyle;
        q.beginPath();
        q.moveTo(px, py);
        q.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
        q.stroke();
      }),
    );
  }
  relief(ctx, hctx, S, GROUND_LIGHT, 0.22, { grain: 16, rand });
  return toTexture(c);
}

// Smokehouse Creek's rock (one 3 m tile, on the steep rim and banks): gray-brown stone in
// layers, with blocky patches, cracks, a few pale lichen spots, lit from above like a wall.
function rock(S) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(83);
  ctx.fillStyle = '#7e766b';
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = gray(128);
  hctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 50, 10 * k, 40 * k, ['#6c655b', '#8d857a', '#746c61', '#857a6a'], 0.4);
  // Layers: bands across, each raised a little more at its top.
  let y = 0;
  while (y < S) {
    const h = (6 + rand() * 18) * k;
    const tone = ['#736b60', '#857d72', '#6a6359', '#8b8276'][Math.floor(rand() * 4)];
    const lift = 120 + Math.floor(rand() * 40);
    ctx.globalAlpha = 0.35;
    both(ctx, hctx, tone, lift, (q) => q.fillRect(0, y, S, h));
    ctx.globalAlpha = 0.28;
    both(ctx, hctx, '#4f4942', 110, (q) => q.fillRect(0, y + h - 1.2 * k, S, 1.2 * k));
    ctx.globalAlpha = 1;
    y += h;
  }
  // Blocky chunks standing out of the face.
  for (let i = 0; i < 40 * k * k; i++) {
    const x = rand() * S;
    const yy = rand() * S;
    const w = (4 + rand() * 12) * k;
    const hh = (3 + rand() * 7) * k;
    const tone = ['#8f877b', '#6e675d', '#7a7266'][Math.floor(rand() * 3)];
    ctx.globalAlpha = 0.5;
    wrapped(ctx, S, S, x, yy, (cc, px, py) => both(cc, hctx, tone, 150 + Math.floor(rand() * 30), (q) => q.fillRect(px, py, w, hh)));
    ctx.globalAlpha = 1;
  }
  blobs(ctx, S, S, rand, 300 * k * k, 0.5 * k, 1.6 * k, ['#5a544c', '#a39a8c'], 0.5);
  // Lichen.
  blobs(ctx, S, S, rand, 14, 1.5 * k, 5 * k, ['#9a9a6a', '#8a9060'], 0.35);
  for (let i = 0; i < 7; i++) crack(ctx, hctx, S, rand, 8 + Math.floor(rand() * 16), '#3e3933');
  relief(ctx, hctx, S, WALL_LIGHT, 0.4, { grain: 18, rand });
  return toTexture(c);
}

// Grass blades for Smokehouse Creek's tufts (world/foliage.js): a clump of tapered blades on a
// clear background, darker at the roots, lighter at the tips.
function blades() {
  const W = 64;
  const H = 64;
  const [c, ctx] = canvas(W, H);
  const rand = mulberry32(97);
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const x0 = 6 + rand() * (W - 12);
    const lean = (rand() - 0.5) * 26;
    const top = 4 + rand() * 26;
    const w = 1.6 + rand() * 1.8;
    const g = ctx.createLinearGradient(0, H, 0, top);
    const tip = ['#a6bb68', '#93ad5c', '#b4c274', '#86a252'][Math.floor(rand() * 4)];
    g.addColorStop(0, '#4a6230');
    g.addColorStop(0.5, '#6b8742');
    g.addColorStop(1, tip);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - w, H);
    ctx.quadraticCurveTo(x0 + lean * 0.3, (H + top) / 2, x0 + lean, top);
    ctx.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, (H + top) / 2, x0 + w, H);
    ctx.closePath();
    ctx.fill();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Metal wall panels, 4 across and 2 up per tile (1 m x 2 m at the 4 m tile): each its own tint,
// with seams, worn bright edges, rivets, grime low down, and two rust streaks under rivets.
// (No stenciled numbers: anything that distinctive shows the 4 m repeat along a wall.)
function panels(S, base, seam, highlight, seed) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(seed);
  const baseC = new THREE.Color(base);
  const PW = S / 4;
  const PH = S / 2;
  const tmp = new THREE.Color();
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 4; px++) {
      tmp.copy(baseC).multiplyScalar(0.94 + rand() * 0.1);
      tmp.offsetHSL((rand() - 0.5) * 0.01, 0, 0);
      ctx.fillStyle = `#${tmp.getHexString()}`;
      ctx.fillRect(px * PW, py * PH, PW, PH);
    }
  }
  // Subtle vertical streaks.
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.04 + rand() * 0.05;
    ctx.fillStyle = rand() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(rand() * S, 0, (1 + rand() * 3) * k, S);
  }
  ctx.globalAlpha = 1;
  const seamW = 3 * k;
  const rivetR = 2.6 * k;
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 4; px++) {
      const x = px * PW;
      const y = py * PH;
      // Grime collects at the bottom of each panel.
      const g = ctx.createLinearGradient(0, y + PH * 0.65, 0, y + PH);
      g.addColorStop(0, 'rgba(20,18,16,0)');
      g.addColorStop(1, 'rgba(20,18,16,0.32)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y + PH * 0.65, PW, PH * 0.35);
      // Seams (low) along the top and left edges; the next panel's make the others.
      both(ctx, hctx, seam, 40, (cc) => {
        cc.fillRect(x, y, PW, seamW);
        cc.fillRect(x, y, seamW, PH);
      });
      // Worn bright edges just inside the seams, chipped here and there.
      ctx.fillStyle = highlight;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x + seamW, y + seamW, PW - seamW, k);
      ctx.fillRect(x + seamW, y + seamW, k, PH - seamW);
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = 0.25 + rand() * 0.3;
        ctx.fillRect(x + seamW + rand() * (PW - seamW * 2), y + seamW, (2 + rand() * 6) * k, 2 * k);
      }
      ctx.globalAlpha = 1;
      // Rivets (raised) in the corners and halfway up the long sides.
      const inset = 7 * k;
      for (const [rx, ry] of [[inset, inset], [PW - inset, inset], [inset, PH - inset], [PW - inset, PH - inset], [inset, PH / 2], [PW - inset, PH / 2]]) {
        both(ctx, hctx, seam, 215, circle(x + rx, y + ry, rivetR));
        ctx.fillStyle = highlight;
        circle(x + rx - 0.6 * k, y + ry - 0.6 * k, rivetR * 0.45)(ctx);
      }
    }
  }
  // Rare features: two rust streaks below rivets.
  for (let i = 0; i < 2; i++) {
    const px = Math.floor(rand() * 4);
    const py = Math.floor(rand() * 2);
    const x = px * PW + (rand() < 0.5 ? 7 * k : PW - 7 * k);
    const y = py * PH + (rand() < 0.5 ? 7 * k : PH / 2) + rivetR;
    const len = PH * (0.25 + rand() * 0.3);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(140,72,30,0.55)');
    g.addColorStop(1, 'rgba(140,72,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 1.5 * k, y);
    ctx.lineTo(x + 1.5 * k, y);
    ctx.lineTo(x + (2.5 + rand() * 2) * k, y + len);
    ctx.lineTo(x - (2.5 + rand() * 2) * k, y + len);
    ctx.closePath();
    ctx.fill();
  }
  // Weathering: soot and grime patches, rain streaks off the seams, scraped paint.
  stains(ctx, S, rand, 7, 18 * k, 50 * k, '24,20,16', 0.22);
  streaks(ctx, S, rand, 14, 'rgba(26,22,18,A)', 0.22);
  scratches(ctx, S, rand, 40, highlight, 0.55);
  relief(ctx, hctx, S, WALL_LIGHT, 0.35, { grain: 12, rand });
  return toTexture(c);
}

function hazard() {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(5);
  ctx.fillStyle = '#e2b012';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#1c1c1c';
  // Diagonal stripes that wrap: 4 stripe periods across the tile.
  const period = S / 2;
  for (let k = -4; k < 6; k++) {
    const x0 = k * period;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + period / 2, 0);
    ctx.lineTo(x0 + period / 2 + S, S);
    ctx.lineTo(x0 + S, S);
    ctx.closePath();
    ctx.fill();
  }
  blobs(ctx, S, S, rand, 30, 1, 5, ['#6b5a3a', '#3a3328'], 0.35);
  grain(ctx, S, S, 16, rand);
  return toTexture(c);
}

function planks(S) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(21);
  const boards = 4;
  const bh = S / boards;
  const tones = ['#8a6a45', '#7d5e3c', '#957450', '#836340'];
  for (let i = 0; i < boards; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.fillRect(0, i * bh, S, bh);
    // Grain lines (slightly low, so they read as grooves).
    for (let g = 0; g < 14; g++) {
      const alpha = 0.18 + rand() * 0.15;
      const stroke = rand() > 0.5 ? '#5e4329' : '#a7845d';
      const y = i * bh + 4 * k + rand() * (bh - 8 * k);
      const amp = (1 + rand() * 2) * k;
      // Whole waves per tile, so each line meets itself across the left and right edges.
      const cycles = rand() < 0.75 ? 1 : 2;
      const ph = rand() * 10;
      for (const [cc, style, a] of [[ctx, stroke, alpha], [hctx, gray(112), 1]]) {
        cc.globalAlpha = a;
        cc.strokeStyle = style;
        cc.lineWidth = k;
        cc.beginPath();
        for (let x = 0; x <= S; x += 8 * k) {
          const yy = y + Math.sin((x / S) * cycles * Math.PI * 2 + ph) * amp;
          if (x === 0) cc.moveTo(x, yy);
          else cc.lineTo(x, yy);
        }
        cc.stroke();
        cc.globalAlpha = 1;
      }
    }
    // Gap between boards (low).
    both(ctx, hctx, '#3b2a1a', 30, (cc) => cc.fillRect(0, i * bh, S, 3 * k));
    // Nail heads at both ends of each board's span (raised).
    for (const bx of [24, 152]) {
      for (const dy of [-0.22, 0.22]) {
        both(ctx, hctx, '#4f4f4f', 210, circle(bx * k, i * bh + bh / 2 + dy * bh, 2.2 * k));
      }
    }
  }
  // One or two knots per tile: a dark eye with grain curving around it.
  for (let n = 0; n < 2; n++) {
    const x = rand() * S;
    const y = Math.floor(rand() * boards) * bh + bh * (0.35 + rand() * 0.3);
    const rx = (6 + rand() * 5) * k;
    const ry = rx * 0.55;
    for (let r = 3; r >= 0; r--) {
      ctx.globalAlpha = r === 0 ? 0.85 : 0.18;
      ctx.strokeStyle = '#4a3220';
      ctx.fillStyle = '#4a3220';
      ctx.lineWidth = k;
      ctx.beginPath();
      ctx.ellipse(x, y, rx * (1 + r * 0.45), ry * (1 + r * 0.35), 0, 0, Math.PI * 2);
      if (r === 0) ctx.fill();
      else ctx.stroke();
    }
    ctx.globalAlpha = 1;
    hctx.fillStyle = gray(100);
    hctx.beginPath();
    hctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    hctx.fill();
  }
  relief(ctx, hctx, S, WALL_LIGHT, 0.35, { grain: 14, rand });
  return toTexture(c);
}

// Poured concrete (3 m tile): aggregate, form joints along the tile edges and a grid of
// form-tie holes, like real cast walls.
function concrete(S) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(31);
  ctx.fillStyle = '#a19f98';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 60, 6 * k, 30 * k, ['#8f8d86', '#b2b0a9', '#97958d'], 0.3);
  // Aggregate: fine speckles, a few small pits and stones with a little relief.
  blobs(ctx, S, S, rand, 250 * k * k, 0.5 * k, 1.4 * k, ['#86847e', '#b8b6af'], 0.55);
  for (let i = 0; i < 70 * k * k; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = (0.5 + rand() * rand() * 1.6) * k;
    const pit = rand() < 0.6;
    ctx.globalAlpha = 0.6;
    wrapped(ctx, S, S, x, y, (cc, px, py) => both(cc, hctx, pit ? '#77756f' : '#b3b1aa', pit ? 100 : 150, circle(px, py, r)));
    ctx.globalAlpha = 1;
  }
  // Form joints along the tile edges.
  both(ctx, hctx, '#7a7872', 70, (cc) => {
    cc.fillRect(0, 0, S, 2 * k);
    cc.fillRect(0, 0, 2 * k, S);
  });
  // Form-tie holes: 2 x 2 per tile.
  for (const fx of [0.25, 0.75]) {
    for (const fy of [0.25, 0.75]) {
      both(ctx, hctx, '#5f5d58', 45, circle(fx * S, fy * S, 3.2 * k));
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#86847e';
      circle(fx * S, fy * S, 5.5 * k)(ctx);
      ctx.globalAlpha = 1;
    }
  }
  // Weathering: damp patches, rust weeping from the form-tie holes, rain streaks from the top,
  // a couple of cracks.
  stains(ctx, S, rand, 6, 20 * k, 60 * k, '60,56,48', 0.28);
  for (const fx of [0.25, 0.75]) {
    for (const fy of [0.25, 0.75]) {
      const g = ctx.createLinearGradient(0, fy * S, 0, fy * S + 40 * k);
      g.addColorStop(0, 'rgba(110,70,40,0.35)');
      g.addColorStop(1, 'rgba(110,70,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(fx * S - 2.5 * k, fy * S + 3 * k, 5 * k, 40 * k);
    }
  }
  streaks(ctx, S, rand, 22, 'rgba(58,54,46,A)', 0.3);
  streaks(ctx, S, rand, 8, 'rgba(40,36,30,A)', 0.25, { fromTop: false });
  for (let i = 0; i < 2; i++) crack(ctx, hctx, S, rand, 6 + Math.floor(rand() * 8), '#66645e');
  relief(ctx, hctx, S, WALL_LIGHT, 0.3, { grain: 14, rand });
  return toTexture(c);
}

// One crate face (UVs fit each face): steel frame, orange boards with a diagonal brace,
// chipped paint, a stencil, corner bolts.
function crate(S) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(41);
  ctx.fillStyle = '#2d3238';
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = gray(150);
  hctx.fillRect(0, 0, S, S);
  const b = 22 * k;
  both(ctx, hctx, '#c0601d', 120, (cc) => cc.fillRect(b, b, S - b * 2, S - b * 2));
  // Board seams.
  for (let i = 1; i < 4; i++) {
    both(ctx, hctx, '#8f4512', 95, (cc) => cc.fillRect(b, b + ((S - b * 2) * i) / 4, S - b * 2, 2 * k));
  }
  // Diagonal brace (raised).
  for (const [cc, style] of [[ctx, '#8f4512'], [hctx, gray(165)]]) {
    cc.strokeStyle = style;
    cc.lineWidth = 18 * k;
    cc.beginPath();
    cc.moveTo(b + 6 * k, b + 6 * k);
    cc.lineTo(S - b - 6 * k, S - b - 6 * k);
    cc.stroke();
  }
  // Chipped paint: the dark frame showing through small flakes.
  for (let i = 0; i < 26; i++) {
    const x = b + rand() * (S - b * 2);
    const y = b + rand() * (S - b * 2);
    const r = (1 + rand() * 3.5) * k;
    ctx.fillStyle = rand() < 0.7 ? '#3a2c22' : '#e08a4a';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.4 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Stencil: a code and a bar.
  stencilDigits(ctx, '07', S - b - 70 * k, b + 12 * k, 16 * k, '#e9d9b8', 0.8);
  ctx.fillStyle = '#e9d9b8';
  ctx.globalAlpha = 0.8;
  ctx.fillRect(S - b - 70 * k, b + 32 * k, 44 * k, 5 * k);
  ctx.globalAlpha = 1;
  // Corner bolts (raised).
  for (const [x, y] of [[11, 11], [S / k - 11, 11], [11, S / k - 11], [S / k - 11, S / k - 11]]) {
    both(ctx, hctx, '#9aa1a8', 220, circle(x * k, y * k, 5 * k));
  }
  blobs(ctx, S, S, rand, 40, 2 * k, 8 * k, ['#4a3a2a', '#20242a'], 0.25);
  relief(ctx, hctx, S, WALL_LIGHT, 0.4, { grain: 14, rand });
  return toTexture(c, { repeat: false });
}

// Factory floor slab (one 4 m tile): smooth troweled concrete with saw-cut joints on the tile
// edges and one across the middle, oil drips, tire scuffs and a few hairline cracks.
function slab(S) {
  const k = S / 256;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(61);
  ctx.fillStyle = '#8e8a82';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 50, 10 * k, 40 * k, ['#837f77', '#99958d', '#7c786f'], 0.3);
  blobs(ctx, S, S, rand, 300 * k * k, 0.4 * k, 1.1 * k, ['#77736b', '#a6a29a'], 0.5);
  // Oil: a few dark drips, soft-edged.
  blobs(ctx, S, S, rand, 7, 4 * k, 16 * k, ['#3f3a33', '#4a443b'], 0.35);
  blobs(ctx, S, S, rand, 16, 1.5 * k, 4 * k, ['#3a352f'], 0.45);
  // Tire scuffs: long faint dark arcs.
  ctx.strokeStyle = '#5d5952';
  for (let i = 0; i < 4; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = (40 + rand() * 80) * k;
    const a = rand() * Math.PI * 2;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = (5 + rand() * 4) * k;
    wrapped(ctx, S, S, x, y, (cc, px, py) => {
      cc.beginPath();
      cc.arc(px, py, r, a, a + 0.6 + rand() * 0.5);
      cc.stroke();
    });
  }
  ctx.globalAlpha = 1;
  // Saw-cut joints: tile edges and across the middle (2 m slabs).
  both(ctx, hctx, '#5a5650', 60, (cc) => {
    cc.fillRect(0, 0, S, 1.6 * k);
    cc.fillRect(0, 0, 1.6 * k, S);
    cc.fillRect(0, S / 2, S, 1.2 * k);
    cc.fillRect(S / 2, 0, 1.2 * k, S);
  });
  for (let i = 0; i < 2; i++) crack(ctx, hctx, S, rand, 8 + Math.floor(rand() * 10), '#625e57');
  // Ground-in dirt and soot, and scuffed bright patches where feet wear it.
  stains(ctx, S, rand, 8, 20 * k, 60 * k, '50,45,38', 0.22);
  stains(ctx, S, rand, 4, 14 * k, 36 * k, '170,165,155', 0.12);
  relief(ctx, hctx, S, GROUND_LIGHT, 0.2, { grain: 12, rand });
  return toTexture(c);
}

// Conveyor belt rubber (one 1 m tile): dark, with raised cross ribs every 12.5 cm (they run
// across the belt, along the texture's v) and wear down the middle.
function belt() {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const [, hctx] = heightCanvas(S);
  const rand = mulberry32(71);
  ctx.fillStyle = '#26282a';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 40, 3, 10, ['#1d1f21', '#303336'], 0.4);
  for (let i = 0; i < 8; i++) both(ctx, hctx, '#383b3e', 190, (cc) => cc.fillRect(i * 16, 0, 5, S));
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#4a4d50';
  ctx.fillRect(0, S * 0.3, S, S * 0.4);
  ctx.globalAlpha = 1;
  relief(ctx, hctx, S, [-1, 0], 0.5, { grain: 10, rand });
  return toTexture(c);
}

function mud() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(51);
  ctx.fillStyle = '#35231a';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 90, 6, 26, ['#2a1a11', '#4d3424', '#3d2a1d'], 0.6);
  // Wet sheen streaks and bubbles.
  blobs(ctx, S, S, rand, 40, 3, 10, ['#6a4c35'], 0.35);
  blobs(ctx, S, S, rand, 70, 1, 3.5, ['#7b5b40', '#1c120b'], 0.7);
  grain(ctx, S, S, 10, rand);
  return toTexture(c);
}

function net() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const cells = 4;
  const step = S / cells;
  ctx.strokeStyle = '#d8c79e';
  ctx.lineWidth = 9;
  for (let i = 0; i <= cells; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  // Knots.
  ctx.fillStyle = '#b9a67a';
  for (let i = 0; i <= cells; i++) {
    for (let j = 0; j <= cells; j++) {
      ctx.beginPath();
      ctx.arc(i * step, j * step, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTexture(c);
}

function rope() {
  const W = 64;
  const H = 64;
  const [c, ctx] = canvas(W, H);
  const rand = mulberry32(61);
  ctx.fillStyle = '#c9b48a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#8e7a54';
  ctx.lineWidth = 5;
  for (let k = -2; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(k * 21, 0);
    ctx.lineTo(k * 21 + W, H);
    ctx.stroke();
  }
  grain(ctx, W, H, 18, rand);
  return toTexture(c);
}

function flame() {
  const W = 64;
  const H = 128;
  const [c, ctx] = canvas(W, H);
  ctx.clearRect(0, 0, W, H);
  // Teardrop: wide and bright at the bottom, narrowing upward.
  const grd = ctx.createRadialGradient(W / 2, H * 0.78, 2, W / 2, H * 0.7, H * 0.62);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.18, 'rgba(255,210,90,0.95)');
  grd.addColorStop(0.45, 'rgba(255,110,20,0.7)');
  grd.addColorStop(0.75, 'rgba(200,40,5,0.25)');
  grd.addColorStop(1, 'rgba(120,10,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(W / 2, 2);
  ctx.bezierCurveTo(W * 0.62, H * 0.35, W * 0.98, H * 0.6, W * 0.9, H * 0.85);
  ctx.bezierCurveTo(W * 0.82, H * 1.0, W * 0.18, H * 1.0, W * 0.1, H * 0.85);
  ctx.bezierCurveTo(W * 0.02, H * 0.6, W * 0.38, H * 0.35, W / 2, 2);
  ctx.fill();
  return toTexture(c, { repeat: false });
}

function planet() {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(71);
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;
  const r = S * 0.3;

  const ring = (front) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.35);
    ctx.scale(1, 0.22);
    ctx.lineWidth = 26;
    ctx.strokeStyle = 'rgba(230,205,170,0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.55, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(200,170,140,0.4)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.78, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  ring(false);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const bands = ['#d98c5f', '#b9675a', '#e9b98a', '#8f5a6e', '#d7a074', '#a76a5c', '#efcfa4'];
  let y = cy - r;
  while (y < cy + r) {
    const h = 6 + rand() * 22;
    ctx.fillStyle = bands[Math.floor(rand() * bands.length)];
    ctx.fillRect(cx - r, y, r * 2, h + 1);
    y += h;
  }
  // A storm spot.
  ctx.fillStyle = 'rgba(150,60,50,0.6)';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.3, cy + r * 0.25, r * 0.16, r * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  // Terminator shading.
  const shade = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.55, 'rgba(10,10,30,0.15)');
  shade.addColorStop(1, 'rgba(10,10,40,0.8)');
  ctx.fillStyle = shade;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  ring(true);
  return toTexture(c, { repeat: false });
}

// Soft round dot for sparks and glows.
function spark() {
  const S = 64;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false });
}

// Effect atlases: a 4 x 4 grid of 128 px cells, each drawn inside a 4 px transparent border
// so neighbors don't bleed into each other (particles.js picks a cell per particle).
const CELL = 128;
const PAD = 4;
function atlas(cells) {
  const [c, ctx] = canvas(CELL * 4, CELL * 4);
  ctx.clearRect(0, 0, CELL * 4, CELL * 4);
  cells.forEach((draw, i) => {
    ctx.save();
    ctx.translate((i % 4) * CELL + CELL / 2, Math.floor(i / 4) * CELL + CELL / 2);
    ctx.beginPath();
    ctx.rect(-CELL / 2 + PAD, -CELL / 2 + PAD, CELL - 2 * PAD, CELL - 2 * PAD);
    ctx.clip();
    draw(ctx, CELL / 2 - PAD);
    ctx.restore();
  });
  return toTexture(c, { repeat: false });
}

function softDot(ctx, R) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R, R * 2, R * 2);
}

// A white star with `points` rays (tinted per use), a hot core and a soft halo. The core and
// halo are big, so the star still reads as a bright blob when it's only a few pixels wide.
function star(points, spin, thin) {
  return (ctx, R) => {
    ctx.rotate(spin);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    halo.addColorStop(0, 'rgba(255,255,255,0.8)');
    halo.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    for (let i = 0; i < points; i++) {
      ctx.rotate((Math.PI * 2) / points);
      const len = R * (i % 2 ? 0.7 : 1);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -thin);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, thin);
      ctx.closePath();
      ctx.fill();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.45);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = core;
    ctx.fillRect(-R, -R, R * 2, R * 2);
  };
}

function ring(ctx, R) {
  const g = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R, R * 2, R * 2);
}

// Bright along the middle of the cell's width, tapering to both ends (stretched along a
// direction by particles.js). It fills half the cell's height, so the particle's size sets
// its thickness (and its minimum on-screen size still shows).
function streak(ctx, R) {
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R / 0.5, R * 2, (R * 2) / 0.5);
}

function shard(ctx, R) {
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(-R * 0.25, -R * 0.9);
  ctx.lineTo(R * 0.55, -R * 0.1);
  ctx.lineTo(R * 0.1, R * 0.85);
  ctx.lineTo(-R * 0.5, R * 0.2);
  ctx.closePath();
  ctx.fill();
}

// A rolling lump of fire: overlapping hot blobs, densest in the middle, with a ragged edge.
// White (particles.js colors it by its age); one variation per seed.
function billow(seed) {
  return (ctx, R) => {
    const rand = mulberry32(seed);
    for (let i = 0; i < 18; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 0.7) * R * 0.45;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const rad = R * (0.22 + rand() * 0.3) * (1 - r / (R * 0.9));
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

// Additive effects. Cells: 0 soft dot, 1 to 3 stars, 4 ring, 5 streak, 6 shard, 8 to 11 fire
// billows.
function fxAtlas() {
  return atlas([
    softDot, star(4, 0, 6), star(6, 0.3, 4), star(5, 0.7, 5), ring, streak, shard, () => {},
    billow(71), billow(72), billow(73), billow(74),
  ]);
}

// Lumpy grey puff for death smoke and dust; one variation per seed.
function puff(seed) {
  return (ctx, R) => {
    const rand = mulberry32(seed);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * R * 0.36;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const rad = R * (0.36 + rand() * 0.28);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const v = 200 + Math.floor(rand() * 55);
      g.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

// A chip of concrete or dirt: a solid lumpy polygon.
function chip(ctx, R) {
  const rand = mulberry32(61);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = R * (0.45 + rand() * 0.4);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

// A long thin splinter of wood, lighter along one edge.
function splinter(ctx, R) {
  ctx.rotate(0.6);
  ctx.fillStyle = 'rgba(200,200,200,1)';
  ctx.beginPath();
  ctx.moveTo(-R * 0.95, 0);
  ctx.lineTo(-R * 0.2, -R * 0.16);
  ctx.lineTo(R * 0.95, -R * 0.04);
  ctx.lineTo(R * 0.3, R * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(-R * 0.9, -R * 0.02);
  ctx.lineTo(-R * 0.2, -R * 0.15);
  ctx.lineTo(R * 0.9, -R * 0.05);
  ctx.closePath();
  ctx.fill();
}

// A gob of mud with a couple of droplets.
function splat(ctx, R) {
  const rand = mulberry32(63);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2;
    const r = R * (0.55 + rand() * 0.3);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, R * (0.08 + rand() * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
}

// A bullet mark: a dark hole in a fainter scuffed ring with a few hairline cracks. Black with
// alpha only: marks darken whatever they lie on, so they keep its light and shade.
function hole(ctx, R) {
  const rand = mulberry32(64);
  const rim = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.95);
  rim.addColorStop(0, 'rgba(0,0,0,0.45)');
  rim.addColorStop(0.55, 'rgba(0,0,0,0.2)');
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rim;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.25);
    ctx.lineTo(Math.cos(a + 0.2) * R * (0.6 + rand() * 0.3), Math.sin(a + 0.2) * R * (0.6 + rand() * 0.3));
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.38);
  core.addColorStop(0, 'rgba(0,0,0,1)');
  core.addColorStop(0.7, 'rgba(0,0,0,0.95)');
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.fillRect(-R, -R, R * 2, R * 2);
}

// A blast scorch: a dark blotch with a ragged edge and soot streaks thrown outward.
function scorch(ctx, R) {
  const rand = mulberry32(65);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.8) * R * 0.5;
    const rad = R * (0.18 + rand() * 0.25);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = R * (0.3 + rand() * 0.2);
    const r1 = R * (0.65 + rand() * 0.3);
    ctx.lineWidth = 2 + rand() * 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }
}

// Alpha-blended effects. Cells: 0 to 3 puffs, 4 chip, 5 splinter, 6 splat, 7 bullet mark,
// 8 scorch.
function smokeAtlas() {
  return atlas([puff(91), puff(92), puff(93), puff(94), chip, splinter, splat, hole, scorch]);
}

// Four-point muzzle flash star.
function flash() {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.translate(S / 2, S / 2);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    const g = ctx.createLinearGradient(0, 0, S / 2, 0);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.4, 'rgba(255,180,80,0.8)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(S / 2, 0);
    ctx.lineTo(0, 7);
    ctx.closePath();
    ctx.fill();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.22);
  core.addColorStop(0, 'rgba(255,255,240,1)');
  core.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.22, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c, { repeat: false });
}

// Painting takes a while, so each texture is painted once per page load. Later matches get
// clones (same canvas, new texture), since every match has its own renderer.
const painted = new Map();
// Each painted texture's normal map canvas, by the same key (only textures painted with relief).
const normals = new Map();
function keep(name, paint) {
  const t = painted.get(name);
  if (t) return t.clone();
  lastNormal = null;
  const fresh = paint();
  painted.set(name, fresh);
  if (lastNormal) normals.set(name, lastNormal);
  return fresh;
}

// size: texels per side of the main surface textures (the quality preset's textureSize).
// The textures of a match, by name: [cache key, painter]. size: texels per side of the main
// surface textures (the quality preset's textureSize).
function painters(S) {
  return {
    ground: [`ground@${S}`, () => ground(S)],
    metal: [`metal@${S}`, () => panels(S, '#727d86', '#3e454b', '#a2adb6', 81)],
    metalDark: [`metalDark@${S}`, () => panels(S, '#41484f', '#24282c', '#626b73', 82)],
    hazard: ['hazard', hazard],
    plank: [`plank@${S}`, () => planks(S)],
    concrete: [`concrete@${S}`, () => concrete(S)],
    crate: [`crate@${S}`, () => crate(S)],
    mud: ['mud', mud],
    slab: [`slab@${S}`, () => slab(S)],
    grass: [`grass@${S}`, () => grass(S)],
    rock: [`rock@${S}`, () => rock(S)],
    blades: ['blades', blades],
    belt: ['belt', belt],
    net: ['net', net],
    rope: ['rope', rope],
    flame: ['flame', flame],
    planet: ['planet', planet],
    spark: ['spark', spark],
    fxAtlas: ['fxAtlas', fxAtlas],
    smokeAtlas: ['smokeAtlas', smokeAtlas],
    flash: ['flash', flash],
    grime: ['grime', grimeMap],
  };
}

// With `normalMaps`, each relief-painted surface also gets its normal map as `<name>Normal`.
export function createTextures(size = 512, { normalMaps = false } = {}) {
  const out = {};
  for (const [name, [key, paint]] of Object.entries(painters(size))) {
    out[name] = keep(key, paint);
    const n = normalMaps && normals.get(key);
    if (n) {
      const t = toTexture(n, { srgb: false });
      // Same tiling as the color map.
      t.repeat.copy(out[name].repeat);
      out[`${name}Normal`] = t;
    }
  }
  return out;
}

// Paints a size's textures ahead of time (on the title screen), one per idle moment, so the
// first match only clones them: at 512 px they take a few hundred ms in all.
export function prepaintTextures(size) {
  const queue = Object.values(painters(size)).filter(([key]) => !painted.has(key));
  const later = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 30));
  const next = () => {
    const job = queue.shift();
    if (!job) return;
    if (!painted.has(job[0])) keep(job[0], job[1]);
    later(next);
  };
  later(next);
}

export function applyAnisotropy(textures, anisotropy) {
  for (const t of Object.values(textures)) {
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
}
