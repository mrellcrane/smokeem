import * as THREE from 'three';
import { Game } from '../game.js';
import { InputState } from '../input/inputState.js';
import { settings } from '../settings.js';
import { GRENADE, WEAPONS } from '../combat/weapons.js';
import { explode } from '../combat/explosions.js';
import { gfx } from './gfx.js';

// ?bench: a scripted split-screen match that measures frame time and draw calls, so graphics
// changes can be checked on the Xbox itself (open the Pages URL with ?bench on the console).
// Options: q=low|medium|high (default: the saved preset), views=1..4 (3), secs (40),
// set (a weapon set id, hotAndCold), off=a,b (turn graphics switches in gfx.js off).
// It's only loaded when the URL asks for it.

// Where the frozen local players stand, cycled every 5 s: the Summit deck looking west, the
// east lane, the west lane and the mud pit.
const POSES = [
  { pos: { x: 2, y: 6, z: 2 }, yaw: 2.4, pitch: -0.2 },
  { pos: { x: 26, y: 0, z: 10 }, yaw: 0.4, pitch: -0.05 },
  { pos: { x: -10, y: 0, z: 20 }, yaw: -0.6, pitch: 0.02 },
  { pos: { x: 22, y: 0, z: -10 }, yaw: 1.2, pitch: -0.1 },
];
// Scripted worst cases (blasts, swarms, beams, tracers) in front of every camera at these times.
const BURSTS = [10, 20, 30];

const _f = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function stubSource() {
  return { kind: 'gamepad', state: new InputState(), enabled: true, update() {}, prime() {}, feel() {} };
}

function summary(list) {
  const s = [...list].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { avg: +avg.toFixed(2), p95: +at(0.95).toFixed(2), p99: +at(0.99).toFixed(2), worst: +s[s.length - 1].toFixed(2) };
}

export async function runBench({ stage, hudRoot, uiRoot, fps, sfx }) {
  const params = new URLSearchParams(window.location.search);
  const views = Math.max(1, Math.min(4, Number(params.get('views')) || 3));
  const secs = Math.max(10, Number(params.get('secs')) || 40);
  const quality = params.get('q') ?? settings.quality;
  // Not saved: the bench never changes the player's settings.
  settings.quality = quality;
  for (const name of (params.get('off') ?? '').split(',')) if (name in gfx) gfx[name] = false;

  const panel = document.createElement('div');
  panel.className = 'panel bench';
  uiRoot.appendChild(panel);
  panel.textContent = 'Benchmark: loading...';

  const t0 = performance.now();
  const stages = [];
  const game = await Game.create({
    stage,
    hudRoot,
    fps,
    sfx,
    players: Array.from({ length: views }, (_, i) => ({ source: stubSource(), name: `Bench ${i + 1}` })),
    bots: 5,
    botSkill: 'normal',
    practiceTargets: false,
    timeLimit: 0,
    weaponSet: params.get('set') ?? 'hotAndCold',
    onProgress: (text) => {
      stages.push({ stage: text, ms: Math.round(performance.now() - t0) });
      panel.textContent = `Benchmark: ${text}...`;
    },
  });
  const loadMs = Math.round(performance.now() - t0);
  panel.style.display = 'none';
  document.body.classList.add('in-match');
  game.start();
  game.resume();

  const frameMs = [];
  const renderMs = [];
  const calls = [];
  let shadowCalls = 0;
  let viewCalls = [];
  let last = performance.now();
  const start = last;
  let pose = -1;
  const bursts = [...BURSTS];
  let beamUntil = 0;

  const place = (k) => {
    game.humans.forEach((p, i) => {
      const pp = POSES[(i + k) % POSES.length];
      p.spawn({ position: pp.pos, yaw: pp.yaw });
      p.pitch = pp.pitch;
    });
  };

  await new Promise((done) => {
    const step = (now) => {
      // (A frame's timestamp can be a little earlier than `start`.)
      const t = Math.max(0, now - start) / 1000;
      const dt = now - last;
      last = now;
      // Skip the first second while everything settles.
      if (t > 1) {
        frameMs.push(dt);
        renderMs.push(game.stats.renderMs);
        calls.push(game.renderer.info.render.calls);
        shadowCalls = game.stats.shadowCalls;
        viewCalls = game.stats.viewCalls.slice(0, game.stats.views);
      }
      const k = Math.floor(t / 5);
      if (k !== pose) {
        pose = k;
        place(k);
      }
      // The local players are frozen and can't be smoked.
      game.humans.forEach((p, i) => {
        const pp = POSES[(i + pose) % POSES.length];
        if (!p.alive) p.spawn({ position: pp.pos, yaw: pp.yaw });
        p.vitals.reset();
        p.yaw = pp.yaw;
        p.pitch = pp.pitch;
      });
      if (bursts.length && t >= bursts[0]) {
        bursts.shift();
        burst(game);
        beamUntil = t + 2;
      }
      if (t < beamUntil) spray(game);
      if (t >= secs) {
        done();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  game.pause();

  const gl = game.renderer.getContext();
  const result = {
    quality,
    views,
    secs,
    off: Object.keys(gfx).filter((k) => !gfx[k]),
    canvas: `${game.renderer.domElement.width}x${game.renderer.domElement.height}`,
    pixelRatio: game.renderer.getPixelRatio(),
    frames: frameMs.length,
    fps: +(1000 / summary(frameMs).avg).toFixed(1),
    frameMs: summary(frameMs),
    renderMs: summary(renderMs),
    drawCalls: summary(calls),
    shadowCalls,
    viewCalls,
    programs: game.renderer.info.programs.length,
    textures: game.renderer.info.memory.textures,
    geometries: game.renderer.info.memory.geometries,
    loadMs,
    stages,
    gpu: gl.getParameter(gl.VERSION),
    userAgent: navigator.userAgent,
  };
  showResult(panel, result);
  console.log('bench', result);
}

// Explosions, a missile blast, swarms and tracers in front of every camera.
function burst(game) {
  const missile = WEAPONS.smokeSignal?.explosion ?? { radius: 5.5, inner: 1.6, damage: 210, knockback: 14 };
  for (const p of game.humans) {
    p.facing(_f);
    for (let j = 0; j < 4; j++) {
      _a.copy(p.center).addScaledVector(_f, 7 + j * 2.5);
      _a.x += (j - 1.5) * 1.5;
      explode(game, _a, GRENADE.explosion, { attacker: null, weapon: GRENADE });
    }
    _a.copy(p.center).addScaledVector(_f, 14);
    explode(game, _a, missile, { attacker: null, weapon: WEAPONS.smokeSignal });
    const thrower = game.bots[0] ?? p;
    for (let j = 0; j < 2; j++) {
      _a.copy(p.center).addScaledVector(_f, 5 + j * 3);
      _a.y += 1;
      game.swarms.spawn(thrower, _a, WEAPONS.swarmJar);
    }
  }
}

// A Brander beam and a Kindling-like stream of tracers crossing each view.
function spray(game) {
  for (const p of game.humans) {
    p.facing(_f);
    _a.copy(p.center).addScaledVector(_f, 4);
    _a.x += 3;
    _a.y += 0.5;
    _b.copy(p.center).addScaledVector(_f, 16);
    game.fx.beam(_a, _b, 0xffb070, 0.035);
    for (let j = 0; j < 3; j++) {
      _b.x += (Math.random() - 0.5) * 2;
      game.fx.tracer(_a, _b, 0xffb070);
    }
  }
}

function showResult(panel, result) {
  panel.style.display = '';
  const row = (name, s) => `<tr><td>${name}</td><td>${s.avg}</td><td>${s.p95}</td><td>${s.p99}</td><td>${s.worst}</td></tr>`;
  panel.innerHTML = `
    <h2>Benchmark</h2>
    <p>${result.views} views, ${result.quality} quality, ${result.canvas} at ${result.pixelRatio}x, ${result.fps} fps average${
      result.off.length ? `, off: ${result.off.join(', ')}` : ''
    }</p>
    <table class="bench-table">
      <tr><th></th><th>avg</th><th>p95</th><th>p99</th><th>worst</th></tr>
      ${row('frame ms', result.frameMs)}
      ${row('render ms', result.renderMs)}
      ${row('draw calls', result.drawCalls)}
    </table>
    <p>Shadow pass ${result.shadowCalls} draws, per view ${result.viewCalls.join(' / ')}. ${result.programs} shader programs, loaded in ${(
      result.loadMs / 1000
    ).toFixed(1)} s.</p>
    <pre class="bench-json">${JSON.stringify(result, null, 1)}</pre>
    <div class="buttons"><button data-bench="copy">Copy results</button><button data-bench="again" class="secondary">Run again</button></div>`;
  panel.querySelector('[data-bench="copy"]').addEventListener('click', async () => {
    const text = JSON.stringify(result);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard (some consoles): select the text so it can be copied by hand.
      const r = document.createRange();
      r.selectNodeContents(panel.querySelector('.bench-json'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
    }
  });
  panel.querySelector('[data-bench="again"]').addEventListener('click', () => window.location.reload());
}
