import * as THREE from 'three';
import { viewUniforms } from './viewUniforms.js';
import { DISPLAY_OUT } from '../render/displayOut.js';

// Grapple lines (player/grapple.js), one per player, all in one mesh (one draw call; hidden
// while nobody's hook is out). Each is a ribbon of SEG segments built in the vertex shader like
// the tracers: facing the camera, never thinner than MIN_PX, starting low on the left of the
// owner's own view (aA, set per view by setView) and at the body's left hand in everyone
// else's (aA3). Flying out it trails slack and a wave; reeling it's pulled straight.

const SEG = 14;
const VERTS = (SEG + 1) * 2;
const WIDTH = 0.012;
const MIN_PX = 1.3;
// The first-person start, in camera space: low on the left, below the gun.
const FP_START = new THREE.Vector3(-0.3, -0.34, -0.55);
const NO_OWNER = -2;

const vertexShader = /* glsl */ `
  uniform float uViewer;
  uniform float uViewportH;
  attribute vec3 aA;
  attribute vec3 aA3;
  // x: 0 at the hand, 1 at the hook. y: which side of the ribbon.
  attribute vec2 aCorner;
  // x: owner id. y: slack (sag in m at the middle). z: wave height (m). w: wave phase.
  attribute vec4 aLine;
  varying float vT;
  varying float vSide;
  void main() {
    bool mine = aLine.x == uViewer;
    vec3 a = mine ? aA : aA3;
    float t = aCorner.x;
    vec3 w = mix(a, position, t);
    float bell = 4.0 * t * (1.0 - t);
    w.y -= aLine.y * bell;
    vec3 d = position - a;
    vec3 sideW = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    w += sideW * aLine.z * bell * sin(t * 9.0 - aLine.w);
    vec3 p = (viewMatrix * vec4(w, 1.0)).xyz;
    vec3 pd = (viewMatrix * vec4(d, 0.0)).xyz;
    vec3 side = cross(normalize(pd + vec3(0.0, 1e-5, 0.0)), normalize(p));
    float sl = length(side);
    side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
    float px = ${MIN_PX.toFixed(2)} * max(-p.z, 0.0) / (projectionMatrix[1][1] * uViewportH);
    p += side * max(${WIDTH.toFixed(4)}, px) * aCorner.y;
    gl_Position = projectionMatrix * vec4(p, 1.0);
    vT = t;
    vSide = aCorner.y;
  }
`;

// A dark braided cable with a hot ember core, brightest toward the hook.
const fragmentShader = /* glsl */ `
  varying float vT;
  varying float vSide;
  void main() {
    float core = 1.0 - abs(vSide);
    float braid = 0.75 + 0.25 * sin(vT * 160.0 + vSide * 2.0);
    vec3 cable = vec3(0.09, 0.08, 0.075) * braid;
    vec3 ember = vec3(1.0, 0.45, 0.12) * core * core * (0.25 + 0.75 * vT);
    gl_FragColor = vec4(cable + ember, 1.0);
    ${DISPLAY_OUT}
  }
`;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class Ropes {
  constructor(players) {
    this.players = players;
    const max = players.length;
    this.max = max;
    const n = max * VERTS;
    const geom = new THREE.BufferGeometry();
    const attr = (name, size) => {
      const a = new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute(name, a);
      return a;
    };
    this.aA = attr('aA', 3);
    this.aA3 = attr('aA3', 3);
    this.aB = attr('position', 3);
    this.aLine = attr('aLine', 4);
    const corner = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < max; i++) {
      for (let s = 0; s <= SEG; s++) {
        const v = i * VERTS + s * 2;
        corner.set([s / SEG, -1, s / SEG, 1], v * 2);
        if (s < SEG) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    geom.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geom.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      name: 'ropes',
      uniforms: { ...viewUniforms },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.name = 'ropes';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.forced = false;
  }

  // Every rendered frame (alpha: the interpolation between ticks): each player's line from
  // their body's left hand to the hook.
  update(alpha) {
    let any = this.forced;
    const L = this.aLine.array;
    for (let i = 0; i < this.max; i++) {
      const p = this.players[i];
      const h = p.hook;
      const on = h.state !== 'off' && p.alive;
      const o = i * VERTS;
      if (!on) {
        if (L[o * 4 + 0] !== NO_OWNER || L[o * 4 + 1] !== -1) this.fill(i, null, null, NO_OWNER, -1, 0, 0);
        continue;
      }
      any = true;
      _b.lerpVectors(h.prev, h.pos, alpha);
      // The third-person left hand: forward of the chest and to the left.
      _a.lerpVectors(p.prevCenter, p.center, alpha);
      _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      _a.x += _fwd.x * 0.35 - _fwd.z * 0.28;
      _a.z += _fwd.z * 0.35 + _fwd.x * 0.28;
      _a.y += 0.25 * p.size;
      // Slack while it's flying out or reeling back; straight once it bites.
      const len = _a.distanceTo(_b);
      const slack = h.state === 'pull' ? Math.max(0, 0.35 - h.t * 3) * Math.min(1, len / 8) : h.state === 'out' ? 0.02 * len : 0.06 * len;
      const wave = h.state === 'pull' ? Math.max(0, 0.18 - h.t * 1.2) : h.state === 'out' ? 0.12 : 0.2;
      this.fill(i, _a, _b, p.id, slack, wave, h.age * 30);
    }
    this.mesh.visible = any;
  }

  // Before a view renders: where its own player's line starts (low on the left of the view).
  setView(p) {
    if (p.hook.state === 'off' || !this.mesh.visible) return;
    const i = this.players.indexOf(p);
    if (i < 0) return;
    _a.copy(FP_START).applyMatrix4(p.camera.matrixWorld);
    const A = this.aA.array;
    for (let v = 0; v < VERTS; v++) _a.toArray(A, (i * VERTS + v) * 3);
    this.aA.addUpdateRange(i * VERTS * 3, VERTS * 3);
    this.aA.needsUpdate = true;
  }

  fill(i, a, b, owner, slack, wave, phase) {
    const o = i * VERTS;
    for (let v = 0; v < VERTS; v++) {
      if (a) {
        a.toArray(this.aA3.array, (o + v) * 3);
        b.toArray(this.aB.array, (o + v) * 3);
      }
      this.aLine.array.set([owner, slack, wave, phase], (o + v) * 4);
    }
    // Hidden lines collapse to nothing.
    if (!a) {
      for (const at of [this.aA, this.aA3, this.aB]) {
        at.array.fill(0, o * 3, (o + VERTS) * 3);
        at.addUpdateRange(o * 3, VERTS * 3);
      }
    }
    for (const at of [this.aA3, this.aB]) at.addUpdateRange(o * 3, VERTS * 3);
    this.aLine.addUpdateRange(o * 4, VERTS * 4);
    for (const at of [this.aA, this.aA3, this.aB, this.aLine]) at.needsUpdate = true;
  }

  // Shown for warm-up's compile (a line in front of the camera).
  warmup(on, at) {
    this.forced = on;
    this.mesh.visible = on;
    if (on) {
      _a.copy(at).add(_b.set(0, -0.5, 0));
      this.fill(0, _a, at, NO_OWNER, 0.1, 0, 0);
    } else {
      this.fill(0, null, null, NO_OWNER, -1, 0, 0);
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
