import { InputState } from './inputState.js';
import { settings } from '../settings.js';

// Radians of turn per pixel of mouse movement at sensitivity 1.0.
const BASE_RADIANS_PER_PIXEL = 0.0022;
// Some browsers occasionally report a huge single-event jump right after locking.
const MAX_EVENT_DELTA = 400;

// Gameplay bindings by KeyboardEvent.code. Never Ctrl or Cmd (macOS shortcuts).
const KEY_ACTIONS = {
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  KeyR: 'reload',
  KeyE: 'interact',
  KeyG: 'grenade',
  KeyQ: 'melee',
  KeyF: 'melee',
  KeyX: 'switchWeapon',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Tab: 'scoreboard',
};

const MOVE_KEYS = {
  KeyW: 'f',
  ArrowUp: 'f',
  KeyS: 'b',
  ArrowDown: 'b',
  KeyA: 'l',
  ArrowLeft: 'l',
  KeyD: 'r',
  ArrowRight: 'r',
};

const MOUSE_ACTIONS = { 0: 'fire', 2: 'aim' };

export class KeyboardMouseInput {
  constructor(pointerLock) {
    this.kind = 'keyboardMouse';
    this.pointerLock = pointerLock;
    this.state = new InputState();
    this.enabled = false;
    this.keys = new Set();
    this.mouseButtons = new Set();

    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onKeyUp = (e) => this.onKeyUp(e);
    this._onMouseDown = (e) => this.onMouseDown(e);
    this._onMouseUp = (e) => this.onMouseUp(e);
    this._onMouseMove = (e) => this.onMouseMove(e);
    this._onWheel = (e) => this.onWheel(e);
    this._onBlur = () => this.releaseAll();
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  releaseAll() {
    this.keys.clear();
    this.mouseButtons.clear();
    this.state.clear();
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    if (e.metaKey || e.ctrlKey) return; // leave OS / browser shortcuts alone
    const action = KEY_ACTIONS[e.code];
    if (action || MOVE_KEYS[e.code]) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (action) this.state.press(action);
  }

  onKeyUp(e) {
    this.keys.delete(e.code);
  }

  onMouseDown(e) {
    if (!this.enabled || !this.pointerLock.isLocked) return;
    const action = MOUSE_ACTIONS[e.button];
    if (!action) return;
    this.mouseButtons.add(e.button);
    this.state.press(action);
  }

  onMouseUp(e) {
    this.mouseButtons.delete(e.button);
  }

  onMouseMove(e) {
    if (!this.enabled || !this.pointerLock.isLocked) return;
    let dx = e.movementX || 0;
    let dy = e.movementY || 0;
    if (Math.abs(dx) > MAX_EVENT_DELTA || Math.abs(dy) > MAX_EVENT_DELTA) return;
    const k = BASE_RADIANS_PER_PIXEL * settings.sensitivity;
    this.state.lookX += dx * k;
    this.state.lookY += dy * k * (settings.invertY ? -1 : 1);
  }

  onWheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) > 0) this.state.press('switchWeapon');
  }

  // Called once per rendered frame before gameplay reads the state.
  update() {
    const s = this.state;
    const k = this.keys;
    let mx = 0;
    let my = 0;
    for (const code of k) {
      const dir = MOVE_KEYS[code];
      if (dir === 'f') my += 1;
      else if (dir === 'b') my -= 1;
      else if (dir === 'l') mx -= 1;
      else if (dir === 'r') mx += 1;
    }
    s.moveX = Math.max(-1, Math.min(1, mx));
    s.moveY = Math.max(-1, Math.min(1, my));
    for (const action of Object.values(KEY_ACTIONS)) s.held[action] = false;
    for (const code of k) {
      const action = KEY_ACTIONS[code];
      if (action) s.held[action] = true;
    }
    s.held.fire = this.mouseButtons.has(0);
    s.held.aim = this.mouseButtons.has(2);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('contextmenu', this._onContextMenu);
  }
}
