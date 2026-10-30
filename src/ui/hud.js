import { loadoutCard } from './loadoutCard.js';
import { DEG } from '../util/math.js';
import { currentSpread } from '../combat/shooting.js';
import { RESPAWN_DELAY, SCOPE_ZOOM } from '../player/player.js';
import { controlsHtml } from './controls.js';
import { clockText, ordinal } from '../match.js';
import { Radar } from './radar.js';
import { SIZZLER } from '../config.js';

// Per-player HUD laid over that player's viewport. Plain DOM; every write is cached so the
// DOM is only touched when a value actually changes.

const KEY_LABELS = {
  keyboardMouse: { climb: 'W / S', move: 'WASD', jump: 'Space', crouch: 'C', reload: 'R', interact: 'E', fire: 'Click', steer: 'Mouse', pick: 'A / D', melee: 'F', grapple: 'Q', sprint: 'Shift', turn: 'A / D', fire2: 'Right click' },
  gamepad: { climb: 'Left stick', move: 'Left stick', jump: 'A', crouch: 'B', reload: 'X', interact: 'Hold X', fire: 'RT', steer: 'Right stick', pick: 'Left stick', melee: 'RB', grapple: 'LB', sprint: 'LS click', turn: 'Left stick', fire2: 'LT' },
};

const HITMARKER_TIME = 0.18;
const HURT_TIME = 0.4;
const KILL_MSG_TIME = 1.8;
const FEED_TIME = 6;
// Most rounds the ammo ticks show one tick each for; bigger mags share ticks.
const MAX_TICKS = 40;

const hex = (c) => (c == null ? 'inherit' : `#${c.toString(16).padStart(6, '0')}`);
const nameHtml = (p) => `<b style="color:${hex(p.color)}">${p.name}</b>`;

// One kill feed line: "Killer weapon Victim", or "Victim how" when nobody else did it.
// Zoomed far enough with a scoped gun to look through the scope.
export function scopedIn(player) {
  return !!player.weapon.def.scope && player.aimZoom > SCOPE_ZOOM;
}

export function feedRow(f) {
  const how = `<span>${f.how}${f.headshot ? ' · head' : ''}</span>`;
  return `<div>${f.killer ? `${nameHtml(f.killer)} ${how} ${nameHtml(f.victim)}` : `${nameHtml(f.victim)} ${how}`}</div>`;
}

// Visible feed entries (the last few seconds' worth) and a key that changes when they do.
export function visibleFeed(match, now) {
  let first = match.feed.length;
  while (first > 0 && now - match.feed[first - 1].t < FEED_TIME) first--;
  return { first, key: `${match.feedVersion}:${first}` };
}

export class Hud {
  // source: the player's input source (keyboard/mouse or a controller).
  constructor(root, source, { index = 0, color = '#ffffff', missile = true } = {}) {
    const inputKind = source.kind;
    this.source = source;
    this.index = index;
    this.keys = KEY_LABELS[inputKind] ?? KEY_LABELS.keyboardMouse;
    this.el = document.createElement('div');
    this.el.className = 'hud-view';
    this.el.innerHTML = `
      <div class="scope"><i></i><i></i></div>
      <div class="hud-burn"></div>
      <div class="hud-hurt"></div>
      <div class="dmg-arrow"><i></i></div>
      <div class="vitals">
        <div class="bar shield"><i></i></div>
        <div class="bar health"><i></i></div>
      </div>
      <div class="hud-tag" style="--seat:${color}">P${index + 1}</div>
      <div class="hud-gear"><div class="nades"></div><div class="hook"><b></b><em></em></div></div>
      <div class="hud-match"><div class="hud-clock"></div><div class="hud-standings"></div></div>
      <div class="hud-feed"></div>
      <div class="hud-scores"><h4>Scores</h4><table><thead><tr><th></th><th></th><th>Score</th><th>K</th><th>D</th></tr></thead><tbody></tbody></table></div>
      <div class="crosshair"><u></u><i></i><i></i><i></i><i></i><b></b></div>
      <div class="portal-ind"><u class="pb"></u><u class="po"></u></div>
      <div class="target-name"></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="kill-msg"></div>
      <div class="ammo">
        <div class="count"><span class="mag"></span><span class="reserve"></span></div>
        <div class="ticks"><b></b></div>
        <div class="wname"></div>
        <div class="ammo-note"></div>
        <div class="other"></div>
      </div>
      <div class="missile-cam">
        <i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i>
        <div class="mc-label">SMOKE SIGNAL</div>
        <div class="mc-fuel"><b></b></div>
        <div class="mc-reticle"></div>
      </div>
      <div class="killcam"><b>KILLCAM</b><span></span></div>
      <div class="size-status"></div>
      <div class="death"><h3>SMOKED</h3><p class="cause"></p><p class="timer"></p><p class="loadout"></p></div>
      <div class="hud-hint"></div>
      <div class="hud-controls">${controlsHtml(inputKind, { missile })}</div>
      <div class="hud-debug"></div>
    `;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.els = {
      burn: q('.hud-burn'),
      hurt: q('.hud-hurt'),
      dmgArrow: q('.dmg-arrow'),
      vitals: q('.vitals'),
      shield: q('.shield'),
      shieldFill: q('.shield i'),
      health: q('.health'),
      healthFill: q('.health i'),
      cross: q('.crosshair'),
      portalInd: q('.portal-ind'),
      scope: q('.scope'),
      tag: q('.hud-tag'),
      clock: q('.hud-clock'),
      standings: q('.hud-standings'),
      feed: q('.hud-feed'),
      scores: q('.hud-scores'),
      scoresBody: q('.hud-scores tbody'),
      targetName: q('.target-name'),
      ticks: [...this.el.querySelectorAll('.crosshair i')],
      ring: q('.crosshair u'),
      ammoTicks: q('.ammo .ticks'),
      ammoTicksFill: q('.ammo .ticks b'),
      controls: q('.hud-controls'),
      hit: q('.hitmarker'),
      killMsg: q('.kill-msg'),
      ammo: q('.ammo'),
      wname: q('.wname'),
      mag: q('.mag'),
      reserve: q('.reserve'),
      ammoNote: q('.ammo-note'),
      other: q('.other'),
      nades: q('.nades'),
      hook: q('.hud-gear .hook'),
      hookFill: q('.hud-gear .hook b'),
      hookLabel: q('.hud-gear .hook em'),
      missile: q('.missile-cam'),
      fuel: q('.mc-fuel b'),
      death: q('.death'),
      cause: q('.cause'),
      timer: q('.timer'),
      loadout: q('.death .loadout'),
      hint: q('.hud-hint'),
      killcam: q('.killcam span'),
      size: q('.size-status'),
      debug: q('.hud-debug'),
    };
    this.radar = new Radar(this.el);
    this.cache = {};
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this._rect = '';
  }

  set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  layout(rect, totalHeight) {
    this.rect = rect;
    const key = `${rect.x},${rect.y},${rect.w},${rect.h},${totalHeight}`;
    if (key === this._rect) return;
    this._rect = key;
    const s = this.el.style;
    s.left = `${rect.x}px`;
    s.top = `${totalHeight - rect.y - rect.h}px`;
    s.width = `${rect.w}px`;
    s.height = `${rect.h}px`;
    // Scale HUD text with the view so split-screen stays readable but uncluttered.
    const scale = Math.max(0.6, Math.min(1.2, rect.h / 720));
    s.setProperty('--hud-scale', scale.toFixed(3));
    this.radar.layout(scale);
    // The bottom corners sit above the controls strip, however many rows it wraps to here.
    s.setProperty('--ctl-lift', `${this.els.controls.offsetHeight + 6}px`);
  }

  hintFor(player, zones, game) {
    const k = this.keys;
    // The death card has the screen (it says how to pick, click included).
    if (player.mode === 'dead') return '';
    // Resumed from a controller: the mouse isn't captured until the keyboard player clicks.
    if (this.source.kind === 'keyboardMouse' && !this.source.enabled && game.state === 'playing') {
      return 'Click to aim with the mouse';
    }
    switch (player.mode) {
      case 'net':
      case 'rope':
        return `${k.climb} climb · ${k.jump} leap off · ${k.crouch} let go`;
      case 'bars':
        return `${k.move} move along · ${k.jump} hop off · ${k.crouch} drop`;
      case 'dead':
        return '';
      case 'ride':
        // (For a few seconds after getting on: it sits over the bike.)
        return game.time - player.rideT < 5 ? `${k.fire} guns · ${k.sprint} boost · ${k.jump} hop · ${k.interact} get off` : '';
      default:
        break;
    }
    if (player.guiding) return `${k.steer} steer · ${k.fire} to blow it early`;
    if (game.swarms.on(player)) return `Bugs on you! ${k.melee} to swat them`;
    if (game.swarms.after(player)) return 'Bugs coming: sprint away or swat them';
    const prompt = player.pickupPrompt;
    if (prompt && player.pickupDual) return `${k.interact}: dual wield ${prompt.def.name}`;
    if (prompt) return `${k.interact}: swap ${player.weapon.def.name} for ${prompt.def.name}`;
    if (player.vehiclePrompt) return `${k.interact}: ride the Sizzler`;
    if (player.inFire) return 'Too hot!';
    if (player.inMud) return 'Mud: slow going, weak jumps';
    const w = player.weapon;
    if (w.mag === 0 && w.reserve > 0 && !w.reloading) return `${k.reload} reload`;
    if (zones.findNet(player.center) || zones.findRope(player.center)) return 'Push forward to climb';
    return '';
  }

  update(player, game, showDebug) {
    const e = this.els;
    const now = game.time;
    const fb = player.feedback;
    const alive = player.alive;
    const v = player.vitals;
    const w = player.weapon;

    // Vitals.
    this.set('shield', v.shieldFrac.toFixed(3), (x) => (e.shieldFill.style.transform = `scaleX(${x})`));
    this.set('health', v.healthFrac.toFixed(3), (x) => (e.healthFill.style.transform = `scaleX(${x})`));
    this.set('recharging', v.recharging, (x) => e.shield.classList.toggle('recharging', x));
    this.set('shieldOut', alive && v.shield <= 0, (x) => e.shield.classList.toggle('out', x));
    const low = alive && v.healthFrac < 0.35;
    this.set('lowHealth', low, (x) => e.health.classList.toggle('low', x));
    // (Like Halo's, the health bar only shows once you've lost some.)
    this.set('healthFull', v.healthFrac > 0.999, (x) => e.health.classList.toggle('full', x));

    // Damage flash and low-health edges.
    const hurt = Math.max(low ? 0.45 : 0, alive ? 1 - (now - fb.hurtT) / HURT_TIME : 0);
    this.set('hurt', Math.max(0, hurt).toFixed(2), (x) => (e.hurt.style.opacity = x));
    this.set('burn', player.inFire && alive, (x) => (e.burn.style.opacity = x ? '1' : '0'));

    // Arrow pointing toward whatever hurt us last.
    const since = now - fb.hurtDirT;
    if (alive && since < 1.2) {
      const dx = fb.hurtFromX - player.center.x;
      const dz = fb.hurtFromZ - player.center.z;
      const fx = -Math.sin(player.yaw);
      const fz = -Math.cos(player.yaw);
      const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
      this.set('dmgAng', ang.toFixed(2), (x) => (e.dmgArrow.style.transform = `rotate(${x}rad)`));
      this.set('dmgOp', (1 - since / 1.2).toFixed(2), (x) => (e.dmgArrow.style.opacity = x));
    } else {
      this.set('dmgOp', '0', (x) => (e.dmgArrow.style.opacity = x));
    }

    // Ammo (on a Sizzler: its hull, the guns' heat as the ticks, and the boost).
    const bike = player.vehicle;
    if (bike) {
      const hull = Math.ceil(bike.vitals.healthFrac * 100);
      this.set('wname', 'Sizzler', (x) => (e.wname.textContent = x));
      this.set('mag', `${hull}%`, (x) => (e.mag.textContent = x));
      this.set('reserve', -1, (x) => (e.reserve.textContent = ''));
      this.set('magLow', hull <= 30 || bike.overheated, (x) => e.ammo.classList.toggle('low', x));
      this.set('tickCap', 20, (x) => {
        e.ammoTicks.style.display = '';
        e.ammoTicks.style.setProperty('--cap', x);
        e.ammoTicks.classList.toggle('big', false);
      });
      this.set('tickFill', Math.ceil((1 - bike.heat) * 20), (x) => (e.ammoTicksFill.style.width = `calc(var(--tick-w) * ${x})`));
      this.set('ammoNote', bike.overheated ? 'Overheated' : 'Hull', (x) => (e.ammoNote.textContent = x));
      this.set('other', `Boost ${Math.round(bike.boost * 100)}%`, (x) => (e.other.textContent = x));
    } else {
      // Dual wielding: both names, and the left gun's mag before the right's.
      const lw = player.left;
      this.set('wname', lw ? (lw.def === w.def ? `${w.def.name} x2` : `${lw.def.name} + ${w.def.name}`) : w.def.name, (x) => (e.wname.textContent = x));
      // (The Gravity Gun has no ammo.)
      const endless = !Number.isFinite(w.def.mag);
      this.set('mag', lw ? `${lw.mag} | ${w.mag}` : w.mag, (x) => (e.mag.textContent = typeof x === 'string' || Number.isFinite(x) ? x : '∞'));
      this.set('reserve', endless ? -1 : w.reserve + (lw ? lw.reserve : 0), (x) => (e.reserve.textContent = x < 0 ? '' : ` / ${x}`));
      const lowMag = !endless && (w.mag === 0 || (w.def.mag >= 6 && w.mag <= Math.ceil(w.def.mag * 0.25)));
      this.set('magLow', lowMag, (x) => e.ammo.classList.toggle('low', x));
      // A row of ticks, one per round (bigger mags share ticks), emptying as you fire.
      const cap = endless ? 0 : Math.min(MAX_TICKS, w.def.mag);
      this.set('tickCap', cap, (x) => {
        e.ammoTicks.style.display = x ? '' : 'none';
        e.ammoTicks.style.setProperty('--cap', x);
        e.ammoTicks.classList.toggle('big', x <= 12);
      });
      if (cap) {
        const shown = Math.ceil((w.mag / w.def.mag) * cap);
        this.set('tickFill', shown, (x) => (e.ammoTicksFill.style.width = `calc(var(--tick-w) * ${x})`));
      }
      const note = lw ? (lw.reloading || w.reloading ? 'Reloading' : `${this.keys.fire2} fires left`) : w.reloading ? 'Reloading' : w.mag === 0 && w.reserve === 0 ? 'Out of ammo' : w.def.kind === 'size' ? 'Fire shrinks · aim grows' : w.def.kind === 'portal' ? 'Fire blue · aim orange' : w.def.kind === 'gravity' ? (game.gravity?.held.has(player) ? 'Fire throws · aim drops' : 'Fire or aim grabs') : '';
      this.set('ammoNote', note, (x) => (e.ammoNote.textContent = x));
      const o = player.slots[1 - player.slot];
      this.set('other', o ? `${o.def.name} ${o.mag}/${o.reserve}` : '', (x) => (e.other.textContent = x));
    }
    // The grapple: a bar that fills over the cooldown, lit when it's ready.
    const hook = player.hook;
    const ready = hook.state === 'off' && hook.cooldown <= 0;
    const fill = ready ? 1 : hook.busy ? 0 : 1 - Math.min(1, hook.cooldown / hook.cooldownMax);
    this.set('hookFill', Math.round(fill * 40) / 40, (x) => (e.hookFill.style.transform = `scaleX(${x})`));
    this.set('hookReady', ready, (x) => {
      e.hook.classList.toggle('ready', x);
      e.hookLabel.textContent = `${this.keys.grapple} Grapple`;
    });
    this.set('nades', player.grenades, (x) => (e.nades.innerHTML = `<b>${x}</b><span>${'<i></i>'.repeat(x)}${'<i class="empty"></i>'.repeat(Math.max(0, 4 - x))}</span><em>Briquettes</em>`));

    // Missile camera overlay.
    const g = player.guiding;
    this.set('guiding', !!g, (x) => {
      e.missile.style.display = x ? 'block' : 'none';
      e.vitals.style.opacity = x ? '0.5' : '';
    });
    if (g) this.set('fuel', (g.life / g.def.missileLife).toFixed(2), (x) => (e.fuel.style.transform = `scaleX(${x})`));

    // Crosshair: ticks spread with the weapon's current inaccuracy.
    const cam = player.camera;
    // On a Sizzler the chase camera looks a little below the aim, so the reticle sits above the
    // middle by as much.
    const lift = bike ? (Math.tan(SIZZLER.camTilt) / Math.tan((cam.fov * DEG) / 2)) * (this.rect.h / 2) : 0;
    this.set('aimLift', Math.round(lift), (x) => this.el.style.setProperty('--aim-lift', `${x}px`));
    const gap = alive
      ? 3 + (Math.tan((bike ? SIZZLER.gun.spread : currentSpread(player)) * DEG) / Math.tan((cam.fov * DEG) / 2)) * (this.rect.h / 2)
      : 3;
    this.set('gap', Math.round(gap), (g) => {
      const [up, down, left, right] = e.ticks;
      up.style.transform = `translateY(${-g}px)`;
      down.style.transform = `translateY(${g}px)`;
      left.style.transform = `translateX(${-g}px)`;
      right.style.transform = `translateX(${g}px)`;
      // The reticle's circle sits just outside the ticks (7 px long).
      const d = 2 * (g + 7) + 8;
      e.ring.style.width = e.ring.style.height = `${d}px`;
    });
    this.set('enemy', !!player.aimTarget && alive, (x) => e.cross.classList.toggle('enemy', x));
    // Who's under the crosshair, so split-screen friends and bots are easy to tell apart.
    const tn = alive && !g && player.aimTarget ? player.aimTarget.name ?? '' : '';
    this.set('targetName', tn, (x) => {
      e.targetName.textContent = x;
      e.targetName.style.opacity = x ? '1' : '0';
    });
    this.set('split', game.humans.length > 1, (x) => {
      e.tag.style.display = x ? 'block' : 'none';
      this.el.classList.toggle('split', x);
    });
    // Through a scope: the scope's own reticle replaces the crosshair.
    const scoped = alive && !g && scopedIn(player);
    this.set('scoped', scoped, (x) => (e.scope.style.display = x ? 'block' : 'none'));
    this.set('crossVis', alive && !g && !scoped, (x) => (e.cross.style.display = x ? '' : 'none'));

    // Hit marker.
    const hm = Math.max(0, 1 - (now - fb.hitT) / HITMARKER_TIME);
    this.set('hm', hm.toFixed(2), (x) => (e.hit.style.opacity = x));
    this.set('hmKind', fb.hitKind, (x) => {
      e.hit.classList.toggle('kill', x === 'kill');
      e.hit.classList.toggle('head', x === 'head');
    });

    // Kill confirm.
    const km = now - fb.killT < KILL_MSG_TIME ? fb.killText : '';
    this.set('killMsg', km, (x) => {
      e.killMsg.textContent = x;
      e.killMsg.style.opacity = x ? '1' : '0';
    });

    // Death replay: the killer's view, with a banner (the death card drops to the bottom).
    const kc = game.replay && game.replay.showing(player) >= 0 ? game.replay.killerOf(player)?.name ?? '' : '';
    this.set('killcam', kc, (x) => {
      e.killcam.textContent = x;
      this.el.classList.toggle('killcam-on', !!x);
    });

    // Portal Gun: which of our portals are open (Portal's crosshair ovals).
    const pr = w.def.kind === 'portal' && alive ? game.portals?.pairs.get(player) : null;
    const pk = w.def.kind === 'portal' && alive ? `${pr?.[0] ? 1 : 0}${pr?.[1] ? 1 : 0}` : '';
    this.set('portalInd', pk, (x) => {
      e.portalInd.style.display = x ? 'block' : 'none';
      e.portalInd.classList.toggle('blue', x[0] === '1');
      e.portalInd.classList.toggle('orange', x[1] === '1');
    });

    // Shrink Wrap: what size we are and for how long.
    const st = alive && player.size !== 1 ? `${player.size < 1 ? 'SHRUNK' : 'SUPERSIZED'} ${Math.ceil(player.sizeT)}` : '';
    this.set('size', st, (x) => {
      e.size.textContent = x;
      e.size.style.display = x ? 'block' : 'none';
      e.size.classList.toggle('big', player.size > 1);
    });

    // Death screen.
    this.set('dead', !alive, (x) => {
      e.death.style.display = x ? 'flex' : 'none';
      e.vitals.style.visibility = x ? 'hidden' : '';
      e.ammo.style.visibility = x ? 'hidden' : '';
    });
    if (!alive) {
      this.set('cause', deathText(player.deathInfo, player), (x) => (e.cause.textContent = x));
      const left = Math.max(0, Math.ceil(RESPAWN_DELAY - player.deathT));
      this.set('timer', left, (x) => (e.timer.textContent = x > 0 ? `Back in ${x}` : ''));
      // Pick the loadout for the next life.
      const loadouts = game.arsenal.loadouts;
      const i = player.loadout;
      // Resumed from a controller, the keyboard does nothing until a click captures the mouse.
      const pick = this.source.kind === 'keyboardMouse' && !this.source.enabled ? `Click, then ${this.keys.pick}` : this.keys.pick;
      this.set('loadout', `${i} ${pick}`, () => {
        e.loadout.innerHTML = loadouts.length > 1 ? `<span class="arrow">◀</span>${loadoutCard(loadouts[i], { demos: false })}<span class="arrow">▶</span><small>${pick}</small>` : '';
      });
    }

    this.updateMatch(player, game);
    this.radar.update(player, game);

    const hint = this.hintFor(player, game.zones, game);
    this.set('hint', hint, (x) => {
      e.hint.textContent = x;
      e.hint.style.opacity = x ? '1' : '0';
    });

    let debug = '';
    if (showDebug) {
      const c = player.center;
      debug = `${player.sliding ? 'slide' : player.mode}${player.grounded ? ' ground' : ' air'}${player.crouched ? ' crouch' : ''}${
        player.sprinting ? ' sprint' : ''
      } | ${player.speed().toFixed(1)} m/s | ${c.x.toFixed(1)}, ${player.feetY().toFixed(1)}, ${c.z.toFixed(1)} | ${Math.round(
        v.shield,
      )}/${Math.round(v.health)}`;
      if (this.index === 0 && game.fps.visible) debug = `${game.fps.text}\n${debug}`;
    }
    this.set('debug', debug, (x) => (e.debug.textContent = x));
  }

  // Clock, everyone's place and score (yours highlighted), the kill feed, and the full scoreboard
  // while it's held.
  updateMatch(player, game) {
    const e = this.els;
    const m = game.match;
    this.set('clock', m.timed ? clockText(m.timeLeft) : '', (x) => (e.clock.textContent = x));
    this.set('clockHot', m.timed && m.timeLeft <= 30, (x) => e.clock.classList.toggle('hot', x));
    // Scores only change with a kill, which also bumps the feed.
    this.set('standings', `${m.feedVersion}:${game.players.length}`, () => {
      let rows = '';
      for (const s of m.standings()) {
        const p = s.player;
        rows += `<div${p === player ? ' class="me"' : ''}><span>${s.place}</span><i style="background:${hex(p.color)}"></i><em>${p.name}</em><b>${p.stats.score}</b></div>`;
      }
      e.standings.innerHTML = rows;
    });
    const feed = visibleFeed(m, game.time);
    this.set('feed', feed.key, () => (e.feed.innerHTML = m.feed.slice(feed.first).map(feedRow).join('')));

    const show = !!player.input.held.scoreboard;
    this.set('scoresOn', show, (x) => (e.scores.style.display = x ? 'block' : 'none'));
    if (show) {
      let rows = '';
      for (const s of m.standings()) {
        const p = s.player;
        const cls = p === player ? ' class="me"' : game.humans.includes(p) ? ' class="local"' : '';
        rows += `<tr${cls}><td>${ordinal(s.place)}</td><td>${nameHtml(p)}</td><td>${p.stats.score}</td><td>${p.stats.kills}</td><td>${p.stats.deaths}</td></tr>`;
      }
      this.set('scoresRows', rows, (x) => (e.scoresBody.innerHTML = x));
    }
  }

  dispose() {
    this.radar.dispose();
    this.el.remove();
  }
}

function deathText(info, victim) {
  if (!info) return '';
  if (info.cause === 'fire') return 'Cooked by the fire jump';
  if (info.cause === 'fell') return 'Fell out of the world';
  if (info.cause === 'explosion' && info.attacker === victim) {
    return `Smoked yourself with your own ${info.weapon?.name ?? 'explosion'}`;
  }
  if (info.cause === 'punt') return `Punted by ${info.attacker?.name ?? 'someone'}`;
  if (info.cause === 'prop') return `Flattened by ${info.attacker?.name ?? 'someone'}'s flying junk`;
  if (info.cause === 'melee') return `Tenderized by ${info.attacker?.name ?? 'someone'}${info.backstab ? ' from behind' : ''}`;
  if (info.cause === 'swarm') return `Stung to death by ${info.attacker?.name ?? 'someone'}'s bugs`;
  if (info.cause === 'explosion') return `Blown up by ${info.attacker?.name ?? 'someone'}'s ${info.weapon?.name ?? 'boom'}`;
  if (info.attacker) return `Smoked by ${info.attacker.name}${info.headshot ? ' (headshot)' : ''}`;
  return 'Smoked';
}
