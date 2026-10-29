import { GLOVE, METAL, OLIVE, ORANGE, SCREEN } from '../weaponModels.js';

// Smoke Signal: a guided rocket you fly from its nose camera. The power weapon.
export default {
  def: {
    id: 'smokeSignal',
    name: 'Smoke Signal',
    kind: 'missile',
    auto: false,
    fireRate: 1 / 1.2,
    mag: 1,
    reserve: 1,
    reloadTime: 2.4,
    spreadBase: 0,
    spreadMax: 0,
    spreadPerShot: 0,
    spreadRecovery: 0,
    spreadMoveAdd: 0,
    spreadAirAdd: 0,
    aimSpreadMul: 1,
    crouchSpreadMul: 1,
    climbSpreadMul: 1,
    zoom: 1,
    sound: 'launch',
    // Missile flight.
    missileSpeed: 15,
    missileMaxSpeed: 25,
    missileAccel: 12,
    missileLife: 7,
    missileTurnRate: 2.8, // radians per second, caps how hard you can steer
    // Full damage inside `inner` meters, so a direct hit always smokes.
    explosion: { radius: 5.5, inner: 1.6, damage: 210, knockback: 14 },
    // Range band bots like to use it in, meters.
    bot: { min: 9, max: 80, pref: 22, power: true },
  },
  // Box parts in gun space (barrel along -z, origin at the grip): [center, size, color].
  // A null color means the owner's armor color.
  parts: [
    [[0, 0.07, -0.2], [0.14, 0.14, 0.9], OLIVE],
    [[0, 0.07, -0.67], [0.17, 0.17, 0.06], METAL],
    [[0, 0.07, 0.27], [0.16, 0.16, 0.05], METAL],
    [[0, 0.142, -0.45], [0.143, 0.006, 0.08], ORANGE],
    [[0, 0.142, 0.05], [0.143, 0.006, 0.08], ORANGE],
    [[-0.105, 0.1, -0.12], [0.06, 0.08, 0.09], METAL],
    [[-0.105, 0.1, -0.075], [0.045, 0.055, 0.003], SCREEN],
    [[0, -0.03, 0], [0.045, 0.1, 0.05], METAL],
    [[0, -0.02, -0.32], [0.04, 0.09, 0.05], METAL],
  ],
  // Gloves and forearms for the first-person view.
  hands: [
    [[0.005, -0.06, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.14, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.145, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.005, -0.05, -0.32], [0.075, 0.08, 0.09], GLOVE],
  ],
  muzzle: [0, 0.07, -0.72],
  // First-person resting pose (viewmodel camera space), recoil kick and muzzle flash size.
  view: { pos: [0.27, -0.2, -0.56], rot: [0.02, 0.05, 0], scale: 0.6, kick: 2.6, flash: 1.8 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.24, 1.32, -0.1],
};
