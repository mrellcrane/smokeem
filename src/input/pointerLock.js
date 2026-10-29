// Pointer lock wrapper. Callers react to lock/unlock through callbacks driven by
// `pointerlockchange`, never by Esc keydown (the browser owns Esc while locked).

export class PointerLock {
  constructor(element) {
    this.element = element;
    this.onLock = null;
    this.onUnlock = null;
    this.onError = null;
    this._onChange = () => {
      if (this.isLocked) this.onLock?.();
      else this.onUnlock?.();
    };
    this._onError = () => this.onError?.();
    document.addEventListener('pointerlockchange', this._onChange);
    document.addEventListener('pointerlockerror', this._onError);
  }

  get supported() {
    return typeof this.element.requestPointerLock === 'function';
  }

  get isLocked() {
    return document.pointerLockElement === this.element;
  }

  // Must be called from a user gesture (click / keydown).
  request() {
    if (!this.supported) {
      this.onError?.();
      return;
    }
    let result;
    try {
      // Raw mouse input where supported (Chrome). Safari ignores or rejects the option.
      result = this.element.requestPointerLock({ unadjustedMovement: true });
    } catch {
      this._plainRequest();
      return;
    }
    if (result && typeof result.catch === 'function') {
      result.catch(() => this._plainRequest());
    }
  }

  _plainRequest() {
    let result;
    try {
      result = this.element.requestPointerLock();
    } catch {
      this.onError?.();
      return;
    }
    if (result && typeof result.catch === 'function') {
      // Chrome also rejects when re-locking within about a second of pressing Esc.
      result.catch(() => this.onError?.());
    }
  }

  exit() {
    if (this.isLocked) document.exitPointerLock?.();
  }

  dispose() {
    document.removeEventListener('pointerlockchange', this._onChange);
    document.removeEventListener('pointerlockerror', this._onError);
  }
}
