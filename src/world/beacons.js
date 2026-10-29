import * as THREE from 'three';
import { viewUniforms } from '../fx/viewUniforms.js';

// Light columns over the pickup pads, respawn rings on them and soft halos around glowing
// strips, all in one mesh (one draw call) with no textures: every falloff is worked out in the
// shader. Halos and rings add light; columns also cover a little of what's behind them, so
// they still read as their color against a bright sky (pure additive light washes out to white
// there).
// - Columns: while a pad's pickup is up, a column rises from it in its rim's color: tall for
//   the power gun (it clears the walls), mid-height for field guns, short for grenades. It
//   turns about the vertical to face the camera, fades out when you stand next to it, and
//   fades away when the pickup is taken.
// - Rings: while a pad is empty, a ring on it fills like a clock until the pickup is back;
//   then it pulses.
// - Halos: a rounded-rectangle glow just in front of every strip built with a `halo` face
//   (StaticBuilder.box). They sit at the end of the index buffer, so the low preset leaves
//   them out with a draw range.

// Column height and width (m) per pad kind; colors match the pad rims (arena.js pickupPads).
const COLUMN_H = { power: 9, field: 4, grenades: 2 };
const COLUMN_W = { power: 1.4, field: 1.0, grenades: 0.8 };
// Peak strength of a column (low enough that a player on the pad still reads), and how much of
// it covers what's behind instead of adding to it.
const COLUMN_PEAK = 0.5;
const COLUMN_COVER = 0.6;
// Ring radius (m), on the pad's metal disc (radius 0.55, top 8 cm above the pad), and how far
// above the disc it floats (proud enough to never flicker through it).
const RING_R = 0.5;
const PAD_TOP = 0.08;
const RING_LIFT = 0.02;
// Halo reach past the strip's edge (m), its peak alpha, and how far in front of the strip's
// face it sits (m; far enough to stay ahead of it in the depth buffer at range).
const HALO_R = 0.2;
const HALO_PEAK = 0.4;
const HALO_LIFT = 0.012;
// How fast a column fades in or out (per second).
const FADE_RATE = 3;
// Columns are never thinner than this on screen (px).
const MIN_PX = 5;

const KIND_COLUMN = 0;
const KIND_RING = 1;
const KIND_HALO = 2;

const vertexShader = /* glsl */ `
  uniform float uViewportH;
  uniform vec2 uPad[PADS];
  // Columns and rings: the pad's base (position), corner (x across, y up; or ring x/z in -1..1)
  // and size (half width, height; or ring radius). Halos: the vertex itself, its offset from the
  // strip's center along the face (m), and the strip's half size.
  attribute vec2 aCorner;
  attribute vec2 aSize;
  attribute vec3 aColor;
  // x: kind (0 column, 1 ring, 2 halo). y: pad index.
  attribute vec2 aInfo;
  varying vec2 vUv;
  varying vec2 vSize;
  varying vec3 vColor;
  varying float vKind;
  varying float vReady;
  varying float vProgress;
  varying float vHeight;
  void main() {
    vec3 p = position;
    vec2 pad = aInfo.x < 1.5 ? uPad[int(aInfo.y + 0.5)] : vec2(1.0);
    vReady = pad.x;
    vProgress = pad.y;
    if (aInfo.x < 0.5) {
      vec2 toCam = cameraPosition.xz - position.xz;
      float d = length(toCam);
      vec2 dir = d > 1e-4 ? toCam / d : vec2(0.0, 1.0);
      p.y += aCorner.y * aSize.y;
      float viewZ = max(-(viewMatrix * vec4(p, 1.0)).z, 0.0);
      float hw = max(aSize.x, ${MIN_PX.toFixed(1)} * viewZ / (projectionMatrix[1][1] * uViewportH));
      p.xz += vec2(dir.y, -dir.x) * aCorner.x * hw;
      // Gone when you stand in it.
      vReady *= smoothstep(1.5, 4.0, d);
    } else if (aInfo.x < 1.5) {
      p.xz += aCorner * aSize.x;
    }
    vUv = aCorner;
    vSize = aSize;
    vColor = aColor;
    vKind = aInfo.x;
    vHeight = p.y - position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vSize;
  varying vec3 vColor;
  varying float vKind;
  varying float vReady;
  varying float vProgress;
  varying float vHeight;
  void main() {
    float a;
    float cover = 0.0;
    if (vKind < 0.5) {
      // Soft across, fading out toward the top, with faint bands rising through it.
      float across = 1.0 - abs(vUv.x);
      float bands = 0.85 + 0.15 * sin(vHeight * 3.0 - uTime * 2.5);
      a = across * sqrt(across) * (1.0 - vUv.y * vUv.y) * bands * ${COLUMN_PEAK} * vReady;
      cover = ${COLUMN_COVER};
    } else if (vKind < 1.5) {
      float r = length(vUv);
      float aa = fwidth(r);
      float band = smoothstep(0.72 - aa, 0.72 + aa, r) * (1.0 - smoothstep(0.94 - aa, 0.94 + aa, r));
      // Clockwise from the north, seen from above.
      float turn = fract(atan(vUv.x, -vUv.y) / 6.2831853 + 1.0);
      float lit = vProgress > 1.5 ? 0.3 + 0.15 * sin(uTime * 4.0) : mix(0.08, 0.6, step(turn, vProgress));
      a = band * lit;
    } else {
      vec2 q = max(abs(vUv) - vSize, 0.0);
      float t = 1.0 - min(length(q) / ${HALO_R.toFixed(2)}, 1.0);
      a = ${HALO_PEAK} * t * t;
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, 1.0);
    // Colors are linear: encode them for the sRGB screen like the built-in materials do.
    #include <colorspace_fragment>
    // Premultiplied: adds color * a, and covers a * cover of what's behind.
    gl_FragColor = vec4(gl_FragColor.rgb * a, a * cover);
  }
`;

const _c = new THREE.Color();

export class Beacons {
  // pads: the pickup pads ({ kind: 'power' | 'field' | 'grenades', pos }), in Pickups.pads
  // order. halos: strips recorded by StaticBuilder ({ min, max, normal, color }).
  // M: materials (for the glow tints).
  constructor(pads, halos, M) {
    const tint = { power: M.glowOrange.tint, field: M.glowCyan.tint, grenades: M.ember.tint };
    const pos = [];
    const corner = [];
    const size = [];
    const color = [];
    const info = [];
    const index = [];
    const quad = (verts, kind, pad, c) => {
      const v0 = pos.length / 3;
      _c.set(c);
      for (const [p, uv, s] of verts) {
        pos.push(p[0], p[1], p[2]);
        corner.push(uv[0], uv[1]);
        size.push(s[0], s[1]);
        color.push(_c.r, _c.g, _c.b);
        info.push(kind, pad);
      }
      index.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
    };

    pads.forEach((pad, i) => {
      const base = [pad.pos.x, pad.pos.y + PAD_TOP, pad.pos.z];
      const c = tint[pad.kind];
      const cs = [COLUMN_W[pad.kind] / 2, COLUMN_H[pad.kind]];
      quad([[base, [-1, 0], cs], [base, [1, 0], cs], [base, [-1, 1], cs], [base, [1, 1], cs]], KIND_COLUMN, i, c);
      const ring = [base[0], base[1] + RING_LIFT, base[2]];
      const rs = [RING_R, 0];
      quad([[ring, [-1, -1], rs], [ring, [1, -1], rs], [ring, [-1, 1], rs], [ring, [1, 1], rs]], KIND_RING, i, c);
    });
    this.padIndexCount = index.length;

    for (const h of halos) {
      // The face's axis (k) and the two along it (i, j).
      const k = h.normal.findIndex((n) => n !== 0);
      const i = (k + 1) % 3;
      const j = (k + 2) % 3;
      const center = h.min.map((m, a) => (m + h.max[a]) / 2);
      center[k] = h.normal[k] > 0 ? h.max[k] + HALO_LIFT : h.min[k] - HALO_LIFT;
      const half = [(h.max[i] - h.min[i]) / 2, (h.max[j] - h.min[j]) / 2];
      const verts = [];
      for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lu = su * (half[0] + HALO_R);
        const lv = sv * (half[1] + HALO_R);
        const p = center.slice();
        p[i] += lu;
        p[j] += lv;
        verts.push([p, [lu, lv], half]);
      }
      quad(verts, KIND_HALO, 0, h.color);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
    geom.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 2));
    geom.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
    geom.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
    geom.setIndex(index);

    this.uniforms = {
      ...viewUniforms,
      uTime: { value: 0 },
      // Per pad: x how far the column is faded in, y respawn progress (0 to 1, or 2 when it's
      // up: a clear margin, since interpolated values wobble).
      uPad: { value: Array.from({ length: Math.max(1, pads.length) }, () => new THREE.Vector2(1, 2)) },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'beacons',
      defines: { PADS: Math.max(1, pads.length) },
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.name = 'beacons';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = index.length > 0;
  }

  // Halos on or off (they're off on the low preset).
  setHalos(on) {
    this.mesh.geometry.setDrawRange(0, on ? Infinity : this.padIndexCount);
  }

  // pads: Pickups.pads (active, timer, respawn).
  update(dt, time, pads) {
    this.uniforms.uTime.value = time;
    const u = this.uniforms.uPad.value;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const v = u[i];
      v.x = Math.min(1, Math.max(0, v.x + (pad.active ? dt : -dt) * FADE_RATE));
      v.y = pad.active ? 2 : Math.min(1, Math.max(0, 1 - pad.timer / pad.respawn));
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
