import * as THREE from 'three';

// Pooled camera-facing particles drawn as one instanced mesh (one draw call per system).
// Instanced quads instead of GL points: point sprites are emulated on Edge/ANGLE and capped
// in size, quads behave the same everywhere.

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor;
  attribute vec2 iSizeRot;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iSizeRot.y);
    float s = sin(iSizeRot.y);
    vec2 corner = position.xy;
    corner = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
    mv.xy += corner * iSizeRot.x;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vColor.a;
    if (a < 0.003) discard;
  #ifdef ADDITIVE
    gl_FragColor = vec4(vColor.rgb * t.rgb * a, a);
  #else
    gl_FragColor = vec4(vColor.rgb * t.rgb, a);
  #endif
  }
`;

const _c = new THREE.Color();

export class Particles {
  constructor({ max = 256, texture, additive = true, name = 'particles' }) {
    this.max = max;
    this.next = 0;
    this.active = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotVel = new Float32Array(max);
    this.rgb = new Float32Array(max * 3);

    const base = new THREE.PlaneGeometry(1, 1);
    const geom = new THREE.InstancedBufferGeometry();
    geom.index = base.index;
    geom.setAttribute('position', base.attributes.position);
    geom.setAttribute('uv', base.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('iPos', this.iPos);
    geom.setAttribute('iColor', this.iColor);
    geom.setAttribute('iSizeRot', this.iSizeRot);
    geom.instanceCount = max;

    this.material = new THREE.ShaderMaterial({
      name,
      uniforms: { uMap: { value: texture } },
      vertexShader,
      fragmentShader,
      defines: additive ? { ADDITIVE: 1 } : {},
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 7 : 4;
    // Nothing to draw until something spawns.
    this.mesh.visible = false;
  }

  // opts: grow (end size multiplier), drag (per second), gravity, alpha, rotVel
  spawn(x, y, z, vx, vy, vz, color, size, life, opts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const i3 = i * 3;
    this.p[i3] = x;
    this.p[i3 + 1] = y;
    this.p[i3 + 2] = z;
    this.v[i3] = vx;
    this.v[i3 + 1] = vy;
    this.v[i3 + 2] = vz;
    _c.set(color);
    this.rgb[i3] = _c.r;
    this.rgb[i3 + 1] = _c.g;
    this.rgb[i3 + 2] = _c.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size1[i] = size * (opts.grow ?? 1);
    this.alpha0[i] = opts.alpha ?? 1;
    this.drag[i] = opts.drag ?? 0;
    this.grav[i] = opts.gravity ?? 0;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.rotVel[i] = opts.rotVel ?? 0;
    this.active = this.max;
  }

  // Ages every particle. While none is alive the mesh is hidden (no draw call), and it only
  // draws up to the highest live slot.
  update(dt) {
    if (this.active === 0) return;
    let alive = 0;
    let top = -1;
    const P = this.iPos.array;
    const C = this.iColor.array;
    const S = this.iSizeRot.array;
    for (let i = 0; i < this.max; i++) {
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        if (S[i * 2] !== 0) S[i * 2] = 0;
        continue;
      }
      alive++;
      top = i;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= drag;
      this.v[i3 + 1] = this.v[i3 + 1] * drag - this.grav[i] * dt;
      this.v[i3 + 2] *= drag;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i] += this.rotVel[i] * dt;
      P[i3] = this.p[i3];
      P[i3 + 1] = this.p[i3 + 1];
      P[i3 + 2] = this.p[i3 + 2];
      C[i * 4] = this.rgb[i3];
      C[i * 4 + 1] = this.rgb[i3 + 1];
      C[i * 4 + 2] = this.rgb[i3 + 2];
      C[i * 4 + 3] = this.alpha0[i] * (1 - t) * Math.min(1, t * 12 + 0.4);
      S[i * 2] = this.life[i] > 0 ? this.size0[i] + (this.size1[i] - this.size0[i]) * t : 0;
      S[i * 2 + 1] = this.rot[i];
    }
    this.iPos.needsUpdate = true;
    this.iColor.needsUpdate = true;
    this.iSizeRot.needsUpdate = true;
    this.active = alive;
    this.mesh.visible = alive > 0;
    this.mesh.geometry.instanceCount = top + 1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
