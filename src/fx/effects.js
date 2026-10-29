import * as THREE from 'three';
import { Tracers } from './tracers.js';
import { Particles } from './particles.js';

// All pooled world effects. Everything is created at load and stays in the scene, so the
// shaders are compiled during warm-up and nothing new appears mid-match.

const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(scene, textures) {
    this.tracerPool = new Tracers(64);
    this.sparks = new Particles({ max: 400, texture: textures.spark, additive: true, name: 'sparks' });
    this.smoke = new Particles({ max: 260, texture: textures.smoke, additive: false, name: 'smoke' });
    scene.add(this.tracerPool.mesh, this.sparks.mesh, this.smoke.mesh);
  }

  tracer(a, b, color, width, life) {
    this.tracerPool.spawn(a, b, color, width, life);
  }

  // Sparks thrown out of a surface around its normal.
  burst(point, normal, color, count, speed, size) {
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
        { gravity: 9, drag: 2, grow: 0.4 },
      );
    }
  }

  impactWorld(point, normal) {
    this.burst(point, normal, 0xffb060, 6, 6, 0.07);
    this.smoke.spawn(
      point.x + normal.x * 0.05,
      point.y + normal.y * 0.05,
      point.z + normal.z * 0.05,
      normal.x * 0.6,
      normal.y * 0.6 + 0.2,
      normal.z * 0.6,
      0xb89a80,
      0.18,
      0.45,
      { grow: 3, drag: 3, alpha: 0.55, rotVel: 1 },
    );
  }

  impactBody(point, normal, shield) {
    this.burst(point, normal, shield ? 0x7ff0ff : 0xff4a2a, 5, 5, 0.09);
  }

  // A glowing ember drifting off something hot (Chimney coals in flight).
  ember(p) {
    this.sparks.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 0xff8a2a, 0.06, 0.35);
  }

  // The "you got smoked" puff: rising grey smoke with a few embers.
  deathPuff(x, y, z) {
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
        i % 4 === 0 ? 0x6e6a66 : 0x9c9894,
        0.6 + Math.random() * 0.4,
        1.2 + Math.random() * 0.8,
        { grow: 2.6, drag: 1.2, alpha: 0.85, rotVel: (Math.random() - 0.5) * 2 },
      );
    }
    _b.set(0, 1, 0);
    for (let i = 0; i < 10; i++) {
      randomInHemisphere(_b, _t);
      this.sparks.spawn(x, y + 0.9, z, _t.x * 4, _t.y * 5, _t.z * 4, 0xff7a1a, 0.1, 0.6 + Math.random() * 0.4, {
        gravity: 6,
        drag: 1,
      });
    }
  }

  // Fireball, shock of sparks and a rolling smoke cloud, scaled to the blast radius.
  explosion(pos, radius) {
    const r = radius / 5;
    for (let i = 0; i < 7; i++) {
      randomInHemisphere(UP, _t);
      this.sparks.spawn(pos.x + _t.x * 0.4, pos.y + _t.y * 0.4, pos.z + _t.z * 0.4, _t.x * 3 * r, _t.y * 3 * r, _t.z * 3 * r,
        i < 3 ? 0xfff0c0 : 0xff8a2a, (2.2 + Math.random() * 1.6) * r, 0.28 + Math.random() * 0.12, { grow: 1.6, drag: 3 });
    }
    for (let i = 0; i < 28; i++) {
      randomInHemisphere(UP, _t);
      const s = (8 + Math.random() * 10) * r;
      this.sparks.spawn(pos.x, pos.y + 0.1, pos.z, _t.x * s, _t.y * s, _t.z * s, 0xffb050, 0.12, 0.35 + Math.random() * 0.4, {
        gravity: 9,
        drag: 1.5,
        grow: 0.5,
      });
    }
    for (let i = 0; i < 14; i++) {
      randomInHemisphere(UP, _t);
      const s = (1.5 + Math.random() * 2.5) * r;
      this.smoke.spawn(pos.x + _t.x * r, pos.y + _t.y * r * 0.6, pos.z + _t.z * r, _t.x * s, _t.y * s + 0.8, _t.z * s,
        i % 3 === 0 ? 0x4a4440 : 0x7a7470, (1.2 + Math.random()) * r, 1.4 + Math.random() * 0.9, {
          grow: 2.4,
          drag: 1.6,
          alpha: 0.85,
          rotVel: (Math.random() - 0.5) * 1.5,
        });
    }
  }

  update(dt) {
    this.tracerPool.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  dispose() {
    this.tracerPool.dispose();
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
