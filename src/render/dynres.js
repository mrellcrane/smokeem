import { gfx } from './gfx.js';

// Dynamic resolution, Halo 3's trade (a steady frame rate over pixels): when frames run long
// for a moment, the render scale steps down; after a while of frames on time it creeps back up.
// The scale multiplies the quality preset's pixel ratio, from 1 down to MIN. A step back up that
// costs frames again waits longer before the next try, so it settles instead of see-sawing (each
// change reallocates the canvas, so they stay rare).

const TARGET = 1 / 60;
// Frames averaging more than this share over the target (under about 51 fps) for OVER_FOR
// seconds step down; averaging within UNDER of it for the hold step up.
const OVER = 1.18;
const UNDER = 1.04;
const OVER_FOR = 0.6;
const HOLD = 4;
const HOLD_MAX = 32;
const DOWN = 0.85;
const UP = 1.08;
const MIN = 0.55;

export class DynamicResolution {
  constructor(renderer, baseRatio) {
    this.renderer = renderer;
    this.base = baseRatio;
    this.scale = 1;
    this.avg = TARGET;
    this.overT = 0;
    this.underT = 0;
    this.hold = HOLD;
    // Since the last step up (a drop soon after one means it didn't fit).
    this.sinceUp = Infinity;
  }

  // The preset's pixel ratio changed (quality setting): keep the scale on the new base.
  setBase(ratio) {
    this.base = ratio;
    this.apply();
  }

  // dt: this frame's interval (s), while playing.
  update(dt) {
    if (!gfx.dynamicResolution || dt <= 0 || dt > 0.25) return;
    this.avg += (dt - this.avg) * Math.min(1, dt * 6);
    this.sinceUp += dt;
    if (this.avg > TARGET * OVER) {
      this.underT = 0;
      if ((this.overT += dt) >= OVER_FOR && this.scale > MIN) {
        this.scale = Math.max(MIN, this.scale * DOWN);
        if (this.sinceUp < 3) this.hold = Math.min(HOLD_MAX, this.hold * 2);
        this.overT = 0;
        this.avg = TARGET;
        this.apply();
      }
    } else {
      this.overT = Math.max(0, this.overT - dt);
      if (this.avg < TARGET * UNDER && this.scale < 1) {
        if ((this.underT += dt) >= this.hold) {
          this.scale = Math.min(1, this.scale * UP);
          this.underT = 0;
          this.sinceUp = 0;
          this.apply();
        }
      } else {
        this.underT = 0;
      }
    }
  }

  apply() {
    const r = Math.round(this.base * this.scale * 100) / 100;
    if (r === this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
