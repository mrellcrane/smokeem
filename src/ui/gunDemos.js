// Little looping demos of how each gun works, for the loadout cards and the set's gun list: the
// muzzle on the left, a target on the right that flashes when it's hit. Plain SVG animated with
// CSS (style.css, the .demo rules), so they cost next to nothing. Every demo loops on the same
// CYCLE; each element's animation-delay places it in the loop. Each delay adds var(--seek): with
// reduced motion on, the demos stop on their still (a telling moment) instead of moving.

const CYCLE = 2.4;
const MUZZLE = [10, 20];
// Travel time of a bullet streak (the dm-shot keyframes sweep it in 8% of the cycle), and when
// its head reaches the end of the line (the 14-long dash crosses 100 of its 114-long sweep).
const TRAVEL = CYCLE * 0.08;
const ARRIVE = TRAVEL * (100 / 114);

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const at = (t) => `animation-delay:calc(${t.toFixed(2)}s + var(--seek, 0s))`;

// A target standing at x; it flashes at each time in hits (s into the loop).
function target(x, hits, cls = 'dm-hit', base = 'dm-target') {
  const shape = (c, style = '') => `<g class="${c}" style="${style}"><circle cx="${x}" cy="9" r="5"/><rect x="${x - 6}" y="15" width="12" height="21" rx="3.5"/></g>`;
  return shape(base) + hits.map((t) => shape(cls, at(t))).join('');
}

// A bullet streak from the muzzle to (x, y), fired at time t. cls dm-fizzle: it dies out partway.
function shot(x, y, color, t, width = 2.4, cls = 'dm-shot') {
  return `<line class="${cls}" x1="${MUZZLE[0]}" y1="${MUZZLE[1]}" x2="${x}" y2="${y}" pathLength="100" stroke="${color}" stroke-width="${width}" style="${at(t)}"/>`;
}

// A burst ring at (x, y) at time t.
function blast(x, y, r, color, t) {
  return `<circle class="dm-blast" cx="${x}" cy="${y}" r="${r}" stroke="${color}" style="${at(t)}"/>`;
}

// Something flying along path d: a bright head and a fading trail, launched at time t.
function flyer(d, color, t, { head = 5, trail = 'rgba(200,190,180,0.5)', cls = 'dm-fly' } = {}) {
  return (
    `<path class="dm-trail ${cls}-trail" d="${d}" pathLength="100" stroke="${trail}" style="${at(t)}"/>` +
    `<path class="${cls}" d="${d}" pathLength="100" stroke="${color}" stroke-width="${head}" style="${at(t)}"/>`
  );
}

// Gun ids to their demo. still: the moment (s into the loop) shown with reduced motion.
const DEMOS = {
  // Full auto at mid range: a steady stream that blooms the longer you hold it.
  hickory: {
    still: 0.6,
    draw: () => {
      const c = hex(0xffc070);
      let s = '';
      const hits = [];
      for (let i = 0; i < 7; i++) {
        const t = 0.2 + i * 0.11;
        s += shot(140, 20 + (i % 2 ? 1 : -1) * i * 0.9, c, t);
        hits.push(t + ARRIVE);
      }
      return target(140, hits) + s;
    },
  },
  // Very fast, but only close up: it shreds the near target, then its streaks die out well
  // short of the far one.
  kindling: {
    still: 0.5,
    draw: () => {
      const c = hex(0xffb070);
      let s = '';
      const hits = [];
      for (let i = 0; i < 7; i++) {
        const t = 0.2 + i * 0.07;
        s += shot(62, 20 + ((i * 7) % 5) - 2, c, t, 2);
        hits.push(t + ARRIVE);
      }
      for (let i = 0; i < 6; i++) s += shot(140, 20 + ((i * 3) % 5) - 2, c, 1.05 + i * 0.07, 2, 'dm-fizzle');
      // The near target drops (dm-down) as the last of the burst lands, and is back for the next loop.
      return target(140, []) + target(62, hits, 'dm-hit', 'dm-target dm-down') + blast(62, 20, 11, '#9aa0a8', 0.8) + s;
    },
  },
  // Quick sidearm taps.
  toothpick: {
    still: 0.45,
    draw: () => {
      const c = hex(0xffd27a);
      return target(140, [0.35 + ARRIVE, 0.62 + ARRIVE]) + shot(140, 19, c, 0.35) + shot(140, 21, c, 0.62);
    },
  },
  // Scoped marksman shot to the head: only the head flashes.
  coldSmoke: {
    still: 1.0,
    draw: () => {
      const c = hex(0x9fe8ff);
      const t = 0.9;
      return (
        target(140, []) +
        `<circle class="dm-hit dm-big" cx="140" cy="9" r="6" style="${at(t + ARRIVE)}"/>` +
        `<g class="dm-scope"><circle cx="140" cy="9" r="10"/><line x1="127" y1="9" x2="153" y2="9"/><line x1="140" y1="-4" x2="140" y2="22"/></g>` +
        shot(140, 9, c, t, 2)
      );
    },
  },
  // One blast of pellets in a cone: brutal up close.
  mesquite: {
    still: 0.5,
    draw: () => {
      const c = hex(0xffd890);
      let s = '';
      for (let i = 0; i < 8; i++) s += shot(70 + (i % 3) * 6, 6 + i * 4, c, 0.4, 1.8);
      return target(78, [0.4 + ARRIVE]) + s;
    },
  },
  // Spins up first (everyone hears it), then a torrent.
  rotisserie: {
    still: 0.9,
    draw: () => {
      const c = hex(0xffc070);
      let s = `<g class="dm-spin"><circle cx="10" cy="20" r="5"/><line x1="10" y1="15" x2="10" y2="25"/><line x1="5.7" y1="17.5" x2="14.3" y2="22.5"/><line x1="5.7" y1="22.5" x2="14.3" y2="17.5"/></g>`;
      const hits = [];
      for (let i = 0; i < 16; i++) {
        const t = 0.55 + i * 0.055;
        s += shot(140, 20 + ((i * 5) % 7) - 3, c, t, 2);
        hits.push(t + ARRIVE);
      }
      return target(140, hits) + s;
    },
  },
  // A rocket you steer from its nose camera: it swerves around to the target and bursts.
  smokeSignal: {
    still: 0.8,
    draw: () =>
      target(140, [1.25]) +
      flyer('M10 20 C 50 -10, 80 46, 140 20', '#fff0c0', 0.2, { cls: 'dm-rocket', head: 6 }) +
      blast(140, 20, 14, '#ffb050', 1.2),
  },
  // Glowing coals lobbed in an arc that bounce, then burst.
  chimney: {
    still: 0.6,
    draw: () =>
      target(118, [0.95, 1.55]) +
      flyer('M10 20 Q 45 -8 82 33 Q 96 18 112 30', '#ff7a1a', 0.2, { cls: 'dm-coal', head: 5, trail: 'rgba(255,120,40,0.25)' }) +
      blast(112, 28, 9, '#ff7a1a', 0.95) +
      flyer('M10 20 Q 50 -4 90 33 Q 104 20 118 31', '#ff7a1a', 0.8, { cls: 'dm-coal', head: 5, trail: 'rgba(255,120,40,0.25)' }) +
      blast(118, 29, 9, '#ff7a1a', 1.55),
  },
  // A short heat beam that turns white-hot the longer it stays on you.
  brander: {
    still: 1.5,
    draw: () =>
      target(88, []) +
      `<g class="dm-heat"><circle cx="88" cy="9" r="5"/><rect x="82" y="15" width="12" height="21" rx="3.5"/></g>` +
      `<line class="dm-beam" x1="10" y1="20" x2="86" y2="20"/>`,
  },
  // A jar lobbed over that smashes and lets out bugs that hunt the target.
  swarmJar: {
    still: 1.3,
    draw: () => {
      let s = flyer('M10 20 Q 40 -6 70 32', '#d9b45a', 0.15, { cls: 'dm-jar', head: 7, trail: 'rgba(217,180,90,0.25)' }) + blast(70, 32, 7, '#d9b45a', 0.72);
      for (let i = 0; i < 6; i++) {
        s += `<circle class="dm-bug" cx="70" cy="32" r="1.8" style="--bx:${60 + ((i * 7) % 9)}px;--by:${-22 + ((i * 11) % 14)}px;${at(0.75 + i * 0.04)}"/>`;
      }
      return target(140, [1.5, 1.7, 1.9]) + s;
    },
  },
  // Sticky bombs lobbed onto the floor by the target, then both set off together.
  stickybomb: {
    still: 1.2,
    draw: () =>
      target(132, [1.45]) +
      flyer('M10 20 Q 50 -6 116 35', '#ff3a24', 0.15, { cls: 'dm-coal', head: 5, trail: 'rgba(255,90,60,0.25)' }) +
      flyer('M10 20 Q 60 -10 146 35', '#ff3a24', 0.6, { cls: 'dm-coal', head: 5, trail: 'rgba(255,90,60,0.25)' }) +
      blast(116, 34, 12, '#ff5a3a', 1.45) +
      blast(146, 34, 12, '#ff5a3a', 1.45),
  },
  // A crate pulled in to the gun's claws, then flung at the target.
  gravityGun: {
    still: 1.0,
    draw: () =>
      target(140, [1.25]) +
      flyer('M70 33 L 24 20', '#c08850', 0.15, { cls: 'dm-jar', head: 9, trail: 'rgba(99,242,255,0.35)' }) +
      flyer('M24 20 L 136 22', '#c08850', 0.85, { cls: 'dm-jar', head: 9, trail: 'rgba(99,242,255,0.35)' }) +
      blast(138, 22, 10, '#63f2ff', 1.25),
  },
};

// The demo for a gun, as an inline SVG (a generic stream of shots for guns without their own).
export function gunDemo(id) {
  const demo = DEMOS[id] ?? DEMOS.hickory;
  return `<svg class="demo" viewBox="0 0 160 40" style="--still:${-demo.still}s" aria-hidden="true">${demo.draw()}</svg>`;
}
