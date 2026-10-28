import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT, MAX_STEPS_PER_FRAME } from './config.js';
import { qualityPreset, onSettingsChange } from './settings.js';
import { createRenderer, pixelRatioFor } from './render/renderer.js';
import { viewportRects } from './render/splitscreen.js';
import { warmUp } from './render/warmup.js';
import { createTextures, applyAnisotropy } from './world/textures.js';
import { createMaterials } from './world/materials.js';
import { buildArena, ARENA_HALF } from './world/arena.js';
import { createSky, FOG_COLOR } from './world/sky.js';
import { Player } from './player/player.js';
import { Hud } from './ui/hud.js';

let rapierReady = null;
function initRapier() {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

// Let the loading screen repaint between heavy steps.
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// One match: renderer, scene, physics world, players and the fixed-step loop.
// States: 'ready' (loaded, waiting for the player to click in), 'playing', 'paused'.
export class Game {
  static async create({ stage, hudRoot, fps, players, onProgress = () => {} }) {
    onProgress('Lighting the smoker', 0.05);
    await initRapier();
    const game = new Game(stage, hudRoot, fps);
    await game.build(players, onProgress);
    return game;
  }

  constructor(stage, hudRoot, fps) {
    this.stage = stage;
    this.hudRoot = hudRoot;
    this.fps = fps;
    this.state = 'ready';
    this.disposed = false;
    this.time = 0;
    this.acc = 0;
    this.last = 0;
    this.needsRender = true;
    this.players = [];
    this.inputs = [];
    this.huds = [];
    this.showDebug = false;
    this._frame = (now) => this.frame(now);
  }

  async build(playerDefs, onProgress) {
    const preset = qualityPreset();
    this.renderer = createRenderer(this.stage, preset);
    this.physics = { RAPIER, world: new RAPIER.World({ x: 0, y: 0, z: 0 }) };
    this.physics.world.timestep = PHYSICS_DT;

    onProgress('Painting textures', 0.2);
    await nextFrame();
    this.textures = createTextures();
    this.applyAnisotropy(preset);
    this.materials = createMaterials(this.textures);

    onProgress('Building the course', 0.4);
    await nextFrame();
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(FOG_COLOR, 90, 420);
    this.setupLights(preset);
    scene.add(createSky(this.textures, this.materials));
    this.arena = buildArena({
      scene,
      RAPIER,
      world: this.physics.world,
      materials: this.materials,
      textures: this.textures,
    });
    this.zones = this.arena.zones;
    // One step so scene queries see the static colliders before anyone spawns.
    this.physics.world.step();

    playerDefs.forEach((def, i) => {
      const p = new Player(this, { id: i, input: def.source.state, name: def.name ?? `Player ${i + 1}` });
      this.players.push(p);
      this.inputs.push(def.source);
      this.huds.push(new Hud(this.hudRoot, def.source.kind));
      this.respawn(p, i);
    });
    this.physics.world.step();

    onProgress('Compiling shaders', 0.7);
    await nextFrame();
    const cam = this.players[0].camera;
    this.players[0].updateCamera(0, 0, window.innerWidth / window.innerHeight);
    await warmUp(this.renderer, scene, cam, { textures: Object.values(this.textures) });

    this._onResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.needsRender = true;
    };
    window.addEventListener('resize', this._onResize);
    this._offSettings = onSettingsChange((s, patch) => this.onSettings(patch));

    onProgress('Ready', 1);
  }

  setupLights(preset) {
    const scene = this.scene;
    scene.add(new THREE.HemisphereLight(0xd2e4ff, 0x7a5a44, 1.15));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d8, 2.7));
    sun.position.set(38, 60, 26);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const c = sun.shadow.camera;
    const r = ARENA_HALF + 14;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.near = 10;
    c.far = 170;
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
  }

  applyAnisotropy(preset) {
    const max = this.renderer.capabilities.getMaxAnisotropy();
    applyAnisotropy(this.textures, Math.max(1, Math.min(preset.anisotropy, max)));
  }

  onSettings(patch) {
    if ('quality' in patch) {
      const preset = qualityPreset();
      this.renderer.setPixelRatio(pixelRatioFor(preset));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
      this.applyAnisotropy(preset);
    }
    this.needsRender = true;
  }

  // Pick a free spawn point. `preferred` indexes spawn points for initial placement.
  respawn(player, preferred = null) {
    const points = this.arena.spawnPoints;
    const order = points.map((_, i) => i);
    if (preferred === null) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } else {
      order.push(...order.splice(0, preferred % points.length));
    }
    for (const i of order) {
      const p = points[i].position;
      if (!player.overlaps(player.standShape, p.x, p.y + 0.95, p.z)) {
        player.spawn(points[i]);
        return;
      }
    }
    player.spawn(points[order[0]]);
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  resume() {
    if (this.state === 'playing') return;
    for (const s of this.inputs) s.state.clear();
    this.state = 'playing';
    this.acc = 0;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.needsRender = true;
  }

  frame(now) {
    if (this.disposed) return;
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    if (this.state === 'playing') {
      for (const src of this.inputs) src.update();
      for (const p of this.players) p.applyLook();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
        this.tick(PHYSICS_DT);
        this.acc -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      this.time += dt;
      this.arena.update(dt, this.time);
      this.render(this.acc / PHYSICS_DT, dt);
    } else if (this.needsRender) {
      // Paused or waiting: the canvas keeps showing the last frame, so only redraw on change.
      this.render(1, 0);
      this.needsRender = false;
    }

    this.fps.frame(dt, this.renderer.info.render.calls);
  }

  tick(dt) {
    for (const p of this.players) p.tick(dt);
    this.physics.world.step();
    for (const p of this.players) {
      if (p.center.y < -20) this.respawn(p);
    }
  }

  render(alpha, dt) {
    const r = this.renderer;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rects = viewportRects(this.players.length, W, H);
    r.info.reset();
    r.shadowMap.needsUpdate = true;
    r.setScissorTest(rects.length > 1);
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const rect = rects[i];
      p.updateCamera(alpha, dt, rect.w / rect.h);
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.render(this.scene, p.camera);
      this.huds[i].layout(rect, H);
      this.huds[i].update(p, this.zones, this.showDebug);
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this._onResize);
    this._offSettings?.();
    for (const h of this.huds) h.dispose();
    for (const p of this.players) p.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
    });
    for (const m of Object.values(this.materials)) m.dispose();
    for (const t of Object.values(this.textures)) t.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.physics.world.free();
  }
}
