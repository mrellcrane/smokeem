import * as THREE from 'three';
import { aimBasis } from './shooting.js';
import { dealDamage } from './damage.js';

// The Gravity Gun's grab, hold, throw and punt (its stats are guns/gravityGun.js). Holdable: the
// loose props (world/props.js) and anything in Grenades (briquettes, Chimney coals, sticky bombs,
// which come off whatever they're stuck to). Grabbing something makes you its owner, so what it
// does when thrown counts as yours.

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _o = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hold = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Gravity {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    // Per player: what they hold ({ kind: 'prop' | 'grenade', obj }).
    this.held = new Map();
  }

  holding(p) {
    return this.held.get(p) ?? null;
  }

  // Everything a gravity gun could pick up, with its position and body.
  *candidates() {
    const g = this.game;
    if (g.props) for (const p of g.props.list) if (p.alive && !p.heldBy) yield ['prop', p];
    for (const n of g.grenades.list) if (!n.heldBy) yield ['grenade', n];
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
    for (const [kind, obj] of this.candidates()) {
      _to.subVectors(obj.pos, _o);
      const dist = _to.length();
      if (dist > d.range || dist < 0.2) continue;
      const c = _to.dot(_f) / dist;
      if (c < cos) continue;
      if (this.game.lineBlocked(_o, obj.pos)) continue;
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
    for (const [kind, obj] of this.candidates()) {
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
  tick() {
    for (const [p, h] of this.held) {
      const obj = h.obj;
      const gone = h.kind === 'prop' ? !obj.alive : !this.game.grenades.list.includes(obj);
      if (gone || !p.alive || p.weapon.def.kind !== 'gravity' || p.guiding) {
        this.release(p, false);
        continue;
      }
      aimBasis(p, _f, _r, _u);
      p.eyePosition(_hold).addScaledVector(_f, this.def.holdDistance + (h.kind === 'prop' ? this.game.props.reach(obj) : 0));
      _d.subVectors(_hold, obj.pos).multiplyScalar(14);
      // (Plus the holder's own motion, so it keeps up when you run.)
      _d.addScaledVector(p.vel, 1);
      obj.body.setLinvel({ x: _d.x, y: _d.y, z: _d.z }, true);
      obj.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  clear() {
    for (const p of [...this.held.keys()]) this.release(p, false);
  }
}
