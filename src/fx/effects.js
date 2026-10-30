import * as THREE from 'three';
import { Tracers } from './tracers.js';
import { Particles } from './particles.js';
import { setView } from './viewUniforms.js';

// All pooled world effects. Everything is created at load and stays in the scene, so the
// shaders are compiled during warm-up and nothing new appears mid-match.

const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _o = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Cells of the effect atlases (textures.js).
const STAR = 1; // 1 to 3
const RING = 4;
const STREAK = 5;
const SHARD = 6;
const FIRE = 8; // 8 to 11
// In the smoke atlas.
const PUFF = 0; // 0 to 3
const CHIP = 4;
const SPLINTER = 5;
const SPLAT = 6;
const HOLE = 7;
const SCORCH = 8;

// What a bullet kicks up from each surface (materials.js), and how dark a mark it leaves (none
// on mud, nets and ropes). Marks only darken what's under them, so they take its light and shade.
const HITS = {
  metal: { sparks: 8, spark: 0xffc070, dust: 0x9a9690, mark: 0.9 },
  dirt: { chips: 4, chip: 0x5a3e2a, dust: 0xa88462, dustSize: 0.3, mark: 0.75 },
  wood: { splinters: 4, chip: 0xd8b07a, dust: 0xc0a07c, mark: 0.9 },
  concrete: { sparks: 2, spark: 0xffd090, chips: 4, chip: 0xa8a6a2, dust: 0xc4c0ba, mark: 0.85 },
  mud: { splats: 5, chip: 0x7a5c40 },
  cloth: { dust: 0xb8a888 },
  // Anything else (invisible blockers).
  other: { sparks: 6, spark: 0xffb060, dust: 0xb89a80 },
};
// Bullet marks and blast scorches: how long they stay and fade (s).
const MARK_LIFE = 15;
const SCORCH_LIFE = 30;
const MARK_FADE = 3;

// Shields flare gold, Halo's way.
const SHIELD_GOLD = 0xffcf5a;

export class Effects {
  // opts: decals (how many marks can lie around at once: 0 for none), fxScale (multiplies smoke
  // and ember counts; the quality preset's).
  constructor(scene, textures, { decals = 0, fxScale = 1 } = {}) {
    this.fxScale = fxScale;
    this.tracerPool = new Tracers(64);
    this.sparks = new Particles({ max: 512, texture: textures.fxAtlas, additive: true, name: 'sparks' });
    this.smoke = new Particles({ max: 320, decals, texture: textures.smokeAtlas, additive: false, name: 'smoke' });
    scene.add(this.tracerPool.mesh, this.sparks.mesh, this.smoke.mesh);
  }

  // Before each split-screen view renders: whose view it is and its height in pixels.
  setView(viewer, viewportH) {
    setView(viewer, viewportH);
  }

  // opts: a3 (start in other players' views), owner (shooter id), linger (see Tracers.spawn)
  tracer(a, b, color, width, opts) {
    this.tracerPool.spawn(a, b, color, width, opts);
  }

  // Heat beams get their own small pool (built only when the match has a beam gun), so they
  // never steal bullet tracers. Each pulse redraws its segment for a moment.
  enableBeams(scene) {
    if (this.beamPool) return;
    this.beamPool = new Tracers(16);
    this.beamPool.mesh.name = 'beams';
    scene.add(this.beamPool.mesh);
  }

  // opts: a3 and owner, as for tracers.
  beam(a, b, color, width, opts = {}) {
    (this.beamPool ?? this.tracerPool).spawn(a, b, color, width, { ...opts, life: 0.07, startWidth: width * 0.2 });
  }

  // Sparks thrown out of a surface around its normal, at least minPx pixels on screen.
  burst(point, normal, color, count, speed, size, minPx = 2) {
    for (let i = 0; i < count; i++) {
      randomInHemisphere(normal, _t);
      const s = speed * (0.4 + Math.random() * 0.8);
      this.sparks.spawn(
        point.x + normal.x * 0.03,
        point.y + normal.y * 0.03,
        point.z + normal.z * 0.03,
        _t.x * s,
        _t.y * s,
        _t.z * s,
        color,
        size * (0.7 + Math.random() * 0.6),
        0.12 + Math.random() * 0.14,
        { gravity: 9, drag: 2, grow: 0.4, minPx },
      );
    }
  }

  // A gun going off, as other players see it: a star at the muzzle and a short streak along the
  // shot, tinted per gun. The star is at least 14 px across (its bright core about half that),
  // so a far shooter still blinks. owner: the shooter, who sees their own first-person flash
  // instead.
  muzzleFlash(pos, dir, color, size, owner) {
    const cell = STAR + Math.floor(Math.random() * 3);
    this.sparks.spawn(pos.x, pos.y, pos.z, 0, 0, 0, color, size, 0.07, { cell, owner, minPx: 14, grow: 1.2 });
    _t.copy(dir).multiplyScalar(size * 2.2);
    this.sparks.spawn(pos.x + _t.x * 0.5, pos.y + _t.y * 0.5, pos.z + _t.z * 0.5, 0, 0, 0, color, size * 0.13, 0.07, {
      cell: STREAK,
      owner,
      minPx: 3,
      axis: _t,
    });
  }

  // A shield breaking: a golden ring blooming out and a burst of shards (the body's shell flares
  // and pops with it, character.js).
  shieldPop(pos) {
    this.sparks.spawn(pos.x, pos.y, pos.z, 0, 0, 0, SHIELD_GOLD, 0.2, 0.25, { cell: RING, grow: 7, minPx: 10 });
    for (let i = 0; i < 14; i++) {
      randomInHemisphere(UP, _t);
      _t.y -= 0.6;
      const s = 3 + Math.random() * 3;
      this.sparks.spawn(pos.x, pos.y, pos.z, _t.x * s, _t.y * s + 1.5, _t.z * s, SHIELD_GOLD, 0.09, 0.35 + Math.random() * 0.15, {
        cell: SHARD,
        gravity: 9,
        drag: 1,
        rotVel: (Math.random() - 0.5) * 20,
        minPx: 2,
      });
    }
  }

  // A bullet hitting the world: sparks off metal, dust and chips off dirt and concrete,
  // splinters off wood, splats in mud. surface: game.castShot's (materials.js).
  impactWorld(point, normal, surface = null) {
    const h = HITS[surface] ?? HITS.other;
    if (h.sparks) this.burst(point, normal, h.spark, h.sparks, surface === 'metal' ? 8 : 6, 0.07);
    if (h.chips) this.debris(point, normal, h.chip, h.chips, CHIP, 0.045, 3.5);
    if (h.splinters) this.debris(point, normal, h.chip, h.splinters, SPLINTER, 0.1, 4);
    if (h.splats) this.debris(point, normal, h.chip, h.splats, SPLAT, 0.07, 2.5);
    if (h.dust) {
      this.smoke.spawn(
        point.x + normal.x * 0.05,
        point.y + normal.y * 0.05,
        point.z + normal.z * 0.05,
        normal.x * 0.6,
        normal.y * 0.6 + 0.2,
        normal.z * 0.6,
        h.dust,
        h.dustSize ?? 0.18,
        0.45,
        { grow: 3, drag: 3, alpha: 0.55, rotVel: 1, cell: PUFF + Math.floor(Math.random() * 4) },
      );
    }
  }

  // Solid bits thrown out of a surface around its normal, falling and tumbling.
  debris(point, normal, color, count, cell, size, speed) {
    for (let i = 0; i < count; i++) {
      randomInHemisphere(normal, _t);
      const s = speed * (0.5 + Math.random() * 0.8);
      this.smoke.spawn(
        point.x + normal.x * 0.04,
        point.y + normal.y * 0.04,
        point.z + normal.z * 0.04,
        _t.x * s,
        _t.y * s + 1,
        _t.z * s,
        color,
        size * (0.7 + Math.random() * 0.6),
        0.45 + Math.random() * 0.3,
        { cell, gravity: 12, drag: 1, rotVel: (Math.random() - 0.5) * 16 },
      );
    }
  }

  // Whether marks and scorches go on this surface (and there's room for any).
  marksOn(surface) {
    return this.smoke.decals > 0 && !!HITS[surface]?.mark;
  }

  // A bullet mark where a shot hit the world (none on mud, nets and ropes).
  mark(point, normal, surface) {
    const h = HITS[surface];
    if (!h?.mark) return;
    this.smoke.decal(point, normal, 0x000000, 0.08 + Math.random() * 0.03, MARK_LIFE, MARK_FADE, { cell: HOLE, alpha: h.mark });
  }

  impactBody(point, normal, shield) {
    this.burst(point, normal, shield ? 0x7ff0ff : 0xff4a2a, 5, 5, 0.09, 3);
  }

  // A glowing ember drifting off something hot (Chimney coals in flight).
  ember(p) {
    this.sparks.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 0xff8a2a, 0.06, 0.35);
  }

  // The "you got smoked" puff: rising grey smoke with a few embers. color (the victim's armor)
  // tints some of the smoke and embers and adds a white flash, so you can tell from across the
  // map who went down.
  deathPuff(x, y, z, color = null) {
    if (color !== null) this.sparks.spawn(x, y + 0.9, z, 0, 0, 0, 0xffffff, 1.2, 0.18, { cell: STAR, minPx: 16, grow: 1.3 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.35;
      const h = Math.random() * 1.6;
      this.smoke.spawn(
        x + Math.cos(a) * r,
        y + h,
        z + Math.sin(a) * r,
        Math.cos(a) * (0.6 + Math.random()),
        0.8 + Math.random() * 1.2,
        Math.sin(a) * (0.6 + Math.random()),
        color !== null && i % 4 === 1 ? color : i % 4 === 0 ? 0x6e6a66 : 0x9c9894,
        0.6 + Math.random() * 0.4,
        1.2 + Math.random() * 0.8,
        { grow: 2.6, drag: 1.2, alpha: 0.85, rotVel: (Math.random() - 0.5) * 2, cell: PUFF + (i % 4) },
      );
    }
    _b.set(0, 1, 0);
    for (let i = 0; i < 10; i++) {
      randomInHemisphere(_b, _t);
      this.sparks.spawn(x, y + 0.9, z, _t.x * 4, _t.y * 5, _t.z * 4, color !== null && i < 4 ? color : 0xff7a1a, 0.1, 0.6 + Math.random() * 0.4, {
        gravity: 6,
        drag: 1,
        minPx: 2,
      });
    }
  }

  // A blast, scaled to its radius: one white frame, rolling fire that cools from white-hot
  // through orange and red, a shock ring out to the real damage radius (so you learn how close
  // is too close), ember streaks, smoke and a scorch. opts (from explode()):
  // - tint: the ring and embers, per explosive
  // - ring: the floor ({ point, normal }) the ring lies flat on, or null to face the camera
  // - scorch, scorchWidth: the surface to scorch and the scorch's width there (0 for none)
  // - wall, push: against a wall, the way fire and smoke billow (out from it instead of up into
  //   it) and how far to move them off it
  explosion(pos, radius, { tint = 0xffb050, ring = null, scorch = null, scorchWidth = 0, wall = null, push = 0 } = {}) {
    const r = radius / 5;
    const k = this.fxScale;
    const axis = wall ?? UP;
    _o.copy(pos);
    if (wall) _o.addScaledVector(wall, push);
    this.sparks.spawn(_o.x, _o.y, _o.z, 0, 0, 0, 0xffffff, radius * 1.2, 0.06, { cell: STAR + 1, minPx: 16 });
    const billows = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < billows; i++) {
      randomInHemisphere(axis, _t);
      this.sparks.spawn(
        _o.x + _t.x * 0.5 * r,
        _o.y + _t.y * 0.4 * r,
        _o.z + _t.z * 0.5 * r,
        _t.x * 2.5 * r,
        _t.y * 2.5 * r + 1,
        _t.z * 2.5 * r,
        0xffffff,
        (2.2 + Math.random() * 1.2) * r,
        0.45 + Math.random() * 0.15,
        { cell: FIRE + (i % 4), ramp: true, grow: 1.7, drag: 3, rotVel: (Math.random() - 0.5) * 2 },
      );
    }
    // The ring cell's bright line sits at 0.84 of its half width.
    const ringSize = (radius * 2) / 0.84;
    if (ring) {
      const p = ring.point;
      const n = ring.normal;
      this.sparks.spawn(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, 0, 0, 0, tint, 0.6, 0.35, {
        cell: RING,
        flat: n,
        grow: ringSize / 0.6,
        ease: true,
        minPx: 12,
      });
    } else {
      // (At its true size even up close: it shows the real radius.)
      this.sparks.spawn(pos.x, pos.y, pos.z, 0, 0, 0, tint, 0.6, 0.3, { cell: RING, grow: ringSize / 0.6, ease: true, minPx: 12, trueSize: true });
    }
    const embers = Math.round((20 + Math.random() * 8) * k);
    for (let i = 0; i < embers; i++) {
      randomInHemisphere(axis, _t);
      const s = (8 + Math.random() * 10) * r;
      _b.copy(_t).multiplyScalar(0.35 * r);
      this.sparks.spawn(_o.x, _o.y + 0.1, _o.z, _t.x * s, _t.y * s, _t.z * s, tint, 0.05, 0.4 + Math.random() * 0.4, {
        gravity: 9,
        drag: 1.5,
        axis: _b,
        minPx: 2,
      });
    }
    const puffs = Math.round((8 + Math.random() * 4) * k);
    for (let i = 0; i < puffs; i++) {
      randomInHemisphere(axis, _t);
      const s = (1.5 + Math.random() * 2.5) * r;
      this.smoke.spawn(_o.x + _t.x * r, _o.y + _t.y * r * 0.6, _o.z + _t.z * r, _t.x * s, _t.y * s + 0.8, _t.z * s,
        i % 3 === 0 ? 0x2e2a28 : i % 3 === 1 ? 0x4a4440 : 0x6e6862, (1.2 + Math.random()) * r, 1.4 + Math.random() * 0.9, {
          cell: PUFF + (i % 4),
          grow: 2.4,
          drag: 1.6,
          alpha: 0.85,
          rotVel: (Math.random() - 0.5) * 1.5,
        });
    }
    if (scorch && scorchWidth > 0) {
      this.smoke.decal(scorch.point, scorch.normal, 0x000000, scorchWidth, SCORCH_LIFE, MARK_FADE, { cell: SCORCH, alpha: 0.85 });
    }
  }

  // Fire troughs: a glowing ember drifting up out of the flames, and a thin wisp of smoke.
  fireEmber(x, y, z) {
    this.sparks.spawn(x, y, z, (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4, 0xff8a2a,
      0.04 + Math.random() * 0.03, 1.2 + Math.random() * 0.6, { drag: 0.3, minPx: 1.5 });
  }

  fireWisp(x, y, z) {
    this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 0.2, 0.7 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2, 0x3a3634,
      0.35, 2 + Math.random() * 0.6, { grow: 3, drag: 0.4, alpha: 0.3, rotVel: (Math.random() - 0.5), cell: PUFF + Math.floor(Math.random() * 4) });
  }

  update(dt) {
    this.tracerPool.update(dt);
    this.beamPool?.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  // Ends every effect at once (after warm-up).
  clear() {
    this.tracerPool.clear();
    this.beamPool?.clear();
    this.sparks.update(1e3);
    this.smoke.update(1e3);
  }

  dispose() {
    this.tracerPool.dispose();
    this.beamPool?.dispose();
    this.sparks.dispose();
    this.smoke.dispose();
  }
}

function randomInHemisphere(n, out) {
  do {
    out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  } while (out.lengthSq() > 1 || out.lengthSq() < 0.01);
  out.normalize();
  if (out.dot(n) < 0) out.negate();
  out.addScaledVector(n, 0.6).normalize();
  return out;
}
