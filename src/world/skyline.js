import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../util/rng.js';
import { DISPLAY_OUT } from '../render/displayOut.js';

// The facility around an outdoor arena, seen over the stands: arcology towers with lit window
// bands, smokestacks puffing, comm towers and hangars, floodlight rigs aimed at the arena, and a
// monorail on stilts with a train going round. Looks only, far outside the play space.
// Three draw calls: every structure in one mesh (lights glow and blink and the train moves in
// its vertex shader), the smoke plumes as one mesh of billboards, the cloud band around the
// horizon (in sky.js). update(time) drives them.

const STEEL = 0x56616b;
const STEEL_DARK = 0x3d464e;
const CONCRETE = 0x8d877e;
const BRICK = 0x8a6a58;
const RED = 0xb03a2a;
const WHITE = 0xe2ddd2;
const WINDOW = 0xffd9a0;
const CYAN = 0x8ff4ff;
const BLINK = 0xff3020;
const FLOOD = 0xf2e2c0;
const TRAIN = 0xe4e8ec;

// The monorail: radius, height of the track's top, the train's speed (radians a second).
const RAIL = { r: 68, y: 26, speed: 0.07 };

const VERTEX_HEAD = /* glsl */ `
  attribute float aGlow;
  attribute float aBlink;
  attribute float aTrain;
  uniform float uTime;
  varying float vGlow;
`;
// The train goes round the monorail: its normals turn first (the normal chunks run before the
// position ones), then its positions.
const TRAIN_TURN = `
  float trainA = uTime * ${RAIL.speed.toFixed(3)};
  mat2 trainR = mat2(cos(trainA), sin(trainA), -sin(trainA), cos(trainA));
`;
const VERTEX_NORMAL = /* glsl */ `
  #include <beginnormal_vertex>
  ${TRAIN_TURN}
  if (aTrain > 0.5) objectNormal.xz = trainR * objectNormal.xz;
`;
const VERTEX_MOVE = /* glsl */ `
  #include <begin_vertex>
  if (aTrain > 0.5) transformed.xz = trainR * transformed.xz;
  // Aviation lights blink, each at its own phase.
  vGlow = aGlow * (aBlink > 0.0 ? step(0.55, fract(uTime * 0.6 + aBlink)) : 1.0);
`;
// Lights glow; then everything fades into the horizon's haze with distance (aerial
// perspective, stronger than the arena's fog), so the far towers stay a backdrop.
const FRAGMENT_GLOW = /* glsl */ `
  outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.4, vGlow);
  outgoingLight = mix(outgoingLight, uHaze, smoothstep(40.0, 420.0, length(vViewPosition)) * 0.82);
  #include <opaque_fragment>
`;

// A part: a box or a cylinder with its color, glow (0 to 1), blink phase (0: steady) and
// whether it rides the train.
const _c = new THREE.Color();
function paint(g, color, glow = 0, blink = 0, train = 0) {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  _c.set(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) _c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  g.setAttribute('aBlink', new THREE.BufferAttribute(new Float32Array(n).fill(blink), 1));
  g.setAttribute('aTrain', new THREE.BufferAttribute(new Float32Array(n).fill(train), 1));
  return g;
}

class Parts {
  constructor() {
    this.list = [];
  }

  // A box by its base's middle, turned yaw about y.
  box(x, y, z, w, h, d, color, { yaw = 0, glow = 0, blink = 0, train = 0 } = {}) {
    const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(yaw).translate(x, y, z);
    this.list.push(paint(g, color, glow, blink, train));
  }

  // A cylinder by its base's middle (radii at the bottom and top).
  cyl(x, y, z, rBottom, rTop, h, color, { seg = 12, glow = 0, blink = 0 } = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1).translate(x, y + h / 2, z);
    this.list.push(paint(g, color, glow, blink));
  }

  // A blinking red light.
  beacon(x, y, z, phase) {
    this.box(x, y, z, 1.4, 1.4, 1.4, BLINK, { glow: 1, blink: phase });
  }

  build() {
    const g = mergeGeometries(this.list, false);
    for (const p of this.list) p.dispose();
    return g;
  }
}

// Where things stand: polar (angle from north, clockwise; radius) to x, z.
const at = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
// Facing the arena's middle from (x, z): the yaw that turns a box's +z face toward it.
const facing = (x, z) => Math.atan2(-x, -z);

function arcology(P, rand, a, r) {
  const [x, z] = at(a, r);
  const w = 16 + rand() * 18;
  const d = 16 + rand() * 18;
  const h = 55 + rand() * 80;
  const yaw = facing(x, z) + (rand() - 0.5) * 0.4;
  P.box(x, 0, z, w, h, d, rand() < 0.5 ? STEEL : STEEL_DARK, { yaw });
  // Window bands all the way round, every few floors.
  for (let y = 8 + rand() * 4; y < h - 4; y += 7 + rand() * 5) {
    if (rand() < 0.25) continue;
    P.box(x, y, z, w + 0.3, 0.9, d + 0.3, WINDOW, { yaw, glow: 0.35 + rand() * 0.25 });
  }
  // A setback on top, with a mast and its light.
  const sw = w * (0.45 + rand() * 0.3);
  const sh = 8 + rand() * 18;
  P.box(x, h, z, sw, sh, d * 0.6, STEEL_DARK, { yaw });
  P.box(x, h + sh, z, 0.6, 14, 0.6, STEEL_DARK);
  P.beacon(x, h + sh + 14, z, rand());
  // A cyan crown strip on some.
  if (rand() < 0.5) P.box(x, h - 1.2, z, w + 0.4, 0.6, d + 0.4, CYAN, { yaw, glow: 1 });
}

// Returns the stack's top, for the smoke.
function smokestack(P, rand, a, r) {
  const [x, z] = at(a, r);
  const rb = 3.2 + rand() * 2;
  const h = 60 + rand() * 35;
  P.cyl(x, 0, z, rb * 1.4, rb * 1.4, 6, CONCRETE, { seg: 14 });
  P.cyl(x, 6, z, rb, rb * 0.82, h - 6, BRICK, { seg: 14 });
  // Red and white bands near the top, a cap.
  for (let i = 0; i < 3; i++) P.cyl(x, h - 14 + i * 4, z, rb * 0.86, rb * 0.84, 2, i % 2 ? WHITE : RED, { seg: 14 });
  P.cyl(x, h - 1, z, rb * 0.9, rb * 0.9, 1.2, STEEL_DARK, { seg: 14 });
  P.beacon(x + rb * 0.9, h - 2, z, rand());
  return [x, h + 0.5, z];
}

function commTower(P, rand, a, r) {
  const [x, z] = at(a, r);
  const h = 75 + rand() * 40;
  P.cyl(x, 0, z, 7, 1.2, h, STEEL_DARK, { seg: 4 });
  for (let y = 18; y < h - 10; y += 16) P.cyl(x, y, z, 7.2 * (1 - y / h) + 1, 7 * (1 - (y + 1) / h) + 1, 1, STEEL);
  // Dishes partway up, facing out of the facility.
  const yaw = facing(x, z) + Math.PI;
  for (const y of [h * 0.55, h * 0.7]) {
    const g = new THREE.CylinderGeometry(5, 3.5, 1.2, 14, 1).rotateX(Math.PI / 2).rotateY(yaw + (rand() - 0.5)).translate(x, y, z);
    P.list.push(paint(g, WHITE));
  }
  P.box(x, h, z, 0.5, 12, 0.5, STEEL_DARK);
  P.beacon(x, h + 12, z, rand());
}

function hangar(P, rand, a, r) {
  const [x, z] = at(a, r);
  const yaw = facing(x, z);
  const w = 36 + rand() * 20;
  const d = 22 + rand() * 10;
  P.box(x, 0, z, w, 10, d, CONCRETE, { yaw });
  // An arched roof along its width.
  const roof = new THREE.CylinderGeometry(d / 2, d / 2, w, 16, 1, false, -Math.PI / 2, Math.PI)
    .rotateZ(Math.PI / 2)
    .rotateY(yaw)
    .translate(x, 10, z);
  P.list.push(paint(roof, STEEL));
  // The big door toward the arena, lit along its top.
  const off = d / 2 + 0.2;
  const dx = Math.sin(yaw) * off;
  const dz = Math.cos(yaw) * off;
  P.box(x + dx, 0, z + dz, w * 0.6, 9, 0.4, STEEL_DARK, { yaw });
  P.box(x + dx * 1.01, 9, z + dz * 1.01, w * 0.62, 0.5, 0.5, WINDOW, { yaw, glow: 1 });
}

function floodRig(P, rand, a, r) {
  const [x, z] = at(a, r);
  const yaw = facing(x, z);
  const h = 32 + rand() * 6;
  P.box(x, 0, z, 1.6, h, 1.6, STEEL_DARK);
  P.box(x, h, z, 9, 4.5, 1.6, STEEL_DARK, { yaw });
  // Lamps facing the arena.
  const dx = Math.sin(yaw) * 0.85;
  const dz = Math.cos(yaw) * 0.85;
  for (let i = -1; i <= 1; i++) {
    for (const yy of [h + 1, h + 2.9]) {
      const ox = Math.cos(yaw) * i * 2.8;
      const oz = -Math.sin(yaw) * i * 2.8;
      P.box(x + ox + dx, yy, z + oz + dz, 2.0, 1.1, 0.2, FLOOD, { yaw, glow: 0.6 });
    }
  }
  P.beacon(x, h + 5.5, z, rand());
}

function monorail(P) {
  const n = 48;
  const seg = ((Math.PI * 2 * RAIL.r) / n) * 1.04;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const [x, z] = at(a, RAIL.r);
    // (A box's long side, z, along the ring.)
    const yaw = Math.PI / 2 - a;
    P.box(x, RAIL.y - 1.4, z, 1.6, 1.4, seg, CONCRETE, { yaw });
    if (i % 3 === 0) P.box(x, 0, z, 1.4, RAIL.y - 1.4, 1.4, CONCRETE, { yaw });
    // A glowing strip along the beam's inner side.
    const [ix, iz] = at(a, RAIL.r - 0.82);
    P.box(ix, RAIL.y - 0.9, iz, 0.1, 0.25, seg, CYAN, { yaw, glow: 0.8 });
  }
  // The train: four cars riding on the beam, turned by the vertex shader.
  for (let k = 0; k < 4; k++) {
    const a = -k * 0.15;
    const yaw = Math.PI / 2 - a;
    const [x, z] = at(a, RAIL.r);
    P.box(x, RAIL.y, z, 3.2, 3.4, 9.6, TRAIN, { yaw, train: 1 });
    const [ix, iz] = at(a, RAIL.r - 1.62);
    P.box(ix, RAIL.y + 1.6, iz, 0.1, 1.0, 8.4, CYAN, { yaw, glow: 1, train: 1 });
    const [ox, oz] = at(a, RAIL.r + 1.62);
    P.box(ox, RAIL.y + 1.6, oz, 0.1, 1.0, 8.4, CYAN, { yaw, glow: 1, train: 1 });
  }
}

// Smoke plumes: billboards that rise from each stack, grow, drift with the wind and fade, all
// in the vertex shader (no per-frame work but a time uniform).
const PUFFS = 12;
const PLUME_VERTEX = /* glsl */ `
  attribute vec3 aBase;
  attribute vec2 aCorner;
  attribute float aPhase;
  uniform float uTime;
  uniform vec2 uFog;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vFog;
  void main() {
    float age = fract(uTime * 0.035 + aPhase);
    vec3 p = aBase + vec3(age * 38.0, age * 55.0, age * 14.0);
    float size = mix(5.0, 30.0, sqrt(age));
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p += (right * aCorner.x + up * aCorner.y) * size;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = aCorner * 0.5 + 0.5;
    vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - age) * 0.42;
    vFog = smoothstep(40.0, uFog.y, -mv.z) * 0.85;
  }
`;
const PLUME_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vFog;
  void main() {
    vec2 d = vUv - 0.5;
    float r = dot(d, d) * 4.0;
    float a = (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha;
    gl_FragColor = vec4(mix(uColor, uFogColor, vFog), a);
    ${DISPLAY_OUT}
  }
`;

function plumes(tops, uniforms) {
  const n = tops.length * PUFFS;
  const base = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const phase = new Float32Array(n * 4);
  const index = [];
  let v = 0;
  tops.forEach((t, s) => {
    for (let i = 0; i < PUFFS; i++) {
      const ph = i / PUFFS + s * 0.37;
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        base.set(t, v * 3);
        corner.set([cx, cy], v * 2);
        phase[v] = ph;
        v++;
      }
      const o = v - 4;
      index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  // (position is only for three's bookkeeping; the shader places everything from aBase.)
  g.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
  g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setIndex(index);
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PLUME_VERTEX,
    fragmentShader: PLUME_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  m.name = 'plumes';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'plumes';
  mesh.frustumCulled = false;
  return mesh;
}

export function createSkyline(look) {
  const rand = mulberry32(4242);
  const P = new Parts();
  const tops = [];
  // Towers in a ragged ring, stacks and comm towers between them, hangars and flood rigs nearer.
  const towers = 15;
  for (let i = 0; i < towers; i++) arcology(P, rand, ((i + rand() * 0.6) / towers) * Math.PI * 2, 190 + rand() * 110);
  for (const a of [0.35, 1.5, 2.6, 3.7, 4.6, 5.6]) tops.push(smokestack(P, rand, a + (rand() - 0.5) * 0.2, 100 + rand() * 50));
  for (const a of [0.95, 3.1, 5.05]) commTower(P, rand, a, 125 + rand() * 50);
  for (const a of [0.6, 2.0, 3.4, 4.2, 5.3]) hangar(P, rand, a + (rand() - 0.5) * 0.2, 88 + rand() * 25);
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) floodRig(P, rand, a, 64);
  monorail(P);

  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0xc4bdb2) },
    uFogColor: { value: new THREE.Color(look.sky.horizon) },
    uFog: { value: new THREE.Vector2(look.fog.near, look.fog.far) },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.name = 'skyline';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader =
      VERTEX_HEAD + shader.vertexShader.replace('#include <beginnormal_vertex>', VERTEX_NORMAL).replace('#include <begin_vertex>', VERTEX_MOVE);
    shader.uniforms.uHaze = uniforms.uFogColor;
    shader.fragmentShader = 'varying float vGlow;\nuniform vec3 uHaze;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', FRAGMENT_GLOW);
  };
  material.customProgramCacheKey = () => 'skyline';
  const mesh = new THREE.Mesh(P.build(), material);
  mesh.name = 'skyline';
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'skylineGroup';
  group.add(mesh, plumes(tops, uniforms));
  return {
    group,
    update(time) {
      uniforms.uTime.value = time;
    },
  };
}
