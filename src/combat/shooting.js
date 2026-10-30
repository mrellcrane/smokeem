import * as THREE from 'three';
import { LOW_BLOW } from '../modes/oysters.js';
import { DEG } from '../util/math.js';
import { dealDamage } from './damage.js';
import { GRENADE, MELEE, SWITCH_TIME, BLOOM_DELAY } from './weapons.js';
import { SWARM } from './swarms.js';
import { GUNS } from './guns/index.js';
import { gfx } from '../render/gfx.js';
import { AIM, SIZE } from '../config.js';
import { assists, assistTarget, magnetize } from './aimAssist.js';
import { PORTAL_COLORS } from './portals.js';

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
const _col = new THREE.Color();
const _hot = new THREE.Color();
const _m3 = new THREE.Vector3();

// Third-person muzzle flashes: at most one per shooter this often (s), so bots' fast guns
// don't flood the sparks pool.
const FLASH_EVERY = 0.05;

// The flash other players see at our third-person gun (we see our first-person one).
function muzzleFlash(game, p, dir) {
  if (!gfx.thirdPersonFlashes || game.time - p.flashT < FLASH_EVERY) return;
  p.flashT = game.time;
  const view = GUNS[p.weapon.def.id].view;
  game.fx.muzzleFlash(p.worldMuzzle(_m3), dir, view.flashColor ?? 0xffc070, 0.3 * view.flash, p.id);
}

// Pellet hits are summed per target so one shotgun blast is one damage event.
const pelletHits = new Map();
// A shot's legs through portals (Portals.trace): [start, end] pairs.
const legs = Array.from({ length: 4 }, () => [new THREE.Vector3(), new THREE.Vector3()]);
legs.count = 0;

export function currentSpread(p) {
  const w = p.weapon;
  const d = w.def;
  let s = d.spreadBase + w.bloom;
  const speed = p.speed();
  if (speed > 1.5) s += d.spreadMoveAdd * Math.min(1, speed / 7);
  if (p.mode === 'move' && !p.grounded) s += d.spreadAirAdd;
  if (p.aimZoom > 1.05) s *= d.aimSpreadMul;
  // A slide aims like moving, not like crouching.
  if (p.crouched && p.grounded && !p.sliding) s *= d.crouchSpreadMul;
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
  // A cooldown that runs out mid-tick keeps the leftover (below 0), so a held trigger fires
  // at the gun's real rate instead of rounding up to whole ticks; a gun already ready sits at 0.
  for (const w of p.slots) if (w) w.cooldown = w.cooldown > 0 ? w.cooldown - dt : 0;

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
    cancelReload(game, p.weapon);
    // Putting a spin-up gun away lets its barrels stop.
    if (p.weapon.def.spinUp) {
      p.weapon.spin = 0;
      game.sfx.stop(p.weapon.spinSfx);
      p.weapon.spinSfx = null;
    }
    p.slot = want;
    p.switchT = p.weapon.def.switchTime ?? SWITCH_TIME;
    game.sfx.play('swap', { at: p.center, source: p });
  }
  if (p.switchT > 0) p.switchT = Math.max(0, p.switchT - dt);

  const w = p.weapon;
  const d = w.def;
  // Spread recovers only once you stop firing for a moment, so a long spray really blooms.
  if (game.time - w.lastShotT > (d.bloomDelay ?? BLOOM_DELAY)) w.bloom = Math.max(0, w.bloom - d.spreadRecovery * dt);
  tickReload(game, p, w, dt, inp.held.fire);

  const busy = p.mode === 'mantle' || p.switchT > 0;
  if (pressed.melee && !busy && p.meleeT <= 0) melee(game, p);
  if (pressed.grenade && !busy && p.throwT <= 0 && p.grenades > 0) throwGrenade(game, p);
  if (pressed.reload && w.canReload()) startReload(game, p);
  // Guns whose aim button acts: the Stickybomb Launcher sets off your stickies, the Gravity Gun
  // grabs or drops, the Shrink Wrap fires its grow ray, the Portal Gun opens the orange portal.
  if (pressed.aim && !busy) {
    if (d.detonateOnAim) game.grenades.detonateStickies(p);
    else if (d.kind === 'gravity') game.gravity?.toggle(p);
    else if ((d.kind === 'size' || d.kind === 'portal') && w.cooldown <= 0 && w.mag > 0 && p.meleeT < MELEE.cooldown - 0.25) {
      fire(game, p, true);
      w.cooldown += 1 / d.fireRate;
    }
  }

  // Holding the trigger repeats every gun at its own rate (semi-autos too, so nobody has to
  // mash); the cooldown is what limits the rate. The missile needs a fresh pull, so a trigger
  // held through an auto-swap never launches it by surprise.
  let trigger = d.kind === 'missile' ? pressed.fire : inp.held.fire || pressed.fire;
  // Spin-up guns only fire once the barrels turn. An empty one just winds down, so a pull still
  // reloads it like any other gun.
  if (d.spinUp && w.mag > 0) trigger = spinBarrels(game, p, w, dt, trigger && !busy && !w.reloading) && trigger;
  else if (d.spinUp) spinBarrels(game, p, w, dt, false);
  // Shotguns fire straight out of a shell-by-shell reload.
  if (trigger && w.reloading && d.reloadPerShell && w.mag > 0) cancelReload(game, w);
  if (trigger && !busy && !w.reloading && p.meleeT < MELEE.cooldown - 0.25) {
    if (w.mag <= 0) {
      if (w.canReload()) startReload(game, p);
      else if (pressed.fire && !p.isBot) game.sfx.play('empty');
    } else {
      while (w.cooldown <= 0 && w.mag > 0) {
        fire(game, p);
        w.cooldown += 1 / d.fireRate;
        if (!d.auto || p.guiding) break;
      }
    }
  }

  // What's under the crosshair (for the red reticle), and for a controller whether someone is
  // near it (the wider aim slowdown).
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  const hit = game.castShot(_o, _f, 150, p.collider);
  p.aimTarget = hit.entity && hit.entity.alive ? hit.entity : null;
  p.aimNear = assists(p) && !p.aimTarget ? assistTarget(game, p, _o, _f, p.weapon.def.range ?? 60, AIM.nearCones, _c) : null;
}

function tickReload(game, p, w, dt, firing) {
  if (w.reloadT <= 0) return;
  w.reloadT -= dt;
  if (w.reloadT > 0) return;
  w.reloadT = 0;
  const d = w.def;
  if (d.reloadPerShell) {
    w.mag++;
    w.reserve--;
    // Start the next shell (each shell's sound plays as it goes in).
    if (w.mag < d.mag && w.reserve > 0 && !firing) {
      w.reloadT = d.reloadTime;
      w.reloadSfx = game.sfx.play('shell', { at: p.center, source: p });
    }
  } else {
    const take = Math.min(d.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }
}

// Spin-up guns: the barrels wind up while the trigger is held (no ammo used) and wind down
// when it's released; pulling again mid spin-down only needs the windup that's left.
// Returns true once spun up.
function spinBarrels(game, p, w, dt, want) {
  const d = w.def;
  const before = w.spin;
  w.spin = want ? Math.min(1, w.spin + dt / d.spinUp) : Math.max(0, w.spin - dt / d.spinDown);
  if (want && before < 1 && w.spinSfx?.name !== 'spinUp') {
    game.sfx.stop(w.spinSfx);
    w.spinSfx = game.sfx.play('spinUp', { at: p.center, source: p });
  } else if (!want && before > 0 && w.spinSfx?.name !== 'spinDown') {
    game.sfx.stop(w.spinSfx);
    w.spinSfx = game.sfx.play('spinDown', { at: p.center, source: p, rate: 0.6 + 0.4 * before });
  }
  return w.spin >= 1;
}

function startReload(game, p) {
  const w = p.weapon;
  w.reloadT = w.def.reloadTime;
  p.sprintLock = Math.max(p.sprintLock, 0.2);
  const sound = w.def.reloadSound ?? (w.def.reloadPerShell ? 'shell' : 'reload');
  w.reloadSfx = game.sfx.play(sound, { at: p.center, source: p, rate: w.def.reloadRate ?? 1 });
}

// Stop a reload part way (switching guns, getting smoked), sound included.
export function cancelReload(game, w) {
  if (!w || w.reloadT <= 0) return;
  w.reloadT = 0;
  game.sfx.stop(w.reloadSfx);
  w.reloadSfx = null;
}

// alt: the aim button's shot (the Shrink Wrap's grow ray, the Portal Gun's orange portal).
function fire(game, p, alt = false) {
  const w = p.weapon;
  const d = w.def;
  w.mag--;
  w.shots++;
  w.lastShotT = game.time;
  p.pose.shots++;
  p.sprinting = false;
  p.model.endSprint();
  p.sprintLock = d.sprintLock ?? 0.35;
  p.viewmodel?.fired();
  if (d.kind === 'beam') return fireBeam(game, p);
  if (d.kind === 'gravity') return game.gravity?.fire(p);
  if (d.kind === 'size') return fireSize(game, p, alt);
  if (d.kind === 'portal') return firePortal(game, p, alt ? 1 : 0);
  // Fast guns can play their sound every so often instead of on every round.
  if (!d.soundEvery || game.time - w.lastSoundT >= d.soundEvery) {
    game.sfx.play(d.sound, { rate: (d.soundRate ?? 1) * (0.97 + Math.random() * 0.06), at: p.center, source: p });
    w.lastSoundT = game.time;
  }
  if (d.pump) game.sfx.play('pump', { delay: 0.18, at: p.center, source: p });
  game.noise(p, 30);

  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  muzzleFlash(game, p, _f);

  if (d.kind === 'launcher') {
    // Out of the muzzle along the aim, with a little lift and half your own velocity.
    _muzzle.copy(_o).addScaledVector(_f, 0.55).addScaledVector(_r, 0.16).addScaledVector(_u, -0.1);
    _d.copy(_f).multiplyScalar(d.launchSpeed).addScaledVector(p.vel, 0.5);
    _d.y += d.launchUp ?? 0;
    game.grenades.throw(p, _muzzle, _d, d.projectile, d);
    return;
  }

  if (d.kind === 'bolt') {
    // Lobbed the same way, but it flies as a bolt (no physics body) and breaks on contact.
    _muzzle.copy(_o).addScaledVector(_f, 0.55).addScaledVector(_r, 0.16).addScaledVector(_u, -0.05);
    // Facing a wall: launch from just in front of it, never from inside it.
    _c.subVectors(_muzzle, _o);
    const reach = _c.length();
    _c.divideScalar(reach);
    const block = game.castShot(_o, _c, reach, p.collider);
    if (block.hit && !block.entity) _muzzle.copy(_o).addScaledVector(_c, Math.max(0, block.distance - 0.05));
    _d.copy(_f).multiplyScalar(d.launchSpeed).addScaledVector(p.vel, 0.5);
    _d.y += d.launchUp ?? 0;
    game.bolts.fire(p, _muzzle, _d, d.projectile, d);
    game.sfx.play('clink', { at: p.center, source: p, delay: 0.04 });
    return;
  }

  if (d.kind === 'missile') {
    _muzzle.copy(_o).addScaledVector(_f, 0.7).addScaledVector(_r, 0.22).addScaledVector(_u, 0.02);
    p.guiding = game.missiles.launch(p, _muzzle, p.yaw, p.pitch, d);
    p.aimZoom = 1;
    return;
  }

  // Controllers: a near miss bends onto the body (spread still applies after).
  if (assists(p)) magnetize(game, p, _o, _f, _r, _u, d.range, d.magnetism ?? 1);
  const spread = currentSpread(p) * DEG;
  w.bloom = Math.min(d.spreadMax, w.bloom + d.spreadPerShot);
  // Tracers start near the first-person barrel in our own view, and at our third-person gun
  // in everyone else's.
  _muzzle.copy(_o).addScaledVector(_f, 0.6).addScaledVector(_r, 0.2).addScaledVector(_u, -0.14);
  p.worldMuzzle(_m3);
  const rays = d.pellets ?? 1;
  pelletHits.clear();
  for (let i = 0; i < rays; i++) {
    // Uniform random point in the spread cone.
    const rr = Math.tan(spread) * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    _d.copy(_f).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
    // Through any portals in the way (each leg cast from where the last came out).
    const hit = game.portals ? game.portals.trace(_o, _d, d.range, p.collider, legs) : game.castShot(_o, _d, d.range, p.collider);
    if (!game.portals) legs.count = 0;
    _end.copy(_o).addScaledVector(_d, hit.hit ? hit.distance : d.range);
    if (legs.count) _end.copy(legs[0][1]);
    // Bugs in the line of fire get hit too (the round carries on).
    if (game.swarms.count) game.swarms.shot(_o, _d, legs.count ? legs[0][0].distanceTo(legs[0][1]) : hit.hit ? hit.distance : d.range, d.damage, p);
    // Fast guns draw a tracer on every few rounds (always the first) so several of them never
    // flood the pool.
    if (rays === 1 ? (w.shots - 1) % (d.tracerEvery ?? 1) === 0 : i % 2 === 0) {
      game.fx.tracer(_muzzle, _end, d.tracerColor, d.tracerWidth, { a3: _m3, owner: p.id, linger: d.tracerLife });
      game.replay?.shot(p, _muzzle, _end, d.tracerColor, d.tracerWidth, d.tracerLife);
      for (let k = 1; k < legs.count; k++) {
        game.fx.tracer(legs[k][0], legs[k][1], d.tracerColor, d.tracerWidth, { linger: d.tracerLife });
        game.replay?.shot(p, legs[k][0], legs[k][1], d.tracerColor, d.tracerWidth, d.tracerLife);
      }
    }
    if (!hit.hit) continue;
    if (hit.entity) {
      let dmg = d.damage;
      const t = (hit.distance - d.falloffStart) / (d.falloffEnd - d.falloffStart);
      if (t > 0) dmg *= 1 - Math.min(1, t) * (1 - d.falloffMin);
      if (hit.headshot) dmg *= d.headshotMul;
      if (hit.lowBlow) dmg *= LOW_BLOW;
      let acc = pelletHits.get(hit.entity);
      if (!acc) {
        acc = { dmg: 0, head: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), shields: hit.entity.vitals.shield > 0 };
        pelletHits.set(hit.entity, acc);
      }
      acc.dmg += dmg;
      acc.head ||= hit.headshot;
      acc.point.copy(hit.point);
      acc.normal.copy(hit.normal);
      // (A Sizzler's hull sparks like metal.)
      if (rays === 1 || i % 3 === 0) {
        if (hit.entity.kind === 'vehicle') game.fx.impactWorld(hit.point, hit.normal, 'metal');
        else game.fx.impactBody(hit.point, hit.normal, acc.shields);
      }
    } else if (rays === 1 || i % 3 === 0) {
      const surface = game.trimFace(hit.point, hit.normal, hit.surface);
      game.fx.impactWorld(hit.point, hit.normal, surface);
      // Marks come at most about 5 a second per gun (every shot of a slow one).
      if ((w.shots - 1) % Math.ceil(d.fireRate / 5) === 0) game.fx.mark(hit.point, hit.normal, surface);
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

// Portal Gun: a bolt of the portal's color, and the portal opens where it hits if there's room
// (otherwise it fizzles).
function firePortal(game, p, which) {
  const d = p.weapon.def;
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  muzzleFlash(game, p, _f);
  game.sfx.play(which ? 'portalShotB' : 'portalShotA', { rate: 0.97 + Math.random() * 0.06, at: p.center, source: p });
  const hit = game.castShot(_o, _f, d.range, p.collider);
  _end.copy(_o).addScaledVector(_f, hit.hit ? hit.distance : d.range);
  _muzzle.copy(_o).addScaledVector(_f, 0.6).addScaledVector(_r, 0.2).addScaledVector(_u, -0.14);
  p.worldMuzzle(_m3);
  const color = PORTAL_COLORS[which];
  game.fx.tracer(_muzzle, _end, color, d.tracerWidth, { a3: _m3, owner: p.id, linger: d.tracerLife });
  game.replay?.shot(p, _muzzle, _end, color, d.tracerWidth, d.tracerLife);
  p.portalColor = which;
  if (game.portals?.place(p, which, hit, _f)) return;
  if (hit.hit) {
    game.fx.impactWorld(hit.point, hit.normal, 'metal');
    game.sfx.play('portalFizzle', { at: hit.point });
  }
}

// Shrink Wrap: one ray that shrinks (or grows) whoever it hits. Shrinking someone big or growing
// someone small puts them back to normal; growing someone already big pops them.
function fireSize(game, p, grow) {
  const w = p.weapon;
  const d = w.def;
  game.sfx.play(grow ? 'growZap' : 'shrinkZap', { rate: 0.97 + Math.random() * 0.06, at: p.center, source: p });
  game.noise(p, 30);
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  muzzleFlash(game, p, _f);
  if (assists(p)) magnetize(game, p, _o, _f, _r, _u, d.range, d.magnetism ?? 1);
  const spread = currentSpread(p) * DEG;
  w.bloom = Math.min(d.spreadMax, w.bloom + d.spreadPerShot);
  const rr = Math.tan(spread) * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  _d.copy(_f).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
  const hit = game.castShot(_o, _d, d.range, p.collider);
  _end.copy(_o).addScaledVector(_d, hit.hit ? hit.distance : d.range);
  _muzzle.copy(_o).addScaledVector(_f, 0.6).addScaledVector(_r, 0.2).addScaledVector(_u, -0.14);
  p.worldMuzzle(_m3);
  const color = grow ? d.growColor : d.tracerColor;
  game.fx.tracer(_muzzle, _end, color, d.tracerWidth, { a3: _m3, owner: p.id, linger: d.tracerLife });
  game.replay?.shot(p, _muzzle, _end, color, d.tracerWidth, d.tracerLife);
  if (!hit.hit) return;
  const t = hit.entity;
  if (!t) {
    game.fx.impactWorld(hit.point, hit.normal, game.trimFace(hit.point, hit.normal, hit.surface));
    return;
  }
  game.fx.impactBody(hit.point, hit.normal, false);
  // Only players change size (training dummies just flinch).
  if (!t.setSize || !t.alive) return;
  if (grow && t.size > 1) {
    game.fx.shieldPop(t.centerPosition(_c));
    const res = dealDamage(game, t, 9999, { attacker: p, weapon: d, cause: 'pop', point: hit.point, dir: _f });
    if (res) p.onHitConfirmed(res, false);
    return;
  }
  const next = grow ? (t.size < 1 ? 1 : SIZE.big) : t.size > 1 ? 1 : SIZE.small;
  if (t.setSize(next, p)) {
    game.sfx.play(grow ? 'growZap' : 'shrinkZap', { at: t.center, rate: grow ? 0.8 : 1.25, volume: 0.7 });
    p.onHitConfirmed({ killed: false }, false);
  }
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
  p.pose.throws++;
  game.sfx.play('throw', { at: p.center, source: p });
}

function melee(game, p) {
  p.meleeT = MELEE.cooldown;
  p.sprinting = false;
  p.viewmodel?.bash();
  p.pose.melees++;
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  // Bugs on you: the swing swats them instead.
  if (game.swarms.count && game.swarms.swat(p, _f)) {
    game.sfx.play('swing', { at: p.center, source: p });
    return;
  }

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
    game.sfx.play('swing', { at: p.center, source: p });
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
  game.sfx.play('bash', { at: p.center, source: p });
  if (res) p.onHitConfirmed(res, false);
}

// The Brander: one exact ray per pulse, heating up while it stays on the same target.
function fireBeam(game, p) {
  const w = p.weapon;
  const d = w.def;
  const now = game.time;
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_o);
  _muzzle.copy(_o).addScaledVector(_f, 0.6).addScaledVector(_r, 0.2).addScaledVector(_u, -0.12);
  if (assists(p)) magnetize(game, p, _o, _f, _r, _u, d.range, d.magnetism ?? 1);
  const hit = game.castShot(_o, _f, d.range, p.collider);
  const dist = hit.hit ? hit.distance : d.range;
  _end.copy(_o).addScaledVector(_f, dist);

  // Heat is how long we've stayed on this target; slipping off for up to rampGrace keeps it,
  // a longer gap or a different target starts over.
  const kept = now - w.beamHitT <= d.rampGrace;
  if (hit.entity) {
    // Only time on the target heats it; a short slip just holds the heat.
    if (hit.entity === w.beamTarget && kept) w.beamHeat += Math.min(now - w.beamHitT, 1 / d.fireRate);
    else w.beamHeat = 0;
    w.beamTarget = hit.entity;
    w.beamHitT = now;
  } else if (!kept) {
    w.beamTarget = null;
    w.beamHeat = 0;
  }
  const dps = Math.min(d.rampMax, d.rampStart + d.rampRate * w.beamHeat);
  const glow = (dps - d.rampStart) / (d.rampMax - d.rampStart);
  _col.set(d.beamColor).lerp(_hot.set(d.beamHot), glow);
  // A small glow at the gun every third pulse; the beam starts there in other players' views.
  if (w.shots % 3 === 0) muzzleFlash(game, p, _f);
  game.fx.beam(_muzzle, _end, _col, d.beamWidth * (1 + glow * 0.5), { a3: p.worldMuzzle(_m3), owner: p.id });

  if (game.swarms.count) game.swarms.shot(_o, _f, dist, SWARM.hp / (SWARM.beamKillTime * d.fireRate), p);

  // A sizzle every so often, pitched up in three steps as it heats.
  if (now - w.lastSoundT >= d.soundEvery) {
    game.sfx.play(d.sound, { rate: glow < 0.34 ? 1 : glow < 0.67 ? 1.18 : 1.4, at: p.center, source: p });
    w.lastSoundT = now;
    game.noise(p, 30);
  }

  if (!hit.hit) return;
  if (w.shots % 2 === 0) game.fx.burst(hit.point, hit.normal, _col.getHex(), 2, 3, 0.06);
  if (!hit.entity) return;
  const res = dealDamage(game, hit.entity, dps / d.fireRate, { attacker: p, weapon: d, point: hit.point, dir: _f });
  if (!res) return;
  // Twenty pulses a second would bury the hit tick; play it every quarter second (and on kills).
  const tick = res.killed || now - w.hitSoundT >= 0.25;
  if (tick) w.hitSoundT = now;
  p.onHitConfirmed(res, false, tick);
}
