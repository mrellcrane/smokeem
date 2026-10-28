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

export const MOVE = {
  walkSpeed: 7.0,
  sprintSpeed: 10.5,
  crouchSpeed: 3.6,
  groundAccel: 70,
  groundDecel: 55,
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
};

export const CAMERA = {
  near: 0.05,
  far: 700,
  sprintFovBoost: 8,
  minVerticalFov: 40,
  maxVerticalFov: 80,
  maxPitch: 89 * (Math.PI / 180),
};
