import { clockText, ordinal } from '../match.js';
import { feedRow, visibleFeed } from './hud.js';

// The match info panel in the spare bottom-right quadrant of 3-player split-screen: the clock,
// a live scoreboard, the kill feed and an arena map showing only the local players. Plain DOM
// plus a 2D canvas; the map's background is sampled from the physics world once at load.

const MAP_RES = 0.5; // meters per map pixel
const UPDATE_EVERY = 1 / 12;

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

export class InfoPanel {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'info-panel';
    this.el.innerHTML = `
      <div class="ip-head"><b>${game.map.name}</b><span class="ip-mode">${game.mode === 'oysters' ? 'Rocky Mountain Oysters' : 'Free-for-all'}</span><span class="ip-clock"></span></div>
      <div class="ip-body">
        <canvas class="ip-map"></canvas>
        <div class="ip-side">
          <table class="ip-score"><thead><tr><th></th><th></th><th>Score</th><th>K</th><th>A</th><th>D</th></tr></thead><tbody></tbody></table>
          <div class="ip-feed"></div>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.canvas = this.el.querySelector('.ip-map');
    this.ctx = this.canvas.getContext('2d');
    this.tbody = this.el.querySelector('tbody');
    this.clock = this.el.querySelector('.ip-clock');
    this.feed = this.el.querySelector('.ip-feed');
    this._feedKey = '';
    this._clock = '';
    this.background = buildMapImage(game);
    this.t = UPDATE_EVERY;
    this._rect = '';
    this._rows = '';
  }

  layout(rect, totalHeight) {
    const key = `${rect.x},${rect.y},${rect.w},${rect.h},${totalHeight}`;
    if (key === this._rect) return;
    this._rect = key;
    const s = this.el.style;
    s.left = `${rect.x}px`;
    s.top = `${totalHeight - rect.y - rect.h}px`;
    s.width = `${rect.w}px`;
    s.height = `${rect.h}px`;
    // The panel has a whole quadrant to itself, so its text can be bigger than the views' HUDs.
    s.setProperty('--hud-scale', Math.max(0.9, Math.min(1.4, rect.h / 400)).toFixed(3));
    // Square map filling the panel height under the header.
    const size = Math.max(64, Math.floor(Math.min(rect.h * 0.8, rect.w * 0.5)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.t = UPDATE_EVERY;
  }

  update(dt) {
    this.t += dt;
    if (this.t < UPDATE_EVERY) return;
    this.t = 0;
    this.drawMap();
    this.drawScores();
  }

  drawMap() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    ctx.clearRect(0, 0, W, W);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.background, 0, 0, W, W);
    const half = this.game.arena.half;
    const k = W / (half * 2);
    const r = Math.max(5, W * 0.035);
    for (const p of this.game.humans) {
      if (!p.alive) continue;
      const x = (p.center.x + half) * k;
      const y = (p.center.z + half) * k;
      // Arrow pointing the way the player faces (forward is -z at yaw 0).
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-p.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.3);
      ctx.lineTo(r * 0.9, r);
      ctx.lineTo(0, r * 0.45);
      ctx.lineTo(-r * 0.9, r);
      ctx.closePath();
      ctx.fillStyle = hex(p.color);
      ctx.strokeStyle = '#0b0907';
      ctx.lineWidth = Math.max(1.5, r * 0.3);
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
  }

  drawScores() {
    const { game } = this;
    const m = game.match;
    let html = '';
    for (const s of m.standings()) {
      const p = s.player;
      const local = game.humans.includes(p) ? ' class="local"' : '';
      html += `<tr${local}><td>${ordinal(s.place)}</td><td><i style="background:${hex(p.color)}"></i>${p.name}</td><td>${p.stats.score}</td><td>${p.stats.kills}</td><td>${p.stats.assists}</td><td>${p.stats.deaths}</td></tr>`;
    }
    if (html !== this._rows) {
      this._rows = html;
      this.tbody.innerHTML = html;
    }
    const clock = m.timed ? clockText(m.timeLeft) : '';
    if (clock !== this._clock) {
      this._clock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('hot', m.timed && m.timeLeft <= 30);
    }
    const feed = visibleFeed(m, game.time);
    if (feed.key !== this._feedKey) {
      this._feedKey = feed.key;
      this.feed.innerHTML = m.feed.slice(feed.first).map(feedRow).join('');
    }
  }

  dispose() {
    this.el.remove();
  }
}

// Top-down picture of the arena: floor heights shaded light to dark, edges outlined, mud and
// fire tinted. About 14k downward ray casts, done once.
function buildMapImage(game) {
  const { world } = game.physics;
  const ray = new game.physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const half = game.arena.half;
  const n = Math.round((half * 2) / MAP_RES);
  const heights = new Float32Array(n * n);
  const top = 14;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      ray.origin.x = -half + (i + 0.5) * MAP_RES;
      ray.origin.y = top;
      ray.origin.z = -half + (j + 0.5) * MAP_RES;
      const hit = world.castRay(ray, top + 3, true, game.shotFilter, undefined, undefined, undefined, game.notBody);
      heights[j * n + i] = hit ? top - hit.timeOfImpact : -3;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(n, n);
  const feet = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = heights[j * n + i];
      feet.x = -half + (i + 0.5) * MAP_RES;
      feet.y = h;
      feet.z = -half + (j + 0.5) * MAP_RES;
      let r;
      let g;
      let b;
      if (h > 9) {
        // Perimeter walls.
        [r, g, b] = [30, 26, 24];
      } else if (game.zones.inFire(feet, 1.8, 0)) {
        [r, g, b] = [230, 110, 30];
      } else if (game.zones.inMud(feet)) {
        [r, g, b] = [96, 70, 44];
      } else {
        const t = Math.max(0, Math.min(1, h / 7));
        r = 70 + t * 150;
        g = 74 + t * 140;
        b = 78 + t * 120;
      }
      // Outline steps up and down so walls and platforms read clearly.
      let edge = 0;
      if (i > 0) edge = Math.max(edge, Math.abs(h - heights[j * n + i - 1]));
      if (j > 0) edge = Math.max(edge, Math.abs(h - heights[(j - 1) * n + i]));
      if (edge > 0.4) {
        r *= 0.45;
        g *= 0.45;
        b *= 0.45;
      }
      const o = (j * n + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
