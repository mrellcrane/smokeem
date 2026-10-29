import { PAD, buttonDown } from '../input/gamepad.js';

// Controller navigation for the DOM menus: D-pad or left stick moves focus between buttons,
// sliders and checkboxes (by on-screen position), A activates, left/right changes sliders,
// steppers and segmented choices. Screen-level buttons (B, Menu) are reported back to the
// caller, which knows what they mean on each screen.

const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), input[type="range"], input[type="checkbox"]';
const STICK = 0.55;
const REPEAT_DELAY = 0.38;
const REPEAT_EVERY = 0.09;
const DIRS = ['up', 'down', 'left', 'right'];
const DIR_BUTTON = { up: PAD.UP, down: PAD.DOWN, left: PAD.LEFT, right: PAD.RIGHT };

export class PadNav {
  constructor(root) {
    this.root = root;
    this.pads = new Map();
    // Leave pad mode (focus rings) as soon as the mouse moves.
    window.addEventListener('mousemove', () => document.body.classList.remove('pad-mode'));
  }

  // Which buttons and directions went down this frame for one pad. Call once per frame per pad.
  read(gp, dt) {
    let st = this.pads.get(gp.index);
    if (!st) {
      // Not "held": the press that made a new pad show up should count (that's how you join).
      st = { prev: new Array(17).fill(false), dir: null, hold: 0, next: 0, blockDir: false };
      this.pads.set(gp.index, st);
    }
    const out = { a: false, b: false, x: false, y: false, menu: false, view: false, down: false, dir: null };
    const edge = (i) => {
      const d = buttonDown(gp, i);
      const e = d && !st.prev[i];
      st.prev[i] = d;
      return e;
    };
    out.a = edge(PAD.A);
    out.b = edge(PAD.B);
    out.x = edge(PAD.X);
    out.y = edge(PAD.Y);
    out.menu = edge(PAD.MENU);
    out.view = edge(PAD.VIEW);
    // D-pad down on its own (pauses in play); the directional repeat below is for menus.
    out.down = edge(PAD.DOWN);

    // Held direction from the D-pad or the stick, with key-repeat style timing.
    let dir = null;
    for (const d of DIRS) if (buttonDown(gp, DIR_BUTTON[d])) dir = d;
    if (!dir) {
      const x = gp.axes[0] ?? 0;
      const y = gp.axes[1] ?? 0;
      if (Math.max(Math.abs(x), Math.abs(y)) > STICK) {
        dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
      }
    }
    if (st.blockDir) {
      // A direction held since before the menu opened does nothing until it's let go.
      if (dir === st.dir) return out;
      st.blockDir = false;
    }
    if (dir !== st.dir) {
      st.dir = dir;
      st.hold = 0;
      st.next = REPEAT_DELAY;
      out.dir = dir;
    } else if (dir) {
      st.hold += dt;
      if (st.hold >= st.next) {
        st.next += REPEAT_EVERY;
        out.dir = dir;
      }
    }
    return out;
  }

  // A menu just opened over gameplay: whatever is held now (buttons, a stick direction) is
  // left over from playing and must be released before it counts.
  holdAll() {
    for (const st of this.pads.values()) {
      st.prev.fill(true);
      st.blockDir = !!st.dir;
    }
  }

  focusables() {
    return [...this.root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  }

  current(list = this.focusables()) {
    const a = document.activeElement;
    return list.includes(a) ? a : null;
  }

  focus(el) {
    if (!el) return;
    document.body.classList.add('pad-mode');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }

  // Move focus or change a value. Returns true if something happened.
  move(dir) {
    const list = this.focusables();
    if (!list.length) return false;
    const cur = this.current(list);
    if (!cur) {
      this.focus(this.root.querySelector('[data-autofocus]') ?? list[0]);
      return true;
    }
    document.body.classList.add('pad-mode');
    if (dir === 'left' || dir === 'right') {
      const sign = dir === 'right' ? 1 : -1;
      if (cur.type === 'range') {
        const step = Number(cur.step) || 1;
        const v = Math.min(Number(cur.max), Math.max(Number(cur.min), Number(cur.value) + step * sign));
        cur.value = String(Math.round(v / step) * step);
        cur.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      const stepper = cur.closest('.stepper');
      if (stepper) {
        const steps = stepper.querySelectorAll('button');
        steps[sign > 0 ? steps.length - 1 : 0]?.click();
        return true;
      }
      const seg = cur.closest('.segmented');
      if (seg) {
        const opts = [...seg.querySelectorAll('button')];
        const next = opts[opts.indexOf(cur) + sign];
        if (next) {
          this.focus(next);
          next.click();
          // The click may re-render values; keep focus on the new choice.
          this.focus(next);
        }
        return true;
      }
    }
    const next = this.nearest(cur, list, dir);
    if (next) this.focus(next);
    return !!next;
  }

  // Closest focusable in a direction, by on-screen position. Up and down wrap around.
  nearest(cur, list, dir) {
    const c = center(cur);
    // Left and right stay on the same row.
    const rowSlack = Math.max(24, cur.getBoundingClientRect().height);
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const p = center(el);
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      let main;
      let side;
      if (dir === 'down') [main, side] = [dy, dx];
      else if (dir === 'up') [main, side] = [-dy, dx];
      else if (dir === 'right') [main, side] = [dx, dy];
      else [main, side] = [-dx, dy];
      if (main <= 4) continue;
      if ((dir === 'left' || dir === 'right') && Math.abs(side) > rowSlack) continue;
      const score = main + Math.abs(side) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best || dir === 'left' || dir === 'right') return best;
    // Wrap: jump to the far end, nearest horizontally.
    let far = null;
    let farScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const p = center(el);
      const score = (dir === 'down' ? p.y : -p.y) * 4 + Math.abs(p.x - c.x);
      if (score < farScore) {
        farScore = score;
        far = el;
      }
    }
    return far;
  }

  activate() {
    const cur = this.current();
    if (!cur) {
      this.move('down');
      return null;
    }
    if (cur.type === 'range') return cur;
    cur.click();
    return cur;
  }
}

function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
