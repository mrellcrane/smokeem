import { GLOVE, GLOW, METAL, METAL_LIGHT, RUBBER, WOOD } from '../weaponModels.js';

// Wishbone: a spinning boomerang blade (combat/wishbone.js). Throw it and it flies out, cuts
// whoever it passes on the way out, turns and comes back to your hand, cutting again. It always
// finds its way home; you can't throw again until it's back. A hit wall turns it around early.
// The launcher is a carving fork's handle with the blade (a steel wishbone) riding on top.
export default {
  def: {
    id: 'wishbone',
    name: 'Wishbone',
    blurb: 'Boomerang blade: cuts on the way out and again on the way back. Catch it to throw again.',
    kind: 'wishbone',
    auto: false,
    fireRate: 4,
    // One blade: back in the mag when it's caught (never reloaded, never runs dry).
    mag: 1,
    reserve: 0,
    returns: true,
    reloadTime: 0.5,
    // Out at `speed` for `outTime` s, slowing to a turn; home at `back` m/s; `damage` per cut;
    // `reach` how close it passes to cut someone; `maxTime` until it's back in hand regardless.
    speed: 30,
    outTime: 0.7,
    back: 28,
    damage: 55,
    reach: 0.55,
    maxTime: 3,
    spreadBase: 0,
    spreadMax: 0,
    spreadPerShot: 0,
    spreadRecovery: 0,
    spreadMoveAdd: 0,
    spreadAirAdd: 0,
    aimSpreadMul: 1,
    crouchSpreadMul: 1,
    climbSpreadMul: 1,
    zoom: 1.2,
    switchTime: 0.35,
    sound: 'swing',
    soundRate: 0.7,
    bot: { min: 3, max: 18, pref: 10 },
  },
  parts: [
    // The blade riding on top (group mag: it's gone from the hand while it flies): a steel
    // wishbone, two arms meeting at a knot, glowing edges.
    [[-0.05, 0.11, -0.12], [0.02, 0.012, 0.22], METAL_LIGHT, { rot: [0, 0.38, 0], group: 'mag' }],
    [[0.05, 0.11, -0.12], [0.02, 0.012, 0.22], METAL_LIGHT, { rot: [0, -0.38, 0], group: 'mag' }],
    [[0, 0.11, -0.02], [0.05, 0.016, 0.04], METAL_LIGHT, { group: 'mag' }],
    [[-0.062, 0.117, -0.12], [0.004, 0.004, 0.2], GLOW, { rot: [0, 0.38, 0], bevel: 0, group: 'mag' }],
    [[0.062, 0.117, -0.12], [0.004, 0.004, 0.2], GLOW, { rot: [0, -0.38, 0], bevel: 0, group: 'mag' }],
    // The launcher: a short rail with two catch prongs, a spring housing.
    [[0, 0.06, -0.1], [0.04, 0.05, 0.28], METAL],
    [[-0.03, 0.09, -0.23], [0.01, 0.04, 0.01], METAL_LIGHT],
    [[0.03, 0.09, -0.23], [0.01, 0.04, 0.01], METAL_LIGHT],
    [[0, 0.03, -0.18], [0.05, 0.05, 0.1], METAL_LIGHT, { shape: 'cyl', seg: 12 }],
    [[0, 0.085, -0.1], [0.03, 0.005, 0.2], GLOW, { bevel: 0 }],
    // A carving-fork handle for a grip (wood with brass rivets), the trigger, a wrist brace.
    [[0, -0.05, 0.02], [0.044, 0.11, 0.055], WOOD, { rot: [-0.25, 0, 0] }],
    [[0, -0.04, 0.045], [0.048, 0.012, 0.012], 0xb08a3e, { rot: [-0.25, 0, 0] }],
    [[0, -0.075, 0.035], [0.048, 0.012, 0.012], 0xb08a3e, { rot: [-0.25, 0, 0] }],
    [[0, -0.11, 0.05], [0.046, 0.012, 0.06], null, { rot: [-0.25, 0, 0] }],
    [[0, 0.0, -0.04], [0.007, 0.022, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    [[0, 0.02, 0.12], [0.05, 0.03, 0.12], RUBBER],
  ],
  hands: [
    [[0.0, -0.055, 0.02], [0.064, 0.08, 0.085], GLOVE],
    [[0.03, -0.135, 0.12], [0.062, 0.068, 0.16], GLOVE],
    [[0.034, -0.14, 0.12], [0.067, 0.028, 0.08], null],
  ],
  muzzle: [0, 0.11, -0.24],
  view: { pos: [0.2, -0.19, -0.42], rot: [0.03, 0.06, 0], scale: 0.85, kick: 1.2, flash: 0, flashColor: 0xffffff },
  carry: [0.16, 1.2, -0.34],
};
