import * as THREE from 'three';
import { mulberry32 } from '../util/rng.js';

// Every texture in the game is drawn here on a canvas at load time. All tile seamlessly.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
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

export function createTextures() {
  return {
    ground: ground(),
    metal: panels('#727d86', '#3e454b', '#a2adb6', 81),
    metalDark: panels('#41484f', '#24282c', '#626b73', 82),
    hazard: hazard(),
    plank: planks(),
    concrete: concrete(),
    crate: crate(),
    mud: mud(),
    net: net(),
    rope: rope(),
    flame: flame(),
    planet: planet(),
  };
}

export function applyAnisotropy(textures, anisotropy) {
  for (const t of Object.values(textures)) {
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
}
