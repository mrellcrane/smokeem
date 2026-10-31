import * as THREE from 'three';
import { SIZE } from '../config.js';
import { BASTED_MUL } from './sauce.js';

// The one path all damage goes through, so players, targets and bots react the same way.
//
// Targets implement: alive, vitals, model (optional, for the shield shimmer),
// onDamaged(result, info) (optional) and die(info).
// info: { attacker, weapon, headshot, point, dir, cause }

const _c = new THREE.Vector3();

export function dealDamage(game, target, amount, info) {
  if (!target.alive) return null;
  // Shrink Wrap: a grown target takes more, a shrunk attacker deals less.
  if (target.size > 1) amount *= SIZE.bigDamageIn;
  if (info?.attacker?.size < 1) amount *= SIZE.smallDamageOut;
  // Basted (in the Sauce Boss's sauce): more damage taken.
  if (target.bastedT > 0) amount *= BASTED_MUL;
  // Super Easy bots hit softer.
  const mul = info?.attacker?.brain?.skill.damageMul;
  if (mul) amount *= mul;
  // A Sizzler's rider is a little sheltered by the bike.
  if (target.vehicle) amount *= target.vehicle.S.riderTakes;
  const res = target.vitals.damage(amount);
  // Who hurt a player and when, for assists (match.js).
  const a = info?.attacker;
  if (target.hitBy && a && a !== target && a.kind === 'player' && amount > 0) target.hitBy.set(a, game.time);
  if (res.shieldDamage > 0) target.model?.flashShield(res.broke ? 1 : 0.55);
  if (res.broke) game.fx.shieldPop(target.centerPosition(_c));
  target.onDamaged?.(res, info);
  if (res.killed) {
    target.die(info);
    game.onKill(target, info);
  }
  return res;
}
