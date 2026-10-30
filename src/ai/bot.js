import * as THREE from 'three';
import { InputState } from '../input/inputState.js';
import { DEG, clamp } from '../util/math.js';
import { WEAPONS, GRENADE } from '../combat/weapons.js';
import { SIZZLER } from '../config.js';

// A bot is a regular Player whose InputState is written by this brain instead of a controller,
// so it moves, climbs, shoots and dies by exactly the same rules as people.
// The brain runs in the fixed tick: perceive, pick what to do, then write inputs.
//
// Each gun's `bot` block says how to use it: { min, max, pref } range band (meters), plus
//   sidearm     switch to it instead of reloading the primary mid-fight
//   zoomAt      hold zoom past this distance
//   careful     only fire when aim is inside this share of the usual cone
//   headshots   Hard bots aim for the head
//   highGround  share of roam goals picked above ground level
//   mobile      push in more often while fighting
//   power       a power weapon: used now and then, always worth a swap
//   hold        no burst gaps (beams, spin-up guns); spin-up guns also keep spinning in range
//   noSight     fired at someone's last-seen spot while chasing (Swarm Jar)
//   lob         aim a ballistic arc at the target's feet (launchers)
// semiRate: share of a semi-auto gun's full fire rate a bot taps at; lead: how much of a
// moving target's travel a bot leads lobbed shots by.

export const BOT_SKILL = {
  easy: { reaction: 0.75, aimError: 5, turnRate: 3.2, fireCone: 6, burst: [0.45, 0.9], grenadeChance: 0.15, jumpRate: 0.2, strafe: 0.6, advance: 0.3, semiRate: 0.55, lead: 0.3 },
  normal: { reaction: 0.42, aimError: 2.6, turnRate: 5.5, fireCone: 4, burst: [0.7, 0.5], grenadeChance: 0.3, jumpRate: 0.45, strafe: 0.85, advance: 0.45, semiRate: 0.8, lead: 0.6 },
  hard: { reaction: 0.22, aimError: 1.4, turnRate: 8.5, fireCone: 2.8, burst: [1.0, 0.3], grenadeChance: 0.45, jumpRate: 0.7, strafe: 1, advance: 0.55, semiRate: 1, lead: 0.9 },
};

export const BOT_NAMES = ['Gristle', 'Dry Rub', 'Rib Tip', 'Pit Boss', 'Low n Slow', 'Charcoal', 'Flare-Up', 'Mop Sauce'];
// Bot armor and trim. The arena owns orange, hazard yellow, cyan, brown and grey, and the local
// players own blue, red, green and gold, so bots wear violets, pinks, lime and white.
export const BOT_COLORS = [
  { armor: 0x9b59d0, trim: 0xf2f2f6 },
  { armor: 0xe06aa8, trim: 0x30333a },
  { armor: 0xa6e22e, trim: 0x30333a },
  { armor: 0xf2f2f6, trim: 0x9b59d0 },
  { armor: 0xc43ad8, trim: 0xa6e22e },
  { armor: 0x6b2d8f, trim: 0xff9ad5 },
  { armor: 0xf2f2f6, trim: 0xe06aa8 },
  { armor: 0xa6e22e, trim: 0x9b59d0 },
];

const SIGHT_RANGE = 75;
// Gravity on launched projectiles (Rapier world gravity).
const LOB_GRAVITY = 16;
// A thrown Briquette, in lobArc's terms (its lift is along the view's up, near enough straight
// up for the arcs bots throw).
// The Gravity Gun's range band when there's a prop to fling (meters).
const FLING_BAND = { min: 0, max: 18, pref: 9 };
const GRENADE_LOB = { launchSpeed: GRENADE.throwSpeed, launchUp: GRENADE.throwUp, projectile: { damping: 0.05, fuse: 5 } };
const HEAR_RANGE = 7;
// Sizzlers: how likely a roaming bot heads for a free one in reach (per skill), how far it'll
// walk for one, how long it rides with nobody around before getting off, and the edges a bike
// can take (no climbs or jumps).
const BIKE_CHANCE = { easy: 0.3, normal: 0.5, hard: 0.65 };
const BIKE_REACH = 40;
const RIDE_FOR = [30, 70];
const DRIVE = (e) => e.type === 'walk' || e.type === 'drop';
const MEMORY = 6;
const PERCEIVE_EVERY = 0.15;

const _e = new THREE.Vector3();
const _t = new THREE.Vector3();
const _f = new THREE.Vector3();
const _d = new THREE.Vector3();

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// How well a gun suits a fight at this distance: 1 at its preferred range, dropping with every
// meter away from it (so a narrow gun wins inside its band and loses outside it, whatever the
// band widths), negative outside the band, and worst of all when it's empty. The sidearm is a
// fallback, so it scores lower.
function bandFit(w, dist) {
  if (w.empty || w.def.bot.skip) return -100;
  // Needs a reload first: only better than nothing.
  if (w.mag === 0) return -50;
  return bandScore(w.def.bot, dist);
}
function bandScore(b, dist) {
  if (dist < b.min) return -(b.min - dist) / 4;
  if (dist > b.max) return -(dist - b.max) / 10;
  return Math.max(0.05, 1 - Math.abs(dist - b.pref) / 20) - (b.sidearm ? 0.5 : 0);
}

// How much a bot wants to keep a gun when a swap means giving one up.
function gunValue(def) {
  return def.bot.power ? 3 : def.bot.sidearm ? 0 : 1;
}
function keepValue(w) {
  return !w ? -2 : w.empty ? -1 : gunValue(w.def);
}

export class BotBrain {
  constructor(game, skillName = 'normal') {
    this.kind = 'bot';
    this.game = game;
    this.skill = BOT_SKILL[skillName] ?? BOT_SKILL.normal;
    this.skillName = BOT_SKILL[skillName] ? skillName : 'normal';
    this.tapT = 0;
    this.state = new InputState();
    this.player = null;
    this.reset();
    this.perceiveT = Math.random() * PERCEIVE_EVERY;
  }

  // Bots think in the fixed tick; nothing to poll per frame.
  update() {}

  reset() {
    this.path = null;
    this.step = 0;
    this.goalKind = '';
    this.chaseReplanT = 0;
    this.bestDist = Infinity;
    this.stuckT = 0;
    this.stuckCount = 0;
    this.unstickT = 0;
    this.unstickX = 0;
    this.stepJumped = false;
    this.jumpAt = -1;
    this.target = null;
    this.lastSeen = new THREE.Vector3();
    this.lastSeenT = -99;
    this.reactT = 0;
    this.trackT = 0;
    this.errX = 0;
    this.errY = 0;
    this.strafe = 1;
    this.strafeT = 0;
    // In a fight, alternate between holding ground and pushing along the route while shooting.
    this.advancing = false;
    this.advanceT = 0;
    this.burstOn = true;
    this.burstT = 0;
    this.tapT = 0;
    this.swapping = false;
    // When bugs latched on (0 when they aren't).
    this.swarmT = 0;
    // A lob gun found no arc to the target last tick; the sighting we last lobbed a jar at.
    this.lobFail = false;
    this.lobbedAtSeenT = -1;
    // The pickup we set out for (swapped for when we stand on it).
    this.goalItem = null;
    this.grenadeT = 3 + Math.random() * 3;
    this.throwT = 0;
    // Winding up a grenade at where a target ducked out of sight (chase).
    this.flushT = 0;
    // A portal we're walking into as a shortcut, until when, and when to look for one next.
    this.portalGoal = null;
    this.portalUntil = 0;
    this.portalCheckT = 0;
    // Crouching over someone we just smoked in Rocky Mountain Oysters (SAUCED).
    this.sauceT = 0;
    // Sizzlers: the one we're walking to, how long we've ridden and mean to, letting the guns
    // cool, getting unstuck (backing up), and no bike for a while after getting off one.
    if (this.goalBike?.claim === this) this.goalBike.claim = null;
    this.goalBike = null;
    this.rideT = 0;
    this.rideFor = 0;
    this.cooling = false;
    this.reverseT = 0;
    this.driveStuckT = 0;
    this.driveStucks = 0;
    this.bikeCooldown ??= 0;
    this.hurtBy = null;
    this.hurtT = -99;
    this.alive = true;
    // Look around right away after (re)spawning.
    this.perceiveT = 0;
  }

  // Gunfire nearby: treat the shooter like someone who just hurt us, so we turn to look.
  onHeard(source) {
    if (source === this.player) return;
    if (!this.target || this.game.time - this.lastSeenT > 1) {
      this.hurtBy = source;
      this.hurtT = this.game.time - 0.8;
    }
  }

  // Called by the player when something hurts it.
  onHurt(attacker) {
    if (attacker && attacker !== this.player && attacker.kind === 'player') {
      this.hurtBy = attacker;
      this.hurtT = this.game.time;
    }
  }

  think(dt) {
    const p = this.player;
    const s = this.state;
    s.moveX = 0;
    s.moveY = 0;
    for (const k of Object.keys(s.held)) s.held[k] = false;
    if (!p.alive) {
      if (this.alive) this.reset();
      this.alive = false;
      return;
    }
    this.alive = true;
    this.tapT -= dt;

    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = PERCEIVE_EVERY;
      this.perceive();
    }
    if (this.target && !this.target.alive) this.target = null;

    if (p.guiding) {
      this.guideMissile();
      return;
    }
    this.bikeCooldown -= dt;
    if (p.vehicle) {
      this.ride(dt);
      return;
    }

    const t = this.game.time;
    const sees = this.target && t - this.lastSeenT < 0.4;

    // The bike we walked to: get on (unless someone beat us to it).
    const gb = this.goalBike;
    if (gb && (gb.rider || !gb.alive)) {
      this.dropBike();
      this.path = null;
    } else if (gb && p.vehiclePrompt === gb) {
      s.press('interact');
      this.dropBike();
      this.path = null;
      this.rideT = 0;
      this.rideFor = RIDE_FOR[0] + Math.random() * (RIDE_FOR[1] - RIDE_FOR[0]);
      return;
    }

    // Standing on the gun we walked here for (or any power gun): swap for it. A swap gives up
    // the gun in hand, so first draw the one worth least; hold still for that unless fighting.
    const prompt = p.pickupPrompt;
    this.swapping = false;
    if (prompt && !prompt.def.bot.skip && (prompt === this.goalItem || (prompt.def.bot.power && !p.slots.some((w) => w?.def.bot.power)))) {
      const give = keepValue(p.slots[0]) <= keepValue(p.slots[1]) ? 0 : 1;
      if (keepValue(p.slots[give]) <= gunValue(prompt.def)) {
        if (p.switchT <= 0 && give === p.slot) {
          s.press('interact');
          this.goalItem = null;
          // No weapon switch this tick, or the swap would give up the gun switched to.
          this.swapping = true;
        } else {
          if (p.switchT <= 0) s.press('switchWeapon');
          if (!sees) return;
        }
      }
    }

    // Out of a fight: load guns we put away dry, then top up the one in hand.
    if (!sees) this.refill();

    // Bugs: Normal and Hard bots swat them once they notice; Easy bots run from them.
    const swarms = this.game.swarms;
    let chaser = null;
    if (swarms.count && swarms.on(p)) {
      this.swarmT ||= t;
      if (this.skillName !== 'easy' && t - this.swarmT > this.skill.reaction && p.meleeT <= 0) s.press('melee');
    } else {
      this.swarmT = 0;
      if (swarms.count && this.skillName === 'easy') chaser = swarms.after(p);
    }

    if (chaser) this.flee(chaser, dt);
    else if (sees) this.fight(dt);
    else if (this.sauce(dt)) return;
    else if (this.target && t - this.lastSeenT < MEMORY) this.chase(dt);
    else this.roam(dt);

    if (this.jumpAt > 0 && t >= this.jumpAt) {
      s.press('jump');
      this.jumpAt = -1;
    }
  }

  // ------------------------------------------------------------ senses

  perceive() {
    const p = this.player;
    const game = this.game;
    p.eyePosition(_e);
    p.facing(_f);
    const recentHurt = game.time - this.hurtT < 2 ? this.hurtBy : null;
    let best = null;
    let bestScore = Infinity;
    for (const o of game.players) {
      if (o === p || !o.alive) continue;
      o.centerPosition(_t);
      _t.y += 0.4;
      const dx = _t.x - _e.x;
      const dz = _t.z - _e.z;
      const d = Math.hypot(dx, _t.y - _e.y, dz);
      if (d > SIGHT_RANGE) continue;
      const hd = Math.hypot(dx, dz) || 1;
      const inView = (dx * _f.x + dz * _f.z) / hd > 0.35;
      if (!inView && d > HEAR_RANGE && o !== recentHurt) continue;
      if (game.lineBlocked(_e, _t)) continue;
      const score = d * (o === this.target ? 0.7 : 1) * (o === recentHurt ? 0.6 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best) return;
    if (best !== this.target) {
      this.target = best;
      this.reactT = this.skill.reaction * (0.8 + Math.random() * 0.4);
      this.trackT = 0;
      const e = this.skill.aimError * DEG * 2;
      this.errX = (Math.random() - 0.5) * e;
      this.errY = (Math.random() - 0.5) * e;
    }
    best.centerPosition(this.lastSeen);
    this.lastSeenT = game.time;
  }

  // ------------------------------------------------------------ aiming

  turnToward(yaw, pitch, rate, dt) {
    const p = this.player;
    const max = rate * dt * (1 + Math.min(1, Math.abs(wrap(yaw - p.yaw))) * 0.6);
    const dy = clamp(wrap(yaw - p.yaw), -max, max);
    const dp = clamp(pitch - p.pitch, -max, max);
    // applyLook subtracts look input from yaw/pitch (divided by the aim zoom, so undo that).
    this.state.lookX -= dy * p.aimZoom;
    this.state.lookY -= dp * p.aimZoom;
  }

  aimAt(point, dt, extraPitch = 0) {
    const p = this.player;
    p.eyePosition(_e);
    const dx = point.x - _e.x;
    const dz = point.z - _e.z;
    const yaw = Math.atan2(-dx, -dz) + this.errX;
    const pitch = Math.atan2(point.y - _e.y, Math.hypot(dx, dz)) + this.errY + extraPitch;
    // Where we mean to aim, without the wobble (lobbed shots check against this).
    this.wantYaw = yaw - this.errX;
    this.wantPitch = pitch - this.errY;
    this.turnToward(yaw, pitch, this.skill.turnRate, dt);
  }

  // Angle between where we look and where aimAt meant to point.
  aimOff() {
    const p = this.player;
    return Math.hypot(wrap(p.yaw - this.wantYaw) * Math.cos(p.pitch), p.pitch - this.wantPitch);
  }

  // Extra pitch for a lob from launcher `def` that lands on `point` (low arc), or null if it
  // can't get there before the fuse. Solves the drag-free arc, then corrects a few times for
  // the launch's extra lift and the projectile's damping (both depend on the flight time).
  lobArc(point, def) {
    const p = this.player;
    p.eyePosition(_e);
    const dx = Math.hypot(point.x - _e.x, point.z - _e.z);
    if (dx < 0.5) return null;
    const g = def.projectile.gravity ?? LOB_GRAVITY;
    const k = def.projectile.damping ?? 0;
    const up = def.launchUp ?? 0;
    let t = dx / def.launchSpeed;
    let theta = 0;
    for (let i = 0; i < 3; i++) {
      // Average share of the launch speed kept over the flight.
      const slow = k > 0 ? (1 - Math.exp(-k * t)) / (k * t) : 1;
      const s = def.launchSpeed * slow;
      const dy = point.y - _e.y - up * slow * t;
      const disc = s ** 4 - g * (g * dx * dx + 2 * dy * s * s);
      if (disc < 0) return null;
      theta = Math.atan((s * s - Math.sqrt(disc)) / (g * dx));
      t = dx / (s * Math.cos(theta));
    }
    if (t > (def.projectile.fuse ?? def.projectile.life ?? Infinity) * 0.95) return null;
    this.lobTime = t;
    return theta - Math.atan2(point.y - _e.y, dx);
  }

  // Angle between where we look and the true direction to a point.
  aimError(point) {
    const p = this.player;
    p.eyePosition(_e);
    _d.subVectors(point, _e).normalize();
    const cp = Math.cos(p.pitch);
    _f.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
    return Math.acos(clamp(_d.dot(_f), -1, 1));
  }

  faceToward(x, z, dt) {
    const p = this.player;
    this.turnToward(Math.atan2(-(x - p.center.x), -(z - p.center.z)), 0, 9, dt);
  }

  // ------------------------------------------------------------ behaviours

  fight(dt) {
    const p = this.player;
    const s = this.state;
    const sk = this.skill;
    const tg = this.target;
    tg.centerPosition(_t);
    const dist = p.center.distanceTo(_t);
    this.chooseWeapon(dist);

    // Aim wobbles less the longer we track the same target.
    this.trackT += dt;
    this.reactT -= dt;
    const maxErr = sk.aimError * DEG * (1 + 1.5 * Math.exp(-this.trackT));
    this.errX = clamp(this.errX + (Math.random() - 0.5) * maxErr * 5 * dt, -maxErr, maxErr);
    this.errY = clamp(this.errY + (Math.random() - 0.5) * maxErr * 5 * dt, -maxErr, maxErr);
    const w = p.weapon.def;
    let arc = 0;
    let lobOk = true;
    // The Gravity Gun out of punt range: grab a prop and fling it (it aims and fires itself).
    const flinging = w.kind === 'gravity' && this.throwT <= 0 && dist > w.puntRange + 1 && this.fling(dt, dist);
    if (flinging) {
      // (Nothing else to aim.)
    } else if (this.throwT > 0) {
      // Winding up a grenade: lob it to land at their feet, whatever gun is in hand.
      _t.y -= 0.6;
      arc = this.lobArc(_t, GRENADE_LOB) ?? 0.16 + dist * 0.008;
    } else if (w.bot.lob) {
      // At their feet (or their chest if low cover hides the feet), leading a moving target by
      // the flight time, minus the half of our own velocity the launch adds.
      _t.y -= 0.8;
      p.eyePosition(_e);
      if (this.game.lineBlocked(_e, _t)) _t.y += 1.15;
      if (this.lobArc(_t, w) !== null) {
        if (tg.vel) _t.addScaledVector(tg.vel, this.lobTime * sk.lead);
        _t.addScaledVector(p.vel, -0.5 * this.lobTime);
      }
      const a = this.lobArc(_t, w);
      lobOk = a !== null;
      // No arc reaches them from here: close in, or let chooseWeapon swap to the other gun.
      this.lobFail = !lobOk;
      arc = a ?? 0;
    } else {
      // Chest height, or the head for Hard bots with a precision gun.
      _t.y = w.bot.headshots && this.skillName === 'hard' ? tg.headLineY() + 0.12 : _t.y + 0.35;
    }
    if (!flinging) this.aimAt(_t, dt, arc);
    if (w.bot.zoomAt && dist > w.bot.zoomAt) s.held.aim = true;

    this.burstT -= dt;
    if (this.burstT <= 0) {
      this.burstOn = !this.burstOn;
      this.burstT = (this.burstOn ? sk.burst[0] : sk.burst[1]) * (0.7 + Math.random() * 0.6);
    }
    // A little past the band is fine, but never past what the gun reaches (the Brander's beam).
    const inRange = dist >= w.bot.min && dist <= Math.min(w.bot.max * 1.2, w.range ?? Infinity);
    const cone = (sk.fireCone * DEG + Math.atan(0.45 / Math.max(1, dist))) * (w.bot.careful ?? 1);
    const onTarget = w.bot.lob ? lobOk && this.aimOff() < cone : this.aimError(_t) < cone;
    // Spin-up guns keep the trigger down through the whole fight so the barrels stay hot.
    if (w.spinUp && w.bot.hold && inRange && this.reactT <= 0 && this.throwT <= 0) s.held.fire = true;
    if (!flinging && this.reactT <= 0 && this.throwT <= 0 && inRange && onTarget) {
      if (w.auto) {
        if (this.burstOn || w.bot.hold) s.held.fire = true;
      } else if (p.weapon.cooldown <= 0 && this.tapT <= 0) {
        // Semi-autos: tap at the skill's share of the full rate.
        s.press('fire');
        this.tapT = 1 / (w.fireRate * sk.semiRate);
      }
    }
    if (dist < 2.3 && p.meleeT <= 0 && this.reactT <= 0) s.press('melee');

    // Grenades when they're worth it: at someone standing still, into a crowd, or while our gun
    // is empty; never close enough to catch the blast ourselves.
    this.grenadeT -= dt;
    if (this.grenadeT <= 0) {
      this.grenadeT = 2 + Math.random() * 2;
      if (p.grenades > 0 && dist > 7 && dist < 22) {
        let chance = sk.grenadeChance * 0.5;
        if (tg.vel && Math.hypot(tg.vel.x, tg.vel.z) < 1.5) chance *= 1.8;
        if (p.weapon.reloading || p.weapon.mag === 0) chance *= 2;
        tg.centerPosition(_d);
        for (const o of this.game.players) if (o !== p && o !== tg && o.alive && o.center.distanceTo(_d) < 4) chance *= 2;
        if (Math.random() < chance) this.throwT = 0.3;
      }
    }
    if (this.throwT > 0) {
      this.throwT -= dt;
      if (this.throwT <= 0) s.press('grenade');
    }

    this.advanceT -= dt;
    if (this.advanceT <= 0) {
      this.advancing = !w.bot.noAdvance && Math.random() < sk.advance * (w.bot.mobile ? 1.5 : 1);
      this.advanceT = 2.5 + Math.random() * 3;
    }
    if (this.advancing) {
      // Run and gun: keep following the route (climbs included) while aiming at the target.
      if (!this.path || this.step >= this.path.length) this.pickRoamGoal();
      if (this.followPath(dt, false, true)) {
        if (Math.random() < sk.jumpRate * 0.5 * dt) s.press('jump');
        return;
      }
    }
    // Strafe and keep a comfortable range for the gun in hand.
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.strafeT = 0.5 + Math.random();
    }
    const pref = w.bot.pref;
    s.moveX = this.strafe * sk.strafe;
    s.moveY = dist > pref * 1.5 || (w.bot.lob && this.lobFail) ? 1 : dist < pref * 0.5 ? -0.7 : 0;
    if (Math.random() < sk.jumpRate * dt) s.press('jump');
    // Don't let go halfway up a net or rope.
    if (p.mode === 'net' || p.mode === 'rope' || p.mode === 'bars') {
      s.moveX = 0;
      s.moveY = 1;
    }
  }

  // A loadout for the next life: a coin flip, but Hard bots lean toward the longer-range primary.
  pickLoadout() {
    const loadouts = this.game.arsenal.loadouts;
    if (this.skillName !== 'hard' || loadouts.length < 2) return Math.floor(Math.random() * loadouts.length);
    const reach = (l) => WEAPONS[l.guns[0]].bot.pref;
    const longer = reach(loadouts[1]) > reach(loadouts[0]) ? 1 : 0;
    return Math.random() < 0.65 ? longer : 1 - longer;
  }

  // Use whichever gun's range band fits the fight better. Power weapons only now and then.
  chooseWeapon(dist) {
    const p = this.player;
    const other = p.slots[1 - p.slot];
    if (!other || other.empty || p.switchT > 0 || this.swapping) return;
    // Primary dry mid-fight: finish with the sidearm instead of reloading (refill() loads the
    // primary once the fight is over). Once the sidearm is dry too, reload the primary.
    const w = p.weapon;
    if (other.def.bot.sidearm && other.mag > 0 && dist < 30 && w.mag === 0) {
      this.switchWeapon();
      return;
    }
    if (w.def.bot.sidearm && w.mag === 0 && other.mag === 0 && other.reserve > 0) {
      this.switchWeapon();
      return;
    }
    // A lob gun that can't reach them from here counts as out of its band.
    const cur = w.def.bot.lob && this.lobFail ? -1 : this.fit(w, dist);
    const alt = this.fit(other, dist);
    if (other.def.bot.power && Math.random() > 0.02) return;
    if (alt > cur + 0.25) this.switchWeapon();
  }

  // bandFit, but a Gravity Gun with something to throw reaches as far as it can fling it.
  fit(w, dist) {
    if (w.def.kind === 'gravity' && this.propToGrab(true)) return bandScore(FLING_BAND, dist);
    return bandFit(w, dist);
  }

  // The nearest loose prop the Gravity Gun could take from here (in sight, inside its reach), or
  // null; with `orHeld`, whatever we're already holding counts.
  propToGrab(orHeld = false) {
    const gv = this.game.gravity;
    const p = this.player;
    if (!gv) return null;
    const h = gv.holding(p);
    if (h) return orHeld ? h.obj : null;
    p.eyePosition(_e);
    const reach = WEAPONS.gravityGun.range * 0.85;
    let best = null;
    let bd = reach;
    for (const [kind, obj] of gv.candidates()) {
      if (kind !== 'prop') continue;
      const d = obj.pos.distanceTo(_e);
      if (d < 0.6 || d >= bd || this.game.lineBlocked(_e, obj.pos)) continue;
      bd = d;
      best = obj;
    }
    return best;
  }

  // Gravity Gun at range: holding something, throw it at the target (leading them, aimed over
  // the drop); otherwise turn to the nearest prop and grab it. False when there's nothing to use.
  fling(dt, dist) {
    const gv = this.game.gravity;
    const p = this.player;
    const w = p.weapon;
    const tg = this.target;
    if (!gv) return false;
    const ready = p.weapon.cooldown <= 0 && this.reactT <= 0 && p.switchT <= 0;
    if (gv.holding(p)) {
      if (dist > FLING_BAND.max * 1.2) return false;
      const t = dist / w.def.throwSpeed;
      tg.centerPosition(_t);
      if (tg.vel) _t.addScaledVector(tg.vel, t * this.skill.lead);
      // Props fall like everything else (8 = half of gravity) on the way.
      this.aimAt(_t, dt, Math.atan2(8 * t * t, dist));
      const cone = this.skill.fireCone * DEG + Math.atan(0.6 / Math.max(1, dist));
      if (ready && this.aimOff() < cone) this.state.press('fire');
      return true;
    }
    const prop = this.propToGrab();
    if (!prop) return false;
    this.aimAt(prop.pos, dt);
    if (ready && this.aimError(prop.pos) < w.def.grabCone * 0.5 * DEG) this.state.press('fire');
    return true;
  }

  switchWeapon() {
    this.state.press('switchWeapon');
    // The new gun's own cooldown and draw time pace it; don't carry the old gun's tap wait.
    this.tapT = 0;
  }

  // Between fights: draw a gun that was put away dry so it reloads, reload the one in hand,
  // then put the sidearm away for the primary.
  refill() {
    const p = this.player;
    const w = p.weapon;
    if (p.switchT > 0 || w.reloading || this.swapping) return;
    const other = p.slots[1 - p.slot];
    if (other && other.mag === 0 && other.reserve > 0 && w.mag > 0) this.switchWeapon();
    else if (w.canReload()) this.state.press('reload');
    else if (w.def.bot.sidearm && other && other.mag > 0 && !other.def.bot.sidearm && !other.def.bot.power) this.switchWeapon();
  }

  // Steer our own Smoke Signal into the target.
  guideMissile() {
    const m = this.player.guiding;
    const tg = this.target;
    if (!tg || !tg.alive) return;
    tg.centerPosition(_t);
    const dx = _t.x - m.pos.x;
    const dz = _t.z - m.pos.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(_t.y - m.pos.y, Math.hypot(dx, dz));
    // applyLook scales steering by 0.8; the missile caps the turn rate itself.
    this.state.lookX = -wrap(yaw - m.yaw) / 0.8;
    this.state.lookY = -(pitch - m.pitch) / 0.8;
    if (m.pos.distanceTo(_t) < 1.6) this.state.press('fire');
  }

  chase(dt) {
    this.chaseReplanT -= dt;
    if (!this.path || this.chaseReplanT <= 0) {
      this.chaseReplanT = 1.5;
      this.planTo(this.lastSeen, 'chase');
    }
    // A gun that doesn't need a sighting (the Swarm Jar): lob it where they were last seen,
    // walking the route meanwhile.
    if (this.takePortal(dt)) return;
    const w = this.player.weapon;
    const lobbing = this.flush(dt) || (w.def.bot.noSight && w.mag > 0 && !w.reloading && this.lobAtLastSeen(dt));
    if (!this.followPath(dt, !lobbing, lobbing)) this.target = null;
  }

  // They ducked out of sight a moment ago: now and then lob a grenade where they were, to flush
  // them out (aimed while walking the route there).
  flush(dt) {
    const p = this.player;
    if (this.flushT > 0) {
      this.flushT -= dt;
      _t.copy(this.lastSeen);
      _t.y -= 0.6;
      const arc = this.lobArc(_t, GRENADE_LOB);
      if (arc === null) {
        this.flushT = 0;
        return false;
      }
      this.aimAt(_t, dt, arc);
      if (this.flushT <= 0) this.state.press('grenade');
      return true;
    }
    this.grenadeT -= dt;
    if (this.grenadeT > 0 || p.grenades <= 0 || this.game.time - this.lastSeenT > 2.5) return false;
    this.grenadeT = 3 + Math.random() * 2;
    const dist = p.center.distanceTo(this.lastSeen);
    if (dist < 8 || dist > 20 || Math.random() > this.skill.grenadeChance * 1.5) return false;
    this.flushT = 0.35;
    return true;
  }

  // Portals anyone opened are fair game: when a linked one near us (in sight, its open face toward
  // us, its bottom at our feet) comes out much nearer where we're headed, walk into it.
  takePortal(dt) {
    const ps = this.game.portals;
    const p = this.player;
    const s = this.state;
    const t = this.game.time;
    if (!ps || !ps.list.length || !this.path || this.step >= this.path.length) {
      this.portalGoal = null;
      return false;
    }
    const goal = this.path[this.path.length - 1].node;
    if (this.portalGoal) {
      const done = p.portalT > t || t > this.portalUntil || !ps.list.includes(this.portalGoal) || !ps.exitOf(this.portalGoal);
      if (!done) {
        const c = this.portalGoal.c;
        this.faceToward(c.x, c.z, dt);
        s.moveY = 1;
        s.held.sprint = true;
        return true;
      }
      this.portalGoal = null;
      // Through (or given up): plan again from wherever we are now.
      _t.set(goal.x, goal.y, goal.z);
      this.planTo(_t, this.goalKind);
      return false;
    }
    this.portalCheckT -= dt;
    if (this.portalCheckT > 0) return false;
    this.portalCheckT = 1;
    const feet = p.feetY();
    const direct = Math.hypot(goal.x - p.center.x, goal.z - p.center.z);
    p.eyePosition(_e);
    let best = null;
    let bestGain = 8;
    for (const q of ps.list) {
      const exit = ps.exitOf(q);
      if (!exit) continue;
      const floor = q.n.y > 0.7;
      // Walls: the oval's bottom (1 m under its middle) at our feet. Floors: at our feet.
      if (!floor && (Math.abs(q.n.y) > 0.3 || Math.abs(q.c.y - 1 - feet) > 0.6)) continue;
      if (floor && Math.abs(q.c.y - feet) > 0.5) continue;
      const toX = q.c.x - p.center.x;
      const toZ = q.c.z - p.center.z;
      const near = Math.hypot(toX, toZ);
      if (near > 14 || (!floor && toX * q.n.x + toZ * q.n.z > 0)) continue;
      _t.copy(q.c).addScaledVector(q.n, 0.3);
      if (this.game.lineBlocked(_e, _t)) continue;
      const gain = direct - (near + Math.hypot(goal.x - exit.c.x, goal.z - exit.c.z));
      if (gain > bestGain) {
        bestGain = gain;
        best = q;
      }
    }
    if (!best) return false;
    this.portalGoal = best;
    this.portalUntil = t + 5;
    return true;
  }

  // Rocky Mountain Oysters: right after smoking someone, go stand over them and crouch three times
  // for SAUCED (a size up), unless there's a fight to have.
  sauce(dt) {
    const oy = this.game.oysters;
    if (!oy) return false;
    const sc = oy.of(this.player).sauce;
    if (!sc) {
      this.sauceT = 0;
      return false;
    }
    const p = this.player;
    const s = this.state;
    const d = Math.hypot(sc.x - p.center.x, sc.z - p.center.z);
    if (d > 8) return false;
    if (d > 1.2) {
      this.faceToward(sc.x, sc.z, dt);
      s.moveY = 1;
    }
    if (d < 2.2) {
      this.sauceT += dt;
      s.held.crouch = Math.floor(this.sauceT / 0.2) % 2 === 0;
    }
    return true;
  }

  // One jar per sighting: the swarm it lets out hunts that spot on its own.
  lobAtLastSeen(dt) {
    const p = this.player;
    const w = p.weapon.def;
    if (this.lobbedAtSeenT === this.lastSeenT) return false;
    const dist = p.center.distanceTo(this.lastSeen);
    if (dist < w.bot.min || dist > w.bot.max * 1.2) return false;
    _t.copy(this.lastSeen);
    _t.y -= 0.8;
    // The launch adds half our own velocity: aim off that much.
    if (this.lobArc(_t, w) === null) return false;
    _t.addScaledVector(p.vel, -0.5 * this.lobTime);
    const arc = this.lobArc(_t, w);
    if (arc === null) return false;
    this.aimAt(_t, dt, arc);
    const cone = this.skill.fireCone * DEG + Math.atan(0.45 / Math.max(1, dist));
    if (this.aimOff() < cone && p.weapon.cooldown <= 0 && this.tapT <= 0 && p.switchT <= 0) {
      this.state.press('fire');
      this.tapT = 1 / (w.fireRate * this.skill.semiRate);
      this.lobbedAtSeenT = this.lastSeenT;
    }
    return true;
  }

  // Easy bots run from a swarm that's after them: face away and sprint.
  flee(swarm, dt) {
    const p = this.player;
    const s = this.state;
    const ax = p.center.x - swarm.pos.x;
    const az = p.center.z - swarm.pos.z;
    const h = Math.hypot(ax, az) || 1;
    this.faceToward(p.center.x + (ax / h) * 5, p.center.z + (az / h) * 5, dt);
    s.moveY = 1;
    s.held.sprint = true;
  }

  // ------------------------------------------------------------ Sizzlers

  // Now and then, a free bike in reach (that no other bot is already after) becomes the goal.
  goalBikeNear() {
    const vs = this.game.vehicles;
    const p = this.player;
    if (!vs || this.bikeCooldown > 0 || Math.random() > BIKE_CHANCE[this.skillName]) return false;
    let best = null;
    let bd = BIKE_REACH;
    for (const b of vs.bikes) {
      if (!b.alive || b.rider || (b.claim && b.claim !== this && b.claim.goalBike === b)) continue;
      const d = b.pos.distanceTo(p.center);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return false;
    _t.set(best.pos.x + Math.sin(best.yaw) * 0.3, best.pos.y, best.pos.z + Math.cos(best.yaw) * 0.3);
    this.planTo(_t, 'vehicle');
    if (!this.path) return false;
    this.goalBike = best;
    best.claim = this;
    return true;
  }

  dropBike() {
    if (this.goalBike?.claim === this) this.goalBike.claim = null;
    this.goalBike = null;
  }

  // On a Sizzler. The bike turns toward where we look, so fighting from it means looking at the
  // target and driving at them (running them over if they don't move), guns going, easing off
  // the trigger before the guns overheat. Otherwise drive a route a bike can take. Get off when
  // the hull's nearly gone mid-fight, when it keeps getting stuck, or after riding a while with
  // nobody around.
  ride(dt) {
    const p = this.player;
    const s = this.state;
    const b = p.vehicle;
    const sk = this.skill;
    const t = this.game.time;
    this.rideT += dt;
    const sees = this.target && t - this.lastSeenT < 0.4;
    const bail = (sees && b.vitals.healthFrac < 0.25 && Math.random() < dt * 3) || this.driveStucks >= 4 || (!sees && this.rideT > this.rideFor);
    if (bail) {
      s.press('interact');
      this.bikeCooldown = 12 + Math.random() * 10;
      this.path = null;
      this.driveStucks = 0;
      return;
    }
    if (sees) {
      const tg = this.target;
      tg.centerPosition(_t);
      const dist = p.center.distanceTo(_t);
      this.trackT += dt;
      this.reactT -= dt;
      const maxErr = sk.aimError * DEG * (1 + 1.5 * Math.exp(-this.trackT));
      this.errX = clamp(this.errX + (Math.random() - 0.5) * maxErr * 5 * dt, -maxErr, maxErr);
      this.errY = clamp(this.errY + (Math.random() - 0.5) * maxErr * 5 * dt, -maxErr, maxErr);
      // Lead a moving target a little (the rounds are hitscan, but we're moving too).
      if (tg.vel) _t.addScaledVector(tg.vel, 0.08 * sk.lead);
      this.aimAt(_t, dt);
      // Strafing runs: past mid range the bike arcs across them (guns still on them, within
      // their swing), switching sides now and then; close in, straight at them.
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafe = Math.random() < 0.5 ? -1 : 1;
        this.strafeT = 1.5 + Math.random() * 2;
      }
      p.driveYaw = dist > 9 ? wrap(this.wantYaw + this.strafe * SIZZLER.gun.swing * 0.5) : null;
      s.moveY = 1;
      s.held.sprint = dist > 22 && b.boost > 0.3;
      // Let the guns cool before they lock up (Easy bots run them hot).
      if (b.heat > (this.skillName === 'easy' ? 0.97 : 0.82)) this.cooling = true;
      if (b.heat < 0.35) this.cooling = false;
      const cone = (sk.fireCone * DEG + Math.atan(0.6 / Math.max(1, dist))) * 1.4;
      if (this.reactT <= 0 && !this.cooling && !b.overheated && dist < SIZZLER.gun.range && this.aimError(_t) < cone) s.held.fire = true;
      this.path = null;
      this.driveStuck(dt, b);
      return;
    }
    p.driveYaw = null;
    // A target we lost: where we saw them. Otherwise anywhere on the ground a bike can reach.
    if (!this.path || this.step >= this.path.length) {
      if (this.target && t - this.lastSeenT < MEMORY) this.planTo(this.lastSeen, 'chase', DRIVE);
      else {
        const n = this.game.nav.randomNode((x) => x.y < 4.5 && !x.mud);
        this.planTo(_t.set(n.x, n.y, n.z), 'drive', DRIVE);
      }
    }
    this.drive(dt, b);
  }

  // Steer down the path, looking a waypoint or two ahead; slow for sharp turns, boost on the
  // straights.
  drive(dt, b) {
    const p = this.player;
    const s = this.state;
    const path = this.path;
    if (!path) {
      this.driveStuck(dt, b);
      return;
    }
    const c = p.center;
    while (this.step < path.length && Math.hypot(path[this.step].node.x - c.x, path[this.step].node.z - c.z) < 2.6) this.step++;
    if (this.step >= path.length) {
      this.path = null;
      return;
    }
    const look = path[Math.min(path.length - 1, this.step + 1)].node;
    const yaw = Math.atan2(-(look.x - c.x), -(look.z - c.z));
    this.turnToward(yaw, -0.08, 4, dt);
    const off = Math.abs(wrap(yaw - b.yaw));
    s.moveY = off > 1.3 ? 0.3 : off > 0.6 ? 0.65 : 1;
    s.held.sprint = off < 0.25 && b.boost > 0.5 && path.length - this.step > 8;
    this.driveStuck(dt, b);
  }

  // Not getting anywhere with the throttle open: back up and turn for a moment, then try again
  // (a new route every other time).
  driveStuck(dt, b) {
    const s = this.state;
    const speed = Math.hypot(b.vel.x, b.vel.z);
    if (speed > 6) this.driveStucks = Math.max(0, this.driveStucks - dt * 0.3);
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      s.moveY = -1;
      s.moveX = this.unstickX;
      s.held.fire = false;
      return;
    }
    if (s.moveY > 0.25 && speed < 1.2) this.driveStuckT += dt;
    else this.driveStuckT = Math.max(0, this.driveStuckT - dt * 2);
    if (this.driveStuckT > 1.2) {
      this.driveStuckT = 0;
      this.reverseT = 0.9;
      this.driveStucks++;
      this.unstickX = Math.random() < 0.5 ? -1 : 1;
      if (this.driveStucks % 2 === 0) this.path = null;
    }
  }

  roam(dt) {
    if (!this.path || this.step >= this.path.length) this.pickRoamGoal();
    if (this.takePortal(dt)) return;
    if (!this.followPath(dt, true)) this.path = null;
  }

  pickRoamGoal() {
    const p = this.player;
    if (this.goalBikeNear()) return;
    const items = this.game.pickups.items;
    let goal = null;
    let kind = 'wander';
    const pick = (pred) => {
      let best = null;
      let bd = Infinity;
      for (const i of items) {
        if (!i.active || !pred(i)) continue;
        const d = i.pos.distanceTo(p.center);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    // Go for the power weapon, or now and then a gun we don't have.
    const lacks = (i) => i.type === 'weapon' && !i.def.bot.skip && !p.slots.some((w) => w?.def === i.def);
    const r = Math.random();
    const it = r < 0.35 ? pick((i) => lacks(i) && i.def.bot.power) : r < 0.5 ? pick(lacks) : null;
    if (it) {
      goal = it.pos;
      kind = 'weapon';
      this.goalItem = it;
    } else if (p.grenades < 2 && Math.random() < 0.6) {
      const it = pick((i) => i.type === 'grenades');
      if (it) {
        goal = it.pos;
        kind = 'grenades';
      }
    }
    if (!goal) {
      // Favor high ground now and then.
      const high = Math.random() < (p.weapon.def.bot.highGround ?? 0.3);
      const n = this.game.nav.randomNode((x) => (high ? x.y > 2 : true));
      goal = _t.set(n.x, n.y, n.z);
    }
    this.planTo(goal, kind);
  }

  planTo(goal, kind, allow = null) {
    const nav = this.game.nav;
    const p = this.player;
    _d.set(p.center.x, p.feetY(), p.center.z);
    const start = nav.nearest(_d, 6);
    const end = nav.nearest(goal, 6);
    this.path = nav.findPath(start, end, allow);
    this.step = 0;
    this.goalKind = kind;
    this.bestDist = Infinity;
    this.stuckT = 0;
    this.stuckCount = 0;
    this.stepJumped = false;
  }

  // Walk the current path. Returns false when there's nothing left to follow.
  // aiming: the bot is looking at a target, so walk-type steps move relative to its facing
  // instead of turning toward the waypoint. Climbs still need to face the obstacle.
  followPath(dt, sprint, aiming = false) {
    const p = this.player;
    const s = this.state;
    if (!this.path || this.step >= this.path.length) return false;
    const st = this.path[this.step];
    const n = st.node;
    const type = st.type;
    const c = p.center;
    const dx = n.x - c.x;
    const dz = n.z - c.z;
    const hd = Math.hypot(dx, dz);
    const dy = n.y - p.feetY();

    const arrive = type === 'walk' || type === 'drop' || type === 'firejump' ? 0.8 : 1.15;
    if (hd < arrive && Math.abs(dy) < 1.2 && p.mode === 'move') {
      this.step++;
      this.bestDist = Infinity;
      this.stuckT = 0;
      this.stuckCount = 0;
      this.stepJumped = false;
      return this.step < this.path.length;
    }

    const flat = type === 'walk' || type === 'drop' || type === 'firejump';
    if (aiming && flat && p.mode === 'move' && hd > 1e-3) {
      // Move toward the waypoint in our own frame while the aim stays on the target.
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      s.moveY = (dx * fx + dz * fz) / hd;
      s.moveX = (dx * -fz + dz * fx) / hd;
    } else {
      // Monkey bars: stay on the bars' centerline the whole way across.
      if (type === 'bars' && st.edge.mid) this.faceToward(n.x, st.edge.mid[2], dt);
      // Ropes: walk straight into the rope before climbing it.
      else if (type === 'rope' && st.edge.mid && p.mode === 'move') this.faceToward(st.edge.mid[0], st.edge.mid[2], dt);
      else this.faceToward(n.x, n.z, dt);
      s.moveY = 1;
      if (type === 'bars' && st.edge.mid) {
        // Sidestep onto the bars' centerline, and don't step off until lined up.
        const errZ = st.edge.mid[2] - c.z;
        const rz = -Math.sin(p.yaw);
        if (Math.abs(rz) > 0.3) s.moveX = clamp((errZ * 3) / rz, -1, 1);
        if (p.mode === 'move' && Math.abs(errZ) > 0.3) s.moveY = 0.25;
      }
    }
    s.held.sprint = sprint && (type === 'walk' || type === 'drop');

    const grounded = p.grounded && p.mode === 'move';
    if (!this.stepJumped && grounded) {
      if ((type === 'jump' && hd < 2.0) || (type === 'firejump' && hd < 2.3)) {
        s.press('jump');
        this.stepJumped = true;
      } else if (type === 'doublejump' && hd < 1.9) {
        s.press('jump');
        this.jumpAt = this.game.time + 0.33;
        this.stepJumped = true;
      } else if (type === 'over' && st.edge.jumps > 0 && st.edge.mid) {
        const m = st.edge.mid;
        if (Math.hypot(m[0] - c.x, m[2] - c.z) < (st.edge.jumps > 1 ? 1.7 : 1.5)) {
          s.press('jump');
          if (st.edge.jumps > 1) this.jumpAt = this.game.time + 0.33;
          this.stepJumped = true;
        }
      }
    }

    // Unstick: no progress for a while means jump, wiggle, and eventually give up on the path.
    const d = hd + Math.abs(dy);
    if (d < this.bestDist - 0.3) {
      this.bestDist = d;
      this.stuckT = 0;
    } else {
      this.stuckT += dt;
    }
    if (this.unstickT > 0) {
      this.unstickT -= dt;
      s.moveX = this.unstickX;
    }
    if (this.stuckT > 1.4) {
      this.stuckT = 0;
      this.stuckCount++;
      this.stepJumped = false;
      s.press('jump');
      this.unstickT = 0.5;
      this.unstickX = Math.random() < 0.5 ? -1 : 1;
      if (this.stuckCount >= 3) {
        this.path = null;
        return false;
      }
    }
    return true;
  }
}
