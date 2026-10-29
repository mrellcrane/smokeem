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

function ground() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(11);
  ctx.fillStyle = '#9a6a48';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 70, 8, 34, ['#7d5236', '#ab7a52', '#8c5e3e'], 0.35);
  blobs(ctx, S, S, rand, 400, 0.6, 2.2, ['#5c3b26', '#c89a72', '#6e4a33'], 0.8);
  grain(ctx, S, S, 22, rand);
  return toTexture(c);
}

function panels(base, seam, highlight, seed) {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // Subtle vertical streaks.
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.06 + rand() * 0.06;
    ctx.fillStyle = rand() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(rand() * S, 0, 1 + rand() * 3, S);
  }
  ctx.globalAlpha = 1;
  const P = S / 2;
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x = px * P;
      const y = py * P;
      ctx.fillStyle = seam;
      ctx.fillRect(x, y, P, 3);
      ctx.fillRect(x, y, 3, P);
      ctx.fillStyle = highlight;
      ctx.fillRect(x + 3, y + 3, P - 3, 1);
      ctx.fillRect(x + 3, y + 3, 1, P - 3);
      // Rivets.
      for (const [rx, ry] of [[10, 10], [P - 10, 10], [10, P - 10], [P - 10, P - 10]]) {
        ctx.fillStyle = seam;
        ctx.beginPath();
        ctx.arc(x + rx, y + ry, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = highlight;
        ctx.beginPath();
        ctx.arc(x + rx - 0.8, y + ry - 0.8, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  grain(ctx, S, S, 12, rand);
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

function planks() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(21);
  const boards = 4;
  const bh = S / boards;
  const tones = ['#8a6a45', '#7d5e3c', '#957450', '#836340'];
  for (let i = 0; i < boards; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.fillRect(0, i * bh, S, bh);
    // Grain lines.
    for (let g = 0; g < 14; g++) {
      ctx.globalAlpha = 0.18 + rand() * 0.15;
      ctx.strokeStyle = rand() > 0.5 ? '#5e4329' : '#a7845d';
      ctx.lineWidth = 1;
      const y = i * bh + 4 + rand() * (bh - 8);
      const amp = 1 + rand() * 2;
      const freq = 0.01 + rand() * 0.03;
      const ph = rand() * 10;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const yy = y + Math.sin(x * freq * Math.PI * 2 / 8 + ph) * amp;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Gap between boards.
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(0, i * bh, S, 3);
    // Bolts.
    ctx.fillStyle = '#4a4a4a';
    for (const bx of [24, 152]) {
      ctx.beginPath();
      ctx.arc(bx, i * bh + bh / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  grain(ctx, S, S, 14, rand);
  return toTexture(c);
}

function concrete() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(31);
  ctx.fillStyle = '#a19f98';
  ctx.fillRect(0, 0, S, S);
  blobs(ctx, S, S, rand, 60, 6, 30, ['#8f8d86', '#b2b0a9', '#97958d'], 0.3);
  blobs(ctx, S, S, rand, 250, 0.5, 1.6, ['#6f6d68', '#c4c2bb'], 0.7);
  ctx.fillStyle = '#7a7872';
  ctx.fillRect(0, 0, S, 2);
  ctx.fillRect(0, 0, 2, S);
  grain(ctx, S, S, 14, rand);
  return toTexture(c);
}

function crate() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(41);
  ctx.fillStyle = '#2d3238';
  ctx.fillRect(0, 0, S, S);
  const b = 22;
  ctx.fillStyle = '#c0601d';
  ctx.fillRect(b, b, S - b * 2, S - b * 2);
  // Diagonal brace.
  ctx.strokeStyle = '#8f4512';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(b + 6, b + 6);
  ctx.lineTo(S - b - 6, S - b - 6);
  ctx.stroke();
  // Stencil marks.
  ctx.fillStyle = '#e9d9b8';
  ctx.fillRect(S - b - 70, b + 14, 52, 10);
  ctx.fillRect(S - b - 70, b + 30, 30, 6);
  // Corner bolts.
  ctx.fillStyle = '#9aa1a8';
  for (const [x, y] of [[11, 11], [S - 11, 11], [11, S - 11], [S - 11, S - 11]]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  blobs(ctx, S, S, rand, 40, 2, 8, ['#4a3a2a', '#20242a'], 0.25);
  grain(ctx, S, S, 14, rand);
  return toTexture(c, { repeat: false });
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

// Additive effects. Cells: 0 soft dot, 1 to 3 stars, 4 ring, 5 streak, 6 shard.
function fxAtlas() {
  return atlas([softDot, star(4, 0, 6), star(6, 0.3, 4), star(5, 0.7, 5), ring, streak, shard]);
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

// Alpha-blended effects. Cells: 0 to 3 puffs.
function smokeAtlas() {
  return atlas([puff(91), puff(92), puff(93), puff(94)]);
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
function keep(name, paint) {
  const t = painted.get(name);
  if (t) return t.clone();
  const fresh = paint();
  painted.set(name, fresh);
  return fresh;
}

export function createTextures() {
  return {
    ground: keep('ground', ground),
    metal: keep('metal', () => panels('#727d86', '#3e454b', '#a2adb6', 81)),
    metalDark: keep('metalDark', () => panels('#41484f', '#24282c', '#626b73', 82)),
    hazard: keep('hazard', hazard),
    plank: keep('plank', planks),
    concrete: keep('concrete', concrete),
    crate: keep('crate', crate),
    mud: keep('mud', mud),
    net: keep('net', net),
    rope: keep('rope', rope),
    flame: keep('flame', flame),
    planet: keep('planet', planet),
    spark: keep('spark', spark),
    fxAtlas: keep('fxAtlas', fxAtlas),
    smokeAtlas: keep('smokeAtlas', smokeAtlas),
    flash: keep('flash', flash),
  };
}

export function applyAnisotropy(textures, anisotropy) {
  for (const t of Object.values(textures)) {
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
}
