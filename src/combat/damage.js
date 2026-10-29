// The one path all damage goes through, so players, targets and bots react the same way.
//
// Targets implement: alive, vitals, model (optional, for the shield shimmer),
// onDamaged(result, info) (optional) and die(info).
// info: { attacker, weapon, headshot, point, dir, cause }

export function dealDamage(game, target, amount, info) {
  if (!target.alive) return null;
  const res = target.vitals.damage(amount);
  if (res.shieldDamage > 0) target.model?.flashShield(res.broke ? 1 : 0.55);
  target.onDamaged?.(res, info);
  if (res.killed) {
    target.die(info);
    game.onKill(target, info);
  }
  return res;
}
