import * as THREE from 'three';
import { SIZZLER, MOVE } from '../config.js';
import { Vitals } from '../combat/vitals.js';
import { dealDamage } from '../combat/damage.js';
import { explode } from '../combat/explosions.js';
import { partsGeometry, METAL, METAL_LIGHT, RUBBER, GLOW } from '../combat/weaponModels.js';
import { clamp, damp, DEG } from '../util/math.js';
import { gfx } from '../render/gfx.js';

// The Sizzler: a one-seat motorcycle with twin guns under the bars. Arcade handling: it turns
// toward where the rider looks (A/D or the left stick also steer it directly), throttle on
// forward and back, boost on sprint, a hop on jump. Its own hull takes damage (no shields, no
// regen) and blows up when it's gone, taking the rider with it; running into people at speed
// smokes them (splatter). Bikes come back to their spot after they're destroyed or left empty
// away from it for a while.
//
// Physics: a kinematic body moved by its own character controller (a ball, so turning never
// wedges it into a wall) plus a box the size of the bike for shots and blasts (the one collider
// registered as an entity). The rider's capsule rides along on the seat and stays hittable.
// Drawn as two instanced meshes (frames and wheels) shared by every bike.

export const SIZZLER_WEAPON = { id: 'sizzler', name: 'Sizzler' };

const PAINT = 0xc23a1a;
const CREAM = 0xe8dcc0;
const WHEEL_R = 0.36;
const WHEEL_Z = 0.75;
const SEAT_Z = 0.3;
// The rider's feet sit this far above the bike's ground point (the body is posed seated).
const SEAT_FEET = 0.12;
// Muzzles (bike space: x right, y up, -z ahead) and how far ahead of the middle the nose is.
const MUZZLES = [new THREE.Vector3(-0.3, 0.72, -1.24), new THREE.Vector3(0.3, 0.72, -1.24)];
const NOSE = 1.1;
const BALL_R = 0.48;
const BOX = [0.48, 0.5, 1.08];
const BOX_Y = 0.62;
const GRAVITY = MOVE.gravity * 1.3;
// Exhaust stack tops (smoke while the engine runs, embers on a boost).
const STACKS = [new THREE.Vector3(-0.2, 1.22, 0.6), new THREE.Vector3(0.2, 1.22, 0.6)];

// The frame, tank (a little red smoker drum), seat, guns and trim. Bike space, ground at y 0.
const FRAME_PARTS = [
  [[0, 0.6, 0.02], [0.16, 0.14, 1.22], METAL],
  [[0, 0.45, 0.06], [0.34, 0.3, 0.5], METAL_LIGHT],
  [[0, 0.47, 0.06], [0.36, 0.06, 0.4], METAL],
  [[0, 0.82, -0.18], [0.44, 0.38, 0.62], PAINT, { shape: 'cyl', axis: 'z', seg: 18 }],
  [[0, 0.82, -0.18], [0.46, 0.4, 0.05], METAL, { shape: 'cyl', axis: 'z', seg: 18 }],
  [[0, 0.82, -0.44], [0.46, 0.4, 0.04], METAL, { shape: 'cyl', axis: 'z', seg: 18 }],
  [[0, 1.02, -0.18], [0.12, 0.05, 0.08], CREAM],
  [[0, 0.88, 0.36], [0.3, 0.1, 0.55], RUBBER],
  [[0, 0.8, 0.72], [0.26, 0.06, 0.46], PAINT],
  [[0, 0.8, 0.95], [0.18, 0.05, 0.02], 0xff3020, { finish: 'glow' }],
  // Swingarm and footpegs.
  [[-0.13, 0.42, 0.44], [0.04, 0.06, 0.62], METAL],
  [[0.13, 0.42, 0.44], [0.04, 0.06, 0.62], METAL],
  [[-0.25, 0.36, 0.12], [0.14, 0.04, 0.05], METAL_LIGHT],
  [[0.25, 0.36, 0.12], [0.14, 0.04, 0.05], METAL_LIGHT],
  // Side panels with an ember strip each.
  [[-0.19, 0.62, 0.3], [0.04, 0.22, 0.36], PAINT],
  [[0.19, 0.62, 0.3], [0.04, 0.22, 0.36], PAINT],
  [[-0.176, 0.48, 0.06], [0.004, 0.03, 0.44], GLOW],
  [[0.176, 0.48, 0.06], [0.004, 0.03, 0.44], GLOW],
  // Fork, bars and grips, headlight.
  [[-0.13, 0.66, -0.66], [0.06, 0.66, 0.06], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [-0.32, 0, 0] }],
  [[0.13, 0.66, -0.66], [0.06, 0.66, 0.06], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [-0.32, 0, 0] }],
  [[0, 1.0, -0.56], [0.3, 0.08, 0.1], METAL],
  [[0, 1.08, -0.52], [0.72, 0.05, 0.05], METAL, { shape: 'cyl', axis: 'x' }],
  [[-0.34, 1.08, -0.52], [0.12, 0.07, 0.07], RUBBER, { shape: 'cyl', axis: 'x' }],
  [[0.34, 1.08, -0.52], [0.12, 0.07, 0.07], RUBBER, { shape: 'cyl', axis: 'x' }],
  [[0, 0.93, -0.78], [0.22, 0.22, 0.12], METAL, { shape: 'cyl', axis: 'z' }],
  [[0, 0.93, -0.845], [0.17, 0.17, 0.02], 0xffe8b0, { shape: 'cyl', axis: 'z', finish: 'glow' }],
  [[0, 0.8, -0.76], [0.24, 0.05, 0.46], PAINT],
  // The twin guns, either side of the front wheel, with their ember strips.
  [[-0.3, 0.72, -0.78], [0.13, 0.13, 0.52], METAL],
  [[0.3, 0.72, -0.78], [0.13, 0.13, 0.52], METAL],
  [[-0.3, 0.72, -1.1], [0.07, 0.07, 0.28], METAL_LIGHT, { shape: 'cyl', axis: 'z', bore: 0.6 }],
  [[0.3, 0.72, -1.1], [0.07, 0.07, 0.28], METAL_LIGHT, { shape: 'cyl', axis: 'z', bore: 0.6 }],
  [[-0.3, 0.79, -0.78], [0.03, 0.008, 0.4], GLOW],
  [[0.3, 0.79, -0.78], [0.03, 0.008, 0.4], GLOW],
  [[-0.22, 0.72, -0.62], [0.12, 0.05, 0.06], METAL],
  [[0.22, 0.72, -0.62], [0.12, 0.05, 0.06], METAL],
  // Exhaust stacks (it's a smoker), leaning back, ember rims.
  [[-0.2, 0.95, 0.52], [0.09, 0.56, 0.09], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
  [[0.2, 0.95, 0.52], [0.09, 0.56, 0.09], METAL_LIGHT, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
  [[-0.2, 1.21, 0.6], [0.1, 0.03, 0.1], GLOW, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
  [[0.2, 1.21, 0.6], [0.1, 0.03, 0.1], GLOW, { shape: 'cyl', axis: 'y', rot: [0.3, 0, 0] }],
];
// One wheel about its axle (x): a fat tire, a hub and a spoke bar so you can see it turn.
const WHEEL_PARTS = [
  [[0, 0, 0], [0.2, WHEEL_R * 2, WHEEL_R * 2], RUBBER, { shape: 'cyl', axis: 'x', seg: 20 }],
  [[0, 0, 0], [0.22, 0.34, 0.34], METAL_LIGHT, { shape: 'cyl', axis: 'x', seg: 14 }],
  [[0, 0, 0], [0.23, 0.05, 0.4], PAINT],
  [[0, 0, 0], [0.23, 0.4, 0.05], METAL],
];

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _a = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _down = new THREE.Vector3(0, -1, 0);
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Phong with vertex colors, and glow parts (aFinish 4) lit on their own.
function bikeMaterial() {
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x3a3a3a });
  m.name = 'sizzler';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFinish;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aFinish > 3.5 ? 1.0 : 0.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 1.6;');
  };
  m.customProgramCacheKey = () => 'sizzler';
  return m;
}

class Bike {
  constructor(vehicles, spot, index) {
    const game = vehicles.game;
    const { RAPIER, world } = game.physics;
    this.vehicles = vehicles;
    this.game = game;
    this.kind = 'vehicle';
    this.name = 'Sizzler';
    this.index = index;
    this.spot = spot;
    this.vitals = new Vitals({ maxShield: 0, maxHealth: SIZZLER.health, shieldDelay: Infinity, shieldRechargeRate: 0, healthRegenRate: 0 });
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.ball = world.createCollider(RAPIER.ColliderDesc.ball(BALL_R).setTranslation(0, BALL_R + 0.02, 0), this.body);
    this.box = world.createCollider(RAPIER.ColliderDesc.cuboid(...BOX).setTranslation(0, BOX_Y, 0), this.body);
    game.registerEntity(this.box, this);
    this.cc = world.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setMaxSlopeClimbAngle(40 * DEG);
    this.cc.setMinSlopeSlideAngle(40 * DEG);
    this.cc.enableAutostep(0.3, 0.3, false);
    this.cc.enableSnapToGround(0.4);
    this.filter = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    // (Not its own box, and not its rider.)
    this.ignore = (c) => c.handle !== this.box.handle && c.handle !== this.rider?.collider.handle;
    this.desired = { x: 0, y: 0, z: 0 };
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.rider = null;
    // Who rode it last (a bike rolling on empty still splatters for them).
    this.lastRider = null;
    this.engine = null;
    this.reset();
  }

  get alive() {
    return this.vitals.alive;
  }

  // Back in its spot, whole and cool.
  reset() {
    const s = this.spot;
    this.pos.copy(s.pos);
    this.prevPos.copy(s.pos);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = s.yaw;
    this.pitch = this.prevPitch = 0;
    this.roll = this.prevRoll = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.grounded = true;
    this.airT = 0;
    this.vitals.reset();
    this.heat = 0;
    this.overheatT = 0;
    this.ventT = 0;
    this.boost = 1;
    this.boostWait = 0;
    this.boosting = false;
    this.shotT = 0;
    this.barrel = 0;
    this.spin = 0;
    this.throttle = 0;
    this.emptyT = 0;
    this.deadT = 0;
    this.lastRider = null;
    this.bumped = new Map();
    this.box.setEnabled(true);
    this.ball.setEnabled(true);
    this.place();
  }

  place() {
    this.body.setTranslation(this.pos, true);
    this.body.setNextKinematicTranslation(this.pos);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.body.setRotation(_q, true);
    this.body.setNextKinematicRotation(_q);
  }

  // ---------------------------------------------------------------- target interface

  headLineY() {
    return Infinity;
  }

  centerPosition(out) {
    return out.set(this.pos.x, this.pos.y + BOX_Y, this.pos.z);
  }

  facing(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  distanceToBody(p) {
    return Math.max(0, p.distanceTo(this.centerPosition(_v)) - 0.7);
  }

  // Shots on the hull: the rider hears about it (bots turn to look).
  onDamaged(res, info) {
    if (this.rider && info.attacker && info.attacker !== this.rider) this.rider.brain?.onHurt(info.attacker);
  }

  // Blown up: a blast that smokes the rider (credited to whoever finished the bike), then gone
  // until it respawns.
  die(info) {
    const game = this.game;
    const rider = this.rider;
    if (rider) this.vehicles.dismount(rider, true);
    this.centerPosition(_a);
    const attacker = info?.attacker ?? null;
    if (rider?.alive) dealDamage(game, rider, 1e6, { attacker, weapon: info?.weapon ?? SIZZLER_WEAPON, cause: 'explosion', point: _a });
    explode(game, _a, { ...SIZZLER.blast, tint: 0xff8a3a }, { attacker, weapon: SIZZLER_WEAPON });
    game.fx.deathPuff(_a.x, this.pos.y, _a.z);
    this.box.setEnabled(false);
    this.ball.setEnabled(false);
    this.deadT = 0;
    this.vel.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- driving

  tick(dt) {
    const S = SIZZLER;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.prevRoll = this.roll;
    if (!this.alive) {
      // Back after a while, once nobody's standing in its spot.
      if ((this.deadT += dt) >= S.respawn && this.vehicles.spotClear(this)) this.reset();
      return;
    }
    const r = this.rider;
    const inp = r ? r.input : null;
    const pressed = r ? r.ridePressed : null;

    // Left empty away from its spot: back home after a while.
    if (!r) {
      const away = this.pos.distanceTo(this.spot.pos) > 3;
      this.emptyT = away ? this.emptyT + dt : 0;
      if (this.emptyT > S.abandoned && this.vehicles.spotClear(this)) {
        this.reset();
        return;
      }
    }

    // Steering: A/D (or the left stick) turn the rider's view, and the bike turns toward the view.
    if (r && inp.moveX) {
      r.yaw = wrap(r.yaw - inp.moveX * S.steer * dt);
    }
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    let vF = this.vel.x * _f.x + this.vel.z * _f.z;
    if (r) {
      const k = this.grounded ? clamp(S.slowTurn + Math.abs(vF) / 6, S.slowTurn, 1) : S.airTurn;
      const max = S.turn * k * dt;
      // (A bot can drive one way and aim another, within the guns' swing: driveYaw.)
      const d = clamp(wrap((r.driveYaw ?? r.yaw) - this.yaw), -max, max);
      this.yaw = wrap(this.yaw + d);
      this.yawRate = d / dt;
    } else {
      this.yawRate = 0;
    }
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _r.set(-_f.z, 0, _f.x);
    vF = this.vel.x * _f.x + this.vel.z * _f.z;
    let vS = this.vel.x * _r.x + this.vel.z * _r.z;

    const throttle = inp ? inp.moveY : 0;
    this.throttle = throttle;
    _v.copy(this.pos);
    const inMud = this.game.zones.inMud(_v);
    this.boosting = !!inp && inp.held.sprint && throttle > 0.2 && this.boost > 0 && this.grounded && !inMud;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - dt / S.boostTank);
      this.boostWait = S.boostPause;
    } else if ((this.boostWait -= dt) <= 0) {
      this.boost = Math.min(1, this.boost + S.boostRefill * dt);
    }
    if (this.grounded) {
      let max = this.boosting ? S.boostSpeed : S.topSpeed;
      if (inMud) max = Math.min(max, S.mudSpeed);
      if (throttle > 0.05) {
        const want = max * throttle;
        if (vF < 0) vF = Math.min(0, vF + S.brake * dt);
        else if (vF < want) vF = Math.min(want, vF + (this.boosting ? S.boostAccel : S.accel) * dt);
        else vF = Math.max(want, vF - S.overDrag * dt);
      } else if (throttle < -0.05) {
        if (vF > 0.3) vF = Math.max(0, vF + S.brake * throttle * dt);
        else vF = Math.max(-S.reverseSpeed * -throttle, vF + S.accel * 0.6 * throttle * dt);
      } else {
        const c = (r ? S.coast : S.coast * 3) * dt;
        vF = Math.abs(vF) <= c ? 0 : vF - Math.sign(vF) * c;
      }
      if (inMud && Math.abs(vF) > S.mudSpeed) vF -= Math.sign(vF) * S.overDrag * 2 * dt;
      vS *= Math.exp(-S.grip * dt);
      if (pressed?.jump) {
        this.vel.y = S.hop;
        this.grounded = false;
        this.game.sfx.play('wallKick', { at: this.pos, source: r, rate: 0.7 });
      } else {
        this.vel.y = -2;
      }
    } else {
      this.vel.y = Math.max(-MOVE.maxFallSpeed, this.vel.y - GRAVITY * dt);
    }
    this.vel.x = _f.x * vF + _r.x * vS;
    this.vel.z = _f.z * vF + _r.z * vS;

    this.runInto(vF, dt);

    // Move.
    const d = this.desired;
    d.x = this.vel.x * dt;
    d.y = this.vel.y * dt;
    d.z = this.vel.z * dt;
    this.cc.computeColliderMovement(this.ball, d, this.filter, undefined, this.ignore);
    const m = this.cc.computedMovement();
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    const wasAir = !this.grounded;
    const fall = -this.vel.y;
    this.grounded = this.cc.computedGrounded() && this.vel.y <= 0.5;
    // Hitting a wall eats the speed into it.
    const want = Math.hypot(d.x, d.z);
    if (want > 1e-4) {
      const got = Math.hypot(m.x, m.z);
      if (got < want * 0.6 && want / dt > 9) {
        this.game.sfx.play('smash', { at: this.pos, volume: 0.5, rate: 0.8 });
        r?.addShake?.(0.4);
      }
      this.vel.x = m.x / dt;
      this.vel.z = m.z / dt;
    }
    if (this.grounded) {
      this.vel.y = 0;
      if (wasAir && this.airT > 0.25) {
        this.game.sfx.play('stepMetal', { at: this.pos, source: r, volume: Math.min(1.2, 0.4 + fall / 12), rate: 0.6 });
        if (r) r.addShake(Math.min(0.6, fall / 25));
      }
      this.airT = 0;
    } else {
      this.airT += dt;
      // Bumped the head on something: stop rising.
      if (this.vel.y > 0 && m.y < d.y * 0.5) this.vel.y = 0;
    }

    this.lean(dt, vF);
    this.spin += (vF * dt) / WHEEL_R;
    this.body.setNextKinematicTranslation(this.pos);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.body.setNextKinematicRotation(_q);

    if (r) {
      this.seat(r);
      // What the reticle is on (it turns red, and controllers slow down over it).
      if (!r.isBot) {
        this.vehicles.aimPoint(r, this);
        r.aimTarget = this.vehicles.aimEntity;
      }
      this.shoot(dt, inp);
    } else {
      this.heatDown(dt);
    }
    if (this.pos.y < -20) dealDamage(this.game, this, 1e6, { cause: 'fell' });
  }

  // Nose up and down with the ground under the wheels (or the arc in the air), leaning into turns.
  lean(dt, vF) {
    let pitch = 0;
    if (this.grounded) {
      const fy = this.groundAt(-WHEEL_Z);
      const by = this.groundAt(WHEEL_Z);
      if (fy !== null && by !== null) pitch = Math.atan2(fy - by, WHEEL_Z * 2);
    } else {
      pitch = clamp(Math.atan2(this.vel.y, Math.max(4, Math.abs(vF))) * 0.6, -0.5, 0.5);
    }
    this.pitch += (pitch - this.pitch) * damp(this.grounded ? 14 : 4, dt);
    const roll = this.grounded ? clamp(this.yawRate * vF * 0.035, -0.45, 0.45) : this.roll * 0.98;
    this.roll += (roll - this.roll) * damp(6, dt);
    this.steer += (clamp(this.yawRate * 0.18, -0.4, 0.4) - this.steer) * damp(10, dt);
  }

  // The ground's height under a point `z` along the bike (bike space), or null.
  groundAt(z) {
    _v.set(Math.sin(this.yaw) * z, 0, Math.cos(this.yaw) * z).add(this.pos);
    _v.y += 0.9;
    const hit = this.game.surfaceNear(_v, _down, 1.8, _hit);
    return hit ? hit.point.y : null;
  }

  // Running into people: a shove and a hit, or a splatter at speed.
  runInto(vF, dt) {
    const S = SIZZLER;
    const speed = Math.abs(vF);
    if (speed < S.bump) return;
    const dir = Math.sign(vF);
    const killer = this.rider ?? this.lastRider;
    const now = this.game.time;
    _a.set(-Math.sin(this.yaw) * NOSE * 0.6 * dir, 0, -Math.cos(this.yaw) * NOSE * 0.6 * dir).add(this.pos);
    for (const p of this.game.players) {
      if (!p.alive || p === this.rider || p.vehicle) continue;
      if (p.feetY() > this.pos.y + 1.3 || p.topY() < this.pos.y) continue;
      const dx = p.center.x - _a.x;
      const dz = p.center.z - _a.z;
      const reach = p.radius + 0.55 + speed * dt;
      if (dx * dx + dz * dz > reach * reach) continue;
      // Only what's ahead (or behind, reversing).
      if ((dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) * dir < -0.3) continue;
      if (now - (this.bumped.get(p) ?? -9) < 0.6) continue;
      this.bumped.set(p, now);
      _v.set(-Math.sin(this.yaw) * dir, 0.35, -Math.cos(this.yaw) * dir).normalize();
      _v2.set(p.center.x, p.center.y, p.center.z);
      const info = { attacker: killer && killer !== p ? killer : null, weapon: SIZZLER_WEAPON, cause: 'splatter', point: this.pos, dir: _v };
      if (speed >= S.splatter) {
        this.game.sfx.play('smash', { at: _v2, volume: 1 });
        const res = dealDamage(this.game, p, 1e6, info);
        if (res) this.rider?.onHitConfirmed(res, false);
      } else {
        this.game.sfx.play('bash', { at: _v2 });
        p.knockback(_v, speed * 0.9);
        const res = dealDamage(this.game, p, S.bumpDamage * (speed / S.splatter), info);
        if (res) this.rider?.onHitConfirmed(res, false);
        this.vel.multiplyScalar(0.55);
      }
    }
  }

  // The rider on the seat: their capsule rides along (and stays hittable).
  seat(p) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    p.center.set(this.pos.x + s * SEAT_Z, this.pos.y + SEAT_FEET + p.halfHeight + p.radius, this.pos.z + c * SEAT_Z);
    p.vel.copy(this.vel);
    p.grounded = this.grounded;
    p.body.setNextKinematicTranslation(p.center);
  }

  // ---------------------------------------------------------------- guns

  heatDown(dt) {
    if (this.overheatT > 0) {
      this.overheatT -= dt;
      this.heat = Math.max(0, this.overheatT / SIZZLER.gun.cool);
      return;
    }
    if ((this.ventT -= dt) <= 0) this.heat = Math.max(0, this.heat - SIZZLER.gun.vent * dt);
  }

  get overheated() {
    return this.overheatT > 0;
  }

  shoot(dt, inp) {
    const G = SIZZLER.gun;
    this.shotT -= dt;
    if (!inp.held.fire || this.overheatT > 0) {
      this.heatDown(dt);
      if (this.shotT < 0) this.shotT = 0;
      return;
    }
    while (this.shotT <= 0 && this.overheatT <= 0) {
      this.shotT += 1 / G.rate;
      this.fire();
      this.heat += G.heatPerShot;
      this.ventT = G.ventDelay;
      if (this.heat >= 1) {
        this.heat = 1;
        this.overheatT = G.cool;
        this.game.sfx.play('vent', { at: this.pos, source: this.rider, volume: 1.4 });
      }
    }
  }

  // One round from the next barrel toward what the rider's reticle is on, kept within the guns'
  // swing off the bike's heading.
  fire() {
    const G = SIZZLER.gun;
    const game = this.game;
    const p = this.rider;
    const aim = this.vehicles.aimPoint(p, this);
    const muzzle = this.muzzle(this.barrel, _a);
    this.barrel = 1 - this.barrel;
    _v.subVectors(aim, muzzle);
    const len = _v.length();
    if (len < 1e-3) _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    else _v.divideScalar(len);
    // Clamp to the swing (yaw off the heading) and the pitch limits.
    let yawOff = wrap(Math.atan2(-_v.x, -_v.z) - this.yaw);
    yawOff = clamp(yawOff, -G.swing, G.swing);
    const pitch = clamp(Math.asin(clamp(_v.y, -1, 1)), this.pitch - G.pitchDown, this.pitch + G.pitchUp);
    const ya = this.yaw + yawOff;
    // Spread.
    const sp = G.spread * DEG * Math.sqrt(Math.random());
    const ang = Math.random() * Math.PI * 2;
    const yaw2 = ya + Math.cos(ang) * sp;
    const pitch2 = pitch + Math.sin(ang) * sp;
    _f.set(-Math.sin(yaw2) * Math.cos(pitch2), Math.sin(pitch2), -Math.cos(yaw2) * Math.cos(pitch2));
    const hit = game.castShot(muzzle, _f, G.range, this.box);
    _v2.copy(muzzle).addScaledVector(_f, hit.hit ? hit.distance : G.range);
    game.fx.tracer(muzzle, _v2, 0xffb24a, 0.035, { linger: 0.05 });
    game.replay?.shot(p, muzzle, _v2, 0xffb24a, 0.035, 0.05);
    if (gfx.thirdPersonFlashes) game.fx.muzzleFlash(muzzle, _f, 0xffb050, 0.32, -1);
    game.sfx.play('smg', { at: muzzle, source: p, volume: 0.75, rate: 0.82 + Math.random() * 0.06 });
    if (game.swarms.count) game.swarms.shot(muzzle, _f, hit.hit ? hit.distance : G.range, G.damage, p);
    game.noise(p, 30);
    if (!hit.hit) return;
    if (hit.entity) {
      if (hit.entity.kind === 'vehicle') game.fx.impactWorld(hit.point, hit.normal, 'metal');
      else game.fx.impactBody(hit.point, hit.normal, hit.entity.vitals.shield > 0);
      const res = dealDamage(game, hit.entity, G.damage, { attacker: p, weapon: SIZZLER_WEAPON, point: hit.point, dir: _f });
      if (res) p.onHitConfirmed(res, false);
    } else {
      const surface = game.trimFace(hit.point, hit.normal, hit.surface);
      game.fx.impactWorld(hit.point, hit.normal, surface);
      if (this.barrel === 0) game.fx.mark(hit.point, hit.normal, surface);
    }
  }

  // A barrel's muzzle in the world, as of this tick.
  muzzle(i, out) {
    _e.set(this.pitch, this.yaw, this.roll);
    _q.setFromEuler(_e);
    return out.copy(MUZZLES[i]).applyQuaternion(_q).add(this.pos);
  }

  // ---------------------------------------------------------------- looks

  // The bike's matrix for drawing, between the last tick and this one.
  matrix(alpha, out) {
    _v.lerpVectors(this.prevPos, this.pos, alpha);
    const yaw = this.prevYaw + wrap(this.yaw - this.prevYaw) * alpha;
    _e.set(this.prevPitch + (this.pitch - this.prevPitch) * alpha, yaw, this.prevRoll + (this.roll - this.prevRoll) * alpha);
    _q.setFromEuler(_e);
    return out.compose(_v, _q, _one);
  }

  // The drawn heading (for the rider's body).
  drawnYaw(alpha) {
    return this.prevYaw + wrap(this.yaw - this.prevYaw) * alpha;
  }

  dispose() {
    const world = this.game.physics.world;
    world.removeCharacterController(this.cc);
    world.removeRigidBody(this.body);
  }
}

// Every bike on the map, their meshes, mounting and the riders' chase camera.
export class Vehicles {
  // spots: [{ pos: [x, y, z], yaw }], from the map's build (arena.vehicles).
  constructor(game, spots) {
    this.game = game;
    this.bikes = spots.map((s, i) => new Bike(this, { pos: new THREE.Vector3(...s.pos), yaw: s.yaw }, i));
    const mat = (this.material = bikeMaterial());
    const frame = partsGeometry(FRAME_PARTS, PAINT);
    const wheel = partsGeometry(WHEEL_PARTS, RUBBER);
    this.frames = new THREE.InstancedMesh(frame, mat, this.bikes.length);
    this.wheels = new THREE.InstancedMesh(wheel, mat, this.bikes.length * 2);
    this.frames.name = 'sizzlers';
    this.wheels.name = 'sizzlerWheels';
    for (const m of [this.frames, this.wheels]) {
      m.castShadow = true;
      m.receiveShadow = true;
      // (They move all over the map.)
      m.frustumCulled = false;
      game.scene.add(m);
    }
    this._aim = new THREE.Vector3();
    this.aimEntity = null;
    this.updateVisuals(0, 1);
  }

  tick(dt) {
    for (const b of this.bikes) b.tick(dt);
  }

  // A player standing by a free bike: offer it, and get on when they press interact.
  touch(p, pressed) {
    p.vehiclePrompt = null;
    if (p.mode !== 'move' || p.guiding || p.pickupPrompt) return;
    const R = SIZZLER.reach;
    let best = null;
    let bd = R * R;
    for (const b of this.bikes) {
      if (!b.alive || b.rider) continue;
      const dx = b.pos.x + Math.sin(b.yaw) * SEAT_Z - p.center.x;
      const dz = b.pos.z + Math.cos(b.yaw) * SEAT_Z - p.center.z;
      const dy = b.pos.y - p.feetY();
      if (Math.abs(dy) > 1.2) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    p.vehiclePrompt = best;
    if (best && pressed.interact) this.mount(p, best);
  }

  mount(p, b) {
    p.vehiclePrompt = null;
    p.vehicle = b;
    b.rider = p;
    b.lastRider = p;
    b.emptyT = 0;
    p.ridePressed = null;
    p.endRide?.(false);
    p.startRide(b);
    b.seat(p);
    p.prevCenter.copy(p.center);
    this.game.sfx.play('swap', { at: b.pos, source: p });
  }

  // Off the bike, beside it (whichever side has room). `dead`: the rider is going down with it.
  dismount(p, dead = false) {
    const b = p.vehicle;
    if (!b) return;
    b.rider = null;
    p.vehicle = null;
    p.driveYaw = null;
    p.endRide(dead);
    if (dead) return;
    const s = Math.sin(b.yaw);
    const c = Math.cos(b.yaw);
    const y = b.pos.y + 0.1;
    // Left, right, behind, then on top.
    const spots = [[-c * 1.2, s * 1.2], [c * 1.2, -s * 1.2], [s * 1.9, c * 1.9]];
    let placed = false;
    for (const [ox, oz] of spots) {
      const x = b.pos.x + ox;
      const z = b.pos.z + oz;
      if (!p.overlaps(p.standShape, x, y + p.halfHeight + p.radius + 0.05, z)) {
        p.center.set(x, y + p.halfHeight + p.radius + 0.05, z);
        placed = true;
        break;
      }
    }
    if (!placed) p.center.set(b.pos.x, b.pos.y + 1.3 + p.halfHeight + p.radius, b.pos.z);
    p.prevCenter.copy(p.center);
    p.body.setTranslation(p.center, true);
    p.body.setNextKinematicTranslation(p.center);
    // Hop off with some of the bike's speed.
    p.vel.set(b.vel.x * 0.4, 2, b.vel.z * 0.4);
    p.grounded = false;
    this.game.sfx.play('swap', { at: b.pos, source: p });
  }

  // Nobody (no player, no other bike) in a bike's spot, so it can come back there.
  spotClear(b) {
    const s = b.spot.pos;
    for (const p of this.game.players) if (p.alive && Math.hypot(p.center.x - s.x, p.center.z - s.z) < 2.2) return false;
    for (const o of this.bikes) if (o !== b && o.alive && Math.hypot(o.pos.x - s.x, o.pos.z - s.z) < 2.6) return false;
    return true;
  }

  // Where a rider's reticle is: the first thing along the chase camera's center line, cast from
  // just past the rider (so nothing between the camera and the bike gets in the way). Bots have
  // no camera: from their eye.
  aimPoint(p, b) {
    const G = SIZZLER.gun;
    _f.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    if (p.isBot || !p.camDist) p.eyePosition(_v);
    else _v.copy(p.camera.position).addScaledVector(_f, p.camDist + 0.3);
    const hit = this.game.castShot(_v, _f, G.range, p.collider);
    this.aimEntity = hit.hit && hit.entity && hit.entity !== b && hit.entity.alive ? hit.entity : null;
    return this._aim.copy(_v).addScaledVector(_f, hit.hit && hit.entity !== b ? hit.distance : G.range);
  }

  // A rider's chase camera: behind and above, looking where they aim, pulled in by walls.
  camera(p, cam, alpha, dt) {
    const b = p.vehicle;
    const S = SIZZLER;
    _v.lerpVectors(b.prevPos, b.pos, alpha);
    _v.y += S.camPivot;
    _f.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    // Back along the aim and up a little.
    _a.copy(_f).multiplyScalar(-S.camBack);
    _a.y += S.camUp;
    const len = _a.length();
    _a.divideScalar(len);
    const hit = this.game.surfaceNear(_v, _a, len + 0.3, _hit);
    const dist = hit ? Math.max(0.6, hit.point.distanceTo(_v) - 0.3) : len;
    cam.position.copy(_v).addScaledVector(_a, dist);
    // (How far ahead of the camera the rider is, along the aim: the reticle's ray starts past them.)
    p.camDist = Math.max(0, _v.sub(cam.position).dot(_f));
    // Look along the aim from there, tipped down a little so the bike sits in view; the reticle
    // is drawn as far above the middle (Hud), on the aim's line.
    cam.rotation.set(p.pitch - S.camTilt, p.yaw, 0);
  }

  updateVisuals(dt, alpha) {
    let n = 0;
    let w = 0;
    for (const b of this.bikes) {
      if (!b.alive) continue;
      b.matrix(alpha, _m);
      this.frames.setMatrixAt(n++, _m);
      for (const [z, steer] of [[-WHEEL_Z, b.steer], [WHEEL_Z, 0]]) {
        _e.set(-b.spin, steer, 0);
        _q.setFromEuler(_e);
        _m2.compose(_v.set(0, WHEEL_R, z), _q, _one);
        this.wheels.setMatrixAt(w++, _m2.premultiply(_m));
      }
      // Smoke from the stacks while the engine runs (thicker on the throttle), embers on a boost.
      if (dt > 0 && b.rider) {
        b.smokeAcc = (b.smokeAcc ?? 0) + dt * (3 + Math.abs(b.throttle) * 6 + (b.boosting ? 10 : 0));
        while (b.smokeAcc >= 1) {
          b.smokeAcc -= 1;
          const s = STACKS[(Math.random() * 2) | 0];
          _v.copy(s).applyMatrix4(_m);
          if (b.boosting && Math.random() < 0.6) this.game.fx.fireEmber(_v.x, _v.y, _v.z);
          else this.game.fx.fireWisp(_v.x, _v.y, _v.z);
        }
      }
      this.engineSound(b);
    }
    this.frames.count = n;
    this.wheels.count = w;
    this.frames.visible = n > 0;
    this.wheels.visible = w > 0;
    this.frames.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    for (const b of this.bikes) if (!b.alive && b.engine) this.game.sfx.setEngine(b.engine, b.pos, null, 0, 0);
  }

  // The engine idles while someone's on, revving with speed and the throttle.
  engineSound(b) {
    const sfx = this.game.sfx;
    if (!b.engine) b.engine = sfx.engine?.() ?? null;
    if (!b.engine) return;
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const rev = clamp(speed / SIZZLER.boostSpeed + Math.max(0, b.throttle) * 0.15 + (b.boosting ? 0.15 : 0), 0, 1.2);
    sfx.setEngine(b.engine, b.pos, b.rider, rev, b.rider && this.game.state === 'playing' ? 1 : 0);
  }

  // Paused or over: every engine quiet (they come back with the next frame of play).
  silence() {
    for (const b of this.bikes) if (b.engine) this.game.sfx.setEngine(b.engine, b.pos, null, 0, 0);
  }

  // One bike drawn in front of the camera for the shader warm-up.
  warmup(on, at) {
    if (!on) {
      this.updateVisuals(0, 1);
      return;
    }
    _m.compose(at, _q.identity(), _one);
    this.frames.setMatrixAt(0, _m);
    this.wheels.setMatrixAt(0, _m);
    this.frames.count = this.wheels.count = 1;
    this.frames.visible = this.wheels.visible = true;
    this.frames.instanceMatrix.needsUpdate = this.wheels.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const b of this.bikes) {
      if (b.engine) this.game.sfx.stopEngine(b.engine);
      b.dispose();
    }
    this.frames.geometry.dispose();
    this.wheels.geometry.dispose();
    this.material.dispose();
    this.frames.removeFromParent();
    this.wheels.removeFromParent();
  }
}
