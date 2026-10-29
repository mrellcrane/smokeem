import { GLOVE, GLOW, METAL, METAL_LIGHT, WOOD, WOOD_DARK } from '../weaponModels.js';

// Hickory: full-auto mid-range rifle. The workhorse.
export default {
  def: {
    id: 'hickory',
    name: 'Hickory',
    blurb: 'Full-auto rifle. The workhorse at mid range; long sprays bloom.',
    kind: 'hitscan',
    auto: true,
    fireRate: 9, // shots per second
    damage: 13,
    headshotMul: 1.5,
    // Damage falls off linearly from falloffStart to falloffEnd meters, down to falloffMin.
    falloffStart: 35,
    falloffEnd: 80,
    falloffMin: 0.6,
    range: 150,
    mag: 32,
    reserve: 160,
    reloadTime: 1.7,
    spreadBase: 0.5,
    // Bloom caps at 3.1 degrees hip-fire after about 13 rounds.
    spreadMax: 2.6,
    spreadPerShot: 0.2,
    spreadRecovery: 8, // degrees per second
    spreadMoveAdd: 0.9,
    spreadAirAdd: 1.4,
    aimSpreadMul: 0.5,
    crouchSpreadMul: 0.8,
    climbSpreadMul: 1.6,
    zoom: 1.35,
    tracerColor: 0xffc070,
    sound: 'shot',
    // Range band bots like to use it in, meters.
    bot: { min: 0, max: 70, pref: 18 },
  },
  // Box parts in gun space (barrel along -z, origin at the grip): [center, size, color].
  // A null color means the owner's armor color.
  parts: [
    [[0, 0.02, -0.12], [0.07, 0.09, 0.34], METAL],
    [[0, 0.073, -0.12], [0.03, 0.016, 0.26], METAL_LIGHT],
    [[0, 0.092, -0.03], [0.032, 0.03, 0.05], METAL],
    [[0, 0.092, -0.056], [0.012, 0.012, 0.004], GLOW],
    [[0, 0.012, -0.37], [0.082, 0.072, 0.22], WOOD],
    [[0, 0.02, -0.53], [0.03, 0.03, 0.14], METAL],
    [[0, 0.02, -0.615], [0.048, 0.048, 0.05], METAL_LIGHT],
    [[0, -0.01, 0.12], [0.06, 0.08, 0.2], WOOD],
    [[0, -0.02, 0.225], [0.07, 0.11, 0.03], WOOD_DARK],
    [[0, -0.07, -0.02], [0.045, 0.1, 0.05], METAL],
    [[0, -0.085, -0.17], [0.05, 0.13, 0.07], METAL],
    [[0, -0.07, -0.134], [0.052, 0.022, 0.003], GLOW],
  ],
  // Gloves and forearms for the first-person view.
  hands: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.03, -0.38], [0.075, 0.055, 0.1], GLOVE],
    [[-0.035, -0.07, -0.33], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.02, -0.65],
  // First-person resting pose (viewmodel camera space), recoil kick and muzzle flash size.
  view: { pos: [0.21, -0.215, -0.48], rot: [0.025, 0.06, 0], scale: 0.72, kick: 1, flash: 1, flashColor: 0xffc070 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.12, 1.2, -0.3],
};
