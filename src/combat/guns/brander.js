import { GLOVE, GLOW, METAL, METAL_LIGHT, ORANGE, RUBBER, WOOD } from '../weaponModels.js';

// Brander: heat beam. Short-range and exact, and it gets hotter the longer you hold it on
// someone. The beam glows orange and turns white-hot as it ramps, pointing straight back at you.
export default {
  def: {
    id: 'brander',
    name: 'Brander',
    blurb: 'Heat beam. Exact out to 22 m and hotter the longer you stay on someone; no headshots.',
    kind: 'beam',
    auto: true,
    // Pulses a second, one ray each through the auto-fire loop.
    fireRate: 20,
    // Damage per second starts at rampStart on a new target and climbs by rampRate per second
    // you stay on them, up to rampMax (1 s in). Slipping off for up to rampGrace keeps the heat.
    rampStart: 50,
    rampRate: 100,
    rampMax: 150,
    rampGrace: 0.25,
    // First pulse's damage (later ones follow the ramp).
    damage: 2.5,
    headshotMul: 1,
    falloffStart: 22,
    falloffEnd: 23,
    falloffMin: 1,
    range: 22,
    // Pulses in a full cell (4 s), then it vents.
    mag: 80,
    reserve: 240,
    reloadTime: 1.8,
    // No spread at all: as exact mid-jump or on a net as standing.
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
    switchTime: 0.4,
    sprintLock: 0.35,
    // Beam color from cold to white-hot.
    beamColor: 0xff6a14,
    beamHot: 0xffe2a8,
    beamWidth: 0.035,
    // A sizzle every 0.15 s while firing (each lasts at least 0.21 s, so they overlap even
    // pitched up), stepping up as the beam heats.
    sound: 'sizzle',
    soundEvery: 0.15,
    reloadSound: 'vent',
    bot: { min: 0, max: 20, pref: 9, hold: true },
  },
  parts: [
    // The emitter tube with cooling fins and orange coils, its flared head and glowing prongs.
    [[0, 0.03, -0.27], [0.034, 0.034, 0.5], METAL, { shape: 'cyl' }],
    [[0, 0.03, -0.25], [0.06, 0.06, 0.008], METAL_LIGHT, { shape: 'cyl', bevel: 0 }],
    [[0, 0.03, -0.28], [0.06, 0.06, 0.008], METAL_LIGHT, { shape: 'cyl', bevel: 0 }],
    [[0, 0.03, -0.31], [0.06, 0.06, 0.008], METAL_LIGHT, { shape: 'cyl', bevel: 0 }],
    [[0, 0.03, -0.34], [0.06, 0.06, 0.008], METAL_LIGHT, { shape: 'cyl', bevel: 0 }],
    [[0, 0.03, -0.2], [0.05, 0.05, 0.03], ORANGE, { shape: 'cyl' }],
    [[0, 0.03, -0.42], [0.05, 0.05, 0.03], ORANGE, { shape: 'cyl' }],
    [[0, 0.03, -0.5], [0.034, 0.034, 0.04], METAL_LIGHT, { shape: 'cyl', taper: 1.6 }],
    [[-0.028, 0.03, -0.53], [0.014, 0.07, 0.014], GLOW],
    [[0.028, 0.03, -0.53], [0.014, 0.07, 0.014], GLOW],
    [[0, 0.03, -0.53], [0.07, 0.014, 0.014], GLOW],
    // The fuel tank under it with a gauge and hose, the body, the grip.
    [[0, -0.03, -0.14], [0.066, 0.066, 0.17], METAL, { shape: 'cyl', seg: 14 }],
    [[-0.034, -0.03, -0.1], [0.008, 0.026, 0.026], GLOW, { shape: 'cyl', axis: 'x' }],
    [[0, -0.02, -0.03], [0.016, 0.016, 0.08], RUBBER, { shape: 'cyl' }],
    [[0, 0.004, -0.14], [0.02, 0.03, 0.1], METAL_LIGHT],
    [[0, 0.025, 0.06], [0.065, 0.075, 0.15], METAL],
    [[0, -0.07, 0.0], [0.04, 0.1, 0.045], WOOD, { rot: [-0.25, 0, 0] }],
    [[0, -0.025, 0.05], [0.05, 0.03, 0.07], null],
    // Trigger guard and trigger.
    [[0, -0.05, -0.065], [0.014, 0.006, 0.07], METAL, { bevel: 0 }],
    [[0, -0.035, -0.1], [0.014, 0.03, 0.006], METAL, { bevel: 0 }],
    [[0, -0.034, -0.05], [0.007, 0.026, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
  ],
  // Gloves and forearms: right hand on the grip, left hand under the power cell.
  hands: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.008, -0.08, -0.15], [0.075, 0.06, 0.09], GLOVE],
    [[-0.04, -0.115, -0.1], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.03, -0.55],
  view: { pos: [0.2, -0.2, -0.44], rot: [0.025, 0.06, 0], scale: 0.75, kick: 0.15, flash: 0.35, flashColor: 0xff6030 },
  carry: [0.12, 1.2, -0.3],
};
