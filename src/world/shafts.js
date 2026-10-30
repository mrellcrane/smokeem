import * as THREE from 'three';
import { mulberry32 } from '../util/rng.js';
import { DISPLAY_ADD } from '../render/displayOut.js';

// Sunbeams through an indoor map's skylights, and dust drifting in them. Each beam is a slanted
// open prism from a skylight opening down to the floor along the sun; its sides are drawn
// additively, faded toward the floor and at grazing angles so the edges stay soft (two crossed
// planes would show their edges). The dust is one points mesh moved in its vertex shader.
// Two draw calls. update(time) drives the dust.

const BEAM_VERTEX = /* glsl */ `
  attribute float aDown;
  varying float vDown;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vDown = aDown;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vDown;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float face = abs(dot(normalize(vNormal), normalize(vView)));
    float a = pow(face, 1.6) * (1.0 - smoothstep(0.35, 1.0, vDown)) * smoothstep(0.0, 0.08, vDown);
    // (Fade right at the camera, so walking through a beam doesn't flash the screen.)
    a *= smoothstep(1.5, 5.0, length(vView));
    gl_FragColor = vec4(uColor * a, 1.0);
    ${DISPLAY_ADD}
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  uniform vec3 uDrop;
  varying float vAlpha;
  void main() {
    // Each mote drifts down the beam it was put in, wobbling, and wraps round to the top.
    float t = fract(uTime * 0.02 + aSeed);
    vec3 p = position + uDrop * t;
    p.x += sin(uTime * 0.7 + aSeed * 40.0) * 0.25;
    p.z += cos(uTime * 0.5 + aSeed * 23.0) * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uScale * 0.06 / -mv.z, 1.0, 4.0);
    vAlpha = sin(3.14159 * t) * smoothstep(1.0, 4.0, -mv.z) * (1.0 - smoothstep(25.0, 45.0, -mv.z));
  }
`;
const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = (1.0 - smoothstep(0.1, 0.5, length(d))) * vAlpha;
    gl_FragColor = vec4(uColor * a, 1.0);
    ${DISPLAY_ADD}
  }
`;

// openings: [{ x0, x1, z0, z1 }] skylight openings at height `top`; sunDir: where the sun sits
// (look.sun.dir); floor: the floor's height. scale: for the dust's point size (the renderer's
// drawing-buffer height).
export function createShafts({ openings, top, floor = 0, sunDir, color = 0xffe2b8, strength = 0.13, dust = 600 }) {
  const d = new THREE.Vector3(...sunDir).normalize().negate();
  const drop = d.clone().multiplyScalar((top - floor) / -d.y);
  const pos = [];
  const down = [];
  const index = [];
  for (const o of openings) {
    // The opening's corners at the top, and the same shifted along the sun to the floor.
    const t = [
      [o.x0, top, o.z0],
      [o.x1, top, o.z0],
      [o.x1, top, o.z1],
      [o.x0, top, o.z1],
    ];
    const b = t.map(([x, y, z]) => [x + drop.x, y + drop.y, z + drop.z]);
    // Four sides, each its own quad (flat normals for the grazing fade).
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const base = pos.length / 3;
      pos.push(...t[i], ...t[j], ...b[j], ...b[i]);
      down.push(0, 0, 1, 1);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDown', new THREE.Float32BufferAttribute(down, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  const beamColor = new THREE.Color(color).multiplyScalar(strength);
  const beams = new THREE.Mesh(
    g,
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: beamColor } },
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  beams.name = 'sunbeams';
  beams.material.name = 'sunbeams';
  beams.frustumCulled = false;

  // Dust: scattered through the beams' volumes (the top of each, drifting down the beam).
  const rand = mulberry32(99);
  const dp = new Float32Array(dust * 3);
  const seed = new Float32Array(dust);
  for (let i = 0; i < dust; i++) {
    const o = openings[Math.floor(rand() * openings.length)];
    dp[i * 3] = o.x0 + rand() * (o.x1 - o.x0);
    dp[i * 3 + 1] = top;
    dp[i * 3 + 2] = o.z0 + rand() * (o.z1 - o.z0);
    seed[i] = rand();
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: 1080 },
    uDrop: { value: drop },
    uColor: { value: new THREE.Color(color).multiplyScalar(0.55) },
  };
  const motes = new THREE.Points(
    dg,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  motes.name = 'dust';
  motes.material.name = 'dust';
  motes.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'shafts';
  group.add(beams, motes);
  return {
    group,
    update(time, viewHeight) {
      uniforms.uTime.value = time;
      if (viewHeight) uniforms.uScale.value = viewHeight;
    },
  };
}
