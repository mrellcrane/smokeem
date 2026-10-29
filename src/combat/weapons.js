// Weapon definitions (data only) and per-player weapon state. Angles in degrees.

export const WEAPONS = {
  hickory: {
    id: 'hickory',
    name: 'Hickory',
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
  },
};

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

  // 0..1 progress through the current reload.
  get reloadProgress() {
    return this.reloadT > 0 ? 1 - this.reloadT / this.def.reloadTime : 0;
  }

  canReload() {
    return !this.reloading && this.mag < this.def.mag && this.reserve > 0;
  }
}
