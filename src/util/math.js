export const DEG = Math.PI / 180;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Frame-rate independent exponential smoothing factor.
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

// Move a 2D vector (x, z) toward a target by at most maxDelta. Mutates and returns out.
export function approach2(out, tx, tz, maxDelta) {
  const dx = tx - out.x;
  const dz = tz - out.z;
  const len = Math.hypot(dx, dz);
  if (len <= maxDelta || len < 1e-6) {
    out.x = tx;
    out.z = tz;
  } else {
    const k = maxDelta / len;
    out.x += dx * k;
    out.z += dz * k;
  }
  return out;
}

export function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}
