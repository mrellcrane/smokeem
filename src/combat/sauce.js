import * as THREE from 'three';

// The Sauce Boss's puddles (game.sauce, built only in a set with the Sauce Boss). A glob that
// lands splats into a round puddle of hot sauce on the floor under it, for a while. Anyone
// standing in one is slicked (Player.slickT: slower, and sliding about with little grip) and
// Basted (Player.bastedT: takes BASTED_MUL damage, combat/damage.js) for a few seconds after
// they step out. A direct hit bastes too. Drawn as one instanced mesh of glossy discs that
// shrink away as they dry.

const MAX_PUDDLES = 10;
// How long being Basted lasts after the last touch of sauce, and how much more damage it means.
export const BASTED_TIME = 4;
export const BASTED_MUL = 1.25;
// Slicked lasts this long after stepping out (a few slippery steps).
const SLICK_TIME = 0.35;
// How far over (and under) a puddle's surface someone's feet can be and still be in it.
const DEPTH = 0.45;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const _floor = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null };

export class Sauce {
  constructor(game) {
    this.game = game;
    this.puddles = [];
    // A flat disc with a ragged edge, lying on the floor; glossy and a little self-lit.
    const g = new THREE.CircleGeometry(1, 20);
    const pos = g.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      const r = 0.82 + 0.18 * Math.abs(Math.sin(a * 3.1) * Math.cos(a * 1.7 + 0.6));
      pos.setXY(i, pos.getX(i) * r, pos.getY(i) * r);
    }
    g.rotateX(-Math.PI / 2);
    this.material = new THREE.MeshPhongMaterial({
      color: 0x7a1a0a,
      emissive: 0x2a0600,
      specular: 0xffc0a0,
      shininess: 80,
      // (Drawn just over the floor, pulled toward the camera so it never flickers into it.)
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(g, this.material, MAX_PUDDLES);
    this.mesh.name = 'sauce';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    game.scene.add(this.mesh);
  }

  // A glob landed at `point` (hit `normal`; `wall`: the normal of a wall it hit, or null): a
  // puddle on the floor under it, if there's one close below.
  splat(point, normal, wall, { radius, time }, owner) {
    _p.copy(point);
    if (normal) _p.addScaledVector(normal, 0.1);
    const floor = this.game.surfaceNear(_p.setY(_p.y + 0.3), DOWN, 4, _floor);
    if (!floor || floor.normal.y < 0.7) return;
    // On the mud, it floats on the surface instead (no collider there).
    const mudY = this.game.zones.mudTop(floor.point, 4);
    const y = Math.max(floor.point.y, mudY ?? -Infinity) + 0.015;
    if (this.puddles.length >= MAX_PUDDLES) this.puddles.shift();
    this.puddles.push({ x: floor.point.x, y, z: floor.point.z, radius, life: time, time, spin: Math.random() * Math.PI * 2, owner });
    this.game.sfx.play('squish', { at: floor.point, volume: 1.1, rate: 0.8 });
  }

  tick(dt) {
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      if ((this.puddles[i].life -= dt) <= 0) this.puddles.splice(i, 1);
    }
    if (!this.puddles.length) return;
    for (const p of this.game.players) {
      if (!p.alive || p.vehicle) continue;
      const feet = p.feetY();
      for (const pd of this.puddles) {
        // (It shrinks as it dries.)
        const r = pd.radius * this.size(pd);
        const dx = p.center.x - pd.x;
        const dz = p.center.z - pd.z;
        if (dx * dx + dz * dz > r * r || Math.abs(feet - pd.y) > DEPTH) continue;
        p.slickT = SLICK_TIME;
        p.baste();
        break;
      }
    }
  }

  // A puddle's size now (it dries from the edges in its last few seconds).
  size(pd) {
    return Math.min(1, pd.life / 2.5) * (0.35 + 0.65 * Math.min(1, (pd.time - pd.life) * 6));
  }

  updateVisuals() {
    let n = 0;
    for (const pd of this.puddles) {
      const r = pd.radius * this.size(pd);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, pd.spin);
      this.mesh.setMatrixAt(n++, _m.compose(_p.set(pd.x, pd.y, pd.z), _q, _s.set(r, 1, r)));
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  warmup(on, at) {
    if (on) {
      this.mesh.setMatrixAt(0, _m.compose(at, _q.identity(), _s.set(1, 1, 1)));
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.mesh.count = on ? 1 : 0;
    this.mesh.visible = on;
  }

  clear() {
    this.puddles.length = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
