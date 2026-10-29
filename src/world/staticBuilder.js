import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collects static level geometry, then merges it into one mesh per material (few draw calls,
// which matters a lot with 3 split-screen views) and creates matching fixed Rapier colliders.

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();

// A glow tint (materials.js) draws with its shared material, the tint as a vertex color.
function resolve(mat) {
  return mat?.tintOf ? [mat.tintOf, mat.tint] : [mat, null];
}

// BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each). Scale UVs to meters.
function worldUvBox(geom, w, h, d, tile) {
  const uv = geom.attributes.uv;
  const faceDims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceDims[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * su) / tile, (uv.getY(idx) * sv) / tile);
    }
  }
  uv.needsUpdate = true;
}

export class StaticBuilder {
  constructor(RAPIER, world) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.groups = new Map();
    this.meshes = [];
  }

  _add(mat, geom, castShadow, tint = null) {
    if (tint !== null) {
      _col.set(tint);
      const n = geom.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) _col.toArray(col, i * 3);
      geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const key = `${mat.uuid}|${castShadow ? 1 : 0}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { mat, castShadow, geoms: [] };
      this.groups.set(key, g);
    }
    g.geoms.push(geom);
  }

  _collider(desc, pos, quat) {
    desc.setTranslation(pos.x, pos.y, pos.z);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    return this.world.createCollider(desc);
  }

  // Box by center and size. Options: rotY (radians) or quat, uv ('world' | 'fit'),
  // collide (default true), visible (default true), castShadow (default true).
  box(matOrTint, center, size, opts = {}) {
    const [mat, tint] = resolve(matOrTint);
    const [w, h, d] = size;
    const { rotY = 0, quat = null, uv = 'world', collide = true, visible = true, castShadow = true } = opts;
    const q = quat ? _q.copy(quat) : _q.setFromAxisAngle(UP, rotY);
    _p.set(center[0], center[1], center[2]);
    if (visible && mat) {
      const geom = new THREE.BoxGeometry(w, h, d);
      if (uv === 'world' && mat.userData.tile > 0) worldUvBox(geom, w, h, d, mat.userData.tile);
      geom.applyMatrix4(_m.compose(_p, q, _s));
      this._add(mat, geom, castShadow, tint);
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
    const geom = new THREE.CylinderGeometry(radius, radius, height, segments, 1);
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
    this._add(mat, geom, castShadow);
  }

  // Merge everything into the scene. Returns the created meshes.
  build(scene) {
    for (const g of this.groups.values()) {
      const merged = mergeGeometries(g.geoms, false);
      for (const geom of g.geoms) geom.dispose();
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
