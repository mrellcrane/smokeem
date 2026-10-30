import * as THREE from 'three';
import { WEAPONS, GRENADE, WeaponState } from './weapons.js';
import { partsGeometry, briquetteGeometry } from './weaponModels.js';
import { allParts } from './guns/index.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Weapon and grenade pickups: fixed spawners on pads that come back on a timer, plus weapons
// dropped by swapping or dying, which vanish after a while. Walking over a pickup takes it if
// it fits (empty slot, same-weapon ammo, grenade room); otherwise E swaps for it.

// Spawners come from the map (game.arena.pickupSpots), which builds a pad under each one.

// How close (m, across and up from the feet) a player must be to take a pickup.
export const PICKUP_REACH = 1.4;
export const PICKUP_REACH_Y = 1.6;
const DROP_LIFETIME = 25;
// At most this many dropped guns of one type lie around at once (the oldest goes first).
const DROP_POOL = 4;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export class Pickups {
  constructor(game, material) {
    this.game = game;
    this.material = material;
    const { set, guns } = game.arsenal;
    this.items = [];

    for (const spot of game.arena.pickupSpots) {
      let gun = null;
      if (spot.type === 'weapon') {
        gun = spot.pad === 'power' ? set.power : set.field;
      }
      const item = {
        type: spot.type,
        def: gun ? WEAPONS[gun] : null,
        count: spot.count ?? 0,
        pos: new THREE.Vector3(...spot.pos),
        // A gun can set its own pad time (the Chimney comes back slower).
        respawn: (gun && WEAPONS[gun].padRespawn) || spot.respawn,
        spawner: true,
        active: true,
        timer: 0,
        look: gun ?? 'grenades',
        // Which pad it sits on (its beacon's look).
        kind: spot.type === 'grenades' ? 'grenades' : spot.pad,
      };
      this.resetAmmo(item);
      this.items.push(item);
    }
    // The spawners, in the map's order (items also holds dropped guns).
    this.pads = this.items.slice();

    // One instanced mesh per look (each gun in the set, and briquette pairs), so all pickups
    // of a kind are one draw call; nothing draws while none is out.
    this.meshes = {};
    this.meshList = [];
    const add = (look, geom, capacity) => {
      const m = new THREE.InstancedMesh(geom, material, capacity);
      m.name = `pickups:${look}`;
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
      game.scene.add(m);
      this.meshes[look] = m;
      this.meshList.push(m);
    };
    for (const id of guns) {
      const pads = this.items.filter((i) => i.look === id).length;
      add(id, partsGeometry(allParts(id), 0x888888, { scale: 1.3 }), pads + DROP_POOL);
    }
    // Two briquettes side by side.
    const a = briquetteGeometry().rotateY(-0.4).translate(-0.11, 0, 0);
    const b = briquetteGeometry().rotateY(0.4).translate(0.11, 0, 0);
    add('grenades', mergeGeometries([a, b], false), Math.max(1, this.items.filter((i) => i.look === 'grenades').length));
    a.dispose();
    b.dispose();
  }

  resetAmmo(item) {
    if (item.def) {
      item.mag = item.def.mag;
      item.reserve = item.def.reserve;
    }
  }

  consume(item) {
    if (item.spawner) {
      item.active = false;
      item.timer = item.respawn;
    } else {
      this.removeDrop(item);
    }
  }

  removeDrop(item) {
    this.items.splice(this.items.indexOf(item), 1);
  }

  drop(def, mag, reserve, x, y, z) {
    // Empty guns, and guns outside the match's set (debug only), aren't dropped.
    if (mag + reserve <= 0 || !this.meshes[def.id]) return;
    // Too many of this gun lying around already: the oldest one goes.
    const drops = this.items.filter((i) => !i.spawner && i.def === def);
    if (drops.length >= DROP_POOL) this.removeDrop(drops[0]);
    const pos = new THREE.Vector3(x, y, z);
    this.items.push({ type: 'weapon', def, mag, reserve, pos, spawner: false, active: true, life: DROP_LIFETIME, look: def.id });
  }

  // A smoked player drops whatever they picked up (their loadout guns go with them).
  dropFrom(p) {
    const y = p.feetY();
    p.slots.forEach((w, i) => {
      if (w && !w.spawnGun) this.drop(w.def, w.mag, w.reserve, p.center.x + (i ? 0.5 : -0.5), y, p.center.z);
    });
    this.dropLeft(p);
  }

  // The gun in the left hand goes (to the floor, unless it came with the loadout).
  dropLeft(p) {
    const w = p.left;
    if (!w) return;
    p.left = null;
    if (!w.spawnGun) this.drop(w.def, w.mag, w.reserve, p.center.x, p.feetY(), p.center.z + 0.5);
  }

  tick(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.spawner && !item.active) {
        item.timer -= dt;
        if (item.timer <= 0) {
          item.active = true;
          this.resetAmmo(item);
        }
      } else if (!item.spawner) {
        item.life -= dt;
        if (item.life <= 0) this.removeDrop(item);
        // Thrown by a Gravity Gun: flies until it lands (or falls out of the world).
        else if (item.vel && !item.heldBy) {
          item.pos.addScaledVector(item.vel, dt);
          item.vel.y -= 16 * dt;
          const floor = this.game.bake ? this.game.bake.floorBelow(item.pos.x, item.pos.y + 0.4, item.pos.z) : 0;
          if (item.pos.y < -20) this.removeDrop(item);
          else if (Number.isFinite(floor) && item.pos.y <= floor && item.vel.y <= 0) {
            item.pos.y = floor;
            item.vel = null;
          }
        }
      }
    }
  }

  // Called from the player's tick with that tick's button presses.
  touch(p, pressed) {
    p.pickupPrompt = null;
    p.pickupDual = false;
    if (!p.alive || p.guiding) return;
    const feet = p.feetY();
    for (const item of this.items) {
      if (!item.active) continue;
      const dx = item.pos.x - p.center.x;
      const dz = item.pos.z - p.center.z;
      if (dx * dx + dz * dz > PICKUP_REACH * PICKUP_REACH || Math.abs(item.pos.y - feet) > PICKUP_REACH_Y) continue;
      if (item.type === 'grenades') {
        if (p.grenades >= GRENADE.max) continue;
        p.grenades = Math.min(GRENADE.max, p.grenades + item.count);
        this.consume(item);
        this.taken(p, `+${item.count} ${GRENADE.name}s`);
        return;
      }
      // A dual-wield gun in hand and another under us: take it in the left hand (on a hold, so
      // walking over one never does it by surprise).
      if (!p.left && p.weapon.def.dual && item.def.dual && p.switchT <= 0) {
        p.pickupPrompt = item;
        p.pickupDual = true;
        if (pressed.interact) {
          p.left = new WeaponState(item.def);
          p.left.mag = item.mag;
          p.left.reserve = item.reserve;
          this.consume(item);
          this.taken(p, `Dual wielding ${item.def.name}s`);
          p.pickupPrompt = null;
          p.pickupDual = false;
          this.game.sfx.play('swap', { at: p.center, source: p });
        }
        return;
      }
      const held = p.slots.find((w) => w && w.def === item.def);
      if (held) {
        // Same weapon: top up ammo.
        const room = item.def.mag + item.def.reserve - held.mag - held.reserve;
        if (room <= 0) continue;
        const take = Math.min(room, item.mag + item.reserve);
        held.reserve += take;
        let left = take;
        const fromReserve = Math.min(item.reserve, left);
        item.reserve -= fromReserve;
        left -= fromReserve;
        item.mag -= left;
        if (item.mag + item.reserve <= 0) this.consume(item);
        this.taken(p, `+${take} ${item.def.name} ammo`);
        return;
      }
      if (!p.slots[1]) {
        p.giveWeapon(item.def, item.mag, item.reserve);
        this.consume(item);
        this.taken(p, `Picked up ${item.def.name}`);
        return;
      }
      // Both hands full: offer a swap for the held weapon.
      p.pickupPrompt = item;
      if (pressed.interact) {
        const old = p.weapon;
        // (Only dual-wield guns go two at a time.)
        if (p.left && !item.def.dual) this.dropLeft(p);
        p.giveWeapon(item.def, item.mag, item.reserve);
        this.consume(item);
        // A loadout gun swapped away is gone until respawn; picked-up guns hit the floor.
        if (!old.spawnGun) this.drop(old.def, old.mag, old.reserve, p.center.x, feet, p.center.z);
        this.taken(p, `Swapped for ${item.def.name}`);
        p.pickupPrompt = null;
      }
      return;
    }
  }

  taken(p, text) {
    p.feedback.killT = this.game.time;
    p.feedback.killText = text;
    if (!p.isBot) this.game.sfx.play('pickup');
  }

  // Spin and bob every live pickup, packed into its look's instanced mesh.
  updateVisuals(time) {
    for (const m of this.meshList) m.count = 0;
    for (const item of this.items) {
      if (!item.active) continue;
      const m = this.meshes[item.look];
      _p.set(item.pos.x, item.pos.y + 0.75 + Math.sin(time * 2 + item.pos.z) * 0.08, item.pos.z);
      _q.setFromEuler(_e.set(0, time * 1.4 + item.pos.x, item.type === 'weapon' ? 0.15 : 0));
      m.setMatrixAt(m.count++, _m.compose(_p, _q, _s));
    }
    for (const m of this.meshList) {
      m.visible = m.count > 0;
      if (m.count) m.instanceMatrix.needsUpdate = true;
    }
  }

  // Show one of every look for the shader warm-up (drops can appear later).
  warmup(on, at) {
    for (const m of this.meshList) {
      if (on) {
        m.setMatrixAt(0, _m.compose(at, _q.identity(), _s));
        m.instanceMatrix.needsUpdate = true;
        m.count = 1;
        m.visible = true;
      }
    }
    if (!on) this.updateVisuals(this.game.time);
  }

  dispose() {
    for (const m of this.meshList) m.geometry.dispose();
  }
}
