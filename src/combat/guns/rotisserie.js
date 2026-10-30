import { GLOVE, GLOW, METAL, METAL_LIGHT, ORANGE, RUBBER, WOOD_DARK } from '../weaponModels.js';

// Rotisserie: spin-up rotary gun, the power weapon. Highest sustained damage in the game, paid
// for with a windup everyone hears and a slow walk while the barrels turn.
export default {
  def: {
    id: 'rotisserie',
    name: 'Rotisserie',
    blurb: 'Rotary gun. Hold to spin up, then 18 rounds a second; slow to move while it spins.',
    kind: 'hitscan',
    auto: true,
    // Barrels spin up while the trigger is held (no ammo used) and spin down when released.
    spinUp: 0.5,
    spinDown: 1.0,
    // Move speed while the barrels turn (and no sprinting).
    spinMoveMul: 0.6,
    fireRate: 18,
    damage: 8,
    headshotMul: 1.5,
    falloffStart: 25,
    falloffEnd: 60,
    falloffMin: 0.5,
    range: 120,
    mag: 100,
    reserve: 100,
    reloadTime: 3.0,
    spreadBase: 1.4,
    spreadMax: 1.4,
    spreadPerShot: 0.04,
    spreadRecovery: 6,
    spreadMoveAdd: 0.8,
    spreadAirAdd: 1.6,
    aimSpreadMul: 0.7,
    crouchSpreadMul: 0.8,
    climbSpreadMul: 1.6,
    zoom: 1.15,
    switchTime: 0.7,
    tracerEvery: 3,
    tracerColor: 0xffc070,
    // One slice of a burst recording every 0.15 s instead of a sample per round (each slice
    // plays about 0.22 s, so they overlap whichever tick the next round lands on).
    sound: 'rotisserie',
    soundEvery: 0.15,
    soundRate: 1.2,
    reloadRate: 0.8,
    // Controller aim assist (combat/aimAssist.js): cone cap (degrees), reach past the body (m),
    // range (m, also the red reticle's).
    assist: { cone: 6, radius: 0.3, range: 45 },
    bot: { min: 0, max: 45, pref: 15, power: true, noAdvance: true, hold: true },
  },
  parts: [
    // The axle and the clamps the barrels turn in.
    [[0, 0.03, -0.38], [0.02, 0.02, 0.6], METAL, { shape: 'cyl' }],
    [[0, 0.03, -0.4], [0.136, 0.136, 0.02], METAL, { shape: 'cyl', seg: 14 }],
    [[0, 0.03, -0.625], [0.136, 0.136, 0.02], METAL, { shape: 'cyl', seg: 14 }],
    // The motor housing, its front plate and tapered back, a glow strip on each side.
    [[0, 0.03, -0.02], [0.16, 0.16, 0.22], METAL, { shape: 'cyl', seg: 12 }],
    [[0, 0.03, -0.14], [0.15, 0.15, 0.03], METAL_LIGHT, { shape: 'cyl', seg: 12 }],
    [[0, 0.03, 0.1], [0.13, 0.13, 0.04], METAL_LIGHT, { shape: 'cyl', seg: 12, taper: 0.75, rot: [Math.PI, 0, 0] }],
    [[-0.08, 0.03, -0.02], [0.006, 0.03, 0.14], GLOW, { bevel: 0 }],
    [[0.08, 0.06, -0.02], [0.006, 0.03, 0.14], GLOW, { bevel: 0 }],
    [[0, -0.05, -0.09], [0.07, 0.06, 0.1], METAL],
    // The carry handle on top, the ammo box and its feed on the right.
    [[0, 0.12, 0.04], [0.022, 0.034, 0.022], METAL],
    [[0, 0.12, -0.08], [0.022, 0.034, 0.022], METAL],
    [[0, 0.145, -0.02], [0.032, 0.032, 0.15], RUBBER, { shape: 'cyl' }],
    [[0.1, 0.0, 0.0], [0.045, 0.1, 0.14], ORANGE],
    [[0.082, 0.04, -0.06], [0.02, 0.03, 0.05], METAL],
    // Grip and a pad in the owner's color.
    [[0, -0.07, 0.05], [0.045, 0.1, 0.05], WOOD_DARK, { rot: [-0.2, 0, 0] }],
    [[0, -0.01, 0.14], [0.07, 0.07, 0.08], null],
  ],
  // The barrel cluster spins around this point in first person.
  spin: {
    center: [0, 0.03, -0.38],
    parts: [
      [[0.045, 0.03, -0.38], [0.026, 0.026, 0.55], METAL_LIGHT, { shape: 'cyl', seg: 8, bore: 0.5 }],
      [[0.0225, 0.069, -0.38], [0.026, 0.026, 0.55], METAL_LIGHT, { shape: 'cyl', seg: 8, bore: 0.5 }],
      [[-0.0225, 0.069, -0.38], [0.026, 0.026, 0.55], METAL_LIGHT, { shape: 'cyl', seg: 8, bore: 0.5 }],
      [[-0.045, 0.03, -0.38], [0.026, 0.026, 0.55], METAL_LIGHT, { shape: 'cyl', seg: 8, bore: 0.5 }],
      [[-0.0225, -0.009, -0.38], [0.026, 0.026, 0.55], METAL_LIGHT, { shape: 'cyl', seg: 8, bore: 0.5 }],
      [[0.0225, -0.009, -0.38], [0.026, 0.026, 0.55], METAL_LIGHT, { shape: 'cyl', seg: 8, bore: 0.5 }],
    ],
  },
  hands: [
    [[0.005, -0.075, 0.05], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.15], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.15], [0.07, 0.03, 0.08], null],
    [[-0.02, 0.15, -0.02], [0.08, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.03, -0.67],
  // First-person ammo counter: a panel on the motor housing's upper left, facing you (viewmodel.js).
  display: { at: [-0.0476, 0.098, 0.0], size: [0.06, 0.045], normal: [-0.574, 0.819, 0], up: [0.819, 0.574, 0] },
  view: { pos: [0.22, -0.25, -0.5], rot: [0.03, 0.05, 0], scale: 0.7, kick: 0.5, flash: 1.3, flashColor: 0xffb050 },
  carry: [0.14, 1.15, -0.28],
};
