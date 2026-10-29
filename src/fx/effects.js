import * as THREE from 'three';
import { Tracers } from './tracers.js';
import { Particles } from './particles.js';

// All pooled world effects. Everything is created at load and stays in the scene, so the
// shaders are compiled during warm-up and nothing new appears mid-match.

const _t = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Effects {
  constructor(scene, textures) {
    this.tracerPool = new Tracers(64);
    this.sparks = new Particles({ max: 256, texture: textures.spark, additive: true, name: 'sparks' });
    this.smoke = new Particles({ max: 160, texture: textures.smoke, additive: false, name: 'smoke' });
    scene.add(this.tracerPool.mesh, this.sparks.mesh, this.smoke.mesh);
  }

  tracer(a, b, color) {
    this.tracerPool.spawn(a, b, color);
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
