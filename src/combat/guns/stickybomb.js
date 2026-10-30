import { GLOVE, GLOW, METAL, METAL_LIGHT, RUBBER, SHELL_RED } from '../weaponModels.js';

// Stickybomb Launcher (TF2's): lobs sticky bombs that cling to walls, floors and ceilings (not
// to people), arm after a moment, and all go off together on the aim button. Up to 6 out at
// once (a 7th sets off the oldest); they vanish when you're smoked. Your own blast throws you,
// so sticky jumps work.
export default {
  def: {
    id: 'stickybomb',
    name: 'Stickybomb Launcher',
    blurb: 'Sticky bombs that cling to any wall or floor. Aim button sets them all off; sticky jumps hurt.',
    kind: 'launcher',
    auto: false,
    fireRate: 1.6,
    mag: 8,
    reserve: 24,
    reloadTime: 0.6,
    reloadPerShell: true,
    spreadBase: 0,
    spreadMax: 0,
    spreadPerShot: 0,
    spreadRecovery: 0,
    spreadMoveAdd: 0,
    spreadAirAdd: 0,
    aimSpreadMul: 1,
    crouchSpreadMul: 1,
    climbSpreadMul: 1,
    // The aim button detonates instead of zooming.
    zoom: 1,
    detonateOnAim: true,
    switchTime: 0.45,
    launchSpeed: 22,
    launchUp: 2.5,
    projectile: {
      look: 'sticky',
      fuse: Infinity,
      sticky: true,
      armTime: 0.7,
      maxOut: 6,
      damping: 0.1,
      restitution: 0.1,
      explosion: { radius: 3.6, inner: 0.6, damage: 95, knockback: 14, tint: 0xff5a3a, volume: 0.9, rate: 1.05 },
    },
    sound: 'chimney',
    soundRate: 0.85,
    padRespawn: 40,
    // Bots lob them near you; theirs go off by themselves when someone walks over one.
    bot: { min: 4, max: 18, pref: 10, lob: true },
  },
  parts: [
    // Barrel with red bands and a rail, the revolving drum glowing on each side.
    [[0, 0.03, -0.26], [0.09, 0.09, 0.46], METAL, { shape: 'cyl', seg: 16, bore: 0.72 }],
    [[0, 0.03, -0.465], [0.1, 0.1, 0.03], SHELL_RED, { shape: 'cyl', seg: 16 }],
    [[0, 0.03, -0.3], [0.1, 0.1, 0.025], SHELL_RED, { shape: 'cyl', seg: 16 }],
    [[0, 0.081, -0.2], [0.02, 0.012, 0.3], METAL_LIGHT],
    [[0, 0.094, -0.06], [0.012, 0.02, 0.012], METAL],
    [[0, -0.045, -0.12], [0.13, 0.13, 0.15], METAL_LIGHT, { shape: 'cyl', seg: 12 }],
    [[0, -0.045, -0.12], [0.04, 0.04, 0.16], METAL, { shape: 'cyl' }],
    [[0.066, -0.045, -0.12], [0.006, 0.05, 0.1], GLOW, { bevel: 0 }],
    [[-0.066, -0.045, -0.12], [0.006, 0.05, 0.1], GLOW, { bevel: 0 }],
    // Grip, the rear body, a pad in the owner's color.
    [[0, -0.08, 0.0], [0.045, 0.1, 0.05], RUBBER, { rot: [-0.3, 0, 0] }],
    [[0, 0.0, 0.1], [0.07, 0.08, 0.16], METAL],
    [[0, -0.02, 0.19], [0.064, 0.106, 0.04], null],
  ],
  hands: [
    [[0.005, -0.085, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.16, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.165, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.02, -0.33], [0.08, 0.055, 0.1], GLOVE],
    [[-0.04, -0.06, -0.28], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.03, -0.5],
  view: { pos: [0.2, -0.2, -0.44], rot: [0.03, 0.06, 0], scale: 0.75, kick: 2.6, flash: 1.3, flashColor: 0xff5a3a },
  carry: [0.12, 1.2, -0.3],
};
