import * as THREE from 'three';
import { DEG } from '../util/math.js';
import { dealDamage } from './damage.js';
import { GRENADE, MELEE, SWITCH_TIME } from './weapons.js';

// Everything a player does with their hands, run from the player's fixed tick: trigger,
// reload, weapon switching, grenades, melee, launching and detonating the Smoke Signal.

const _o = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _c = new THREE.Vector3();
const _vf = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _n = new THREE.Vector3();

// Pellet hits are summed per target so one shotgun blast is one damage event.
const pelletHits = new Map();

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
  const inp = p.input;
  p.meleeT = Math.max(0, p.meleeT - dt);
  p.throwT = Math.max(0, p.throwT - dt);
  for (const w of p.slots) if (w) w.cooldown = Math.max(0, w.cooldown - dt);

  // Flying a missile: the trigger blows it up early; nothing else works meanwhile.
  if (p.guiding) {
    if (pressed.fire) p.guiding.detonate();
    p.aimTarget = null;
    return;
  }

  // Switching weapons. An empty gun swaps itself out.
  let want = -1;
  const other = p.slots[1 - p.slot];
  if (p.weapon.empty && other && !other.empty && p.switchT <= 0) want = 1 - p.slot;
  if (pressed.switchWeapon && p.slots[1 - p.slot]) want = 1 - p.slot;
  if (pressed.slot1 && p.slot !== 0 && p.slots[0]) want = 0;
  if (pressed.slot2 && p.slot !== 1 && p.slots[1]) want = 1;
  if (want >= 0) {
    p.weapon.reloadT = 0;
    p.slot = want;
    p.switchT = SWITCH_TIME;
    game.sfx.play('swap');
  }
  if (p.switchT > 0) p.switchT = Math.max(0, p.switchT - dt);

  const w = p.weapon;
  const d = w.def;
  w.bloom = Math.max(0, w.bloom - d.spreadRecovery * dt);
  tickReload(game, w, dt, inp.held.fire);

  const busy = p.mode === 'mantle' || p.switchT > 0;
  if (pressed.melee && !busy && p.meleeT <= 0) melee(game, p);
  if (pressed.grenade && !busy && p.throwT <= 0 && p.grenades > 0) throwGrenade(game, p);
  if (pressed.reload && w.canReload()) startReload(game, p);

  const trigger = d.auto ? inp.held.fire || pressed.fire : pressed.fire;
  // Shotguns fire straight out of a shell-by-shell reload.
  if (trigger && w.reloading && d.reloadPerShell && w.mag > 0) w.reloadT = 0;
  if (trigger && !busy && !w.reloading && p.meleeT < MELEE.cooldown - 0.25) {
    if (w.mag <= 0) {
      if (w.canReload()) startReload(game, p);
      else if (pressed.fire) game.sfx.play('empty');
    } else {
      while (w.cooldown <= 0 && w.mag > 0) {
        fire(game, p);
        w.cooldown += 1 / d.fireRate;
        if (!d.auto || p.guiding) break;
      }
    }
  }

  // What's under the crosshair (for the red reticle).
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  const hit = game.castShot(_o, _f, 150, p.collider);
  p.aimTarget = hit.entity && hit.entity.alive ? hit.entity : null;
}

function tickReload(game, w, dt, firing) {
  if (w.reloadT <= 0) return;
  w.reloadT -= dt;
  if (w.reloadT > 0) return;
  w.reloadT = 0;
  const d = w.def;
  if (d.reloadPerShell) {
    w.mag++;
    w.reserve--;
    game.sfx.play('shell');
    if (w.mag < d.mag && w.reserve > 0 && !firing) w.reloadT = d.reloadTime;
  } else {
    const take = Math.min(d.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }
}

function startReload(game, p) {
  p.weapon.reloadT = p.weapon.def.reloadTime;
  p.sprintLock = Math.max(p.sprintLock, 0.2);
  game.sfx.play(p.weapon.def.reloadPerShell ? 'shell' : 'reload');
}

function fire(game, p) {
  const w = p.weapon;
  const d = w.def;
  w.mag--;
  p.sprinting = false;
  p.sprintLock = 0.35;
  p.viewmodel?.fired();
  game.sfx.play(d.sound, { rate: 0.94 + Math.random() * 0.12 });
  game.noise(p, 30);

  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);

  if (d.kind === 'missile') {
    _muzzle.copy(_o).addScaledVector(_f, 0.7).addScaledVector(_r, 0.22).addScaledVector(_u, 0.02);
    p.guiding = game.missiles.launch(p, _muzzle, p.yaw, p.pitch, d);
    p.aimZoom = 1;
    return;
  }

  const spread = currentSpread(p) * DEG;
  w.bloom = Math.min(d.spreadMax, w.bloom + d.spreadPerShot);
  // Tracers start near the barrel, so other players see them come from the gun.
  _muzzle.copy(_o).addScaledVector(_f, 0.6).addScaledVector(_r, 0.2).addScaledVector(_u, -0.14);
  const rays = d.pellets ?? 1;
  pelletHits.clear();
  for (let i = 0; i < rays; i++) {
    // Uniform random point in the spread cone.
    const rr = Math.tan(spread) * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    _d.copy(_f).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
    const hit = game.castShot(_o, _d, d.range, p.collider);
    _end.copy(_o).addScaledVector(_d, hit.hit ? hit.distance : d.range);
    if (rays === 1 || i % 2 === 0) game.fx.tracer(_muzzle, _end, d.tracerColor);
    if (!hit.hit) continue;
    if (hit.entity) {
      let dmg = d.damage;
      const t = (hit.distance - d.falloffStart) / (d.falloffEnd - d.falloffStart);
      if (t > 0) dmg *= 1 - Math.min(1, t) * (1 - d.falloffMin);
      if (hit.headshot) dmg *= d.headshotMul;
      let acc = pelletHits.get(hit.entity);
      if (!acc) {
        acc = { dmg: 0, head: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), shields: hit.entity.vitals.shield > 0 };
        pelletHits.set(hit.entity, acc);
      }
      acc.dmg += dmg;
      acc.head ||= hit.headshot;
      acc.point.copy(hit.point);
      acc.normal.copy(hit.normal);
      if (rays === 1 || i % 3 === 0) game.fx.impactBody(hit.point, hit.normal, acc.shields);
    } else if (rays === 1 || i % 3 === 0) {
      game.fx.impactWorld(hit.point, hit.normal);
    }
  }
  for (const [target, acc] of pelletHits) {
    const res = dealDamage(game, target, acc.dmg, {
      attacker: p,
      weapon: d,
      headshot: acc.head,
      point: acc.point,
      dir: _f,
    });
    if (res) p.onHitConfirmed(res, acc.head);
  }
  pelletHits.clear();
}

function throwGrenade(game, p) {
  p.grenades--;
  p.throwT = GRENADE.cooldown;
  p.sprinting = false;
  p.sprintLock = 0.3;
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  _o.addScaledVector(_f, 0.45).addScaledVector(_r, -0.12).addScaledVector(_u, -0.08);
  _d.copy(_f)
    .multiplyScalar(GRENADE.throwSpeed)
    .addScaledVector(_u, GRENADE.throwUp)
    .addScaledVector(p.vel, 0.5);
  game.grenades.throw(p, _o, _d);
  p.viewmodel?.toss();
  game.sfx.play('throw');
}

function melee(game, p) {
  p.meleeT = MELEE.cooldown;
  p.sprinting = false;
  p.viewmodel?.bash();
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);

  // Closest living body roughly in front of us, in reach, not behind a wall.
  let target = null;
  let best = Infinity;
  for (const e of game.entities.values()) {
    if (e === p || !e.alive) continue;
    e.centerPosition(_c);
    _d.subVectors(_c, _o);
    const dist = _d.length();
    if (dist > MELEE.lungeRange + 0.5 || dist >= best) continue;
    _d.divideScalar(dist);
    if (_d.dot(_f) < 0.75) continue;
    if (game.lineBlocked(_o, _c)) continue;
    best = dist;
    target = e;
  }
  if (!target) {
    game.sfx.play('swing');
    return;
  }
  // Lunge into anyone just out of reach.
  if (best > MELEE.range) {
    target.centerPosition(_c);
    _d.subVectors(_c, _o).setY(0).normalize();
    p.startLunge(_d, MELEE.lungeSpeed, MELEE.lungeTime);
  }
  // From behind: they face roughly the same way we're hitting them.
  target.facing(_vf);
  target.centerPosition(_c);
  _d.subVectors(_c, _o).setY(0).normalize();
  const backstab = _vf.dot(_d) > MELEE.backstabDot;
  _pt.copy(_c).addScaledVector(_d, -0.35);
  _n.copy(_d).negate();
  const res = dealDamage(game, target, backstab ? 1e6 : MELEE.damage, {
    attacker: p,
    weapon: MELEE,
    cause: 'melee',
    backstab,
    point: _pt,
    dir: _d,
  });
  game.fx.impactBody(_pt, _n, target.vitals.shield > 0 && !backstab);
  game.sfx.play('bash');
  if (res) p.onHitConfirmed(res, false);
}
