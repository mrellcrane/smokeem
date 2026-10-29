import * as THREE from 'three';
import { clamp } from '../util/math.js';
import { GRENADE } from './weapons.js';
import { explode } from './explosions.js';
import { briquetteGeometry, missileGeometry } from './weaponModels.js';

// Smoke Signal missiles and Briquette grenades. Meshes are pooled and created at load.

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

const MAX_MISSILES = 4;
const MAX_GRENADES = 16;
// Missiles ignore their shooter for this long so they don't pop on launch.
const ARM_TIME = 0.25;
const PROXIMITY = 0.65;

class Missile {
  constructor(mesh) {
    this.mesh = mesh;
    this.active = false;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.prevYaw = 0;
    this.prevPitch = 0;
    this.steerYaw = 0;
    this.steerPitch = 0;
  }

  // Look input while flying it. Same sign convention as Player.applyLook.
  steer(lx, ly) {
    this.steerYaw += lx;
    this.steerPitch += ly;
  }

  detonate() {
    this.detonateNow = true;
  }
}

export class Missiles {
  constructor(game, material, textures) {
    this.game = game;
    this.pool = [];
    const geom = missileGeometry();
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: textures.spark,
      color: 0xffb060,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glowMaterial.name = 'missileGlow';
    const glowGeom = new THREE.PlaneGeometry(0.5, 0.5);
    for (let i = 0; i < MAX_MISSILES; i++) {
      const mesh = new THREE.Mesh(geom, material);
      mesh.name = 'missile';
      mesh.castShadow = true;
      mesh.rotation.order = 'YXZ';
      const glow = new THREE.Mesh(glowGeom, this.glowMaterial);
      glow.position.z = 0.32;
      glow.rotation.x = Math.PI / 2;
      const glow2 = glow.clone();
      glow2.rotation.set(0, Math.PI / 2, 0);
      glow.add(glow2);
      mesh.add(glow);
      mesh.visible = false;
      game.scene.add(mesh);
      this.pool.push(new Missile(mesh));
    }
  }

  launch(owner, origin, yaw, pitch, def) {
    const m = this.pool.find((x) => !x.active) ?? this.pool[0];
    if (m.active) this.finish(m, false);
    m.active = true;
    m.owner = owner;
    m.def = def;
    m.pos.copy(origin);
    m.prev.copy(origin);
    m.yaw = m.prevYaw = yaw;
    m.pitch = m.prevPitch = pitch;
    m.steerYaw = m.steerPitch = 0;
    m.speed = def.missileSpeed;
    m.life = def.missileLife;
    m.age = 0;
    m.detonateNow = false;
    m.mesh.visible = true;
    return m;
  }

  tick(dt) {
    for (const m of this.pool) if (m.active) this.tickOne(m, dt);
  }

  tickOne(m, dt) {
    const game = this.game;
    const def = m.def;
    m.prev.copy(m.pos);
    m.prevYaw = m.yaw;
    m.prevPitch = m.pitch;
    m.age += dt;
    m.life -= dt;

    // Steering is rate-limited so flicks can't snap it around; extra input is dropped.
    const maxTurn = def.missileTurnRate * dt;
    m.yaw -= clamp(m.steerYaw, -maxTurn, maxTurn);
    m.pitch = clamp(m.pitch - clamp(m.steerPitch, -maxTurn, maxTurn), -1.45, 1.45);
    m.steerYaw = m.steerPitch = 0;
    const cp = Math.cos(m.pitch);
    m.dir.set(-Math.sin(m.yaw) * cp, Math.sin(m.pitch), -Math.cos(m.yaw) * cp);
    m.speed = Math.min(def.missileMaxSpeed, m.speed + def.missileAccel * dt);

    if (m.detonateNow || m.life <= 0) return this.finish(m, true);

    const step = m.speed * dt;
    const exclude = m.age < ARM_TIME ? m.owner.collider : undefined;
    const hit = game.castShot(m.pos, m.dir, step + 0.2, exclude);
    if (hit.hit) {
      m.pos.copy(m.pos).addScaledVector(m.dir, Math.max(0, hit.distance - 0.15));
      return this.finish(m, true);
    }
    m.pos.addScaledVector(m.dir, step);

    // Proximity fuse against bodies.
    for (const e of game.entities.values()) {
      if (!e.alive || (e === m.owner && m.age < ARM_TIME * 3)) continue;
      if (e.distanceToBody(m.pos) < PROXIMITY) return this.finish(m, true);
    }

    // Exhaust trail.
    _v.copy(m.pos).addScaledVector(m.dir, -0.35);
    game.fx.smoke.spawn(_v.x, _v.y, _v.z, 0, 0.3, 0, 0xbab2aa, 0.22, 0.9, { grow: 3.5, drag: 2, alpha: 0.6, rotVel: 1 });
    if (Math.random() < 0.6) {
      game.fx.sparks.spawn(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0xffa040, 0.12, 0.15, { drag: 4 });
    }
  }

  finish(m, boom) {
    m.active = false;
    m.mesh.visible = false;
    if (m.owner && m.owner.guiding === m) m.owner.guiding = null;
    if (boom) explode(this.game, m.pos, m.def.explosion, { attacker: m.owner, weapon: m.def });
  }

  // Interpolated pose for rendering and for the missile camera. `ahead` pushes the point
  // forward along the flight path (the pilot's camera sits just past the nose).
  pose(m, alpha, outPos, outEuler, ahead = 0) {
    outPos.lerpVectors(m.prev, m.pos, alpha);
    outEuler.set(m.prevPitch + (m.pitch - m.prevPitch) * alpha, m.prevYaw + (m.yaw - m.prevYaw) * alpha, 0, 'YXZ');
    if (ahead) {
      const cp = Math.cos(outEuler.x);
      outPos.x += -Math.sin(outEuler.y) * cp * ahead;
      outPos.y += Math.sin(outEuler.x) * ahead;
      outPos.z += -Math.cos(outEuler.y) * cp * ahead;
    }
  }

  updateVisuals(alpha) {
    for (const m of this.pool) {
      if (!m.active) continue;
      this.pose(m, alpha, m.mesh.position, _e);
      m.mesh.rotation.copy(_e);
    }
  }

  warmup(on, at) {
    const m = this.pool[0].mesh;
    m.visible = on;
    if (on) m.position.copy(at);
  }

  dispose() {
    this.pool[0].mesh.geometry.dispose();
    this.pool[0].mesh.children[0].geometry.dispose();
    this.glowMaterial.dispose();
  }
}

export class Grenades {
  constructor(game, material) {
    this.game = game;
    this.list = [];
    this.handles = new Set();
    this.mesh = new THREE.InstancedMesh(briquetteGeometry(), material, MAX_GRENADES);
    this.mesh.name = 'grenades';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    game.scene.add(this.mesh);
  }

  get count() {
    return this.list.length;
  }

  throw(owner, origin, velocity) {
    if (this.list.length >= MAX_GRENADES) this.detonate(this.list[0]);
    const { RAPIER, world } = this.game.physics;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 })
        // Enough drag that a grenade settles near where it lands instead of rolling away.
        .setLinearDamping(0.8)
        .setAngularDamping(1.5)
        .setCcdEnabled(true),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.08, 0.05, 0.08).setRestitution(0.35).setFriction(0.9).setDensity(2),
      body,
    );
    this.handles.add(collider.handle);
    this.list.push({
      body,
      collider,
      owner,
      fuse: GRENADE.fuse,
      pos: new THREE.Vector3(origin.x, origin.y, origin.z),
      prev: new THREE.Vector3(origin.x, origin.y, origin.z),
      rot: new THREE.Quaternion(),
      prevRot: new THREE.Quaternion(),
      vel: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
    });
  }

  tick(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.prev.copy(g.pos);
      g.prevRot.copy(g.rot);
      const t = g.body.translation();
      const r = g.body.rotation();
      const lv = g.body.linvel();
      g.pos.set(t.x, t.y, t.z);
      g.rot.set(r.x, r.y, r.z, r.w);
      // A sharp change in velocity means it bounced off something.
      _v.set(lv.x, lv.y, lv.z);
      if (_v.distanceTo(g.vel) > 3 && g.vel.length() > 2.5) this.game.sfx.play('clink', { at: g.pos });
      g.vel.copy(_v);
      g.fuse -= dt;
      if (g.fuse <= 0 || g.pos.y < -20) this.detonate(g);
    }
  }

  detonate(g) {
    const i = this.list.indexOf(g);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.handles.delete(g.collider.handle);
    this.game.physics.world.removeRigidBody(g.body);
    if (g.pos.y > -20) explode(this.game, g.pos, GRENADE.explosion, { attacker: g.owner, weapon: GRENADE });
  }

  // Blasts push live grenades around.
  shove(pos, cfg) {
    for (const g of this.list) {
      _v.subVectors(g.pos, pos);
      const d = _v.length();
      if (d > cfg.radius || d < 1e-3) continue;
      _v.multiplyScalar(((1 - d / cfg.radius) * cfg.knockback * 0.04) / d);
      g.body.applyImpulse({ x: _v.x, y: _v.y + 0.05, z: _v.z }, true);
    }
  }

  updateVisuals(alpha) {
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const g = this.list[i];
      _c.lerpVectors(g.prev, g.pos, alpha);
      _q.slerpQuaternions(g.prevRot, g.rot, alpha);
      this.mesh.setMatrixAt(i, _m.compose(_c, _q, _s));
    }
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  warmup(on, at) {
    if (on) {
      this.mesh.setMatrixAt(0, _m.compose(at, _q.identity(), _s));
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.mesh.count = on ? 1 : this.list.length;
  }

  clear() {
    for (const g of [...this.list]) {
      this.handles.delete(g.collider.handle);
      this.game.physics.world.removeRigidBody(g.body);
    }
    this.list.length = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}
