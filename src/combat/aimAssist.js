import * as THREE from 'three';
import { AIM, BODY } from '../config.js';

// Controller aim assist, Halo style (owner request): bullet magnetism, aim slowdown and a little
// tracking. Only for players whose input asks for it (controllers; InputState.assist), never
// mouse or bots.
//
// Each gun sets its own (its def's `assist`, over the AIM defaults; see assistOf): the cone's
// cap in degrees and how far past the body's edge it reaches, the range it works out to (also
// the red reticle's range), the slowdown on and near a target, and the tracking share. Like
// Halo's, the cone is divided by the zoom, so it stays the same size on screen when zoomed.
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
// The kinds of gun whose shots bend (launchers, the missile and the tools don't).
const BENDS = new Set(['hitscan', 'pellets', 'beam', 'size']);

export function assists(p) {
  return !!p.input.assist && !p.isBot;
}

// A gun's assist: { cone (radians), radius (m), range (m), slow, near, track }, cached.
const cache = new WeakMap();
export function assistOf(def) {
  let a = cache.get(def);
  if (a) return a;
  const o = def.assist ?? {};
  a = {
    cone: BENDS.has(def.kind) ? (o.cone ?? AIM.magnetMaxAngle / (Math.PI / 180)) * (Math.PI / 180) : 0,
    radius: o.radius ?? AIM.magnetRadius,
    range: o.range ?? (def.range ?? 60) * AIM.magnetRange,
    slow: o.slow ?? AIM.frictionOn,
    near: o.near ?? AIM.frictionNear,
    track: o.track ?? AIM.track,
  };
  cache.set(def, a);
  return a;
}

let bestAngle = Infinity;
let best = null;
let bestDist = 0;
// The cone being tested: the gun's cap and reach, over the zoom, times coneMul.
let capNow = 0;
let reachNow = 0;

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
  const cone = Math.min(capNow, Math.atan((BODY.radius + reachNow) / dist)) * coneMul;
  if (angle < cone && angle < bestAngle) {
    bestAngle = angle;
    best = t;
    bestDist = dist;
    _best.copy(_to).divideScalar(dist);
  }
}

// The target nearest the aim within coneMul times the held gun's magnetism cone (over the zoom)
// and its range, in sight, with the direction to aim at it written into outDir; or null.
export function assistTarget(game, p, origin, f, coneMul, outDir) {
  const a = assistOf(p.weapon.def);
  if (a.cone <= 0) return null;
  bestAngle = Infinity;
  best = null;
  capNow = a.cone / p.aimZoom;
  reachNow = a.radius / p.aimZoom;
  for (const t of game.players) consider(t, p, origin, f, a.range, coneMul);
  for (const t of game.dummies) consider(t, p, origin, f, a.range, coneMul);
  if (!best) return null;
  // (Nobody behind a wall.)
  _c.copy(origin).addScaledVector(_best, bestDist);
  if (game.lineBlocked(origin, _c)) return null;
  outDir.copy(_best);
  return best;
}

// Bend a shot's aim (f, with its right and up vectors r and u) onto a target in the magnetism
// cone. Returns the target or null.
export function magnetize(game, p, origin, f, r, u) {
  const t = assistTarget(game, p, origin, f, 1, _to);
  if (!t) return null;
  f.copy(_to);
  r.crossVectors(f, UP).normalize();
  u.crossVectors(r, f);
  return t;
}
