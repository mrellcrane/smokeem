import { BORE, GLOVE, METAL, METAL_LIGHT, OLIVE, ORANGE, RUBBER, SCREEN } from '../weaponModels.js';

// Smoke Signal: a guided rocket you fly from its nose camera. The power weapon.
export default {
  def: {
    id: 'smokeSignal',
    name: 'Smoke Signal',
    blurb: 'Guided rocket you fly from its nose. Steer it with look, fire to blow it early.',
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
    explosion: { radius: 5.5, inner: 1.6, damage: 210, knockback: 14, tint: 0xffd27a },
    // Range band bots like to use it in, meters.
    bot: { min: 9, max: 80, pref: 22, power: true },
  },
  parts: [
    // The tube: a flared steel muzzle, a venturi at the back, orange bands, a heat shield.
    [[0, 0.07, -0.2], [0.14, 0.14, 0.86], OLIVE, { shape: 'cyl', seg: 18 }],
    [[0, 0.07, -0.66], [0.172, 0.172, 0.07], METAL, { shape: 'cyl', seg: 18, taper: 1.08, bore: 0.78 }],
    [[0, 0.07, 0.26], [0.16, 0.16, 0.06], METAL, { shape: 'cyl', seg: 18, taper: 1.12, bore: 0.75, rot: [Math.PI, 0, 0] }],
    [[0, 0.07, -0.45], [0.146, 0.146, 0.07], ORANGE, { shape: 'cyl', seg: 18 }],
    [[0, 0.07, 0.05], [0.146, 0.146, 0.07], ORANGE, { shape: 'cyl', seg: 18 }],
    [[0, 0.147, -0.2], [0.05, 0.012, 0.34], METAL_LIGHT],
    [[0, 0.135, -0.33], [0.02, 0.02, 0.02], METAL],
    [[0, 0.135, -0.07], [0.02, 0.02, 0.02], METAL],
    // The sight box on the left with its screen toward you, on a bracket.
    [[-0.105, 0.1, -0.12], [0.06, 0.08, 0.09], METAL],
    [[-0.105, 0.1, -0.0745], [0.044, 0.054, 0.003], SCREEN, { bevel: 0 }],
    [[-0.105, 0.145, -0.15], [0.05, 0.012, 0.03], METAL_LIGHT],
    [[-0.075, 0.09, -0.12], [0.02, 0.03, 0.05], METAL_LIGHT],
    // Grips and the trigger, a pad under the tube for the shoulder.
    [[0, -0.03, 0.0], [0.045, 0.1, 0.05], RUBBER, { rot: [-0.25, 0, 0] }],
    [[0, -0.02, -0.32], [0.04, 0.09, 0.05], RUBBER, { rot: [-0.1, 0, 0] }],
    [[0, 0.005, -0.02], [0.05, 0.03, 0.12], METAL],
    [[0, -0.005, -0.06], [0.007, 0.024, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    [[0, -0.012, 0.15], [0.07, 0.03, 0.14], RUBBER],
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
  view: { pos: [0.27, -0.2, -0.56], rot: [0.02, 0.05, 0], scale: 0.6, kick: 2.6, flash: 1.8, flashColor: 0xfff0c0 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.24, 1.32, -0.1],
};
