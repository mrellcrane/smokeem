import { GLOVE, GLOW, METAL, METAL_LIGHT, OLIVE, ORANGE, RUBBER } from '../weaponModels.js';

// Gust: a backpack-style leaf blower (shooting.js fireGust). Hold the trigger: a cone of wind
// shoves people (and briquettes, sticky bombs, bolts, bugs and props) away, chipping a little
// damage, and blows smoke and leaves. Point it at the ground in the air and it holds you up
// (the Gust glide): float across gaps or hover over a fight until the tank runs dry.
export default {
  def: {
    id: 'gust',
    name: 'Gust',
    blurb: 'Leaf blower: shoves people, grenades and rockets away. Aim down in the air to glide.',
    kind: 'gust',
    auto: true,
    fireRate: 20,
    // A tank of air: pulses.
    mag: 100,
    reserve: 200,
    reloadTime: 1.6,
    // The cone: reach (m), half angle (degrees), push per pulse (m/s) up close, damage per pulse.
    range: 10,
    cone: 18,
    push: 2.6,
    pushMax: 16,
    damage: 1.2,
    // Aimed below this pitch (radians) in the air, it lifts you instead: up to `liftMax` m/s.
    glidePitch: -0.55,
    lift: 34,
    liftMax: 3,
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
    sound: 'gust',
    soundEvery: 0.22,
    bot: { min: 0, max: 8, pref: 4, hold: true },
  },
  parts: [
    // The blower: a fat motor drum with cooling fins, an orange cowl.
    [[0, 0.04, 0.02], [0.13, 0.13, 0.16], ORANGE, { shape: 'cyl', seg: 18 }],
    [[0, 0.04, 0.1], [0.1, 0.1, 0.02], METAL, { shape: 'cyl', seg: 18, bore: 0.5 }],
    [[0, 0.04, -0.06], [0.135, 0.135, 0.015], METAL_LIGHT, { shape: 'cyl', seg: 18 }],
    [[0, 0.04, -0.02], [0.135, 0.135, 0.012], METAL_LIGHT, { shape: 'cyl', seg: 18 }],
    // The tube: long, tapering to a flattened nozzle, an ember band.
    [[0, 0.03, -0.3], [0.08, 0.08, 0.42], OLIVE, { shape: 'cyl', seg: 14, taper: 0.8 }],
    [[0, 0.03, -0.54], [0.09, 0.05, 0.07], METAL, { taper: [1.2, 0.8] }],
    [[0, 0.03, -0.577], [0.09, 0.035, 0.004], 0x0c0c0e, { bevel: 0 }],
    [[0, 0.03, -0.2], [0.084, 0.084, 0.02], GLOW, { shape: 'cyl', seg: 14 }],
    // Handle on top (the trigger hand), throttle, a front grip under the tube.
    [[0, 0.13, 0.0], [0.03, 0.03, 0.14], RUBBER],
    [[0, 0.1, 0.06], [0.02, 0.06, 0.02], METAL],
    [[0, 0.1, -0.06], [0.02, 0.06, 0.02], METAL],
    [[0, -0.05, -0.04], [0.04, 0.1, 0.05], null, { rot: [-0.2, 0, 0] }],
    [[0, -0.02, -0.08], [0.008, 0.024, 0.008], METAL_LIGHT, { rot: [0.25, 0, 0] }],
    [[0, -0.02, -0.3], [0.035, 0.06, 0.05], RUBBER],
  ],
  hands: [
    [[0.005, -0.07, -0.04], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.06], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.06], [0.07, 0.03, 0.08], null],
    [[-0.005, -0.06, -0.3], [0.075, 0.06, 0.09], GLOVE],
    [[-0.035, -0.1, -0.25], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.03, -0.59],
  view: { pos: [0.22, -0.22, -0.48], rot: [0.02, 0.05, 0], scale: 0.72, kick: 0.15, flash: 0, flashColor: 0xffffff },
  carry: [0.12, 1.2, -0.3],
};
