import { WEAPONS } from './weapons.js';

// Weapon sets. A match uses one set of at most 5 gun types, so nobody has to learn the whole
// roster at once. Every set is "3 to start, 2 to find":
//   primaries  two primaries; each loadout is one of them plus the sidearm (first is preselected)
//   sidearm    the set's sidearm, in both loadouts
//   field      the gun on the map's field pads
//   power      the gun on the map's power pad (power guns never go in loadouts)
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

// Mudlark Gauntlet's default (maps name their own default set).
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
  }));
}

// Sets whose guns all exist yet.
export function availableSets() {
  return Object.keys(WEAPON_SETS).filter((id) => setGuns(WEAPON_SETS[id]).every((g) => WEAPONS[g]));
}

// Resolve a weapon-set setting ('default', a set id, or 'mystery') to a set id. Mystery Meat
// picks a random set that isn't Extra Hot and isn't the one just played.
export function chooseSet(choice, last = null) {
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
  return `${l.name}: ${l.guns.map((g) => WEAPONS[g].name).join(' + ')}`;
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
