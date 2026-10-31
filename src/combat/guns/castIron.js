import { BORE, GLOVE, GLOW, METAL, METAL_LIGHT, RUBBER, WOOD_DARK } from '../weaponModels.js';

// Cast Iron: a ricochet hand cannon. Its heavy slugs bank off walls, floors and ceilings up to
// twice (shooting.js fireRicochet), each bounce keeping most of the damage, so you can hit
// someone around a corner or behind cover. A ricochet that lands is a bank shot. The barrel is
// a skillet's handle, the frame a black iron pan with a pour spout for a muzzle brake.
export default {
  def: {
    id: 'castIron',
    name: 'Cast Iron',
    blurb: 'Ricochet hand cannon: slugs bank off walls twice. Bounce one round a corner.',
    kind: 'ricochet',
    auto: false,
    fireRate: 2.6,
    damage: 38,
    headshotMul: 1.5,
    falloffStart: 30,
    falloffEnd: 70,
    falloffMin: 0.75,
    range: 90,
    // Bounces, the share of damage each one keeps, and how far a bounced slug flies at most.
    bounces: 2,
    bounceKeep: 0.85,
    mag: 6,
    reserve: 30,
    reloadTime: 1.7,
    spreadBase: 0.35,
    spreadMax: 2.2,
    spreadPerShot: 0.9,
    spreadRecovery: 3.2,
    spreadMoveAdd: 0.6,
    spreadAirAdd: 1.5,
    aimSpreadMul: 0.45,
    crouchSpreadMul: 0.85,
    climbSpreadMul: 1.4,
    zoom: 1.4,
    switchTime: 0.3,
    tracerColor: 0xffd090,
    tracerWidth: 0.026,
    tracerLife: 0.14,
    sound: 'pistol',
    soundRate: 0.66,
    reloadSound: 'reloadPistol',
    reloadRate: 0.85,
    assist: { cone: 5, radius: 0.3, range: 50, slow: 0.45 },
    bot: { min: 0, max: 45, pref: 14, sidearm: true },
  },
  parts: [
    // The pan: a round black iron frame over the grip, a rim and a pour spout up front.
    [[0, 0.03, -0.02], [0.13, 0.05, 0.13], METAL, { shape: 'cyl', axis: 'y', seg: 18 }],
    [[0, 0.058, -0.02], [0.14, 0.012, 0.14], METAL_LIGHT, { shape: 'cyl', axis: 'y', seg: 18, bore: 0.86 }],
    [[0, 0.04, -0.09], [0.04, 0.03, 0.03], METAL, { rot: [0.3, 0, 0] }],
    // The barrel is the skillet's handle: long, square, with a hole in the end (the bore).
    [[0, 0.04, -0.2], [0.04, 0.04, 0.2], METAL, { taper: [0.92, 0.92] }],
    [[0, 0.04, -0.305], [0.05, 0.05, 0.02], METAL_LIGHT, { shape: 'cyl', bore: 0.55 }],
    [[0, 0.04, -0.316], [0.024, 0.024, 0.004], BORE, { shape: 'cyl', bevel: 0 }],
    // A glowing ember stripe on the handle, the hammer and the rear sight.
    [[0, 0.061, -0.2], [0.012, 0.004, 0.16], GLOW, { bevel: 0 }],
    [[0, 0.072, 0.045], [0.014, 0.026, 0.016], METAL_LIGHT, { rot: [-0.5, 0, 0] }],
    [[0, 0.07, -0.29], [0.008, 0.014, 0.01], METAL_LIGHT],
    // Grip wrapped in a wood handle, a base in the owner's color, the trigger and guard.
    [[0, -0.06, 0.03], [0.042, 0.11, 0.055], WOOD_DARK, { rot: [-0.3, 0, 0] }],
    [[0, -0.118, 0.05], [0.046, 0.012, 0.06], null, { rot: [-0.3, 0, 0] }],
    [[0, -0.02, -0.04], [0.012, 0.005, 0.06], METAL, { bevel: 0 }],
    [[0, -0.008, -0.058], [0.006, 0.02, 0.007], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    [[0, -0.01, -0.075], [0.012, 0.03, 0.005], RUBBER, { bevel: 0 }],
  ],
  hands: [
    [[0.0, -0.06, 0.03], [0.064, 0.08, 0.085], GLOVE],
    [[0.03, -0.14, 0.13], [0.062, 0.068, 0.16], GLOVE],
    [[0.034, -0.145, 0.13], [0.067, 0.028, 0.08], null],
  ],
  muzzle: [0, 0.04, -0.32],
  view: { pos: [0.19, -0.17, -0.38], rot: [0.03, 0.06, 0], scale: 0.85, kick: 2.8, flash: 1.0, flashColor: 0xffc070 },
  carry: [0.18, 1.2, -0.36],
};
