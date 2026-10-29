import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collects static level geometry, then merges it into one mesh per material (few draw calls,
// which matters a lot with 3 split-screen views) and creates matching fixed Rapier colliders.
// It also records every visible solid and glow source for the arena bake (bake.js), and at
// build() shades each vertex: walls and props darken toward the floor and into corners.

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();
const _n = new THREE.Vector3();
const _box = new THREE.Box3();

// Glow pools on the floor (bake.js): falloff radius (m) and strength of a glowing strip.
const GLOW_RADIUS = 1.2;
const GLOW_K = 0.8;

// A glow tint (materials.js) draws with its shared material, the tint as a vertex color.
function resolve(mat) {
  return mat?.tintOf ? [mat.tintOf, mat.tint] : [mat, null];
}

// BoxGeometry face order: +x, -x, +y, -y, +z, -z. With one width and depth segment and hs
// height segments the side faces have 2 * (hs + 1) vertices and the top and bottom 4. Each
// face's UVs run 0 to 1; scale them to meters.
function worldUvBox(geom, w, h, d, tile, hs) {
  const uv = geom.attributes.uv;
  const side = 2 * (hs + 1);
  const faces = [
    [d, h, side], [d, h, side],
    [w, d, 4], [w, d, 4],
    [w, h, side], [w, h, side],
  ];
  let idx = 0;
  for (const [su, sv, count] of faces) {
    for (let i = 0; i < count; i++, idx++) uv.setXY(idx, (uv.getX(idx) * su) / tile, (uv.getY(idx) * sv) / tile);
  }
  uv.needsUpdate = true;
}

// Rows of vertices up the sides of a box or cylinder of height h (from its base), so the
// per-vertex shading has a row near the floor: none in between below 0.8 m, one at 0.6 m up to
// 3 m, and one more at 2.5 m above that.
function sideRows(h) {
  if (h < 0.8) return [0, h];
  if (h <= 3) return [0, Math.min(0.6, h / 2), h];
  return [0, 0.6, 2.5, h];
}

// Moves the evenly spaced side rows of a box or cylinder geometry (centered, height h, not yet
// placed) to `rows`, keeping side UVs in step (they run 0 to 1 up the side).
function placeRows(geom, h, rows) {
  const n = rows.length - 1;
  if (n < 2) return;
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const uv = geom.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(((pos.getY(i) + h / 2) / h) * n);
    pos.setY(i, rows[k] - h / 2);
    if (nor.getY(i) === 0) uv.setY(i, rows[k] / h);
  }
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

export class StaticBuilder {
  constructor(RAPIER, world) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.groups = new Map();
    this.meshes = [];
    // For the bake: visible solids, glow sources and floor stains.
    this.solids = [];
    this.lights = [];
    this.stains = [];
  }

  // shade: whether build() shades the vertices (quads and glows don't get it).
  _add(mat, geom, castShadow, tint = null, shade = true) {
    if (tint !== null) {
      _col.set(tint);
      const n = geom.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) _col.toArray(col, i * 3);
      geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geom.computeBoundingBox();
      _box.copy(geom.boundingBox);
      this.light(_box.min.toArray(), _box.max.toArray(), tint);
    }
    const key = `${mat.uuid}|${castShadow ? 1 : 0}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { mat, castShadow, geoms: [] };
      this.groups.set(key, g);
    }
    g.geoms.push({ geom, shade: shade && tint === null });
  }

  // A glow source for the floor bake, as a world box. Glowing strips add themselves.
  light(min, max, color, radius = GLOW_RADIUS, k = GLOW_K) {
    this.lights.push({ min, max, color, radius, k });
  }

  // Darkens the floor around an x/z rectangle ([x0, z0], [x1, z1]) by `amount` (0.12 = 12%),
  // fading out over `width` meters (damp ground, soot).
  stain(min, max, width, amount) {
    this.stains.push({ min, max, width, amount: -amount });
  }

  _collider(desc, pos, quat) {
    desc.setTranslation(pos.x, pos.y, pos.z);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    return this.world.createCollider(desc);
  }

  // Box by center and size. Options: rotY (radians) or quat, uv ('world' | 'fit'),
  // collide (default true), visible (default true), castShadow (default true), floor (it's
  // walkable ground: the bake measures heights from it).
  box(matOrTint, center, size, opts = {}) {
    const [mat, tint] = resolve(matOrTint);
    const [w, h, d] = size;
    const { rotY = 0, quat = null, uv = 'world', collide = true, visible = true, castShadow = true, floor = false } = opts;
    const q = quat ? _q.copy(quat) : _q.setFromAxisAngle(UP, rotY);
    _p.set(center[0], center[1], center[2]);
    if (visible && mat) {
      // Upright boxes get extra side rows for the per-vertex shading.
      const rows = quat ? [0, h] : sideRows(h);
      const hs = rows.length - 1;
      const geom = new THREE.BoxGeometry(w, h, d, 1, hs, 1);
      placeRows(geom, h, rows);
      if (uv === 'world' && mat.userData.tile > 0) worldUvBox(geom, w, h, d, mat.userData.tile, hs);
      geom.applyMatrix4(_m.compose(_p, q, _s));
      this._add(mat, geom, castShadow, tint);
      if (collide) {
        this.solids.push({ x: _p.x, y: _p.y, z: _p.z, hx: w / 2, hy: h / 2, hz: d / 2, quat: quat || rotY ? q.toArray() : null, floor });
      }
    }
    if (collide) {
      this._collider(this.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), _p, q);
    }
  }

  // Axis-aligned box from min and max corners.
  boxMinMax(mat, min, max, opts) {
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    this.box(mat, center, size, opts);
  }

  // Invisible blocker.
  collider(min, max) {
    this.boxMinMax(null, min, max, { visible: false });
  }

  // Vertical cylinder by base center.
  cylinder(matOrTint, base, radius, height, opts = {}) {
    const [mat, tint] = resolve(matOrTint);
    const { segments = 10, collide = true, castShadow = true } = opts;
    const rows = sideRows(height);
    const geom = new THREE.CylinderGeometry(radius, radius, height, segments, rows.length - 1);
    placeRows(geom, height, rows);
    const tile = mat.userData.tile;
    if (tile > 0) {
      const uv = geom.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (uv.getX(i) * Math.PI * 2 * radius) / tile, (uv.getY(i) * height) / tile);
      }
    }
    geom.translate(base[0], base[1] + height / 2, base[2]);
    this._add(mat, geom, castShadow, tint);
    if (collide) {
      this.solids.push({ cyl: true, x: base[0], y: base[1] + height / 2, z: base[2], r: radius, hy: height / 2 });
      _p.set(base[0], base[1] + height / 2, base[2]);
      this._collider(this.RAPIER.ColliderDesc.cylinder(height / 2, radius), _p, null);
    }
  }

  // Cylinder between two arbitrary points (rails, rungs, braces). Visual only by default.
  rod(mat, a, b, radius, opts = {}) {
    const { segments = 8, castShadow = true } = opts;
    const pa = new THREE.Vector3(...a);
    const pb = new THREE.Vector3(...b);
    const dir = pb.clone().sub(pa);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(radius, radius, len, segments, 1, true);
    const tile = mat.userData.tile;
    if (tile > 0) {
      const uv = geom.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (uv.getX(i) * Math.PI * 2 * radius) / tile, (uv.getY(i) * len) / tile);
      }
    }
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    const mid = pa.add(pb).multiplyScalar(0.5);
    geom.applyMatrix4(_m.compose(mid, q, _s));
    this._add(mat, geom, castShadow);
  }

  // Sloped slab whose top surface runs from p0 to p1 (both on the top surface centerline).
  ramp(mat, p0, p1, width, thickness = 0.3, opts = {}) {
    const a = new THREE.Vector3(...p0);
    const b = new THREE.Vector3(...p1);
    _z.copy(b).sub(a);
    const len = _z.length();
    _z.normalize();
    _x.crossVectors(UP, _z).normalize();
    _y.crossVectors(_z, _x).normalize();
    _m.makeBasis(_x, _y, _z);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m);
    const center = a.add(b).multiplyScalar(0.5).addScaledVector(_y, -thickness / 2);
    // Slightly longer than the run so the ends tuck into the ground and the platform.
    this.box(mat, [center.x, center.y, center.z], [width, thickness, len + 0.3], { ...opts, quat: q });
  }

  // A flat textured quad (nets). Visual only.
  quad(mat, corners, opts = {}) {
    const { castShadow = true, uvSize = null } = opts;
    const [p0, p1, p2, p3] = corners.map((c) => new THREE.Vector3(...c));
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array([...p0.toArray(), ...p1.toArray(), ...p2.toArray(), ...p3.toArray()]);
    const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize();
    const nor = new Float32Array([...n.toArray(), ...n.toArray(), ...n.toArray(), ...n.toArray()]);
    const tile = mat.userData.tile || 1;
    const uw = (uvSize ? uvSize[0] : p0.distanceTo(p1)) / tile;
    const vh = (uvSize ? uvSize[1] : p0.distanceTo(p3)) / tile;
    const uvs = new Float32Array([0, 0, uw, 0, uw, vh, 0, vh]);
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    this._add(mat, geom, castShadow, null, false);
  }

  // Merge everything into the scene. Returns the created meshes. bake (bake.js, optional):
  // shade vertices from it.
  build(scene, bake = null) {
    for (const g of this.groups.values()) {
      for (const { geom, shade } of g.geoms) {
        if (!geom.attributes.color) shadeVertices(geom, shade ? bake : null, g.mat.userData.grime);
      }
      const merged = mergeGeometries(
        g.geoms.map((e) => e.geom),
        false,
      );
      for (const { geom } of g.geoms) geom.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, g.mat);
      mesh.name = `static:${g.mat.name}`;
      mesh.castShadow = g.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.groups.clear();
    return this.meshes;
  }
}

// Per-vertex light as a vertex color (1 = untouched). Side faces darken toward whatever they
// stand on (to 0.6 at the base), more in inside corners (the floor bake's contact light), and
// metal and concrete get a little grime low down. Undersides are a bit darker; tops untouched.
function shadeVertices(geom, bake, grime) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const col = new Float32Array(pos.count * 3).fill(1);
  if (bake) {
    for (let i = 0; i < pos.count; i++) {
      _n.fromBufferAttribute(nor, i);
      let c = 1;
      if (_n.y > 0.5) c = 1;
      else if (_n.y < -0.5) c = 0.7;
      else {
        _n.y = 0;
        _n.normalize();
        const x = pos.getX(i) + _n.x * 0.2;
        const y = pos.getY(i);
        const z = pos.getZ(i) + _n.z * 0.2;
        const h = y - bake.floorBelow(x, y, z);
        if (h < Infinity) {
          c = mix(0.6, 1, smooth(0, 0.6, h));
          c *= mix(mix(1, bake.lightAt(x, z), 0.5), 1, smooth(0, 1.5, h));
          if (grime) c *= mix(0.85, 1, smooth(0, 2.5, h));
        }
      }
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
    }
  }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
