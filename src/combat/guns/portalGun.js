import { GLOVE, METAL, METAL_LIGHT } from '../weaponModels.js';

const WHITE = 0xe9edf0;
const BLACK = 0x1c1f22;
const CORE = 0x9fe0ff;

// Portal Gun (Portal's handheld portal device): fire opens your blue portal, the aim button your
// orange one (src/combat/portals.js does the rest). No ammo. A pickup only: never in a loadout,
// and bots leave it alone.
export default {
  def: {
    id: 'portalGun',
    name: 'Portal Gun',
    blurb: 'Fire opens your blue portal, aim your orange one. Anyone can go through, bullets and rockets too.',
    kind: 'portal',
    auto: false,
    fireRate: 2.5,
    damage: 0,
    range: 150,
    mag: Infinity,
    reserve: 0,
    reloadTime: 0,
    spreadBase: 0,
    spreadMax: 0,
    spreadPerShot: 0,
    spreadRecovery: 0,
    spreadMoveAdd: 0,
    spreadAirAdd: 0,
    aimSpreadMul: 1,
    crouchSpreadMul: 1,
    climbSpreadMul: 1,
    zoom: 1,
    switchTime: 0.35,
    tracerWidth: 0.06,
    tracerLife: 0.15,
    sound: 'portalShotA',
    // skip: bots never pick it up or use it.
    bot: { min: 0, max: 0, pref: 0, skip: true },
  },
  // Box parts in gun space (barrel along -z, origin at the grip): [center, size, color].
  // A null color means the owner's armor color.
  parts: [
    [[0, 0.02, -0.03], [0.11, 0.11, 0.26], WHITE],
    [[0, 0.02, 0.13], [0.09, 0.09, 0.08], METAL_LIGHT],
    [[0, 0.02, -0.2], [0.07, 0.07, 0.1], BLACK],
    [[0, 0.02, -0.26], [0.1, 0.1, 0.03], WHITE],
    [[0, 0.02, -0.29], [0.04, 0.04, 0.04], CORE],
    [[0, 0.075, -0.33], [0.016, 0.016, 0.1], BLACK],
    [[-0.05, -0.008, -0.33], [0.016, 0.016, 0.1], BLACK],
    [[0.05, -0.008, -0.33], [0.016, 0.016, 0.1], BLACK],
    [[0, 0.078, -0.01], [0.035, 0.012, 0.18], null],
    [[0, -0.07, 0.05], [0.04, 0.1, 0.05], METAL],
  ],
  // Both hands: the right on the grip, the left under the black core.
  hands: [
    [[0.005, -0.075, 0.05], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.15], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.15], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.05, -0.18], [0.075, 0.06, 0.09], GLOVE],
    [[-0.04, -0.09, -0.13], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.02, -0.4],
  view: { pos: [0.2, -0.2, -0.42], rot: [0.025, 0.06, 0], scale: 0.8, kick: 0.4, flash: 0.4, flashColor: CORE },
  carry: [0.12, 1.2, -0.3],
};
