import * as THREE from 'three';
import { clamp } from '../util/math.js';
import { GRENADE } from './weapons.js';
import { explode } from './explosions.js';
import { briquetteGeometry, coalGeometry, missileGeometry, stickyGeometry } from './weaponModels.js';

// Smoke Signal missiles and Briquette grenades. Meshes are pooled and created at load.

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

const MAX_MISSILES = 4;
// Briquettes and Chimney coals share this cap.
const MAX_GRENADES = 24;

// How each thrown thing behaves: the Briquette by default; guns that launch things (the
// Chimney) pass their own `projectile` block.
const BRIQUETTE = {
  look: 'briquette',
  fuse: GRENADE.fuse,
  contact: 0,
  ownerGrace: 0,
  // Next to no drag in the air (so a higher throw goes further, as in Halo); heavy drag from the
  // first bounce on, so it settles instead of rolling away.
  damping: 0.05,
  landDamping: 1.2,
  // In the air when the fuse runs out: it goes off this long after it lands instead.
  landFuse: 0.35,
  restitution: 0.35,
  ember: false,
  explosion: GRENADE.explosion,
};
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
    // The normal of the level surface it hit, if it hit one (the blast scorches it).
    this.against = new THREE.Vector3();
    this.hitWorld = false;
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
    m.hitWorld = false;
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
    // Into a portal: out of the other one, turned with it (the pilot's view turns too).
    if (game.portals?.carry(m.pos, m.dir, step + 0.2, game.castShot(m.pos, m.dir, step + 0.2, exclude).distance)) {
      m.pitch = Math.asin(THREE.MathUtils.clamp(m.dir.y, -1, 1));
      m.yaw = Math.atan2(-m.dir.x, -m.dir.z);
      m.prev.copy(m.pos);
      m.prevYaw = m.yaw;
      m.prevPitch = m.pitch;
      return;
    }
    const hit = game.castShot(m.pos, m.dir, step + 0.2, exclude);
    if (hit.hit) {
      m.pos.copy(m.pos).addScaledVector(m.dir, Math.max(0, hit.distance - 0.15));
      if (!hit.entity) {
        m.hitWorld = true;
        m.against.copy(hit.normal);
      }
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
    if (boom) explode(this.game, m.pos, m.def.explosion, { attacker: m.owner, weapon: m.def, against: m.hitWorld ? m.against : null });
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
    // One instanced mesh per look, so every grenade in flight is one draw call per look.
    this.meshes = {};
    this.meshList = [];
    for (const [look, geom] of [
      ['briquette', briquetteGeometry()],
      ['coal', coalGeometry()],
      ['sticky', stickyGeometry()],
    ]) {
      const m = new THREE.InstancedMesh(geom, material, MAX_GRENADES);
      m.name = `grenades:${look}`;
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      game.scene.add(m);
      this.meshes[look] = m;
      this.meshList.push(m);
    }
  }

  get count() {
    return this.list.length;
  }

  // kind: a projectile block (see BRIQUETTE); weapon: what the kill feed names.
  throw(owner, origin, velocity, kind = BRIQUETTE, weapon = GRENADE) {
    if (this.list.length >= MAX_GRENADES) this.detonate(this.list[0]);
    // Sticky bombs: at most maxOut each; one more sets off your oldest.
    if (kind.sticky) {
      const mine = this.list.filter((g) => g.kind.sticky && g.owner === owner);
      if (mine.length >= kind.maxOut) this.detonate(mine[0]);
    }
    const { RAPIER, world } = this.game.physics;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 })
        // Enough drag that a grenade settles near where it lands instead of rolling away.
        .setLinearDamping(kind.damping)
        .setAngularDamping(1.5)
        .setCcdEnabled(true),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.08, 0.05, 0.08).setRestitution(kind.restitution).setFriction(0.9).setDensity(2),
      body,
    );
    this.handles.add(collider.handle);
    this.list.push({
      body,
      collider,
      owner,
      kind,
      weapon,
      age: 0,
      fuse: kind.fuse,
      pos: new THREE.Vector3(origin.x, origin.y, origin.z),
      prev: new THREE.Vector3(origin.x, origin.y, origin.z),
      rot: new THREE.Quaternion(),
      prevRot: new THREE.Quaternion(),
      vel: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
      // Sticky bombs: stuck to the level, and armed (ready to go off).
      stuck: false,
      armed: !kind.sticky,
      // Held by a gravity gun (src/combat/gravity.js).
      heldBy: null,
      // Bounced off something yet.
      landed: false,
    });
  }

  tick(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      // (A blast this tick can smoke someone, which takes their stickies off the list.)
      const g = this.list[i];
      if (!g) continue;
      g.prev.copy(g.pos);
      g.prevRot.copy(g.rot);
      const t = g.body.translation();
      const r = g.body.rotation();
      const lv = g.body.linvel();
      g.pos.set(t.x, t.y, t.z);
      g.rot.set(r.x, r.y, r.z, r.w);
      // A sharp change in velocity means it bounced off something.
      _v.set(lv.x, lv.y, lv.z);
      const bounced = _v.distanceTo(g.vel) > 3 && g.vel.length() > 2.5;
      if (bounced) this.game.sfx.play('clink', { at: g.pos });
      g.age += dt;
      g.fuse -= dt;
      if (g.kind.sticky) this.tickSticky(g, bounced || (g.age > 0.1 && _v.lengthSq() < 0.25));
      if (g.gone) continue;
      // First touch (a bounce, or coming to rest): ground drag from now on, and a fuse that ran
      // out in the air goes off shortly.
      if (!g.landed && (bounced || (g.age > 0.2 && _v.lengthSq() < 0.25))) {
        g.landed = true;
        if (g.kind.landDamping) g.body.setLinearDamping(g.kind.landDamping);
        if (g.kind.landFuse && g.fuse <= 0) g.fuse = g.kind.landFuse;
      }
      g.vel.copy(_v);
      // Portals: into one, out of the other.
      if (!g.stuck && !g.heldBy && this.game.portals?.carryBody(g.body, g.pos, g.vel, 0.1, dt)) g.prev.copy(g.pos);
      if (g.kind.ember && (this.game.tickCount & 1) === 0) this.game.fx.ember(g.pos);
      // A long lob whose fuse runs out in the air waits to land (up to 5 s in all).
      const aloft = g.kind.landFuse && !g.landed && g.age < 5;
      if ((g.fuse <= 0 && !aloft) || g.pos.y < -20 || this.touching(g)) this.detonate(g);
    }
  }

  // A sticky bomb sticks where it first hits the level (not a body), arms after a moment, and a
  // bot's goes off by itself when someone else steps near it.
  tickSticky(g, hit) {
    if (!g.armed && g.age >= g.kind.armTime) g.armed = true;
    if (!g.stuck && hit && !g.heldBy && !this.nearBody(g.pos, 0.35)) this.stick(g);
    if (g.armed && g.owner?.isBot && this.nearBody(g.pos, 2.2, g.owner)) this.detonate(g);
  }

  stick(g) {
    const { RAPIER } = this.game.physics;
    g.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    g.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    g.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    g.stuck = true;
    this.game.sfx.play('clink', { at: g.pos, rate: 0.7 });
  }

  // Free a stuck sticky bomb (a gravity gun pulls it off).
  unstick(g) {
    if (!g.stuck) return;
    const { RAPIER } = this.game.physics;
    g.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    g.stuck = false;
  }

  // Any living body (but `except`) within reach of pos.
  nearBody(pos, reach, except = null) {
    for (const e of this.game.entities.values()) {
      if (e.alive && e !== except && e.distanceToBody(pos) < reach) return true;
    }
    return false;
  }

  // The aim button on a Stickybomb Launcher: every armed sticky of owner's goes off.
  detonateStickies(owner) {
    let n = 0;
    for (const g of [...this.list]) {
      if (g.kind.sticky && g.owner === owner && g.armed && !g.heldBy) {
        this.detonate(g);
        n++;
      }
    }
    return n;
  }

  // Smoked: your sticky bombs fizzle (without a blast).
  removeStickies(owner) {
    for (const g of [...this.list]) {
      if (!g.kind.sticky || g.owner !== owner) continue;
      this.list.splice(this.list.indexOf(g), 1);
      g.gone = true;
      this.handles.delete(g.collider.handle);
      this.game.physics.world.removeRigidBody(g.body);
    }
  }

  // Contact fuse: anyone (the shooter only after a moment) within reach of the projectile.
  touching(g) {
    const reach = g.kind.contact;
    if (!reach) return false;
    for (const e of this.game.entities.values()) {
      if (!e.alive || (e === g.owner && g.age < g.kind.ownerGrace)) continue;
      if (e.distanceToBody(g.pos) < reach) return true;
    }
    return false;
  }

  detonate(g) {
    const i = this.list.indexOf(g);
    if (i < 0) return;
    this.list.splice(i, 1);
    g.gone = true;
    this.handles.delete(g.collider.handle);
    this.game.physics.world.removeRigidBody(g.body);
    if (g.pos.y > -20) explode(this.game, g.pos, g.kind.explosion, { attacker: g.owner, weapon: g.weapon });
  }

  // Blasts push live grenades around (stuck stickies stay put).
  shove(pos, cfg) {
    for (const g of this.list) {
      if (g.stuck) continue;
      _v.subVectors(g.pos, pos);
      const d = _v.length();
      if (d > cfg.radius || d < 1e-3) continue;
      _v.multiplyScalar(((1 - d / cfg.radius) * cfg.knockback * 0.04) / d);
      g.body.applyImpulse({ x: _v.x, y: _v.y + 0.05, z: _v.z }, true);
    }
  }

  updateVisuals(alpha) {
    for (const m of this.meshList) m.count = 0;
    for (const g of this.list) {
      const m = this.meshes[g.kind.look];
      _c.lerpVectors(g.prev, g.pos, alpha);
      _q.slerpQuaternions(g.prevRot, g.rot, alpha);
      m.setMatrixAt(m.count++, _m.compose(_c, _q, _s));
    }
    // Nothing in flight: no draw call (three still draws a zero-count instanced mesh).
    for (const m of this.meshList) {
      m.visible = m.count > 0;
      if (m.count) m.instanceMatrix.needsUpdate = true;
    }
  }

  warmup(on, at) {
    for (const m of this.meshList) {
      if (on) {
        m.setMatrixAt(0, _m.compose(at, _q.identity(), _s));
        m.instanceMatrix.needsUpdate = true;
      }
      m.count = on ? 1 : 0;
      m.visible = on;
    }
    if (!on) this.updateVisuals(1);
  }

  clear() {
    for (const g of [...this.list]) {
      this.handles.delete(g.collider.handle);
      this.game.physics.world.removeRigidBody(g.body);
    }
    this.list.length = 0;
    for (const m of this.meshList) {
      m.count = 0;
      m.visible = false;
    }
  }

  dispose() {
    for (const m of this.meshList) m.geometry.dispose();
  }
}
