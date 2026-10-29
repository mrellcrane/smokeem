import * as THREE from 'three';
import { DEG } from '../util/math.js';
import { dealDamage } from './damage.js';

// Trigger handling, hitscan and hit feedback for one shooter. Called from the shooter's tick.

const _o = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export function currentSpread(p) {
  const w = p.weapon;
  const d = w.def;
  let s = d.spreadBase + w.bloom;
  const speed = p.speed();
  if (speed > 1.5) s += d.spreadMoveAdd * Math.min(1, speed / 7);
  if (p.mode === 'move' && !p.grounded) s += d.spreadAirAdd;
  if (p.aimZoom > 1.05) s *= d.aimSpreadMul;
  if (p.crouched && p.grounded) s *= d.crouchSpreadMul;
  if (p.mode === 'net' || p.mode === 'rope' || p.mode === 'bars') s *= d.climbSpreadMul;
  return s;
}

// Camera basis from yaw/pitch: forward, right, up.
export function aimBasis(p, f, r, u) {
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  f.set(-sy * cp, sp, -cy * cp);
  r.set(cy, 0, -sy);
  u.crossVectors(r, f);
}

export function updateShooting(game, p, dt, pressed) {
  const w = p.weapon;
  const d = w.def;
  const inp = p.input;
  w.cooldown = Math.max(0, w.cooldown - dt);
  w.bloom = Math.max(0, w.bloom - d.spreadRecovery * dt);
  if (w.reloadT > 0) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) {
      w.reloadT = 0;
      const take = Math.min(d.mag - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
    }
  }

  if (pressed.reload && w.canReload()) startReload(game, p);
  const canFire = p.mode !== 'mantle' && !w.reloading;
  const trigger = d.auto ? inp.held.fire || pressed.fire : pressed.fire;
  if (trigger && canFire) {
    if (w.mag <= 0) {
      if (w.canReload()) startReload(game, p);
      else if (pressed.fire) game.sfx.play('empty');
    } else {
      while (w.cooldown <= 0 && w.mag > 0) {
        fireOne(game, p);
        w.cooldown += 1 / d.fireRate;
      }
    }
  }

  // What's under the crosshair (for the red reticle).
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  const hit = game.castShot(_o, _f, d.range, p.collider);
  p.aimTarget = hit.entity && hit.entity.alive ? hit.entity : null;
}

function startReload(game, p) {
  p.weapon.reloadT = p.weapon.def.reloadTime;
  p.sprintLock = Math.max(p.sprintLock, 0.2);
  game.sfx.play('reload');
}

function fireOne(game, p) {
  const w = p.weapon;
  const d = w.def;
  w.mag--;
  const spread = currentSpread(p) * DEG;
  w.bloom = Math.min(d.spreadMax, w.bloom + d.spreadPerShot);
  p.sprinting = false;
  p.sprintLock = 0.35;

  aimBasis(p, _f, _r, _u);
  // Uniform random point in the spread cone.
  const rr = Math.tan(spread) * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  _d.copy(_f).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();

  p.eyePosition(_o);
  const hit = game.castShot(_o, _d, d.range, p.collider);
  _end.copy(_o).addScaledVector(_d, hit.hit ? hit.distance : d.range);

  // Tracer starts near where the barrel is, so other players see it come from the gun.
  _muzzle.copy(_o).addScaledVector(_f, 0.6).addScaledVector(_r, 0.2).addScaledVector(_u, -0.14);
  game.fx.tracer(_muzzle, _end, d.tracerColor);
  p.viewmodel?.fired();
  game.sfx.play('shot', { rate: 0.94 + Math.random() * 0.12 });

  if (!hit.hit) return;
  if (hit.entity) {
    let dmg = d.damage;
    const t = (hit.distance - d.falloffStart) / (d.falloffEnd - d.falloffStart);
    if (t > 0) dmg *= 1 - Math.min(1, t) * (1 - d.falloffMin);
    if (hit.headshot) dmg *= d.headshotMul;
    const shieldsUp = hit.entity.vitals.shield > 0;
    const res = dealDamage(game, hit.entity, dmg, {
      attacker: p,
      weapon: d,
      headshot: hit.headshot,
      point: hit.point,
      dir: _d,
    });
    game.fx.impactBody(hit.point, hit.normal, shieldsUp);
    if (res) p.onHitConfirmed(res, hit.headshot);
  } else {
    game.fx.impactWorld(hit.point, hit.normal);
  }
}
