// Per-player HUD laid over that player's viewport. Plain DOM; only touches the DOM when
// something actually changed.

const KEY_LABELS = {
  keyboardMouse: { climb: 'W / S', move: 'WASD', jump: 'Space', crouch: 'C' },
  gamepad: { climb: 'Left stick', move: 'Left stick', jump: 'A', crouch: 'B' },
};

export class Hud {
  constructor(root, inputKind) {
    this.keys = KEY_LABELS[inputKind] ?? KEY_LABELS.keyboardMouse;
    this.el = document.createElement('div');
    this.el.className = 'hud-view';
    this.el.innerHTML = `
      <div class="hud-burn"></div>
      <div class="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hud-hint"></div>
      <div class="hud-debug"></div>
    `;
    root.appendChild(this.el);
    this.burnEl = this.el.querySelector('.hud-burn');
    this.hintEl = this.el.querySelector('.hud-hint');
    this.debugEl = this.el.querySelector('.hud-debug');
    this._hint = null;
    this._debug = null;
    this._burn = null;
    this._rect = '';
  }

  layout(rect, totalHeight) {
    const key = `${rect.x},${rect.y},${rect.w},${rect.h},${totalHeight}`;
    if (key === this._rect) return;
    this._rect = key;
    const s = this.el.style;
    s.left = `${rect.x}px`;
    s.top = `${totalHeight - rect.y - rect.h}px`;
    s.width = `${rect.w}px`;
    s.height = `${rect.h}px`;
  }

  hintFor(player, zones) {
    const k = this.keys;
    switch (player.mode) {
      case 'net':
      case 'rope':
        return `${k.climb} climb · ${k.jump} leap off · ${k.crouch} let go`;
      case 'bars':
        return `${k.move} move along · ${k.jump} hop off · ${k.crouch} drop`;
      default:
        break;
    }
    if (player.inFire) return 'Too hot!';
    if (player.inMud) return 'Mud: slow going, weak jumps';
    if (zones.findNet(player.center) || zones.findRope(player.center)) return 'Push forward to climb';
    return '';
  }

  update(player, zones, showDebug) {
    const hint = this.hintFor(player, zones);
    if (hint !== this._hint) {
      this._hint = hint;
      this.hintEl.textContent = hint;
      this.hintEl.style.opacity = hint ? '1' : '0';
    }
    const burn = player.inFire;
    if (burn !== this._burn) {
      this._burn = burn;
      this.burnEl.style.opacity = burn ? '1' : '0';
    }
    let debug = '';
    if (showDebug) {
      const c = player.center;
      debug = `${player.mode}${player.grounded ? ' ground' : ' air'}${player.crouched ? ' crouch' : ''}${
        player.sprinting ? ' sprint' : ''
      } | ${player.speed().toFixed(1)} m/s | ${c.x.toFixed(1)}, ${player.feetY().toFixed(1)}, ${c.z.toFixed(1)}`;
    }
    if (debug !== this._debug) {
      this._debug = debug;
      this.debugEl.textContent = debug;
    }
  }

  dispose() {
    this.el.remove();
  }
}
