import { GLOVE, GLOW, METAL, ORANGE, WOOD } from '../weaponModels.js';

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
  // Box parts in gun space (barrel along -z, origin at the grip): [center, size, color].
  parts: [
    [[0, 0.03, -0.27], [0.035, 0.035, 0.5], METAL],
    [[-0.028, 0.03, -0.53], [0.014, 0.07, 0.014], GLOW],
    [[0.028, 0.03, -0.53], [0.014, 0.07, 0.014], GLOW],
    [[0, 0.03, -0.53], [0.07, 0.014, 0.014], GLOW],
    [[0, 0.03, -0.2], [0.05, 0.05, 0.03], ORANGE],
    [[0, 0.03, -0.36], [0.05, 0.05, 0.03], ORANGE],
    [[0, -0.03, -0.14], [0.065, 0.065, 0.17], METAL],
    [[0, 0.025, 0.06], [0.065, 0.075, 0.15], METAL],
    [[0, -0.07, 0.0], [0.04, 0.1, 0.045], WOOD],
    [[0, -0.025, 0.04], [0.05, 0.03, 0.07], null],
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
  view: { pos: [0.2, -0.2, -0.44], rot: [0.025, 0.06, 0], scale: 0.75, kick: 0.15, flash: 0.35 },
  carry: [0.12, 1.2, -0.3],
};
