import { BORE, GLOVE, GLOW, METAL, METAL_LIGHT, RUBBER, WOOD, WOOD_DARK } from '../weaponModels.js';

// Hickory: full-auto mid-range rifle. The workhorse.
export default {
  def: {
    id: 'hickory',
    name: 'Hickory',
    blurb: 'Full-auto rifle. The workhorse at mid range; long sprays bloom.',
    kind: 'hitscan',
    auto: true,
    fireRate: 9, // shots per second
    damage: 13,
    headshotMul: 1.5,
    // Damage falls off linearly from falloffStart to falloffEnd meters, down to falloffMin.
    falloffStart: 35,
    falloffEnd: 80,
    falloffMin: 0.6,
    range: 150,
    mag: 32,
    reserve: 160,
    reloadTime: 1.7,
    spreadBase: 0.5,
    // Bloom caps at 3.1 degrees hip-fire after about 13 rounds.
    spreadMax: 2.6,
    spreadPerShot: 0.2,
    spreadRecovery: 8, // degrees per second
    spreadMoveAdd: 0.9,
    spreadAirAdd: 1.4,
    aimSpreadMul: 0.5,
    crouchSpreadMul: 0.8,
    climbSpreadMul: 1.6,
    zoom: 1.35,
    tracerColor: 0xffc070,
    sound: 'shot',
    // Range band bots like to use it in, meters.
    bot: { min: 0, max: 70, pref: 18 },
  },
  // Parts in gun space (barrel along -z, origin at the grip): [center, size, color, options]
  // (see weaponModels.js). A null color means the owner's armor color.
  parts: [
    // Receiver, its ribbed top cover, the rear sight with its glow dot.
    [[0, 0.02, -0.12], [0.066, 0.085, 0.34], METAL],
    [[0, 0.069, -0.11], [0.054, 0.018, 0.29], METAL_LIGHT],
    [[0, 0.079, -0.06], [0.056, 0.004, 0.012], METAL, { bevel: 0 }],
    [[0, 0.079, -0.12], [0.056, 0.004, 0.012], METAL, { bevel: 0 }],
    [[0, 0.079, -0.18], [0.056, 0.004, 0.012], METAL, { bevel: 0 }],
    [[0, 0.092, 0.0], [0.034, 0.03, 0.045], METAL],
    [[0, 0.096, -0.023], [0.012, 0.012, 0.004], GLOW],
    // Ejection port and charging handle on the right.
    [[0.0335, 0.032, -0.1], [0.002, 0.03, 0.085], BORE, { bevel: 0 }],
    [[0.046, 0.05, -0.03], [0.028, 0.014, 0.014], METAL_LIGHT, { shape: 'cyl', axis: 'x' }],
    // Wooden handguard with vent slots, the gas tube over the barrel.
    [[0, 0.01, -0.37], [0.078, 0.07, 0.22], WOOD, { taper: [0.92, 0.9] }],
    [[0.039, 0.016, -0.33], [0.004, 0.012, 0.05], BORE, { bevel: 0 }],
    [[0.038, 0.016, -0.41], [0.004, 0.012, 0.05], BORE, { bevel: 0 }],
    [[0, 0.057, -0.43], [0.024, 0.024, 0.24], METAL, { shape: 'cyl' }],
    // Barrel, front sight, muzzle brake.
    [[0, 0.02, -0.545], [0.028, 0.028, 0.17], METAL, { shape: 'cyl' }],
    [[0, 0.058, -0.565], [0.03, 0.034, 0.024], METAL],
    [[0, 0.085, -0.565], [0.008, 0.026, 0.008], METAL_LIGHT],
    [[0, 0.02, -0.615], [0.044, 0.044, 0.06], METAL_LIGHT, { shape: 'cyl', seg: 8, bore: 0.45 }],
    [[0, 0.02, -0.615], [0.048, 0.012, 0.03], BORE, { bevel: 0 }],
    // Stock, dropping a little toward the rubber butt pad.
    [[0, -0.012, 0.12], [0.058, 0.086, 0.2], WOOD, { taper: [0.85, 0.75], rot: [0.08, 0, 0] }],
    [[0, -0.028, 0.226], [0.064, 0.112, 0.024], RUBBER],
    // Pistol grip raked back, trigger guard and trigger.
    [[0, -0.07, 0.0], [0.042, 0.105, 0.052], WOOD_DARK, { rot: [-0.3, 0, 0] }],
    [[0, -0.05, -0.07], [0.014, 0.006, 0.075], METAL, { bevel: 0 }],
    [[0, -0.035, -0.105], [0.014, 0.03, 0.006], METAL, { bevel: 0 }],
    [[0, -0.034, -0.055], [0.007, 0.026, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    // Curved magazine, with the ammo glow down its side.
    [[0, -0.065, -0.165], [0.046, 0.07, 0.068], METAL, { rot: [0.12, 0, 0] }],
    [[0, -0.124, -0.18], [0.044, 0.066, 0.064], METAL, { rot: [0.35, 0, 0] }],
    [[0.0235, -0.07, -0.165], [0.003, 0.05, 0.014], GLOW, { rot: [0.12, 0, 0] }],
    [[0, -0.16, -0.196], [0.05, 0.012, 0.07], METAL_LIGHT, { rot: [0.35, 0, 0] }],
  ],
  // Gloves and forearms for the first-person view.
  hands: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.03, -0.38], [0.075, 0.055, 0.1], GLOVE],
    [[-0.035, -0.07, -0.33], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.02, -0.65],
  // First-person resting pose (viewmodel camera space), recoil kick and muzzle flash size.
  view: { pos: [0.21, -0.215, -0.48], rot: [0.025, 0.06, 0], scale: 0.72, kick: 1, flash: 1, flashColor: 0xffc070 },
  // Third-person grip point in body space (hung off the spine bone).
  carry: [0.12, 1.2, -0.3],
};
