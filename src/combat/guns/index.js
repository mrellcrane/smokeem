import hickory from './hickory.js';
import mesquite from './mesquite.js';
import smokeSignal from './smokeSignal.js';
import toothpick from './toothpick.js';
import kindling from './kindling.js';
import coldSmoke from './coldSmoke.js';

// Every gun in the game. Each module exports { def, parts, hands, muzzle, view, carry }:
// stats (see weapons.js), box model, first-person hands, muzzle point, first-person pose and the
// third-person grip point. Adding a gun means adding a module here and putting it in a set
// (arsenal.js).
export const GUNS = { hickory, mesquite, smokeSignal, toothpick, kindling, coldSmoke };
