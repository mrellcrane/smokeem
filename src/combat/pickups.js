import * as THREE from 'three';
import { WEAPONS, GRENADE, STARTING_WEAPON } from './weapons.js';
import { GUN_PARTS, partsGeometry, briquetteGeometry } from './weaponModels.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Weapon and grenade pickups: fixed spawners on pads that come back on a timer, plus weapons
// dropped by swapping or dying, which vanish after a while. Walking over a pickup takes it if
// it fits (empty slot, same-weapon ammo, grenade room); otherwise E swaps for it.

// Spawners. The arena builds a pad under each one.
export const PICKUP_SPOTS = [
  { type: 'weapon', weapon: 'smokeSignal', pos: [-1.5, 6.0, -1.5], respawn: 60 },
  { type: 'weapon', weapon: 'mesquite', pos: [0, 0, 2.6], respawn: 30 },
  { type: 'weapon', weapon: 'mesquite', pos: [-18, 0, 25], respawn: 30 },
  { type: 'grenades', count: 2, pos: [6, 5.5, 28.5], respawn: 20 },
  { type: 'grenades', count: 2, pos: [24.5, 5.0, -23.2], respawn: 20 },
  { type: 'grenades', count: 2, pos: [8.5, 2.4, -1.2], respawn: 20 },
  { type: 'grenades', count: 2, pos: [-25, 0, -19.5], respawn: 20 },
];

const REACH = 1.4;
const DROP_LIFETIME = 25;
const DROP_POOL = 4;

export class Pickups {
  constructor(game, material) {
    this.game = game;
    this.material = material;
    this.geoms = {};
    for (const id of Object.keys(GUN_PARTS)) this.geoms[id] = partsGeometry(GUN_PARTS[id], 0x888888, { scale: 1.3 });
    // Two briquettes side by side, merged so each grenade pickup is one draw call.
    const a = briquetteGeometry().rotateY(-0.4).translate(-0.11, 0, 0);
    const b = briquetteGeometry().rotateY(0.4).translate(0.11, 0, 0);
    this.briquettePair = mergeGeometries([a, b], false);
    a.dispose();
    b.dispose();
    this.items = [];
    this.dropPool = {};

    for (const spot of PICKUP_SPOTS) {
      const pos = new THREE.Vector3(...spot.pos);
      const item = {
        type: spot.type,
        def: spot.type === 'weapon' ? WEAPONS[spot.weapon] : null,
        count: spot.count ?? 0,
        pos,
        respawn: spot.respawn,
        spawner: true,
        active: true,
        timer: 0,
        mesh: spot.type === 'weapon' ? this.weaponMesh(spot.weapon) : this.grenadeMesh(),
      };
      this.resetAmmo(item);
      item.mesh.position.copy(pos);
      this.items.push(item);
    }
    for (const id of Object.keys(GUN_PARTS)) {
      this.dropPool[id] = [];
      for (let i = 0; i < DROP_POOL; i++) {
        const m = this.weaponMesh(id);
        m.visible = false;
        this.dropPool[id].push(m);
      }
    }
  }

  weaponMesh(id) {
    const m = new THREE.Mesh(this.geoms[id], this.material);
    m.name = `pickup:${id}`;
    m.castShadow = true;
    this.game.scene.add(m);
    return m;
  }

  grenadeMesh() {
    const m = new THREE.Mesh(this.briquettePair, this.material);
    m.name = 'pickup:grenades';
    m.castShadow = true;
    this.game.scene.add(m);
    return m;
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
      item.mesh.visible = false;
    } else {
      this.removeDrop(item);
    }
  }

  removeDrop(item) {
    item.mesh.visible = false;
    this.dropPool[item.def.id].push(item.mesh);
    this.items.splice(this.items.indexOf(item), 1);
  }

  drop(def, mag, reserve, x, y, z) {
    if (def.id === STARTING_WEAPON || mag + reserve <= 0) return;
    const pool = this.dropPool[def.id];
    // Reuse the oldest drop of this type if the pool is empty.
    let mesh = pool.pop();
    if (!mesh) {
      const oldest = this.items.find((i) => !i.spawner && i.def === def);
      if (!oldest) return;
      this.removeDrop(oldest);
      mesh = pool.pop();
    }
    mesh.visible = true;
    const pos = new THREE.Vector3(x, y, z);
    mesh.position.copy(pos);
    this.items.push({ type: 'weapon', def, mag, reserve, pos, spawner: false, active: true, life: DROP_LIFETIME, mesh });
  }

  // A smoked player drops whatever they picked up.
  dropFrom(p) {
    const y = p.feetY();
    p.slots.forEach((w, i) => {
      if (w) this.drop(w.def, w.mag, w.reserve, p.center.x + (i ? 0.5 : -0.5), y, p.center.z);
    });
  }

  tick(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.spawner && !item.active) {
        item.timer -= dt;
        if (item.timer <= 0) {
          item.active = true;
          item.mesh.visible = true;
          this.resetAmmo(item);
        }
      } else if (!item.spawner) {
        item.life -= dt;
        if (item.life <= 0) this.removeDrop(item);
      }
    }
  }

  // Called from the player's tick with that tick's button presses.
  touch(p, pressed) {
    p.pickupPrompt = null;
    if (!p.alive || p.guiding) return;
    const feet = p.feetY();
    for (const item of this.items) {
      if (!item.active) continue;
      const dx = item.pos.x - p.center.x;
      const dz = item.pos.z - p.center.z;
      if (dx * dx + dz * dz > REACH * REACH || Math.abs(item.pos.y - feet) > 1.6) continue;
      if (item.type === 'grenades') {
        if (p.grenades >= GRENADE.max) continue;
        p.grenades = Math.min(GRENADE.max, p.grenades + item.count);
        this.consume(item);
        this.taken(p, `+${item.count} ${GRENADE.name}s`);
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
        p.giveWeapon(item.def, item.mag, item.reserve);
        this.consume(item);
        this.drop(old.def, old.mag, old.reserve, p.center.x, feet, p.center.z);
        this.taken(p, `Swapped for ${item.def.name}`);
        p.pickupPrompt = null;
      }
      return;
    }
  }

  taken(p, text) {
    p.feedback.killT = this.game.time;
    p.feedback.killText = text;
    this.game.sfx.play('pickup');
  }

  updateVisuals(time) {
    for (const item of this.items) {
      if (!item.active) continue;
      const m = item.mesh;
      const spin = time * 1.4 + item.pos.x;
      m.rotation.y = spin;
      m.position.y = item.pos.y + 0.75 + Math.sin(time * 2 + item.pos.z) * 0.08;
      if (item.type === 'weapon') m.rotation.z = 0.15;
    }
  }

  dispose() {
    for (const g of Object.values(this.geoms)) g.dispose();
    this.briquettePair.dispose();
  }
}
