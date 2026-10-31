import * as THREE from 'three';
import { gfx } from '../render/gfx.js';

// World-space grime (Halo's grit): the grime map (textures.js) laid over level geometry by world
// position, big blotches on floors and blotches plus rain streaks on walls, at two scales, so
// surfaces darken and brown in patches that don't repeat with the 3 to 4 m texture tiles. Two
// texture lookups per pixel. Static geometry sits at the origin, so `position` is the world's.
const GRIME_VERTEX = /* glsl */ `
  vGrimeP = position;
  vGrimeN = normal;
`;
const GRIME_FRAGMENT = /* glsl */ `
  {
    vec3 gn = abs(vGrimeN);
    bool flatFace = gn.y > 0.7;
    vec2 guv = flatFace ? vGrimeP.xz : vec2(gn.x > gn.z ? vGrimeP.z : vGrimeP.x, vGrimeP.y);
    vec4 g1 = texture2D(uGrime, guv / 9.0);
    vec4 g2 = texture2D(uGrime, guv / 3.1 + 0.37);
    // Patches with edges (most of a surface stays clean), and on walls streaks running down.
    float dirt = smoothstep(0.42, 0.78, mix(g1.r, g2.r, 0.45));
    if (!flatFace) dirt = max(dirt, smoothstep(0.55, 0.95, g2.g) * 0.8);
    float k = uGrimeAmt * dirt;
    diffuseColor.rgb *= (1.0 - 0.55 * k) * mix(vec3(1.0), vec3(0.95, 0.87, 0.74), k);
  }
`;

function applyGrime(material, map, amount) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrime = { value: map };
    shader.uniforms.uGrimeAmt = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrimeP;\nvarying vec3 vGrimeN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GRIME_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uGrime;\nuniform float uGrimeAmt;\nvarying vec3 vGrimeP;\nvarying vec3 vGrimeN;')
      .replace('#include <map_fragment>', `#include <map_fragment>\n${GRIME_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => 'grime';
}

// Rounded edges (gfx switch `bevels`, maps whose look sets `bevel`): every box face knows where
// each pixel sits on it (aEdge, from StaticBuilder: meters from its corner and its size), so within
// BEVEL of an edge the normal bends out over the edge, up to 45 degrees at it, as a rounded edge
// would: the edges facing the sun catch it and the others fall into shade, and they're a little
// lighter (worn). The face's directions on screen come from the position's derivatives (as three
// does for normal maps), and the band fades out where it would be under a couple of pixels wide.
// Faces with no edge data (cylinders, rods) have zero size and are left alone.
const BEVEL = 0.045;
const BEVEL_VERTEX = /* glsl */ `
  vEdge = aEdge;
`;
const BEVEL_FRAGMENT = /* glsl */ `
  if (vEdge.z > 0.0) {
    vec3 q0 = dFdx(-vViewPosition);
    vec3 q1 = dFdy(-vViewPosition);
    vec2 st0 = dFdx(vEdge.xy);
    vec2 st1 = dFdy(vEdge.xy);
    vec3 n0 = normalize(nonPerturbedNormal);
    vec3 q1perp = cross(q1, n0);
    vec3 q0perp = cross(n0, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float lt = length(T);
    float lb = length(B);
    if (lt > 0.0 && lb > 0.0) {
      T /= lt;
      B /= lb;
      float w = min(${BEVEL}, 0.3 * min(vEdge.z, vEdge.w));
      float bx = smoothstep(w, 0.0, vEdge.z - vEdge.x) - smoothstep(w, 0.0, vEdge.x);
      float by = smoothstep(w, 0.0, vEdge.w - vEdge.y) - smoothstep(w, 0.0, vEdge.y);
      // How many pixels the band spans here.
      float px = max(fwidth(vEdge.x), fwidth(vEdge.y));
      float k = smoothstep(0.8, 2.5, w / max(px, 1e-5));
      bx *= k;
      by *= k;
      normal = normalize(normal + T * bx + B * by);
      diffuseColor.rgb *= 1.0 + 0.16 * max(abs(bx), abs(by));
    }
  }
`;

// Adds the bevel to a material, after whatever it already does in onBeforeCompile (the grime).
export function applyBevel(material) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.() ?? '';
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aEdge;\nvarying vec4 vEdge;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BEVEL_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vEdge;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${BEVEL_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${prevKey}|bevel`;
}

// Baked ambient occlusion and bounce (StaticBuilder's `ao` option: aAo, aBounce per vertex): the
// indirect light (the sky's fill) is scaled by how much sky each spot sees, and the light bounced
// off what's near it is added, tinted by that surface's color. The sun is untouched, so sunlit
// faces stay bright and corners, undersides and anything under cover in the shade go dark.
export function applyAo(material) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.() ?? '';
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAo;\nattribute vec3 aBounce;\nvarying float vAo;\nvarying vec3 vBounce;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvAo = aAo;\n\tvBounce = aBounce;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAo;\nvarying vec3 vBounce;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n\treflectedLight.indirectDiffuse *= vAo;\n\treflectedLight.indirectDiffuse += vBounce * diffuseColor.rgb;');
  };
  material.customProgramCacheKey = () => `${prevKey}|ao`;
}

// Shared materials. Lambert/Phong only: cheap per-pixel lighting that holds up in split-screen.
// `tile` is the texture repeat size in meters used by StaticBuilder for world-space UVs.
// Static level materials use vertex colors: StaticBuilder writes each vertex's baked light there.
// `photo`: tiles (meters) and color tints for the materials whose maps are photos (photos.js).
export function createMaterials(tex, photo = {}) {
  const vc = { vertexColors: true };
  const m = {
    ground: new THREE.MeshLambertMaterial({ map: tex.ground, ...vc }),
    metal: new THREE.MeshPhongMaterial({ map: tex.metal, specular: 0x353b40, shininess: 30, ...vc }),
    metalDark: new THREE.MeshPhongMaterial({ map: tex.metalDark, specular: 0x222629, shininess: 24, ...vc }),
    hazard: new THREE.MeshLambertMaterial({ map: tex.hazard, ...vc }),
    plank: new THREE.MeshLambertMaterial({ map: tex.plank, ...vc }),
    concrete: new THREE.MeshLambertMaterial({ map: tex.concrete, ...vc }),
    crate: new THREE.MeshLambertMaterial({ map: tex.crate, ...vc }),
    mud: new THREE.MeshPhongMaterial({ map: tex.mud, specular: 0x8a7258, shininess: 90, ...vc }),
    net: new THREE.MeshLambertMaterial({ map: tex.net, alphaTest: 0.5, side: THREE.DoubleSide, ...vc }),
    rope: new THREE.MeshLambertMaterial({ map: tex.rope, ...vc }),
    // The factory's: slab floor, conveyor belts, the grease vat and orange pallet-rack paint.
    slab: new THREE.MeshLambertMaterial({ map: tex.slab, ...vc }),
    // Smokehouse Creek's meadow and its creek's water (not vertex lit: drawn on its own).
    grass: new THREE.MeshLambertMaterial({ map: tex.grass, ...vc }),
    rock: new THREE.MeshLambertMaterial({ map: tex.rock, ...vc }),
    water: new THREE.MeshPhongMaterial({ color: 0x2c5a5e, specular: 0x9ab8c0, shininess: 90, transparent: true, opacity: 0.8, depthWrite: false }),
    belt: new THREE.MeshLambertMaterial({ map: tex.belt, ...vc }),
    grease: new THREE.MeshPhongMaterial({ map: tex.mud, color: 0x8a8478, specular: 0x6a6258, shininess: 120, ...vc }),
    paint: new THREE.MeshPhongMaterial({ color: 0xd8641c, specular: 0x302418, shininess: 20, ...vc }),
    steel: new THREE.MeshPhongMaterial({ color: 0x9aa4ad, specular: 0x6a6f73, shininess: 60, ...vc }),
    // Every glowing strip, ring and trough shares one vertex-colored material (one draw call);
    // StaticBuilder writes the tint below as each box's vertex color.
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    mesa: new THREE.MeshLambertMaterial({ color: 0x9c7a64, flatShading: true }),
    // Vertex-colored props in the world: pickups, missiles, grenades.
    props: new THREE.MeshLambertMaterial({ vertexColors: true }),
  };
  const tiles = {
    ground: 4,
    metal: 4,
    metalDark: 4,
    hazard: 1,
    plank: 2.4,
    concrete: 3,
    mud: 3,
    slab: 4,
    grass: 4,
    rock: 3,
    belt: 1,
    grease: 3,
    net: 1.2,
    rope: 0.5,
  };
  // What a bullet hitting each one kicks up and leaves behind (effects.js).
  const surfaces = {
    ground: 'dirt',
    metal: 'metal',
    metalDark: 'metal',
    hazard: 'metal',
    steel: 'metal',
    plank: 'wood',
    crate: 'wood',
    concrete: 'concrete',
    mud: 'mud',
    slab: 'concrete',
    grass: 'dirt',
    rock: 'concrete',
    belt: 'cloth',
    grease: 'mud',
    paint: 'metal',
    net: 'cloth',
    rope: 'cloth',
  };
  Object.assign(tiles, photo.tiles);
  for (const [name, [r, g, b]] of Object.entries(photo.tints ?? {})) if (photo.tiles?.[name]) m[name].color.setRGB(r, g, b);
  // Each surface's rough color (linear), for the light it bounces (StaticBuilder's `ao`).
  const albedo = {
    ground: [0.26, 0.17, 0.1],
    concrete: [0.3, 0.3, 0.28],
    slab: [0.28, 0.28, 0.27],
    plank: [0.22, 0.14, 0.08],
    crate: [0.34, 0.14, 0.06],
    metal: [0.15, 0.17, 0.19],
    metalDark: [0.06, 0.06, 0.07],
    steel: [0.35, 0.37, 0.4],
    paint: [0.6, 0.2, 0.05],
    hazard: [0.4, 0.33, 0.05],
    rock: [0.25, 0.22, 0.2],
    grass: [0.1, 0.18, 0.05],
  };
  for (const [name, mat] of Object.entries(m)) {
    mat.name = name;
    mat.userData.albedo = albedo[name] ?? null;
    // (Lit by the bake's occlusion when the map asks: the level's surfaces, not glow or props.)
    mat.userData.ao = name in albedo;
    mat.userData.tile = tiles[name] ?? 0;
    mat.userData.surface = surfaces[name] ?? null;
  }
  // High preset: relief-painted surfaces also get their normal maps (textures.js), so seams,
  // rivets and grain answer the real sun. (Kept gentle: the color maps already carry the relief.)
  for (const [name, mat] of Object.entries(m)) {
    const n = tex[`${(mat.map && Object.keys(tex).find((k) => tex[k] === mat.map)) || ''}Normal`];
    if (!n) continue;
    mat.normalMap = n;
    mat.normalScale.set(1, 1);
  }
  // World-space grime over the level's surfaces, how much on each (gfx switch `grime`).
  if (gfx.grime && tex.grime) {
    const amounts = { grass: 0.35, rock: 0.5, ground: 0.5, metal: 0.75, metalDark: 0.65, concrete: 0.85, slab: 0.8, plank: 0.5, paint: 0.55, steel: 0.45, hazard: 0.55 };
    for (const [name, a] of Object.entries(amounts)) applyGrime(m[name], tex.grime, a);
  }
  // A little grime low down on tall faces (StaticBuilder).
  for (const name of ['metal', 'metalDark', 'concrete', 'paint']) m[name].userData.grime = true;
  // Glow tints: pass these to StaticBuilder like materials.
  m.glowCyan = { tintOf: m.glow, tint: 0x63f2ff };
  m.glowOrange = { tintOf: m.glow, tint: 0xff8a2a };
  m.ember = { tintOf: m.glow, tint: 0xff4e12 };
  // The factory's lamps and high windows.
  m.lamp = { tintOf: m.glow, tint: 0xffe2b0 };
  m.window = { tintOf: m.glow, tint: 0xb9d2e2 };
  return m;
}
