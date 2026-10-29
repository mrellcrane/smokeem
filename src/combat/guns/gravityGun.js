import { GLOVE, METAL, METAL_LIGHT, SCREEN } from '../weaponModels.js';

const HAZARD = 0xe8a21c;

// Gravity Gun (Half-Life 2's): the aim button pulls a loose thing toward you and holds it in
// front of you, fire throws it hard; fire with nothing held punts whatever is right in front
// (a shove and a little damage). It grabs grenades, coals, sticky bombs and the loose props
// (src/combat/gravity.js). A power gun: never in a loadout.
export default {
  def: {
    id: 'gravityGun',
    name: 'Gravity Gun',
    blurb: 'Aim button grabs loose things (crates, barrels, grenades, stickies); fire throws them. Punts people up close.',
    kind: 'gravity',
    auto: false,
    fireRate: 1.5,
    // No ammo: it never runs dry.
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
    switchTime: 0.4,
    range: 14,
    // Grab: anything within this angle of the aim, up to `range` away.
    grabCone: 12,
    holdDistance: 1.7,
    throwSpeed: 30,
    // Punt: within this reach and cone, a shove and a little damage.
    puntRange: 5,
    puntCone: 22,
    puntSpeed: 14,
    puntDamage: 14,
    sound: 'punt',
    padRespawn: 60,
    bot: { min: 0, max: 4.5, pref: 3, power: true },
  },
  parts: [
    // Hazard-orange body with black panels, a glowing core and three claws.
    [[0, 0.0, -0.1], [0.15, 0.13, 0.36], HAZARD],
    [[0, 0.07, -0.1], [0.1, 0.02, 0.3], METAL],
    [[0, 0.0, -0.3], [0.1, 0.1, 0.06], METAL],
    [[0, 0.0, -0.335], [0.06, 0.06, 0.02], SCREEN],
    [[0, 0.07, -0.38], [0.025, 0.025, 0.12], METAL_LIGHT],
    [[0.06, -0.035, -0.38], [0.025, 0.025, 0.12], METAL_LIGHT],
    [[-0.06, -0.035, -0.38], [0.025, 0.025, 0.12], METAL_LIGHT],
    [[0, -0.09, 0.02], [0.045, 0.1, 0.05], METAL],
    [[0, 0.01, 0.12], [0.11, 0.1, 0.12], HAZARD],
    [[0, -0.02, 0.19], [0.08, 0.08, 0.03], null],
  ],
  hands: [
    [[0.005, -0.095, 0.02], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.17, 0.12], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.175, 0.12], [0.07, 0.03, 0.08], null],
    [[-0.01, -0.07, -0.2], [0.08, 0.055, 0.1], GLOVE],
    [[-0.045, -0.1, -0.15], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.0, -0.44],
  view: { pos: [0.2, -0.2, -0.42], rot: [0.03, 0.06, 0], scale: 0.75, kick: 1.6, flash: 1.2, flashColor: 0x63f2ff },
  carry: [0.12, 1.2, -0.3],
};
