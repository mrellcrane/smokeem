import { BORE, GLOVE, GLOW, METAL, METAL_LIGHT, WOOD_DARK } from '../weaponModels.js';

// Toothpick: sidearm pistol. Quick to draw, a finisher and a long-range pinger.
export default {
  def: {
    id: 'toothpick',
    name: 'Toothpick',
    blurb: 'Sidearm pistol. Quick to draw: finish people off instead of reloading.',
    kind: 'hitscan',
    // One in each hand (Halo 2's dual wielding): the left fires on LT or right click.
    dual: true,
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
    // Controller aim assist (combat/aimAssist.js): cone cap (degrees), reach past the body (m),
    // range (m, also the red reticle's).
    assist: { cone: 6, radius: 0.32, range: 50 },
    bot: { min: 0, max: 45, pref: 14, sidearm: true },
  },
  parts: [
    // Slide with its grip serrations, sights and the muzzle; the frame and its rail.
    [[0, 0.047, -0.06], [0.036, 0.05, 0.21], METAL_LIGHT, { taper: [0.95, 0.9] }],
    [[-0.0185, 0.047, 0.005], [0.002, 0.034, 0.004], BORE, { bevel: 0 }],
    [[-0.0185, 0.047, 0.015], [0.002, 0.034, 0.004], BORE, { bevel: 0 }],
    [[-0.0185, 0.047, 0.025], [0.002, 0.034, 0.004], BORE, { bevel: 0 }],
    [[0.0185, 0.047, 0.005], [0.002, 0.034, 0.004], BORE, { bevel: 0 }],
    [[0.0185, 0.047, 0.015], [0.002, 0.034, 0.004], BORE, { bevel: 0 }],
    [[0.0185, 0.047, 0.025], [0.002, 0.034, 0.004], BORE, { bevel: 0 }],
    [[0.016, 0.06, -0.04], [0.006, 0.014, 0.05], BORE, { bevel: 0 }],
    [[0, 0.075, -0.145], [0.006, 0.01, 0.01], METAL],
    [[0, 0.081, -0.145], [0.006, 0.006, 0.004], GLOW],
    [[0, 0.077, 0.03], [0.028, 0.012, 0.012], METAL],
    [[0, 0.045, -0.17], [0.018, 0.018, 0.016], METAL, { shape: 'cyl', bore: 0.6 }],
    [[0, 0.006, -0.06], [0.034, 0.036, 0.17], METAL],
    [[0, -0.016, -0.11], [0.03, 0.012, 0.07], METAL_LIGHT],
    [[0, 0.06, 0.045], [0.01, 0.022, 0.012], METAL, { rot: [-0.4, 0, 0] }],
    // Grip raked back with its base plate in the owner's color, trigger guard and trigger.
    [[0, -0.055, 0.03], [0.036, 0.1, 0.052], WOOD_DARK, { rot: [-0.25, 0, 0] }],
    [[0, -0.108, 0.045], [0.04, 0.012, 0.056], null, { rot: [-0.25, 0, 0] }],
    [[0, -0.03, -0.05], [0.012, 0.005, 0.06], METAL, { bevel: 0 }],
    [[0, -0.02, -0.08], [0.012, 0.025, 0.005], METAL, { bevel: 0 }],
    [[0, -0.018, -0.042], [0.006, 0.02, 0.007], METAL_LIGHT, { rot: [0.25, 0, 0] }],
  ],
  // One-handed: glove on the grip and the forearm behind it.
  hands: [
    [[0.0, -0.055, 0.03], [0.06, 0.075, 0.08], GLOVE],
    [[0.03, -0.13, 0.12], [0.06, 0.065, 0.16], GLOVE],
    [[0.034, -0.135, 0.12], [0.065, 0.028, 0.08], null],
  ],
  muzzle: [0, 0.045, -0.225],
  // First-person resting pose (viewmodel camera space), recoil kick and muzzle flash size.
  view: { pos: [0.19, -0.165, -0.36], rot: [0.03, 0.06, 0], scale: 0.85, kick: 1.4, flash: 0.7, flashColor: 0xffe0a0 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.18, 1.2, -0.36],
};
