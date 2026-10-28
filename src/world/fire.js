import * as THREE from 'three';
import { mulberry32 } from '../util/rng.js';

// Flames as crossed quads merged into one mesh, animated in the vertex shader.
// One draw call for every burner in the arena.

const vertexShader = /* glsl */ `
  attribute vec2 aFlame; // x: seed, y: flame height
  uniform float uTime;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = uv;
    float t = uTime * 7.0 + aFlame.x * 31.0;
    float flick = 0.78 + 0.22 * sin(t) * sin(t * 1.73 + 1.3);
    vec3 p = position;
    float h = aFlame.y;
    float baseY = p.y - uv.y * h;
    p.y = baseY + uv.y * h * flick;
    p.x += sin(t * 0.61) * 0.12 * uv.y;
    p.z += cos(t * 0.53) * 0.12 * uv.y;
    vFade = 0.75 + 0.25 * sin(t * 0.37);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uIntensity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * vFade;
    gl_FragColor = vec4(tex.rgb * a * uIntensity, a);
  }
`;

// troughs: [{ x, z0, z1, y, height }] flames run along z.
export function createFire(textures, troughs) {
  const rand = mulberry32(99);
  const positions = [];
  const uvs = [];
  const flames = [];
  const indices = [];
  let v = 0;
  const quad = (cx, cy, cz, ax, az, w, h, seed) => {
    // Bottom-left, bottom-right, top-right, top-left.
    const hw = w / 2;
    positions.push(cx - ax * hw, cy, cz - az * hw, cx + ax * hw, cy, cz + az * hw, cx + ax * hw, cy + h, cz + az * hw, cx - ax * hw, cy + h, cz - az * hw);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let i = 0; i < 4; i++) flames.push(seed, h);
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };
  for (const tr of troughs) {
    const count = Math.max(2, Math.round((tr.z1 - tr.z0) / 0.7));
    for (let i = 0; i < count; i++) {
      const z = tr.z0 + ((i + 0.5) / count) * (tr.z1 - tr.z0);
      const seed = rand();
      const h = tr.height * (0.75 + rand() * 0.4);
      const w = 0.9 + rand() * 0.3;
      quad(tr.x, tr.y, z, 1, 0, w, h, seed);
      quad(tr.x, tr.y, z, 0, 1, w, h, seed + 0.5);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('aFlame', new THREE.Float32BufferAttribute(flames, 2));
  geom.setIndex(indices);
  geom.computeBoundingSphere();
  // The shader stretches flames vertically, so pad the bounds a bit.
  geom.boundingSphere.radius += 1;

  const material = new THREE.ShaderMaterial({
    name: 'fire',
    uniforms: {
      uMap: { value: textures.flame },
      uTime: { value: 0 },
      uIntensity: { value: 1.25 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.name = 'fire';
  mesh.renderOrder = 5;

  return {
    mesh,
    update(time) {
      material.uniforms.uTime.value = time;
    },
  };
}
