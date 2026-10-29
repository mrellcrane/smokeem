import * as THREE from 'three';
import { dealDamage } from './damage.js';

// Area damage shared by the Smoke Signal and grenades: falloff with distance, cover blocks it,
// shoves people around, shakes nearby cameras and hurts the thrower too.

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
// How far a blast looks for a surface to scorch (m), and the scorch's width (times the blast
// radius) before it shrinks to fit that surface.
const SURFACE_REACH = 1.2;
const SCORCH = 0.6;
// The shock ring lies flat on a floor (normal this upright) within this reach below the blast.
const FLOOR_Y = 0.7;
const FLOOR_REACH = 1.6;
const _against = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };
const _floor = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };
const _side = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };
const _probe = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };
const _mud = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), surface: 'mud' };
const _wall = { normal: new THREE.Vector3(), point: new THREE.Vector3() };
const SIDES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
// A blast this close to a wall (m) billows out from it.
const WALL_REACH = 0.6;

// What a blast went off against (for the scorch), the floor its shock ring lies on (null: the
// ring faces the camera instead, as near cover or a drop), and the way its fire and smoke
// billow when it's against a wall (null: up).
function blastSurfaces(game, pos, radius, against) {
  let surface;
  let floor;
  let wall = null;
  // A blast in the mud, or just over it, lies on the mud's surface (no collider there).
  const mudY = !against || against.y > 0.9 ? game.zones.mudTop(pos, SURFACE_REACH) : null;
  if (mudY !== null) {
    _mud.point.set(pos.x, mudY, pos.z);
    surface = floor = _mud;
  } else {
    // Back along the surface it hit, otherwise the floor below it.
    surface = game.surfaceNear(pos, against ? _d.copy(against).negate() : DOWN, SURFACE_REACH, _against);
    floor = surface && surface.normal.y > FLOOR_Y ? surface : game.surfaceNear(pos, DOWN, Math.max(FLOOR_REACH, radius * 0.3), _floor);
    if (floor && floor.normal.y <= FLOOR_Y) floor = null;
  }
  if (surface && surface.normal.y < FLOOR_Y) {
    _wall.normal.copy(surface.normal);
    _wall.point.copy(surface.point);
    wall = _wall;
  } else if (!against) {
    // A grenade or coal against a wall: the nearest wall within reach, and out and up from the
    // corner where it meets the floor.
    let best = WALL_REACH;
    for (const dir of SIDES) {
      const s = game.surfaceNear(pos, dir, best, _side);
      if (s && s.normal.y < FLOOR_Y) {
        best = pos.distanceTo(s.point);
        _wall.normal.copy(s.normal);
        _wall.point.copy(s.point);
        wall = _wall;
      }
    }
    if (wall) _wall.normal.add(UP).normalize();
  }
  if (floor && ringBlocked(game, floor, radius)) floor = null;
  return { surface, floor, wall };
}

// Whether the flat ring would mislead: cover cuts it short (it would sweep on along the floor
// past where the blast can reach), or the floor drops away under it (nobody below would see it).
// Probes 8 ways along the floor, half a meter up (over trims and dips), then down at each end.
function ringBlocked(game, floor, radius) {
  const n = floor.normal;
  _t.crossVectors(n, Math.abs(n.y) < 0.99 ? UP : X_AXIS).normalize();
  _u.crossVectors(n, _t);
  _a.copy(floor.point).addScaledVector(n, 0.5);
  _d.copy(n).negate();
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    _b.copy(_a).addScaledVector(_t, Math.cos(ang) * radius * 0.9).addScaledVector(_u, Math.sin(ang) * radius * 0.9);
    if (game.lineBlocked(_a, _b)) return true;
    if (!game.surfaceNear(_b, _d, 0.8, _probe) && game.zones.mudTop(_b, 0.6) === null) return true;
  }
  return false;
}

// cfg: { radius, inner, damage, knockback, tint?, volume?, rate? }
// info: { attacker, weapon, against? (the normal of the level surface it hit) }
// tint colors its shock ring and embers; volume and rate let small blasts (Chimney coals) sound
// smaller.
export function explode(game, pos, cfg, info) {
  const { surface, floor, wall } = blastSurfaces(game, pos, cfg.radius, info.against);
  const scorch = surface && game.fx.marksOn(surface.surface) ? game.fitDecal(surface, cfg.radius * SCORCH) : 0;
  game.fx.explosion(pos, cfg.radius, {
    tint: cfg.tint,
    ring: floor,
    scorch: scorch > 0 ? surface : null,
    scorchWidth: scorch,
    wall: wall ? wall.normal : null,
    push: wall ? Math.max(0, cfg.radius * 0.1 - pos.distanceTo(wall.point)) : 0,
  });
  game.sfx.play('boom', { at: pos, volume: cfg.volume ?? 1, rate: cfg.rate ?? 1 });
  game.grenades.shove(pos, cfg);
  game.props?.shove(pos, cfg, info);
  game.swarms.blast(pos, cfg.radius);

  // Each body registers exactly one collider, so every entity appears once here.
  for (const e of game.entities.values()) {
    if (!e.alive) continue;
    e.centerPosition(_c);
    const dist = Math.max(0, pos.distanceTo(_c) - 0.4);
    if (dist > cfg.radius) continue;
    // Cover: solid geometry between the blast and the body blocks it (except point blank).
    if (dist > 0.8 && game.lineBlocked(pos, _c)) continue;
    const inner = cfg.inner ?? 0;
    const k = dist <= inner ? 1 : 1 - (dist - inner) / (cfg.radius - inner);
    if (e.kind === 'player') {
      _d.subVectors(_c, pos);
      _d.y += 0.6;
      _d.normalize();
      e.knockback(_d, cfg.knockback * k);
    }
    dealDamage(game, e, cfg.damage * (k >= 1 ? 1 : 0.15 + 0.85 * k), {
      attacker: info.attacker,
      weapon: info.weapon,
      cause: 'explosion',
      point: pos,
    });
  }

  for (const p of game.humans) {
    const d = p.camera.position.distanceTo(pos);
    p.addShake(Math.max(0, 1 - d / 28) * 0.9);
  }
}
