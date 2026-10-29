import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT, MAX_STEPS_PER_FRAME } from './config.js';
import { DEG } from './util/math.js';
import { qualityPreset, onSettingsChange } from './settings.js';
import { createRenderer, pixelRatioFor } from './render/renderer.js';
import { viewportRects } from './render/splitscreen.js';
import { warmUp } from './render/warmup.js';
import { gfx } from './render/gfx.js';
import { createTextures, applyAnisotropy } from './world/textures.js';
import { createMaterials } from './world/materials.js';
import { buildArena, ARENA_HALF } from './world/arena.js';
import { createSky } from './world/sky.js';
import { MUDLARK_LOOK } from './world/looks.js';
import { Dummy, DUMMY_POSTS } from './world/dummies.js';
import { Effects } from './fx/effects.js';
import { Beacons } from './world/beacons.js';
import { dealDamage } from './combat/damage.js';
import { Missiles, Grenades } from './combat/projectiles.js';
import { Bolts } from './combat/bolts.js';
import { Swarms } from './combat/swarms.js';
import { Pickups } from './combat/pickups.js';
import { NavGraph } from './ai/navgraph.js';
import { MUDLARK_LINKS } from './ai/mapLinks.js';
import { BotBrain, BOT_NAMES, BOT_COLORS } from './ai/bot.js';
import { Player } from './player/player.js';
import { disposeCharacterMaterial } from './player/character.js';
import { disposeViewmodelMaterial } from './player/viewmodel.js';
import { Hud } from './ui/hud.js';
import { InfoPanel } from './ui/infoPanel.js';
import { Match } from './match.js';
import { WEAPON_SETS, DEFAULT_SET, setGuns, setLoadouts, loadoutLabel } from './combat/arsenal.js';
import { WEAPONS } from './combat/weapons.js';

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
// States: 'ready' (loaded, waiting for the player to click in), 'playing', 'paused', 'over'.
export class Game {
  static async create({
    stage,
    hudRoot,
    fps,
    sfx,
    players,
    bots = 0,
    botSkill = 'normal',
    practiceTargets = true,
    timeLimit = 5,
    weaponSet = DEFAULT_SET,
    onProgress = () => {},
  }) {
    onProgress('Lighting the smoker', 0.05);
    await initRapier();
    const game = new Game(stage, hudRoot, fps, sfx);
    const id = WEAPON_SETS[weaponSet] ? weaponSet : DEFAULT_SET;
    const set = WEAPON_SETS[id];
    const loadouts = setLoadouts(set);
    const guns = setGuns(set);
    game.arsenal = {
      id,
      set,
      guns,
      loadouts,
      labels: loadouts.map((_, i) => loadoutLabel(set, i)),
      // Whether the controls lists mention flying the Smoke Signal.
      missile: guns.some((g) => WEAPONS[g].kind === 'missile'),
    };
    game.match = new Match(game, timeLimit);
    game.match.onEnd = (results) => game.endMatch(results);
    await game.build(players, { bots, botSkill, practiceTargets }, onProgress);
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
    // Fixed ticks so far (for things that happen every few ticks).
    this.tickCount = 0;
    this.acc = 0;
    this.last = 0;
    this.needsRender = true;
    // Everyone in the match (local people and bots), and just the local people with views.
    this.players = [];
    this.humans = [];
    this.bots = [];
    this.inputs = [];
    this.huds = [];
    this.infoPanel = null;
    this.dummies = [];
    this.entities = new Map();
    this.showDebug = false;
    this._frame = (now) => this.frame(now);
    this._shot = { hit: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), entity: null, headshot: false };
    // Per-frame render numbers for the FPS readout and ?bench.
    this.stats = { renderMs: 0, shadowCalls: 0, views: 1, viewCalls: [0, 0, 0, 0] };
  }

  async build(playerDefs, { bots, botSkill, practiceTargets }, onProgress) {
    const preset = qualityPreset();
    this.renderer = createRenderer(this.stage, preset);
    this.renderer.autoClear = false;
    // Count the shared shadow pass's draw calls (it only runs once a frame, inside view 1).
    const shadowMap = this.renderer.shadowMap;
    const renderShadows = shadowMap.render.bind(shadowMap);
    shadowMap.render = (...args) => {
      const before = this.renderer.info.render.calls;
      renderShadows(...args);
      const n = this.renderer.info.render.calls - before;
      if (n) this.stats.shadowCalls = n;
    };
    // Gravity only moves dynamic bodies (grenades); players run their own floaty gravity.
    this.physics = { RAPIER, world: new RAPIER.World({ x: 0, y: -16, z: 0 }) };
    this.shotFilter = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    this.notBody = (c) => !this.entities.has(c.handle);
    this.physics.world.timestep = PHYSICS_DT;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

    onProgress('Painting textures', 0.2);
    await nextFrame();
    this.textures = createTextures(preset.textureSize);
    this.applyAnisotropy(preset);
    this.materials = createMaterials(this.textures);

    onProgress('Building the course', 0.4);
    await nextFrame();
    const scene = (this.scene = new THREE.Scene());
    const look = (this.look = MUDLARK_LOOK);
    scene.fog = new THREE.Fog(look.sky.horizon, look.fog.near, look.fog.far);
    this.setupLights(preset);
    scene.add(createSky(this.textures, this.materials, look));
    this.arena = buildArena({
      scene,
      RAPIER,
      world: this.physics.world,
      materials: this.materials,
      textures: this.textures,
      bakeSize: preset.bakeSize,
    });
    this.bake = this.arena.bake;
    this.zones = this.arena.zones;
    this.fx = new Effects(scene, this.textures);
    this.missiles = new Missiles(this, this.materials.props, this.textures);
    this.grenades = new Grenades(this, this.materials.props);
    this.bolts = new Bolts(this, this.materials.props);
    this.swarms = new Swarms(this, this.materials.props);
    this.bolts.onImpact.jar = (b, hit) => this.swarms.release(b, hit);
    if (this.arsenal.guns.some((g) => WEAPONS[g].kind === 'beam')) this.fx.enableBeams(scene);
    this.pickups = new Pickups(this, this.materials.props);
    if (gfx.beacons) {
      this.beacons = new Beacons(this.pickups.pads, this.arena.halos, this.materials);
      this.beacons.setHalos(gfx.halos && preset.halos);
      scene.add(this.beacons.mesh);
    }
    this.setupViewmodelScene();
    // One step so scene queries see the static colliders before anyone spawns.
    this.physics.world.step();

    onProgress('Teaching the bots the course', 0.55);
    await nextFrame();
    this.nav = new NavGraph(this, MUDLARK_LINKS);

    if (practiceTargets) {
      for (const def of DUMMY_POSTS) this.dummies.push(new Dummy(this, def));
    }

    playerDefs.forEach((def, i) => {
      const p = new Player(this, { id: i, input: def.source.state, name: def.name ?? `Player ${i + 1}`, loadout: def.loadout ?? 0 });
      def.source.player = p;
      this.players.push(p);
      this.humans.push(p);
      this.inputs.push(def.source);
      const { missile } = this.arsenal;
      this.huds.push(new Hud(this.hudRoot, def.source, { index: i, color: `#${p.color.toString(16).padStart(6, '0')}`, missile }));
      scene.add(p.model.group);
      this.vmScene.add(p.viewmodel.root);
      this.respawn(p, i);
    });
    for (let i = 0; i < bots; i++) {
      const brain = new BotBrain(this, botSkill);
      const p = new Player(this, {
        id: this.players.length,
        input: brain.state,
        name: BOT_NAMES[i % BOT_NAMES.length],
        brain,
        color: BOT_COLORS[i % BOT_COLORS.length].armor,
        trim: BOT_COLORS[i % BOT_COLORS.length].trim,
      });
      brain.player = p;
      this.players.push(p);
      this.bots.push(p);
      scene.add(p.model.group);
      this.respawn(p, this.players.length - 1);
    }
    this.physics.world.step();
    // Sounds fade with distance from the local players.
    this.sfx.listeners = this.humans;
    // 3 players leave a spare quadrant: fill it with the scoreboard and map.
    if (this.humans.length === 3) this.infoPanel = new InfoPanel(this.hudRoot, this);

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
    const { scene, look } = this;
    scene.add(new THREE.HemisphereLight(look.hemi.sky, look.hemi.ground, look.hemi.intensity));
    const sun = (this.sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity));
    sun.position.fromArray(look.sun.dir);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const c = sun.shadow.camera;
    fitShadowCamera(sun, ARENA_HALF + 1, 12.5);
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
    const { look } = this;
    const vm = (this.vmScene = new THREE.Scene());
    vm.add(new THREE.HemisphereLight(look.hemi.sky, look.hemi.ground, look.vm.hemi));
    this.vmSun = new THREE.DirectionalLight(look.sun.color, look.vm.sun);
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
      p.viewmodel?.warmup(true);
    }
    for (const d of this.dummies) d.model.warmup(true);
    const cam = this.humans[0].camera;
    this.humans[0].updateCamera(1, 0, window.innerWidth / window.innerHeight);
    const fwd = new THREE.Vector3(0, 0, -3).applyQuaternion(cam.quaternion).add(cam.position);
    this.missiles.warmup(true, fwd);
    this.grenades.warmup(true, fwd);
    this.bolts.warmup(true, fwd);
    this.swarms.warmup(true, fwd);
    this.pickups.warmup(true, fwd);
    this.fx.explosion(fwd, 5);
    this.fx.tracer(cam.position, fwd, 0xffffff);
    this.fx.beam(cam.position, fwd, 0xffffff, 0.03);
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
      p.viewmodel?.warmup(false);
    }
    for (const d of this.dummies) d.model.warmup(false);
    this.missiles.warmup(false);
    this.grenades.warmup(false);
    this.bolts.warmup(false);
    this.swarms.warmup(false);
    this.pickups.warmup(false);
    this.fx.clear();
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
      this.beacons?.setHalos(gfx.halos && preset.halos);
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

  // A loud thing happened at `source` (gunfire): bots in earshot take notice.
  noise(source, radius) {
    for (const b of this.bots) {
      if (b !== source && b.alive && b.center.distanceTo(source.center) < radius) b.brain.onHeard(source);
    }
  }

  onKill(victim, info) {
    this.match.onKill(victim, info);
    const a = info.attacker;
    if (a && a !== victim && a.kind === 'player') {
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
    if (this.state === 'playing' || this.state === 'over') return;
    for (const s of this.inputs) {
      s.state.clear();
      s.prime?.();
    }
    this.state = 'playing';
    this.acc = 0;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.needsRender = true;
  }

  // Time's up (or ended from the pause menu): freeze everything and hand the results over.
  endMatch(results) {
    this.state = 'over';
    this.needsRender = true;
    this.results = results;
    this.onMatchEnd?.(results);
  }

  frame(now) {
    if (this.disposed) return;
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    if (this.state === 'playing') {
      for (const src of this.inputs) src.update(dt);
      for (const p of this.humans) p.applyLook();
      this.acc += dt;
      let steps = 0;
      while (this.state === 'playing' && this.acc >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
        this.tick(PHYSICS_DT);
        this.acc -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      for (let i = 0; i < this.humans.length; i++) this.inputs[i].feel?.(this.humans[i]);
      this.infoPanel?.update(dt);
      this.updateVisuals(dt, this.acc / PHYSICS_DT);
      const t0 = performance.now();
      this.render(this.acc / PHYSICS_DT, dt);
      this.stats.renderMs = performance.now() - t0;
    } else if (this.needsRender) {
      // Paused or waiting: the canvas keeps showing the last frame, so only redraw on change.
      this.updateVisuals(0, 1);
      this.render(1, 0);
      this.needsRender = false;
    }

    this.fps.frame(dt, this.renderer.info.render.calls, this.stats);
  }

  tick(dt) {
    this.time += dt;
    this.tickCount++;
    for (const p of this.bots) {
      p.brain.think(dt);
      p.applyLook();
    }
    for (const p of this.players) p.tick(dt);
    this.missiles.tick(dt);
    this.grenades.tick(dt);
    this.bolts.tick(dt);
    this.swarms.tick(dt);
    this.pickups.tick(dt);
    for (const d of this.dummies) d.tick(dt);
    this.physics.world.step();
    for (const p of this.players) {
      if (p.alive && p.center.y < -20) dealDamage(this, p, 1e6, { cause: 'fell' });
    }
    this.match.tick(dt);
  }

  updateVisuals(dt, alpha) {
    this.arena.update(dt, this.time);
    for (const p of this.players) p.updateVisuals(dt, alpha);
    for (const d of this.dummies) d.updateVisual(dt, alpha);
    this.missiles.updateVisuals(alpha);
    this.grenades.updateVisuals(alpha);
    this.bolts.updateVisuals(alpha);
    this.swarms.updateVisuals(alpha);
    this.pickups.updateVisuals(this.time);
    this.beacons?.update(dt, this.time, this.pickups.pads);
    this.fx.update(dt);
  }

  render(alpha, dt) {
    const r = this.renderer;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rects = viewportRects(this.humans.length, W, H);
    r.info.reset();
    r.shadowMap.needsUpdate = true;
    r.setScissorTest(rects.length > 1);
    const st = this.stats;
    st.views = rects.length;
    let before = 0;
    _sunDir.copy(this.sun.position).sub(this.sun.target.position).normalize();
    for (let i = 0; i < this.humans.length; i++) {
      const p = this.humans[i];
      const rect = rects[i];
      p.updateCamera(alpha, dt, rect.w / rect.h);
      // Effects hide this player's own third-person flashes and keep a minimum on-screen size.
      this.fx.setView(p.guiding ? -1 : p.id, rect.h * r.getPixelRatio());
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.clear(true, true, false);
      r.render(this.scene, p.camera);

      if (p.showsViewmodel()) {
        for (const o of this.humans) o.viewmodel.root.visible = o === p;
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

      // Draw calls this view cost (the first view also pays for the shared shadow pass).
      st.viewCalls[i] = r.info.render.calls - before - (i === 0 ? st.shadowCalls : 0);
      before = r.info.render.calls;

      this.huds[i].layout(rect, H);
      this.huds[i].update(p, this, this.showDebug);
    }
    if (this.infoPanel) {
      this.infoPanel.layout(viewportRects(4, W, H)[3], H);
      if (dt === 0) this.infoPanel.update(1);
    }
  }

  dispose() {
    this.disposed = true;
    this.sfx.listeners = [];
    // Seats outlive the match; don't let them keep it alive.
    for (const s of this.inputs) s.player = null;
    window.removeEventListener('resize', this._onResize);
    this._offSettings?.();
    for (const h of this.huds) h.dispose();
    this.infoPanel?.dispose();
    for (const p of this.players) p.dispose();
    for (const d of this.dummies) d.dispose();
    this.grenades.clear();
    this.grenades.dispose();
    this.bolts.dispose();
    this.swarms.dispose();
    this.missiles.dispose();
    this.pickups.dispose();
    this.beacons?.dispose();
    this.fx.dispose();
    this.scene.traverse((o) => {
      if (!o.isSkinnedMesh) o.geometry?.dispose();
    });
    // (Glow tints aren't materials of their own.)
    for (const m of Object.values(this.materials)) if (!m.tintOf) m.dispose();
    for (const t of Object.values(this.textures)) t.dispose();
    // The bake outlives the match (later matches reuse it); this only frees this renderer's copy.
    this.bake.texture.dispose();
    disposeCharacterMaterial();
    disposeViewmodelMaterial();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.physics.world.free();
  }
}

// One shadow map serves every view, so its square should hug the arena (x and z within
// +-half, y from 0 to top) as tightly as possible. Rolling the shadow camera about the sun's
// axis changes how big that square has to be; try every half degree and keep the smallest.
// Today's sun: about 67 m instead of 88 m, so 1.7x the texel density for free.
function fitShadowCamera(sun, half, top) {
  const L = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
  const u0 = new THREE.Vector3(0, 1, 0).addScaledVector(L, -L.y).normalize();
  const r0 = new THREE.Vector3().crossVectors(u0, L).normalize();
  const corners = [];
  for (const x of [-half, half]) {
    for (const y of [0, top]) {
      for (const z of [-half, half]) corners.push(new THREE.Vector3(x, y, z).sub(sun.target.position));
    }
  }
  const up = new THREE.Vector3();
  const ax = new THREE.Vector3();
  const ay = new THREE.Vector3();
  let best = null;
  for (let deg = 0; deg < 180; deg += 0.5) {
    const a = deg * DEG;
    up.copy(u0).multiplyScalar(Math.cos(a)).addScaledVector(r0, Math.sin(a));
    // The camera's own axes, as lookAt builds them.
    ax.crossVectors(up, L).normalize();
    ay.crossVectors(L, ax);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of corners) {
      const px = p.dot(ax);
      const py = p.dot(ay);
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    const size = Math.max(x1 - x0, y1 - y0);
    if (!best || size < best.size) best = { size, up: up.clone(), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  const c = sun.shadow.camera;
  const h = best.size / 2 + 0.5;
  c.up.copy(best.up);
  c.left = best.cx - h;
  c.right = best.cx + h;
  c.bottom = best.cy - h;
  c.top = best.cy + h;
  c.updateProjectionMatrix();
  return best.size;
}
