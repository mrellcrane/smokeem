import { settings, onSettingsChange } from '../settings.js';

// Sound effects. Guns, reloads and explosions are CC0 recordings (src/audio/samples, see
// CREDITS.md); UI and body sounds are synthesized into buffers once with WebAudio.
// The AudioContext can only start from a user gesture, so call unlock() from a click.
//
// Sounds can be placed in the world: play(name, { at, source }) fades with distance from the
// nearest local player, muffles far away sounds, pans when there's one local player, and
// sends guns and blasts into a short arena echo. Sounds made by a local player play up close.

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

// Synthesized UI and body sounds (no files).
const SOUNDS = {
  empty: (ctx) => synth(ctx, 0.04, (t) => 0.5 * click(t, 0, 2300, 180)),
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
  throw: (ctx) => synth(ctx, 0.25, (t) => 0.35 * noise() * Math.sin((Math.PI * t) / 0.25) * Math.exp(-t * 4)),
  clink: (ctx) => synth(ctx, 0.12, (t) => 0.35 * click(t, 0, 620, 45) + 0.2 * click(t, 0, 1450, 60)),
  swing: (ctx) => synth(ctx, 0.22, (t) => 0.3 * noise() * Math.sin((Math.PI * t) / 0.22)),
  bash: (ctx) =>
    synth(ctx, 0.2, (t) => 0.9 * Math.sin(t * 120 * Math.PI * 2) * Math.exp(-t * 22) + 0.4 * noise() * Math.exp(-t * 30)),
  pickup: (ctx) => synth(ctx, 0.2, (t) => 0.3 * click(t, 0, 880, 25) + 0.3 * click(t, 0.07, 1320, 25)),
  burn: (ctx) =>
    synth(ctx, 0.3, (t) => {
      const pop = Math.random() < 0.004 ? 1 : 0;
      return (0.25 * noise() + pop * 0.8) * Math.sin((Math.PI * t) / 0.3);
    }),
};

// Recorded sounds, grouped by name: shot-1.wav ... shot-4.wav are variations of 'shot'.
const SAMPLE_URLS = import.meta.glob('./samples/*.wav', { query: '?url', import: 'default', eager: true });

// Per-sound mix: volume, distance where it's at half volume, echo send, and a voice cap.
const MIX = {
  shot: { volume: 0.9, ref: 16, wet: 0.35, voices: 14 },
  shotgun: { volume: 1, ref: 18, wet: 0.4, voices: 6 },
  pump: { volume: 0.6, ref: 6, voices: 4 },
  launch: { volume: 0.7, ref: 20, wet: 0.35, voices: 4 },
  boom: { volume: 0.95, ref: 28, wet: 0.5, voices: 6 },
  reload: { volume: 0.5, ref: 5, voices: 4 },
  shell: { volume: 0.8, ref: 5, voices: 4 },
  swap: { volume: 0.5, ref: 5, voices: 4 },
  clink: { ref: 8, voices: 6 },
  throw: { ref: 6 },
  swing: { ref: 6 },
  bash: { ref: 8 },
  death: { ref: 14, wet: 0.2 },
};
const DEFAULT_MIX = { volume: 1, ref: 10, wet: 0, voices: 8 };

// Minimum seconds between two plays of the same sound, so rapid events don't pile up.
const MIN_GAP = { hit: 0.025, head: 0.04, burn: 0.22, hurt: 0.12, shieldCharge: 0.5, clink: 0.06, boom: 0.05 };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.lastPlayed = {};
    this.voices = {};
    // Local players (the game sets this): sounds fade by distance to the nearest one.
    this.listeners = [];
    // Start downloading the recordings right away; they're decoded once audio unlocks.
    this.files = Object.entries(SAMPLE_URLS).map(([path, url]) => ({
      name: path.match(/([a-z]+)(?:-\d+)?\.wav$/i)[1],
      data: fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
    }));
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
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = settings.volume;
      // A limiter, so a room full of gunfire never clips.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      this.master.connect(limiter).connect(ctx.destination);
      // Arena echo: metal walls give a few quick slaps, then a short outdoor tail.
      this.echo = ctx.createConvolver();
      this.echo.buffer = arenaImpulse(ctx);
      this.echoIn = ctx.createGain();
      this.echoIn.gain.value = 0.6;
      this.echoIn.connect(this.echo).connect(this.master);
      for (const [name, make] of Object.entries(SOUNDS)) this.buffers[name] = [make(ctx)];
      for (const f of this.files) {
        f.data
          .then((data) => (data ? decode(ctx, data) : null))
          .then((buf) => {
            if (buf) (this.buffers[f.name] ??= []).push(buf);
          })
          .catch(() => {});
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // opts: volume, rate, delay (seconds), at (world position), source (who made the sound).
  play(name, { volume = 1, rate = 1, delay = 0, at = null, source = null } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const list = this.buffers[name];
    if (!list?.length) return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0;
    if (gap && now - (this.lastPlayed[name] ?? -1) < gap) return;
    this.lastPlayed[name] = now;
    const mix = MIX[name] ?? DEFAULT_MIX;

    // Where is it relative to us? Local players' own sounds are always up close.
    let dist = 0;
    let pan = 0;
    if (at && !(source && this.listeners.includes(source))) {
      let nearest = null;
      dist = Infinity;
      for (const l of this.listeners) {
        const d = l.camera.position.distanceTo(at);
        if (d < dist) {
          dist = d;
          nearest = l;
        }
      }
      if (!nearest) dist = 0;
      else if (this.listeners.length === 1 && dist > 0.5) {
        // Pan by direction relative to where the one local player faces.
        const p = nearest.camera.position;
        const ang = Math.atan2(at.x - p.x, at.z - p.z) - (nearest.yaw + Math.PI);
        pan = -Math.sin(ang) * Math.min(1, dist / 4) * 0.75;
      }
    }
    const ref = mix.ref ?? DEFAULT_MIX.ref;
    const falloff = 1 / (1 + Math.pow(dist / ref, 1.6));
    const gain = volume * (mix.volume ?? 1) * falloff;
    if (gain < 0.004) return;

    // Voice cap per sound: the oldest voice makes room for the new one.
    const voices = (this.voices[name] ??= []);
    if (voices.length >= (mix.voices ?? DEFAULT_MIX.voices)) {
      const old = voices.shift();
      try {
        old.stop();
      } catch {
        // Already finished.
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = rate;
    let node = src;
    // Far away sounds lose their highs.
    if (dist > 6) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(1200, 20000 * Math.exp(-dist / 40));
      node = node.connect(lp);
    }
    if (pan && ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = pan;
      node = node.connect(sp);
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g).connect(this.master);
    // The echo fades slower than the direct sound, so distant shots sound distant.
    const wet = mix.wet ?? 0;
    if (wet) {
      const w = ctx.createGain();
      w.gain.value = volume * (mix.volume ?? 1) * wet * (1 / (1 + Math.pow(dist / (ref * 2.5), 1.3)));
      node.connect(w).connect(this.echoIn);
    }
    voices.push(src);
    src.onended = () => {
      const i = voices.indexOf(src);
      if (i >= 0) voices.splice(i, 1);
    };
    src.start(now + delay);
  }
}

function decode(ctx, data) {
  // Callback form works in older Safari too.
  return new Promise((resolve) => ctx.decodeAudioData(data, resolve, () => resolve(null)));
}

// A stereo impulse response for the echo: early slaps off the arena walls, then a diffuse
// tail that darkens as it fades.
function arenaImpulse(ctx) {
  const rate = ctx.sampleRate;
  const len = Math.floor(1.3 * rate);
  const buf = ctx.createBuffer(2, len, rate);
  const taps = [
    [0.019, 0.5, 0],
    [0.034, 0.42, 1],
    [0.058, 0.36, 0],
    [0.083, 0.3, 1],
    [0.121, 0.22, 0],
    [0.166, 0.16, 1],
    [0.214, 0.11, 0],
  ];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      // Air soaks up the highs over time: the low-pass closes as the tail goes on.
      const k = Math.min(0.97, 0.15 + t * 0.9);
      lp = lp * k + noise() * (1 - k);
      const onset = Math.min(1, t / 0.012);
      d[i] = lp * 2.2 * Math.exp(-t / 0.32) * onset;
    }
    for (const [t, g, side] of taps) {
      const i = Math.floor(t * rate);
      const level = side === ch ? g : g * 0.55;
      for (let j = 0; j < 48 && i + j < len; j++) d[i + j] += level * noise() * Math.exp(-j / 10);
    }
  }
  return buf;
}
