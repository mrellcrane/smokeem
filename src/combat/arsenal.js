import { WEAPONS } from './weapons.js';

// Weapon sets. A match uses one set of at most 5 gun types, so nobody has to learn the whole
// roster at once. Every set is "3 to start, 2 to find":
//   primaries  two primaries; each loadout is one of them plus the sidearm (first is preselected)
//   sidearm    the set's sidearm, in both loadouts
//   field      the gun on the map's field pads
//   power      the gun on the map's power pad (power guns never go in loadouts)
//   dual       primaries a loadout carries two of, one in each hand (dual-wield guns only)
// heat says how much a set asks you to learn: Mild (the default), Medium (no wacky guns in
// loadouts), Hot, Extra Hot (anything goes; opt-in only, never picked by Mystery Meat).
// A set only shows up once all its guns are built.
export const MAX_SET_GUNS = 5;

export const WEAPON_SETS = {
  backyard: {
    name: 'Backyard',
    heat: 'Mild',
    primaries: ['hickory', 'kindling'],
    sidearm: 'toothpick',
    field: 'mesquite',
    power: 'smokeSignal',
    loadoutNames: ['Pitmaster', 'Hot n Fast'],
  },
  competitionCut: {
    name: 'Competition Cut',
    heat: 'Medium',
    primaries: ['kindling', 'coldSmoke'],
    sidearm: 'toothpick',
    field: 'chimney',
    power: 'rotisserie',
  },
  sauceOnTheSide: {
    name: 'Sauce on the Side',
    heat: 'Medium',
    primaries: ['hickory', 'kindling'],
    sidearm: 'toothpick',
    field: 'gust',
    power: 'sauceBoss',
  },
  bankShot: {
    name: 'Bank Shot',
    heat: 'Hot',
    primaries: ['hickory', 'wishbone'],
    sidearm: 'castIron',
    field: 'skewer',
    power: 'smokeSignal',
  },
  hotAndCold: {
    name: 'Hot and Cold',
    heat: 'Hot',
    primaries: ['coldSmoke', 'brander'],
    sidearm: 'toothpick',
    field: 'mesquite',
    power: 'swarmJar',
    loadoutNames: ['Ice Pick', 'Branding Day'],
  },
  junkyard: {
    name: 'Junkyard',
    heat: 'Hot',
    primaries: ['hickory', 'stickybomb'],
    sidearm: 'toothpick',
    field: 'mesquite',
    power: 'gravityGun',
    loadoutNames: ['Pitmaster', 'Sticky Ribs'],
  },
  // The Shrink Wrap and the Portal Gun (owner requests).
  funhouse: {
    name: 'Funhouse',
    heat: 'Hot',
    primaries: ['hickory', 'coldSmoke'],
    sidearm: 'toothpick',
    field: 'portalGun',
    power: 'shrinkWrap',
    loadoutNames: ['Pitmaster', 'Ice Pick'],
  },
  // Halo's classics as BBQ (owner pick): the scoped hand cannon as the sidearm, twin rocket
  // tubes on the power pad.
  cookoff: {
    name: 'Cookoff',
    heat: 'Medium',
    primaries: ['hickory', 'kindling'],
    sidearm: 'carver',
    field: 'mesquite',
    power: 'hotLinks',
    dual: ['kindling'],
    loadoutNames: ['Pitmaster', 'Double Down'],
  },
  hogWild: {
    name: 'Hog Wild',
    heat: 'Extra Hot',
    primaries: ['wishbone', 'brander'],
    sidearm: 'castIron',
    field: 'gust',
    power: 'swarmJar',
    wild: true,
  },
};

// The fallback set (each map names its own default in world/maps.js).
export const DEFAULT_SET = 'backyard';

// Every gun type a set uses.
export function setGuns(set) {
  return [...new Set([...set.primaries, set.sidearm, set.field, set.power])];
}

// The set's two loadouts: each primary with the sidearm.
export function setLoadouts(set) {
  return set.primaries.map((g, i) => ({
    name: set.loadoutNames?.[i] ?? WEAPONS[g].name,
    guns: [g, set.sidearm],
    // A second of the primary in the left hand.
    left: set.dual?.includes(g) ? g : null,
  }));
}

// Custom (title screen): any gun in any of the five slots, the player's own pick. Saved as
// settings.customSet ({ primary1, primary2, sidearm, field, power }); a gun that doesn't exist
// falls back to the default pick.
export const CUSTOM_SLOTS = [
  ['primary1', 'Primary 1'],
  ['primary2', 'Primary 2'],
  ['sidearm', 'Sidearm'],
  ['field', 'Field pads'],
  ['power', 'Power pad'],
];
export const DEFAULT_CUSTOM = { primary1: 'hickory', primary2: 'wishbone', sidearm: 'castIron', field: 'gust', power: 'sauceBoss' };

// Every gun in the game, in the roster's order (the Custom slots cycle through these).
export const ALL_GUNS = Object.keys(WEAPONS);

export function customPick(pick) {
  const out = {};
  for (const [k] of CUSTOM_SLOTS) out[k] = WEAPONS[pick?.[k]] ? pick[k] : DEFAULT_CUSTOM[k];
  return out;
}

// The custom pick as a set, like the ones above.
export function customSet(pick) {
  const c = customPick(pick);
  return { name: 'Custom', heat: 'Custom', primaries: [c.primary1, c.primary2], sidearm: c.sidearm, field: c.field, power: c.power };
}

// Sets whose guns all exist yet.
export function availableSets() {
  return Object.keys(WEAPON_SETS).filter((id) => setGuns(WEAPON_SETS[id]).every((g) => WEAPONS[g]));
}

// Resolve a weapon-set setting ('default', a set id, or 'mystery') to a set id. Mystery Meat
// picks a random set that isn't Extra Hot and isn't the one just played.
export function chooseSet(choice, last = null) {
  if (choice === 'custom') return 'custom';
  const sets = availableSets();
  if (choice === 'mystery') {
    const pool = sets.filter((id) => !WEAPON_SETS[id].wild);
    const fresh = pool.length > 1 ? pool.filter((id) => id !== last) : pool;
    return fresh[Math.floor(Math.random() * fresh.length)] ?? DEFAULT_SET;
  }
  return sets.includes(choice) ? choice : DEFAULT_SET;
}

export function loadoutLabel(set, i) {
  const loadouts = setLoadouts(set);
  const n = loadouts.length;
  const l = loadouts[((i % n) + n) % n];
  return `${l.name}: ${l.guns.map((g, j) => (j === 0 && l.left ? `${WEAPONS[g].name} x2` : WEAPONS[g].name)).join(' + ')}`;
}

// Catch mistakes in the table above at load rather than mid-match (only for sets that exist).
for (const id of availableSets()) {
  const set = WEAPON_SETS[id];
  const guns = setGuns(set);
  if (guns.length > MAX_SET_GUNS) throw new Error(`Weapon set ${id} has ${guns.length} guns (max ${MAX_SET_GUNS})`);
  for (const g of [...set.primaries, set.sidearm]) {
    if (WEAPONS[g].bot.power) throw new Error(`Weapon set ${id} puts power gun ${g} in a loadout`);
  }
}
