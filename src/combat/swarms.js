import * as THREE from 'three';
import { MOVE } from '../config.js';
import { settings } from '../settings.js';
import { dealDamage } from './damage.js';
import { bugGeometry } from './weaponModels.js';

// Swarm Jar bug swarms. Pure math (no physics bodies): each swarm seeks the nearest enemy it
// can see, latches on and stings until it dies out. Shots that pass close hurt it; its
// victim's melee, fire, explosions and the Brander's beam kill it. All bugs of all swarms are
// one instanced mesh (one draw call).

export const SWARM = {
  max: 4,
  bugs: 12,
  life: 6,
  hp: 30,
  // Seeks the nearest visible enemy this close, rechecking sight this often, and keeps a
  // target at least `keepTarget` seconds.
  range: 15,
  sightEvery: 0.3,
  keepTarget: 1,
  // Flies at this share of the current sprint speed, turning at most this fast (rad/s).
  speedMul: 0.8,
  turnRate: 3,
  // Latches on within this distance of a body, then stings this hard (batched).
  latch: 1.0,
  dps: 30,
  stingEvery: 0.25,
  // Any shot passing this close to its center hurts it (and carries on).
  hitRadius: 0.6,
  // The Brander burns one out of the air in this long.
  beamKillTime: 0.3,
  buzzEvery: 0.35,
};

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class Swarms {
  constructor(game, material) {
    this.game = game;
    this.list = [];
    // Each bug's own orbit around its swarm's center: phase, speed, radius, height.
    this.orbits = [];
    for (let i = 0; i < SWARM.bugs; i++) {
      this.orbits.push({
        phase: (i / SWARM.bugs) * Math.PI * 2,
        speed: 5 + Math.random() * 6,
        radius: 0.25 + Math.random() * 0.3,
        tilt: Math.random() * Math.PI,
        bob: Math.random() * Math.PI * 2,
      });
    }
    this.mesh = new THREE.InstancedMesh(bugGeometry(), material, SWARM.max * SWARM.bugs);
    this.mesh.name = 'swarms';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    game.scene.add(this.mesh);
  }

  get count() {
    return this.list.length;
  }

  // A Swarm Jar's jar (a bolt) smashed on something, or ran out of flight: glass, then bugs.
  release(bolt, hit) {
    _c.copy(bolt.pos);
    // Out from the surface it hit (back along the flight if the hit has no usable normal).
    if (hit && hit.normal.lengthSq() > 0.25) _c.addScaledVector(hit.normal, 0.3);
    else if (hit) _c.addScaledVector(_d.copy(bolt.vel).normalize(), -0.3);
    this.game.sfx.play('smash', { at: _c });
    const fx = this.game.fx;
    for (let i = 0; i < 10; i++) {
      fx.sparks.spawn(_c.x, _c.y, _c.z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0xe8c878, 0.05, 0.4, {
        gravity: 12,
        drag: 1,
      });
    }
    this.spawn(bolt.owner, _c, bolt.weapon);
  }

  // Let a swarm out at `pos`.
  spawn(owner, pos, weapon) {
    if (this.list.length >= SWARM.max) this.fizzle(this.list[0]);
    this.list.push({
      owner,
      weapon,
      pos: new THREE.Vector3().copy(pos),
      prev: new THREE.Vector3().copy(pos),
      vel: new THREE.Vector3(),
      target: null,
      targetT: 0,
      sightT: 0,
      victim: null,
      stingT: SWARM.stingEvery,
      life: SWARM.life,
      hp: SWARM.hp,
      buzzT: 0,
    });
  }

  // Who's being hunted or stung, for bots deciding how to deal with it.
  on(player) {
    for (const s of this.list) if (s.victim === player) return s;
    return null;
  }

  after(player) {
    for (const s of this.list) if (s.target === player && !s.victim) return s;
    return null;
  }

  tick(dt) {
    const game = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.prev.copy(s.pos);
      s.life -= dt;
      if (s.life <= 0) {
        this.fizzle(s);
        continue;
      }
      // Fire burns it up.
      _p.set(s.pos.x, s.pos.y - 0.1, s.pos.z);
      if (game.zones.inFire(_p, 0.2, 0.15)) {
        this.kill(s);
        continue;
      }
      if (s.victim && !s.victim.alive) {
        s.victim = null;
        s.target = null;
      }
      if (s.victim) this.sting(s, dt);
      else this.seek(s, dt);

      s.buzzT -= dt;
      if (s.buzzT <= 0) {
        s.buzzT = SWARM.buzzEvery;
        // Its victim hears it right in their ear.
        game.sfx.play('buzz', { at: s.pos, source: s.victim && !s.victim.isBot ? s.victim : null });
      }
    }
  }

  sting(s, dt) {
    s.victim.centerPosition(_c);
    s.pos.set(_c.x, _c.y + 0.55, _c.z);
    s.vel.set(0, 0, 0);
    s.stingT -= dt;
    if (s.stingT > 0) return;
    s.stingT += SWARM.stingEvery;
    dealDamage(this.game, s.victim, SWARM.dps * SWARM.stingEvery, {
      attacker: s.owner,
      weapon: s.weapon,
      cause: 'swarm',
      point: s.pos,
    });
  }

  seek(s, dt) {
    const game = this.game;
    if (s.target && !s.target.alive) s.target = null;
    s.targetT += dt;
    s.sightT -= dt;
    if (s.sightT <= 0) {
      s.sightT = SWARM.sightEvery;
      this.retarget(s);
    }

    const speed = SWARM.speedMul * MOVE.sprintSpeed * settings.moveSpeed;
    if (s.target) {
      s.target.centerPosition(_c);
      _c.y += 0.3;
      _d.subVectors(_c, s.pos).normalize();
      // Turn toward the target at a capped rate.
      if (s.vel.lengthSq() < 1e-6) _u.copy(_d);
      else _u.copy(s.vel).normalize();
      const dot = Math.max(-1, Math.min(1, _u.dot(_d)));
      const ang = Math.acos(dot);
      const max = SWARM.turnRate * dt;
      if (ang > max && ang > 1e-4) {
        // Rotate _u toward _d by `max` within their plane.
        _p.copy(_d).addScaledVector(_u, -dot);
        if (_p.lengthSq() < 1e-8) _p.set(0, 1, 0);
        _p.normalize();
        _u.multiplyScalar(Math.cos(max)).addScaledVector(_p, Math.sin(max));
      } else {
        _u.copy(_d);
      }
      s.vel.copy(_u).multiplyScalar(speed);
    } else {
      // Nobody in sight: hang about, drifting a little.
      s.vel.multiplyScalar(Math.exp(-3 * dt));
      s.vel.y += Math.sin(game.time * 3 + s.life) * 0.5 * dt;
    }

    const step = s.vel.length() * dt;
    if (step > 1e-5) {
      _d.copy(s.vel).divideScalar(s.vel.length());
      const ex = s.owner.alive ? s.owner.collider : undefined;
      // Through a portal in the way.
      if (game.portals?.carry(s.pos, _d, step, game.castShot(s.pos, _d, step + 0.25, ex).distance, s.vel)) return;
      const hit = game.castShot(s.pos, _d, step + 0.25, ex);
      if (!hit.hit || hit.entity) {
        s.pos.addScaledVector(s.vel, dt);
      } else if (s.target) {
        // Something solid ahead: rise over it, unless something solid is right overhead too
        // (under a deck it just waits).
        const rise = speed * dt;
        const up = game.castShot(s.pos, UP, rise + 0.25, undefined);
        if (!up.hit || up.entity) s.pos.y += rise;
        else s.vel.set(0, 0, 0);
      } else {
        s.vel.set(0, 0, 0);
      }
    }
    // Latch on when close, but never through a wall or floor.
    if (s.target && s.target.distanceToBody(s.pos) < SWARM.latch) {
      s.target.centerPosition(_c);
      if (!game.lineBlocked(s.pos, _c)) {
        s.victim = s.target;
        s.stingT = SWARM.stingEvery;
      }
    }
  }

  // Hunt the nearest enemy it can see in range, but keep a target at least `keepTarget`
  // seconds once it has one.
  retarget(s) {
    if (s.target && s.targetT < SWARM.keepTarget) return;
    const game = this.game;
    let best = null;
    let bestD = SWARM.range;
    for (const e of game.entities.values()) {
      if (e === s.owner || !e.alive) continue;
      e.centerPosition(_c);
      const d = _c.distanceTo(s.pos);
      if (d > bestD) continue;
      if (game.lineBlocked(s.pos, _c)) continue;
      bestD = d;
      best = e;
    }
    if (best !== s.target) {
      s.target = best;
      s.targetT = 0;
    }
  }

  // A shot by `shooter` from `origin` along unit `dir` for `dist` meters: every swarm it passes
  // close to takes `amount` (shots carry on through). Bugs on the shooter's own head don't
  // count: they sit right under the eye, so every level shot would clear them by accident.
  shot(origin, dir, dist, amount, shooter) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.victim && s.victim === shooter) continue;
      _d.subVectors(s.pos, origin);
      const t = _d.dot(dir);
      if (t < 0 || t > dist) continue;
      if (_d.lengthSq() - t * t > SWARM.hitRadius * SWARM.hitRadius) continue;
      s.hp -= amount;
      this.game.fx.smoke.spawn(s.pos.x, s.pos.y, s.pos.z, 0, -0.5, 0, 0x2a1e14, 0.08, 0.3, { gravity: 6, alpha: 0.9 });
      if (s.hp <= 0) this.kill(s);
    }
  }

  // Melee from someone the bugs are on swats them; returns true then (the swing is used up).
  // A swing aimed right at a free swarm in reach (not your own) knocks it out of the air too,
  // and still goes on to hit whoever is in front. `forward`: the aim direction.
  swat(p, forward) {
    p.eyePosition(_c);
    let onMe = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.victim === p) {
        this.kill(s);
        onMe = true;
        continue;
      }
      if (s.victim || s.owner === p) continue;
      _d.subVectors(s.pos, _c);
      const d = _d.length();
      if (d < 1.6 && d > 1e-3 && _d.dot(forward) / d > 0.7) this.kill(s);
    }
    return onMe;
  }

  // Explosions clear swarms inside their radius.
  blast(pos, radius) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].pos.distanceTo(pos) <= radius) this.kill(this.list[i]);
    }
  }

  // Killed: a spray of dead bugs.
  kill(s) {
    this.remove(s);
    const fx = this.game.fx;
    // Dark bits need the normally blended pool (additive sparks can't look dark).
    for (let i = 0; i < 8; i++) {
      fx.smoke.spawn(s.pos.x, s.pos.y, s.pos.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0x22180f, 0.07, 0.6, {
        gravity: 9,
        drag: 1,
        alpha: 1,
      });
    }
    this.game.sfx.play('swat', { at: s.pos });
  }

  // Ran out of time: the bugs drift apart.
  fizzle(s) {
    this.remove(s);
    this.game.fx.smoke.spawn(s.pos.x, s.pos.y, s.pos.z, 0, 0.3, 0, 0x5a5048, 0.3, 0.6, { grow: 2, drag: 2, alpha: 0.4 });
  }

  remove(s) {
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
  }

  updateVisuals(alpha) {
    const t = this.game.time;
    let n = 0;
    for (const s of this.list) {
      _c.lerpVectors(s.prev, s.pos, alpha);
      // Tighter and faster around a victim's head.
      const tight = s.victim ? 1.3 : 1;
      for (const o of this.orbits) {
        const a = o.phase + t * o.speed * tight;
        const r = o.radius * (s.victim ? 0.9 : 1);
        _p.set(Math.cos(a) * r, Math.sin(a * 0.7 + o.bob) * 0.15 + Math.sin(o.tilt) * Math.sin(a) * r * 0.4, Math.sin(a) * r);
        _p.add(_c);
        _q.setFromEuler(_e.set(a * 2, a, o.tilt));
        this.mesh.setMatrixAt(n++, _m.compose(_p, _q, _s));
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  warmup(on, at) {
    if (on) {
      this.mesh.setMatrixAt(0, _m.compose(at, _q.identity(), _s));
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.mesh.count = on ? 1 : 0;
    this.mesh.visible = on;
  }

  clear() {
    this.list.length = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}
