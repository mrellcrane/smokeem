// The common input format every input source writes and every player controller reads.
// Keyboard/mouse, gamepads and bots all produce one of these per player.

export const ACTIONS = [
  'jump',
  'sprint',
  'crouch',
  'fire',
  // The left-hand gun when dual wielding (right click, LT).
  'fire2',
  'aim',
  'reload',
  'interact',
  'grenade',
  'melee',
  'grapple',
  'switchWeapon',
  'slot1',
  'slot2',
  'scoreboard',
];

export class InputState {
  constructor() {
    // Movement axes in [-1, 1]. moveY is forward.
    this.moveX = 0;
    this.moveY = 0;
    // Look delta in radians accumulated since the last frame. Positive x turns right, positive y looks down.
    this.lookX = 0;
    this.lookY = 0;
    this.held = {};
    // Presses latched until a fixed tick consumes them, so a tap between ticks is never lost.
    this.pressed = {};
    for (const a of ACTIONS) {
      this.held[a] = false;
      this.pressed[a] = false;
    }
    this._consumed = {};
    for (const a of ACTIONS) this._consumed[a] = false;
  }

  press(action) {
    this.pressed[action] = true;
  }

  // Returns the presses for this tick and clears them. The returned object is reused.
  consumePressed() {
    const out = this._consumed;
    for (const a of ACTIONS) {
      out[a] = this.pressed[a];
      this.pressed[a] = false;
    }
    return out;
  }

  takeLook() {
    const x = this.lookX;
    const y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return [x, y];
  }

  clear() {
    this.moveX = 0;
    this.moveY = 0;
    this.lookX = 0;
    this.lookY = 0;
    for (const a of ACTIONS) {
      this.held[a] = false;
      this.pressed[a] = false;
    }
  }
}
