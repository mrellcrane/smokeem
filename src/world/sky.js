import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../util/rng.js';
import { gfx } from '../render/gfx.js';
import { createSkyline } from './skyline.js';
import { skyBoost } from '../render/grade.js';

// Gradient sky dome with the sun's glow painted in, a band of clouds around the horizon, a
// ringed gas giant, two rings of distant mesas and (outdoors, look.sky.skyline) the facility
// skyline around the arena (skyline.js). All cheap, unlit or Lambert. Colors come from the
// map's look (looks.js). The returned group's update(time) drifts the clouds and runs the
// skyline.
export function createSky(textures, materials, look) {
  const group = new THREE.Group();
  group.name = 'sky';

  const R = 520;
  const domeGeom = new THREE.SphereGeometry(R, 32, 16);
  const top = new THREE.Color(look.sky.zenith);
  const mid = new THREE.Color(look.sky.mid);
  const horizon = new THREE.Color(look.sky.horizon);
  const below = new THREE.Color(look.sky.below);
  const colors = [];
  const pos = domeGeom.attributes.position;
  const c = new THREE.Color();
  // The sun's glow: warmer and brighter toward where it sits.
  const sun = new THREE.Vector3(...look.sun.dir).normalize();
  const glow = new THREE.Color(look.sun.color);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / R;
    if (h >= 0) {
      const t = Math.pow(h, 0.55);
      if (t < 0.5) c.lerpColors(horizon, mid, t * 2);
      else c.lerpColors(mid, top, (t - 0.5) * 2);
    } else {
      c.lerpColors(horizon, below, Math.min(1, -h * 6));
    }
    const near = Math.max(0, v.fromBufferAttribute(pos, i).normalize().dot(sun));
    c.lerp(glow, Math.pow(near, 6) * 0.55 + Math.pow(near, 40) * 0.4);
    colors.push(c.r, c.g, c.b);
  }
  domeGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    domeGeom,
    // (Brighter under the color grade, which rolls the horizon off to white.)
    new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color().setScalar(skyBoost(look)), side: THREE.BackSide, fog: false, depthWrite: false }),
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

  // A band of clouds around the horizon, drifting slowly.
  const clouds = new THREE.Mesh(
    new THREE.CylinderGeometry(480, 480, 150, 48, 1, true).translate(0, 62, 0),
    new THREE.MeshBasicMaterial({
      map: cloudTexture(),
      color: new THREE.Color(look.sky.horizon).lerp(new THREE.Color(0xffffff), 0.5).multiplyScalar(skyBoost(look)),
      transparent: true,
      fog: false,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  clouds.name = 'clouds';
  clouds.material.name = 'clouds';
  clouds.frustumCulled = false;
  group.add(clouds);
  const skyline = look.sky.skyline && gfx.skyline ? createSkyline(look) : null;
  if (skyline) group.add(skyline.group);
  group.update = (time) => {
    clouds.material.map.offset.x = time * 0.0008;
    skyline?.update(time);
  };

  // Both rings of mesas in one mesh (not for indoor maps).
  if (look.sky.mesas === false) return group;
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

// Soft clouds on a transparent strip that wraps around (repeated twice round the band): flat
// bottoms low down, puffy tops, thinning out toward the band's top and bottom edges.
function cloudTexture() {
  const W = 1024;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const rand = mulberry32(777);
  const puff = (x, y, r, a) => {
    for (const ox of [-W, 0, W]) {
      const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  };
  // Banks of puffs low on the band, a few thin streaks higher up.
  for (let i = 0; i < 26; i++) {
    const x = rand() * W;
    const base = H * (0.72 + rand() * 0.12);
    const n = 5 + Math.floor(rand() * 8);
    const spread = 40 + rand() * 90;
    for (let k = 0; k < n; k++) puff(x + (rand() - 0.5) * spread * 2, base - rand() * 22, 12 + rand() * 22, 0.22 + rand() * 0.2);
  }
  for (let i = 0; i < 10; i++) {
    const x = rand() * W;
    const y = H * (0.3 + rand() * 0.3);
    for (let k = 0; k < 8; k++) puff(x + k * 14, y + (rand() - 0.5) * 4, 10 + rand() * 6, 0.08);
  }
  // Fade the strip's own edges.
  const img = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const f = Math.min(1, t / 0.25) * Math.min(1, (1 - t) / 0.08);
    for (let x = 0; x < W; x++) img.data[(y * W + x) * 4 + 3] *= f;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}
