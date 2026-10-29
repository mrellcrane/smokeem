import * as THREE from 'three';
import { AIM, BODY } from '../config.js';

// Controller aim assist, Halo style (owner request): bullet magnetism and aim slowdown. Only for
// players whose input asks for it (controllers; InputState.assist), never mouse or bots.
//
// Each target counts as a vertical segment through its body, from the hips to the top of the
// head. Within a small cone around it (AIM.magnetRadius meters past the body's edge, as an
// angle, at most AIM.magnetMaxAngle), a shot's aim bends onto the nearest point of that segment, so a
// near miss lands and aiming at the head still gets the head. Spread still applies after the
// bend, so a sprayed automatic still misses. The view slows over a target and a little more
// in the wider "near" cone around it (Player.applyLook).

const _to = new THREE.Vector3();
const _best = new THREE.Vector3();
const _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function assists(p) {
  return !!p.input.assist && !p.isBot;
}

let bestAngle = Infinity;
let best = null;

function consider(t, p, origin, f, range, coneMul) {
  if (t === p || !t.alive) return;
  t.centerPosition(_c);
  const lo = _c.y - AIM.segmentBelow;
  const hi = t.headLineY() + AIM.segmentAbove;
  // The point of the segment nearest the aim: where the aim ray passes the target's depth,
  // clamped to the body.
  _to.subVectors(_c, origin);
  const depth = _to.dot(f);
  if (depth <= 0.5 || depth > range) return;
  const aimY = origin.y + f.y * depth;
  _to.set(_c.x, Math.min(hi, Math.max(lo, aimY)), _c.z).sub(origin);
  const dist = _to.length();
  const angle = Math.acos(Math.min(1, _to.dot(f) / dist));
  const cone = Math.min(AIM.magnetMaxAngle, Math.atan((BODY.radius + AIM.magnetRadius) / dist)) * coneMul;
  if (angle < cone && angle < bestAngle) {
    bestAngle = angle;
    best = t;
    _best.copy(_to).divideScalar(dist);
  }
}

// The target nearest the aim within coneMul times the magnetism cone and `range`, with the
// direction to aim at it written into outDir; or null.
export function assistTarget(game, p, origin, f, range, coneMul, outDir) {
  bestAngle = Infinity;
  best = null;
  for (const t of game.players) consider(t, p, origin, f, range, coneMul);
  for (const t of game.dummies) consider(t, p, origin, f, range, coneMul);
  if (!best) return null;
  outDir.copy(_best);
  return best;
}

// Bend a shot's aim (f, with its right and up vectors r and u) onto a target in the magnetism
// cone. Returns the target or null.
export function magnetize(game, p, origin, f, r, u, range, strength = 1) {
  if (strength <= 0) return null;
  const t = assistTarget(game, p, origin, f, range * AIM.magnetRange, strength, _to);
  if (!t) return null;
  f.copy(_to);
  r.crossVectors(f, UP).normalize();
  u.crossVectors(r, f);
  return t;
}
