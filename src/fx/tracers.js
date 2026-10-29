import * as THREE from 'three';

// Pooled bullet tracers, all in one mesh (one draw call). Each tracer is two crossed quads
// so it reads from any angle in any split-screen view. Additive, faded by vertex color.

const _d = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

export class Tracers {
  constructor(max = 64) {
    this.max = max;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), color: new THREE.Color(), life: 0, maxLife: 1, width: 0.02, startWidth: 0.02 });
    }
    this.next = 0;
    const geom = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 8 * 3);
    this.col = new Float32Array(max * 8 * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < max; i++) {
      const v = i * 8;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2, v + 4, v + 5, v + 6, v + 5, v + 7, v + 6);
    }
    geom.setIndex(idx);
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.material.name = 'tracers';
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.name = 'tracers';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    // Hidden (no draw call) while no tracer is live.
    this.mesh.visible = false;
    this.dirty = false;
  }

  // startWidth (at `a`, the gun end) defaults to width; beams taper so they don't fill the
  // shooter's own view right in front of the camera.
  spawn(a, b, color, width = 0.022, life = 0.08, startWidth = width) {
    const t = this.items[this.next];
    this.next = (this.next + 1) % this.max;
    t.a.copy(a);
    t.b.copy(b);
    t.color.set(color);
    t.life = life;
    t.maxLife = life;
    t.width = width;
    t.startWidth = startWidth;
    this.dirty = true;
  }

  update(dt) {
    if (!this.dirty) return;
    let any = false;
    const P = this.pos;
    const C = this.col;
    for (let i = 0; i < this.max; i++) {
      const t = this.items[i];
      const o = i * 24;
      if (t.life <= 0) {
        if (t.maxLife > 0) {
          P.fill(0, o, o + 24);
          C.fill(0, o, o + 24);
          t.maxLife = 0;
        }
        continue;
      }
      any = true;
      t.life -= dt;
      const k = Math.max(0, t.life / t.maxLife);
      _d.subVectors(t.b, t.a).normalize();
      _p1.crossVectors(_d, Math.abs(_d.y) > 0.95 ? X : UP).normalize();
      _p2.crossVectors(_d, _p1).normalize();
      const wa = t.startWidth;
      const wb = t.width;
      for (let q = 0; q < 2; q++) {
        const p = q === 0 ? _p1 : _p2;
        const base = o + q * 12;
        P[base] = t.a.x - p.x * wa; P[base + 1] = t.a.y - p.y * wa; P[base + 2] = t.a.z - p.z * wa;
        P[base + 3] = t.a.x + p.x * wa; P[base + 4] = t.a.y + p.y * wa; P[base + 5] = t.a.z + p.z * wa;
        P[base + 6] = t.b.x - p.x * wb; P[base + 7] = t.b.y - p.y * wb; P[base + 8] = t.b.z - p.z * wb;
        P[base + 9] = t.b.x + p.x * wb; P[base + 10] = t.b.y + p.y * wb; P[base + 11] = t.b.z + p.z * wb;
      }
      // Dim at the gun end, bright at the far end.
      for (let v = 0; v < 8; v++) {
        const far = v % 4 >= 2;
        _c.copy(t.color).multiplyScalar(k * (far ? 1 : 0.25));
        C[o + v * 3] = _c.r;
        C[o + v * 3 + 1] = _c.g;
        C[o + v * 3 + 2] = _c.b;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.dirty = any;
    this.mesh.visible = any;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
