import { buildArena } from './arena.js';
import { buildFactory } from './factory.js';
import { buildValley, VALLEY_LINKS } from './valley.js';
import { buildYard } from './yard.js';
import { buildStack, STACK_LINKS } from './stack.js';
import { MUDLARK_LOOK, FACTORY_LOOK, VALLEY_LOOK, YARD_LOOK, STACK_LOOK } from './looks.js';
import { MUDLARK_LINKS, FACTORY_LINKS } from '../ai/mapLinks.js';

// The maps: how to build each one, its look, the bots' extra moves on it (mapLinks.js) and its
// default weapon set (arsenal.js).
export const MAPS = {
  mudlark: {
    name: 'Mudlark Gauntlet',
    blurb: 'the outdoor obstacle course: nets, ropes, walls, monkey bars, mud and fire.',
    build: buildArena,
    look: MUDLARK_LOOK,
    links: MUDLARK_LINKS,
    defaultSet: 'backyard',
  },
  factory: {
    name: 'Smokestack Works',
    blurb: 'an indoor smokehouse with catwalks, a giant smoker, conveyor belts, pallet racks and a grease vat.',
    build: buildFactory,
    look: FACTORY_LOOK,
    links: FACTORY_LINKS,
    defaultSet: 'junkyard',
  },
  valley: {
    name: 'Smokehouse Creek',
    blurb: 'two rival smokehouses facing off across a creek valley: hills, bridges and launch pads.',
    build: buildValley,
    look: VALLEY_LOOK,
    links: VALLEY_LINKS,
    // (A mid-range rifle for an open valley, and the Smoke Signal for the bikes, as Valhalla has
    // its rockets: Competition Cut's SMG dragged fights out here.)
    defaultSet: 'backyard',
  },
  yard: {
    name: 'Cook-Off Yard',
    blurb: "a barbecue contest's grounds: judging towers in two corners, a smoker shed in the middle with the power gun on its roof.",
    build: buildYard,
    look: YARD_LOOK,
    links: [],
    // (Precision guns for the towers' long lines, rockets for the roof.)
    defaultSet: 'cookoff',
  },
  stack: {
    name: 'The Big Stack',
    blurb: 'a canyon round one giant smokestack: three decks up its sides, perches in the corners, launch pads and long falls.',
    build: buildStack,
    look: STACK_LOOK,
    links: STACK_LINKS,
    // (The Carver for the decks and perches, Hot Links for the top.)
    defaultSet: 'cookoff',
  },
};

export const DEFAULT_MAP = 'mudlark';

// Resolve a map setting (a map id, or 'random': any map but the one just played) to a map id.
export function chooseMap(choice, last = null) {
  const ids = Object.keys(MAPS);
  if (choice === 'random') {
    const fresh = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
    return fresh[Math.floor(Math.random() * fresh.length)];
  }
  return MAPS[choice] ? choice : DEFAULT_MAP;
}
