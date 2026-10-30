import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { partsGeometry } from '../combat/weaponModels.js';
import { dealDamage } from '../combat/damage.js';
import { explode } from '../combat/explosions.js';

// Loose props for the Gravity Gun to throw (only in matches whose set has it): crates, barrels
// and propane tanks, as Rapier dynamic bodies around the pickup pads, plus the map's own small
// crates and drums, which come loose in such a match (StaticBuilder `loose`, drawn with the map's
// own materials, one instanced mesh each, scaled per crate). People bump and shove them
// (Player.moveBy collides with props), but shots pass through them.
// A prop thrown by a gravity gun hurts whoever it hits hard, once per throw; a propane tank goes
// off when a thrown one hits hard or a blast catches it. Lost or blown-up props come back at
// their spot after a while. One instanced mesh per kind.

const KINDS = {
  // The map's own (parts.js): a crate of any size (half extents set per crate) and a drum.
  mapCrate: { half: [0.5, 0.5, 0.5], density: 0.9, restitution: 0.12, damage: 55 },
  mapDrum: { cyl: [0.55, 0.45], density: 1.1, restitution: 0.18, damage: 60 },
  crate: { half: [0.32, 0.32, 0.32], density: 1.2, restitution: 0.15, damage: 55, look: 'crate' },
  barrel: { cyl: [0.42, 0.28], density: 1.4, restitution: 0.2, damage: 60, look: 'barrel' },
  propane: {
    cyl: [0.28, 0.16],
    density: 1,
    restitution: 0.3,
    damage: 30,
    look: 'propane',
    explosion: { radius: 4.2, inner: 0.8, damage: 110, knockback: 12, tint: 0xffa040 },
  },
};
// A thrown prop hurts on impact while faster than this (m/s), within this long of the throw.
const HURT_SPEED = 7;
const HURT_TIME = 2;
const RESPAWN = 25;
// Around each pickup pad, at this distance: crate, barrel, propane.
const AROUND = [
  ['crate', 2.6, 0.4],
  ['barrel', 2.8, 2.5],
  ['propane', 2.4, 4.4],
];

function propGeometry(kind) {
  if (kind === 'crate') {
    return partsGeometry(
      [
        [[0, 0, 0], [0.64, 0.64, 0.64], 0x9a6a3c],
        [[0, 0, 0.322], [0.6, 0.08, 0.004], 0x6e4526],
        [[0, 0, -0.322], [0.6, 0.08, 0.004], 0x6e4526],
        [[0.322, 0, 0], [0.004, 0.08, 0.6], 0x6e4526],
        [[-0.322, 0, 0], [0.004, 0.08, 0.6], 0x6e4526],
      ],
      0x9a6a3c,
    );
  }
  const [h, r] = KINDS[kind].cyl;
  const tint = (g, color) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) c.toArray(col, k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  };
  const cyl = (rad, height, y, color) => tint(new THREE.CylinderGeometry(rad, rad, height, 14).translate(0, y, 0), color);
  const parts =
    kind === 'barrel'
      ? [cyl(r, h * 2, 0, 0x3d6f8c), cyl(r * 1.04, h * 0.1, h * 0.55, 0x2a2d31), cyl(r * 1.04, h * 0.1, -h * 0.55, 0x2a2d31), cyl(r * 0.25, 0.02, h + 0.01, 0x2a2d31)]
      : [cyl(r, h * 1.7, -h * 0.15, 0xc8382c), cyl(r * 0.75, h * 0.3, h * 0.85, 0xe8e2d6), cyl(r * 0.25, h * 0.2, h * 1.05, 0x8a9099)];
  return mergeGeometries(parts, false);
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _q = new THREE.Quaternion();
const _c = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// The map's crates and drums, for the map's own materials (unit sized; static materials read a
// vertex color, here plain).
function mapGeometry(kind) {
  const g = kind === 'mapCrate' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CylinderGeometry(0.45, 0.45, 1.1, 14);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    // (A drum's band, a little lighter and warmer up top, like the map's glowing ring.)
    const band = kind === 'mapDrum' && pos.getY(i) > 0.15 && pos.getY(i) < 0.3;
    col[i * 3] = band ? 1.6 : 0.9;
    col[i * 3 + 1] = band ? 0.9 : 0.9;
    col[i * 3 + 2] = band ? 0.5 : 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Props {
  // M: the match's materials. loose: the map's crates and drums that came loose (StaticBuilder).
  constructor(game, M, pads, loose = []) {
    this.game = game;
    this.list = [];
    this.meshes = {};
    this.meshList = [];
    // Collider handles of every prop, for the people who bump into them (Player.moveBy).
    this.colliders = new Set();
    const counts = { mapCrate: 0, mapDrum: 0 };
    for (const l of loose) counts[l.kind === 'crate' ? 'mapCrate' : 'mapDrum']++;
    for (const kind of Object.keys(KINDS)) {
      const map = kind === 'mapCrate' || kind === 'mapDrum';
      if (map && !counts[kind]) continue;
      const geom = map ? mapGeometry(kind) : propGeometry(kind);
      const mat = kind === 'mapCrate' ? M.crate : kind === 'mapDrum' ? M.metalDark : M.props;
      const m = new THREE.InstancedMesh(geom, mat, map ? counts[kind] : 16);
      m.name = `props:${kind}`;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      game.scene.add(m);
      this.meshes[kind] = m;
      this.meshList.push(m);
    }
    // One of each kind around every pickup pad, standing on whatever is under it.
    const bake = game.bake;
    for (const pad of pads) {
      for (const [kind, dist, ang] of AROUND) {
        const x = pad.pos.x + Math.cos(ang) * dist;
        const z = pad.pos.z + Math.sin(ang) * dist;
        const floor = bake ? bake.floorBelow(x, pad.pos.y + 1.5, z) : pad.pos.y;
        if (!Number.isFinite(floor)) continue;
        this.list.push({ kind, def: KINDS[kind], home: new THREE.Vector3(x, floor, z), body: null, collider: null, alive: false, respawnT: 0 });
      }
    }
    for (const l of loose) {
      const crate = l.kind === 'crate';
      const def = crate ? { ...KINDS.mapCrate, half: [l.s / 2, l.s / 2, l.s / 2] } : KINDS.mapDrum;
      this.list.push({ kind: crate ? 'mapCrate' : 'mapDrum', def, size: crate ? l.s : 1, rotY: l.rotY ?? 0, home: new THREE.Vector3(l.x, l.y, l.z), body: null, collider: null, alive: false, respawnT: 0 });
    }
    for (const p of this.list) this.place(p);
  }

  place(p) {
    const { RAPIER, world } = this.game.physics;
    const d = p.def;
    const lift = d.half ? d.half[1] : d.cyl[0];
    p.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.home.x, p.home.y + lift + 0.02, p.home.z)
        .setLinearDamping(0.2)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    const desc = d.half ? RAPIER.ColliderDesc.cuboid(...d.half) : RAPIER.ColliderDesc.cylinder(d.cyl[0], d.cyl[1]);
    p.collider = world.createCollider(desc.setDensity(d.density).setRestitution(d.restitution).setFriction(0.8), p.body);
    this.colliders.add(p.collider.handle);
    if (p.rotY) p.body.setRotation(_q.setFromAxisAngle(_up, p.rotY), true);
    const t = p.body.translation();
    p.pos = new THREE.Vector3(t.x, t.y, t.z);
    p.prev = p.pos.clone();
    const r0 = p.body.rotation();
    p.rot = new THREE.Quaternion(r0.x, r0.y, r0.z, r0.w);
    p.prevRot = p.rot.clone();
    p.vel = new THREE.Vector3();
    p.thrownBy = null;
    p.thrownT = -99;
    p.heldBy = null;
    p.alive = true;
  }

  remove(p) {
    if (!p.alive) return;
    this.colliders.delete(p.collider.handle);
    this.game.physics.world.removeRigidBody(p.body);
    p.body = p.collider = null;
    p.alive = false;
    p.heldBy = null;
    p.respawnT = RESPAWN;
  }

  // A prop's size for grabbing and hitting (meters from its middle).
  reach(p) {
    return p.def.half ? p.def.half[0] * 1.3 + 0.03 : Math.max(p.def.cyl[0], p.def.cyl[1]) + 0.1;
  }

  tick(dt) {
    const game = this.game;
    for (const p of this.list) {
      if (!p.alive) {
        if ((p.respawnT -= dt) <= 0) this.place(p);
        continue;
      }
      p.prev.copy(p.pos);
      p.prevRot.copy(p.rot);
      const t = p.body.translation();
      const r = p.body.rotation();
      const lv = p.body.linvel();
      p.pos.set(t.x, t.y, t.z);
      p.rot.set(r.x, r.y, r.z, r.w);
      _v.set(lv.x, lv.y, lv.z);
      const jolt = _v.distanceTo(p.vel);
      const speed = _v.length();
      p.vel.copy(_v);
      // Portals: into one, out of the other (not while a gravity gun holds it).
      if (!p.heldBy && game.portals?.carryBody(p.body, p.pos, p.vel, this.reach(p) - 0.1, dt)) p.prev.copy(p.pos);
      if (p.pos.y < -20) {
        this.remove(p);
        continue;
      }
      const thrown = p.thrownBy && game.time - p.thrownT < HURT_TIME;
      // A thrown propane tank that hits anything hard goes off.
      if (thrown && p.def.explosion && jolt > 8) {
        this.blowUp(p, p.thrownBy);
        continue;
      }
      // A fast thrown prop hurts the first body it reaches (not the thrower right away).
      if (thrown && speed > HURT_SPEED && !p.heldBy) {
        const reach = this.reach(p) + 0.1;
        for (const e of game.entities.values()) {
          if (!e.alive || (e === p.thrownBy && game.time - p.thrownT < 0.4)) continue;
          if (e.distanceToBody(p.pos) > reach) continue;
          const dmg = p.def.damage * Math.min(1.4, speed / 22);
          if (e.knockback) e.knockback(_c.copy(p.vel).normalize().setY(0.3).normalize(), 6);
          dealDamage(game, e, dmg, { attacker: p.thrownBy, weapon: game.gravity?.def, cause: 'prop', point: p.pos });
          p.thrownBy = null;
          if (p.def.explosion) this.blowUp(p, null);
          break;
        }
      }
    }
  }

  blowUp(p, by) {
    const at = p.pos.clone();
    this.remove(p);
    explode(this.game, at, p.def.explosion, { attacker: by, weapon: this.game.gravity?.def });
  }

  // Blasts push props around and set off propane tanks close to them.
  shove(pos, cfg, info) {
    for (const p of this.list) {
      if (!p.alive) continue;
      _v.subVectors(p.pos, pos);
      const d = _v.length();
      if (d > cfg.radius || d < 1e-3) continue;
      if (p.def.explosion && d < cfg.radius * 0.6) {
        // (Next tick, so a chain of tanks doesn't recurse inside one blast.)
        p.thrownBy = info?.attacker ?? null;
        p.thrownT = this.game.time;
        p.body.applyImpulse({ x: 0, y: 0.1, z: 0 }, true);
        p.pendingBlast = true;
        continue;
      }
      const m = p.body.mass();
      _v.multiplyScalar(((1 - d / cfg.radius) * cfg.knockback * 0.6 * m) / d);
      p.body.applyImpulse({ x: _v.x, y: _v.y + m * 2, z: _v.z }, true);
    }
  }

  // After the tick: tanks a blast set off go off now.
  settle() {
    for (const p of this.list) {
      if (p.alive && p.pendingBlast) {
        p.pendingBlast = false;
        this.blowUp(p, p.thrownBy);
      }
    }
  }

  updateVisuals(alpha) {
    for (const m of this.meshList) m.count = 0;
    for (const p of this.list) {
      if (!p.alive) continue;
      const m = this.meshes[p.kind];
      _c.lerpVectors(p.prev, p.pos, alpha);
      _q.slerpQuaternions(p.prevRot, p.rot, alpha);
      m.setMatrixAt(m.count++, _m.compose(_c, _q, _s.setScalar(p.size ?? 1)));
    }
    for (const m of this.meshList) {
      m.visible = m.count > 0;
      if (m.count) m.instanceMatrix.needsUpdate = true;
    }
  }

  warmup(on) {
    if (!on) this.updateVisuals(1);
  }

  dispose() {
    for (const p of this.list) if (p.alive) this.game.physics.world.removeRigidBody(p.body);
    for (const m of this.meshList) {
      m.geometry.dispose();
      m.removeFromParent();
    }
  }
}
