// Set dressing: things that make the maps feel like a working game show and smokehouse without
// changing how they play. Almost all of it is looks only (no colliders), kept to walls, wall tops
// and the air over the floor, and built from materials the map already draws, so it costs no
// extra draw calls. Each function returns smoke vents ({ x, y, z }) for the map's update to puff.

const deco = { collide: false };
const glow = { collide: false, castShadow: false, bakeLight: false };

// A sponsor board flat on a wall: a dark frame, a pale panel, an orange bar with a cyan strip
// under it. (x, z): the middle of the board on the wall's face; n: the way the wall faces.
function board(B, M, x, z, n, w = 6.4) {
  const along = n[0] === 0;
  const box = (mat, du, y0, y1, d0, d1, opts) => {
    const u0 = -w / 2 + du;
    const u1 = w / 2 - du;
    if (along) B.boxMinMax(mat, [x + u0, y0, Math.min(z + n[1] * d0, z + n[1] * d1)], [x + u1, y1, Math.max(z + n[1] * d0, z + n[1] * d1)], opts);
    else B.boxMinMax(mat, [Math.min(x + n[0] * d0, x + n[0] * d1), y0, z + u0], [Math.max(x + n[0] * d0, x + n[0] * d1), y1, z + u1], opts);
  };
  box(M.metalDark, 0, 2.3, 4.7, 0.0, 0.1, deco);
  box(M.concrete, 0.18, 2.48, 4.52, 0.1, 0.13, deco);
  box(M.glowOrange, 0.5, 3.55, 4.1, 0.13, 0.15, glow);
  box(M.glowCyan, 1.4, 3.05, 3.2, 0.13, 0.15, glow);
  box(M.metalDark, 2.2, 2.7, 2.85, 0.13, 0.15, deco);
}

// A TV camera on a tripod on a wall top, aimed at (tx, tz).
function tvCamera(B, M, x, y, z, tx, tz) {
  const yaw = Math.atan2(-(tx - x), -(tz - z));
  for (let i = 0; i < 3; i++) {
    const a = yaw + (i * Math.PI * 2) / 3;
    B.rod(M.metalDark, [x + Math.sin(a) * 0.55, y, z + Math.cos(a) * 0.55], [x, y + 1.3, z], 0.035, { segments: 5 });
  }
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  B.box(M.metalDark, [x, y + 1.55, z], [0.5, 0.45, 0.85], { ...deco, rotY: yaw });
  B.box(M.metal, [x, y + 1.86, z + 0.05], [0.18, 0.16, 0.5], { ...deco, rotY: yaw });
  B.rod(M.metalDark, [x + fx * 0.42, y + 1.55, z + fz * 0.42], [x + fx * 0.78, y + 1.55, z + fz * 0.78], 0.13, { segments: 10 });
  B.box(M.glowCyan, [x + fx * 0.79, y + 1.55, z + fz * 0.79], [0.2, 0.2, 0.02], { ...glow, rotY: yaw });
  B.box(M.ember, [x - fx * 0.2, y + 1.82, z - fz * 0.2], [0.08, 0.08, 0.08], { ...glow, rotY: yaw });
}

// A drum smoker (legs, a lid, a chimney, glowing vents at the bottom). Returns its chimney top.
function drumSmoker(B, M, x, y, z) {
  for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) B.rod(M.metalDark, [x + dx, y, z + dz], [x + dx * 0.8, y + 0.45, z + dz * 0.8], 0.03, { segments: 5 });
  B.cylinder(M.metalDark, [x, y + 0.4, z], 0.45, 1.0, { segments: 14, collide: false });
  B.cylinder(M.metal, [x, y + 1.4, z], 0.47, 0.12, { segments: 14, collide: false });
  B.cylinder(M.metal, [x, y + 1.52, z], 0.3, 0.08, { segments: 12, collide: false });
  B.cylinder(M.metalDark, [x + 0.18, y + 1.5, z], 0.07, 0.5, { segments: 8, collide: false });
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    B.box(M.ember, [x + Math.sin(a) * 0.45, y + 0.52, z + Math.cos(a) * 0.45], [0.14, 0.05, 0.03], { ...glow, rotY: a });
  }
  return { x: x + 0.18, y: y + 2.05, z };
}

// Mudlark Gauntlet: sponsor boards on the walls, TV cameras on the corners, drum smokers on the
// wall tops, cable runs along the foot of the walls.
export function dressMudlark(B, M, H, wallH) {
  const vents = [];
  for (const c of [-25, -15, -5, 5, 15, 25]) board(B, M, c, -H, [0, 1]);
  for (const c of [-15, -5, 5, 15]) {
    board(B, M, -H, c, [1, 0]);
    board(B, M, H, c, [-1, 0]);
  }
  const top = wallH;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) tvCamera(B, M, sx * (H + 0.5), top, sz * (H + 0.5), 0, 0);
    for (const z of [-24, 24]) vents.push(drumSmoker(B, M, sx * (H + 0.5), top, z));
  }
  // Cable runs at the foot of the east and west walls, from the corner pylons in.
  for (const sx of [-1, 1]) {
    const x = sx * (H - 0.35);
    for (const [z0, z1] of [[-H + 2, -6], [6, H - 2]]) {
      B.boxMinMax(M.metalDark, [x - 0.06, 0, z0], [x + 0.06, 0.07, z1], { ...deco, castShadow: false });
      B.boxMinMax(M.metalDark, [x + sx * 0.12 - 0.04, 0, z0 + 1], [x + sx * 0.12 + 0.04, 0.05, z1 - 1], { ...deco, castShadow: false });
    }
  }
  return vents;
}

// A string of smoked sausages hanging from a hook: a chain down from `top`, then links.
function links(B, M, x, top, z, n) {
  B.rod(M.metalDark, [x, top, z], [x, top - 0.6, z], 0.015, { segments: 4, castShadow: false });
  let y = top - 0.6;
  for (let i = 0; i < n; i++) {
    const lean = (i % 2 ? 1 : -1) * 0.1;
    B.rod(M.paint, [x + lean, y, z], [x - lean, y - 0.4, z], 0.08, { segments: 7 });
    y -= 0.44;
  }
}

// Smokestack Works: sausages hanging under the trusses, gauges on the end-wall pipes, warning
// boards on the end walls, pallet stacks in the corners (these collide: they're cover).
export function dressFactory(B, M, { HX, HZ, truss, crate }) {
  // From the trusses' bottom chords, between the hanging lamps (z 7 and 15) and clear of the
  // jumbotron over the smoker.
  for (let x = -24; x <= 24; x += 6) {
    if (x === 0) continue;
    for (const z of [-11, -3, 3, 11]) {
      if (Math.abs(x) <= 6 && Math.abs(z) <= 3) continue;
      const n = 3 + (((x + 30) * 7 + (z + 30) * 3) % 3);
      links(B, M, x, truss, z, n);
      links(B, M, x, truss, z + 0.3, n - 1);
    }
  }
  for (const sx of [-1, 1]) {
    const px = sx * (HX - 0.4);
    // A gauge on each pipe drop, facing into the hall.
    for (const z of [-14, 8]) {
      const fx = px - sx * 0.3;
      B.box(M.metalDark, [fx, 1.6, z], [0.12, 0.42, 0.42], deco);
      B.box(M.glowOrange, [fx - sx * 0.065, 1.6, z], [0.01, 0.3, 0.3], glow);
      B.box(M.metalDark, [fx - sx * 0.072, 1.66, z + 0.04], [0.01, 0.14, 0.025], deco);
    }
    // Hazard-striped warning boards low on the end walls.
    for (const z of [-4, 4]) {
      const wx = sx * HX;
      B.boxMinMax(M.metalDark, [Math.min(wx, wx - sx * 0.08), 1.6, z - 1.3], [Math.max(wx, wx - sx * 0.08), 3.2, z + 1.3], deco);
      B.boxMinMax(M.hazard, [Math.min(wx - sx * 0.08, wx - sx * 0.1), 1.75, z - 1.15], [Math.max(wx - sx * 0.08, wx - sx * 0.1), 3.05, z + 1.15], deco);
    }
    // Pallet stacks in the corners under the catwalks' ladder ends (the stairs fill the others).
    for (const sz of [-1, 1]) {
      if (sz === sx) continue;
      const x = sx * (HX - 1.4);
      const z = sz * (HZ - 1.4);
      crate(B, M, x, 0, z, 1.4, 0.1 * sx);
      crate(B, M, x - sx * 0.1, 1.4, z + sz * 0.05, 1.1, -0.2 * sz);
      crate(B, M, x - sx * 1.5, 0, z, 1.0, 0.3);
    }
  }
  return [];
}
