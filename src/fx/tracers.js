import * as THREE from 'three';
import { viewUniforms } from './viewUniforms.js';

// Pooled bullet tracers and beams, all in one mesh (one draw call). Each is a ribbon built in
// the vertex shader, facing the camera and never thinner than MIN_PX pixels, so a shot reads at
// any range in a quarter view. A bullet tracer races from the gun to the hit point as a bright
// head with a fading tail, then leaves a faint full-length line for a moment. It starts at the
// shooter's first-person barrel in their own view and at their third-person gun in everyone
// else's. Beams (no travel) just fade, tapering toward the gun.

// How fast the head travels (m/s), the length of the bright streak behind it (m), and how long
// the faint full-length line stays once it lands (s).
const SPEED = 700;
const STREAK = 9;
const RESIDUAL = 0.08;
const RESIDUAL_ALPHA = 0.45;
const MIN_PX = 1.6;
// Default owner: nobody's (never equal to a viewer id or -1). An owner of 1000 + a viewer id
// shows only in that viewer's view, from its first end (the death replay's tracers).
const NO_OWNER = -2;

const vertexShader = /* glsl */ `
  uniform float uViewer;
  uniform float uViewportH;
  uniform float uMinPx;
  // position is the far end (b).
  attribute vec3 aA;
  attribute vec3 aA3;
  // x: 0 at the tail end, 1 at the head end. y: which side of the ribbon.
  attribute vec2 aCorner;
  attribute vec3 aColor;
  // Half widths (m) at a and at b.
  attribute vec2 aWidth;
  attribute float aOwner;
  // Tail and head along a to b (0 to 1), and alpha.
  attribute vec3 aSpan;
  varying vec4 vColor;
  varying float vSide;
  void main() {
    bool only = aOwner >= 999.5;
    if (only && abs(aOwner - 1000.0 - uViewer) > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    bool mine = only || aOwner == uViewer;
    vec3 a = mine ? aA : aA3;
    vec3 pa = (viewMatrix * vec4(a, 1.0)).xyz;
    vec3 pb = (viewMatrix * vec4(position, 1.0)).xyz;
    float t = mix(aSpan.x, aSpan.y, aCorner.x);
    vec3 p = mix(pa, pb, t);
    vec3 d = pb - pa;
    vec3 side = cross(d / max(length(d), 1e-6), p / max(length(p), 1e-6));
    float sl = length(side);
    // Looking straight down the line: any sideways direction will do.
    side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
    float w = max(mix(aWidth.x, aWidth.y, t), uMinPx * max(-p.z, 0.0) / (projectionMatrix[1][1] * uViewportH));
    p += side * w * aCorner.y;
    gl_Position = projectionMatrix * vec4(p, 1.0);
    // Dim at the tail, bright at the head. In the shooter's own view it fades out over the
    // first couple of meters (scoped, with no gun in view, the near end would be a wide wedge).
    float nearFade = mine ? smoothstep(0.5, 2.0, -p.z) : 1.0;
    vColor = vec4(aColor * mix(0.3, 1.0, aCorner.x), aSpan.z * nearFade);
    vSide = aCorner.y;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec4 vColor;
  varying float vSide;
  void main() {
    float a = vColor.a * (1.0 - 0.5 * vSide * vSide);
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    // Colors are linear: encode them for the sRGB screen like the built-in materials do.
    #include <colorspace_fragment>
  }
`;

const _c = new THREE.Color();

export class Tracers {
  constructor(max = 64) {
    this.max = max;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ live: false, age: 0, len: 1, travel: true, life: 0, linger: RESIDUAL, landed: false });
    }
    this.next = 0;
    const n = max * 4;
    const geom = new THREE.BufferGeometry();
    const attr = (name, size) => {
      const a = new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute(name, a);
      return a;
    };
    this.aA = attr('aA', 3);
    this.aA3 = attr('aA3', 3);
    this.aB = attr('position', 3);
    this.aColor = attr('aColor', 3);
    this.aWidth = attr('aWidth', 2);
    this.aOwner = attr('aOwner', 1);
    this.aSpan = attr('aSpan', 3);
    // Corners: tail left, tail right, head left, head right.
    const corner = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < max; i++) {
      corner.set([0, -1, 0, 1, 1, -1, 1, 1], i * 8);
      const v = i * 4;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    geom.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geom.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      name: 'tracers',
      uniforms: { ...viewUniforms, uMinPx: { value: MIN_PX } },
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.name = 'tracers';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    // Hidden (no draw call) while no tracer is live.
    this.mesh.visible = false;
    this.live = 0;
  }

  // opts:
  // - a3: where it starts in other players' views (the shooter's third-person gun); defaults to a
  // - owner: the shooter's id (their view uses a)
  // - startWidth: width at a (defaults to width); beams taper toward the gun
  // - life: 0 for a bullet tracer (it travels); otherwise it just fades over life seconds
  // - linger: how long a bullet tracer's faint line stays once it lands (s)
  spawn(a, b, color, width = 0.022, opts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const t = this.items[i];
    const { a3 = a, owner = NO_OWNER, startWidth = width, life = 0, linger = RESIDUAL } = opts;
    t.live = true;
    t.age = 0;
    t.landed = false;
    t.len = Math.max(0.01, a3.distanceTo(b));
    t.travel = life <= 0;
    t.life = life;
    t.linger = Math.max(RESIDUAL, linger);
    _c.set(color);
    const o3 = i * 12;
    const o2 = i * 8;
    for (let v = 0; v < 4; v++) {
      a.toArray(this.aA.array, o3 + v * 3);
      a3.toArray(this.aA3.array, o3 + v * 3);
      b.toArray(this.aB.array, o3 + v * 3);
      _c.toArray(this.aColor.array, o3 + v * 3);
      this.aWidth.array[o2 + v * 2] = startWidth;
      this.aWidth.array[o2 + v * 2 + 1] = width;
      this.aOwner.array[i * 4 + v] = owner;
    }
    for (const at of [this.aA, this.aA3, this.aB, this.aColor]) at.addUpdateRange(o3, 12);
    this.aWidth.addUpdateRange(o2, 8);
    this.aOwner.addUpdateRange(i * 4, 4);
    for (const at of [this.aA, this.aA3, this.aB, this.aColor, this.aWidth, this.aOwner]) at.needsUpdate = true;
    this.live++;
  }

  update(dt) {
    if (this.live === 0) return;
    const S = this.aSpan.array;
    let lo = this.max;
    let hi = -1;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      const t = this.items[i];
      if (!t.live) continue;
      t.age += dt;
      let tail = 0;
      let head = 1;
      let alpha;
      if (t.travel) {
        let run = t.age * SPEED;
        // The first frame the head reaches the end it's drawn there at full brightness (so a
        // shot shorter than one frame's travel still shows its bright streak), and the faint
        // line counts from then.
        if (run >= t.len && !t.landed) {
          t.landed = true;
          run = t.len;
          t.age = t.len / SPEED;
          head = 1;
          tail = Math.max(0, (run - STREAK) / t.len);
          alpha = 1;
        } else if (run < t.len) {
          head = run / t.len;
          tail = Math.max(0, (run - STREAK) / t.len);
          alpha = 1;
        } else {
          const r = (t.age - t.len / SPEED) / t.linger;
          alpha = r < 1 ? RESIDUAL_ALPHA * (1 - r) : 0;
        }
      } else {
        alpha = Math.max(0, 1 - t.age / t.life);
      }
      if (alpha <= 0) t.live = false;
      else live++;
      for (let v = 0; v < 4; v++) {
        S[i * 12 + v * 3] = tail;
        S[i * 12 + v * 3 + 1] = head;
        S[i * 12 + v * 3 + 2] = alpha;
      }
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
    }
    if (hi >= 0) {
      this.aSpan.addUpdateRange(lo * 12, (hi - lo + 1) * 12);
      this.aSpan.needsUpdate = true;
    }
    this.live = live;
    this.mesh.visible = live > 0;
    // Only draw up to the highest live tracer.
    let top = -1;
    for (let i = this.max - 1; i >= 0 && top < 0; i--) if (this.items[i].live) top = i;
    this.mesh.geometry.setDrawRange(0, (top + 1) * 6);
  }

  // Ends every tracer at once (after warm-up).
  clear() {
    for (const t of this.items) t.live = false;
    // (An explicit range: a later partial update in the same frame would otherwise replace a
    // whole-buffer upload.)
    this.aSpan.array.fill(0);
    this.aSpan.addUpdateRange(0, this.aSpan.array.length);
    this.aSpan.needsUpdate = true;
    this.live = 0;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
