import * as THREE from 'three';
import dirt from './photos/dirt.jpg';
import dirtN from './photos/dirt_n.jpg';
import concrete from './photos/concrete.jpg';
import concreteN from './photos/concrete_n.jpg';
import planks from './photos/planks.jpg';
import planksN from './photos/planks_n.jpg';

// Photo textures (CC0 scans from Poly Haven, photos/CREDITS.md, tools/fetch_photos.py) for maps
// whose look sets `photo` (gfx switch `photoTextures`): they stand in for the painted canvases of
// the same names (textures.js), each with its real size in meters as its tile. Loaded only for
// such a map. On High their normal maps come too, as for the painted ones.

const SETS = {
  ground: { map: dirt, normal: dirtN, tile: 2 },
  concrete: { map: concrete, normal: concreteN, tile: 3 },
  plank: { map: planks, normal: planksN, tile: 2 },
};

// Each material the photos replace gets this (linear) color over its photo: the scans are shot
// darker than the painted canvases, which carry their own light, so they're brought up to about
// the same brightness under the same lighting (measured as mean linear luminance), keeping their
// own hue. (The metals keep their painted panels and rivets: a scanned plate read as muddy
// concrete next to them.)
export const PHOTO_TINTS = {
  ground: [1.8, 1.8, 1.8],
  concrete: [2.8, 2.8, 2.8],
  plank: [2.3, 2.3, 2.3],
};

const loader = new THREE.TextureLoader();
const cache = new Map();
function load(url, srgb) {
  const key = `${url}|${srgb}`;
  if (!cache.has(key)) cache.set(key, loader.loadAsync(url));
  return cache.get(key).then((t) => {
    // (A clone per match: the game disposes its textures when the match ends.)
    const c = t.clone();
    c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.needsUpdate = true;
    return c;
  });
}

// The photo textures, keyed as textures.js keys its own (plus `<name>Normal` with normals), and
// their tiles in meters.
export async function loadPhotos({ normals = false } = {}) {
  const textures = {};
  const tiles = {};
  await Promise.all(
    Object.entries(SETS).map(async ([name, s]) => {
      textures[name] = await load(s.map, true);
      if (normals) textures[`${name}Normal`] = await load(s.normal, false);
      tiles[name] = s.tile;
    }),
  );
  return { textures, tiles };
}
