import { GLOVE, METAL, METAL_LIGHT, ORANGE, RUBBER, WOOD_DARK } from '../weaponModels.js';

// Sauce Boss: lobs globs of hot barbecue sauce (combat/bolts.js, look 'glob') that splat into a
// slick puddle where they land (combat/sauce.js). In a puddle you slide around and slow down,
// and you come out Basted: you take more damage for a few seconds. A direct hit bastes too. The
// power gun of Sauce on the Side. A pressure tank of sauce on top, a basting-brush muzzle.
export default {
  def: {
    id: 'sauceBoss',
    name: 'Sauce Boss',
    blurb: 'Lobs hot sauce that splats into slick puddles: slide, slow down, and get Basted (take more damage).',
    kind: 'bolt',
    auto: false,
    fireRate: 1.6,
    mag: 5,
    reserve: 10,
    reloadTime: 1.8,
    launchSpeed: 22,
    launchUp: 2.5,
    projectile: {
      look: 'glob',
      gravity: 16,
      life: 3,
      radius: 0.12,
      direct: 45,
      ownerGrace: 0.3,
      glow: 0xc23a1a,
      // A small splash where it lands, and the puddle it leaves (sauce.js).
      explosion: { radius: 2.2, inner: 0.6, damage: 25, knockback: 3, tint: 0xc23a1a },
      puddle: { radius: 2.8, time: 9 },
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
    zoom: 1.1,
    switchTime: 0.45,
    sound: 'pop',
    soundRate: 0.7,
    padRespawn: 60,
    bot: { min: 5, max: 22, pref: 13, lob: true, power: true },
  },
  parts: [
    // The tank: a red pressure bottle of sauce lying on top, its cap and gauge.
    [[0, 0.09, -0.12], [0.1, 0.1, 0.26], 0xa02a16, { shape: 'cyl', seg: 16 }],
    [[0, 0.09, -0.26], [0.07, 0.07, 0.03], METAL_LIGHT, { shape: 'cyl', seg: 14 }],
    [[0, 0.145, -0.08], [0.03, 0.03, 0.012], METAL_LIGHT, { shape: 'cyl', axis: 'y', seg: 12 }],
    [[0, 0.152, -0.08], [0.024, 0.024, 0.004], 0xf2e6c8, { shape: 'cyl', axis: 'y', seg: 12, bevel: 0 }],
    [[0, 0.09, -0.12], [0.104, 0.104, 0.02], 0xffd9a0, { shape: 'cyl', seg: 16 }],
    // The barrel: a wide steel pipe, sauce dripping glow at the mouth, a brush collar.
    [[0, 0.02, -0.22], [0.06, 0.06, 0.34], METAL, { shape: 'cyl', seg: 14 }],
    [[0, 0.02, -0.4], [0.08, 0.08, 0.04], METAL_LIGHT, { shape: 'cyl', seg: 14, bore: 0.7 }],
    [[0, 0.02, -0.421], [0.05, 0.05, 0.004], 0xc23a1a, { shape: 'cyl', seg: 14, bevel: 0, finish: 'glow' }],
    [[0, 0.02, -0.34], [0.075, 0.075, 0.04], 0xd8c098, { shape: 'cyl', seg: 14 }],
    // The hose from the tank down into the barrel.
    [[0.04, 0.06, -0.24], [0.016, 0.06, 0.016], RUBBER, { shape: 'cyl', axis: 'y' }],
    // Body, grips (one in the owner's color), trigger, stock.
    [[0, -0.01, -0.02], [0.06, 0.06, 0.2], METAL],
    [[0, -0.035, -0.2], [0.035, 0.06, 0.05], RUBBER],
    [[0, -0.07, 0.02], [0.045, 0.1, 0.05], null, { rot: [-0.25, 0, 0] }],
    [[0, -0.03, -0.03], [0.007, 0.022, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    [[0, 0.0, 0.15], [0.055, 0.07, 0.16], WOOD_DARK, { taper: [0.9, 0.85] }],
    [[0, -0.044, -0.04], [0.03, 0.01, 0.05], ORANGE],
  ],
  hands: [
    [[0.005, -0.075, 0.02], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.12], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.12], [0.07, 0.03, 0.08], null],
    [[-0.005, -0.06, -0.2], [0.075, 0.06, 0.09], GLOVE],
    [[-0.035, -0.1, -0.15], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.02, -0.43],
  view: { pos: [0.22, -0.22, -0.46], rot: [0.03, 0.06, 0], scale: 0.75, kick: 1.8, flash: 0.4, flashColor: 0xc23a1a },
  carry: [0.12, 1.2, -0.3],
};
