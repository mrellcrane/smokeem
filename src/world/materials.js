import * as THREE from 'three';

// Shared materials. Lambert/Phong only: cheap per-pixel lighting that holds up in split-screen.
// `tile` is the texture repeat size in meters used by StaticBuilder for world-space UVs.
// Static level materials use vertex colors: StaticBuilder writes each vertex's baked light there.
export function createMaterials(tex) {
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
    belt: 'cloth',
    grease: 'mud',
    paint: 'metal',
    net: 'cloth',
    rope: 'cloth',
  };
  for (const [name, mat] of Object.entries(m)) {
    mat.name = name;
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
