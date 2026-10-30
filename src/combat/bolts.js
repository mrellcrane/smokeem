import * as THREE from 'three';
import { dealDamage } from './damage.js';
import { jarGeometry, rocketGeometry } from './weaponModels.js';
import { explode } from './explosions.js';

// Bolts: small ballistic projectiles with no physics body (the Swarm Jar's jar; later the
// Sauce Boss glob). Each tick a bolt falls under its own gravity and casts one ray along its
// step, so it hits walls and bodies alike. One instanced mesh per look, one draw call each.
//
// A gun that fires bolts has kind 'bolt' and a `projectile` block:
//   look      which mesh to draw ('jar')
//   gravity   m/s^2 (positive pulls down)
//   life      seconds before it vanishes
//   radius    how fat it is when it hits things (meters)
//   direct    damage to a body it hits
//   ownerGrace seconds it ignores its shooter after launch
//   straight  flies nose first instead of tumbling
//   trail     leaves smoke and a glow (the `glow` color) behind it
//   homing    radians a second it turns toward its `target` (set by whoever fired it), if any
//   explosion bursts with this blast on impact or at the end of its life (explosions.js)
// What happens on impact is up to the gun: `game.bolts.onImpact[look](bolt, hit)`; `hit` is
// null when a bolt runs out of life in the air.

const MAX_BOLTS = 16;
const FWD = new THREE.Vector3(0, 0, -1);
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

export class Bolts {
  constructor(game, material) {
    this.game = game;
    this.list = [];
    // Impact handlers by look, set by whoever owns that kind of bolt.
    this.onImpact = {};
    this.meshes = {};
    this.meshList = [];
    for (const [look, geom] of [['jar', jarGeometry()], ['rocket', rocketGeometry()]]) {
      const m = new THREE.InstancedMesh(geom, material, MAX_BOLTS);
      m.name = `bolts:${look}`;
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      game.scene.add(m);
      this.meshes[look] = m;
      this.meshList.push(m);
    }
  }

  // owner: who fired it; velocity is copied; kind: the gun's projectile block; weapon: its def;
  // target: what a homing bolt turns toward. Returns the bolt.
  fire(owner, origin, velocity, kind, weapon, target = null) {
    if (this.list.length >= MAX_BOLTS) this.list.shift();
    const b = {
      owner,
      kind,
      weapon,
      target,
      age: 0,
      pos: new THREE.Vector3().copy(origin),
      prev: new THREE.Vector3().copy(origin),
      vel: new THREE.Vector3().copy(velocity),
      spin: Math.random() * Math.PI * 2,
    };
    this.list.push(b);
    return b;
  }

  tick(dt) {
    const game = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.prev.copy(b.pos);
      b.age += dt;
      b.vel.y -= b.kind.gravity * dt;
      if (b.target && b.kind.homing) this.home(b, dt);
      const step = b.vel.length() * dt;
      if (b.pos.y < -20 || step < 1e-6) {
        this.list.splice(i, 1);
        continue;
      }
      if (b.age > b.kind.life) {
        this.list.splice(i, 1);
        this.burst(b, null);
        this.onImpact[b.kind.look]?.(b, null);
        continue;
      }
      if (b.kind.trail) {
        // Exhaust smoke and the motor's glow with its light trail.
        _t.copy(b.vel).normalize();
        _c.copy(b.pos).addScaledVector(_t, -0.25);
        game.fx.glow(_c, b.kind.glow ?? 0xffb050, 0.45, true);
        game.fx.smoke.spawn(_c.x, _c.y, _c.z, 0, 0.3, 0, 0xbab2aa, 0.2, 0.8, { grow: 3.2, drag: 2, alpha: 0.55, rotVel: 1 });
      }
      _d.copy(b.vel).divideScalar(step / dt);
      const exclude = b.age < (b.kind.ownerGrace ?? 0) ? b.owner.collider : undefined;
      // Into a portal: out of the other one.
      if (game.portals?.carry(b.pos, _d, step, game.castShot(b.pos, _d, step + (b.kind.radius ?? 0), exclude).distance, b.vel)) {
        b.prev.copy(b.pos);
        continue;
      }
      const hit = game.castShot(b.pos, _d, step + (b.kind.radius ?? 0), exclude);
      if (hit.hit) {
        b.pos.addScaledVector(_d, Math.max(0, hit.distance - (b.kind.radius ?? 0)));
        this.list.splice(i, 1);
        this.impact(b, hit);
        continue;
      }
      b.pos.addScaledVector(_d, step);
    }
  }

  // Turn toward the target's middle, no faster than the bolt's homing rate.
  home(b, dt) {
    const t = b.target;
    if (!t.alive) {
      b.target = null;
      return;
    }
    const speed = b.vel.length();
    t.centerPosition(_t).sub(b.pos).normalize();
    _d.copy(b.vel).divideScalar(speed);
    const angle = Math.acos(Math.max(-1, Math.min(1, _d.dot(_t))));
    if (angle < 1e-4) return;
    const k = Math.min(1, (b.kind.homing * dt) / angle);
    b.vel.copy(_d.lerp(_t, k).normalize().multiplyScalar(speed));
  }

  // A bolt with an explosion bursts (pulled back off the surface it hit).
  burst(b, hit) {
    if (!b.kind.explosion) return;
    if (hit && !hit.entity) b.pos.copy(hit.point).addScaledVector(hit.normal, 0.15);
    explode(this.game, b.pos, b.kind.explosion, { attacker: b.owner, weapon: b.weapon, against: hit && !hit.entity ? hit.normal : null });
  }

  impact(b, hit) {
    if (hit.entity && b.kind.direct) {
      const res = dealDamage(this.game, hit.entity, b.kind.direct, {
        attacker: b.owner,
        weapon: b.weapon,
        point: hit.point,
        dir: _d,
      });
      if (res && b.owner.alive) b.owner.onHitConfirmed?.(res, false);
    }
    this.burst(b, hit);
    this.onImpact[b.kind.look]?.(b, hit);
  }

  updateVisuals(alpha) {
    for (const m of this.meshList) m.count = 0;
    for (const b of this.list) {
      const m = this.meshes[b.kind.look];
      _c.lerpVectors(b.prev, b.pos, alpha);
      // Nose first, or tumbling end over end along its flight.
      if (b.kind.straight) _q.setFromUnitVectors(FWD, _t.copy(b.vel).normalize());
      else _q.setFromEuler(_e.set(b.spin + b.age * 9, Math.atan2(b.vel.x, b.vel.z), 0, 'YXZ'));
      m.setMatrixAt(m.count++, _m.compose(_c, _q, _s));
    }
    for (const m of this.meshList) {
      m.visible = m.count > 0;
      if (m.count) m.instanceMatrix.needsUpdate = true;
    }
  }

  warmup(on, at) {
    for (const m of this.meshList) {
      if (on) {
        m.setMatrixAt(0, _m.compose(at, _q.identity(), _s));
        m.instanceMatrix.needsUpdate = true;
      }
      m.count = on ? 1 : 0;
      m.visible = on;
    }
  }

  clear() {
    this.list.length = 0;
    for (const m of this.meshList) {
      m.count = 0;
      m.visible = false;
    }
  }

  dispose() {
    for (const m of this.meshList) m.geometry.dispose();
  }
}
