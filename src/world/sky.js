import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../util/rng.js';
import { gfx } from '../render/gfx.js';

export const FOG_COLOR = 0xcad7d9;

// Gradient sky dome, a ringed gas giant and two rings of distant mesas. All cheap, unlit.
export function createSky(textures, materials) {
  const group = new THREE.Group();
  group.name = 'sky';

  const R = 520;
  const domeGeom = new THREE.SphereGeometry(R, 32, 16);
  const top = new THREE.Color(0x2b5c9b);
  const mid = new THREE.Color(0x8fb9d6);
  const horizon = new THREE.Color(FOG_COLOR);
  const below = new THREE.Color(0xa58d78);
  const colors = [];
  const pos = domeGeom.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / R;
    if (h >= 0) {
      const t = Math.pow(h, 0.55);
      if (t < 0.5) c.lerpColors(horizon, mid, t * 2);
      else c.lerpColors(mid, top, (t - 0.5) * 2);
    } else {
      c.lerpColors(horizon, below, Math.min(1, -h * 6));
    }
    colors.push(c.r, c.g, c.b);
  }
  domeGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    domeGeom,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  // Drawn after the opaque arena, so the arena's depth hides most of the dome's pixels.
  dome.renderOrder = gfx.skyLast ? 1 : -10;
  dome.name = 'skyDome';
  group.add(dome);

  const planet = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshBasicMaterial({ map: textures.planet, transparent: true, fog: false, depthWrite: false }),
  );
  const az = -0.75;
  const el = 0.42;
  const dist = 470;
  planet.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist);
  planet.lookAt(0, 0, 0);
  planet.renderOrder = -9;
  planet.name = 'planet';
  group.add(planet);

  // Both rings of mesas in one mesh.
  const mesas = new THREE.Mesh(
    mergeGeometries([mesaRing(200, 250, 10, 34, 64, 1), mesaRing(310, 370, 24, 62, 48, 2)], false),
    materials.mesa,
  );
  mesas.name = 'mesas';
  group.add(mesas);

  return group;
}

// A jagged ring of flat-topped hills, open on the inside, built as a single strip.
function mesaRing(rMin, rMax, hMin, hMax, segments, seed) {
  const rand = mulberry32(seed * 977);
  const verts = [];
  const ring = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = rMin + rand() * (rMax - rMin);
    // Plateaus: hold the height for a couple of segments now and then.
    const h = rand() < 0.35 && ring.length ? ring[ring.length - 1].h : hMin + rand() * (hMax - hMin);
    ring.push({ x: Math.sin(a) * r, z: -Math.cos(a) * r, h });
  }
  for (let i = 0; i < segments; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % segments];
    const yb = -6;
    // Two triangles per segment, wound to face the arena.
    verts.push(p.x, yb, p.z, q.x, yb, q.z, p.x, p.h, p.z);
    verts.push(q.x, yb, q.z, q.x, q.h, q.z, p.x, p.h, p.z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.computeVertexNormals();
  return geom;
}
