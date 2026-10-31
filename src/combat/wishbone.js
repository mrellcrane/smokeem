import * as THREE from 'three';
import { dealDamage } from './damage.js';
import { bladeGeometry } from './weaponModels.js';

// The Wishbone's flying blades (game.blades, built only in a set with the Wishbone). A thrown
// blade flies out along the aim, slowing over `outTime` until it turns, then homes back to its
// thrower's chest and is caught (the gun's one round comes back). On the way it cuts anyone it
// passes within `reach` of, once each way. Hitting a wall turns it around early; on the way
// back it slips past walls (it always finds its way home), and after `maxTime` it's back in hand
// regardless. Smoked, the thrower loses it until their next life. One instanced mesh, spinning
// flat.

const MAX_BLADES = 8;
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1.6, 1.6, 1.6);
const _e = new THREE.Euler();

export class Blades {
  constructor(game, material) {
    this.game = game;
    this.list = [];
    this.mesh = new THREE.InstancedMesh(bladeGeometry(), material, MAX_BLADES);
    this.mesh.name = 'blades';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    game.scene.add(this.mesh);
  }

  // A throw from `origin` along `dir` by `owner`, whose WeaponState `w` gets its round back on
  // the catch.
  throw(owner, w, origin, dir) {
    if (this.list.length >= MAX_BLADES) this.list.shift();
    const d = w.def;
    this.list.push({
      owner,
      w,
      def: d,
      pos: origin.clone(),
      prev: origin.clone(),
      vel: dir.clone().multiplyScalar(d.speed),
      age: 0,
      back: false,
      // Who it's cut on this leg.
      cut: new Set(),
      tilt: 0.25 + Math.random() * 0.2,
      whirT: 0,
    });
  }

  tick(dt) {
    const game = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const d = b.def;
      const o = b.owner;
      b.prev.copy(b.pos);
      b.age += dt;
      if (!o.alive) {
        this.list.splice(i, 1);
        continue;
      }
      if (!b.back) {
        // Slowing toward the turn.
        const k = Math.max(0, 1 - b.age / d.outTime);
        if (k <= 0.05) this.turn(b);
        else b.vel.setLength(d.speed * (0.35 + 0.65 * k));
      } else {
        // Home to the thrower's chest, a little faster the longer it's been out.
        o.centerPosition(_c);
        _c.y += 0.2;
        _d.subVectors(_c, b.pos);
        const dist = _d.length();
        if (dist < 1.1 || b.age > d.maxTime) {
          this.catch(b);
          this.list.splice(i, 1);
          continue;
        }
        const speed = d.back * (1 + Math.min(1, (b.age - d.outTime) * 0.6));
        b.vel.lerp(_d.divideScalar(dist).multiplyScalar(speed), Math.min(1, dt * 8));
      }
      const step = b.vel.length() * dt;
      _d.copy(b.vel).normalize();
      if (!b.back) {
        // A wall ahead turns it around (bodies are cut below, not stopped at).
        const hit = game.castShot(b.pos, _d, step + 0.15, o.collider);
        if (hit.hit && !hit.entity) {
          b.pos.addScaledVector(_d, Math.max(0, hit.distance - 0.15));
          game.fx.impactWorld(hit.point, hit.normal, 'metal');
          game.sfx.play('clink', { at: hit.point, rate: 0.7, volume: 1.2 });
          b.vel.reflect(hit.normal);
          this.turn(b);
          continue;
        }
      }
      b.pos.addScaledVector(_d, step);
      this.cut(b);
      // A whir every so often while it flies, and a faint glow trail.
      if ((b.whirT -= dt) <= 0) {
        b.whirT = 0.22;
        game.sfx.play('swing', { at: b.pos, rate: 1.3, volume: 0.5 });
      }
      game.fx.glow(b.pos, 0xffa040, 0.25, true);
    }
  }

  turn(b) {
    b.back = true;
    b.cut.clear();
  }

  catch(b) {
    b.w.mag = 1;
    if (!b.owner.isBot) this.game.sfx.play('clink', { at: b.owner.center, source: b.owner, rate: 1.2 });
  }

  // Cut anyone this step passed close to (players, dummies and vehicles), once a leg.
  cut(b) {
    const game = this.game;
    const d = b.def;
    const targets = game.dummies.length ? [...game.players, ...game.dummies] : game.players;
    for (const t of targets) {
      if (t === b.owner || !t.alive || b.cut.has(t)) continue;
      t.centerPosition(_c);
      // Nearest point of the step to the target's middle line (a capsule).
      const half = (t.halfHeight ?? 0.5) + 0.2;
      const near = closestOnSegment(b.prev, b.pos, _c);
      const dy = Math.max(0, Math.abs(near.y - _c.y) - half);
      const dx = near.x - _c.x;
      const dz = near.z - _c.z;
      const r = (t.radius ?? 0.4) + d.reach;
      if (dx * dx + dz * dz + dy * dy > r * r) continue;
      b.cut.add(t);
      _d.copy(b.vel).normalize();
      const res = dealDamage(game, t, d.damage, { attacker: b.owner, weapon: d, point: near, dir: _d });
      game.fx.impactBody(near, _d.clone().negate(), t.vitals?.shield > 0);
      game.sfx.play('bash', { at: near, rate: 1.3 });
      if (res && b.owner.alive) b.owner.onHitConfirmed?.(res, false);
    }
    if (game.vehicles) {
      for (const v of game.vehicles.bikes) {
        if (!v.alive || b.cut.has(v) || v === b.owner.vehicle) continue;
        v.centerPosition(_c);
        if (closestOnSegment(b.prev, b.pos, _c).distanceTo(_c) > 1.1) continue;
        b.cut.add(v);
        _d.copy(b.vel).normalize();
        const res = dealDamage(game, v, d.damage, { attacker: b.owner, weapon: d, point: _c, dir: _d });
        game.fx.impactWorld(_c, _d.clone().negate(), 'metal');
        if (res && b.owner.alive) b.owner.onHitConfirmed?.(res, false);
      }
    }
  }

  updateVisuals(alpha, time) {
    let n = 0;
    for (const b of this.list) {
      _c.lerpVectors(b.prev, b.pos, alpha);
      // Spinning flat, tipped a little.
      _q.setFromEuler(_e.set(b.tilt, time * 24 + b.tilt * 10, 0, 'XYZ'));
      this.mesh.setMatrixAt(n++, _m.compose(_c, _q, _s));
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  // The blade a player has out, if any (the HUD and the viewmodel ask).
  out(p) {
    return this.list.some((b) => b.owner === p);
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
    this.mesh.removeFromParent();
  }
}

const _seg = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _near = new THREE.Vector3();
function closestOnSegment(a, b, p) {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  const t = len2 > 0 ? Math.max(0, Math.min(1, _rel.copy(p).sub(a).dot(_seg) / len2)) : 0;
  return _near.copy(a).addScaledVector(_seg, t);
}
