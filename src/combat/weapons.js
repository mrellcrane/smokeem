import { GUNS } from './guns/index.js';

// Weapon definitions (data only) and per-player weapon state. Angles in degrees.
//
// kind:
//   hitscan  one ray per shot (Hickory)
//   pellets  several rays per shot (Mesquite)
//   missile  a guided rocket you fly from its own camera (Smoke Signal)
// bot: { min, max, pref } is the range band (meters) bots like to use a gun in; `power` marks
// a power weapon bots save for good moments.

// Stats per gun, by id (each gun's module under src/combat/guns/ owns its numbers).
export const WEAPONS = Object.fromEntries(Object.entries(GUNS).map(([id, g]) => [id, g.def]));

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
