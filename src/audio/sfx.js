import { settings, onSettingsChange } from '../settings.js';

// Placeholder sound effects, synthesized into buffers once with WebAudio (no files).
// The AudioContext can only start from a user gesture, so call unlock() from a click.

function synth(ctx, seconds, fn) {
  const rate = ctx.sampleRate;
  const n = Math.max(1, Math.floor(seconds * rate));
  const buf = ctx.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  const state = { phase: 0, phase2: 0, prev: 0 };
  for (let i = 0; i < n; i++) d[i] = fn(i / rate, state, rate);
  // Soft clip so stacked layers never crackle.
  for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i]);
  return buf;
}

const noise = () => Math.random() * 2 - 1;

function click(t, at, freq, decay) {
  if (t < at) return 0;
  const u = t - at;
  return Math.sin(u * freq * Math.PI * 2) * Math.exp(-u * decay);
}

const SOUNDS = {
  shot: (ctx) =>
    synth(ctx, 0.18, (t, s, rate) => {
      const f = 150 * Math.exp(-t * 14) + 48;
      s.phase += (f * Math.PI * 2) / rate;
      const n = noise();
      const crack = (n - s.prev) * Math.exp(-t * 90);
      s.prev = n;
      return 0.5 * n * Math.exp(-t * 40) + 0.75 * Math.sin(s.phase) * Math.exp(-t * 20) + 0.35 * crack;
    }),
  empty: (ctx) => synth(ctx, 0.04, (t) => 0.5 * click(t, 0, 2300, 180)),
  reload: (ctx) =>
    synth(ctx, 1.7, (t) => {
      const n = noise() * 0.3;
      return (
        (click(t, 0.12, 1400, 120) + n * Math.exp(-Math.max(0, t - 0.12) * 60) * (t > 0.12 ? 1 : 0)) * 0.6 +
        (click(t, 1.15, 1800, 140) + n * Math.exp(-Math.max(0, t - 1.15) * 70) * (t > 1.15 ? 1 : 0)) * 0.7 +
        click(t, 1.5, 900, 90) * 0.6
      );
    }),
  hit: (ctx) => synth(ctx, 0.06, (t) => 0.45 * click(t, 0, 1750, 70)),
  head: (ctx) => synth(ctx, 0.1, (t) => 0.4 * click(t, 0, 2600, 45) + 0.25 * click(t, 0, 3900, 60)),
  kill: (ctx) =>
    synth(ctx, 0.42, (t) => 0.45 * click(t, 0, 660, 14) + 0.5 * click(t, 0.11, 990, 10)),
  shieldBreak: (ctx) =>
    synth(ctx, 0.45, (t, s, rate) => {
      const f = 1300 * Math.exp(-t * 5) + 260;
      s.phase += (f * Math.PI * 2) / rate;
      return 0.5 * noise() * Math.sin(t * 2400 * Math.PI * 2) * Math.exp(-t * 9) + 0.4 * Math.sin(s.phase) * Math.exp(-t * 6);
    }),
  shieldCharge: (ctx) =>
    synth(ctx, 0.6, (t, s, rate) => {
      const f = 300 + 1100 * (t / 0.6) * (t / 0.6);
      s.phase += (f * Math.PI * 2) / rate;
      return 0.22 * Math.sin(s.phase) * Math.sin((Math.PI * t) / 0.6);
    }),
  hurt: (ctx) => synth(ctx, 0.14, (t) => 0.7 * Math.sin(t * 90 * Math.PI * 2) * Math.exp(-t * 24) + 0.2 * noise() * Math.exp(-t * 40)),
  death: (ctx) =>
    synth(ctx, 0.9, (t, s, rate) => {
      const f = 420 * Math.exp(-t * 3) + 60;
      s.phase += (f * Math.PI * 2) / rate;
      return 0.5 * Math.sin(s.phase) * Math.exp(-t * 3) + 0.35 * noise() * Math.exp(-t * 5);
    }),
  burn: (ctx) =>
    synth(ctx, 0.3, (t) => {
      const pop = Math.random() < 0.004 ? 1 : 0;
      return (0.25 * noise() + pop * 0.8) * Math.sin((Math.PI * t) / 0.3);
    }),
};

// Minimum seconds between two plays of the same sound, so rapid events don't pile up.
const MIN_GAP = { hit: 0.025, head: 0.04, burn: 0.22, hurt: 0.12, shieldCharge: 0.5 };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.lastPlayed = {};
    this._off = onSettingsChange((s, patch) => {
      if ('volume' in patch && this.master) this.master.gain.value = s.volume;
    });
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = settings.volume;
      this.master.connect(this.ctx.destination);
      for (const [name, make] of Object.entries(SOUNDS)) this.buffers[name] = make(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  play(name, { volume = 1, rate = 1 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buf = this.buffers[name];
    if (!buf) return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0;
    if (gap && now - (this.lastPlayed[name] ?? -1) < gap) return;
    this.lastPlayed[name] = now;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (volume !== 1) {
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.master);
    } else {
      src.connect(this.master);
    }
    src.start(now);
  }
}
