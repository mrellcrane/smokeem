import { BORE, BRASS, GLOVE, GLOW, METAL, METAL_LIGHT, RUBBER, SHELL_RED, WOOD, WOOD_DARK } from '../weaponModels.js';

// Mesquite: pump shotgun. Brutal up close, useless far away.
export default {
  def: {
    id: 'mesquite',
    name: 'Mesquite',
    blurb: 'Pump shotgun. Two close blasts smoke anyone; useless far away.',
    kind: 'pellets',
    auto: false,
    fireRate: 1 / 0.85,
    pellets: 10,
    damage: 12, // per pellet: two point-blank shots smoke a full-shield target
    headshotMul: 1,
    falloffStart: 6,
    falloffEnd: 18,
    falloffMin: 0.15,
    range: 60,
    mag: 6,
    reserve: 18,
    // Loads one shell at a time; firing interrupts the reload.
    reloadTime: 0.5,
    reloadPerShell: true,
    // Rack the pump after every shot (sound only; the viewmodel animates it too).
    pump: true,
    spreadBase: 6,
    spreadMax: 6,
    spreadPerShot: 0,
    spreadRecovery: 0,
    spreadMoveAdd: 0.5,
    spreadAirAdd: 0.5,
    aimSpreadMul: 1,
    crouchSpreadMul: 0.9,
    climbSpreadMul: 1.2,
    zoom: 1,
    tracerColor: 0xffd890,
    sound: 'shotgun',
    // Range band bots like to use it in, meters.
    // Controller aim assist (combat/aimAssist.js): cone cap (degrees), reach past the body (m),
    // range (m, also the red reticle's).
    assist: { cone: 10, radius: 0.5, range: 14, slow: 0.6 },
    bot: { min: 0, max: 12, pref: 4 },
  },
  parts: [
    // Receiver with its top rib, ejection port and a side saddle of shells on the left.
    [[0, 0.02, -0.1], [0.074, 0.085, 0.28], METAL],
    [[0, 0.066, -0.1], [0.05, 0.01, 0.26], METAL_LIGHT],
    [[0.0375, 0.03, -0.12], [0.002, 0.035, 0.09], BORE, { bevel: 0 }],
    [[-0.04, 0.025, -0.1], [0.008, 0.05, 0.11], METAL],
    [[-0.052, 0.03, -0.06], [0.022, 0.044, 0.022], SHELL_RED, { shape: 'cyl', axis: 'y' }],
    [[-0.052, 0.03, -0.085], [0.022, 0.044, 0.022], SHELL_RED, { shape: 'cyl', axis: 'y' }],
    [[-0.052, 0.03, -0.11], [0.022, 0.044, 0.022], SHELL_RED, { shape: 'cyl', axis: 'y' }],
    [[-0.052, 0.03, -0.135], [0.022, 0.044, 0.022], SHELL_RED, { shape: 'cyl', axis: 'y' }],
    [[-0.052, 0.003, -0.0975], [0.024, 0.012, 0.1], BRASS],
    // Barrel with its vent rib and bead, the tube magazine under it, the clamp.
    [[0, 0.045, -0.44], [0.044, 0.044, 0.42], METAL_LIGHT, { shape: 'cyl', bore: 0.75 }],
    [[0, 0.069, -0.44], [0.012, 0.006, 0.4], METAL, { bevel: 0 }],
    [[0, 0.075, -0.638], [0.012, 0.012, 0.012], GLOW],
    [[0, -0.008, -0.42], [0.036, 0.036, 0.36], METAL, { shape: 'cyl' }],
    [[0, -0.008, -0.6], [0.04, 0.04, 0.016], METAL_LIGHT, { shape: 'cyl' }],
    [[0, 0.02, -0.56], [0.03, 0.08, 0.02], METAL],
    // The pump, ribbed.
    [[0, -0.01, -0.36], [0.07, 0.062, 0.17], WOOD, { shape: 'cyl', seg: 14, group: 'pump' }],
    [[0, -0.01, -0.31], [0.074, 0.066, 0.012], WOOD_DARK, { shape: 'cyl', seg: 14, group: 'pump' }],
    [[0, -0.01, -0.36], [0.074, 0.066, 0.012], WOOD_DARK, { shape: 'cyl', seg: 14, group: 'pump' }],
    [[0, -0.01, -0.41], [0.074, 0.066, 0.012], WOOD_DARK, { shape: 'cyl', seg: 14, group: 'pump' }],
    // Stock and butt pad, pistol grip.
    [[0, -0.02, 0.12], [0.062, 0.09, 0.22], WOOD, { taper: [0.85, 0.7], rot: [0.1, 0, 0] }],
    [[0, -0.04, 0.236], [0.068, 0.122, 0.026], RUBBER],
    [[0, -0.07, 0.0], [0.044, 0.1, 0.052], WOOD_DARK, { rot: [-0.3, 0, 0] }],
    // Trigger guard and trigger.
    [[0, -0.05, -0.065], [0.014, 0.006, 0.07], METAL, { bevel: 0 }],
    [[0, -0.035, -0.1], [0.014, 0.03, 0.006], METAL, { bevel: 0 }],
    [[0, -0.034, -0.05], [0.007, 0.026, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
  ],
  // Gloves and forearms for the first-person view.
  hands: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.04, -0.36], [0.08, 0.055, 0.1], GLOVE],
    [[-0.04, -0.08, -0.31], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.045, -0.67],
  // First-person resting pose (viewmodel camera space), recoil kick and muzzle flash size.
  view: { pos: [0.21, -0.22, -0.46], rot: [0.025, 0.06, 0], scale: 0.72, kick: 2.2, flash: 1.8, flashColor: 0xffa040 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.12, 1.2, -0.3],
};
