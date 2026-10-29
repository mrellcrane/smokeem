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
import { Dummy, DUMMY_POSTS } from './world/dummies.js';
import { Effects } from './fx/effects.js';
import { dealDamage } from './combat/damage.js';
import { Missiles, Grenades } from './combat/projectiles.js';
import { Pickups } from './combat/pickups.js';
import { Player } from './player/player.js';
import { disposeCharacterMaterial } from './player/character.js';
import { disposeViewmodelMaterial } from './player/viewmodel.js';
import { Hud } from './ui/hud.js';

let rapierReady = null;
function initRapier() {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

// Let the loading screen repaint between heavy steps.
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const _sunDir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();

// One match: renderer, scene, physics world, players and the fixed-step loop.
// States: 'ready' (loaded, waiting for the player to click in), 'playing', 'paused'.
export class Game {
  static async create({ stage, hudRoot, fps, sfx, players, practiceTargets = true, onProgress = () => {} }) {
    onProgress('Lighting the smoker', 0.05);
    await initRapier();
    const game = new Game(stage, hudRoot, fps, sfx);
    await game.build(players, practiceTargets, onProgress);
    return game;
  }

  constructor(stage, hudRoot, fps, sfx) {
    this.stage = stage;
    this.hudRoot = hudRoot;
    this.fps = fps;
    this.sfx = sfx;
    this.state = 'ready';
    this.disposed = false;
    this.time = 0;
    this.acc = 0;
    this.last = 0;
    this.needsRender = true;
    this.players = [];
    this.inputs = [];
    this.huds = [];
    this.dummies = [];
    this.entities = new Map();
    this.showDebug = false;
    this._frame = (now) => this.frame(now);
    this._shot = { hit: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), entity: null, headshot: false };
  }

  async build(playerDefs, practiceTargets, onProgress) {
    const preset = qualityPreset();
    this.renderer = createRenderer(this.stage, preset);
    this.renderer.autoClear = false;
    // Gravity only moves dynamic bodies (grenades); players run their own floaty gravity.
    this.physics = { RAPIER, world: new RAPIER.World({ x: 0, y: -16, z: 0 }) };
    this.shotFilter = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    this.notBody = (c) => !this.entities.has(c.handle);
    this.physics.world.timestep = PHYSICS_DT;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

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
    this.fx = new Effects(scene, this.textures);
    this.missiles = new Missiles(this, this.materials.props, this.textures);
    this.grenades = new Grenades(this, this.materials.props);
    this.pickups = new Pickups(this, this.materials.props);
    this.setupViewmodelScene();
    // One step so scene queries see the static colliders before anyone spawns.
    this.physics.world.step();

    if (practiceTargets) {
      for (const def of DUMMY_POSTS) this.dummies.push(new Dummy(this, def));
    }

    playerDefs.forEach((def, i) => {
      const p = new Player(this, { id: i, input: def.source.state, name: def.name ?? `Player ${i + 1}` });
      this.players.push(p);
      this.inputs.push(def.source);
      this.huds.push(new Hud(this.hudRoot, def.source.kind));
      scene.add(p.model.group);
      this.vmScene.add(p.viewmodel.root);
      this.respawn(p, i);
    });
    this.physics.world.step();

    onProgress('Compiling shaders', 0.7);
    await nextFrame();
    await this.warmUp();

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
    // Player bodies live on their own layers (hidden from their own camera) but still cast shadows.
    c.layers.enableAll();
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
  }

  // First-person weapons render in their own little scene after the world.
  setupViewmodelScene() {
    const vm = (this.vmScene = new THREE.Scene());
    vm.add(new THREE.HemisphereLight(0xd2e4ff, 0x6a5646, 1.8));
    this.vmSun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    vm.add(this.vmSun, this.vmSun.target);
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  }

  applyAnisotropy(preset) {
    const max = this.renderer.capabilities.getMaxAnisotropy();
    applyAnisotropy(this.textures, Math.max(1, Math.min(preset.anisotropy, max)));
  }

  async warmUp() {
    // Make everything that can show up mid-match visible for one compile + render.
    for (const p of this.players) {
      p.model.warmup(true);
      p.viewmodel.warmup(true);
    }
    for (const d of this.dummies) d.model.warmup(true);
    const cam = this.players[0].camera;
    this.players[0].updateCamera(1, 0, window.innerWidth / window.innerHeight);
    const fwd = new THREE.Vector3(0, 0, -3).applyQuaternion(cam.quaternion).add(cam.position);
    this.missiles.warmup(true, fwd);
    this.grenades.warmup(true, fwd);
    this.fx.explosion(fwd, 5);
    this.fx.tracer(cam.position, fwd, 0xffffff);
    this.fx.impactWorld(fwd, new THREE.Vector3(0, 1, 0));
    this.fx.deathPuff(fwd.x, fwd.y - 1, fwd.z);
    this.fx.update(0.001);
    await warmUp(this.renderer, {
      textures: Object.values(this.textures),
      scenes: [
        [this.scene, cam],
        [this.vmScene, this.vmCamera],
      ],
      render: () => this.render(1, 0),
    });
    for (const p of this.players) {
      p.model.warmup(false);
      p.viewmodel.warmup(false);
    }
    for (const d of this.dummies) d.model.warmup(false);
    this.missiles.warmup(false);
    this.grenades.warmup(false);
    this.fx.update(10);
    this.needsRender = true;
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

  registerEntity(collider, entity) {
    this.entities.set(collider.handle, entity);
  }

  // Hitscan against the world and every body. Returns a reused result object.
  castShot(origin, dir, range, exclude) {
    const r = this._shot;
    const ray = this.ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = dir.x;
    ray.dir.y = dir.y;
    ray.dir.z = dir.z;
    const hit = this.physics.world.castRayAndGetNormal(ray, range, true, this.shotFilter, undefined, exclude);
    if (!hit) {
      r.hit = false;
      r.entity = null;
      r.headshot = false;
      r.distance = range;
      return r;
    }
    r.hit = true;
    r.distance = hit.timeOfImpact;
    r.point.copy(origin).addScaledVector(dir, hit.timeOfImpact);
    r.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    r.entity = this.entities.get(hit.collider.handle) ?? null;
    r.headshot = !!r.entity && r.point.y >= r.entity.headLineY();
    return r;
  }

  // True when solid level geometry sits between a and b (bodies and grenades don't count).
  lineBlocked(a, b) {
    const ray = this.ray;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    ray.origin.x = a.x;
    ray.origin.y = a.y;
    ray.origin.z = a.z;
    ray.dir.x = dx / len;
    ray.dir.y = dy / len;
    ray.dir.z = dz / len;
    return this.physics.world.castRay(ray, len, true, this.shotFilter, undefined, undefined, undefined, this.notBody) !== null;
  }

  onKill(victim, info) {
    const a = info.attacker;
    if (a && a !== victim && a.kind === 'player') {
      a.stats.kills++;
      a.feedback.killT = this.time;
      a.feedback.killText = `Smoked ${victim.name}${info.headshot ? ' · headshot' : ''}`;
    }
  }

  // Pick a free spawn point, as far as possible from other living players.
  // `preferred` indexes spawn points for initial placement.
  respawn(player, preferred = null) {
    const points = this.arena.spawnPoints;
    const free = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i].position;
      if (!player.overlaps(player.standShape, p.x, p.y + 0.95, p.z)) free.push(i);
    }
    const pool = free.length ? free : points.map((_, i) => i);
    let choice;
    if (preferred !== null) {
      choice = pool[preferred % pool.length];
    } else {
      const scored = pool.map((i) => {
        const p = points[i].position;
        let best = Infinity;
        for (const o of this.players) {
          if (o === player || !o.alive) continue;
          best = Math.min(best, Math.hypot(o.center.x - p.x, o.center.z - p.z));
        }
        return { i, score: best };
      });
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, Math.min(3, scored.length));
      choice = top[Math.floor(Math.random() * top.length)].i;
    }
    player.spawn(points[choice]);
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
      this.updateVisuals(dt, this.acc / PHYSICS_DT);
      this.render(this.acc / PHYSICS_DT, dt);
    } else if (this.needsRender) {
      // Paused or waiting: the canvas keeps showing the last frame, so only redraw on change.
      this.updateVisuals(0, 1);
      this.render(1, 0);
      this.needsRender = false;
    }

    this.fps.frame(dt, this.renderer.info.render.calls);
  }

  tick(dt) {
    this.time += dt;
    for (const p of this.players) p.tick(dt);
    this.missiles.tick(dt);
    this.grenades.tick(dt);
    this.pickups.tick(dt);
    for (const d of this.dummies) d.tick(dt);
    this.physics.world.step();
    for (const p of this.players) {
      if (p.alive && p.center.y < -20) dealDamage(this, p, 1e6, { cause: 'fell' });
    }
  }

  updateVisuals(dt, alpha) {
    this.arena.update(dt, this.time);
    for (const p of this.players) p.updateVisuals(dt, alpha);
    for (const d of this.dummies) d.updateVisual(dt, alpha);
    this.missiles.updateVisuals(alpha);
    this.grenades.updateVisuals(alpha);
    this.pickups.updateVisuals(this.time);
    this.fx.update(dt);
  }

  render(alpha, dt) {
    const r = this.renderer;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rects = viewportRects(this.players.length, W, H);
    r.info.reset();
    r.shadowMap.needsUpdate = true;
    r.setScissorTest(rects.length > 1);
    _sunDir.copy(this.sun.position).sub(this.sun.target.position).normalize();
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const rect = rects[i];
      p.updateCamera(alpha, dt, rect.w / rect.h);
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.clear(true, true, false);
      r.render(this.scene, p.camera);

      if (p.alive && !p.guiding) {
        for (const o of this.players) o.viewmodel.root.visible = o === p;
        const vc = this.vmCamera;
        if (vc.aspect !== rect.w / rect.h) {
          vc.aspect = rect.w / rect.h;
          vc.updateProjectionMatrix();
        }
        // Light the viewmodel from the real sun direction, in camera space.
        _invQ.copy(p.camera.quaternion).invert();
        this.vmSun.position.copy(_sunDir).applyQuaternion(_invQ).multiplyScalar(5);
        r.clearDepth();
        r.render(this.vmScene, vc);
      }

      this.huds[i].layout(rect, H);
      this.huds[i].update(p, this, this.showDebug);
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this._onResize);
    this._offSettings?.();
    for (const h of this.huds) h.dispose();
    for (const p of this.players) p.dispose();
    for (const d of this.dummies) d.dispose();
    this.grenades.clear();
    this.grenades.dispose();
    this.missiles.dispose();
    this.pickups.dispose();
    this.fx.dispose();
    this.scene.traverse((o) => {
      if (!o.isSkinnedMesh) o.geometry?.dispose();
    });
    for (const m of Object.values(this.materials)) m.dispose();
    for (const t of Object.values(this.textures)) t.dispose();
    disposeCharacterMaterial();
    disposeViewmodelMaterial();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.physics.world.free();
  }
}
