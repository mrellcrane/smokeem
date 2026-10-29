import * as THREE from 'three';
import { dealDamage } from './damage.js';

// Area damage shared by the Smoke Signal and grenades: falloff with distance, cover blocks it,
// shoves people around, shakes nearby cameras and hurts the thrower too.

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
// How far a blast looks for a surface to lie its shock ring on and scorch (m), and the
// scorch's width (times the blast radius) before it shrinks to fit that surface.
const SURFACE_REACH = 1.2;
const SCORCH = 0.6;

// cfg: { radius, inner, damage, knockback, tint?, volume?, rate? }
// info: { attacker, weapon, against? (the normal of the level surface it hit) }
// tint colors its shock ring and embers; volume and rate let small blasts (Chimney coals) sound
// smaller.
export function explode(game, pos, cfg, info) {
  // What it went off against: back along the surface it hit, otherwise the floor below it.
  const dir = info.against ? _d.copy(info.against).negate() : DOWN;
  const surface = game.surfaceNear(pos, dir, SURFACE_REACH);
  const scorch = surface && game.fx.marksOn(surface.surface) ? game.fitDecal(surface, cfg.radius * SCORCH) : 0;
  game.fx.explosion(pos, cfg.radius, { tint: cfg.tint, surface, scorch });
  game.sfx.play('boom', { at: pos, volume: cfg.volume ?? 1, rate: cfg.rate ?? 1 });
  game.grenades.shove(pos, cfg);
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
