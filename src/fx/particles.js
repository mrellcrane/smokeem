import * as THREE from 'three';
import { viewUniforms } from './viewUniforms.js';

// Pooled camera-facing particles drawn as one instanced mesh (one draw call per system).
// Instanced quads instead of GL points: point sprites are emulated on Edge/ANGLE and capped
// in size, quads behave the same everywhere.
// Each particle picks a cell of the system's 4 x 4 atlas (textures.js). It never shrinks below
// its minPx on screen (so a far firefight stays visible in a quarter view) and never grows past
// 60% of the view's height. A particle with an owner is hidden in that player's own view, and
// one with an axis is stretched along it (streaks). Smoke (NEAR_FADE) fades out right in front
// of the camera instead of filling the screen.

const vertexShader = /* glsl */ `
  uniform float uViewer;
  uniform float uViewportH;
  attribute vec3 iPos;
  attribute vec4 iColor;
  attribute vec2 iSizeRot;
  // cell, owner, minimum size in pixels, stretched (1) or not (0)
  attribute vec4 iExtra;
  attribute vec3 iAxis;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec2 cell = vec2(mod(iExtra.x, 4.0), 3.0 - floor(iExtra.x / 4.0));
    vUv = (uv * 0.9375 + 0.03125 + cell) * 0.25;
    vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float z = max(-mv.z, 0.01);
    float py = projectionMatrix[1][1];
    float s = max(iSizeRot.x, iExtra.z * 2.0 * z / (py * uViewportH));
    s = min(s, 1.2 * z / py);
    if (iExtra.y == uViewer || iSizeRot.x == 0.0) s = 0.0;
    vec2 corner = position.xy;
    if (iExtra.w > 0.5) {
      // Along the axis as seen on screen, as long as its foreshortened length.
      vec3 ax = (modelViewMatrix * vec4(iAxis, 0.0)).xyz;
      float sl = length(ax.xy);
      vec2 d = sl > 1e-5 ? ax.xy / sl : vec2(1.0, 0.0);
      float len = s > 0.0 ? max(sl, s) : 0.0;
      mv.xy += d * corner.x * len + vec2(-d.y, d.x) * corner.y * s;
    } else {
      float c = cos(iSizeRot.y);
      float sn = sin(iSizeRot.y);
      corner = vec2(corner.x * c - corner.y * sn, corner.x * sn + corner.y * c);
      mv.xy += corner * s;
    }
    gl_Position = projectionMatrix * mv;
  #ifdef NEAR_FADE
    vColor.a *= smoothstep(0.35, 1.6, z);
  #endif
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
// Default owner: nobody's (never equal to a viewer id or -1).
const NO_OWNER = -2;

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
    // Written at spawn only.
    this.iExtra = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iAxis = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('iPos', this.iPos);
    geom.setAttribute('iColor', this.iColor);
    geom.setAttribute('iSizeRot', this.iSizeRot);
    geom.setAttribute('iExtra', this.iExtra);
    geom.setAttribute('iAxis', this.iAxis);
    geom.instanceCount = max;

    this.material = new THREE.ShaderMaterial({
      name,
      uniforms: { uMap: { value: texture }, ...viewUniforms },
      vertexShader,
      fragmentShader,
      defines: additive ? { ADDITIVE: 1 } : { NEAR_FADE: 1 },
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

  // opts: grow (end size multiplier), drag (per second), gravity, alpha, rotVel, cell (atlas
  // cell, 0), owner (hidden in this player's view), minPx (smallest on-screen size), axis (a
  // Vector3: stretch the particle along it, its length in meters)
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
    const E = this.iExtra.array;
    E[i * 4] = opts.cell ?? 0;
    E[i * 4 + 1] = opts.owner ?? NO_OWNER;
    E[i * 4 + 2] = opts.minPx ?? 0;
    E[i * 4 + 3] = opts.axis ? 1 : 0;
    if (opts.axis) opts.axis.toArray(this.iAxis.array, i3);
    this.iExtra.addUpdateRange(i * 4, 4);
    this.iExtra.needsUpdate = true;
    if (opts.axis) {
      this.iAxis.addUpdateRange(i3, 3);
      this.iAxis.needsUpdate = true;
    }
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
