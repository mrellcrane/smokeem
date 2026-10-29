import { DEG } from '../util/math.js';
import { currentSpread } from '../combat/shooting.js';
import { RESPAWN_DELAY } from '../player/player.js';
import { controlsHtml } from './controls.js';

// Per-player HUD laid over that player's viewport. Plain DOM; every write is cached so the
// DOM is only touched when a value actually changes.

const KEY_LABELS = {
  keyboardMouse: { climb: 'W / S', move: 'WASD', jump: 'Space', crouch: 'C', reload: 'R', interact: 'E', fire: 'Click', steer: 'Mouse' },
  gamepad: { climb: 'Left stick', move: 'Left stick', jump: 'A', crouch: 'B', reload: 'X', interact: 'Hold X', fire: 'RT', steer: 'Right stick' },
};

const HITMARKER_TIME = 0.18;
const HURT_TIME = 0.4;
const KILL_MSG_TIME = 1.8;

export class Hud {
  constructor(root, inputKind) {
    this.keys = KEY_LABELS[inputKind] ?? KEY_LABELS.keyboardMouse;
    this.el = document.createElement('div');
    this.el.className = 'hud-view';
    this.el.innerHTML = `
      <div class="hud-burn"></div>
      <div class="hud-hurt"></div>
      <div class="vitals">
        <div class="bar shield"><i></i></div>
        <div class="bar health"><i></i></div>
      </div>
      <div class="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="kill-msg"></div>
      <div class="ammo">
        <div class="other"></div>
        <div class="nades"></div>
        <div class="wname"></div>
        <div class="count"><span class="mag"></span><span class="reserve"></span></div>
        <div class="ammo-note"></div>
      </div>
      <div class="missile-cam">
        <i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i>
        <div class="mc-label">SMOKE SIGNAL</div>
        <div class="mc-fuel"><b></b></div>
        <div class="mc-reticle"></div>
      </div>
      <div class="death"><h3>SMOKED</h3><p class="cause"></p><p class="timer"></p></div>
      <div class="hud-hint"></div>
      <div class="hud-controls">${controlsHtml(inputKind)}</div>
      <div class="hud-debug"></div>
    `;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.els = {
      burn: q('.hud-burn'),
      hurt: q('.hud-hurt'),
      vitals: q('.vitals'),
      shield: q('.shield'),
      shieldFill: q('.shield i'),
      health: q('.health'),
      healthFill: q('.health i'),
      cross: q('.crosshair'),
      ticks: [...this.el.querySelectorAll('.crosshair i')],
      hit: q('.hitmarker'),
      killMsg: q('.kill-msg'),
      ammo: q('.ammo'),
      wname: q('.wname'),
      mag: q('.mag'),
      reserve: q('.reserve'),
      ammoNote: q('.ammo-note'),
      other: q('.other'),
      nades: q('.nades'),
      missile: q('.missile-cam'),
      fuel: q('.mc-fuel b'),
      death: q('.death'),
      cause: q('.cause'),
      timer: q('.timer'),
      hint: q('.hud-hint'),
      debug: q('.hud-debug'),
    };
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
    s.setProperty('--hud-scale', Math.max(0.6, Math.min(1.2, rect.h / 720)).toFixed(3));
  }

  hintFor(player, zones) {
    const k = this.keys;
    switch (player.mode) {
      case 'net':
      case 'rope':
        return `${k.climb} climb · ${k.jump} leap off · ${k.crouch} let go`;
      case 'bars':
        return `${k.move} move along · ${k.jump} hop off · ${k.crouch} drop`;
      case 'dead':
        return '';
      default:
        break;
    }
    if (player.guiding) return `${k.steer} steer · ${k.fire} to blow it early`;
    const prompt = player.pickupPrompt;
    if (prompt) return `${k.interact}: swap ${player.weapon.def.name} for ${prompt.def.name}`;
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

    // Damage flash and low-health edges.
    const hurt = Math.max(low ? 0.45 : 0, alive ? 1 - (now - fb.hurtT) / HURT_TIME : 0);
    this.set('hurt', Math.max(0, hurt).toFixed(2), (x) => (e.hurt.style.opacity = x));
    this.set('burn', player.inFire && alive, (x) => (e.burn.style.opacity = x ? '1' : '0'));

    // Ammo.
    this.set('wname', w.def.name, (x) => (e.wname.textContent = x));
    this.set('mag', w.mag, (x) => (e.mag.textContent = x));
    this.set('reserve', w.reserve, (x) => (e.reserve.textContent = ` / ${x}`));
    const lowMag = w.mag === 0 || (w.def.mag >= 6 && w.mag <= Math.ceil(w.def.mag * 0.25));
    this.set('magLow', lowMag, (x) => e.ammo.classList.toggle('low', x));
    const note = w.reloading ? 'Reloading' : w.mag === 0 && w.reserve === 0 ? 'Out of ammo' : '';
    this.set('ammoNote', note, (x) => (e.ammoNote.textContent = x));
    const o = player.slots[1 - player.slot];
    this.set('other', o ? `${o.def.name} ${o.mag}/${o.reserve}` : '', (x) => (e.other.textContent = x));
    this.set('nades', player.grenades, (x) => (e.nades.textContent = `Briquettes ${'●'.repeat(x)}${'○'.repeat(Math.max(0, 4 - x))}`));

    // Missile camera overlay.
    const g = player.guiding;
    this.set('guiding', !!g, (x) => {
      e.missile.style.display = x ? 'block' : 'none';
      e.vitals.style.opacity = x ? '0.5' : '';
    });
    if (g) this.set('fuel', (g.life / g.def.missileLife).toFixed(2), (x) => (e.fuel.style.transform = `scaleX(${x})`));

    // Crosshair: ticks spread with the weapon's current inaccuracy.
    const cam = player.camera;
    const gap = alive
      ? 3 + (Math.tan(currentSpread(player) * DEG) / Math.tan((cam.fov * DEG) / 2)) * (this.rect.h / 2)
      : 3;
    this.set('gap', Math.round(gap), (g) => {
      const [up, down, left, right] = e.ticks;
      up.style.transform = `translateY(${-g}px)`;
      down.style.transform = `translateY(${g}px)`;
      left.style.transform = `translateX(${-g}px)`;
      right.style.transform = `translateX(${g}px)`;
    });
    this.set('enemy', !!player.aimTarget && alive, (x) => e.cross.classList.toggle('enemy', x));
    this.set('crossVis', alive && !g, (x) => (e.cross.style.display = x ? '' : 'none'));

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
    }

    const hint = this.hintFor(player, game.zones);
    this.set('hint', hint, (x) => {
      e.hint.textContent = x;
      e.hint.style.opacity = x ? '1' : '0';
    });

    let debug = '';
    if (showDebug) {
      const c = player.center;
      debug = `${player.mode}${player.grounded ? ' ground' : ' air'}${player.crouched ? ' crouch' : ''}${
        player.sprinting ? ' sprint' : ''
      } | ${player.speed().toFixed(1)} m/s | ${c.x.toFixed(1)}, ${player.feetY().toFixed(1)}, ${c.z.toFixed(1)} | ${Math.round(
        v.shield,
      )}/${Math.round(v.health)}`;
    }
    this.set('debug', debug, (x) => (e.debug.textContent = x));
  }

  dispose() {
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
  if (info.cause === 'melee') return `Tenderized by ${info.attacker?.name ?? 'someone'}${info.backstab ? ' from behind' : ''}`;
  if (info.cause === 'explosion') return `Blown up by ${info.attacker?.name ?? 'someone'}'s ${info.weapon?.name ?? 'boom'}`;
  if (info.attacker) return `Smoked by ${info.attacker.name}${info.headshot ? ' (headshot)' : ''}`;
  return 'Smoked';
}
