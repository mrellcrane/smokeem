import { BORE, GLOVE, GLOW, METAL, METAL_LIGHT, ORANGE, RUBBER, SCREEN } from '../weaponModels.js';

// Hot Links: twin rocket tubes on the shoulder, after the two-shot launchers of Halo (owner pick).
// Two fast rockets that fly dead straight (combat/bolts.js, look 'rocket') and burst with a huge
// blast; zoomed, a rocket fired at a Sizzler homes in on it. The power weapon. The tubes are
// stovepipes with ember bands, fed by a sausage-link belt.
export default {
  def: {
    id: 'hotLinks',
    name: 'Hot Links',
    blurb: 'Twin rocket tubes. Two fast, straight rockets with a huge blast; zoomed, they home on bikes.',
    kind: 'bolt',
    auto: false,
    fireRate: 1.25,
    mag: 2,
    reserve: 2,
    reloadTime: 3.2,
    spreadBase: 0,
    spreadMax: 0,
    spreadPerShot: 0,
    spreadRecovery: 0,
    spreadMoveAdd: 0,
    spreadAirAdd: 0,
    aimSpreadMul: 1,
    crouchSpreadMul: 1,
    climbSpreadMul: 1,
    zoom: 2,
    switchTime: 0.6,
    // Out of the tubes along the aim (not lobbed: no lift, none of your own velocity).
    launchSpeed: 40,
    launchUp: 0,
    launchCarry: 0,
    projectile: {
      look: 'rocket',
      gravity: 0,
      life: 3,
      radius: 0.12,
      ownerGrace: 0.2,
      // Flies nose first, trails smoke and glows.
      straight: true,
      trail: true,
      glow: 0xffb050,
      // Zoomed on a Sizzler when it's fired: turns toward it at up to this (radians a second).
      homing: 1.8,
      // Full damage inside `inner` meters, so a direct hit always smokes.
      explosion: { radius: 5, inner: 1.4, damage: 220, knockback: 14, tint: 0xffc070 },
    },
    sound: 'launch',
    soundRate: 0.85,
    // Range band bots like to use it in, meters.
    bot: { min: 8, max: 60, pref: 20, power: true, feet: true },
  },
  parts: [
    // Two tubes side by side, each with a flared mouth, an ember band and a venturi behind.
    [[-0.055, 0.07, -0.22], [0.1, 0.1, 0.82], METAL, { shape: 'cyl', seg: 16 }],
    [[0.055, 0.07, -0.22], [0.1, 0.1, 0.82], METAL, { shape: 'cyl', seg: 16 }],
    [[-0.055, 0.07, -0.65], [0.118, 0.118, 0.05], METAL_LIGHT, { shape: 'cyl', seg: 16, taper: 1.08, bore: 0.78 }],
    [[0.055, 0.07, -0.65], [0.118, 0.118, 0.05], METAL_LIGHT, { shape: 'cyl', seg: 16, taper: 1.08, bore: 0.78 }],
    [[-0.055, 0.07, -0.5], [0.106, 0.106, 0.05], ORANGE, { shape: 'cyl', seg: 16 }],
    [[0.055, 0.07, -0.5], [0.106, 0.106, 0.05], ORANGE, { shape: 'cyl', seg: 16 }],
    [[-0.055, 0.07, 0.22], [0.11, 0.11, 0.05], METAL_LIGHT, { shape: 'cyl', seg: 16, taper: 1.1, bore: 0.75, rot: [Math.PI, 0, 0] }],
    [[0.055, 0.07, 0.22], [0.11, 0.11, 0.05], METAL_LIGHT, { shape: 'cyl', seg: 16, taper: 1.1, bore: 0.75, rot: [Math.PI, 0, 0] }],
    // The clamp holding them together, with a stripe in the owner's color.
    [[0, 0.07, -0.05], [0.23, 0.13, 0.08], METAL_LIGHT],
    [[0, 0.07, -0.05], [0.234, 0.134, 0.02], null],
    [[0, 0.07, -0.34], [0.23, 0.12, 0.05], METAL],
    // The link belt on the right: three sausages with their twists, glowing where they're hot.
    [[0.118, 0.04, -0.2], [0.04, 0.04, 0.09], 0x8a3a22, { shape: 'cyl', seg: 10 }],
    [[0.118, 0.04, -0.1], [0.04, 0.04, 0.09], 0x8a3a22, { shape: 'cyl', seg: 10 }],
    [[0.118, 0.04, 0.0], [0.04, 0.04, 0.09], 0x8a3a22, { shape: 'cyl', seg: 10 }],
    [[0.118, 0.04, -0.15], [0.022, 0.022, 0.012], GLOW, { shape: 'cyl', seg: 8 }],
    [[0.118, 0.04, -0.05], [0.022, 0.022, 0.012], GLOW, { shape: 'cyl', seg: 8 }],
    // The sight on top, its screen toward you.
    [[0, 0.155, -0.12], [0.07, 0.05, 0.08], METAL],
    [[0, 0.155, -0.0795], [0.054, 0.034, 0.003], SCREEN, { bevel: 0 }],
    [[0, 0.13, -0.12], [0.03, 0.02, 0.05], METAL_LIGHT],
    // Grips and trigger, a pad under the tubes for the shoulder.
    [[0, -0.03, 0.0], [0.045, 0.1, 0.05], RUBBER, { rot: [-0.25, 0, 0] }],
    [[0, -0.02, -0.32], [0.04, 0.09, 0.05], RUBBER, { rot: [-0.1, 0, 0] }],
    [[0, 0.005, -0.02], [0.05, 0.03, 0.12], METAL],
    [[0, -0.005, -0.06], [0.007, 0.024, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    [[0, -0.012, 0.15], [0.09, 0.03, 0.14], RUBBER],
    [[0, 0.07, -0.66], [0.2, 0.006, 0.006], BORE, { bevel: 0 }],
  ],
  // Gloves and forearms for the first-person view.
  hands: [
    [[0.005, -0.06, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.14, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.145, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.005, -0.05, -0.32], [0.075, 0.08, 0.09], GLOVE],
  ],
  muzzle: [0.055, 0.07, -0.7],
  view: { pos: [0.27, -0.2, -0.56], rot: [0.02, 0.05, 0], scale: 0.6, kick: 3, flash: 1.6, flashColor: 0xffd090 },
  carry: [0.24, 1.32, -0.1],
};
