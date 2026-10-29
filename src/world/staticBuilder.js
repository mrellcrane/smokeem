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
const _center = new THREE.Vector3();
const _box = new THREE.Box3();

// Glow pools on the floor (bake.js): falloff radius (m) and strength of a glowing strip.
const GLOW_RADIUS = 1.2;
const GLOW_K = 0.8;

// A glow tint (materials.js) draws with its shared material, the tint as a vertex color.
function resolve(mat) {
  return mat?.tintOf ? [mat.tintOf, mat.tint] : [mat, null];
}

// A box like BoxGeometry (same face order, normals and 0 to 1 UVs per face), but only the side
// faces are split: ws and ds columns along x and z, hs rows up. The top and bottom only get the
// vertices their edges share with the sides (a strip when one side is 1 column, else a fan from
// the middle), so the box stays watertight: a vertex in the middle of another face's edge
// (a T-junction) can crack open into single-pixel holes.
function sideBox(w, h, d, ws, hs, ds) {
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const v = new THREE.Vector3();
  const plane = (u, vv, wAxis, udir, vdir, width, height, depth, gridX, gridY) => {
    const start = pos.length / 3;
    for (let iy = 0; iy <= gridY; iy++) {
      const y = (iy * height) / gridY - height / 2;
      for (let ix = 0; ix <= gridX; ix++) {
        const x = (ix * width) / gridX - width / 2;
        v[u] = x * udir;
        v[vv] = y * vdir;
        v[wAxis] = depth / 2;
        pos.push(v.x, v.y, v.z);
        v[u] = 0;
        v[vv] = 0;
        v[wAxis] = depth > 0 ? 1 : -1;
        nor.push(v.x, v.y, v.z);
        uvs.push(ix / gridX, 1 - iy / gridY);
      }
    }
    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = start + ix + (gridX + 1) * iy;
        const b = start + ix + (gridX + 1) * (iy + 1);
        const c = start + ix + 1 + (gridX + 1) * (iy + 1);
        const e = start + ix + 1 + (gridX + 1) * iy;
        idx.push(a, b, e, b, c, e);
      }
    }
  };
  plane('z', 'y', 'x', -1, -1, d, h, w, ds, hs);
  plane('z', 'y', 'x', 1, -1, d, h, -w, ds, hs);
  const cap = (vdir, height) => {
    if (ws === 1 || ds === 1) {
      plane('x', 'z', 'y', 1, vdir, w, d, height, ws, ds);
      return;
    }
    const start = pos.length / 3;
    // The middle, then the edge vertices in order around the face.
    const ring = [[ws / 2, ds / 2]];
    for (let ix = 0; ix < ws; ix++) ring.push([ix, 0]);
    for (let iy = 0; iy < ds; iy++) ring.push([ws, iy]);
    for (let ix = ws; ix > 0; ix--) ring.push([ix, ds]);
    for (let iy = ds; iy > 0; iy--) ring.push([0, iy]);
    for (const [ix, iy] of ring) {
      pos.push((ix * w) / ws - w / 2, height / 2, ((iy * d) / ds - d / 2) * vdir);
      nor.push(0, height > 0 ? 1 : -1, 0);
      uvs.push(ix / ws, 1 - iy / ds);
    }
    const n = ring.length - 1;
    for (let k = 0; k < n; k++) idx.push(start, start + 1 + ((k + 1) % n), start + 1 + k);
  };
  cap(1, h);
  cap(-1, -h);
  plane('x', 'y', 'z', 1, -1, w, h, d, ws, hs);
  plane('x', 'y', 'z', -1, -1, w, h, -d, ws, hs);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(idx);
  return geom;
}

// sideBox face order: +x, -x, +y, -y, +z, -z. Each face's UVs run 0 to 1; scale them to meters.
// Upright boxes (not tilted, so not ramps) also turn their top around, so a texture's "up"
// (the light its relief is painted with, see textures.js) points to world +z, toward the sun's
// side, as it does up every wall. min: the world min corner of an axis-aligned box: its top and
// bottom then sit on one world grid, so the floor's pattern runs on across neighboring boxes.
function worldUvBox(geom, w, h, d, tile, ws, hs, ds, upright = false, min = null) {
  const uv = geom.attributes.uv;
  const x = (ds + 1) * (hs + 1);
  const y = ws === 1 || ds === 1 ? (ws + 1) * (ds + 1) : 2 * (ws + ds) + 1;
  const z = (ws + 1) * (hs + 1);
  const faces = [
    [d, h, x], [d, h, x],
    [w, d, y], [w, d, y],
    [w, h, z], [w, h, z],
  ];
  // Per face: u = (u0 * su * a + ou) / tile, v likewise. Top (u0 runs with +x, v0 against +z)
  // turned around: u = -x, v = +z. Bottom (u0 with +x, v0 with +z): u = x, v = z.
  const [mx, , mz] = min ?? [0, 0, 0];
  const top = upright ? [-1, min ? -mx : 0, -1, min ? mz + d : 0] : [1, 0, 1, 0];
  const bottom = [1, min ? mx : 0, 1, min ? mz : 0];
  let idx = 0;
  faces.forEach(([su, sv, count], f) => {
    const [au, ou, av, ov] = f === 2 ? top : f === 3 ? bottom : [1, 0, 1, 0];
    for (let i = 0; i < count; i++, idx++) uv.setXY(idx, (uv.getX(idx) * su * au + ou) / tile, (uv.getY(idx) * sv * av + ov) / tile);
  });
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
    // Glowing strips that get a halo (beacons.js).
    this.halos = [];
    // Collider handle to what it's made of (materials.js surface), for bullet impacts.
    this.surfaces = new Map();
    // Handles of the invisible blockers (collider()), which can't be kicked off.
    this.blockers = new Set();
    // Visible boxes and cylinders with no collider (trims standing proud of a collider), so
    // bullet marks can sit on their face (Game.trimFace).
    this.trims = [];
  }

  // shade: whether build() shades the vertices (quads and glows don't get it).
  // light: whether a glow tint also adds its glow pool to the floor bake.
  _add(mat, geom, castShadow, tint = null, shade = true, light = true) {
    if (tint !== null) {
      _col.set(tint);
      const n = geom.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) _col.toArray(col, i * 3);
      geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (light) {
        geom.computeBoundingBox();
        _box.copy(geom.boundingBox);
        this.light(_box.min.toArray(), _box.max.toArray(), tint);
      }
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
  // walkable ground: the bake measures heights from it), halo (a glowing strip's open face as
  // an axis normal like [0, 0, 1]: beacons.js draws a soft glow around it there), bakeLight
  // (default true: a glow tint lights the floor bake; false to place that light with light()).
  box(matOrTint, center, size, opts = {}) {
    const [mat, tint] = resolve(matOrTint);
    const [w, h, d] = size;
    const { rotY = 0, quat = null, uv = 'world', collide = true, visible = true, castShadow = true, floor = false, halo = null, bakeLight = true } = opts;
    const q = quat ? _q.copy(quat) : _q.setFromAxisAngle(UP, rotY);
    _p.set(center[0], center[1], center[2]);
    if (visible && mat) {
      // For the per-vertex shading: upright boxes get extra side rows, and long faces a
      // column every 2 m (so a face whose ends touch other solids still shades along its length).
      const rows = quat ? [0, h] : sideRows(h);
      const hs = rows.length - 1;
      const ws = Math.min(64, Math.max(1, Math.ceil(w / 2)));
      const ds = Math.min(64, Math.max(1, Math.ceil(d / 2)));
      const geom = sideBox(w, h, d, ws, hs, ds);
      placeRows(geom, h, rows);
      if (uv === 'world' && mat.userData.tile > 0) {
        const min = quat || rotY ? null : [center[0] - w / 2, center[1] - h / 2, center[2] - d / 2];
        worldUvBox(geom, w, h, d, mat.userData.tile, ws, hs, ds, !quat, min);
      }
      geom.applyMatrix4(_m.compose(_p, q, _s));
      this._add(mat, geom, castShadow, tint, true, bakeLight);
      if (!collide && !quat && !rotY) {
        const min = [center[0] - w / 2, center[1] - h / 2, center[2] - d / 2];
        this.trims.push({ min, max: [min[0] + w, min[1] + h, min[2] + d], surface: mat.userData.surface ?? null });
      }
      if (halo && !quat && !rotY) {
        const min = [center[0] - w / 2, center[1] - h / 2, center[2] - d / 2];
        this.halos.push({ min, max: [min[0] + w, min[1] + h, min[2] + d], normal: halo, color: tint ?? 0xffffff });
      }
      if (collide) {
        this.solids.push({ x: _p.x, y: _p.y, z: _p.z, hx: w / 2, hy: h / 2, hz: d / 2, quat: quat || rotY ? q.toArray() : null, floor });
      }
    }
    if (collide) {
      const c = this._collider(this.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), _p, q);
      if (mat?.userData.surface) this.surfaces.set(c.handle, mat.userData.surface);
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
    _p.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const desc = this.RAPIER.ColliderDesc.cuboid((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
    this.blockers.add(this._collider(desc, _p, null).handle);
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
    if (!collide) this.trims.push({ cyl: true, x: base[0], z: base[2], r: radius, y0: base[1], y1: base[1] + height, surface: mat.userData.surface ?? null });
    if (collide) {
      this.solids.push({ cyl: true, x: base[0], y: base[1] + height / 2, z: base[2], r: radius, hy: height / 2 });
      _p.set(base[0], base[1] + height / 2, base[2]);
      const c = this._collider(this.RAPIER.ColliderDesc.cylinder(height / 2, radius), _p, null);
      if (mat.userData.surface) this.surfaces.set(c.handle, mat.userData.surface);
    }
  }

  // Cylinder between two arbitrary points (rails, rungs, braces). Visual only by default.
  rod(mat, a, b, radius, opts = {}) {
    const { segments = 8, castShadow = true } = opts;
    // Steep rods (ropes) get side rows from their low end, like cylinders.
    if (a[1] > b[1]) [a, b] = [b, a];
    const pa = new THREE.Vector3(...a);
    const pb = new THREE.Vector3(...b);
    const dir = pb.clone().sub(pa);
    const len = dir.length();
    const rows = dir.y / len > 0.3 ? sideRows(len) : [0, len];
    const geom = new THREE.CylinderGeometry(radius, radius, len, segments, rows.length - 1, true);
    placeRows(geom, len, rows);
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
// Each side vertex looks just in front of its face, a little in from the face's edge; where
// that spot is inside another solid (a face end tucked into a wall or a platform), or a top
// vertex finds a neighbor's top flush with it (walls meeting at a corner), it measures from
// the floor instead.
function shadeVertices(geom, bake, grime) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const col = new Float32Array(pos.count * 3).fill(1);
  if (bake) {
    geom.computeBoundingBox();
    geom.boundingBox.getCenter(_center);
    const top = geom.boundingBox.max.y - 1e-3;
    for (let i = 0; i < pos.count; i++) {
      _n.fromBufferAttribute(nor, i);
      let c = 1;
      if (_n.y > 0.5) c = 1;
      else if (_n.y < -0.5) c = 0.7;
      else {
        _n.y = 0;
        _n.normalize();
        const y = pos.getY(i);
        // In from the edge: toward the middle, along the face, up to 0.3 m.
        let tx = _center.x - pos.getX(i);
        let tz = _center.z - pos.getZ(i);
        const across = tx * _n.x + tz * _n.z;
        tx -= across * _n.x;
        tz -= across * _n.z;
        const tl = Math.hypot(tx, tz);
        const pull = tl > 1e-6 ? Math.min(0.3, tl) / tl : 0;
        const x = pos.getX(i) + _n.x * 0.2 + tx * pull;
        const z = pos.getZ(i) + _n.z * 0.2 + tz * pull;
        let floor = bake.floorBelow(x, y, z);
        if (floor === Infinity || (y >= top && floor >= y - 1e-3)) floor = Math.min(y, bake.groundAt(x, z));
        const h = y - floor;
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
