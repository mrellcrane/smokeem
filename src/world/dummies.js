import * as THREE from 'three';
import { Vitals } from '../combat/vitals.js';
import { CharacterModel } from '../player/character.js';

// Practice targets: training dummies that stand or strafe on a rail, take damage through the
// same path as players, regenerate shields, and pop back up a few seconds after being smoked.
// Bots replace these as the main targets in step 4.

const RADIUS = 0.4;
const HALF_HEIGHT = 0.5;
const RESPAWN_DELAY = 4;

// post: feet position; patrol: [dx, dz] half-extent of the strafe rail; yaw: facing.
export const DUMMY_POSTS = [
  { name: 'Training Dummy', post: [0, 0, 16.5], patrol: [5, 0], speed: 3.2, yaw: 0 },
  { name: 'Training Dummy', post: [-13, 0, 3], patrol: [0, 3.5], speed: 2.6, yaw: -Math.PI / 2 },
  { name: 'Summit Dummy', post: [2, 6.0, 1.5], yaw: Math.PI },
  { name: 'Catwalk Dummy', post: [-4, 5.5, 28], yaw: 0 },
  { name: 'Mud Dummy', post: [16, -0.8, 0], patrol: [0, 4.5], speed: 1.6, yaw: Math.PI / 2 },
  { name: 'Lookout Dummy', post: [21, 5.0, -24.5], yaw: Math.PI },
];

export class Dummy {
  constructor(game, def) {
    this.game = game;
    this.kind = 'dummy';
    this.name = def.name;
    this.post = new THREE.Vector3(...def.post);
    this.patrol = def.patrol ? new THREE.Vector2(...def.patrol) : null;
    this.speed = def.speed ?? 0;
    this.yaw = def.yaw ?? 0;
    this.vitals = new Vitals();
    this.feet = this.post.clone();
    this.prevFeet = this.post.clone();
    this.t = Math.random() * 10;
    this.moveSpeed = 0;
    this.respawnT = 0;
    this.flinch = 0;

    const { RAPIER, world } = game.physics;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.placeBody(true);
    game.registerEntity(this.collider, this);

    this.model = new CharacterModel({ armor: 0xe4ddcf, trim: 0xe0701c, visor: 0xff5a1a });
    game.scene.add(this.model.group);
  }

  get alive() {
    return this.vitals.alive;
  }

  feetY() {
    return this.feet.y;
  }

  headLineY() {
    return this.feet.y + 1.48;
  }

  centerPosition(out) {
    return out.set(this.feet.x, this.feet.y + HALF_HEIGHT + RADIUS, this.feet.z);
  }

  facing(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  distanceToBody(p) {
    const lo = this.feet.y + RADIUS;
    const hi = lo + HALF_HEIGHT * 2;
    const y = Math.max(lo, Math.min(hi, p.y));
    return Math.hypot(p.x - this.feet.x, p.y - y, p.z - this.feet.z) - RADIUS;
  }

  placeBody(teleport) {
    const c = { x: this.feet.x, y: this.feet.y + HALF_HEIGHT + RADIUS + 0.02, z: this.feet.z };
    if (teleport) this.body.setTranslation(c, true);
    this.body.setNextKinematicTranslation(c);
  }

  tick(dt) {
    this.prevFeet.copy(this.feet);
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    this.vitals.update(dt);
    if (this.patrol) {
      // Ping-pong along the rail with a short pause at each end.
      this.t += dt;
      const len = this.patrol.length() * 2;
      const travel = len / this.speed;
      const period = (travel + 0.6) * 2;
      const ph = this.t % period;
      let u;
      if (ph < travel) u = ph / travel;
      else if (ph < travel + 0.6) u = 1;
      else if (ph < travel * 2 + 0.6) u = 1 - (ph - travel - 0.6) / travel;
      else u = 0;
      const s = u * 2 - 1;
      this.feet.set(this.post.x + this.patrol.x * s, this.post.y, this.post.z + this.patrol.y * s);
      this.moveSpeed = ph < travel || (ph > travel + 0.6 && ph < travel * 2 + 0.6) ? this.speed : 0;
      this.placeBody(false);
    }
  }

  onDamaged() {
    this.flinch = 1;
  }

  die() {
    this.respawnT = RESPAWN_DELAY;
    this.collider.setEnabled(false);
    this.model.group.visible = false;
    this.game.fx.deathPuff(this.feet.x, this.feet.y, this.feet.z);
  }

  respawn() {
    this.vitals.reset();
    this.feet.copy(this.post);
    this.prevFeet.copy(this.post);
    this.t = 0;
    this.placeBody(true);
    this.collider.setEnabled(true);
    this.model.group.visible = true;
  }

  updateVisual(dt, alpha) {
    if (!this.model.group.visible) return;
    this.flinch = Math.max(0, this.flinch - dt * 5);
    const x = this.prevFeet.x + (this.feet.x - this.prevFeet.x) * alpha;
    const y = this.prevFeet.y + (this.feet.y - this.prevFeet.y) * alpha;
    const z = this.prevFeet.z + (this.feet.z - this.prevFeet.z) * alpha;
    this.model.update(dt, {
      x,
      y,
      z,
      yaw: this.yaw,
      pitch: -0.25 * this.flinch,
      speed: this.moveSpeed,
      grounded: true,
      crouched: false,
      climbing: false,
    });
  }

  dispose() {
    this.model.dispose();
  }
}
