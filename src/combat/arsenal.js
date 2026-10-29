import { WEAPONS } from './weapons.js';

// Weapon sets. A match uses one set of at most MAX_SET_GUNS gun types, so nobody has to learn
// the whole roster at once.
//   loadouts  the two-gun spawn options players pick between (on the ready and respawn screens)
//   power     the gun on the map's power pad
//   field     guns for the map's other weapon pads, handed out in order
export const MAX_SET_GUNS = 5;

export const WEAPON_SETS = {
  classic: {
    name: 'Classic',
    loadouts: [
      { name: 'Pitmaster', guns: ['hickory', 'mesquite'] },
      { name: 'Close Call', guns: ['mesquite', 'hickory'] },
    ],
    power: 'smokeSignal',
    field: ['mesquite'],
  },
};

export const DEFAULT_SET = 'classic';

// Every gun type a set uses.
export function setGuns(set) {
  const ids = new Set();
  for (const l of set.loadouts) for (const id of l.guns) ids.add(id);
  if (set.power) ids.add(set.power);
  for (const id of set.field) ids.add(id);
  return [...ids];
}

// Catch mistakes in the table above at load rather than mid-match.
for (const [id, set] of Object.entries(WEAPON_SETS)) {
  const guns = setGuns(set);
  if (guns.length > MAX_SET_GUNS) throw new Error(`Weapon set ${id} has ${guns.length} guns (max ${MAX_SET_GUNS})`);
  for (const g of guns) if (!WEAPONS[g]) throw new Error(`Weapon set ${id} uses unknown gun ${g}`);
  if (!set.loadouts.length) throw new Error(`Weapon set ${id} has no loadouts`);
}

export function loadoutLabel(set, i) {
  const n = set.loadouts.length;
  const l = set.loadouts[((i % n) + n) % n];
  return `${l.name}: ${l.guns.map((g) => WEAPONS[g].name).join(' + ')}`;
}
