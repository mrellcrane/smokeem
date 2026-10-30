import { BORE, GLOVE, GLOW, METAL, METAL_LIGHT, ORANGE, RUBBER } from '../weaponModels.js';

// Kindling: SMG. The fastest close-range kill of the loadout guns, useless past about 25 m.
export default {
  def: {
    id: 'kindling',
    name: 'Kindling',
    blurb: 'SMG. Melts up close and stays accurate on the move; weak past 25 m.',
    kind: 'hitscan',
    auto: true,
    fireRate: 14,
    damage: 10,
    headshotMul: 1.5,
    falloffStart: 10,
    falloffEnd: 28,
    falloffMin: 0.4,
    range: 100,
    mag: 40,
    reserve: 200,
    reloadTime: 1.5,
    spreadBase: 1.2,
    spreadMax: 2.4,
    spreadPerShot: 0.12,
    spreadRecovery: 10,
    spreadMoveAdd: 0.25,
    spreadAirAdd: 0.35,
    aimSpreadMul: 0.75,
    crouchSpreadMul: 0.85,
    climbSpreadMul: 1.2,
    zoom: 1.15,
    switchTime: 0.35,
    // Sprint again sooner after firing than with the Hickory.
    sprintLock: 0.15,
    tracerEvery: 2,
    tracerColor: 0xffb070,
    sound: 'smg',
    reloadRate: 1.1,
    bot: { min: 0, max: 22, pref: 8, mobile: true },
  },
  parts: [
    // Receiver with its rail and sights.
    [[0, 0.02, -0.08], [0.068, 0.085, 0.26], METAL],
    [[0, 0.067, -0.08], [0.04, 0.012, 0.2], METAL_LIGHT],
    [[0, 0.082, 0.02], [0.026, 0.02, 0.02], METAL],
    [[0, 0.08, -0.19], [0.006, 0.02, 0.006], METAL],
    // The ammo counter's housing on the rail (the number is `display`).
    [[0, 0.088, -0.075], [0.05, 0.03, 0.07], BORE, { rot: [0.45, 0, 0] }],
    [[-0.0345, 0.03, -0.08], [0.002, 0.03, 0.08], BORE, { bevel: 0 }],
    // The drum magazine and its neck.
    [[0, -0.08, -0.14], [0.062, 0.12, 0.12], ORANGE, { shape: 'cyl', axis: 'x', seg: 18, group: 'mag' }],
    [[0, -0.08, -0.14], [0.068, 0.04, 0.04], METAL, { shape: 'cyl', axis: 'x', group: 'mag' }],
    [[0, -0.025, -0.14], [0.04, 0.03, 0.04], METAL],
    // The vented barrel shroud, its glowing vents and the muzzle.
    [[0, 0.03, -0.29], [0.052, 0.052, 0.16], METAL_LIGHT, { shape: 'cyl', seg: 14 }],
    [[0.026, 0.03, -0.25], [0.004, 0.012, 0.016], GLOW, { bevel: 0 }],
    [[0.026, 0.03, -0.29], [0.004, 0.012, 0.016], GLOW, { bevel: 0 }],
    [[0.026, 0.03, -0.33], [0.004, 0.012, 0.016], GLOW, { bevel: 0 }],
    [[-0.026, 0.03, -0.25], [0.004, 0.012, 0.016], GLOW, { bevel: 0 }],
    [[-0.026, 0.03, -0.29], [0.004, 0.012, 0.016], GLOW, { bevel: 0 }],
    [[-0.026, 0.03, -0.33], [0.004, 0.012, 0.016], GLOW, { bevel: 0 }],
    [[0, 0.03, -0.375], [0.032, 0.032, 0.03], METAL, { shape: 'cyl', bore: 0.6 }],
    // Wire stock and its pad, the grip in the owner's color.
    [[0, 0.035, 0.12], [0.012, 0.012, 0.2], METAL, { shape: 'cyl' }],
    [[0, -0.025, 0.12], [0.012, 0.012, 0.2], METAL, { shape: 'cyl' }],
    [[0, 0.005, 0.225], [0.05, 0.09, 0.014], RUBBER],
    [[0, -0.07, 0.0], [0.04, 0.09, 0.045], null, { rot: [-0.25, 0, 0] }],
    // Trigger guard and trigger.
    [[0, -0.05, -0.065], [0.014, 0.006, 0.07], METAL, { bevel: 0 }],
    [[0, -0.035, -0.1], [0.014, 0.03, 0.006], METAL, { bevel: 0 }],
    [[0, -0.034, -0.05], [0.007, 0.026, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
  ],
  // Gloves and forearms: right hand on the grip, left hand on the drum.
  hands: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.01, -0.09, -0.15], [0.07, 0.06, 0.09], GLOVE],
    [[-0.04, -0.12, -0.1], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.03, -0.38],
  // First-person ammo counter (viewmodel.js).
  display: { at: [0, 0.1025, -0.0683], size: [0.042, 0.056], rot: [-Math.PI / 2 + 0.45, 0, 0] },
  view: { pos: [0.2, -0.2, -0.44], rot: [0.025, 0.06, 0], scale: 0.8, kick: 0.7, flash: 0.8, flashColor: 0xffd080 },
  carry: [0.12, 1.2, -0.3],
};
