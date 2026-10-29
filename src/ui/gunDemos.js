// Little looping demos of how each gun works, for the loadout cards and the set's gun list: the
// muzzle on the left, a target on the right that flashes when it's hit. Plain SVG animated with
// CSS (style.css, the .demo rules), so they cost next to nothing. Every demo loops on the same
// CYCLE; each element's animation-delay places it in the loop.

const CYCLE = 2.4;
const MUZZLE = [10, 20];
// Travel time of a bullet streak (the dm-shot keyframes run it in 8% of the cycle).
const TRAVEL = CYCLE * 0.08;

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

// A target standing at x; it flashes at each time in hits (s into the loop).
function target(x, hits, cls = 'dm-hit') {
  const shape = (c, style = '') => `<g class="${c}" style="${style}"><circle cx="${x}" cy="9" r="5"/><rect x="${x - 6}" y="15" width="12" height="21" rx="3.5"/></g>`;
  return shape('dm-target') + hits.map((t) => shape(cls, `animation-delay:${t.toFixed(2)}s`)).join('');
}

// A bullet streak from the muzzle to (x, y), fired at time t.
function shot(x, y, color, t, width = 2.4) {
  return `<line class="dm-shot" x1="${MUZZLE[0]}" y1="${MUZZLE[1]}" x2="${x}" y2="${y}" pathLength="100" stroke="${color}" stroke-width="${width}" style="animation-delay:${t.toFixed(2)}s"/>`;
}

// A burst ring at (x, y) at time t.
function blast(x, y, r, color, t) {
  return `<circle class="dm-blast" cx="${x}" cy="${y}" r="${r}" stroke="${color}" style="animation-delay:${t.toFixed(2)}s"/>`;
}

// Something flying along path d: a bright head and a fading trail, launched at time t.
function flyer(d, color, t, { head = 5, trail = 'rgba(200,190,180,0.5)', cls = 'dm-fly' } = {}) {
  return (
    `<path class="dm-trail ${cls}-trail" d="${d}" pathLength="100" stroke="${trail}" style="animation-delay:${t.toFixed(2)}s"/>` +
    `<path class="${cls}" d="${d}" pathLength="100" stroke="${color}" stroke-width="${head}" style="animation-delay:${t.toFixed(2)}s"/>`
  );
}

// Gun ids to their demo.
const DEMOS = {
  // Full auto at mid range: a steady stream that blooms the longer you hold it.
  hickory: () => {
    const c = hex(0xffc070);
    let s = '';
    const hits = [];
    for (let i = 0; i < 7; i++) {
      const t = 0.2 + i * 0.11;
      s += shot(140, 20 + (i % 2 ? 1 : -1) * i * 0.9, c, t);
      hits.push(t + TRAVEL);
    }
    return target(140, hits) + s;
  },
  // Very fast, but only close up: streaks fade out well short of a far target.
  kindling: () => {
    const c = hex(0xffb070);
    let s = '';
    const hits = [];
    for (let i = 0; i < 11; i++) {
      const t = 0.2 + i * 0.07;
      s += shot(88, 20 + ((i * 7) % 5) - 2, c, t, 2);
      hits.push(t + TRAVEL * 0.6);
    }
    return target(88, hits) + s;
  },
  // Quick sidearm taps.
  toothpick: () => {
    const c = hex(0xffd27a);
    return target(140, [0.35 + TRAVEL, 0.62 + TRAVEL]) + shot(140, 19, c, 0.35) + shot(140, 21, c, 0.62);
  },
  // Scoped marksman shot to the head.
  coldSmoke: () => {
    const c = hex(0x9fe8ff);
    const t = 0.9;
    return (
      target(140, [t + TRAVEL], 'dm-hit dm-big') +
      `<g class="dm-scope"><circle cx="140" cy="9" r="10"/><line x1="127" y1="9" x2="153" y2="9"/><line x1="140" y1="-4" x2="140" y2="22"/></g>` +
      shot(140, 9, c, t, 2)
    );
  },
  // One blast of pellets in a cone: brutal up close.
  mesquite: () => {
    const c = hex(0xffd890);
    let s = '';
    for (let i = 0; i < 8; i++) s += shot(70 + (i % 3) * 6, 6 + i * 4, c, 0.4, 1.8);
    return target(78, [0.4 + TRAVEL * 0.5]) + s;
  },
  // Spins up first (everyone hears it), then a torrent.
  rotisserie: () => {
    const c = hex(0xffc070);
    let s = `<g class="dm-spin"><circle cx="10" cy="20" r="5"/><line x1="10" y1="15" x2="10" y2="25"/><line x1="5.7" y1="17.5" x2="14.3" y2="22.5"/><line x1="5.7" y1="22.5" x2="14.3" y2="17.5"/></g>`;
    const hits = [];
    for (let i = 0; i < 16; i++) {
      const t = 0.55 + i * 0.055;
      s += shot(140, 20 + ((i * 5) % 7) - 3, c, t, 2);
      hits.push(t + TRAVEL);
    }
    return target(140, hits) + s;
  },
  // A rocket you steer from its nose camera: it swerves around to the target and bursts.
  smokeSignal: () =>
    target(140, [1.25]) +
    flyer('M10 20 C 50 -10, 80 46, 140 20', '#fff0c0', 0.2, { cls: 'dm-rocket', head: 6 }) +
    blast(140, 20, 14, '#ffb050', 1.2),
  // Glowing coals lobbed in an arc that bounce, then burst.
  chimney: () =>
    target(118, [0.95, 1.55]) +
    flyer('M10 20 Q 45 -8 82 33 Q 96 18 112 30', '#ff7a1a', 0.2, { cls: 'dm-coal', head: 5, trail: 'rgba(255,120,40,0.25)' }) +
    blast(112, 28, 9, '#ff7a1a', 0.95) +
    flyer('M10 20 Q 50 -4 90 33 Q 104 20 118 31', '#ff7a1a', 0.8, { cls: 'dm-coal', head: 5, trail: 'rgba(255,120,40,0.25)' }) +
    blast(118, 29, 9, '#ff7a1a', 1.55),
  // A short heat beam that turns white-hot the longer it stays on you.
  brander: () =>
    target(88, []) +
    `<g class="dm-heat"><circle cx="88" cy="9" r="5"/><rect x="82" y="15" width="12" height="21" rx="3.5"/></g>` +
    `<line class="dm-beam" x1="10" y1="20" x2="86" y2="20"/>`,
  // A jar lobbed over that smashes and lets out bugs that hunt the target.
  swarmJar: () => {
    let s = flyer('M10 20 Q 40 -6 70 32', '#d9b45a', 0.15, { cls: 'dm-jar', head: 7, trail: 'rgba(217,180,90,0.25)' }) + blast(70, 32, 7, '#d9b45a', 0.72);
    for (let i = 0; i < 6; i++) {
      s += `<circle class="dm-bug" cx="70" cy="32" r="1.8" style="--bx:${60 + ((i * 7) % 9)}px;--by:${-22 + ((i * 11) % 14)}px;animation-delay:${(0.75 + i * 0.04).toFixed(2)}s"/>`;
    }
    return target(140, [1.5, 1.7, 1.9]) + s;
  },
};

// The demo for a gun, as an inline SVG (a generic stream of shots for guns without their own).
export function gunDemo(id) {
  const body = (DEMOS[id] ?? DEMOS.hickory)();
  return `<svg class="demo" viewBox="0 0 160 40" aria-hidden="true">${body}</svg>`;
}
