import * as THREE from 'three';
import { BODY, MOVE, CAMERA, AIM, CORPSE, SIZE } from '../config.js';
import { settings } from '../settings.js';
import { DEG, clamp, damp, approach2, smoothstep } from '../util/math.js';
import { Vitals } from '../combat/vitals.js';
import { WEAPONS, WeaponState, GRENADE, SWITCH_TIME } from '../combat/weapons.js';
import { InputState } from '../input/inputState.js';
import { updateShooting, cancelReload } from '../combat/shooting.js';
import { dealDamage } from '../combat/damage.js';
import { CharacterModel } from './character.js';
import { GUNS } from '../combat/guns/index.js';
import { Viewmodel } from './viewmodel.js';

// One player's body, movement and first-person camera. Reads an InputState, so the same
// controller drives keyboard/mouse players, gamepad players and (later) bots.
//
// Modes:
//   move    normal walking / jumping / falling (a sprint-slide is part of it: `sliding`)
//   mantle  scripted pull-up onto a ledge
//   net     climbing a cargo net
//   rope    climbing a rope
//   bars    hanging from monkey bars
//   dead    smoked, waiting to respawn

export const RESPAWN_DELAY = 3;
const FIRE_DPS = 45;
// Zoomed past this with a scoped gun, you look through the scope.
export const SCOPE_ZOOM = 1.6;
export const PLAYER_COLORS = [0x3d7bd9, 0xd9443d, 0x3dbd5a, 0xe0b53a];

const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const STAND_HH = BODY.standHeight / 2 - BODY.radius;
const CROUCH_HH = BODY.crouchHeight / 2 - BODY.radius;
const CROUCH_SHIFT = STAND_HH - CROUCH_HH;
// Camera height above the capsule center.
const EYE_OFF_STAND = BODY.eyeStand - BODY.standHeight / 2;
const EYE_OFF_CROUCH = BODY.eyeCrouch - BODY.crouchHeight / 2;
// Hands sit this far above the top of the capsule when reaching up.
const HAND_ABOVE_TOP = BODY.handReach - BODY.standHeight;

const _c = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _down = new THREE.Vector3(0, -1, 0);
// While flying a missile the body gets no movement input.
// How long after spawning a loadout change still swaps your guns on the spot (s).
const LOADOUT_GRACE = 3;
const NEUTRAL_INPUT = new InputState();
const NO_PRESSES = NEUTRAL_INPUT.consumePressed();

export class Player {
  // brain: set for bots (an AI writing `input`); bots have no camera view or viewmodel.
  // loadout: index into the match's weapon set loadouts (bots roll a new one every life).
  constructor(game, { id, input, name, brain = null, color = null, trim = null, loadout = 0 }) {
    this.game = game;
    this.kind = 'player';
    this.id = id;
    this.name = name;
    this.input = input;
    this.brain = brain;
    this.isBot = !!brain;

    const { RAPIER, world } = game.physics;
    this.RAPIER = RAPIER;
    this.world = world;
    // Grenades (dynamic bodies) bounce off players but never block or carry them.
    this.filter = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    // Mantle probes ignore bodies, so nobody vaults onto someone's head.
    this.notBody = (c) => !game.entities.has(c.handle);
    // Wall kicks push off fixed level geometry only: no bodies, grenades, sensors or the
    // invisible blockers over the perimeter walls.
    this.wallFilter = RAPIER.QueryFilterFlags.ONLY_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    this.kickable = (c) => !game.entities.has(c.handle) && !game.arena.blockers.has(c.handle);

    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(STAND_HH, BODY.radius), this.body);
    this.cc = world.createCharacterController(BODY.skin);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setMaxSlopeClimbAngle(50 * DEG);
    this.cc.setMinSlopeSlideAngle(50 * DEG);
    this.cc.enableAutostep(0.45, 0.2, false);
    this.cc.enableSnapToGround(0.35);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    // Shrink Wrap: our size (1 normal; the collider, shapes, camera and body scale with it), how
    // long it lasts, who changed it, what it does to our speed and jumps, and the body's drawn
    // scale (it morphs over SIZE.morph).
    this.size = 1;
    this.sizeT = 0;
    this.sizeBy = null;
    this.sizeSpeed = 1;
    this.sizeJump = 1;
    this.sizeShown = 1;
    this.makeShapes();
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.collision = new RAPIER.CharacterCollision();
    this.desired = { x: 0, y: 0, z: 0 };

    // Capsule center this tick and last tick (for render interpolation).
    this.center = new THREE.Vector3();
    this.prevCenter = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.feet = new THREE.Vector3();

    this.mode = 'move';
    this.grounded = false;
    this.crouched = false;
    this.sprinting = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airJumpsLeft = MOVE.airJumps;
    this.grabCooldown = 0;
    this.mantleCooldown = 0;
    this.blockedAhead = false;
    this.inMud = false;
    this.inFire = false;
    this.net = null;
    this.rope = null;
    this.bars = null;
    this.mantle = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0.3, exitX: 0, exitZ: 0 };
    this.netLoc = { s: 0, t: 0, d: 0 };
    // Sprint-slide, and how long until the next one can start.
    this.sliding = false;
    this.slideCooldown = 0;
    this.slideSfx = null;
    // Wall kicks: the cooldown between kicks, weaker air steering right after one, kicks left
    // before touching the ground or a climbable again, and the last wall kicked off (its
    // collider and plane: no second kick off it before touching the ground or another wall).
    this.kickCooldown = 0;
    this.kickSteerT = 0;
    this.kicksLeft = MOVE.wallKicksPerAir;
    this.kickWall = { on: false, handle: -1, nx: 0, nz: 0, d: 0 };
    // Our capsule grown by the kick reach (to find walls), and the nearest wall found.
    const v0 = { x: 0, y: 0, z: 0 };
    this.contact = new RAPIER.ShapeContact(0, { ...v0 }, { ...v0 }, { ...v0 }, { ...v0 });
    // into: whether the stick (kickWish) pushes into any wall in reach.
    this.wall = { dist: Infinity, handle: -1, nx: 0, nz: 0, x: 0, y: 0, z: 0, into: false };
    this.kickWish = { x: 0, z: 0, len: 0 };
    this._onWall = (collider) => this.considerWall(collider);

    // Camera state.
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, CAMERA.near, CAMERA.far);
    this.camera.rotation.order = 'YXZ';
    this.eyeOff = EYE_OFF_STAND;
    this.landDip = 0;
    this.fovBoost = 0;
    this.slideTilt = 0;
    this._fovH = this._fovA = this._fovZ = NaN;
    this.deathRoll = 0;
    this.lastLookX = 0;
    this.lastLookY = 0;

    // Combat.
    this.vitals = new Vitals();
    this.slots = [null, null];
    this.slot = 0;
    this.loadout = loadout;
    // The loadout last armed, and when this life began (cycleLoadout).
    this.armedLoadout = loadout;
    this.spawnedAt = -Infinity;
    this.spawnShots = 0;
    // Last left/right direction on the respawn screen, for picking the next loadout.
    this.pickDir = 0;
    this.pickHold = false;
    // Movement and jump multipliers from a game mode (Rocky Mountain Oysters).
    this.burdenSpeed = 1;
    this.burdenJump = 1;
    this.grenades = GRENADE.start;
    this.switchT = 0;
    this.meleeT = 0;
    this.throwT = 0;
    // When our last third-person muzzle flash went off (game time).
    this.flashT = -1;
    // What the third-person body shows (CharacterModel.update), reused every frame. lands,
    // airJumps and wallKicks count events, so the body can start a landing squash, a
    // double-jump kick or a push off a wall (kickSide: 1 when the wall was on our right). A
    // slide also reports crouched.
    this.pose = {
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, fwd: 0, side: 0, velY: 0,
      grounded: true, crouched: false, climbing: false, sprinting: false, aiming: false, sliding: false,
      lands: 0, landSpeed: 0, airJumps: 0, wallKicks: 0, kickSide: 1, shots: 0, fireT: 99, fireHold: 0.6, kick: 1,
    };
    this.guiding = null;
    this.pickupPrompt = null;
    this.lungeT = 0;
    this.lungeSpeed = 0;
    this.lungeDir = new THREE.Vector3();
    this.knockT = 0;
    this.shake = 0;
    this.stats = { kills: 0, deaths: 0, score: 0 };
    this.aimZoom = 1;
    this.aimTarget = null;
    this.aimNear = null;
    this.sprintLock = 0;
    this.deathT = 0;
    this.deathInfo = null;
    this.feedback = { hitT: -99, hitKind: '', hurtT: -99, killT: -99, killText: '', hurtDirT: -99, hurtFromX: 0, hurtFromZ: 0 };
    game.registerEntity(this.collider, this);

    // Third-person body for everyone else's views (hidden from our own camera by layer),
    // and the first-person rifle.
    const armor = color ?? PLAYER_COLORS[id % PLAYER_COLORS.length];
    this.color = armor;
    this.model = new CharacterModel({ armor, trim, guns: game.arsenal.guns });
    if (this.isBot) {
      // Everyone sees bots; they have no view of their own.
      this.viewmodel = null;
    } else {
      this.model.setLayer(1 + id);
      this.camera.layers.enableAll();
      this.camera.layers.disable(1 + id);
      this.viewmodel = new Viewmodel(game.textures, armor, game.arsenal.guns);
    }
    this.armLoadout();
  }

  // Both guns of the chosen loadout, full ammo. They stay with you when you're smoked.
  armLoadout() {
    const loadouts = this.game.arsenal.loadouts;
    this.loadout = ((this.loadout % loadouts.length) + loadouts.length) % loadouts.length;
    this.armedLoadout = this.loadout;
    loadouts[this.loadout].guns.forEach((id, i) => {
      const w = new WeaponState(WEAPONS[id]);
      w.spawnGun = true;
      this.slots[i] = w;
    });
    this.slot = 0;
  }

  // Picks the next or previous loadout (dir 1 or -1). It's armed now when `now` (before the
  // first drop-in) or when this life has only just started and is still untouched (no shot, no
  // pickup, not flying a missile); otherwise it waits for the next spawn.
  cycleLoadout(dir, now = false) {
    const n = this.game.arsenal.loadouts.length;
    this.loadout = (((this.loadout + dir) % n) + n) % n;
    const fresh =
      this.alive &&
      !this.guiding &&
      this.game.time - this.spawnedAt < LOADOUT_GRACE &&
      this.pose.shots === this.spawnShots &&
      this.slots.every((w) => !w || w.spawnGun);
    if (now || fresh) {
      this.armLoadout();
      this.slot = 0;
      this.switchT = 0;
    }
  }

  // On the respawn screen, left/right picks the loadout for the next life.
  pickLoadout() {
    const x = this.input.moveX;
    const dir = x > 0.5 ? 1 : x < -0.5 ? -1 : 0;
    // A direction still held from the pause menu (where it may have changed the loadout
    // already) waits to be let go.
    if (this.pickHold) {
      if (!dir) this.pickHold = false;
    } else if (dir && dir !== this.pickDir) {
      const n = this.game.arsenal.loadouts.length;
      this.loadout = (this.loadout + dir + n) % n;
    }
    this.pickDir = dir;
  }

  // First-person gun on screen: not while dead, flying a missile or looking through a scope.
  showsViewmodel() {
    return this.alive && !this.guiding && !(this.weapon.def.scope && this.aimZoom > SCOPE_ZOOM);
  }

  get alive() {
    return this.vitals.alive;
  }

  get weapon() {
    return this.slots[this.slot];
  }

  centerPosition(out) {
    return out.copy(this.center);
  }

  // The muzzle of the gun in our third-person body's hands, as last drawn (at most a frame
  // behind): where other players see our shots and flashes come from.
  worldMuzzle(out) {
    const id = this.weapon.def.id;
    const bone = this.model.bones[`gun:${id}`];
    if (!bone) return this.eyePosition(out);
    return out.fromArray(GUNS[id].muzzle).applyMatrix4(bone.matrixWorld);
  }

  facing(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  // Distance from a point to the surface of our capsule.
  distanceToBody(p) {
    const hh = this.halfHeight;
    const y = clamp(p.y, this.center.y - hh, this.center.y + hh);
    return Math.hypot(p.x - this.center.x, p.y - y, p.z - this.center.z) - this.radius;
  }

  // Put a weapon in the empty slot (or replace the held one). Returns the slot used.
  giveWeapon(def, mag, reserve) {
    const state = new WeaponState(def);
    state.mag = mag;
    state.reserve = reserve;
    const slot = this.slots[0] && this.slots[1] ? this.slot : this.slots[0] ? 1 : 0;
    this.slots[slot] = state;
    this.slot = slot;
    this.switchT = def.switchTime ?? SWITCH_TIME;
    return slot;
  }

  knockback(dir, speed) {
    if (this.mode === 'net' || this.mode === 'rope' || this.mode === 'bars') this.leaveClimb(0, 0, 0, 0.4);
    if (this.mode !== 'move') return;
    this.vel.addScaledVector(dir, speed);
    if (dir.y > 0.2) this.grounded = false;
    this.knockT = 0.4;
  }

  startLunge(dir, speed, time) {
    if (this.mode !== 'move') return;
    this.lungeDir.copy(dir);
    this.lungeSpeed = speed;
    this.lungeT = time;
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  headLineY() {
    return this.topY() - 0.32 * this.size;
  }

  // The eye's height above the capsule center.
  eyeOffset() {
    return (this.crouched ? EYE_OFF_CROUCH : EYE_OFF_STAND) * this.size;
  }

  eyePosition(out) {
    return out.set(this.center.x, this.center.y + this.eyeOffset(), this.center.z);
  }

  get radius() {
    return BODY.radius * this.size;
  }

  get halfHeight() {
    return (this.crouched ? CROUCH_HH : STAND_HH) * this.size;
  }

  get height() {
    return (this.crouched ? BODY.crouchHeight : BODY.standHeight) * this.size;
  }

  feetY() {
    return this.center.y - this.halfHeight - this.radius;
  }

  topY() {
    return this.center.y + this.halfHeight + this.radius;
  }

  // The overlap and wall-reach test shapes for our size. Slightly thinner test shapes so
  // touching a wall doesn't count as overlapping it.
  makeShapes() {
    const { RAPIER } = this;
    const k = this.size;
    const r = BODY.radius * k;
    this.standShape = new RAPIER.Capsule(STAND_HH * k, r - 0.03 * k);
    this.crouchShape = new RAPIER.Capsule(CROUCH_HH * k, r - 0.03 * k);
    this.reachStand = new RAPIER.Capsule(STAND_HH * k, r + MOVE.wallKickReach);
    this.reachCrouch = new RAPIER.Capsule(CROUCH_HH * k, r + MOVE.wallKickReach);
  }

  // Shrink Wrap: change size (SIZE.small, 1 or SIZE.big) with the feet staying put. Growing
  // needs room: returns false (and changes nothing) when the bigger body wouldn't fit.
  setSize(size, by = null) {
    this.sizeT = size === 1 ? 0 : SIZE.time;
    this.sizeBy = size === 1 ? null : by;
    if (size === this.size) return true;
    const feet = this.feetY();
    const hh = (this.crouched ? CROUCH_HH : STAND_HH) * size;
    const r = BODY.radius * size;
    const y = feet + hh + r + 0.02;
    if (size > this.size && this.alive) {
      const old = this.size;
      this.size = size;
      this.makeShapes();
      const fits = !this.overlaps(this.crouched ? this.crouchShape : this.standShape, this.center.x, y, this.center.z);
      if (!fits) {
        this.size = old;
        this.makeShapes();
        this.sizeT = old === 1 ? 0 : SIZE.time;
        return false;
      }
    } else {
      this.size = size;
      this.makeShapes();
    }
    this.collider.setHalfHeight(hh);
    this.collider.setRadius(r);
    const dy = y - this.center.y;
    this.center.y += dy;
    this.prevCenter.y += dy;
    this.body.setTranslation(this.center, true);
    this.sizeSpeed = size < 1 ? SIZE.smallSpeed : size > 1 ? SIZE.bigSpeed : 1;
    this.sizeJump = size < 1 ? SIZE.smallJump : 1;
    return true;
  }

  spawn(point) {
    if (this.size !== 1) this.setSize(1);
    this.sizeShown = 1;
    this.model.group.scale.setScalar(1);
    if (this.crouched) {
      this.collider.setHalfHeight(STAND_HH);
      this.crouched = false;
    }
    this.center.set(point.position.x, point.position.y + STAND_HH + BODY.radius + 0.05, point.position.z);
    this.prevCenter.copy(this.center);
    this.body.setTranslation(this.center, true);
    this.body.setNextKinematicTranslation(this.center);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.vel.set(0, 0, 0);
    this.yaw = point.yaw;
    this.pitch = 0;
    this.mode = 'move';
    this.grounded = false;
    this.sprinting = false;
    this.sliding = false;
    this.slideCooldown = this.kickCooldown = this.kickSteerT = 0;
    this.kickWall.on = false;
    this.airJumpsLeft = MOVE.airJumps;
    this.kicksLeft = MOVE.wallKicksPerAir;
    this.eyeOff = EYE_OFF_STAND;
    this.landDip = 0;
    this.deathRoll = 0;
    this.slideTilt = 0;
    this.aimZoom = 1;
    this.sprintLock = 0;
    this.input.clear();
    this.vitals.reset();
    if (this.isBot) this.loadout = this.brain.pickLoadout();
    this.armLoadout();
    this.slot = 0;
    // For a loadout change right after spawning (cycleLoadout).
    this.spawnedAt = this.game.time;
    this.spawnShots = this.pose.shots;
    this.grenades = GRENADE.start;
    this.switchT = this.meleeT = this.throwT = this.lungeT = this.knockT = 0;
    this.guiding = null;
    this.pickupPrompt = null;
    this.deathInfo = null;
    this.collider.setEnabled(true);
    this.model.reset();
    this.model.group.visible = true;
  }

  // Called every rendered frame, so aiming stays responsive at any display rate.
  applyLook() {
    let [lx, ly] = this.input.takeLook();
    if (this.guiding) {
      this.guiding.steer(lx * 0.8, ly * 0.8);
      this.lastLookX = this.lastLookY = 0;
      return;
    }
    // Slower turning while zoomed so aim feels the same on screen.
    lx /= this.aimZoom;
    ly /= this.aimZoom;
    // Controllers: slower over someone, and a little slower near them (Halo-style slowdown).
    if (this.input.assist && !this.isBot && (this.aimTarget || this.aimNear)) {
      const f = this.aimTarget ? AIM.frictionOn : AIM.frictionNear;
      lx *= f;
      ly *= f;
    }
    this.yaw -= lx;
    // Keep yaw in [-PI, PI] so long sessions never lose precision.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.pitch = clamp(this.pitch - ly, -CAMERA.maxPitch, CAMERA.maxPitch);
    this.lastLookX = lx;
    this.lastLookY = ly;
  }

  // ---------------------------------------------------------------- fixed tick

  tick(dt) {
    const pressed = this.input.consumePressed();
    this.prevCenter.copy(this.center);
    if (this.mode === 'dead') {
      this.deathT += dt;
      if (!this.isBot) this.pickLoadout();
      if (this.deathT >= RESPAWN_DELAY) this.game.respawn(this);
      return;
    }
    this.grabCooldown = Math.max(0, this.grabCooldown - dt);
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);
    this.sprintLock = Math.max(0, this.sprintLock - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.kickSteerT = Math.max(0, this.kickSteerT - dt);
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const zones = this.game.zones;
    this.feet.set(this.center.x, this.feetY(), this.center.z);
    this.inMud = zones.inMud(this.feet);
    this.inFire = zones.inFire(this.feet, this.height, this.radius);
    // Shrink Wrap wears off.
    if (this.sizeT > 0 && (this.sizeT -= dt) <= 0) this.setSize(1);

    // Flying a Smoke Signal: the body stands there, defenseless.
    const realInput = this.input;
    const movePressed = this.guiding ? NO_PRESSES : pressed;
    if (this.guiding) this.input = NEUTRAL_INPUT;
    switch (this.mode) {
      case 'move':
        this.tickMove(dt, movePressed);
        break;
      case 'mantle':
        this.tickMantle(dt);
        break;
      case 'net':
        this.tickNet(dt, movePressed);
        break;
      case 'rope':
        this.tickRope(dt, movePressed);
        break;
      case 'bars':
        this.tickBars(dt, movePressed);
        break;
    }
    this.input = realInput;

    if (this.inFire) {
      dealDamage(this.game, this, FIRE_DPS * dt, { cause: 'fire' });
      if (!this.isBot) this.game.sfx.play('burn');
    }
    if (!this.alive) return;
    if (this.vitals.update(dt) && !this.isBot) this.game.sfx.play('shieldCharge');

    const w = this.weapon;
    const wantZoom = this.input.held.aim && !this.sprinting && !w.reloading && this.mode !== 'mantle';
    this.aimZoom += ((wantZoom ? w.def.zoom : 1) - this.aimZoom) * damp(14, dt);
    updateShooting(this.game, this, dt, pressed);
    if (!this.alive) return;
    this.game.pickups.touch(this, pressed);

    this.body.setNextKinematicTranslation(this.center);
  }

  onDamaged(res, info) {
    this.feedback.hurtT = this.game.time;
    // Where it came from, for the damage arrow (and so bots turn to face it). Bug stings come
    // from your own head, so they don't point anywhere (or give away the thrower).
    const src = info.cause === 'explosion' ? info.point : info.attacker?.center;
    if (src && info.attacker !== this && info.cause !== 'swarm') {
      this.feedback.hurtFromX = src.x;
      this.feedback.hurtFromZ = src.z;
      this.feedback.hurtDirT = this.game.time;
    }
    if (info.cause !== 'swarm') this.brain?.onHurt(info.attacker);
    // Hurt sounds and hit confirms are just for local players.
    if (this.isBot) return;
    if (res.broke) this.game.sfx.play('shieldBreak');
    else if (res.healthDamage > 0 && info.cause !== 'fire') this.game.sfx.play('hurt');
  }

  // Our shot landed on something. `sound` false skips the tick (fast beams throttle it).
  onHitConfirmed(res, headshot, sound = true) {
    const fb = this.feedback;
    fb.hitT = this.game.time;
    fb.hitKind = res.killed ? 'kill' : headshot ? 'head' : 'hit';
    if (sound && !this.isBot) this.game.sfx.play(res.killed ? 'kill' : headshot ? 'head' : 'hit');
  }

  die(info) {
    // (The corpse carries on with how we were moving.)
    this.deathVel = (this.deathVel ?? new THREE.Vector3()).copy(this.vel);
    this.game.pickups?.dropFrom(this);
    this.guiding = null;
    this.lungeT = this.knockT = 0;
    this.mode = 'dead';
    this.deathT = 0;
    this.deathInfo = info;
    this.aimTarget = null;
    this.aimNear = null;
    cancelReload(this.game, this.weapon);
    // A direction already held when you're smoked (mid-strafe) isn't a loadout pick.
    const x = this.input.moveX;
    this.pickDir = x > 0.5 ? 1 : x < -0.5 ? -1 : 0;
    this.stats.deaths++;
    if (this.sliding) this.endSlide();
    this.vel.set(0, 0, 0);
    this.sprinting = false;
    this.aimZoom = 1;
    this.net = this.rope = this.bars = null;
    this.collider.setEnabled(false);
    this.game.sfx.play('death', { at: this.center, source: this });
    // The body drops where it was smoked (out of the world, it just goes).
    if (info?.cause === 'fell') {
      this.model.group.visible = false;
      this.corpse = null;
    } else {
      this.startCorpse(info);
    }
  }

  // Ragdoll-ish: the body is knocked the way the hit came from (blasts throw it), tips over and
  // goes limp, slides to a stop, and puffs away just before the respawn. Looks only: nothing
  // collides with it.
  startCorpse(info) {
    const c = (this.corpse ??= { pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(), dir: new THREE.Vector3() });
    c.pos.set(this.center.x, this.feetY(), this.center.z);
    const d = c.dir;
    if (info?.dir) d.copy(info.dir);
    else if (info?.point) d.subVectors(this.center, info.point);
    else if (info?.attacker?.center) d.subVectors(this.center, info.attacker.center);
    else d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    d.y = 0;
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
    d.normalize();
    const blast = info?.cause === 'explosion' || info?.cause === 'prop' || info?.cause === 'punt';
    const push = blast ? CORPSE.blastPush : info?.cause === 'melee' ? CORPSE.meleePush : CORPSE.shotPush;
    c.vel.copy(d).multiplyScalar(push).addScaledVector(this.deathVel, 0.5);
    c.vel.y = blast ? CORPSE.blastUp : 0;
    c.air = blast;
    // The fall, about a horizontal axis in the body's own space, toward the push.
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const lx = d.x * cy - d.z * sy;
    const lz = d.x * sy + d.z * cy;
    c.axis.set(lz, 0, -lx).normalize();
    // (Falling forward, toward -z, the spine and head fold forward.)
    c.front = lz < 0 ? 1 : -1;
    c.side = Math.random() < 0.5 ? -1 : 1;
    c.seed = Math.random() * 10;
    c.yaw = this.yaw;
    c.tip = 0;
    c.tipV = CORPSE.tipStart + push * 0.15 + (info?.headshot ? 1.2 : 0);
    c.t = 0;
    c.limp = 0;
  }

  updateCorpse(dt) {
    const c = this.corpse;
    c.t += dt;
    c.limp = Math.min(1, c.limp + dt * 4);
    c.vel.y -= MOVE.gravity * dt;
    // Walls stop it sliding on.
    const step = Math.hypot(c.vel.x, c.vel.z) * dt;
    if (step > 1e-4) {
      _c.set(c.vel.x, 0, c.vel.z).normalize();
      _c2.copy(c.pos).y += 0.6;
      if (this.game.surfaceNear(_c2, _c, step + 0.35)) c.vel.x = c.vel.z = 0;
    }
    c.pos.addScaledVector(c.vel, dt);
    const floor = this.game.bake ? this.game.bake.floorBelow(c.pos.x, c.pos.y + 0.5, c.pos.z) : -Infinity;
    if (Number.isFinite(floor) && c.pos.y <= floor) {
      c.pos.y = floor;
      c.vel.y = c.vel.y < -3 ? -c.vel.y * 0.25 : 0;
      const f = Math.max(0, 1 - CORPSE.friction * dt);
      c.vel.x *= f;
      c.vel.z *= f;
      c.air = false;
    } else if (c.pos.y > floor + 0.05) {
      c.air = true;
    }
    // Tips over like a falling stick (faster the further it's gone), then rests on the ground.
    c.tipV += 9 * Math.sin(c.tip + 0.25) * dt;
    c.tip += c.tipV * dt;
    if (c.tip >= CORPSE.lying) {
      c.tip = CORPSE.lying;
      c.tipV = -Math.abs(c.tipV) * 0.2;
    }
    this.model.ragdoll(dt, c);
    // Just before the respawn, it puffs away.
    if (this.deathT >= CORPSE.time && this.model.group.visible) {
      this.model.group.visible = false;
      _c.set(0, 0.7, 0).applyQuaternion(this.model.group.quaternion).add(c.pos);
      this.game.fx.deathPuff(_c.x, _c.y - 0.9, _c.z, this.color);
    }
  }

  // Move the capsule through the world with collision. Call at most once per tick.
  moveBy(dx, dy, dz) {
    const d = this.desired;
    d.x = dx;
    d.y = dy;
    d.z = dz;
    this.cc.computeColliderMovement(this.collider, d, this.filter);
    const m = this.cc.computedMovement();
    this.center.x += m.x;
    this.center.y += m.y;
    this.center.z += m.z;
    this.grounded = this.cc.computedGrounded();
    return m;
  }

  wish() {
    const inp = this.input;
    let x = this.fwd.x * inp.moveY + this.right.x * inp.moveX;
    let z = this.fwd.z * inp.moveY + this.right.z * inp.moveX;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return [x, z, Math.min(1, len)];
  }

  tickMove(dt, pressed) {
    const inp = this.input;
    const v = this.vel;
    const [wx, wz, wishLen] = this.wish();
    // Movement speed setting scales running, acceleration and air control together.
    const k = settings.moveSpeed;

    const wasSprinting = this.sprinting;
    if (this.grounded) {
      this.sprinting =
        inp.held.sprint && inp.moveY > 0.3 && !this.crouched && !this.inMud && this.sprintLock <= 0 && !inp.held.fire && !this.weapon.spin;
    } else if (inp.moveY <= 0.3) {
      this.sprinting = false;
    }
    // Crouching mid-sprint on the ground starts a slide (a controller's crouch has already
    // let go of its sprint toggle, so this goes by the last tick's sprint).
    if (wasSprinting && this.grounded && inp.held.crouch && !this.crouched && this.slideCooldown <= 0 && this.lungeT <= 0) {
      this.startSlide(k);
    }
    // (burdenSpeed: Rocky Mountain Oysters' drag.)
    let speed = (this.crouched ? MOVE.crouchSpeed : this.sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed) * k * this.burdenSpeed * this.sizeSpeed;
    // Turning Rotisserie barrels slow you down.
    if (this.weapon.spin > 0) speed *= this.weapon.def.spinMoveMul ?? 1;
    if (this.inMud) speed *= MOVE.mudSpeedMul;

    this.knockT = Math.max(0, this.knockT - dt);
    if (this.lungeT > 0) {
      if (this.sliding) this.endSlide();
      this.lungeT -= dt;
      v.x = this.lungeDir.x * this.lungeSpeed;
      v.z = this.lungeDir.z * this.lungeSpeed;
    } else if (this.sliding) {
      this.slideVelocity(dt, wx, wz, wishLen, k);
    } else if (this.grounded && this.knockT <= 0) {
      // Pushing against the way you're moving turns you around faster.
      const reverse = wishLen > 0.01 && v.x * wx + v.z * wz < 0 ? MOVE.reverseAccelMul : 1;
      approach2(v, wx * speed, wz * speed, (wishLen > 0.01 ? MOVE.groundAccel * reverse : MOVE.groundDecel) * k * dt);
    } else if (wishLen > 0.01) {
      // Keep momentum from sprint jumps; steer toward the stick (less right after a wall kick).
      const cur = Math.hypot(v.x, v.z);
      const cap = Math.max(speed, Math.min(cur, MOVE.sprintSpeed * k * 1.2));
      const steer = this.kickSteerT > 0 ? MOVE.wallKickSteer : 1;
      approach2(v, wx * cap, wz * cap, MOVE.airAccel * k * steer * dt);
    } else {
      const k = Math.max(0, 1 - MOVE.airDrag * dt);
      v.x *= k;
      v.z *= k;
    }

    // Jumping. Out of a slide it keeps the slide's speed (a slide hop); in the air next to a
    // wall it kicks off the wall.
    if (pressed.jump) {
      if (this.grounded || this.coyote > 0) this.groundJump();
      else if (this.tryWallKick(wx, wz, wishLen, k)) this.jumpBuffer = 0;
      else if (this.airJumpsLeft > 0) this.doubleJump(wx, wz, wishLen, speed);
      else this.jumpBuffer = MOVE.jumpBuffer;
    } else if (this.jumpBuffer > 0) {
      this.jumpBuffer -= dt;
      if (this.grounded) this.groundJump();
    }

    // Gravity. A small downward push while grounded keeps ground detection stable.
    if (!this.grounded || v.y > 0) {
      const g = MOVE.gravity * (v.y < 0 ? MOVE.fallGravityMul : 1);
      v.y = Math.max(-MOVE.maxFallSpeed, v.y - g * dt);
    } else {
      v.y = -0.5;
    }

    // Mantle / vault: push forward into a ledge.
    if (inp.moveY > 0.3 && this.mantleCooldown <= 0) {
      const air = !this.grounded;
      if ((air || (this.blockedAhead && !this.inMud)) && this.tryMantle(air, this.fwd.x, this.fwd.z)) return;
    }

    // Grab climbables.
    if (this.grabCooldown <= 0 && !inp.held.crouch) {
      if (this.tryGrabBars() || this.tryGrabNet() || this.tryGrabRope()) return;
    }

    const wasGrounded = this.grounded;
    const fallSpeed = v.y;
    // Standing on a conveyor belt carries you along.
    const belt = wasGrounded ? this.game.zones.beltAt(this.feet) : null;
    this.moveBy((v.x + (belt ? belt.vx : 0)) * dt, v.y * dt, (v.z + (belt ? belt.vz : 0)) * dt);
    if (fallSpeed < -2) this.stomp();
    this.clipVelocity();

    if (this.grounded) {
      if (!wasGrounded) this.land(fallSpeed);
      this.coyote = MOVE.coyoteTime;
      this.airJumpsLeft = MOVE.airJumps;
      this.kicksLeft = MOVE.wallKicksPerAir;
      this.kickWall.on = false;
      if (v.y < 0) v.y = 0;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
    }

    // A slide ends when crouch is let go, when it's down to crouch speed (running into a wall
    // gets it there at once), or off a ledge, where it becomes a fall.
    if (this.sliding) {
      const slow = Math.hypot(v.x, v.z) < MOVE.crouchSpeed * k;
      if (!inp.held.crouch || slow || (!this.grounded && this.coyote <= 0)) this.endSlide();
    }

    this.updateCrouch(inp.held.crouch);
  }

  groundJump() {
    this.vel.y = MOVE.jumpSpeed * (this.inMud ? MOVE.mudJumpMul : 1) * this.burdenJump * this.sizeJump;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    if (this.sliding) this.endSlide();
  }

  // ---------------------------------------------------------------- slide

  // In the current move direction, at least at sprint speed plus the boost (no boost in mud).
  startSlide(k) {
    const v = this.vel;
    const cur = Math.hypot(v.x, v.z);
    const dx = cur > 0.5 ? v.x / cur : this.fwd.x;
    const dz = cur > 0.5 ? v.z / cur : this.fwd.z;
    const start = this.inMud ? cur : Math.max(cur, MOVE.sprintSpeed * k * (1 + MOVE.slideBoost));
    v.x = dx * start;
    v.z = dz * start;
    // The crouch itself happens at the end of the tick (updateCrouch), after this tick's move.
    this.sliding = true;
    this.sprinting = false;
    this.slideSfx = this.game.sfx.play('slide', { at: this.center, source: this });
  }

  endSlide() {
    this.sliding = false;
    this.slideCooldown = MOVE.slideCooldown;
    this.game.sfx.stop(this.slideSfx);
    this.slideSfx = null;
  }

  // One tick of sliding: friction, the pull of the slope underfoot, and a little steering.
  slideVelocity(dt, wx, wz, wishLen, k) {
    const v = this.vel;
    let speed = Math.hypot(v.x, v.z);
    if (speed < 1e-3) return;
    let dx = v.x / speed;
    let dz = v.z / speed;
    speed = Math.max(0, speed - (this.inMud ? MOVE.slideMudFriction : MOVE.slideFriction) * k * dt);
    if (this.grounded) {
      // Gravity along the ground, flattened: downhill speeds the slide up, uphill slows it.
      const hit = this.castDown(this.center.x, this.feetY() + 0.1, this.center.z, 0.5);
      if (hit && hit.normal.y > 0.5) {
        const n = hit.normal;
        const pull = MOVE.gravity * MOVE.slideSlope * k * n.y * dt;
        const x = dx * speed + n.x * pull;
        const z = dz * speed + n.z * pull;
        speed = Math.hypot(x, z);
        if (speed > 1e-3) {
          dx = x / speed;
          dz = z / speed;
        }
      }
    }
    speed = Math.min(speed, MOVE.sprintSpeed * MOVE.slideMaxSpeed * k);
    // Only the stick's sideways part (across the slide) turns it, and slowly.
    if (wishLen > 0.1) {
      const a = clamp(dx * wz - dz * wx, -1, 1) * MOVE.slideSteer * dt;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const x = dx * c - dz * sn;
      dz = dx * sn + dz * c;
      dx = x;
    }
    v.x = dx * speed;
    v.z = dz * speed;
  }

  // ---------------------------------------------------------------- wall kick

  // Kick off a steep wall within reach: up like a double jump (which it doesn't use), pushed
  // away from the wall, keeping most of the speed along it. Not off climbables (they have their
  // own jump), the same wall twice in a row, or a wall we're already leaving, and only
  // wallKicksPerAir times before touching the ground or a climbable, each lifting less than the
  // last. Pushing into any wall in reach with the double jump left is a double jump instead, so
  // walls (and corners) can still be climbed.
  tryWallKick(wx, wz, wishLen, k) {
    if (this.kickCooldown > 0 || this.kicksLeft <= 0) return false;
    const zones = this.game.zones;
    if (zones.findNet(this.center) || zones.findRope(this.center)) return false;
    this.kickWish.x = wx;
    this.kickWish.z = wz;
    this.kickWish.len = wishLen;
    const w = this.findWall();
    if (!w) return false;
    if (this.airJumpsLeft > 0 && w.into) return false;
    const h = Math.hypot(w.nx, w.nz);
    const nx = w.nx / h;
    const nz = w.nz / h;
    if (this.sameWall(w.handle, nx, nz, w.x, w.z)) return false;
    const v = this.vel;
    if (v.x * nx + v.z * nz > MOVE.wallKickAwayMax) return false;

    const along = (v.z * nx - v.x * nz) * MOVE.wallKickKeep;
    const push = MOVE.wallKickPush * k;
    v.x = -nz * along + nx * push;
    v.z = nx * along + nz * push;
    const chained = MOVE.wallKicksPerAir - this.kicksLeft;
    v.y = Math.max(v.y, MOVE.wallKickUp * Math.pow(MOVE.wallKickChainUp, chained));
    this.kicksLeft--;
    const kw = this.kickWall;
    kw.on = true;
    kw.handle = w.handle;
    kw.nx = nx;
    kw.nz = nz;
    kw.d = nx * w.x + nz * w.z;
    this.kickCooldown = MOVE.wallKickCooldown;
    this.kickSteerT = MOVE.wallKickSteerTime;
    this.pose.wallKicks++;
    this.pose.kickSide = nx * this.right.x + nz * this.right.z < 0 ? 1 : -1;
    this.game.sfx.play('wallKick', { at: _c.set(w.x, w.y, w.z), source: this });
    return true;
  }

  // Whether a wall touched at (px, pz) with this horizontal normal is the one we last kicked
  // off: the same collider facing about the same way (round poles turn their normal as we
  // move around them), or a point on the stored plane facing the same way. The distance is
  // measured with the stored normal, since contact normals tilt a little.
  sameWall(handle, nx, nz, px, pz) {
    const kw = this.kickWall;
    if (!kw.on) return false;
    const dot = nx * kw.nx + nz * kw.nz;
    if (handle === kw.handle && dot > 0.5) return true;
    return dot > 0.95 && Math.abs(kw.nx * px + kw.nz * pz - kw.d) < 0.3;
  }

  // The nearest steep wall within kick reach of our capsule, in this.wall, or null. Also notes
  // whether the stick pushes into any of the walls in reach (wall.into).
  findWall() {
    this.wall.dist = Infinity;
    this.wall.into = false;
    const shape = this.crouched ? this.reachCrouch : this.reachStand;
    const filter = this.wallFilter;
    this.world.intersectionsWithShape(this.center, NO_ROTATION, shape, this._onWall, filter, undefined, this.collider, undefined, this.kickable);
    return this.wall.dist < Infinity ? this.wall : null;
  }

  // One collider near us (findWall): a steep face beside the body (not under the feet) and not
  // part of the monkey bars' frame counts; keep the nearest.
  considerWall(collider) {
    const shape = this.crouched ? this.crouchShape : this.standShape;
    // The test shapes are 3 cm thinner than the body.
    const hit = collider.contactShape(shape, this.center, NO_ROTATION, MOVE.wallKickReach + 0.03, this.contact);
    if (
      !hit ||
      Math.abs(hit.normal1.y) > MOVE.wallKickMaxNormalY ||
      hit.point1.y <= this.feetY() + 0.1 ||
      this.game.zones.inBarsFrame(hit.point1)
    ) {
      return true;
    }
    const w = this.wall;
    const wish = this.kickWish;
    if (wish.len > 0.3) {
      const h = Math.hypot(hit.normal1.x, hit.normal1.z);
      if (-(wish.x * hit.normal1.x + wish.z * hit.normal1.z) / (h * wish.len) > MOVE.wallKickInto) w.into = true;
    }
    if (hit.distance < w.dist) {
      w.dist = hit.distance;
      w.handle = collider.handle;
      w.nx = hit.normal1.x;
      w.nz = hit.normal1.z;
      w.x = hit.point1.x;
      w.y = hit.point1.y;
      w.z = hit.point1.z;
    }
    return true;
  }

  doubleJump(wx, wz, wishLen, speed) {
    const v = this.vel;
    v.y = MOVE.doubleJumpSpeed * this.burdenJump * this.sizeJump;
    this.airJumpsLeft--;
    this.pose.airJumps++;
    this.jumpBuffer = 0;
    if (wishLen > 0.1) {
      const cur = Math.max(Math.hypot(v.x, v.z), speed);
      const k = MOVE.doubleJumpRedirect;
      v.x += (wx * cur - v.x) * k;
      v.z += (wz * cur - v.z) * k;
    }
  }

  // Shrink Wrap: coming down on a shrunk player smokes them.
  stomp() {
    const feet = this.feetY();
    for (const o of this.game.players) {
      if (o === this || !o.alive || o.size >= 1) continue;
      const dy = feet - o.topY();
      if (dy < -SIZE.stompReach || dy > SIZE.stompReach) continue;
      if (Math.hypot(o.center.x - this.center.x, o.center.z - this.center.z) > o.radius + this.radius * 0.9) continue;
      this.game.sfx.play('squish', { at: o.center, source: this });
      dealDamage(this.game, o, 9999, { attacker: this, cause: 'stomp', point: o.center, dir: _down });
    }
  }

  land(fallSpeed) {
    this.landDip = Math.min(0.22, Math.max(0, -fallSpeed - 3) * 0.018);
    this.pose.lands++;
    this.pose.landSpeed = -fallSpeed;
  }

  // Remove velocity into walls and ceilings we hit, and note whether a wall is right ahead.
  clipVelocity() {
    const v = this.vel;
    this.blockedAhead = false;
    const n = this.cc.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.cc.computedCollision(i, this.collision);
      if (!c) continue;
      const nx = c.normal1.x;
      const ny = c.normal1.y;
      const nz = c.normal1.z;
      if (ny > 0.7) continue; // ground
      if (ny < -0.7) {
        if (v.y > 0) v.y = 0;
        continue;
      }
      const dot = v.x * nx + v.y * ny + v.z * nz;
      if (dot < 0) {
        v.x -= nx * dot;
        v.y -= ny * dot;
        v.z -= nz * dot;
      }
      if (nx * this.fwd.x + nz * this.fwd.z < -0.5) this.blockedAhead = true;
      // Touching a wall other than the one we last kicked off makes that one kickable again
      // (not an invisible blocker, which can't be kicked off).
      if (this.kickWall.on && Math.abs(ny) <= MOVE.wallKickMaxNormalY && c.collider && this.kickable(c.collider)) {
        const h = Math.hypot(nx, nz);
        if (!this.sameWall(c.collider.handle, nx / h, nz / h, c.witness1.x, c.witness1.z)) this.kickWall.on = false;
      }
    }
  }

  overlaps(shape, x, y, z) {
    _c.set(x, y, z);
    return this.world.intersectionWithShape(_c, NO_ROTATION, shape, this.filter, undefined, this.collider) !== null;
  }

  // Shift the capsule vertically without moving the camera (crouch shape changes).
  shiftCenter(dy) {
    this.center.y += dy;
    this.prevCenter.y += dy;
    this.eyeOff -= dy;
  }

  updateCrouch(want) {
    if (want && !this.crouched) {
      // On the ground the feet stay put; in the air the legs tuck up (crouch-jump).
      const shift = CROUCH_SHIFT * this.size;
      this.shiftCenter(this.grounded ? -shift : shift);
      this.collider.setHalfHeight(CROUCH_HH * this.size);
      this.crouched = true;
    } else if (!want && this.crouched) {
      const c = this.center;
      const shift = CROUCH_SHIFT * this.size;
      const options = this.grounded ? [shift] : [-shift, shift];
      for (const dy of options) {
        if (!this.overlaps(this.standShape, c.x, c.y + dy, c.z)) {
          this.shiftCenter(dy);
          this.collider.setHalfHeight(STAND_HH * this.size);
          this.crouched = false;
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- mantle

  castDown(x, y, z, maxDist) {
    const r = this.ray;
    r.origin.x = x;
    r.origin.y = y;
    r.origin.z = z;
    r.dir.x = 0;
    r.dir.y = -1;
    r.dir.z = 0;
    return this.world.castRayAndGetNormal(r, maxDist, true, this.filter, undefined, this.collider, undefined, this.notBody);
  }

  castFrom(x, y, z, dx, dy, dz, maxDist) {
    const r = this.ray;
    r.origin.x = x;
    r.origin.y = y;
    r.origin.z = z;
    r.dir.x = dx;
    r.dir.y = dy;
    r.dir.z = dz;
    return this.world.castRay(r, maxDist, true, this.filter, undefined, this.collider, undefined, this.notBody);
  }

  // Look for a ledge ahead in direction (dx, dz) and pull up onto it.
  tryMantle(air, dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return false;
    dx /= len;
    dz /= len;
    const c = this.center;
    const hh = this.halfHeight;
    const feetY = this.feetY();
    const topY = this.topY();
    const minY = feetY + (air ? MOVE.airMantleMinRise : MOVE.vaultMinRise);
    // In the air, reach is measured from the top of the body so tucking doesn't add reach.
    const maxY = air ? topY + HAND_ABOVE_TOP + (MOVE.airMantleMaxRise - BODY.handReach) : feetY + MOVE.vaultMaxRise;
    const probeTop = maxY + 0.1;

    // Head room above us up to the probe height.
    if (probeTop > c.y && this.castFrom(c.x, c.y, c.z, 0, 1, 0, probeTop - c.y)) return false;

    for (const dist of [0.5, 0.7, 0.95, 1.2]) {
      const px = c.x + dx * dist;
      const pz = c.z + dz * dist;
      const hit = this.castDown(px, probeTop, pz, probeTop - minY);
      if (!hit) continue;
      if (hit.timeOfImpact < 0.02) return false; // probe starts inside something: too tall
      if (hit.normal.y < 0.7) continue;
      const ledgeY = probeTop - hit.timeOfImpact;
      // Nothing between us and the ledge at ledge height.
      if (this.castFrom(c.x, ledgeY + 0.3, c.z, dx, 0, dz, dist)) return false;
      const ty = ledgeY + hh + this.radius + 0.05;
      if (this.overlaps(this.crouched ? this.crouchShape : this.standShape, px, ty, pz)) continue;
      this.startMantle(px, ty, pz, ledgeY - feetY, dx, dz);
      return true;
    }
    return false;
  }

  startMantle(x, y, z, rise, dx, dz) {
    if (this.sliding) this.endSlide();
    const m = this.mantle;
    m.from.copy(this.center);
    m.to.set(x, y, z);
    m.t = 0;
    m.dur = 0.14 + 0.1 * Math.max(0, rise);
    const exit = Math.max(MOVE.mantleExitSpeed * settings.moveSpeed, Math.hypot(this.vel.x, this.vel.z) * 0.6);
    m.exitX = dx * exit;
    m.exitZ = dz * exit;
    this.mode = 'mantle';
    this.vel.set(0, 0, 0);
    this.net = this.rope = this.bars = null;
  }

  tickMantle(dt) {
    const m = this.mantle;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    // Rise first, then move over the edge.
    const ky = 1 - Math.pow(1 - Math.min(1, k / 0.6), 2);
    const kxz = smoothstep((k - 0.3) / 0.7);
    this.center.set(
      m.from.x + (m.to.x - m.from.x) * kxz,
      m.from.y + (m.to.y - m.from.y) * ky,
      m.from.z + (m.to.z - m.from.z) * kxz,
    );
    if (k >= 1) {
      this.mode = 'move';
      this.vel.set(m.exitX, 0, m.exitZ);
      this.airJumpsLeft = MOVE.airJumps;
      this.kicksLeft = MOVE.wallKicksPerAir;
      this.kickWall.on = false;
      this.mantleCooldown = 0.2;
      this.grounded = false;
    }
  }

  // ---------------------------------------------------------------- climbing

  enterClimb(mode) {
    this.mode = mode;
    this.vel.set(0, 0, 0);
    this.sprinting = false;
    this.airJumpsLeft = MOVE.airJumps;
    this.kicksLeft = MOVE.wallKicksPerAir;
    this.kickWall.on = false;
  }

  leaveClimb(vx, vy, vz, cooldown) {
    this.mode = 'move';
    this.vel.set(vx, vy, vz);
    this.grabCooldown = cooldown;
    this.net = this.rope = this.bars = null;
    this.grounded = false;
  }

  tryGrabNet() {
    if (this.input.moveY < 0.2) return false;
    const zones = this.game.zones;
    const net = zones.findNet(this.center);
    if (!net) return false;
    if (this.fwd.x * net.facing.x + this.fwd.z * net.facing.z < 0.3) return false;
    const loc = zones.netLocal(net, this.center, this.netLoc);
    if (this.grounded && loc.s > net.length - 0.3) return false; // standing on top already
    this.net = net;
    this.enterClimb('net');
    return true;
  }

  tickNet(dt, pressed) {
    const inp = this.input;
    const net = this.net;
    const zones = this.game.zones;
    const n = net.normal;

    if (pressed.jump) {
      // Leap away from the net, a bit toward where you're looking.
      const s = MOVE.leapOffSpeed * settings.moveSpeed;
      this.leaveClimb(n.x * s + this.fwd.x * 2, MOVE.leapOffUp, n.z * s + this.fwd.z * 2, MOVE.regrabDelay);
      return;
    }
    if (inp.held.crouch) {
      this.leaveClimb(n.x * 1.5, 0, n.z * 1.5, 0.4);
      return;
    }

    let loc = zones.netLocal(net, this.center, this.netLoc);
    const up = inp.moveY;
    if (up > 0.3 && loc.s > net.length - 0.45 && this.tryMantle(true, net.facing.x, net.facing.z)) return;

    // Strafe along the net relative to the camera.
    const sideSign = this.right.x * net.lateral.x + this.right.z * net.lateral.z >= 0 ? 1 : -1;
    const climb = MOVE.netClimbSpeed * settings.moveSpeed;
    let side = inp.moveX * sideSign * climb * 0.75 * dt;
    const halfW = net.width / 2 - 0.3;
    side = clamp(loc.t + side, -halfW, halfW) - loc.t;
    let along = up * climb * dt;
    along = Math.min(along, net.length + 0.1 - loc.s);
    const pull = (0.45 - loc.d) * Math.min(1, 10 * dt);
    const U = net.up;
    const L = net.lateral;
    this.moveBy(
      U.x * along + L.x * side + n.x * pull,
      U.y * along + L.y * side + n.y * pull,
      U.z * along + L.z * side + n.z * pull,
    );

    loc = zones.netLocal(net, this.center, this.netLoc);
    if ((this.grounded && up < -0.1) || loc.s < -0.8 || loc.d > 1.3 || Math.abs(loc.t) > net.width / 2 + 0.3) {
      this.leaveClimb(0, 0, 0, 0.2);
    }
  }

  tryGrabRope() {
    const rope = this.game.zones.findRope(this.center);
    if (!rope) return false;
    const dx = rope.x - this.center.x;
    const dz = rope.z - this.center.z;
    const d = Math.hypot(dx, dz);
    const toward = d > 0.01 ? (this.fwd.x * dx + this.fwd.z * dz) / d : 1;
    if (this.grounded) {
      if (this.input.moveY < 0.2 || toward < 0.3) return false;
    } else if (toward < -0.3) {
      return false;
    }
    if (this.feetY() > rope.y1 - 0.35 - BODY.handReach * this.size + 0.3) return false;
    this.rope = rope;
    this.enterClimb('rope');
    return true;
  }

  tickRope(dt, pressed) {
    const inp = this.input;
    const rope = this.rope;
    if (pressed.jump) {
      this.leaveClimb(this.fwd.x * 7, MOVE.leapOffUp, this.fwd.z * 7, MOVE.regrabDelay);
      return;
    }
    if (inp.held.crouch) {
      this.leaveClimb(0, 0, 0, 0.4);
      return;
    }
    const feetY = this.feetY();
    const maxFeet = rope.y1 - 0.35 - BODY.handReach * this.size;
    if (inp.moveY > 0.3 && feetY > maxFeet - 0.35 && this.tryMantle(true, this.fwd.x, this.fwd.z)) return;

    let dy = inp.moveY * MOVE.ropeClimbSpeed * settings.moveSpeed * dt;
    if (feetY + dy > maxFeet) dy = Math.min(0, maxFeet - feetY);
    // Hold the rope in front and slightly to the right so it doesn't block the crosshair.
    const tx = rope.x - this.fwd.x * 0.4 - this.right.x * 0.22;
    const tz = rope.z - this.fwd.z * 0.4 - this.right.z * 0.22;
    const k = Math.min(1, 12 * dt);
    this.moveBy((tx - this.center.x) * k, dy, (tz - this.center.z) * k);
    if (this.grounded && inp.moveY < -0.1) this.leaveClimb(0, 0, 0, 0.3);
  }

  tryGrabBars() {
    if (this.grounded) return false;
    _c.set(this.center.x, this.topY() + HAND_ABOVE_TOP * this.size, this.center.z);
    const bars = this.game.zones.findBars(_c);
    if (!bars) return false;
    this.bars = bars;
    this.enterClimb('bars');
    return true;
  }

  tickBars(dt, pressed) {
    const inp = this.input;
    const bars = this.bars;
    const [wx, wz] = this.wish();
    if (pressed.jump) {
      this.leaveClimb(wx * 4, 4.5, wz * 4, 0.3);
      return;
    }
    if (inp.held.crouch) {
      this.leaveClimb(0, 0, 0, 0.5);
      return;
    }
    const handY = this.topY() + HAND_ABOVE_TOP * this.size;
    const dy = (bars.y - handY) * Math.min(1, 15 * dt);
    const s = MOVE.hangSpeed * settings.moveSpeed;
    this.moveBy(wx * s * dt, dy, wz * s * dt);
    const c = this.center;
    if (c.x < bars.minX || c.x > bars.maxX || c.z < bars.minZ - 0.05 || c.z > bars.maxZ + 0.05) {
      this.leaveClimb(wx * s, 0, wz * s, 0.4);
    }
  }

  // ---------------------------------------------------------------- camera

  updateCamera(alpha, dt, aspect) {
    _c.lerpVectors(this.prevCenter, this.center, alpha);
    const dead = this.mode === 'dead';
    // Death cam: sink to the ground and tip over.
    const target = dead ? 0.35 - this.halfHeight - this.radius : this.eyeOffset();
    this.eyeOff += (target - this.eyeOff) * damp(dead ? 4 : 14, dt);
    this.deathRoll += ((dead ? 0.5 : 0) - this.deathRoll) * damp(dead ? 3 : 20, dt);
    this.landDip += (0 - this.landDip) * damp(9, dt);
    const cam = this.camera;
    this.shake += (0 - this.shake) * damp(5, dt);
    const sh = this.shake * this.shake * 0.04;
    const sx = sh ? (Math.random() - 0.5) * sh : 0;
    const sy = sh ? (Math.random() - 0.5) * sh : 0;

    // Missile camera: ride the Smoke Signal, and see your own (defenseless) body.
    if (this.guiding) {
      this.game.missiles.pose(this.guiding, alpha, cam.position, _euler, 0.45);
      cam.rotation.set(_euler.x + sx, _euler.y + sy, 0);
      cam.layers.enable(1 + this.id);
      this.setFov(settings.fov + 10, aspect);
      return;
    }
    cam.layers.disable(1 + this.id);
    cam.position.set(_c.x, _c.y + this.eyeOff - this.landDip, _c.z);
    // A slide rolls the view a little.
    this.slideTilt += ((this.sliding ? CAMERA.slideRoll : 0) - this.slideTilt) * damp(10, dt);
    cam.rotation.set(this.pitch + sx, this.yaw + sy, this.deathRoll + this.slideTilt);

    const fast = this.sprinting && Math.hypot(this.vel.x, this.vel.z) > MOVE.walkSpeed * settings.moveSpeed + 0.5;
    const boost = this.sliding ? CAMERA.slideFovBoost : fast ? CAMERA.sprintFovBoost : 0;
    this.fovBoost += (boost - this.fovBoost) * damp(8, dt);
    this.setFov(settings.fov + this.fovBoost, aspect, this.aimZoom);
  }

  // Body pose for other players' views, and the first-person rifle.
  updateVisuals(dt, alpha) {
    if (this.mode === 'dead') {
      if (this.corpse && this.model.group.visible) this.updateCorpse(dt);
    } else if (this.model.group.visible) {
      const w = this.weapon;
      this.model.setWeapon(w.def.id);
      // Shrink Wrap: the body morphs to our size (scaled about the feet).
      if (this.sizeShown !== this.size) {
        this.sizeShown += (this.size - this.sizeShown) * damp(4 / SIZE.morph, dt);
        if (Math.abs(this.size - this.sizeShown) < 0.005) this.sizeShown = this.size;
        this.model.group.scale.setScalar(this.sizeShown);
      }
      _c.lerpVectors(this.prevCenter, this.center, alpha);
      const s = this.pose;
      s.x = _c.x;
      s.y = _c.y - this.halfHeight - this.radius;
      s.z = _c.z;
      s.yaw = this.yaw;
      s.pitch = this.pitch;
      s.speed = this.speed();
      // Velocity along our facing and to our right.
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      s.fwd = -this.vel.x * sy - this.vel.z * cy;
      s.side = this.vel.x * cy - this.vel.z * sy;
      s.velY = this.vel.y;
      s.grounded = this.grounded;
      s.crouched = this.crouched;
      s.sliding = this.sliding;
      s.climbing = this.mode === 'net' || this.mode === 'rope' || this.mode === 'bars';
      s.sprinting = this.sprinting;
      s.aiming = this.aimZoom > 1.05;
      s.fireT = this.game.time - w.lastShotT;
      // Slow guns stay at the shoulder until the next shot.
      s.fireHold = Math.max(0.6, 1.25 / w.def.fireRate);
      s.kick = GUNS[w.def.id].view.kick;
      this.model.update(dt, s);
    }
    this.viewmodel?.update(dt, this, this.lastLookX, this.lastLookY);
    this.lastLookX = 0;
    this.lastLookY = 0;
  }

  // Horizontal FOV from settings, converted to vertical for this viewport's aspect and clamped,
  // then magnified by the aim zoom (after the clamp, so wide split views still zoom).
  setFov(hfovDeg, aspect, zoom = 1) {
    if (hfovDeg === this._fovH && aspect === this._fovA && zoom === this._fovZ) return;
    this._fovH = hfovDeg;
    this._fovA = aspect;
    this._fovZ = zoom;
    const h = hfovDeg * DEG;
    let v = 2 * Math.atan(Math.tan(h / 2) / aspect);
    v = clamp(v / DEG, CAMERA.minVerticalFov, CAMERA.maxVerticalFov) * DEG;
    this.camera.fov = (2 * Math.atan(Math.tan(v / 2) / zoom)) / DEG;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  dispose() {
    this.model.dispose();
    this.viewmodel?.dispose();
    this.world.removeCharacterController(this.cc);
    this.world.removeRigidBody(this.body);
  }
}
