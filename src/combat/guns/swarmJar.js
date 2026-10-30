import { GLOVE, JAR_AMBER, METAL, METAL_LIGHT, OLIVE, ORANGE, WOOD_DARK } from '../weaponModels.js';

// Swarm Jar: lobs a jar that smashes on whatever it touches and lets out a swarm of bugs that
// hunt the nearest enemy (see swarms.js). The power gun of Hot and Cold.
export default {
  def: {
    id: 'swarmJar',
    name: 'Swarm Jar',
    blurb: 'Lobs a jar of bugs that hunt the nearest enemy and sting. Melee swats them; fire, blasts and the Brander kill them.',
    kind: 'bolt',
    auto: false,
    fireRate: 1,
    mag: 1,
    reserve: 2,
    reloadTime: 1.4,
    // Launch: along the aim, plus some lift, plus half your own velocity.
    launchSpeed: 18,
    launchUp: 3,
    projectile: { look: 'jar', gravity: 16, life: 3, radius: 0.08, direct: 15, ownerGrace: 0.3 },
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
    switchTime: 0.4,
    sound: 'pop',
    padRespawn: 60,
    // noSight: the one gun bots fire at someone's last-seen spot while chasing. max: a jar
    // reaches about 25 m on flat ground, so bots only lob inside that.
    bot: { min: 8, max: 20, pref: 14, lob: true, power: true, noSight: true },
  },
  parts: [
    // The cradle and its posts.
    [[0, -0.005, -0.16], [0.13, 0.02, 0.36], METAL],
    [[0.065, 0.06, -0.2], [0.012, 0.11, 0.012], METAL, { shape: 'cyl', axis: 'y' }],
    [[-0.065, 0.06, -0.2], [0.012, 0.11, 0.012], METAL, { shape: 'cyl', axis: 'y' }],
    [[0, 0.11, -0.2], [0.142, 0.012, 0.016], METAL_LIGHT],
    // The jar with its neck, lid, a strap and bugs crawling inside.
    [[0, 0.07, -0.2], [0.11, 0.13, 0.11], JAR_AMBER, { shape: 'cyl', axis: 'y', seg: 16 }],
    [[0, 0.145, -0.2], [0.085, 0.025, 0.085], JAR_AMBER, { shape: 'cyl', axis: 'y', seg: 16 }],
    [[0, 0.168, -0.2], [0.098, 0.024, 0.098], WOOD_DARK, { shape: 'cyl', axis: 'y', seg: 16 }],
    [[0, 0.04, -0.2], [0.114, 0.012, 0.114], METAL, { shape: 'cyl', axis: 'y', seg: 16 }],
    [[0.03, 0.06, -0.15], [0.016, 0.016, 0.004], 0x2a1c10, { rot: [0, 0.5, 0] }],
    [[-0.02, 0.095, -0.147], [0.016, 0.016, 0.004], 0x2a1c10, { rot: [0, -0.4, 0.5] }],
    [[0.0, 0.075, -0.146], [0.016, 0.016, 0.004], 0x2a1c10],
    [[-0.05, 0.08, -0.18], [0.004, 0.016, 0.016], 0x2a1c10, { rot: [0.4, 0, 0] }],
    [[-0.048, 0.11, -0.22], [0.004, 0.016, 0.016], 0x2a1c10],
    // Trigger housing, stock, grip in the owner's color.
    [[0, -0.035, -0.02], [0.03, 0.05, 0.06], ORANGE],
    [[0, -0.01, 0.12], [0.06, 0.064, 0.18], OLIVE, { taper: [0.9, 0.85] }],
    [[0, -0.07, 0.0], [0.045, 0.1, 0.05], null, { rot: [-0.25, 0, 0] }],
  ],
  // Gloves and forearms: right hand on the grip, left hand under the cradle.
  hands: [
    [[0.005, -0.075, 0.0], [0.07, 0.085, 0.09], GLOVE],
    [[0.04, -0.15, 0.1], [0.065, 0.07, 0.16], GLOVE],
    [[0.045, -0.155, 0.1], [0.07, 0.03, 0.08], null],
    [[-0.005, -0.05, -0.27], [0.075, 0.06, 0.09], GLOVE],
    [[-0.04, -0.09, -0.21], [0.05, 0.05, 0.1], GLOVE],
  ],
  muzzle: [0, 0.07, -0.28],
  view: { pos: [0.22, -0.22, -0.46], rot: [0.03, 0.06, 0], scale: 0.75, kick: 1.6, flash: 0.3, flashColor: 0xd9b45a },
  carry: [0.12, 1.2, -0.3],
};
