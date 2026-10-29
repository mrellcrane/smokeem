import { GLOVE, GLOW, METAL, METAL_LIGHT, WOOD_DARK } from '../weaponModels.js';

// Toothpick: sidearm pistol. Quick to draw, a finisher and a long-range pinger.
export default {
  def: {
    id: 'toothpick',
    name: 'Toothpick',
    blurb: 'Sidearm pistol. Quick to draw: finish people off instead of reloading.',
    kind: 'hitscan',
    auto: false,
    fireRate: 4,
    damage: 20,
    headshotMul: 1.5,
    falloffStart: 25,
    falloffEnd: 55,
    falloffMin: 0.65,
    range: 120,
    mag: 12,
    reserve: 48,
    reloadTime: 1.2,
    spreadBase: 0.35,
    spreadMax: 2.0,
    spreadPerShot: 0.5,
    spreadRecovery: 4,
    spreadMoveAdd: 0.5,
    spreadAirAdd: 1.0,
    aimSpreadMul: 0.6,
    crouchSpreadMul: 0.85,
    climbSpreadMul: 1.3,
    zoom: 1.25,
    switchTime: 0.25,
    tracerColor: 0xffd27a,
    sound: 'pistol',
    reloadSound: 'reloadPistol',
    reloadRate: 1.25,
    bot: { min: 0, max: 45, pref: 14, sidearm: true },
  },
  // Box parts in gun space (barrel along -z, origin at the grip): [center, size, color].
  // A null color means the owner's armor color.
  parts: [
    [[0, 0.045, -0.06], [0.04, 0.06, 0.2], METAL_LIGHT],
    [[0, 0.0, -0.05], [0.038, 0.04, 0.16], METAL],
    [[0, 0.045, -0.19], [0.012, 0.012, 0.06], METAL],
    [[0, 0.08, -0.01], [0.01, 0.008, 0.01], GLOW],
    [[0, -0.06, 0.03], [0.036, 0.1, 0.05], WOOD_DARK],
    [[0, -0.115, 0.04], [0.04, 0.012, 0.055], null],
  ],
  // One-handed: glove on the grip and the forearm behind it.
  hands: [
    [[0.0, -0.055, 0.03], [0.06, 0.075, 0.08], GLOVE],
    [[0.03, -0.13, 0.12], [0.06, 0.065, 0.16], GLOVE],
    [[0.034, -0.135, 0.12], [0.065, 0.028, 0.08], null],
  ],
  muzzle: [0, 0.045, -0.225],
  // First-person resting pose (viewmodel camera space), recoil kick and muzzle flash size.
  view: { pos: [0.19, -0.165, -0.36], rot: [0.03, 0.06, 0], scale: 1, kick: 1.4, flash: 0.7 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.18, 1.2, -0.36],
};
