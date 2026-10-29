// Weapon definitions (data only) and per-player weapon state. Angles in degrees.
//
// kind:
//   hitscan  one ray per shot (Hickory)
//   pellets  several rays per shot (Mesquite)
//   missile  a guided rocket you fly from its own camera (Smoke Signal)

export const WEAPONS = {
  hickory: {
    id: 'hickory',
    name: 'Hickory',
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
    spreadMax: 3.4,
    spreadPerShot: 0.32,
    spreadRecovery: 8, // degrees per second
    spreadMoveAdd: 0.9,
    spreadAirAdd: 1.4,
    aimSpreadMul: 0.5,
    crouchSpreadMul: 0.8,
    climbSpreadMul: 1.6,
    zoom: 1.35,
    tracerColor: 0xffc070,
    sound: 'shot',
  },
  mesquite: {
    id: 'mesquite',
    name: 'Mesquite',
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
  },
  smokeSignal: {
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
  },
};

// The spawn loadout.
export const STARTING_WEAPON = 'hickory';

export const GRENADE = {
  name: 'Briquette',
  start: 2,
  max: 4,
  throwSpeed: 17,
  throwUp: 4,
  fuse: 2.4,
  cooldown: 0.8,
  explosion: { radius: 5, inner: 1, damage: 130, knockback: 10 },
};

export const MELEE = {
  name: 'Tenderizer',
  damage: 65,
  range: 2.3,
  // A target this close in front pulls you into a short lunge.
  lungeRange: 3.6,
  lungeSpeed: 13,
  lungeTime: 0.14,
  cooldown: 0.9,
  // Hits from behind (within this dot of the victim's facing) smoke instantly.
  backstabDot: 0.55,
};

export const SWITCH_TIME = 0.4;

export class WeaponState {
  constructor(def) {
    this.def = def;
    this.reset();
  }

  reset() {
    this.mag = this.def.mag;
    this.reserve = this.def.reserve;
    this.cooldown = 0;
    this.reloadT = 0;
    this.bloom = 0;
  }

  get reloading() {
    return this.reloadT > 0;
  }

  // 0..1 progress through the current reload (per shell for shotguns).
  get reloadProgress() {
    return this.reloadT > 0 ? 1 - this.reloadT / this.def.reloadTime : 0;
  }

  get empty() {
    return this.mag === 0 && this.reserve === 0;
  }

  canReload() {
    return !this.reloading && this.mag < this.def.mag && this.reserve > 0;
  }

  // Ammo this pickup can give a holder of the same weapon.
  get totalAmmo() {
    return this.mag + this.reserve;
  }
}
