import { GLOVE, GLOW, METAL, METAL_LIGHT, ORANGE, WOOD_DARK } from '../weaponModels.js';

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
    bot: { min: 0, max: 45, pref: 15, power: true, noAdvance: true, hold: true },
  },
  parts: [
    [[0, 0.03, -0.38], [0.012, 0.012, 0.6], METAL],
    [[0, 0.03, -0.02], [0.16, 0.16, 0.22], METAL],
    [[0, 0.135, -0.02], [0.03, 0.04, 0.16], WOOD_DARK],
    [[0.095, 0.0, 0.0], [0.04, 0.09, 0.14], ORANGE],
    [[0, 0.03, -0.66], [0.13, 0.13, 0.012], GLOW],
    [[0, -0.07, 0.05], [0.045, 0.1, 0.05], WOOD_DARK],
    [[0, -0.01, 0.13], [0.07, 0.07, 0.1], null],
  ],
  // The barrel cluster spins around this point in first person.
  spin: {
    center: [0, 0.03, -0.38],
    parts: [
      [[0.045, 0.03, -0.38], [0.025, 0.025, 0.55], METAL_LIGHT],
      [[0.0225, 0.069, -0.38], [0.025, 0.025, 0.55], METAL_LIGHT],
      [[-0.0225, 0.069, -0.38], [0.025, 0.025, 0.55], METAL_LIGHT],
      [[-0.045, 0.03, -0.38], [0.025, 0.025, 0.55], METAL_LIGHT],
      [[-0.0225, -0.009, -0.38], [0.025, 0.025, 0.55], METAL_LIGHT],
      [[0.0225, -0.009, -0.38], [0.025, 0.025, 0.55], METAL_LIGHT],
    ],
  },
  hands: [
    [[0.005, -0.075, 0.05], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.15], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.15], [0.07, 0.03, 0.08], null],
    [[-0.02, 0.15, -0.02], [0.08, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.03, -0.67],
  view: { pos: [0.22, -0.25, -0.5], rot: [0.03, 0.05, 0], scale: 0.7, kick: 0.5, flash: 1.3, flashColor: 0xffb050 },
  carry: [0.14, 1.15, -0.28],
};
