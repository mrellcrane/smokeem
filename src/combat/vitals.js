// Shields over health, both regenerating. Shared by players, practice targets and (later) bots.

export const VITALS = {
  maxShield: 100,
  maxHealth: 100,
  // Seconds without taking damage before shields start recharging.
  shieldDelay: 4,
  // Points per second: shields refill in about 2 s, health in about 4 s once shields are full.
  shieldRechargeRate: 50,
  healthRegenRate: 25,
};

export class Vitals {
  constructor(cfg = VITALS) {
    this.cfg = cfg;
    this.result = { shieldDamage: 0, healthDamage: 0, broke: false, killed: false };
    this.reset();
  }

  reset() {
    this.shield = this.cfg.maxShield;
    this.health = this.cfg.maxHealth;
    this.sinceHit = 999;
    this.alive = true;
    this.recharging = false;
  }

  get shieldFrac() {
    return this.shield / this.cfg.maxShield;
  }

  get healthFrac() {
    return this.health / this.cfg.maxHealth;
  }

  // Shields soak damage first; overflow carries into health. Returns a reused result object.
  damage(amount) {
    const r = this.result;
    r.shieldDamage = 0;
    r.healthDamage = 0;
    r.broke = false;
    r.killed = false;
    if (!this.alive || amount <= 0) return r;
    this.sinceHit = 0;
    this.recharging = false;
    let rest = amount;
    if (this.shield > 0) {
      r.shieldDamage = Math.min(this.shield, rest);
      this.shield -= r.shieldDamage;
      rest -= r.shieldDamage;
      r.broke = this.shield <= 0;
    }
    if (rest > 0) {
      r.healthDamage = Math.min(this.health, rest);
      this.health -= r.healthDamage;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      r.killed = true;
    }
    return r;
  }

  // Returns true on the tick shields begin recharging (for the recharge sound).
  update(dt) {
    if (!this.alive) return false;
    this.sinceHit += dt;
    if (this.sinceHit < this.cfg.shieldDelay) return false;
    const c = this.cfg;
    let started = false;
    if (this.shield < c.maxShield) {
      if (!this.recharging) started = true;
      this.recharging = true;
      this.shield = Math.min(c.maxShield, this.shield + c.shieldRechargeRate * dt);
    } else {
      this.recharging = false;
      if (this.health < c.maxHealth) this.health = Math.min(c.maxHealth, this.health + c.healthRegenRate * dt);
    }
    return started;
  }
}
