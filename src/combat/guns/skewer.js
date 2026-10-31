import { BORE, GLOVE, GLOW, METAL, METAL_LIGHT, RUBBER, WOOD } from '../weaponModels.js';

// Skewer: a harpoon gun that fires a barbed kebab skewer (combat/bolts.js, look 'skewer'). Two
// hits smoke anyone, and someone hit with a wall right behind them is pinned to it for a moment
// (stuck in place, still able to shoot). Skewers stay stuck in walls for a while. The barrel is a
// long steel spit with chunks of meat and peppers threaded on it, the stock a cutting board.
export default {
  def: {
    id: 'skewer',
    name: 'Skewer',
    blurb: 'Harpoon gun: two hits smoke anyone, and a hit with a wall behind them pins them to it.',
    kind: 'bolt',
    auto: false,
    fireRate: 1.1,
    mag: 4,
    reserve: 12,
    reloadTime: 2.0,
    // Fast and nearly flat (a little drop at range).
    launchSpeed: 75,
    launchUp: 0,
    launchCarry: 0,
    projectile: {
      look: 'skewer',
      gravity: 3,
      life: 2.5,
      radius: 0.05,
      direct: 76,
      ownerGrace: 0.2,
      straight: true,
      // Within this far of a wall behind the target, along the flight, they're pinned to it.
      pinReach: 2.6,
      pinTime: 1.6,
      // Seconds a skewer stays stuck in a wall (or in someone).
      stick: 6,
    },
    spreadBase: 0,
    spreadMax: 0,
    spreadPerShot: 0,
    spreadRecovery: 0,
    spreadMoveAdd: 0,
    spreadAirAdd: 0,
    aimSpreadMul: 1,
    crouchSpreadMul: 1,
    climbSpreadMul: 1,
    zoom: 1.8,
    switchTime: 0.5,
    sound: 'launch',
    soundRate: 1.5,
    assist: { cone: 5, radius: 0.35, range: 55, slow: 0.4 },
    bot: { min: 4, max: 50, pref: 18, careful: 0.8 },
  },
  parts: [
    // The spit: a long steel rod along the top with a barbed point, chunks of meat and peppers
    // threaded on it.
    [[0, 0.06, -0.28], [0.014, 0.014, 0.62], METAL_LIGHT, { shape: 'cyl', seg: 8 }],
    [[0, 0.06, -0.6], [0.03, 0.03, 0.05], METAL_LIGHT, { shape: 'cyl', seg: 8, taper: 0.1 }],
    [[0.012, 0.06, -0.56], [0.008, 0.024, 0.03], METAL_LIGHT, { rot: [0.6, 0, 0] }],
    [[-0.012, 0.06, -0.56], [0.008, 0.024, 0.03], METAL_LIGHT, { rot: [0.6, 0, 0] }],
    [[0, 0.06, -0.46], [0.05, 0.045, 0.05], 0x7a3a22],
    [[0, 0.06, -0.39], [0.052, 0.044, 0.035], 0x3f8a3a],
    [[0, 0.06, -0.33], [0.05, 0.046, 0.05], 0x7a3a22],
    [[0, 0.06, -0.265], [0.05, 0.044, 0.035], 0xd8462a],
    // The launcher body under it: a rail with a spring housing and an ember strip.
    [[0, 0.015, -0.15], [0.05, 0.05, 0.4], METAL],
    [[0, 0.015, -0.36], [0.06, 0.06, 0.04], METAL_LIGHT, { shape: 'cyl', bore: 0.5 }],
    [[0, 0.015, -0.381], [0.03, 0.03, 0.004], BORE, { shape: 'cyl', bevel: 0 }],
    [[0, 0.043, -0.15], [0.034, 0.006, 0.3], GLOW, { bevel: 0 }],
    [[0, -0.02, -0.05], [0.04, 0.024, 0.14], METAL_LIGHT],
    // Fore grip, pistol grip in the owner's color, trigger, and a cutting-board stock.
    [[0, -0.045, -0.24], [0.034, 0.06, 0.05], RUBBER],
    [[0, -0.06, 0.02], [0.042, 0.1, 0.05], null, { rot: [-0.25, 0, 0] }],
    [[0, -0.01, -0.02], [0.007, 0.022, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    [[0, 0.0, 0.17], [0.05, 0.08, 0.2], WOOD, { taper: [0.9, 0.8] }],
  ],
  hands: [
    [[0.005, -0.075, 0.02], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.12], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.12], [0.07, 0.03, 0.08], null],
    [[-0.005, -0.06, -0.24], [0.075, 0.06, 0.09], GLOVE],
    [[-0.035, -0.1, -0.19], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.06, -0.62],
  view: { pos: [0.21, -0.215, -0.5], rot: [0.025, 0.06, 0], scale: 0.72, kick: 2.2, flash: 0.6, flashColor: 0xffe0b0 },
  carry: [0.12, 1.2, -0.3],
};
