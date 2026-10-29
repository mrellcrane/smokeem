import * as THREE from 'three';
import { InputState } from '../input/inputState.js';
import { DEG, clamp } from '../util/math.js';
import { WEAPONS } from '../combat/weapons.js';

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
// semiRate: share of a semi-auto gun's full fire rate a bot taps at.

export const BOT_SKILL = {
  easy: { reaction: 0.75, aimError: 5, turnRate: 3.2, fireCone: 6, burst: [0.45, 0.9], grenadeChance: 0.15, jumpRate: 0.2, strafe: 0.6, advance: 0.3, semiRate: 0.55 },
  normal: { reaction: 0.42, aimError: 2.6, turnRate: 5.5, fireCone: 4, burst: [0.7, 0.5], grenadeChance: 0.3, jumpRate: 0.45, strafe: 0.85, advance: 0.45, semiRate: 0.8 },
  hard: { reaction: 0.22, aimError: 1.4, turnRate: 8.5, fireCone: 2.8, burst: [1.0, 0.3], grenadeChance: 0.45, jumpRate: 0.7, strafe: 1, advance: 0.55, semiRate: 1 },
};

export const BOT_NAMES = ['Gristle', 'Dry Rub', 'Rib Tip', 'Pit Boss', 'Low n Slow', 'Charcoal', 'Flare-Up', 'Mop Sauce'];
export const BOT_COLORS = [0xe0702a, 0x9b59d0, 0x2fb8a8, 0xe06aa8, 0xd8d8d8, 0x6a8f3a, 0x8a5a3a, 0x4a6ad0];

const SIGHT_RANGE = 75;
const HEAR_RANGE = 7;
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
  if (w.empty) return -100;
  // Needs a reload first: only better than nothing.
  if (w.mag === 0) return -50;
  const b = w.def.bot;
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
    // The pickup we set out for (swapped for when we stand on it).
    this.goalItem = null;
    this.grenadeT = 3 + Math.random() * 3;
    this.throwT = 0;
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

    const t = this.game.time;
    const sees = this.target && t - this.lastSeenT < 0.4;

    // Standing on the gun we walked here for (or any power gun): swap for it. A swap gives up
    // the gun in hand, so first draw the one worth least; hold still for that unless fighting.
    const prompt = p.pickupPrompt;
    this.swapping = false;
    if (prompt && (prompt === this.goalItem || (prompt.def.bot.power && !p.slots.some((w) => w?.def.bot.power)))) {
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

    if (sees) this.fight(dt);
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
    this.turnToward(yaw, pitch, this.skill.turnRate, dt);
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
    // Chest height, or the head for Hard bots with a precision gun.
    _t.y = w.bot.headshots && this.skillName === 'hard' ? tg.headLineY() + 0.12 : _t.y + 0.35;
    let arc = 0;
    if (this.throwT > 0) arc = 0.16 + dist * 0.008;
    this.aimAt(_t, dt, arc);
    if (w.bot.zoomAt && dist > w.bot.zoomAt) s.held.aim = true;

    this.burstT -= dt;
    if (this.burstT <= 0) {
      this.burstOn = !this.burstOn;
      this.burstT = (this.burstOn ? sk.burst[0] : sk.burst[1]) * (0.7 + Math.random() * 0.6);
    }
    const inRange = dist >= w.bot.min && dist <= w.bot.max * 1.2;
    const cone = (sk.fireCone * DEG + Math.atan(0.45 / Math.max(1, dist))) * (w.bot.careful ?? 1);
    if (this.reactT <= 0 && this.throwT <= 0 && inRange && this.aimError(_t) < cone) {
      if (w.auto) {
        if (this.burstOn) s.held.fire = true;
      } else if (p.weapon.cooldown <= 0 && this.tapT <= 0) {
        // Semi-autos: tap at the skill's share of the full rate.
        s.press('fire');
        this.tapT = 1 / (w.fireRate * sk.semiRate);
      }
    }
    if (dist < 2.3 && p.meleeT <= 0 && this.reactT <= 0) s.press('melee');

    this.grenadeT -= dt;
    if (this.grenadeT <= 0) {
      this.grenadeT = 5 + Math.random() * 4;
      if (p.grenades > 0 && dist > 7 && dist < 22 && Math.random() < sk.grenadeChance) this.throwT = 0.3;
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
    s.moveY = dist > pref * 1.5 ? 1 : dist < pref * 0.5 ? -0.7 : 0;
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
    const cur = bandFit(w, dist);
    const alt = bandFit(other, dist);
    if (other.def.bot.power && Math.random() > 0.02) return;
    if (alt > cur + 0.25) this.switchWeapon();
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
    if (!this.followPath(dt, true)) this.target = null;
  }

  roam(dt) {
    if (!this.path || this.step >= this.path.length) this.pickRoamGoal();
    if (!this.followPath(dt, true)) this.path = null;
  }

  pickRoamGoal() {
    const p = this.player;
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
    const lacks = (i) => i.type === 'weapon' && !p.slots.some((w) => w?.def === i.def);
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

  planTo(goal, kind) {
    const nav = this.game.nav;
    const p = this.player;
    _d.set(p.center.x, p.feetY(), p.center.z);
    const start = nav.nearest(_d, 6);
    const end = nav.nearest(goal, 6);
    this.path = nav.findPath(start, end);
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
