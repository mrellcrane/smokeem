import * as THREE from 'three';
import { mulberry32 } from '../util/rng.js';

// Grass tufts (Smokehouse Creek's meadow): one instanced mesh, a draw call per view and none in
// the shadow pass. Each tuft is three crossed quads of the blades texture (alpha-tested), with
// normals pointing up so it's lit like the ground under it. The vertex shader sways the tips in
// the wind (each tuft a little out of step) and shrinks tufts away past FAR, so the far meadow
// costs no fill. Looks only.

const FAR = 30;
const SIZE = 0.75;
const HEIGHT = 0.42;

function tuftGeometry() {
  const pos = [];
  const uv = [];
  const nor = [];
  const idx = [];
  for (let q = 0; q < 3; q++) {
    const a = (q / 3) * Math.PI;
    const cx = Math.cos(a) * SIZE * 0.5;
    const cz = Math.sin(a) * SIZE * 0.5;
    const v = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, HEIGHT, cz, -cx, HEIGHT, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// count: how many to try to place; place(x, z, rand): the ground height for a tuft there, or null
// to skip. Returns { mesh, uniforms } (set uniforms.uTime each frame).
export function grassTufts(scene, map, { count, place, half = [48, 30], seed = 61 }) {
  const rand = mulberry32(seed);
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide });
  material.name = 'tufts';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    // Lit as if facing straight up, like the ground, from both sides (a back face's flipped
    // normal would point down and go black).
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n\tnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
    );
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
	vec3 tuftAt = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
	float tuftSway = sin(uTime * 1.6 + tuftAt.x * 0.31 + tuftAt.z * 0.23) * 0.6 + sin(uTime * 3.4 + tuftAt.x * 1.7) * 0.25;
	float tuftTip = uv.y * uv.y;
	transformed.x += tuftSway * 0.1 * tuftTip;
	transformed.z += tuftSway * 0.05 * tuftTip;
	transformed *= 1.0 - smoothstep(${(FAR * 0.8).toFixed(1)}, ${FAR.toFixed(1)}, distance(tuftAt, cameraPosition));`,
    );
  };
  material.customProgramCacheKey = () => 'tufts';
  const mesh = new THREE.InstancedMesh(tuftGeometry(), material, count);
  mesh.name = 'tufts';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  let n = 0;
  for (let tries = 0; tries < count * 6 && n < count; tries++) {
    const x = (rand() * 2 - 1) * half[0];
    const z = (rand() * 2 - 1) * half[1];
    const y = place(x, z, rand);
    if (y === null) continue;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    const k = 0.7 + rand() * 0.7;
    sc.set(k, k * (0.8 + rand() * 0.5), k);
    m.compose(p.set(x, y - 0.03, z), q, sc);
    mesh.setMatrixAt(n, m);
    // Some yellower, some darker.
    const t = rand();
    mesh.setColorAt(n, c.setRGB(0.85 + t * 0.25, 0.9 + t * 0.15, 0.75 + rand() * 0.2));
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return { mesh, uniforms, count: n };
}
