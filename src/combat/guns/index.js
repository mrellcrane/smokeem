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
import shrinkWrap from './shrinkWrap.js';
import portalGun from './portalGun.js';
import carver from './carver.js';
import hotLinks from './hotLinks.js';
import { METAL, METAL_LIGHT } from '../weaponModels.js';

// Every gun in the game. Each module exports { def, parts, hands, muzzle, view, carry }:
// stats (see weapons.js), box model, first-person hands, muzzle point, first-person pose and the
// third-person grip point. Adding a gun means adding a module here and putting it in a set
// (arsenal.js).
export const GUNS = { hickory, mesquite, smokeSignal, toothpick, kindling, coldSmoke, chimney, rotisserie, brander, swarmJar, stickybomb, gravityGun, shrinkWrap, portalGun, carver, hotLinks };

// Halo proportions (owner pick, keeping the BBQ parts): every gun's cross-section is fattened
// about its bore line by CHUNK, lengths kept, and its hands, muzzle, spinning parts and ammo
// screen move with it so the grips still line up. Each gun's main body also gets a glowing strip
// down each side. Done once here, so first person, bodies, pickups and pictures all match.
const CHUNK = 1.2;
const BORE_Y = 0.02;
// The strips' ember orange (self-lit, so darker than it looks).
const STRIP = 0xb8501a;
const fat = ([x, y, z]) => [x * CHUNK, BORE_Y + (y - BORE_Y) * CHUNK, z];
const fatPart = ([c, s, color, opts]) => [fat(c), [s[0] * CHUNK, s[1] * CHUNK, s[2]], color, opts];

function chunky(g) {
  g.parts = g.parts.map(fatPart);
  // Gloves wrap the fatter grips a little wider.
  g.hands = g.hands.map(([c, s, ...rest]) => [fat(c), [s[0] * 1.08, s[1] * 1.08, s[2]], ...rest]);
  g.muzzle = fat(g.muzzle);
  if (g.spin) {
    g.spin = { ...g.spin, center: fat(g.spin.center), parts: g.spin.parts.map(fatPart) };
  }
  if (g.display) g.display = { ...g.display, at: fat(g.display.at), size: [g.display.size[0] * CHUNK, g.display.size[1]] };
  // The glow strips: along the biggest plain metal (or armor-colored) box, a third of the way
  // down from its top, on both sides.
  let body = null;
  let best = 0;
  for (const p of g.parts) {
    const [, s, color, opts] = p;
    if (opts?.shape === 'cyl' || opts?.rot || opts?.group || ![METAL, METAL_LIGHT, null].includes(color)) continue;
    const v = s[0] * s[1] * s[2];
    if (v > best) {
      best = v;
      body = p;
    }
  }
  if (body) {
    const [[x, y, z], [sx, sy, sz]] = body;
    for (const side of [-1, 1]) {
      g.parts.push([[x + side * (sx / 2 + 0.0008), y + sy * 0.18, z], [0.002, 0.0035, sz * 0.6], STRIP, { bevel: 0, finish: 'glow' }]);
    }
  }
}
for (const g of Object.values(GUNS)) chunky(g);

// Every box of a gun as one static model (spinning parts included), for third-person bodies
// and pickups.
export function allParts(id) {
  const g = GUNS[id];
  if (!g.spin) return g.parts;
  return [...g.parts, ...g.spin.parts];
}
