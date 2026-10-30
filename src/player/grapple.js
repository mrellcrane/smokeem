import * as THREE from 'three';
import { GRAPPLE, MOVE } from '../config.js';
import { aimBasis } from '../combat/shooting.js';

// The grapple everyone has (LB / Q). The hook flies out along the aim (a ray cast when it's
// fired, then flown at `hookSpeed` so you see it go), sticks in almost anything (the level,
// nets and ropes, bikes, dummies, people: it follows what it's stuck in) and reels you toward
// it, no gravity, steering a little with the stick. You let go on arriving (a hop up when
// it's a wall or a ledge, so a mantle catches it), with jump (a hop off the line), with
// another press, after `maxPull`, or when something stops you, keeping the speed. A miss
// reels the hook back empty. Player.tickMove asks pull() for the velocity while it's reeling.
//
// state: 'off' (ready once the cooldown's run out), 'out' (flying), 'pull' (stuck, reeling us
// in), 'back' (reeling the empty hook in: looks only).

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _to = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Hook {
  constructor() {
    this.state = 'off';
    // Where the hook is this tick and last tick (for render interpolation).
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    // Fired from and along.
    this.from = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    // Where it sticks, and the surface's normal there.
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    // What it's stuck in (it follows), with the hit's offset from its center (none for players:
    // we're reeled to them).
    this.target = null;
    this.offset = new THREE.Vector3();
    this.hit = false;
    // Stuck in a wall just under a ledge: the ledge top's height (we're reeled up over it).
    this.ledge = false;
    this.ledgeY = 0;
    this.hitDist = 0;
    this.travel = 0;
    // Time reeling, time stopped against something, and until the next shot.
    this.t = 0;
    this.stuckT = 0;
    this.cooldown = 0;
    this.cooldownMax = 1;
    // Since the last shot, for the rope's slack.
    this.age = 0;
  }

  get busy() {
    return this.state === 'out' || this.state === 'pull';
  }

  // Back to ready at once (respawns, deaths, warm-up).
  reset() {
    this.state = 'off';
    this.target = null;
    this.cooldown = 0;
    this.t = this.stuckT = 0;
  }
}

// Fire the hook along the aim. False when it isn't ready.
export function fireHook(game, p) {
  const h = p.hook;
  if (h.state !== 'off' || h.cooldown > 0) return false;
  aimBasis(p, _f, _r, _u);
  p.eyePosition(_eye);
  const r = game.castShot(_eye, _f, GRAPPLE.range, p.collider);
  // (Never the invisible blockers at the map's edges and ceiling.)
  h.hit = r.hit && !game.arena.blockers?.has(r.handle);
  h.hitDist = h.hit ? r.distance : GRAPPLE.range;
  h.point.copy(r.point);
  h.normal.copy(r.normal);
  const e = h.hit && !r.lowBlow ? r.entity : null;
  h.target = e?.centerPosition ? e : null;
  if (h.target) {
    if (h.target.isPlayer) h.offset.set(0, 0, 0);
    else h.offset.copy(r.point).sub(h.target.centerPosition(_to));
  }
  h.from.copy(_eye);
  h.dir.copy(_f);
  h.pos.copy(_eye);
  h.prev.copy(_eye);
  h.travel = 0;
  h.t = h.stuckT = h.age = 0;
  h.state = 'out';
  game.sfx.play('hookFire', { at: _eye, source: p });
  return true;
}

// Let go of the line. pop: a hop up off a wall or ledge; jump: a hop off the line.
export function releaseHook(game, p, { pop = false, jump = false } = {}) {
  const h = p.hook;
  if (!h.busy) return;
  const missed = h.state === 'out';
  h.state = 'back';
  h.target = null;
  h.cooldown = missed ? GRAPPLE.missCooldown : GRAPPLE.cooldown;
  h.cooldownMax = h.cooldown;
  if (missed || p.mode !== 'move') return;
  const v = p.vel;
  if (jump) v.y = Math.max(v.y + GRAPPLE.jumpOff * 0.5, GRAPPLE.jumpOff);
  else if (pop && h.ledge) {
    // Up and over onto the ledge: nothing carrying us back out, a push in over the top.
    v.y = Math.min(Math.max(v.y, GRAPPLE.popUp * 0.7), GRAPPLE.popUp * 1.1);
    const out = v.x * h.normal.x + v.z * h.normal.z;
    v.x += h.normal.x * (-out - GRAPPLE.ledgePush);
    v.z += h.normal.z * (-out - GRAPPLE.ledgePush);
  } else if (pop && h.normal.y < 0.7) v.y = Math.max(v.y, GRAPPLE.popUp);
  p.hookCarryT = GRAPPLE.carry;
  // A fresh double jump for the landing.
  p.airJumpsLeft = Math.max(p.airJumpsLeft, MOVE.airJumps);
}

// Stuck in a wall: is there a floor just over it (a ledge, a deck, a crate's top)? Looked for
// straight down from above the wall's face, a little way in.
function findLedge(game, h) {
  h.ledge = false;
  if (h.target || h.normal.y > 0.7) return;
  _to.copy(h.point).addScaledVector(h.normal, -0.4);
  _to.y += 2.4;
  const top = game.surfaceNear(_to, DOWN, 2.7);
  if (!top || top.normal.y < 0.7 || top.point.y < h.point.y - 0.2) return;
  h.ledge = true;
  h.ledgeY = top.point.y;
}

// Where the hook is stuck right now (following what it's in).
function anchor(h, out) {
  if (!h.target) return out.copy(h.point);
  return h.target.centerPosition(out).add(h.offset);
}

// Once a tick from Player.tick, before the move: fire and let go on presses, fly the hook, and
// drop it when we can't hang on.
export function tickHook(game, p, dt, pressed) {
  const h = p.hook;
  h.age += dt;
  if (h.state === 'off' || h.state === 'back') h.cooldown = Math.max(0, h.cooldown - dt);
  if (pressed.grapple) {
    if (h.busy) releaseHook(game, p);
    else if (p.mode === 'move' && !p.guiding) fireHook(game, p);
  }
  h.prev.copy(h.pos);
  if (h.state === 'out') {
    h.travel += GRAPPLE.hookSpeed * dt;
    if (h.hit && h.target && !h.target.alive) {
      // Smoked before it got there: it flies on through.
      h.hit = false;
      h.target = null;
      h.hitDist = GRAPPLE.range;
    }
    const end = h.hit ? h.hitDist : GRAPPLE.range;
    if (h.travel >= end) {
      if (!h.hit) {
        h.pos.copy(h.from).addScaledVector(h.dir, end);
        releaseHook(game, p);
        return;
      }
      if (h.target) {
        // Where it is now, not where it was when we fired.
        anchor(h, h.point);
      }
      h.pos.copy(h.point);
      h.state = 'pull';
      h.t = 0;
      findLedge(game, h);
      game.sfx.play('hookHit', { at: h.point, source: p });
      game.fx.burst(h.point, h.normal, 0xffb060, 6, 3, 0.035);
    } else {
      h.pos.copy(h.from).addScaledVector(h.dir, h.travel);
    }
  } else if (h.state === 'pull') {
    h.t += dt;
    if (h.target && !h.target.alive) {
      releaseHook(game, p);
      return;
    }
    anchor(h, h.pos);
    if (p.mode !== 'move' || p.heldBy || p.guiding || h.t > GRAPPLE.maxPull) releaseHook(game, p);
  } else if (h.state === 'back') {
    // The empty hook reels back to the hand.
    p.eyePosition(_eye);
    _to.subVectors(_eye, h.pos);
    const d = _to.length();
    const step = GRAPPLE.reelSpeed * dt;
    if (d <= step + 0.5) h.state = 'off';
    else h.pos.addScaledVector(_to, step / d);
  }
  if (h.state !== 'off') game.fx.glow(h.pos, 0xffa040, 0.06, h.state === 'out');
}

// From Player.tickMove while reeling: steer the velocity toward the hook. False when we've let
// go (arrived, jumped off, or stopped against something).
export function pull(game, p, dt, pressed, wx, wz, wishLen) {
  const h = p.hook;
  if (h.state !== 'pull') return false;
  // (A launch pad's throw is over once the line takes us.)
  p.launched = false;
  if (pressed.jump) {
    releaseHook(game, p, { jump: true });
    pressed.jump = false;
    return false;
  }
  anchor(h, _goal);
  const body = h.target?.isPlayer;
  if (!body) _goal.addScaledVector(h.normal, GRAPPLE.standOff);
  // Under a ledge: reeled up to just over its top.
  if (h.ledge) _goal.y = h.ledgeY + p.halfHeight + p.radius + 0.35;
  _to.subVectors(_goal, p.center);
  const dist = _to.length();
  if (dist < (body ? GRAPPLE.arriveBody : GRAPPLE.arrive)) {
    releaseHook(game, p, { pop: true });
    return false;
  }
  _to.multiplyScalar(1 / dist);
  const v = p.vel;
  // Toward the hook at pullSpeed (less right at the end, so we don't slam past it), plus a
  // little sideways steering from the stick.
  const speed = GRAPPLE.pullSpeed * Math.min(1, 0.35 + dist / 4);
  const s = GRAPPLE.steer * wishLen;
  const tx = _to.x * speed + wx * s;
  const ty = _to.y * speed;
  const tz = _to.z * speed + wz * s;
  const dx = tx - v.x;
  const dy = ty - v.y;
  const dz = tz - v.z;
  const d = Math.hypot(dx, dy, dz);
  const max = GRAPPLE.pullAccel * dt;
  if (d <= max) v.set(tx, ty, tz);
  else v.set(v.x + (dx / d) * max, v.y + (dy / d) * max, v.z + (dz / d) * max);
  return true;
}

// After the move: stopped against something on the way (a lip under a ledge, a pillar)? Let go
// with a hop, so a mantle can take over.
export function checkStuck(game, p, moved, dt) {
  const h = p.hook;
  if (h.state !== 'pull' || h.t < 0.2) return;
  anchor(h, _goal);
  _to.subVectors(_goal, p.center).normalize();
  const along = (moved.x * _to.x + moved.y * _to.y + moved.z * _to.z) / dt;
  if (along < 2.5) h.stuckT += dt;
  else h.stuckT = 0;
  if (h.stuckT > 0.12) releaseHook(game, p, { pop: true });
}
