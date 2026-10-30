import * as THREE from 'three';
import { DISPLAY_ADD } from './displayOut.js';

// The sun's lens flare, Halo's: a glare round the sun and a string of soft rings and hexagons
// along the line from the sun through the middle of the view, drawn additively in screen space
// when the sun is on screen and not behind a wall. One mesh (one draw call in a view that sees
// the sun); each view sets where its sun is (setView) and how visible it is (per player, faded
// over a moment when something passes in front).

// Each element: where along the line (0 the sun, 1 the middle, 2 opposite), its size (fraction
// of the view's height), color and shape (0 a soft disk, 1 a ring, 2 a hexagon).
const ELEMENTS = [
  [0, 0.55, 0xfff2d8, 0, 0.55],
  [0, 0.16, 0xffffff, 0, 0.9],
  [0.45, 0.06, 0x7fc4ff, 2, 0.6],
  [0.7, 0.035, 0xffc870, 0, 0.7],
  [1.15, 0.09, 0x6eb8ff, 1, 0.55],
  [1.4, 0.05, 0x9dffc0, 2, 0.5],
  [1.75, 0.14, 0xff9c50, 1, 0.42],
  [2.05, 0.07, 0x7fc4ff, 2, 0.45],
];

const VERTEX = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aT;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aShape;
  attribute float aAlpha;
  uniform vec2 uSun;
  uniform float uAspect;
  uniform float uVis;
  varying vec2 vC;
  varying vec3 vColor;
  varying float vShape;
  varying float vAlpha;
  void main() {
    vec2 at = mix(uSun, -uSun, aT * 0.5);
    vC = aCorner;
    vColor = aColor;
    vShape = aShape;
    // The ghosts fade as the sun nears the middle (they bunch up there) and at the edges.
    float edge = 1.0 - smoothstep(0.75, 1.15, max(abs(uSun.x), abs(uSun.y)));
    vAlpha = aAlpha * uVis * (aT > 0.0 ? edge * smoothstep(0.05, 0.4, length(uSun)) : 1.0);
    gl_Position = vec4(at + aCorner * vec2(aSize / uAspect, aSize), 0.0, 1.0);
  }
`;
const FRAGMENT = /* glsl */ `
  varying vec2 vC;
  varying vec3 vColor;
  varying float vShape;
  varying float vAlpha;
  void main() {
    float r = length(vC);
    float a;
    if (vShape < 0.5) a = pow(max(0.0, 1.0 - r), 2.2);
    else if (vShape < 1.5) a = smoothstep(0.62, 0.8, r) * (1.0 - smoothstep(0.82, 1.0, r));
    else {
      vec2 q = abs(vC);
      float hex = max(q.x * 0.866 + q.y * 0.5, q.y);
      a = (1.0 - smoothstep(0.78, 0.86, hex)) * (0.55 + 0.45 * hex);
    }
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
    ${DISPLAY_ADD}
  }
`;

export function createFlare() {
  const n = ELEMENTS.length;
  const corner = [];
  const t = [];
  const size = [];
  const color = [];
  const shape = [];
  const alpha = [];
  const index = [];
  const c = new THREE.Color();
  ELEMENTS.forEach(([et, es, ec, eh, ea], i) => {
    c.set(ec);
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corner.push(x, y);
      t.push(et);
      size.push(es);
      color.push(c.r, c.g, c.b);
      shape.push(eh);
      alpha.push(ea);
    }
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  // (A position attribute three expects; the shader places everything itself.)
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 12), 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 1));
  g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alpha, 1));
  g.setIndex(index);
  const uniforms = { uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uVis: { value: 0 } };
  const mesh = new THREE.Mesh(
    g,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.name = 'lensFlare';
  mesh.material.name = 'lensFlare';
  mesh.frustumCulled = false;
  // After everything else in the world (the viewmodel draws over it).
  mesh.renderOrder = 10;
  mesh.visible = false;

  const _p = new THREE.Vector3();
  const state = new Map();
  return {
    mesh,
    uniforms,
    // Before a view renders: where its sun is, and whether the level hides it (smoothed per
    // player). sunDir points toward the sun; surfaceNear(origin, dir, dist) is the level ray.
    setView(player, camera, aspect, sunDir, surfaceNear, dt) {
      // (The renderer only updates the camera's matrices when it draws.)
      camera.updateMatrixWorld();
      _p.copy(camera.position).addScaledVector(sunDir, 100).project(camera);
      const front = _p.z < 1 && Math.abs(_p.x) < 1.3 && Math.abs(_p.y) < 1.3;
      let s = state.get(player);
      if (!s) state.set(player, (s = { vis: 0 }));
      const clear = front && !surfaceNear(camera.position, sunDir, 400);
      s.vis += ((clear ? 1 : 0) - s.vis) * Math.min(1, dt * 8);
      mesh.visible = s.vis > 0.01;
      uniforms.uSun.value.set(_p.x, _p.y);
      uniforms.uAspect.value = aspect;
      uniforms.uVis.value = s.vis;
      return s.vis;
    },
    warmup(on) {
      mesh.visible = on;
      uniforms.uVis.value = on ? 1 : 0;
    },
    dispose() {
      g.dispose();
      mesh.material.dispose();
    },
  };
}
