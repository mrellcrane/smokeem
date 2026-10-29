import * as THREE from 'three';
import { viewUniforms } from './viewUniforms.js';

// Pooled particles drawn as one instanced mesh (one draw call per system).
// Instanced quads instead of GL points: point sprites are emulated on Edge/ANGLE and capped
// in size, quads behave the same everywhere.
// Each particle picks a cell of the system's 4 x 4 atlas (textures.js) and is drawn one of three
// ways (iExtra.w):
// - 0 facing the camera. It never shrinks below its minPx on screen (so a far firefight stays
//   visible in a quarter view) and never grows past 60% of the view's height.
// - 1 stretched along an axis as seen on screen (streaks), with the same limits.
// - 2 flat in the plane across a world normal (shock rings on the ground, marks on walls),
//   pulled a hair toward the camera so it never fights the surface it lies on.
// A particle with an owner is hidden in that player's own view. Smoke (NEAR_FADE) fades out
// right in front of the camera instead of filling the screen.
// A system can keep marks (decals) in reserved slots at the front of its pool: they stay put for
// a long life and fade out at the end, and the per-frame loop does nothing for them until then.

const vertexShader = /* glsl */ `
  uniform float uViewer;
  uniform float uViewportH;
  attribute vec3 iPos;
  attribute vec4 iColor;
  attribute vec2 iSizeRot;
  // cell, owner, minimum size in pixels, mode (0 facing, 1 stretched, 2 flat)
  attribute vec4 iExtra;
  // Stretch direction and length (mode 1) or the plane's normal (mode 2).
  attribute vec3 iAxis;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec2 cell = vec2(mod(iExtra.x, 4.0), 3.0 - floor(iExtra.x / 4.0));
    vUv = (uv * 0.9375 + 0.03125 + cell) * 0.25;
    vColor = iColor;
    float mode = iExtra.w;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float z = max(-mv.z, 0.01);
    float py = projectionMatrix[1][1];
    float s = max(iSizeRot.x, iExtra.z * 2.0 * z / (py * uViewportH));
    if (mode < 1.5) s = min(s, 1.2 * z / py);
    if (iExtra.y == uViewer || iSizeRot.x == 0.0) s = 0.0;
    vec2 corner = position.xy;
    float c = cos(iSizeRot.y);
    float sn = sin(iSizeRot.y);
    if (mode > 1.5) {
      vec3 n = iAxis;
      vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 b = cross(n, t);
      vec2 r = vec2(corner.x * c - corner.y * sn, corner.x * sn + corner.y * c) * s;
      mv = modelViewMatrix * vec4(iPos + t * r.x + b * r.y, 1.0);
      // Same spot on screen, a little nearer in depth.
      mv.xyz *= 0.998;
    } else if (mode > 0.5) {
      // Along the axis as seen on screen, as long as its foreshortened length.
      vec3 ax = (modelViewMatrix * vec4(iAxis, 0.0)).xyz;
      float sl = length(ax.xy);
      vec2 d = sl > 1e-5 ? ax.xy / sl : vec2(1.0, 0.0);
      float len = s > 0.0 ? max(sl, s) : 0.0;
      mv.xy += d * corner.x * len + vec2(-d.y, d.x) * corner.y * s;
    } else {
      corner = vec2(corner.x * c - corner.y * sn, corner.x * sn + corner.y * c);
      mv.xy += corner * s;
    }
    gl_Position = projectionMatrix * mv;
  #ifdef NEAR_FADE
    if (mode < 1.5) vColor.a *= smoothstep(0.35, 1.6, z);
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
const MODE_STRETCH = 1;
const MODE_FLAT = 2;
// Per-particle flags.
const RAMP = 1;
const EASE = 2;
const DECAL = 4;
// How far a mark sits off its surface (m).
const DECAL_LIFT = 0.015;

// Fire's colors over its life (display values): white-hot, orange, red, then nearly black, which
// in an additive system just fades it out.
const RAMP_KEYS = [
  [0, 1.0, 0.92, 0.6],
  [0.22, 1.0, 0.55, 0.12],
  [0.55, 0.8, 0.2, 0.03],
  [1, 0.15, 0.04, 0.01],
];

export class Particles {
  // decals: how many slots at the front of the pool are kept for marks (decal()).
  constructor({ max = 256, texture, additive = true, name = 'particles', decals = 0 }) {
    this.decals = decals;
    this.max = decals + max;
    this.next = decals;
    this.decalNext = 0;
    this.active = 0;
    const n = this.max;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    // Total life, or for marks how long the fade at the end takes.
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.rotVel = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.flags = new Uint8Array(n);

    const base = new THREE.PlaneGeometry(1, 1);
    const geom = new THREE.InstancedBufferGeometry();
    geom.index = base.index;
    geom.setAttribute('position', base.attributes.position);
    geom.setAttribute('uv', base.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    // Written at spawn only.
    this.iExtra = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iAxis = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('iPos', this.iPos);
    geom.setAttribute('iColor', this.iColor);
    geom.setAttribute('iSizeRot', this.iSizeRot);
    geom.setAttribute('iExtra', this.iExtra);
    geom.setAttribute('iAxis', this.iAxis);
    geom.instanceCount = n;

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

  // opts: grow (end size multiplier), ease (grow fast, then settle), drag (per second), gravity,
  // alpha, rotVel, cell (atlas cell, 0), owner (hidden in this player's view), minPx (smallest
  // on-screen size), axis (a Vector3: stretch the particle along it, its length in meters),
  // flat (a unit Vector3: lie flat across this normal instead of facing the camera), ramp (fire
  // colors over its life instead of color)
  spawn(x, y, z, vx, vy, vz, color, size, life, opts = {}) {
    const i = this.next;
    this.next = this.next + 1 < this.max ? this.next + 1 : this.decals;
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
    this.flags[i] = (opts.ramp ? RAMP : 0) | (opts.ease ? EASE : 0);
    const dir = opts.flat ?? opts.axis;
    this.writeExtra(i, opts.cell ?? 0, opts.owner ?? NO_OWNER, opts.minPx ?? 0, opts.flat ? MODE_FLAT : opts.axis ? MODE_STRETCH : 0, dir);
    this.active = this.max;
  }

  // A mark lying on a surface: point and normal (Vector3s), its width (m), how long it stays (s)
  // and how long it takes to fade out at the end. opts: cell, alpha. Nothing when the system
  // keeps no marks (the low preset).
  decal(point, normal, color, size, life, fade, opts = {}) {
    if (this.decals === 0) return;
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % this.decals;
    const i3 = i * 3;
    this.p[i3] = point.x + normal.x * DECAL_LIFT;
    this.p[i3 + 1] = point.y + normal.y * DECAL_LIFT;
    this.p[i3 + 2] = point.z + normal.z * DECAL_LIFT;
    this.life[i] = life;
    this.maxLife[i] = fade;
    this.alpha0[i] = opts.alpha ?? 1;
    this.flags[i] = DECAL;
    _c.set(color);
    const P = this.iPos.array;
    const C = this.iColor.array;
    const S = this.iSizeRot.array;
    P[i3] = this.p[i3];
    P[i3 + 1] = this.p[i3 + 1];
    P[i3 + 2] = this.p[i3 + 2];
    C[i * 4] = _c.r;
    C[i * 4 + 1] = _c.g;
    C[i * 4 + 2] = _c.b;
    C[i * 4 + 3] = this.alpha0[i];
    S[i * 2] = size;
    S[i * 2 + 1] = Math.random() * Math.PI * 2;
    this.writeExtra(i, opts.cell ?? 0, NO_OWNER, 0, MODE_FLAT, normal);
    this.active = this.max;
  }

  writeExtra(i, cell, owner, minPx, mode, dir) {
    const E = this.iExtra.array;
    E[i * 4] = cell;
    E[i * 4 + 1] = owner;
    E[i * 4 + 2] = minPx;
    E[i * 4 + 3] = mode;
    this.iExtra.addUpdateRange(i * 4, 4);
    this.iExtra.needsUpdate = true;
    if (dir) {
      dir.toArray(this.iAxis.array, i * 3);
      this.iAxis.addUpdateRange(i * 3, 3);
      this.iAxis.needsUpdate = true;
    }
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
      this.life[i] -= dt;
      const flags = this.flags[i];
      if (flags & DECAL) {
        // Marks stay put: only their fade at the end needs work.
        const left = this.life[i];
        if (left <= 0) {
          S[i * 2] = 0;
          continue;
        }
        alive++;
        top = i;
        if (left < this.maxLife[i]) C[i * 4 + 3] = (this.alpha0[i] * left) / this.maxLife[i];
        continue;
      }
      alive++;
      top = i;
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
      if (flags & RAMP) {
        let k = 1;
        while (k < RAMP_KEYS.length - 1 && RAMP_KEYS[k][0] < t) k++;
        const a = RAMP_KEYS[k - 1];
        const b = RAMP_KEYS[k];
        const f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
        C[i * 4] = a[1] + (b[1] - a[1]) * f;
        C[i * 4 + 1] = a[2] + (b[2] - a[2]) * f;
        C[i * 4 + 2] = a[3] + (b[3] - a[3]) * f;
      } else {
        C[i * 4] = this.rgb[i3];
        C[i * 4 + 1] = this.rgb[i3 + 1];
        C[i * 4 + 2] = this.rgb[i3 + 2];
      }
      C[i * 4 + 3] = this.alpha0[i] * (1 - t) * Math.min(1, t * 12 + 0.4);
      const g = flags & EASE ? 1 - (1 - t) * (1 - t) * (1 - t) : t;
      S[i * 2] = this.life[i] > 0 ? this.size0[i] + (this.size1[i] - this.size0[i]) * g : 0;
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
