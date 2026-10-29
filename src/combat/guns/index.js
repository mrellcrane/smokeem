import hickory from './hickory.js';
import mesquite from './mesquite.js';
import smokeSignal from './smokeSignal.js';
import toothpick from './toothpick.js';
import kindling from './kindling.js';
import coldSmoke from './coldSmoke.js';
import chimney from './chimney.js';
import rotisserie from './rotisserie.js';
import brander from './brander.js';
import swarmJar from './swarmJar.js';
import stickybomb from './stickybomb.js';
import gravityGun from './gravityGun.js';

// Every gun in the game. Each module exports { def, parts, hands, muzzle, view, carry }:
// stats (see weapons.js), box model, first-person hands, muzzle point, first-person pose and the
// third-person grip point. Adding a gun means adding a module here and putting it in a set
// (arsenal.js).
export const GUNS = { hickory, mesquite, smokeSignal, toothpick, kindling, coldSmoke, chimney, rotisserie, brander, swarmJar, stickybomb, gravityGun };

// Every box of a gun as one static model (spinning parts included), for third-person bodies
// and pickups.
export function allParts(id) {
  const g = GUNS[id];
  if (!g.spin) return g.parts;
  return [...g.parts, ...g.spin.parts];
}
