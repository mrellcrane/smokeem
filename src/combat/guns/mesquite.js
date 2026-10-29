import { GLOVE, GLOW, METAL, METAL_LIGHT, SHELL_RED, WOOD, WOOD_DARK } from '../weaponModels.js';

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
    bot: { min: 0, max: 12, pref: 4 },
  },
  // Box parts in gun space (barrel along -z, origin at the grip): [center, size, color].
  // A null color means the owner's armor color.
  parts: [
    [[0, 0.02, -0.1], [0.075, 0.085, 0.28], METAL],
    [[0, 0.045, -0.44], [0.05, 0.05, 0.42], METAL_LIGHT],
    [[0, -0.008, -0.4], [0.04, 0.04, 0.36], METAL],
    [[0, -0.01, -0.36], [0.075, 0.065, 0.17], WOOD],
    [[0, 0.075, -0.645], [0.012, 0.014, 0.012], GLOW],
    [[0, -0.02, 0.12], [0.065, 0.09, 0.22], WOOD],
    [[0, -0.03, 0.235], [0.072, 0.12, 0.03], WOOD_DARK],
    [[0, -0.07, 0], [0.045, 0.1, 0.05], WOOD_DARK],
    [[0.041, 0.02, -0.12], [0.008, 0.045, 0.11], SHELL_RED],
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
  view: { pos: [0.21, -0.22, -0.46], rot: [0.025, 0.06, 0], scale: 0.72, kick: 2.2, flash: 1.8 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.12, 1.2, -0.3],
};
