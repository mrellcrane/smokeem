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
  // Rotisserie barrels winding up (a rising whine) and down.
  spinUp: (ctx) =>
    synth(ctx, 0.5, (t, s, rate) => {
      const f = 70 + 190 * (t / 0.5) * (t / 0.5);
      s.phase += f / rate;
      const saw = (s.phase % 1) * 2 - 1;
      return 0.28 * saw * Math.min(1, t / 0.05) + 0.06 * noise() * (t / 0.5);
    }),
  spinDown: (ctx) =>
    synth(ctx, 1.0, (t, s, rate) => {
      const f = 260 * Math.exp(-t * 1.8) + 40;
      s.phase += f / rate;
      const saw = (s.phase % 1) * 2 - 1;
      return 0.25 * saw * Math.exp(-t * 2.2) * Math.min(1, (1 - t) / 0.1);
    }),
  // Brander: a band of hissing noise over a mains-like hum (re-triggered while firing, pitched
  // up as it heats), and the vent hiss on reload.
  sizzle: (ctx) =>
    synth(ctx, 0.3, (t, s, rate) => {
      s.prev += (noise() - s.prev) * 0.45;
      s.phase2 += (s.prev - s.phase2) * 0.06;
      s.phase += (120 * Math.PI * 2) / rate;
      const env = Math.min(1, t / 0.02) * Math.min(1, (0.3 - t) / 0.05);
      return env * (0.9 * (s.prev - s.phase2) + 0.22 * Math.sin(s.phase) + 0.06 * Math.sign(Math.sin(s.phase)));
    }),
  vent: (ctx) =>
    synth(ctx, 0.8, (t, s) => {
      s.prev += (noise() - s.prev) * (0.7 - 0.55 * (t / 0.8));
      return 0.55 * s.prev * Math.min(1, t / 0.03) * Math.exp(-t * 2.6);
    }),
  // Swarm Jar: a cork pop on the throw, glass smashing, the swarm's buzz, and a swat.
  pop: (ctx) => synth(ctx, 0.09, (t) => 0.6 * click(t, 0, 420, 55) + 0.35 * noise() * Math.exp(-t * 90)),
  smash: (ctx) =>
    synth(
      ctx,
      0.35,
      (t) =>
        0.55 * noise() * Math.exp(-t * 16) +
        0.3 * click(t, 0, 3200, 90) +
        0.25 * click(t, 0.025, 4700, 110) +
        0.22 * click(t, 0.06, 5900, 120) +
        0.2 * click(t, 0.1, 3800, 100),
    ),
  buzz: (ctx) =>
    synth(ctx, 0.4, (t, s, rate) => {
      const f = 195 + 35 * Math.sin(t * Math.PI * 2 * 3);
      s.phase += f / rate;
      const saw = (s.phase % 1) * 2 - 1;
      const trem = 0.6 + 0.4 * Math.sin(t * Math.PI * 2 * 18);
      const env = Math.min(1, t / 0.05) * Math.min(1, (0.4 - t) / 0.05);
      return 0.3 * saw * trem * env;
    }),
  // The crowd: a roar that swells and fades, with a ripple of claps and shouts in it.
  cheer: (ctx) =>
    synth(ctx, 1.6, (t, s) => {
      s.prev = (s.prev ?? 0) + (noise() - (s.prev ?? 0)) * 0.35;
      const swell = Math.min(1, t / 0.18) * Math.exp(-Math.max(0, t - 0.3) * 2.2);
      const ripple = 0.65 + 0.35 * Math.sin(t * 2 * Math.PI * 7.3) * Math.sin(t * 2 * Math.PI * 3.1);
      return 0.5 * s.prev * swell * ripple + 0.08 * noise() * swell * (Math.sin(t * 90) > 0.95 ? 1 : 0);
    }),
  // Gravity Gun: the punt (a heavy whump with an electric zap) and the grab (a rising hum).
  punt: (ctx) =>
    synth(
      ctx,
      0.35,
      (t) =>
        0.8 * Math.sin(t * 2 * Math.PI * (70 + 40 * Math.exp(-t * 20))) * Math.exp(-t * 9) +
        0.25 * noise() * Math.exp(-t * 30) +
        0.15 * Math.sin(t * 2 * Math.PI * 1800) * Math.sin(t * 2 * Math.PI * 47) * Math.exp(-t * 14),
    ),
  grab: (ctx) =>
    synth(ctx, 0.3, (t) => 0.35 * Math.sin(t * 2 * Math.PI * (180 + 520 * t)) * Math.sin((Math.PI * t) / 0.3) + 0.05 * noise() * Math.exp(-t * 12)),
  // Shrink Wrap: a warble that falls (shrink) or climbs (grow), and the squish of a stomp.
  shrinkZap: (ctx) =>
    synth(ctx, 0.45, (t, s, rate) => {
      s.phase += (1400 * Math.exp(-t * 4.5) + 160) / rate;
      const wob = 0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 28);
      return 0.32 * Math.sin(s.phase * Math.PI * 2) * wob * Math.min(1, t / 0.01) * Math.exp(-t * 3.5);
    }),
  growZap: (ctx) =>
    synth(ctx, 0.5, (t, s, rate) => {
      s.phase += (140 + 900 * (1 - Math.exp(-t * 5))) / rate;
      const saw = (s.phase % 1) * 2 - 1;
      const wob = 0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 22);
      return 0.22 * saw * wob * Math.min(1, t / 0.01) * Math.min(1, (0.5 - t) / 0.12);
    }),
  // Portal Gun: the two shots (a bright zip, pitched for each color), a portal opening, a shot
  // that found no room, and going through.
  portalShotA: (ctx) =>
    synth(ctx, 0.28, (t, s, rate) => {
      s.phase += (600 + 1400 * t) / rate;
      return 0.3 * Math.sin(s.phase * Math.PI * 2) * Math.exp(-t * 11) + 0.08 * noise() * Math.exp(-t * 30);
    }),
  portalShotB: (ctx) =>
    synth(ctx, 0.28, (t, s, rate) => {
      s.phase += (420 + 900 * t) / rate;
      return 0.3 * Math.sin(s.phase * Math.PI * 2) * Math.exp(-t * 11) + 0.08 * noise() * Math.exp(-t * 30);
    }),
  portalOpen: (ctx) =>
    synth(ctx, 0.5, (t, s, rate) => {
      s.phase += (90 + 60 * Math.sin(t * 9)) / rate;
      return 0.35 * Math.sin(s.phase * Math.PI * 2) * Math.min(1, t / 0.03) * Math.exp(-t * 6) + 0.06 * noise() * Math.exp(-t * 10);
    }),
  portalFizzle: (ctx) => synth(ctx, 0.25, (t) => (0.3 * noise() * (Math.sin(t * 380) > 0.2 ? 1 : 0.2) + 0.15 * Math.sin(t * 2 * Math.PI * (800 - 2400 * t))) * Math.exp(-t * 12)),
  portalEnter: (ctx) =>
    synth(ctx, 0.4, (t, s) => {
      s.prev = (s.prev ?? 0) + (noise() - (s.prev ?? 0)) * (0.05 + 0.5 * t);
      return 0.45 * s.prev * Math.sin((Math.PI * t) / 0.4);
    }),
  squish: (ctx) =>
    synth(
      ctx,
      0.3,
      (t) =>
        0.7 * Math.sin(t * 2 * Math.PI * (90 - 120 * t)) * Math.exp(-t * 14) +
        0.25 * Math.sin(t * 2 * Math.PI * (1900 - 3000 * t)) * Math.exp(-t * 22) +
        0.2 * noise() * Math.exp(-t * 25),
    ),
  swat: (ctx) => synth(ctx, 0.14, (t) => 0.5 * noise() * Math.exp(-t * 40) + 0.4 * click(t, 0, 300, 40)),
  // Last seconds of the match clock, and time's up.
  tick: (ctx) => synth(ctx, 0.09, (t) => 0.35 * Math.sin(t * 1320 * Math.PI * 2) * Math.exp(-t * 40)),
  horn: (ctx) =>
    synth(ctx, 1.4, (t, s, rate) => {
      s.phase += (233 * Math.PI * 2) / rate;
      s.phase2 += (349 * Math.PI * 2) / rate;
      const env = Math.min(1, t / 0.04) * Math.min(1, (1.4 - t) / 0.4);
      return 0.3 * env * (Math.sign(Math.sin(s.phase)) * 0.5 + Math.sin(s.phase2) * 0.6);
    }),
  pickup: (ctx) => synth(ctx, 0.2, (t) => 0.3 * click(t, 0, 880, 25) + 0.3 * click(t, 0.07, 1320, 25)),
  burn: (ctx) =>
    synth(ctx, 0.3, (t) => {
      const pop = Math.random() < 0.004 ? 1 : 0;
      return (0.25 * noise() + pop * 0.8) * Math.sin((Math.PI * t) / 0.3);
    }),
  // Sliding on grit: low-passed noise that darkens as the slide slows, with a few crunches.
  slide: (ctx) =>
    synth(ctx, 0.9, (t, s) => {
      s.prev += (noise() - s.prev) * (0.4 - 0.3 * (t / 0.9));
      const crunch = Math.random() < 0.015 ? noise() * 0.5 : 0;
      const env = Math.min(1, t / 0.03) * Math.pow(1 - t / 0.9, 1.4);
      return env * (1.1 * s.prev + crunch);
    }),
  // The grapple firing: a pneumatic thump with the line whistling out.
  hookFire: (ctx) =>
    synth(ctx, 0.32, (t, s, rate) => {
      const f = 1700 * Math.exp(-t * 7) + 380;
      s.phase += (f * Math.PI * 2) / rate;
      s.prev += (noise() - s.prev) * 0.5;
      return 0.8 * Math.sin(t * 95 * Math.PI * 2) * Math.exp(-t * 45) + 0.35 * s.prev * Math.exp(-t * 18) + 0.16 * Math.sin(s.phase) * Math.exp(-t * 9);
    }),
  // The hook biting: a metal clank, then the reel ratcheting in.
  hookHit: (ctx) =>
    synth(ctx, 0.55, (t) => {
      const clank = 0.5 * click(t, 0, 1850, 38) + 0.35 * click(t, 0, 2730, 52) + 0.5 * click(t, 0, 140, 30);
      const rate = 26 + 50 * t;
      const ratchet = t > 0.05 ? 0.3 * Math.max(0, Math.sin(t * rate * Math.PI * 2)) ** 12 * Math.exp(-(t - 0.05) * 4) * noise() : 0;
      return clank + ratchet;
    }),
  // A big hog's grunt (the Big Hog charging): a nasal buzz that drops, in two pulses.
  oink: (ctx) =>
    synth(ctx, 0.42, (t, s, rate) => {
      const f = 210 * Math.exp(-t * 1.6) + 70;
      s.phase += (f * Math.PI * 2) / rate;
      const buzz = Math.sign(Math.sin(s.phase)) * 0.5 + Math.sin(s.phase * 2) * 0.3;
      const env = Math.sin((Math.PI * Math.min(t, 0.18)) / 0.18) * (t < 0.18 ? 1 : 0) + (t > 0.22 ? Math.sin((Math.PI * (t - 0.22)) / 0.2) * 0.8 : 0);
      return 0.4 * buzz * Math.max(0, env);
    }),
  // A boot hitting a wall: a dropping thump with a little knock on top.
  wallKick: (ctx) =>
    synth(ctx, 0.25, (t, s, rate) => {
      const f = 150 * Math.exp(-t * 20) + 55;
      s.phase += (f * Math.PI * 2) / rate;
      return 0.9 * Math.sin(s.phase) * Math.exp(-t * 16) + 0.3 * noise() * Math.exp(-t * 70) + 0.25 * click(t, 0, 820, 60);
    }),
};

// Recorded sounds, grouped by name: shot-1.wav ... shot-4.wav are variations of 'shot'.
const SAMPLE_URLS = import.meta.glob('./samples/*.wav', { query: '?url', import: 'default', eager: true });

// Sounds heard over and over (guns, blasts, footsteps) get more takes than were recorded, so the
// ear never catches a loop (Halo's soundtags carry many permutations): each recorded take adds
// these variants, made at decode: a pitch (by resampling, so the length changes with it), a
// tone (tilt: + brighter, - darker) and the attack's level.
const TAKES = { shot: 1, smg: 1, pistol: 1, marksman: 1, rotisserie: 1, shotgun: 1, chimney: 1, boom: 1, launch: 1, step: 1, stepMetal: 1, stepDirt: 1, stepWood: 1, stepMud: 1 };
const VARIANTS = [
  { pitch: 0.955, tilt: -0.35, attack: 1.12 },
  { pitch: 1.045, tilt: 0.3, attack: 0.9 },
];

// Close sounds get a little width (a short delayed copy on one side); this far out they're
// plain points.
const WIDE_NEAR = 8;

// Per-sound mix: volume, distance where it's at half volume, echo send, and a voice cap.
const MIX = {
  shot: { volume: 0.9, ref: 16, wet: 0.35, voices: 14 },
  shotgun: { volume: 1, ref: 18, wet: 0.4, voices: 6 },
  pistol: { volume: 0.8, ref: 14, wet: 0.3, voices: 8 },
  smg: { volume: 0.75, ref: 14, wet: 0.3, voices: 12 },
  marksman: { volume: 1, ref: 22, wet: 0.45, voices: 6 },
  reloadPistol: { volume: 0.5, ref: 5, voices: 4 },
  chimney: { volume: 0.9, ref: 16, wet: 0.35, voices: 6 },
  rotisserie: { volume: 0.85, ref: 18, wet: 0.35, voices: 8 },
  spinUp: { volume: 0.5, ref: 10, voices: 4 },
  spinDown: { volume: 0.45, ref: 10, voices: 4 },
  sizzle: { volume: 0.55, ref: 12, voices: 8 },
  vent: { volume: 0.5, ref: 6, voices: 4 },
  pop: { volume: 0.7, ref: 10, voices: 4 },
  smash: { volume: 0.8, ref: 14, wet: 0.25, voices: 4 },
  buzz: { volume: 0.5, ref: 8, voices: 8 },
  swat: { volume: 0.6, ref: 8, voices: 4 },
  pump: { volume: 0.6, ref: 6, voices: 4 },
  launch: { volume: 0.7, ref: 20, wet: 0.35, voices: 4 },
  hookFire: { volume: 0.6, ref: 10, voices: 6 },
  hookHit: { volume: 0.6, ref: 12, wet: 0.2, voices: 6 },
  boom: { volume: 0.95, ref: 28, wet: 0.5, voices: 6 },
  reload: { volume: 0.5, ref: 5, voices: 4 },
  shell: { volume: 0.8, ref: 5, voices: 4 },
  swap: { volume: 0.5, ref: 5, voices: 4 },
  clink: { ref: 8, voices: 6 },
  throw: { ref: 6 },
  swing: { ref: 6 },
  bash: { ref: 8 },
  death: { ref: 14, wet: 0.2 },
  slide: { volume: 0.6, ref: 8, voices: 4 },
  wallKick: { volume: 0.8, ref: 10, wet: 0.15, voices: 4 },
  step: { volume: 0.42, ref: 7, wet: 0.06, voices: 8 },
  stepMetal: { volume: 0.4, ref: 8, wet: 0.1, voices: 8 },
  stepDirt: { volume: 0.42, ref: 6, voices: 8 },
  stepWood: { volume: 0.42, ref: 7, wet: 0.06, voices: 8 },
  stepMud: { volume: 0.4, ref: 6, voices: 6 },
};
const DEFAULT_MIX = { volume: 1, ref: 10, wet: 0, voices: 8 };

// Minimum seconds between two plays of the same personal sound, so rapid events don't pile up.
const MIN_GAP = { hit: 0.025, head: 0.04, burn: 0.22, hurt: 0.12, shieldCharge: 0.5 };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.lastPlayed = {};
    this.lastTake = {};
    this.voices = {};
    // Local players (the game sets this): sounds fade by distance to the nearest one.
    this.listeners = [];
    // Start downloading the recordings right away; they're decoded once audio unlocks.
    this.files = Object.entries(SAMPLE_URLS).map(([path, url]) => ({
      name: path.match(/([a-z]+)(?:-\d+)?\.wav$/i)[1],
      url,
      data: null,
      state: 'new',
    }));
    for (const f of this.files) this.fetch(f);
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
      // The width bus: what's sent here comes back on the right a few milliseconds late, so a
      // close sound spreads across both ears.
      this.wideIn = ctx.createGain();
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = 0.013;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) pan.pan.value = 0.85;
      this.wideIn.connect(delay).connect(lp);
      (pan ? lp.connect(pan) : lp).connect(this.master);
      for (const [name, make] of Object.entries(SOUNDS)) this.buffers[name] = [make(ctx)];
    }
    // Decode whatever has downloaded; anything that failed (a network blip) is fetched again.
    for (const f of this.files) {
      if (f.state === 'failed') this.fetch(f);
      if (f.state === 'fetched') this.decode(f);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  fetch(f) {
    f.state = 'fetching';
    f.data = fetch(f.url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null)
      .then((data) => {
        f.state = data ? 'fetched' : 'failed';
        f.bytes = data;
        if (data && this.ctx) this.decode(f);
      });
  }

  decode(f) {
    f.state = 'decoding';
    decode(this.ctx, f.bytes).then((buf) => {
      f.bytes = null;
      f.state = buf ? 'done' : 'failed';
      if (!buf) return;
      const list = (this.buffers[f.name] ??= []);
      list.push(buf);
      if (TAKES[f.name]) for (const v of VARIANTS) list.push(variant(this.ctx, buf, v));
    });
  }

  // opts: volume, rate, delay (seconds), at (world position), source (who made the sound).
  // Returns a handle for stop(), or null if nothing played.
  play(name, { volume = 1, rate = 1, delay = 0, at = null, source = null } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const list = this.buffers[name];
    if (!list?.length) return null;
    const now = ctx.currentTime;
    // Throttle repeats of personal sounds; world sounds are limited by voices instead, so a
    // far one never silences a near one.
    if (!at) {
      const gap = MIN_GAP[name] ?? 0;
      if (gap && now - (this.lastPlayed[name] ?? -1) < gap) return null;
      this.lastPlayed[name] = now;
    }
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
      else if (this.listeners.length === 1) {
        // Pan by direction relative to where the one local player's camera faces (the
        // missile's heading while flying one). Overhead sounds stay centered.
        const p = nearest.camera.position;
        const h = Math.hypot(at.x - p.x, at.z - p.z);
        if (h > 0.5) {
          const ang = Math.atan2(at.x - p.x, at.z - p.z) - (nearest.camera.rotation.y + Math.PI);
          pan = -Math.sin(ang) * Math.min(1, h / 4) * 0.75;
        }
      }
    }
    const ref = mix.ref ?? DEFAULT_MIX.ref;
    const falloff = 1 / (1 + Math.pow(dist / ref, 1.6));
    const gain = volume * (mix.volume ?? 1) * falloff;
    if (gain < 0.004) return null;

    // Voice cap per sound: the oldest voice fades out quickly to make room.
    const voices = (this.voices[name] ??= []);
    if (voices.length >= (mix.voices ?? DEFAULT_MIX.voices)) this.stop(voices.shift());

    const src = ctx.createBufferSource();
    // Any take but the last one played.
    let take = (Math.random() * list.length) | 0;
    if (list.length > 1 && take === this.lastTake[name]) take = (take + 1 + ((Math.random() * (list.length - 1)) | 0)) % list.length;
    this.lastTake[name] = take;
    src.buffer = list[take];
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
    const voice = { src, g };
    // Close up, a little width.
    if (dist < WIDE_NEAR && this.wideIn) {
      const w = ctx.createGain();
      w.gain.value = gain * 0.35 * (1 - dist / WIDE_NEAR);
      node.connect(w).connect(this.wideIn);
    }
    // The echo fades slower than the direct sound, so distant shots sound distant.
    const wet = mix.wet ?? 0;
    if (wet) {
      const w = ctx.createGain();
      w.gain.value = volume * (mix.volume ?? 1) * wet * (1 / (1 + Math.pow(dist / (ref * 2.5), 1.3)));
      node.connect(w).connect(this.echoIn);
    }
    voice.name = name;
    voices.push(voice);
    src.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
    };
    src.start(now + delay);
    return voice;
  }

  // A vehicle's engine: one looping voice that setEngine() keeps placed, revved and faded every
  // frame. Returns null until audio is unlocked.
  engine() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    this.engineBuf ??= engineLoop(ctx);
    const src = ctx.createBufferSource();
    src.buffer = this.engineBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    return { src, lp, g };
  }

  // at: where the engine is; source: its rider (their own engine plays up close); rev: 0 idle to
  // about 1 flat out; level: 0 off to 1; pitch: the engine's own (the hovercraft whines higher,
  // the drum rumbles lower).
  setEngine(h, at, source, rev, level, pitch = 1) {
    if (!h || !this.ctx) return;
    let dist = 0;
    if (!(source && this.listeners.includes(source))) {
      dist = Infinity;
      for (const l of this.listeners) dist = Math.min(dist, l.camera.position.distanceTo(at));
      if (!Number.isFinite(dist)) dist = 0;
    }
    const now = this.ctx.currentTime;
    const gain = level * 0.32 * (1 / (1 + Math.pow(dist / 12, 1.6)));
    h.g.gain.setTargetAtTime(gain, now, 0.06);
    h.src.playbackRate.setTargetAtTime((0.75 + rev * 1.3) * pitch, now, 0.08);
    h.lp.frequency.setTargetAtTime(Math.max(500, (900 + rev * 2400) * Math.exp(-dist / 60)), now, 0.08);
  }

  stopEngine(h) {
    if (!h || !this.ctx) return;
    h.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    try {
      h.src.stop(this.ctx.currentTime + 0.1);
    } catch {
      // Already stopped.
    }
  }

  // Fade a playing sound out over a few milliseconds (no click) and stop it.
  stop(voice) {
    if (!voice || !this.ctx) return;
    const now = this.ctx.currentTime;
    voice.g.gain.setTargetAtTime(0, now, 0.01);
    try {
      voice.src.stop(now + 0.06);
    } catch {
      // Already stopped.
    }
  }
}

// One second of a single-cylinder engine at 30 firings a second (playbackRate revs it): each
// firing a low thump with a raspy edge, a whole number of them so the loop is seamless.
function engineLoop(ctx) {
  const rate = ctx.sampleRate;
  const n = rate;
  const buf = ctx.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  const F = 30;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const ph = (t * F) % 1;
    const pulse = Math.exp(-ph * 9);
    lp += (noise() - lp) * 0.08;
    d[i] = Math.tanh(1.6 * (0.7 * Math.sin(2 * Math.PI * F * t) * pulse + 0.35 * Math.sin(4 * Math.PI * F * t) + 0.18 * Math.sin(6 * Math.PI * F * t + 1) * pulse + 0.5 * lp * pulse));
  }
  return buf;
}

// A variant take of a recorded sound (see VARIANTS): resampled for the pitch, a one-pole tilt
// for the tone, and the first 15 ms scaled for the attack.
function variant(ctx, buf, { pitch, tilt, attack }) {
  const src = buf.getChannelData(0);
  const n = Math.max(1, Math.floor(src.length / pitch));
  const out = ctx.createBuffer(1, n, buf.sampleRate);
  const d = out.getChannelData(0);
  const k = Math.exp((-2 * Math.PI * 1800) / buf.sampleRate);
  const atk = Math.floor(0.015 * buf.sampleRate);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const x = i * pitch;
    const j = Math.floor(x);
    const f = x - j;
    const v = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f;
    // Split at about 1.8 kHz: tilt above 0 lifts the highs, below 0 cuts them.
    lp = lp * k + v * (1 - k);
    let y = lp + (v - lp) * (1 + tilt);
    if (i < atk) y *= attack + (1 - attack) * (i / atk);
    d[i] = y;
  }
  return out;
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
