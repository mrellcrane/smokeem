import { GLOVE, GLOW, METAL, METAL_LIGHT, ORANGE, WOOD_DARK } from '../weaponModels.js';

// Chimney: lobs glowing coals that bounce and burst on contact with a body, or after 1.1 s.
// Small, fast blasts that flush campers (and hurt you too).
export default {
  def: {
    id: 'chimney',
    name: 'Chimney',
    blurb: 'Coal launcher. Coals bounce off walls and burst on anyone they touch; hurts you too.',
    kind: 'launcher',
    auto: false,
    fireRate: 1.4,
    mag: 3,
    reserve: 9,
    // Loads one coal at a time; firing interrupts the reload.
    reloadTime: 0.55,
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
    zoom: 1.1,
    switchTime: 0.45,
    // Launch: along the aim, plus a little lift, plus half your own velocity.
    launchSpeed: 26,
    launchUp: 2,
    projectile: {
      look: 'coal',
      fuse: 1.1,
      // Bursts when within this far of any body (the shooter is safe for the first 0.25 s).
      contact: 0.45,
      ownerGrace: 0.25,
      damping: 0.3,
      restitution: 0.45,
      ember: true,
      explosion: { radius: 3.2, inner: 0.4, damage: 85, knockback: 8, volume: 0.8, rate: 1.15 },
    },
    sound: 'chimney',
    soundRate: 0.7,
    padRespawn: 40,
    // max: coals burst on the fuse at about 24 m, so bots only lob inside that.
    bot: { min: 6, max: 20, pref: 12, lob: true },
  },
  parts: [
    [[0, 0.03, -0.18], [0.11, 0.11, 0.42], METAL_LIGHT],
    [[0.056, 0.05, -0.12], [0.004, 0.03, 0.08], METAL],
    [[0.056, 0.05, -0.24], [0.004, 0.03, 0.08], METAL],
    [[0, 0.03, -0.395], [0.12, 0.12, 0.016], ORANGE],
    [[-0.056, 0.03, -0.05], [0.004, 0.035, 0.05], GLOW],
    [[0, -0.04, -0.27], [0.06, 0.05, 0.12], WOOD_DARK],
    [[0, -0.07, 0.0], [0.045, 0.1, 0.05], WOOD_DARK],
    [[0, 0.0, 0.08], [0.07, 0.08, 0.14], METAL],
    [[0, -0.01, 0.17], [0.06, 0.1, 0.05], null],
  ],
  hands: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.075, -0.27], [0.08, 0.055, 0.1], GLOVE],
    [[-0.04, -0.11, -0.22], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.03, -0.41],
  view: { pos: [0.2, -0.2, -0.44], rot: [0.03, 0.06, 0], scale: 0.75, kick: 2.4, flash: 1.4, flashColor: 0xff7a1a },
  carry: [0.12, 1.2, -0.3],
};
