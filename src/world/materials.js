import * as THREE from 'three';

// Shared materials. Lambert/Phong only: cheap per-pixel lighting that holds up in split-screen.
// `tile` is the texture repeat size in meters used by StaticBuilder for world-space UVs.
export function createMaterials(tex) {
  const m = {
    ground: new THREE.MeshLambertMaterial({ map: tex.ground }),
    metal: new THREE.MeshPhongMaterial({ map: tex.metal, specular: 0x2a2f33, shininess: 28 }),
    metalDark: new THREE.MeshPhongMaterial({ map: tex.metalDark, specular: 0x222629, shininess: 24 }),
    hazard: new THREE.MeshLambertMaterial({ map: tex.hazard }),
    plank: new THREE.MeshLambertMaterial({ map: tex.plank }),
    concrete: new THREE.MeshLambertMaterial({ map: tex.concrete }),
    crate: new THREE.MeshLambertMaterial({ map: tex.crate }),
    mud: new THREE.MeshPhongMaterial({ map: tex.mud, specular: 0x8a7258, shininess: 90 }),
    net: new THREE.MeshLambertMaterial({ map: tex.net, alphaTest: 0.5, side: THREE.DoubleSide }),
    rope: new THREE.MeshLambertMaterial({ map: tex.rope }),
    steel: new THREE.MeshPhongMaterial({ color: 0x9aa4ad, specular: 0x6a6f73, shininess: 60 }),
    rubber: new THREE.MeshLambertMaterial({ color: 0x2a2a2c }),
    glowCyan: new THREE.MeshBasicMaterial({ color: 0x63f2ff }),
    glowOrange: new THREE.MeshBasicMaterial({ color: 0xff8a2a }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff4e12 }),
    mesa: new THREE.MeshLambertMaterial({ color: 0x9c7a64, flatShading: true }),
  };
  const tiles = {
    ground: 4,
    metal: 4,
    metalDark: 4,
    hazard: 1,
    plank: 2.4,
    concrete: 3,
    mud: 3,
    net: 1.2,
    rope: 0.5,
  };
  for (const [name, mat] of Object.entries(m)) {
    mat.name = name;
    mat.userData.tile = tiles[name] ?? 0;
  }
  return m;
}
