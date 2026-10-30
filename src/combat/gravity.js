import * as THREE from 'three';
import { aimBasis } from './shooting.js';
import { dealDamage } from './damage.js';

// The Gravity Gun's grab, hold, throw and punt (its stats are guns/gravityGun.js). Holdable (owner
// call: everything): the loose props (world/props.js, the map's small crates and drums among
// them), anything in Grenades (briquettes, Chimney coals, sticky bombs, which come off whatever
// they're stuck to), dropped guns, smoked bodies, training dummies, live players (they struggle
// free after HOLD_PLAYER seconds) and Sizzlers (rider and all). Grabbing something makes you its
// owner, so what it does when thrown counts as yours; a thrown body, dummy, gun, player or bike
// hurts the first one it flies into (FLUNG). Each kind is told how to be found, held and thrown
// in KINDS; the ones that move themselves pause while held (their `heldBy`).

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _o = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hold = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
// A held player breaks free after this long (s).
const HOLD_PLAYER = 1.4;
// Thrown things that aren't physics bodies: how long they can hurt, the speed they must be going
// (m/s), the damage, and how far from their middle they hit.
const FLING_TIME = 2;
const FLING_SPEED = 7;
const FLUNG = { item: [30, 0.5], corpse: [45, 0.8], dummy: [55, 0.8], player: [45, 0.8], bike: [90, 1.3] };

// Per kind: where it is (into out), whether it can still be held, how far in front of the eye it
// floats (on top of the gun's hold distance), how it follows the hold point (non-bodies), how
// it's let go with velocity v, and how fast it's going (for a throw's hit).
const KINDS = {
  prop: { at: (o, out) => out.copy(o.pos), ok: (o) => o.alive, reach: (o, g) => g.props.reach(o), body: true },
  grenade: { at: (o, out) => out.copy(o.pos), ok: (o, g) => g.grenades.list.includes(o), reach: () => 0, body: true },
  item: {
    at: (o, out) => out.copy(o.pos).setY(o.pos.y + 0.75),
    ok: (o) => o.active,
    reach: () => 0.2,
    hold: (o, to, k) => o.pos.lerp(_p.copy(to).setY(to.y - 0.75), k),
    let: (o, v) => (o.vel = (o.vel ?? new THREE.Vector3()).copy(v).multiplyScalar(0.7)),
    vel: (o) => o.vel,
  },
  corpse: {
    at: (o, out) => out.copy(o.pos).setY(o.pos.y + 0.6),
    ok: (o) => o.owner.mode === 'dead' && o.owner.model.group.visible,
    reach: () => 0.6,
    hold: (o, to, k) => {
      o.pos.lerp(_p.copy(to).setY(to.y - 0.6), k);
      o.vel.set(0, 0, 0);
      o.air = true;
    },
    let: (o, v) => {
      o.vel.copy(v).multiplyScalar(0.7);
      o.tipV += 3;
    },
    vel: (o) => o.vel,
  },
  dummy: {
    at: (o, out) => o.centerPosition(out),
    ok: (o) => o.alive,
    reach: () => 0.7,
    hold: (o, to, k) => {
      o.feet.lerp(_p.copy(to).setY(to.y - 0.9), k);
      o.placeBody(false);
    },
    let: (o, v) => (o.fly = (o.fly ?? new THREE.Vector3()).copy(v).multiplyScalar(0.6)),
    vel: (o) => o.fly,
  },
  player: {
    at: (o, out) => out.copy(o.center),
    ok: (o) => o.alive && !o.vehicle && o.heldT < HOLD_PLAYER,
    reach: () => 0.9,
    hold: (o, to, k, dt) => {
      o.center.lerp(to, k);
      o.vel.set(0, 0, 0);
      o.body.setNextKinematicTranslation(o.center);
      o.heldT += dt;
    },
    let: (o, v) => {
      o.vel.copy(v).multiplyScalar(0.7);
      o.grounded = false;
      // Ballistic until they land, like a launch pad's throw (no steering it away).
      o.launched = v.lengthSq() > 4;
      o.launchT = 0.3;
    },
    vel: (o) => o.vel,
  },
  bike: {
    at: (o, out) => o.centerPosition(out),
    ok: (o) => o.alive,
    reach: () => 1.6,
    hold: (o, to, k) => {
      o.pos.lerp(_p.copy(to).setY(to.y - 0.6), k);
      o.vel.set(0, 0, 0);
      o.grounded = false;
      o.body.setNextKinematicTranslation(o.pos);
      if (o.rider) o.seat(o.rider);
    },
    let: (o, v) => {
      o.vel.copy(v).multiplyScalar(0.45);
      o.grounded = false;
    },
    vel: (o) => o.vel,
  },
};

export class Gravity {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    // Per player: what they hold ({ kind, obj }; KINDS).
    this.held = new Map();
    // Thrown things that aren't bodies, until they hit someone: { kind, obj, by, t }.
    this.flung = [];
  }

  holding(p) {
    return this.held.get(p) ?? null;
  }

  // Everything a gravity gun could pick up (not `who` themselves), as [kind, obj].
  *candidates(who = null) {
    const g = this.game;
    if (g.props) for (const p of g.props.list) if (p.alive && !p.heldBy) yield ['prop', p];
    for (const n of g.grenades.list) if (!n.heldBy) yield ['grenade', n];
    for (const i of g.pickups.items) if (i.active && !i.spawner && !i.heldBy) yield ['item', i];
    for (const q of g.players) {
      if (q === who) continue;
      if (q.alive) {
        if (!q.vehicle && !q.heldBy && !q.guiding) yield ['player', q];
      } else if (q.corpse && q.model.group.visible && !q.corpse.heldBy) yield ['corpse', q.corpse];
    }
    for (const d of g.dummies) if (d.alive && !d.heldBy) yield ['dummy', d];
    if (g.vehicles) for (const b of g.vehicles.bikes) if (b.alive && !b.heldBy) yield ['bike', b];
  }

  // The aim button: drop what you hold, or grab the nearest thing near the aim.
  toggle(p) {
    if (this.held.has(p)) {
      this.release(p, false);
      return;
    }
    const best = this.pick(p);
    if (!best) {
      this.game.sfx.play('empty', { at: p.center, source: p });
      return;
    }
    this.take(p, best);
  }

  // The loose thing a grab would take: closest to the crosshair within the grab cone and range,
  // then nearer things; [kind, obj] or null.
  pick(p) {
    const d = this.def;
    aimBasis(p, _f, _r, _u);
    p.eyePosition(_o);
    const cos = Math.cos((d.grabCone * Math.PI) / 180);
    let best = null;
    let bestScore = -Infinity;
    for (const [kind, obj] of this.candidates(p)) {
      KINDS[kind].at(obj, _v);
      _to.subVectors(_v, _o);
      const dist = _to.length();
      if (dist > d.range || dist < 0.2) continue;
      const c = _to.dot(_f) / dist;
      if (c < cos) continue;
      // In sight: the near side of it (a bike's own collision ball would block its middle).
      _p.copy(_v).addScaledVector(_to, -Math.min(dist - 0.2, KINDS[kind].reach(obj, this.game) * 0.8) / dist);
      if (this.game.lineBlocked(_o, _p)) continue;
      const score = c * 4 - dist / d.range;
      if (score > bestScore) {
        bestScore = score;
        best = [kind, obj];
      }
    }
    return best;
  }

  take(p, [kind, obj]) {
    if (kind === 'grenade') {
      this.game.grenades.unstick(obj);
      obj.owner = p;
    }
    obj.heldBy = p;
    if (kind === 'player') obj.heldT = 0;
    this.held.set(p, { kind, obj });
    this.game.sfx.play('grab', { at: p.center, source: p });
  }

  // Someone alive close in front, inside the punt's reach and cone.
  someoneToPunt(p) {
    const d = this.def;
    aimBasis(p, _f, _r, _u);
    p.eyePosition(_o);
    const cos = Math.cos((d.puntCone * Math.PI) / 180);
    for (const e of this.game.entities.values()) {
      if (e === p || !e.alive) continue;
      e.centerPosition(_to).sub(_o);
      const dist = _to.length();
      if (dist <= d.puntRange && _to.dot(_f) / dist >= cos) return true;
    }
    return false;
  }

  // Let go: thrown along the aim, or just dropped.
  release(p, thrown) {
    const h = this.held.get(p);
    if (!h) return;
    this.held.delete(p);
    const obj = h.obj;
    obj.heldBy = null;
    const K = KINDS[h.kind];
    if (!K.body) {
      if (!K.ok(obj, this.game) && !(h.kind === 'player' && obj.alive)) return;
      aimBasis(p, _f, _r, _u);
      _d.copy(_f).multiplyScalar(thrown ? this.def.throwSpeed : 0).addScaledVector(p.vel, 0.3);
      // (Thrown, a little lift, so a heavy thing carries to what you aimed at.)
      if (thrown) _d.y += 4;
      K.let(obj, _d);
      if (thrown) this.flung.push({ kind: h.kind, obj, by: p, t: this.game.time });
      return;
    }
    if (!obj.body || (h.kind === 'prop' && !obj.alive) || (h.kind === 'grenade' && !this.game.grenades.list.includes(obj))) return;
    if (thrown) {
      aimBasis(p, _f, _r, _u);
      _d.copy(_f).multiplyScalar(this.def.throwSpeed).addScaledVector(p.vel, 0.3);
      obj.body.setLinvel({ x: _d.x, y: _d.y, z: _d.z }, true);
      obj.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
      if (h.kind === 'prop') {
        obj.thrownBy = p;
        obj.thrownT = this.game.time;
      }
    }
  }

  // The trigger: throw what you hold; with nothing held, grab what's under the crosshair (the aim
  // button grabs too, Half-Life 2's way), or punt whoever is right in front.
  fire(p) {
    if (this.held.has(p)) {
      this.release(p, true);
      this.game.sfx.play('punt', { at: p.center, source: p });
      return;
    }
    if (!this.someoneToPunt(p)) {
      const best = this.pick(p);
      if (best) {
        this.take(p, best);
        return;
      }
    }
    const d = this.def;
    aimBasis(p, _f, _r, _u);
    p.eyePosition(_o);
    const cos = Math.cos((d.puntCone * Math.PI) / 180);
    this.game.sfx.play('punt', { at: p.center, source: p, rate: 1.15 });
    // People in front get shoved and stung.
    for (const e of this.game.entities.values()) {
      if (e === p || !e.alive) continue;
      e.centerPosition(_to).sub(_o);
      const dist = _to.length();
      if (dist > d.puntRange || _to.dot(_f) / dist < cos) continue;
      if (this.game.lineBlocked(_o, e.centerPosition(_hold))) continue;
      if (e.knockback) e.knockback(_d.copy(_f).setY(Math.max(0.35, _f.y)).normalize(), d.puntSpeed);
      const res = dealDamage(this.game, e, d.puntDamage, { attacker: p, weapon: d, cause: 'punt', point: _hold, dir: _f });
      if (res) p.onHitConfirmed(res, false);
    }
    // Loose things in front fly off.
    for (const [kind, obj] of this.candidates(p)) {
      if (!KINDS[kind].body) continue;
      _to.subVectors(obj.pos, _o);
      const dist = _to.length();
      if (dist > d.puntRange || _to.dot(_f) / dist < cos) continue;
      if (kind === 'grenade') {
        this.game.grenades.unstick(obj);
        obj.owner = p;
      } else {
        obj.thrownBy = p;
        obj.thrownT = this.game.time;
      }
      const m = obj.body.mass();
      obj.body.applyImpulse({ x: _f.x * m * 16, y: (_f.y + 0.3) * m * 16, z: _f.z * m * 16 }, true);
    }
  }

  // Every tick: held things float in front of their holder; the holder letting go of the gun
  // (switching, dying) drops them.
  tick(dt = 1 / 60) {
    for (const [p, h] of this.held) {
      const obj = h.obj;
      const K = KINDS[h.kind];
      if (!K.ok(obj, this.game) || !p.alive || p.weapon.def.kind !== 'gravity' || p.guiding) {
        this.release(p, false);
        continue;
      }
      aimBasis(p, _f, _r, _u);
      p.eyePosition(_hold).addScaledVector(_f, this.def.holdDistance + K.reach(obj, this.game));
      if (!K.body) {
        K.hold(obj, _hold, Math.min(1, dt * 18), dt);
        continue;
      }
      _d.subVectors(_hold, obj.pos).multiplyScalar(14);
      // (Plus the holder's own motion, so it keeps up when you run.)
      _d.addScaledVector(p.vel, 1);
      obj.body.setLinvel({ x: _d.x, y: _d.y, z: _d.z }, true);
      obj.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // Thrown bodies, dummies, guns, players and bikes hurt the first one they fly into.
  flying() {
    const g = this.game;
    for (let i = this.flung.length - 1; i >= 0; i--) {
      const f = this.flung[i];
      const K = KINDS[f.kind];
      const v = K.vel(f.obj);
      if (g.time - f.t > FLING_TIME || f.obj.heldBy) {
        this.flung.splice(i, 1);
        continue;
      }
      // Still hot while it's fast, and for a moment after (running into someone stops it dead
      // before this sees it).
      if (v && v.length() >= FLING_SPEED) {
        f.hotT = g.time;
        f.dir = (f.dir ?? new THREE.Vector3()).copy(v).normalize();
      }
      if (!f.dir || g.time - f.hotT > 0.15) continue;
      K.at(f.obj, _v);
      const [dmg, reach] = FLUNG[f.kind];
      for (const e of g.entities.values()) {
        if (!e.alive || e === f.obj || e === f.obj.rider || (e === f.by && g.time - f.t < 0.4)) continue;
        if (e.distanceToBody(_v) > reach + 0.4) continue;
        const info = { attacker: f.by, weapon: this.def, cause: 'prop', point: _v };
        if (e.knockback) e.knockback(_d.copy(f.dir).setY(0.3).normalize(), 6);
        const res = dealDamage(g, e, dmg, info);
        if (res) f.by.onHitConfirmed(res, false);
        // A thrown person takes it too.
        if (f.kind === 'player' && f.obj.alive) dealDamage(g, f.obj, dmg * 0.6, info);
        g.sfx.play('smash', { at: _v, volume: 0.8 });
        this.flung.splice(i, 1);
        break;
      }
    }
  }

  clear() {
    for (const p of [...this.held.keys()]) this.release(p, false);
    this.flung.length = 0;
  }
}
