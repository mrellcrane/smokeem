import { InputState } from './inputState.js';
import { settings } from '../settings.js';

// Xbox-style controllers through the Gamepad API (standard mapping).
//
// `Gamepads` reads navigator.getGamepads() once per frame for everyone (menus, joining and
// each player's input). A pad only shows up after its first button press, so the UI shows
// a "press any button" hint until one does.
//
// `GamepadInput` turns one pad into an InputState for a player, using the layout in
// GAME_DESIGN.md. System buttons (Menu to pause) are handled by the menu code, not here.

export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

const MOVE_DEADZONE = 0.18;
const LOOK_DEADZONE = 0.14;
const TRIGGER_ON = 0.35;
// Look speed at full tilt and stick sensitivity 1, in radians per second.
const YAW_SPEED = 3.1;
const PITCH_SPEED = 2.1;
// Holding the stick all the way over speeds turning up by this much, so you can spin around.
const TURN_BOOST = 0.85;
const TURN_BOOST_DELAY = 0.18;
const TURN_BOOST_RAMP = 0.35;
// Holding X this long over a weapon you could swap for picks it up; a tap reloads.
const PICKUP_HOLD = 0.3;

export function buttonDown(gp, i) {
  const b = gp?.buttons[i];
  if (!b) return false;
  return i === PAD.LT || i === PAD.RT ? b.value > TRIGGER_ON || (b.pressed && b.value === 0) : b.pressed;
}

// Radial deadzone, rescaled so the edge of the deadzone is 0 and full tilt is 1.
function stick(x, y, deadzone, out) {
  const r = Math.hypot(x, y);
  if (r < deadzone) {
    out.x = out.y = out.r = 0;
    return out;
  }
  const k = Math.min(1, (r - deadzone) / (1 - deadzone));
  out.x = (x / r) * k;
  out.y = (y / r) * k;
  out.r = k;
  return out;
}

export class Gamepads {
  constructor() {
    this.list = [];
    this.seen = false;
    this.stamp = -1;
    this.onDisconnect = null;
    this._onConnect = () => (this.seen = true);
    this._onDisconnect = (e) => this.onDisconnect?.(e.gamepad.index);
    window.addEventListener('gamepadconnected', this._onConnect);
    window.addEventListener('gamepaddisconnected', this._onDisconnect);
  }

  get supported() {
    return typeof navigator.getGamepads === 'function';
  }

  // Cheap to call from several places in one frame; only the first call reads the pads.
  poll() {
    const now = performance.now();
    if (now - this.stamp < 2) return;
    this.stamp = now;
    this.list = this.supported ? navigator.getGamepads() : [];
    if (!this.seen) for (const p of this.list) if (p?.connected) this.seen = true;
  }

  get(index) {
    const p = this.list[index];
    return p && p.connected ? p : null;
  }

  connected() {
    const out = [];
    for (const p of this.list) if (p?.connected) out.push(p);
    return out;
  }
}

const _move = { x: 0, y: 0, r: 0 };
const _look = { x: 0, y: 0, r: 0 };

export class GamepadInput {
  constructor(pads, index) {
    this.kind = 'gamepad';
    this.pads = pads;
    this.index = index;
    this.state = new InputState();
    // Light aim friction for sticks (see Player.applyLook).
    this.state.assist = true;
    // The player this pad drives, set by the game (for zoom and pick-up context).
    this.player = null;
    this.enabled = true;
    this.prev = new Array(17).fill(false);
    this.sprintLatch = false;
    this.zoomLatch = false;
    // Seconds X has been held over a swappable weapon, or -1.
    this.xHeld = -1;
    this.boostT = 0;
    this.lastHurtT = -99;
    this.lastShake = 0;
  }

  get connected() {
    return !!this.pads.get(this.index);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  releaseAll() {
    this.state.clear();
    this.sprintLatch = this.zoomLatch = false;
    this.xHeld = -1;
    this.boostT = 0;
  }

  // Count whatever is down right now as already held, so the A that resumed the match
  // doesn't also jump.
  prime() {
    this.pads.poll();
    const gp = this.pads.get(this.index);
    for (let i = 0; i < this.prev.length; i++) this.prev[i] = !!gp && buttonDown(gp, i);
    this.xHeld = -1;
  }

  // Called once per rendered frame before gameplay reads the state.
  update(dt = 1 / 60) {
    this.pads.poll();
    const gp = this.pads.get(this.index);
    const s = this.state;
    if (!gp || !this.enabled) {
      s.clear();
      this.prev.fill(false);
      return;
    }
    const prev = this.prev;
    const down = (i) => buttonDown(gp, i);
    const edge = (i) => down(i) && !prev[i];

    // Movement: left stick, up is forward.
    const ax = gp.axes;
    stick(ax[0] ?? 0, ax[1] ?? 0, MOVE_DEADZONE, _move);
    s.moveX = _move.x;
    s.moveY = -_move.y;

    // Look: right stick on a curve (fine aim near center), plus a turn boost at full tilt.
    stick(ax[2] ?? 0, ax[3] ?? 0, LOOK_DEADZONE, _look);
    if (_look.r > 0) {
      const curved = _look.r * _look.r * 0.8 + _look.r * 0.2;
      const k = curved / _look.r;
      let yaw = _look.x * k * YAW_SPEED;
      const pitch = _look.y * k * PITCH_SPEED;
      if (_look.r > 0.95 && Math.abs(_look.x) > 0.8) this.boostT += dt;
      else this.boostT = 0;
      const ramp = Math.min(1, Math.max(0, (this.boostT - TURN_BOOST_DELAY) / TURN_BOOST_RAMP));
      yaw *= 1 + TURN_BOOST * ramp;
      const sens = settings.stickSensitivity;
      s.lookX += yaw * sens * dt;
      s.lookY += pitch * sens * dt * (settings.invertY ? -1 : 1);
    } else {
      this.boostT = 0;
    }

    const p = this.player;

    // Sprint: click the left stick; it stays on until you let off forward or crouch.
    if (edge(PAD.LS)) this.sprintLatch = !this.sprintLatch;
    if (s.moveY < 0.3 || down(PAD.B)) this.sprintLatch = false;
    s.held.sprint = this.sprintLatch;

    // Zoom: click the right stick to toggle; anything that drops zoom also drops the toggle.
    if (edge(PAD.RS)) this.zoomLatch = !this.zoomLatch;
    if (p && (!p.alive || p.sprinting || p.weapon.reloading || p.guiding || p.switchT > 0)) this.zoomLatch = false;
    s.held.aim = this.zoomLatch;

    s.held.jump = down(PAD.A);
    if (edge(PAD.A)) s.press('jump');
    s.held.crouch = down(PAD.B);
    if (edge(PAD.B)) s.press('crouch');
    s.held.fire = down(PAD.RT);
    if (edge(PAD.RT)) s.press('fire');
    if (edge(PAD.LT)) s.press('grenade');
    if (edge(PAD.RB)) s.press('melee');
    if (edge(PAD.Y)) s.press('switchWeapon');
    s.held.scoreboard = down(PAD.VIEW);

    // X: reload on a tap. Over a swappable weapon, holding picks it up instead.
    if (edge(PAD.X)) {
      if (p?.pickupPrompt) this.xHeld = 0;
      else s.press('reload');
    }
    if (this.xHeld >= 0) {
      this.xHeld += dt;
      if (!down(PAD.X)) {
        s.press('reload');
        this.xHeld = -1;
      } else if (this.xHeld >= PICKUP_HOLD) {
        s.press('interact');
        this.xHeld = -1;
      }
    }
    s.held.reload = down(PAD.X);
    s.held.interact = down(PAD.X);
    s.held.grenade = down(PAD.LT);
    s.held.melee = down(PAD.RB);

    for (let i = 0; i < prev.length; i++) prev[i] = down(i);
  }

  // Rumble when hurt and when a blast shakes the camera. Called once per rendered frame.
  feel(player) {
    if (!settings.rumble) return;
    const fb = player.feedback;
    if (fb.hurtT !== this.lastHurtT) {
      this.lastHurtT = fb.hurtT;
      if (player.alive) this.rumble(0.35, 0.55, 110);
      else this.rumble(0.9, 0.6, 380);
    }
    if (player.shake > this.lastShake + 0.25) this.rumble(Math.min(1, player.shake), 0.4, 260);
    this.lastShake = player.shake;
  }

  rumble(strong, weak, ms) {
    const gp = this.pads.get(this.index);
    const act = gp?.vibrationActuator;
    if (!act?.playEffect) return;
    try {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    } catch {
      // Not every browser or pad supports rumble.
    }
  }

  dispose() {}
}
