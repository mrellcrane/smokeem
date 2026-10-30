// Gameplay tuning. Distances in meters, times in seconds.

export const PHYSICS_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;

export const BODY = {
  radius: 0.4,
  standHeight: 1.8,
  crouchHeight: 1.2,
  eyeStand: 1.62,
  eyeCrouch: 1.02,
  // How far above the feet the hands reach with arms up (monkey bars, rope top).
  handReach: 2.15,
  // Character controller skin gap.
  skin: 0.02,
};

// Shrink Wrap (combat/guns/shrinkWrap.js): how small or big a hit makes you and for how long,
// and what that costs. Shrunk: slower, lower jumps, your shots do half damage, and anyone who
// lands on you (feet within `stompReach` of your head) smokes you. Grown: slower, you take more
// damage, and a second grow while still big pops you.
export const SIZE = {
  small: 0.4,
  big: 1.6,
  time: 6,
  // Seconds the body takes to change size (the hitbox changes at once).
  morph: 0.25,
  smallSpeed: 0.8,
  smallJump: 0.75,
  smallDamageOut: 0.5,
  bigSpeed: 0.85,
  bigDamageIn: 1.5,
  stompReach: 0.45,
};

// Controller aim assist (src/combat/aimAssist.js), Halo style.
export const AIM = {
  // Magnetism: a shot this far past the edge of a body (meters, as an angle, capped) bends onto
  // it, out to this fraction of the gun's range.
  magnetRadius: 0.35,
  magnetMaxAngle: 8 * (Math.PI / 180),
  magnetRange: 0.8,
  // The body as a segment: from this far under its center to this far over its head line.
  segmentBelow: 0.35,
  segmentAbove: 0.22,
  // Look speed with the crosshair on someone, and within this many magnetism cones of them.
  frictionOn: 0.5,
  frictionNear: 0.72,
  nearCones: 1.6,
  // Tracking: while you're aiming (moving a stick) with someone in the cone, the view follows
  // this share of how fast they cross it, so a strafing target doesn't slide off the reticle.
  track: 0.3,
  // (Each gun can set its own: its def's `assist`, combat/aimAssist.js.)
};

// Ragdoll-ish deaths (Player.startCorpse): how hard the body is knocked (m/s) by a bullet, a
// melee hit and a blast (blasts throw it up too), how fast it starts tipping (rad/s), the angle
// it rests at lying down, its ground friction, and how long it lies there before it puffs away
// (the respawn is at 3 s).
export const CORPSE = {
  shotPush: 2.2,
  meleePush: 4,
  blastPush: 7,
  blastUp: 5.5,
  tipStart: 0.8,
  lying: 1.5,
  friction: 5,
  time: 2.6,
};

export const MOVE = {
  walkSpeed: 7.0,
  sprintSpeed: 10.5,
  crouchSpeed: 3.6,
  // Ground acceleration, and how much faster it turns you around when the stick opposes
  // where you're going (snappy strafes, Halo style).
  groundAccel: 85,
  groundDecel: 70,
  reverseAccelMul: 1.5,
  airAccel: 24,
  airDrag: 1.5,
  gravity: 16,
  fallGravityMul: 1.1,
  maxFallSpeed: 40,
  jumpSpeed: 8.0,
  doubleJumpSpeed: 7.2,
  // Fraction of horizontal velocity steered toward the stick on a double jump.
  doubleJumpRedirect: 0.6,
  airJumps: 1,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,

  mudSpeedMul: 0.5,
  mudJumpMul: 0.7,

  netClimbSpeed: 4.2,
  ropeClimbSpeed: 3.8,
  hangSpeed: 3.6,
  leapOffSpeed: 5.5,
  leapOffUp: 6.0,
  regrabDelay: 0.35,

  // Mantle: ground vaults handle knee-to-chest obstacles, air mantles grab up to hand height.
  vaultMinRise: 0.45,
  vaultMaxRise: 1.45,
  airMantleMinRise: 0.3,
  airMantleMaxRise: 2.1,
  mantleExitSpeed: 4.0,

  // Sprint-slide: crouch while sprinting on the ground. Starts at least this much over sprint
  // speed (no boost in mud), and friction brings it down to crouch speed: about 0.9 s on flat
  // ground. Speeds and friction scale with the Movement speed setting, so the time doesn't.
  slideBoost: 0.15,
  slideFriction: 9.5,
  slideMudFriction: 30,
  // How hard slopes pull a slide along (1 = gravity's own pull along the slope).
  slideSlope: 1.5,
  // Downhill slides never go faster than this times sprint speed.
  slideMaxSpeed: 1.6,
  // How fast the stick can turn a slide (radians per second at full tilt sideways).
  slideSteer: 0.9,
  // After a slide ends, how long until the next one can start (no endless slide hops).
  slideCooldown: 1.0,

  // Wall kick: jump in the air next to a steep wall (within wallKickReach of the body, its
  // normal within 30 degrees of horizontal) to push off it. Pushing into any wall in reach with
  // the double jump left uses the double jump instead, so walls can still be climbed and mantled.
  wallKickReach: 0.4,
  wallKickMaxNormalY: 0.5,
  wallKickUp: 7.2,
  wallKickPush: 6.0,
  // Fraction of the speed along the wall that's kept.
  wallKickKeep: 0.85,
  // Moving away from the wall faster than this (m/s) is too late to kick off it.
  wallKickAwayMax: 1.0,
  // The stick counts as pushing into the wall within about 60 degrees of straight at it.
  wallKickInto: 0.5,
  // Between any two kicks.
  wallKickCooldown: 0.25,
  // Kicks allowed before touching the ground, a ledge (mantle) or a climbable again, and the
  // upward speed each chained kick keeps of the one before (so corners can't be kicked up
  // forever).
  wallKicksPerAir: 3,
  wallKickChainUp: 0.85,
  // Air steering is weaker for a moment after a kick, so the push carries you off the wall.
  wallKickSteerTime: 0.2,
  wallKickSteer: 0.25,
};

// The grapple everyone has (LB / Q, player/grapple.js): the hook flies out to `range`, sticks in
// almost anything and reels you toward it. You let go on arriving, with jump (a hop off it),
// another press, after `maxPull`, or when something stops you; then it's `cooldown` seconds
// until the next (`missCooldown` after a miss).
export const GRAPPLE = {
  range: 34,
  hookSpeed: 120,
  reelSpeed: 90,
  pullSpeed: 21,
  pullAccel: 75,
  // Stick steering while reeled in (m/s at full tilt, sideways).
  steer: 3.5,
  maxPull: 1.8,
  // Let go this close to where we're headed (a stand-off from the surface, `standOff`).
  arrive: 1.1,
  standOff: 0.75,
  // Reeled to someone: let go this far from their center.
  arriveBody: 1.7,
  // Letting go at a wall or a ledge: an upward hop to get over it.
  popUp: 5.5,
  // Letting go over a ledge: the push in onto it (m/s).
  ledgePush: 4,
  // A jump off the line.
  jumpOff: 6.5,
  // After letting go, air steering doesn't brake the swing for this long (s).
  carry: 0.45,
  cooldown: 5,
  missCooldown: 1.5,
};

export const CAMERA = {
  near: 0.05,
  far: 700,
  sprintFovBoost: 8,
  // While sliding: a slightly wider view than sprinting and a small roll (radians).
  slideFovBoost: 11,
  slideRoll: 0.035,
  minVerticalFov: 40,
  maxVerticalFov: 80,
  maxPitch: 89 * (Math.PI / 180),
  // Head bob on the stride (Player.tickStride): how far the eye dips at each footfall walking
  // and sprinting (meters), how far it sways toward the planted foot, and its roll (radians).
  // Zoomed in, it keeps this share.
  bob: 0.03,
  bobSprint: 0.05,
  bobSide: 0.014,
  bobRoll: 0.005,
  bobZoomed: 0.3,
};

// First-person gun framing, on top of each gun's own pose (guns/*.js `view`): the viewmodel
// camera's vertical field of view, a size multiplier, how far each gun's place (and its motions)
// is pulled in toward the eye per axis (camera space: right, up, back), and a turn for every gun
// (radians). Halo-style: big, close and low on the right, the barrel nearly level.
export const VIEWMODEL = {
  fov: 58,
  scale: 1.5,
  place: [0.67, 0.63, 0.58],
  turn: [-0.04, -0.02, 0],
  // Muzzle flash size on top of each gun's own.
  flash: 1.3,
};

// The Sizzler (vehicles/sizzler.js): a one-seat motorcycle with twin guns, on maps that have
// spots for it. Speeds in m/s, accelerations in m/s², turns in rad/s.
export const SIZZLER = {
  topSpeed: 15,
  boostSpeed: 21,
  reverseSpeed: 5,
  accel: 11,
  boostAccel: 16,
  brake: 26,
  coast: 3,
  // Above the top speed (off a boost or a hill) it slows this fast.
  overDrag: 4,
  // Sideways speed bleeds off this fast on the ground (the tires' grip; less, and it drifts).
  grip: 7,
  // How fast it turns toward where the rider looks: at speed, and the share of that when slow
  // or in the air.
  turn: 2.6,
  slowTurn: 0.45,
  airTurn: 0.25,
  // A/D or the left stick steer directly at this rate (and turn the camera with it).
  steer: 2.2,
  hop: 5.5,
  mudSpeed: 6,
  // Boost: seconds of it in a full tank, and how fast it refills after a pause.
  boostTank: 2.5,
  boostRefill: 0.3,
  boostPause: 1,
  // The hull: hit points (no shields, no regen) and the blast when it's destroyed.
  health: 280,
  // Share of damage its rider takes (the bike shelters them a little).
  riderTakes: 0.75,
  blast: { radius: 5, inner: 1.5, damage: 120, knockback: 9 },
  // Running into someone: under `bump` m/s nothing, from `bump` it hurts and shoves, from
  // `splatter` it smokes them.
  bump: 5,
  splatter: 10,
  bumpDamage: 45,
  // Twin guns under the bars, firing in turn: damage per round, rounds per second, spread
  // (degrees), range, how far off the bike's heading they can swing (radians), and heat: a full
  // bar overheats them for `cool` seconds; it drains at `vent` per second after `ventDelay`.
  gun: { damage: 12, rate: 9, spread: 1.0, range: 70, swing: 0.6, pitchUp: 0.45, pitchDown: 0.35, heatPerShot: 0.04, vent: 0.45, ventDelay: 0.35, cool: 2 },
  // Back in its spot this long after it's destroyed, or after it's left empty away from it.
  respawn: 30,
  abandoned: 40,
  // The chase camera: what it pivots about (meters over the bike's ground point), how far back
  // along the aim and up from there, and the field of view added at top speed.
  camPivot: 1.45,
  camBack: 4.6,
  camUp: 1.0,
  // How far the camera looks below the aim (radians): the reticle sits that far above the middle.
  camTilt: 0.16,
  camFov: 8,
  // From where a rider gets on (meters from the seat).
  reach: 2.3,
};
