import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT, MAX_STEPS_PER_FRAME, VIEWMODEL } from './config.js';
import { DEG } from './util/math.js';
import { qualityPreset, onSettingsChange } from './settings.js';
import { createRenderer, pixelRatioFor } from './render/renderer.js';
import { viewportRects } from './render/splitscreen.js';
import { warmUp } from './render/warmup.js';
import { gfx } from './render/gfx.js';
import { createTextures, applyAnisotropy } from './world/textures.js';
import { createMaterials } from './world/materials.js';
import { MAPS, DEFAULT_MAP } from './world/maps.js';
import { createSky } from './world/sky.js';
import { Dummy } from './world/dummies.js';
import { Effects } from './fx/effects.js';
import { Beacons } from './world/beacons.js';
import { renderGunIcons } from './ui/gunIcons.js';
import { Oysters } from './modes/oysters.js';
import { Props } from './world/props.js';
import { Portals } from './combat/portals.js';
import { CHARACTER_IDS } from './player/body/cast.js';
import { Gravity } from './combat/gravity.js';
import { Replay } from './render/replay.js';
import { Show } from './world/show.js';
import { Finale } from './world/finale.js';
import { dealDamage } from './combat/damage.js';
import { Missiles, Grenades } from './combat/projectiles.js';
import { Bolts } from './combat/bolts.js';
import { Swarms } from './combat/swarms.js';
import { Pickups } from './combat/pickups.js';
import { NavGraph } from './ai/navgraph.js';
import { BotBrain, BOT_NAMES, BOT_COLORS } from './ai/bot.js';
import { Player } from './player/player.js';
import { disposeCharacterMaterial } from './player/character.js';
import { disposeViewmodelMaterial, viewmodelUniforms } from './player/viewmodel.js';
import { captureReflections, releaseReflections, envUniforms } from './render/reflections.js';
import { Bloom } from './render/bloom.js';
import { applyGrade, AutoExposure, hazeBoost } from './render/grade.js';
import { createFlare } from './render/flare.js';
import { Hud } from './ui/hud.js';
import { InfoPanel } from './ui/infoPanel.js';
import { Match } from './match.js';
import { Vehicles } from './vehicles/sizzler.js';
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
const _fitT = new THREE.Vector3();
const _fitB = new THREE.Vector3();
const _fitO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
// Marks shrink to these fractions of their width to fit the surface they lie on (fitDecal).
const FIT_STEPS = [1, 0.7, 0.45, 0.3];
// How far proud of a collider a trim can stand and still carry a hit's mark (trimFace).
const TRIM_REACH = 0.1;

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
    mode = 'ffa',
    map = DEFAULT_MAP,
    weaponSet = null,
    onProgress = () => {},
  }) {
    onProgress('Lighting the smoker', 0.05);
    await initRapier();
    const game = new Game(stage, hudRoot, fps, sfx);
    game.mapId = MAPS[map] ? map : DEFAULT_MAP;
    game.map = MAPS[game.mapId];
    // No set given (or an unknown one): the map's own.
    const id = WEAPON_SETS[weaponSet] ? weaponSet : game.map.defaultSet ?? DEFAULT_SET;
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
    game.mode = mode;
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
    this._surface = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };
    // surface: what a world hit is made of (materials.js), null for bodies and unknown colliders.
    this._shot = { handle: -1, hit: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), entity: null, headshot: false, lowBlow: false, surface: null };
    this._sack = { distance: 0 };
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
    this.textures = createTextures(preset.textureSize, { normalMaps: !!preset.normalMaps && gfx.normalMaps });
    this.applyAnisotropy(preset);
    this.setupBloom(preset);
    this.materials = createMaterials(this.textures);

    onProgress('Building the course', 0.4);
    await nextFrame();
    const scene = (this.scene = new THREE.Scene());
    const look = (this.look = this.map.look);
    // (The flare's check for something between the eye and the sun: level geometry, not bodies
    // or the invisible walls and ceiling.)
    const sunFilter = (c) => !this.entities.has(c.handle) && !this.arena.blockers.has(c.handle);
    this._sunRay = (o, d, m) => {
      const ray = this.ray;
      ray.origin.x = o.x;
      ray.origin.y = o.y;
      ray.origin.z = o.z;
      ray.dir.x = d.x;
      ray.dir.y = d.y;
      ray.dir.z = d.z;
      return this.physics.world.castRay(ray, m, true, this.shotFilter, undefined, undefined, undefined, sunFilter);
    };
    // The color grade and each view's adapting exposure (render/grade.js).
    this.grade = gfx.grade ? look.grade ?? null : null;
    applyGrade(this.renderer, this.grade);
    this.exposure = this.grade ? new AutoExposure(this, this.grade) : null;
    if (this.bloom) this.bloom.godRays = !!look.godRays && gfx.godRays;
    scene.fog = new THREE.Fog(new THREE.Color(look.sky.horizon).multiplyScalar(hazeBoost(look)), look.fog.near, look.fog.far);
    this.setupLights(preset);
    this.sky = createSky(this.textures, this.materials, look);
    scene.add(this.sky);
    // The sun's lens flare (render/flare.js), on maps that see the sun.
    if (preset.flare && gfx.flare && look.flare) {
      this.flare = createFlare();
      scene.add(this.flare.mesh);
    }
    this.arena = this.map.build({
      scene,
      RAPIER,
      world: this.physics.world,
      materials: this.materials,
      textures: this.textures,
      bakeSize: preset.bakeSize,
      preset,
    });
    // One shadow map for the whole map, fitted to it.
    fitShadowCamera(this.sun, this.arena.shadowHalf ?? this.arena.half + 1, this.arena.shadowTop);
    this.bake = this.arena.bake;
    this.zones = this.arena.zones;
    this.fx = new Effects(scene, this.textures, { decals: gfx.decals ? preset.decals : 0, fxScale: preset.fxScale });
    this.missiles = new Missiles(this, this.materials.props, this.textures);
    this.grenades = new Grenades(this, this.materials.props);
    this.bolts = new Bolts(this, this.materials.props);
    this.swarms = new Swarms(this, this.materials.props);
    this.bolts.onImpact.jar = (b, hit) => this.swarms.release(b, hit);
    if (this.arsenal.guns.some((g) => WEAPONS[g].kind === 'beam')) this.fx.enableBeams(scene);
    this.pickups = new Pickups(this, this.materials.props);
    if (this.mode === 'oysters') this.oysters = new Oysters(this, scene);
    if (gfx.show && this.arena.stands?.length) this.show = new Show(this);
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
    this.nav = new NavGraph(this, this.map.links);
    // The Gravity Gun's set brings loose props to throw (after the nav graph, which ignores them).
    if (this.arsenal.guns.includes('gravityGun')) {
      this.gravity = new Gravity(this, WEAPONS.gravityGun);
      this.props = new Props(this, this.materials.props, this.pickups.pads);
    }
    // Sizzlers, on maps with spots for them (after the nav graph too: bikes aren't level).
    if (this.arena.vehicles?.length) this.vehicles = new Vehicles(this, this.arena.vehicles);
    // The Portal Gun's set: everyone's portals.
    if (this.arsenal.guns.some((g) => WEAPONS[g].kind === 'portal')) this.portals = new Portals(this, gfx.portalViews ? preset.portalViews : 0);

    if (practiceTargets) {
      for (const def of this.arena.dummyPosts) this.dummies.push(new Dummy(this, def));
    }

    playerDefs.forEach((def, i) => {
      const p = new Player(this, { id: i, input: def.source.state, name: def.name ?? `Player ${i + 1}`, loadout: def.loadout ?? 0, character: def.character ?? 'spartan' });
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
        // Bots come as any character.
        character: CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)],
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
    // Death replays record every body from here on.
    this.replay = new Replay(this);
    // 3 players leave a spare quadrant: fill it with the scoreboard and map.
    if (this.humans.length === 3) this.infoPanel = new InfoPanel(this.hudRoot, this);

    onProgress('Compiling shaders', 0.7);
    await nextFrame();
    // Pictures of the set's guns for the loadout cards (once per page; menus show them).
    renderGunIcons(this.renderer, this.arsenal.guns);
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
    this.vmHemi = new THREE.HemisphereLight(look.hemi.sky, look.hemi.ground, look.vm.hemi);
    vm.add(this.vmHemi);
    this.vmSun = new THREE.DirectionalLight(look.sun.color, look.vm.sun);
    vm.add(this.vmSun, this.vmSun.target);
    this.vmCamera = new THREE.PerspectiveCamera(VIEWMODEL.fov, 1, 0.01, 10);
    viewmodelUniforms.uSky.value.set(look.hemi.sky);
    viewmodelUniforms.uGround.value.set(look.hemi.ground);
  }

  // Bloom on the High preset (render/bloom.js).
  setupBloom(preset) {
    const on = !!preset.bloom && gfx.bloom;
    if (on && !this.bloom) this.bloom = new Bloom({ samples: preset.antialias ? 4 : 0 });
    if (this.bloom) this.bloom.godRays = !!this.look?.godRays && gfx.godRays;
    if (!on && this.bloom) {
      this.bloom.dispose();
      this.bloom = null;
    }
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
    this.vehicles?.warmup(true, fwd);
    this.oysters?.warmup(true, fwd);
    this.portals?.warmup(true, fwd);
    this.flare?.warmup(true);
    this.props?.updateVisuals(1);
    const finaleBits = Finale.warmupMeshes();
    for (const m of finaleBits) {
      m.position.copy(fwd);
      this.scene.add(m);
    }
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
    this.vehicles?.warmup(false);
    this.oysters?.warmup(false);
    this.flare?.warmup(false);
    this.portals?.warmup(false);
    for (const m of finaleBits) {
      m.removeFromParent();
      m.geometry.dispose();
      m.material.dispose();
    }
    this.fx.clear();
    // The arena's reflection for armor, visors and guns, from above the podium with nobody in it.
    if (gfx.reflections) {
      const pod = this.arena.podium;
      const hide = [...this.players.map((p) => p.model.group), ...this.dummies.map((d) => d.model.group)];
      this.reflections = captureReflections(this.renderer, this.scene, new THREE.Vector3(pod.x, pod.y + 3, pod.z), hide);
    }
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
      this.setupBloom(preset);
      this.beacons?.setHalos(gfx.halos && preset.halos);
      // (Room for marks is set at load: a new count applies from the next match.)
      this.fx.fxScale = preset.fxScale;
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
    const entity = hit ? this.entities.get(hit.collider.handle) ?? null : null;
    r.lowBlow = false;
    // The collider hit (portals won't open on the invisible blockers), -1 for none.
    r.handle = hit ? hit.collider.handle : -1;
    // Rocky Mountain Oysters: a sack in the way is hit before whatever is behind it.
    const sack = this.oysters?.rayHit(origin, dir, hit ? hit.timeOfImpact : range, exclude, this._sack);
    if (sack) {
      r.hit = true;
      r.distance = this._sack.distance;
      r.point.copy(origin).addScaledVector(dir, r.distance);
      r.normal.copy(dir).negate();
      r.entity = sack;
      r.headshot = false;
      r.lowBlow = true;
      r.surface = null;
      return r;
    }
    // The mud has no collider (you wade through it), so a shot, projectile or bug flying into it
    // stops at its surface. (A body under it can still be hit, as before.)
    const mud = entity ? null : this.zones.mudAlong(origin, dir, hit ? hit.timeOfImpact : range);
    if (mud !== null) {
      r.hit = true;
      r.distance = mud;
      r.point.copy(origin).addScaledVector(dir, mud);
      r.normal.set(0, 1, 0);
      r.entity = null;
      r.headshot = false;
      r.surface = 'mud';
      return r;
    }
    if (!hit) {
      r.hit = false;
      r.entity = null;
      r.headshot = false;
      r.surface = null;
      r.distance = range;
      return r;
    }
    r.hit = true;
    r.distance = hit.timeOfImpact;
    r.point.copy(origin).addScaledVector(dir, hit.timeOfImpact);
    r.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    r.entity = entity;
    r.headshot = !!r.entity && r.point.y >= r.entity.headLineY();
    r.surface = r.entity ? null : this.arena.surfaces.get(hit.collider.handle) ?? null;
    return r;
  }

  // The level surface within maxDist of pos along dir (a unit vector), as { point, normal,
  // surface } written into out (a reused object by default), or null. Bodies and grenades
  // don't count.
  surfaceNear(pos, dir, maxDist, out = this._surface) {
    const ray = this.ray;
    ray.origin.x = pos.x;
    ray.origin.y = pos.y;
    ray.origin.z = pos.z;
    ray.dir.x = dir.x;
    ray.dir.y = dir.y;
    ray.dir.z = dir.z;
    const hit = this.physics.world.castRayAndGetNormal(ray, maxDist, true, this.shotFilter, undefined, undefined, undefined, this.notBody);
    // (Starting inside a solid gives no usable normal.)
    if (!hit || hit.timeOfImpact <= 0) return null;
    const s = out;
    s.point.copy(pos).addScaledVector(dir, hit.timeOfImpact);
    s.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    s.surface = this.arena.surfaces.get(hit.collider.handle) ?? null;
    return s;
  }

  // A shot stops at a collider, but a thin trim with no collider of its own (hazard bands, glow
  // strips, pickup pads, drum rings) can stand a few cm proud of it. Moves a hit out to the face
  // of a trim covering it, so marks and debris sit on what you see, and returns the surface there
  // (null on glow strips, which take no marks). Only trims whose face is within TRIM_REACH of the
  // hit count: a long band runs past the end of a buttress's side, which it doesn't cover.
  trimFace(point, normal, surface) {
    const k = Math.abs(normal.x) > 0.99 ? 0 : Math.abs(normal.y) > 0.99 ? 1 : Math.abs(normal.z) > 0.99 ? 2 : -1;
    const up = k >= 0 && normal.getComponent(k) > 0;
    const i = (k + 1) % 3;
    const j = (k + 2) % 3;
    for (const t of this.arena.trims) {
      if (t.cyl) {
        const dx = point.x - t.x;
        const dz = point.z - t.z;
        const d2 = dx * dx + dz * dz;
        if (k === 1 && up) {
          // On top of a pad.
          if (point.y < t.y0 - 0.01 || point.y >= t.y1 || t.y1 - point.y > TRIM_REACH || d2 > t.r * t.r) continue;
          point.y = t.y1;
          surface = t.surface;
        } else if (Math.abs(normal.y) < 0.2 && point.y >= t.y0 && point.y <= t.y1) {
          // On the side of a ring around a pole or drum.
          const d = Math.sqrt(d2);
          if (d < 1e-3 || d > t.r + 0.01 || t.r - d > TRIM_REACH) continue;
          point.x = t.x + (dx / d) * t.r;
          point.z = t.z + (dz / d) * t.r;
          surface = t.surface;
        }
        continue;
      }
      if (k < 0) continue;
      const pi = point.getComponent(i);
      const pj = point.getComponent(j);
      if (pi < t.min[i] - 1e-3 || pi > t.max[i] + 1e-3 || pj < t.min[j] - 1e-3 || pj > t.max[j] + 1e-3) continue;
      const pk = point.getComponent(k);
      const face = up ? t.max[k] : t.min[k];
      if (up ? pk < t.min[k] - 0.01 || pk >= face : pk <= face || pk > t.max[k] + 0.01) continue;
      if (Math.abs(face - pk) > TRIM_REACH) continue;
      point.setComponent(k, face);
      surface = t.surface;
    }
    return surface;
  }

  // How wide a mark centered on a surface (from surfaceNear) can be, up to width, and still lie
  // on it without hanging over an edge into the air: probes just off the surface at four points
  // near the mark's edge, shrinking it until they all find the same flat surface. 0 if none fits.
  fitDecal(surface, width) {
    const n = surface.normal;
    _fitT.crossVectors(n, Math.abs(n.y) < 0.99 ? UP : X_AXIS).normalize();
    _fitB.crossVectors(n, _fitT);
    const ray = this.ray;
    for (const k of FIT_STEPS) {
      const r = width * k * 0.42;
      let fits = true;
      for (let i = 0; i < 4 && fits; i++) {
        const a = i === 0 ? 1 : i === 1 ? -1 : 0;
        const c = i === 2 ? 1 : i === 3 ? -1 : 0;
        _fitO.copy(surface.point).addScaledVector(n, 0.1).addScaledVector(_fitT, a * r).addScaledVector(_fitB, c * r);
        ray.origin.x = _fitO.x;
        ray.origin.y = _fitO.y;
        ray.origin.z = _fitO.z;
        ray.dir.x = -n.x;
        ray.dir.y = -n.y;
        ray.dir.z = -n.z;
        const hit = this.physics.world.castRayAndGetNormal(ray, 0.25, true, this.shotFilter, undefined, undefined, undefined, this.notBody);
        fits = !!hit && Math.abs(hit.timeOfImpact - 0.1) < 0.05 && hit.normal.x * n.x + hit.normal.y * n.y + hit.normal.z * n.z > 0.95;
      }
      if (fits) return width * k;
    }
    return 0;
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
    this.oysters?.onKill(victim, info, this.match);
    this.show?.onKill(victim, info);
    // Smoked: your sticky bombs fizzle and what your gravity gun held drops.
    if (victim.kind === 'player') {
      this.replay?.start(victim, info.attacker);
      this.grenades.removeStickies(victim);
      this.gravity?.release(victim, false);
    }
    const a = info.attacker;
    if (a && a !== victim && a.kind === 'player') {
      a.feedback.killT = this.time;
      a.feedback.killText = victim.kind === 'vehicle' ? `${victim.name} destroyed` : `Smoked ${victim.name}${info.headshot ? ' · headshot' : ''}`;
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
    for (const p of this.humans) p.pickHold = true;
    this.state = 'playing';
    this.acc = 0;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.vehicles?.silence();
    this.needsRender = true;
  }

  // Time's up (or ended from the pause menu): freeze everything and hand the results over.
  endMatch(results) {
    this.state = 'over';
    this.vehicles?.silence();
    this.needsRender = true;
    this.results = results;
    // The podium, confetti and a camera of its own; the views' HUDs step aside.
    this.finale = new Finale(this, results);
    this.hudRoot.classList.add('finale');
    this.onMatchEnd?.(results);
  }

  frame(now) {
    if (this.disposed) return;
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    if (this.state === 'playing') {
      for (const src of this.inputs) src.update(dt);
      for (const p of this.humans) p.applyLook(dt);
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
    } else if (this.finale) {
      // The match is over: the finale animates behind the results.
      this.finale.update(dt);
      this.show?.update(dt);
      this.fx.update(dt);
      this.render(1, dt);
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
    // (After the riders' ticks: bikes read their presses and carry them along.)
    this.vehicles?.tick(dt);
    this.missiles.tick(dt);
    this.grenades.tick(dt);
    this.bolts.tick(dt);
    this.swarms.tick(dt);
    this.pickups.tick(dt);
    this.gravity?.tick();
    this.props?.tick(dt);
    this.oysters?.tick(dt);
    for (const d of this.dummies) d.tick(dt);
    this.physics.world.step();
    this.props?.settle();
    for (const p of this.players) {
      if (p.alive && p.center.y < -20) dealDamage(this, p, 1e6, { cause: 'fell' });
    }
    this.match.tick(dt);
  }

  updateVisuals(dt, alpha) {
    this.arena.update(dt, this.time, this.fx);
    this.exposure?.update(dt);
    this.sky.update?.(this.time);
    this.vehicles?.updateVisuals(dt, alpha);
    for (const p of this.players) p.updateVisuals(dt, alpha);
    for (const d of this.dummies) d.updateVisual(dt, alpha);
    this.missiles.updateVisuals(alpha);
    this.grenades.updateVisuals(alpha);
    this.bolts.updateVisuals(alpha);
    this.swarms.updateVisuals(alpha);
    this.pickups.updateVisuals(this.time);
    this.props?.updateVisuals(alpha);
    this.oysters?.updateVisuals(dt);
    this.portals?.updateVisuals(dt);
    this.show?.update(dt);
    this.beacons?.update(dt, this.time, this.pickups.pads, this.players);
    this.fx.update(dt);
    this.replay?.record(alpha);
  }

  render(alpha, dt) {
    const r = this.renderer;
    if (this.finale) {
      r.info.reset();
      r.toneMappingExposure = this.grade ? this.grade.open : 1;
      this.finale.render(r);
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rects = viewportRects(this.humans.length, W, H);
    r.info.reset();
    r.shadowMap.needsUpdate = true;
    r.setScissorTest(rects.length > 1);
    const bloom = this.bloom;
    bloom?.begin(r);
    const st = this.stats;
    st.views = rects.length;
    let before = 0;
    _sunDir.copy(this.sun.position).sub(this.sun.target.position).normalize();
    // Views showing a death replay render last, so the shared shadow pass (in the first view's
    // render) sees the present.
    const order = this._viewOrder ?? (this._viewOrder = []);
    order.length = 0;
    for (let i = 0; i < this.humans.length; i++) if (!(this.replay?.showing(this.humans[i]) >= 0)) order.push(i);
    for (let i = 0; i < this.humans.length; i++) if (!order.includes(i)) order.push(i);
    for (const i of order) {
      const p = this.humans[i];
      const rect = rects[i];
      p.updateCamera(alpha, dt, rect.w / rect.h);
      const replaying = this.replay?.showing(p) >= 0 && this.replay.begin(p, p.camera);
      // Effects hide this player's own third-person flashes and keep a minimum on-screen size.
      this.fx.setView(p.guiding ? -1 : p.id, rect.h * r.getPixelRatio());
      if (this.oysters) this.oysters.uniforms.uHide.value = replaying ? this.replay.killerOf(p).id : p.guiding ? -1 : p.id;
      // This view's exposure (the eye adapting to where this player stands).
      const exposure = this.exposure ? this.exposure.value(p) : 1;
      r.toneMappingExposure = exposure;
      const sunVis = this.flare ? this.flare.setView(p, p.camera, rect.w / rect.h, _sunDir, this._sunRay, dt) : 0;
      if (bloom) bloom.view(r, rect, exposure, this.flare ? this.flare.uniforms.uSun.value : null, sunVis);
      else {
        r.setViewport(rect.x, rect.y, rect.w, rect.h);
        r.setScissor(rect.x, rect.y, rect.w, rect.h);
      }
      r.clear(true, true, false);
      r.render(this.scene, p.camera);
      if (replaying) this.replay.end(p.camera);

      if (!replaying && p.showsViewmodel()) {
        for (const o of this.humans) o.viewmodel.root.visible = o === p;
        const vc = this.vmCamera;
        if (vc.aspect !== rect.w / rect.h || vc.fov !== VIEWMODEL.fov) {
          vc.aspect = rect.w / rect.h;
          vc.fov = VIEWMODEL.fov;
          vc.updateProjectionMatrix();
        }
        // The gun has its own lights, so they're turned down by as much as this view's exposure
        // turns everything up: an eye adapted to the dark doesn't make the gun glow.
        const k = (this.grade ? this.grade.open : 1) / exposure;
        this.vmHemi.intensity = this.look.vm.hemi * k;
        this.vmSun.intensity = this.look.vm.sun * k;
        // Light the viewmodel from the real sun direction, in camera space.
        _invQ.copy(p.camera.quaternion).invert();
        this.vmSun.position.copy(_sunDir).applyQuaternion(_invQ).multiplyScalar(5);
        viewmodelUniforms.uUp.value.set(0, 1, 0).applyQuaternion(_invQ);
        envUniforms.uCamRot.value.setFromMatrix4(p.camera.matrixWorld);
        p.viewmodel.bind();
        r.clearDepth();
        r.render(this.vmScene, vc);
      }

      // Draw calls this view cost (the first view also pays for the shared shadow pass).
      st.viewCalls[i] = r.info.render.calls - before - (i === order[0] ? st.shadowCalls : 0);
      before = r.info.render.calls;

      this.huds[i].layout(rect, H);
      this.huds[i].update(p, this, this.showDebug);
    }
    // Portal pictures of the other side, a few times a second (after the views, so the shadow
    // map is already this frame's).
    this.portals?.snapshot(r);
    bloom?.end(r);
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
    this.oysters?.dispose();
    this.portals?.dispose();
    releaseReflections(this.reflections);
    this.bloom?.dispose();
    this.show?.dispose();
    this.finale?.dispose();
    this.hudRoot.classList.remove('finale');
    this.gravity?.clear();
    this.props?.dispose();
    for (const p of this.players) p.dispose();
    for (const d of this.dummies) d.dispose();
    this.grenades.clear();
    this.grenades.dispose();
    this.bolts.dispose();
    this.swarms.dispose();
    this.missiles.dispose();
    this.pickups.dispose();
    this.vehicles?.dispose();
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
