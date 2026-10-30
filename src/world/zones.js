import * as THREE from 'three';

// Gameplay volumes that aren't solid: mud, fire, cargo nets, ropes, monkey bars, conveyor belts.
// Plain math instead of physics sensors so the player controller and (later) bots can query
// them cheaply and predictably.

const _rel = new THREE.Vector3();

export class Zones {
  constructor() {
    this.mud = [];
    this.fire = [];
    this.nets = [];
    this.ropes = [];
    this.bars = [];
    this.belts = [];
    this.launches = [];
  }

  // A launch pad (Halo's man cannon): feet standing on it are thrown at vel ([vx, vy, vz], m/s).
  addLaunch(min, max, vel) {
    this.launches.push({ min, max, vel });
  }

  launchAt(feet) {
    for (const l of this.launches) {
      if (feet.x > l.min[0] && feet.x < l.max[0] && feet.y > l.min[1] && feet.y < l.max[1] && feet.z > l.min[2] && feet.z < l.max[2]) return l;
    }
    return null;
  }

  // A conveyor belt: feet standing in the box (just over the belt's top) ride along at vel
  // ([vx, vz], m/s).
  addBelt(min, max, vel) {
    this.belts.push({ min, max, vx: vel[0], vz: vel[1] });
  }

  beltAt(feet) {
    for (const b of this.belts) {
      if (
        feet.x > b.min[0] && feet.x < b.max[0] &&
        feet.y > b.min[1] && feet.y < b.max[1] &&
        feet.z > b.min[2] && feet.z < b.max[2]
      ) {
        return b;
      }
    }
    return null;
  }

  // surface: the height of the mud's top (a visual quad with no collider), for shots.
  addMud(min, max, surface = max[1]) {
    this.mud.push({ min, max, surface });
  }

  addFire(min, max) {
    this.fire.push({ min, max });
  }

  // A climbable net. `bottom` and `top` are the centers of its bottom and top edges;
  // `outward` points to the side players climb on.
  addNet({ bottom, top, width, outward }) {
    const b = new THREE.Vector3(...bottom);
    const t = new THREE.Vector3(...top);
    const up = t.clone().sub(b);
    const length = up.length();
    up.divideScalar(length);
    const out = new THREE.Vector3(...outward).normalize();
    const lateral = new THREE.Vector3().crossVectors(up, out).normalize();
    const normal = new THREE.Vector3().crossVectors(lateral, up).normalize();
    // Horizontal direction a climber faces (into the net).
    const facing = new THREE.Vector3(-normal.x, 0, -normal.z).normalize();
    this.nets.push({ bottom: b, top: t, up, length, lateral, normal, facing, width });
  }

  addRope({ x, z, y0, y1 }) {
    this.ropes.push({ x, z, y0, y1 });
  }

  // Monkey bars: an axis-aligned rectangle of hand holds at height y.
  addBars({ minX, maxX, minZ, maxZ, y }) {
    this.bars.push({ minX, maxX, minZ, maxZ, y });
  }

  // Net-local coordinates of a point: s along the climb, t sideways, d off the surface.
  netLocal(net, p, out) {
    _rel.subVectors(p, net.bottom);
    out.s = _rel.dot(net.up);
    out.t = _rel.dot(net.lateral);
    out.d = _rel.dot(net.normal);
    return out;
  }

  findNet(center) {
    const loc = { s: 0, t: 0, d: 0 };
    for (const net of this.nets) {
      this.netLocal(net, center, loc);
      if (
        loc.s > -0.6 &&
        loc.s < net.length + 0.2 &&
        Math.abs(loc.t) < net.width / 2 + 0.1 &&
        loc.d > -0.35 &&
        loc.d < 1.1
      ) {
        return net;
      }
    }
    return null;
  }

  findRope(center) {
    for (const r of this.ropes) {
      const dx = center.x - r.x;
      const dz = center.z - r.z;
      if (dx * dx + dz * dz < 0.8 * 0.8 && center.y > r.y0 - 0.6 && center.y < r.y1) return r;
    }
    return null;
  }

  findBars(hand) {
    for (const b of this.bars) {
      if (
        hand.x > b.minX && hand.x < b.maxX &&
        hand.z > b.minZ && hand.z < b.maxZ &&
        Math.abs(hand.y - b.y) < 0.4
      ) {
        return b;
      }
    }
    return null;
  }

  // A point on the monkey bars' frame (the bars and the posts holding them up, down to about
  // where a hanging body's feet are), so nobody wall-kicks off the bars.
  inBarsFrame(p) {
    for (const b of this.bars) {
      if (
        p.x > b.minX - 0.2 && p.x < b.maxX + 0.2 &&
        p.z > b.minZ - 0.2 && p.z < b.maxZ + 0.2 &&
        p.y > b.y - 2.2 && p.y < b.y + 0.6
      ) {
        return true;
      }
    }
    return false;
  }

  // Where a ray from origin along dir (a unit vector) first enters a mud surface, as a distance,
  // if that's before maxDist; otherwise null.
  mudAlong(origin, dir, maxDist) {
    if (dir.y >= 0) return null;
    let best = null;
    for (const z of this.mud) {
      if (origin.y <= z.surface) continue;
      const t = (z.surface - origin.y) / dir.y;
      if (t >= maxDist || (best !== null && t >= best)) continue;
      const x = origin.x + dir.x * t;
      const zz = origin.z + dir.z * t;
      if (x > z.min[0] && x < z.max[0] && zz > z.min[2] && zz < z.max[2]) best = t;
    }
    return best;
  }

  // The height of the mud's surface when p is in the mud or less than reach above it, else null.
  mudTop(p, reach) {
    for (const z of this.mud) {
      if (p.x > z.min[0] && p.x < z.max[0] && p.z > z.min[2] && p.z < z.max[2] && p.y > z.min[1] && p.y < z.surface + reach) {
        return z.surface;
      }
    }
    return null;
  }

  inMud(feet) {
    for (const z of this.mud) {
      if (
        feet.x > z.min[0] && feet.x < z.max[0] &&
        feet.y > z.min[1] && feet.y < z.max[1] &&
        feet.z > z.min[2] && feet.z < z.max[2]
      ) {
        return true;
      }
    }
    return false;
  }

  // Capsule (feet point, height, radius) against fire boxes.
  inFire(feet, height, radius) {
    for (const z of this.fire) {
      if (
        feet.x > z.min[0] - radius && feet.x < z.max[0] + radius &&
        feet.z > z.min[2] - radius && feet.z < z.max[2] + radius &&
        feet.y < z.max[1] && feet.y + height > z.min[1]
      ) {
        return true;
      }
    }
    return false;
  }
}
