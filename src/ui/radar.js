// The motion tracker: a round radar in the corner of each view, like Halo's. Enemies within
// RANGE show as red dots placed around you (forward is up), but only while they're moving
// faster than a sneak or have just fired: standing still or crouch-walking keeps you off it.
// A dot fades out over a moment once its player goes quiet. Drawn on a small 2D canvas per view.

const RANGE = 25;
// Faster than this (m/s, on the ground or in the air) shows up; crouch speed is 3.6.
const SNEAK = 4;
// Crouched, only this fast shows (a slide, a fall), not crouch-walking.
const CROUCH_SHOW = 6;
// A shot shows its shooter for this long (s).
const FIRE_SHOW = 1;
const FADE = 1.5;
// Further above or below than this (m), a dot is drawn as a ring.
const LEVEL = 3;
const PULSE = 1.6;

export class Radar {
  constructor(root) {
    this.el = document.createElement('canvas');
    this.el.className = 'hud-radar';
    root.appendChild(this.el);
    this.ctx = this.el.getContext('2d');
    this.size = 0;
    this.px = 0;
    // Per player id: how strongly their dot shows (1 just seen, fading to 0).
    this.seen = new Float32Array(64);
    this.lastT = 0;
    this.visible = true;
  }

  // scale: the view's HUD scale.
  layout(scale) {
    const size = Math.round(Math.max(84, 124 * scale));
    if (size === this.size) return;
    this.size = size;
    this.px = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
    this.el.width = this.px;
    this.el.height = this.px;
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;
  }

  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.el.style.display = on ? '' : 'none';
  }

  update(player, game) {
    const now = game.time;
    const dt = Math.min(0.25, Math.max(0, now - this.lastT));
    this.lastT = now;
    const show = player.alive && !player.guiding;
    this.setVisible(show);
    if (!show || !this.px) return;

    const ctx = this.ctx;
    const s = this.px;
    const c = s / 2;
    const r = c - s * 0.03;
    ctx.clearRect(0, 0, s, s);
    // Backing and rings, in the visor's cyan like Halo's.
    const back = ctx.createRadialGradient(c, c, r * 0.1, c, c, r);
    back.addColorStop(0, 'rgba(60, 150, 190, 0.42)');
    back.addColorStop(1, 'rgba(30, 90, 125, 0.32)');
    ctx.fillStyle = back;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.strokeStyle = 'rgba(190, 235, 255, 0.55)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(190, 235, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(c, c, r / 2, 0, Math.PI * 2);
    ctx.moveTo(c, c - r);
    ctx.lineTo(c, c + r);
    ctx.moveTo(c - r, c);
    ctx.lineTo(c + r, c);
    ctx.stroke();
    // The sweep: a ring that runs out from the middle every PULSE seconds.
    const ph = (now % PULSE) / PULSE;
    ctx.strokeStyle = `rgba(140, 220, 255, ${(0.35 * (1 - ph)).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(c, c, r * ph, 0, Math.PI * 2);
    ctx.stroke();

    // Enemies, turned so the way you face is up.
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const k = r / RANGE;
    const dot = Math.max(2.5, s * 0.045);
    for (const p of game.players) {
      if (p === player) continue;
      const id = p.id;
      const dx = p.center.x - player.center.x;
      const dz = p.center.z - player.center.z;
      const d2 = dx * dx + dz * dz;
      let a = this.seen[id];
      if (p.alive && d2 <= RANGE * RANGE) {
        const v = p.speed();
        const loud = now - p.weapon.lastShotT < FIRE_SHOW || v > (p.crouched ? CROUCH_SHOW : SNEAK);
        a = loud ? 1 : Math.max(0, a - FADE * dt);
      } else {
        a = 0;
      }
      this.seen[id] = a;
      if (a <= 0) continue;
      // Right of the facing is +x on the radar, ahead is up.
      const x = c + (dx * -fz + dz * fx) * k;
      const y = c - (dx * fx + dz * fz) * k;
      const off = Math.abs(p.center.y - player.center.y) > LEVEL;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(255, 60, 40, 0.3)';
      ctx.beginPath();
      ctx.arc(x, y, dot * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      if (off) {
        ctx.lineWidth = Math.max(1, dot * 0.45);
        ctx.strokeStyle = '#ff4a34';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ff4a34';
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // You, in the middle, pointing ahead.
    ctx.fillStyle = 'rgba(255, 226, 120, 0.95)';
    ctx.beginPath();
    ctx.moveTo(c, c - dot * 1.6);
    ctx.lineTo(c + dot, c + dot);
    ctx.lineTo(c - dot, c + dot);
    ctx.closePath();
    ctx.fill();
    // Its range, under the edge.
    ctx.font = `600 ${Math.round(s * 0.11)}px Bahnschrift, 'DIN Alternate', 'Arial Narrow', sans-serif`;
    ctx.fillStyle = 'rgba(214, 243, 255, 0.85)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${RANGE}m`, s * 0.99, s * 0.99);
  }

  dispose() {
    this.el.remove();
  }
}
