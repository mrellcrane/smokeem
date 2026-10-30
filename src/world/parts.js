// Building blocks every map uses: crates, barriers, drums, pickup pads and the game show's
// grandstands. Each adds to a StaticBuilder (B) with the match's materials (M).

export function crate(B, M, x, y, z, s, rotY = 0) {
  B.box(M.crate, [x, y + s / 2, z], [s, s, s], { uv: 'fit', rotY });
}

export function barrier(B, M, x, z, rotY) {
  B.box(M.concrete, [x, 0.5, z], [3, 1.0, 0.6], { rotY });
  B.box(M.hazard, [x, 0.85, z], [3.02, 0.12, 0.62], { rotY, collide: false });
}

export function drum(B, M, x, z, y = 0) {
  B.cylinder(M.metalDark, [x, y, z], 0.45, 1.1, { segments: 12 });
  B.cylinder(M.glowOrange, [x, y + 0.75, z], 0.46, 0.1, { segments: 12, collide: false, castShadow: false });
}

// A pad with a glowing rim under every pickup spawner. Orange for the power pad, cyan for
// other guns, ember for grenades.
export function pickupPads(B, M, spots) {
  for (const spot of spots) {
    const [x, y, z] = spot.pos;
    const glow = spot.type === 'grenades' ? M.ember : spot.pad === 'power' ? M.glowOrange : M.glowCyan;
    B.cylinder(glow, [x, y, z], 0.62, 0.04, { segments: 16, collide: false, castShadow: false });
    B.cylinder(M.metalDark, [x, y + 0.01, z], 0.55, 0.07, { segments: 16, collide: false });
  }
}

// Game-show grandstands rising behind the walls (looks only: no collision, no shadows; the
// crowd standing on them is world/show.js). hx, hz: the inside faces of the walls; wallH: their
// height; sides: which walls get stands, as [axis, sign] (['z', -1] is the north wall); inset:
// how far short of the corners the rows stop. Returns where each crowd row stands: { a, b, n }
// with a and b the row's ends and n its inward facing (x, z).
export const STAND_TIERS = 5;
export const TIER_DEPTH = 1.6;
const TIER_RISE = 1.1;
const ALL_SIDES = [['z', -1], ['z', 1], ['x', -1], ['x', 1]];
export function grandstands(B, M, { hx, hz = hx, wallH, sides = ALL_SIDES, inset = 4 }) {
  const T = 1;
  const deco = { collide: false, castShadow: false };
  const rows = [];
  for (const [ax, sign] of sides) {
    const H = ax === 'z' ? hz : hx;
    const L = (ax === 'z' ? hx : hz) - inset;
    for (let i = 0; i < STAND_TIERS; i++) {
      const near = H + T + i * TIER_DEPTH;
      const far = near + TIER_DEPTH;
      const top = wallH - 0.6 + i * TIER_RISE;
      const lo = wallH - 4;
      const box = (m, a0, a1, y0, y1, d0, d1) => {
        if (ax === 'z') B.boxMinMax(m, [a0, y0, Math.min(sign * d0, sign * d1)], [a1, y1, Math.max(sign * d0, sign * d1)], deco);
        else B.boxMinMax(m, [Math.min(sign * d0, sign * d1), y0, a0], [Math.max(sign * d0, sign * d1), y1, a1], deco);
      };
      box(M.concrete, -L, L, lo, top, near, far);
      // A dark bench lip along each step.
      box(M.metalDark, -L, L, top - 0.35, top + 0.05, near - 0.02, near + 0.25);
      const d = near + TIER_DEPTH * 0.55;
      const a = ax === 'z' ? [-L + 1, top, sign * d] : [sign * d, top, -L + 1];
      const b = ax === 'z' ? [L - 1, top, sign * d] : [sign * d, top, L - 1];
      rows.push({ a, b, n: ax === 'z' ? [0, -sign] : [-sign, 0] });
    }
    // An orange glow strip along the front of the stands, over the wall.
    const y = wallH + 0.05;
    const glow = { collide: false, castShadow: false, bakeLight: false };
    const d0 = Math.min(sign * (H + T), sign * (H + T + 0.1));
    const d1 = Math.max(sign * (H + T), sign * (H + T + 0.1));
    if (ax === 'z') B.boxMinMax(M.glowOrange, [-L, y, d0], [L, y + 0.12, d1], glow);
    else B.boxMinMax(M.glowOrange, [d0, y, -L], [d1, y + 0.12, L], glow);
  }
  return rows;
}
