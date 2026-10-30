import { BORE, BRASS, GLOVE, GLOW, METAL, METAL_LIGHT, WOOD_DARK } from '../weaponModels.js';

// Carver: a heavy hand cannon with a short 2x scope, after the long-range pistols of the first
// Halo (owner pick). Slow, hard-hitting rounds: three headshots smoke anyone, five to the body.
// A long slab barrel with cooling cuts, a meat-probe dial on the side, a wooden grip.
export default {
  def: {
    id: 'carver',
    name: 'Carver',
    blurb: 'Hand cannon with a 2x scope. Three headshots smoke anyone, if you can land them.',
    kind: 'hitscan',
    auto: false,
    fireRate: 2.4,
    damage: 45,
    headshotMul: 1.5,
    falloffStart: 40,
    falloffEnd: 90,
    falloffMin: 0.7,
    range: 140,
    mag: 12,
    reserve: 36,
    reloadTime: 1.5,
    spreadBase: 0.3,
    spreadMax: 1.8,
    spreadPerShot: 0.7,
    spreadRecovery: 3.5,
    spreadMoveAdd: 0.6,
    spreadAirAdd: 1.5,
    aimSpreadMul: 0.3,
    crouchSpreadMul: 0.85,
    climbSpreadMul: 1.4,
    zoom: 2,
    // Zoomed, the view goes through its scope (no gun on screen).
    scope: true,
    switchTime: 0.3,
    tracerColor: 0xffb060,
    tracerWidth: 0.024,
    tracerLife: 0.12,
    sound: 'pistol',
    soundRate: 0.78,
    reloadSound: 'reloadPistol',
    reloadRate: 1.0,
    // Controller aim assist (combat/aimAssist.js): cone cap (degrees), reach past the body (m),
    // range (m, also the red reticle's).
    assist: { cone: 6, radius: 0.32, range: 65, slow: 0.45 },
    bot: { min: 0, max: 65, pref: 18, sidearm: true, zoomAt: 20, careful: 0.8, headshots: true },
  },
  parts: [
    // The slab: a long, deep barrel shroud with cooling cuts along both sides, a heavy muzzle.
    [[0, 0.05, -0.1], [0.04, 0.062, 0.29], METAL_LIGHT, { taper: [0.97, 0.92] }],
    [[-0.0205, 0.052, -0.17], [0.002, 0.03, 0.012], BORE, { bevel: 0 }],
    [[-0.0205, 0.052, -0.14], [0.002, 0.03, 0.012], BORE, { bevel: 0 }],
    [[-0.0205, 0.052, -0.11], [0.002, 0.03, 0.012], BORE, { bevel: 0 }],
    [[0.0205, 0.052, -0.17], [0.002, 0.03, 0.012], BORE, { bevel: 0 }],
    [[0.0205, 0.052, -0.14], [0.002, 0.03, 0.012], BORE, { bevel: 0 }],
    [[0.0205, 0.052, -0.11], [0.002, 0.03, 0.012], BORE, { bevel: 0 }],
    [[0, 0.05, -0.255], [0.046, 0.046, 0.03], METAL, { shape: 'cyl', bore: 0.55 }],
    [[0, 0.006, -0.08], [0.038, 0.04, 0.22], METAL],
    // The scope: a short tube on a rail, dark glass toward you with a glowing red dot.
    [[0, 0.098, -0.08], [0.012, 0.01, 0.12], METAL],
    [[0, 0.118, -0.08], [0.032, 0.032, 0.11], METAL, { shape: 'cyl' }],
    [[0, 0.118, -0.14], [0.038, 0.038, 0.016], METAL_LIGHT, { shape: 'cyl' }],
    [[0, 0.118, -0.024], [0.026, 0.026, 0.004], 0x1e3540, { shape: 'cyl', bevel: 0, finish: 'metal' }],
    [[0, 0.118, -0.0215], [0.005, 0.005, 0.002], 0xff5030, { shape: 'cyl', bevel: 0, finish: 'glow' }],
    // The meat-probe dial on the left side (its needle glows), the hammer, the rear sight.
    [[-0.024, 0.04, 0.0], [0.006, 0.034, 0.034], BRASS, { shape: 'cyl', axis: 'x' }],
    [[-0.028, 0.044, 0.0], [0.002, 0.014, 0.003], GLOW, { bevel: 0, rot: [0, 0, 0.6] }],
    [[0, 0.066, 0.05], [0.012, 0.024, 0.014], METAL, { rot: [-0.45, 0, 0] }],
    // Grip raked back with a base plate in the owner's color, the trigger guard and trigger.
    [[0, -0.06, 0.035], [0.04, 0.11, 0.056], WOOD_DARK, { rot: [-0.28, 0, 0] }],
    [[0, -0.117, 0.052], [0.044, 0.012, 0.06], null, { rot: [-0.28, 0, 0] }],
    [[0, -0.032, -0.05], [0.012, 0.005, 0.06], METAL, { bevel: 0 }],
    [[0, -0.022, -0.08], [0.012, 0.026, 0.005], METAL, { bevel: 0 }],
    [[0, -0.02, -0.042], [0.006, 0.02, 0.007], METAL_LIGHT, { rot: [0.25, 0, 0] }],
  ],
  // One-handed: glove on the grip and the forearm behind it.
  hands: [
    [[0.0, -0.06, 0.035], [0.064, 0.08, 0.085], GLOVE],
    [[0.03, -0.14, 0.13], [0.062, 0.068, 0.16], GLOVE],
    [[0.034, -0.145, 0.13], [0.067, 0.028, 0.08], null],
  ],
  muzzle: [0, 0.05, -0.275],
  // First-person resting pose (viewmodel camera space), recoil kick and muzzle flash size.
  view: { pos: [0.19, -0.17, -0.38], rot: [0.03, 0.06, 0], scale: 0.85, kick: 2.6, flash: 1.0, flashColor: 0xffc070 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.18, 1.2, -0.36],
};
