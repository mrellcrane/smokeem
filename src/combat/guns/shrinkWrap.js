import { GLOVE, METAL, METAL_LIGHT, ORANGE, SCREEN } from '../weaponModels.js';

// Shrink Wrap: a 1950s ray gun that changes people's size for SIZE.time (config.js). Fire
// shrinks (small, slow, weak shots, and anyone who lands on you smokes you); the aim button
// grows instead (big, slow, takes more damage, and a second grow while still big pops you).
// Shrinking someone big or growing someone small puts them back to normal. It does no damage of
// its own. A power gun: never in a loadout.
export default {
  def: {
    id: 'shrinkWrap',
    name: 'Shrink Wrap',
    blurb: 'Ray gun. Fire shrinks (then stomp them), aim grows (grow them twice and they pop).',
    kind: 'size',
    auto: false,
    fireRate: 1.6,
    damage: 0,
    headshotMul: 1,
    falloffStart: 60,
    falloffEnd: 61,
    falloffMin: 1,
    range: 60,
    // Charges: every zap, either way, uses one.
    mag: 8,
    reserve: 0,
    reloadTime: 1,
    spreadBase: 0.2,
    spreadMax: 0.6,
    spreadPerShot: 0.2,
    spreadRecovery: 2,
    spreadMoveAdd: 0.3,
    spreadAirAdd: 0.6,
    aimSpreadMul: 1,
    crouchSpreadMul: 0.85,
    climbSpreadMul: 1.3,
    // No scope: the aim button is the grow ray.
    zoom: 1,
    switchTime: 0.35,
    tracerColor: 0x63f2ff,
    growColor: 0xff5ad8,
    tracerWidth: 0.05,
    tracerLife: 0.25,
    sound: 'shrinkZap',
    bot: { min: 0, max: 40, pref: 12, power: true },
  },
  parts: [
    // A round body with a tapered back, three fins, the emitter tube with its rings and tip.
    [[0, 0.045, -0.07], [0.09, 0.09, 0.15], METAL_LIGHT, { shape: 'cyl', seg: 16 }],
    [[0, 0.045, 0.02], [0.07, 0.07, 0.04], METAL, { shape: 'cyl', seg: 16, taper: 0.6, rot: [Math.PI, 0, 0] }],
    [[0, 0.1, -0.03], [0.012, 0.05, 0.09], ORANGE, { taper: [1, 0.5] }],
    [[0.05, 0.045, 0.0], [0.012, 0.05, 0.06], ORANGE],
    [[-0.05, 0.045, 0.0], [0.012, 0.05, 0.06], ORANGE],
    [[0, 0.045, -0.23], [0.035, 0.035, 0.18], METAL, { shape: 'cyl' }],
    [[0, 0.045, -0.17], [0.065, 0.065, 0.014], SCREEN, { shape: 'cyl', seg: 16 }],
    [[0, 0.045, -0.22], [0.075, 0.075, 0.014], SCREEN, { shape: 'cyl', seg: 16 }],
    [[0, 0.045, -0.27], [0.085, 0.085, 0.014], SCREEN, { shape: 'cyl', seg: 16 }],
    [[0, 0.045, -0.33], [0.05, 0.05, 0.03], SCREEN, { shape: 'cyl', seg: 16, taper: 0.6 }],
    // Grip in the owner's color on a metal handle.
    [[0, 0.01, 0.02], [0.05, 0.04, 0.07], null],
    [[0, -0.055, 0.03], [0.038, 0.1, 0.05], METAL, { rot: [-0.25, 0, 0] }],
  ],
  // One-handed: glove on the grip and the forearm behind it.
  hands: [
    [[0.0, -0.055, 0.03], [0.06, 0.075, 0.08], GLOVE],
    [[0.03, -0.13, 0.12], [0.06, 0.065, 0.16], GLOVE],
    [[0.034, -0.135, 0.12], [0.065, 0.028, 0.08], null],
  ],
  muzzle: [0, 0.045, -0.35],
  view: { pos: [0.2, -0.17, -0.42], rot: [0.03, 0.06, 0], scale: 0.62, kick: 0.9, flash: 0.6, flashColor: 0x63f2ff },
  carry: [0.18, 1.2, -0.36],
};
