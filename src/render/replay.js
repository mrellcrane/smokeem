import * as THREE from 'three';

// The death replay (killcam): smoked by another player, a local player's view replays the last
// moments from the killer's eyes, from REPLAY.before seconds before the kill, for REPLAY.length
// seconds, with the killer's shots drawn again as tracers only that view sees.
//
// Recording is cheap: every rendered frame (at most 60 a second) the transforms of every body
// (the body itself and each bone, gun bones included) and every player's eye and aim go into a
// ring of preallocated float arrays, with the killer-to-be's tracers in a small ring of their
// own. A replaying view copies the past frame's transforms onto the bodies, renders, and puts
// the present back. Only bodies, Rocky Mountain Oysters' sacks, Sizzlers and shots are replayed:
// projectiles, pickups and effects show as they are now.

export const REPLAY = { before: 1.8, length: 2.3 };
const FRAMES = 200;
const SHOTS = 96;
const PER_BONE = 8;
const PER_BODY = 8 + 5;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Replay {
  constructor(game) {
    this.game = game;
    this.bodies = game.players.map((p) => ({ p, group: p.model.group, bones: p.model.skeleton.bones, off: 0 }));
    let size = 0;
    for (const b of this.bodies) {
      b.off = size;
      size += PER_BODY + b.bones.length * PER_BONE;
    }
    // Oysters: every sack's matrix and owner, and how many are drawn.
    const sacks = game.oysters?.sacks;
    this.sackOff = size;
    if (sacks) size += sacks.instanceMatrix.array.length + game.oysters.owners.array.length + 1;
    // Sizzlers: their frames' and wheels' matrices and counts.
    this.bikes = game.vehicles ? [game.vehicles.frames, game.vehicles.wheels] : [];
    this.bikeOff = size;
    for (const m of this.bikes) size += m.instanceMatrix.array.length + 1;
    this.frames = Array.from({ length: FRAMES }, () => ({ t: -Infinity, d: new Float32Array(size) }));
    this.head = 0;
    this.lastT = -Infinity;
    // The present, kept while a view shows the past.
    this.now = new Float32Array(size);
    this.shots = Array.from({ length: SHOTS }, () => ({ t: -Infinity, by: null, a: new THREE.Vector3(), b: new THREE.Vector3(), color: 0, width: 0, linger: 0 }));
    this.shotHead = 0;
    // Per local player: { killer, t0, start, shotT } while their replay runs.
    this.views = new Map();
  }

  // After the bodies are posed for this frame. alpha: the render interpolation.
  record(alpha) {
    const t = this.game.time;
    if (t - this.lastT < 1 / 60 - 1e-4) return;
    this.lastT = t;
    const f = this.frames[this.head];
    this.head = (this.head + 1) % FRAMES;
    f.t = t;
    this.write(f.d, alpha);
  }

  write(d, alpha = 1) {
    for (const { p, group, bones, off } of this.bodies) {
      let i = off;
      group.position.toArray(d, i);
      group.quaternion.toArray(d, i + 3);
      d[i + 7] = group.visible ? 1 : 0;
      _v.lerpVectors(p.prevCenter, p.center, alpha);
      d[i + 8] = _v.x;
      d[i + 9] = _v.y + p.eyeOffset();
      d[i + 10] = _v.z;
      d[i + 11] = p.yaw;
      d[i + 12] = p.pitch;
      i += PER_BODY;
      for (const b of bones) {
        b.position.toArray(d, i);
        b.quaternion.toArray(d, i + 3);
        d[i + 7] = b.scale.x;
        i += PER_BONE;
      }
    }
    const oy = this.game.oysters;
    if (oy) {
      const m = oy.sacks.instanceMatrix.array;
      d.set(m, this.sackOff);
      d.set(oy.owners.array, this.sackOff + m.length);
      d[this.sackOff + m.length + oy.owners.array.length] = oy.sacks.count;
    }
    let j = this.bikeOff;
    for (const m of this.bikes) {
      const a = m.instanceMatrix.array;
      d.set(a, j);
      d[j + a.length] = m.count;
      j += a.length + 1;
    }
  }

  read(d) {
    for (const { group, bones, off } of this.bodies) {
      let i = off;
      group.position.fromArray(d, i);
      group.quaternion.fromArray(d, i + 3);
      group.visible = d[i + 7] > 0.5;
      i += PER_BODY;
      for (const b of bones) {
        b.position.fromArray(d, i);
        b.quaternion.fromArray(d, i + 3);
        b.scale.setScalar(d[i + 7]);
        i += PER_BONE;
      }
    }
    const oy = this.game.oysters;
    if (oy) {
      const m = oy.sacks.instanceMatrix.array;
      const o = oy.owners.array;
      m.set(d.subarray(this.sackOff, this.sackOff + m.length));
      o.set(d.subarray(this.sackOff + m.length, this.sackOff + m.length + o.length));
      oy.sacks.count = d[this.sackOff + m.length + o.length];
      oy.sacks.visible = oy.sacks.count > 0;
      oy.sacks.instanceMatrix.needsUpdate = true;
      oy.owners.needsUpdate = true;
    }
    let j = this.bikeOff;
    for (const m of this.bikes) {
      const a = m.instanceMatrix.array;
      a.set(d.subarray(j, j + a.length));
      m.count = d[j + a.length];
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      j += a.length + 1;
    }
  }

  // The latest recorded frame at or before t.
  frameAt(t) {
    let best = null;
    for (const f of this.frames) if (f.t <= t && (!best || f.t > best.t)) best = f;
    return best;
  }

  // A tracer someone fired (shooting.js), kept for replays.
  shot(by, a, b, color, width, linger) {
    const s = this.shots[this.shotHead];
    this.shotHead = (this.shotHead + 1) % SHOTS;
    s.t = this.game.time;
    s.by = by;
    s.a.copy(a);
    s.b.copy(b);
    s.color = color;
    s.width = width;
    s.linger = linger ?? 0;
  }

  // From Game.onKill: a local player smoked by someone else watches it again.
  start(victim, killer) {
    if (victim.isBot || !killer || killer === victim || killer.kind !== 'player') return;
    // (Early in a match the recording may not reach back that far.)
    let oldest = Infinity;
    for (const f of this.frames) if (f.t > -Infinity && f.t < oldest) oldest = f.t;
    if (!Number.isFinite(oldest)) return;
    const t0 = Math.max(oldest, this.game.time - REPLAY.before);
    this.views.set(victim, { killer, t0, start: this.game.time, shotT: t0 });
  }

  // How far into its replay a player's view is (seconds), or -1 when it isn't showing one.
  showing(p) {
    const v = this.views.get(p);
    if (!v) return -1;
    const e = this.game.time - v.start;
    if (p.alive || e > REPLAY.length) {
      this.views.delete(p);
      return -1;
    }
    return e;
  }

  killerOf(p) {
    return this.views.get(p)?.killer ?? null;
  }

  // Before a replaying view renders: the past onto the bodies, the camera to the killer's eye,
  // and the killer's shots since the last frame as tracers only this view sees. Returns false
  // (and changes nothing) when there's no recording for that moment.
  begin(p, cam) {
    const v = this.views.get(p);
    const t = v.t0 + (this.game.time - v.start);
    const f = this.frameAt(t);
    if (!f) return false;
    this.write(this.now);
    this.read(f.d);
    const b = this.bodies.find((x) => x.p === v.killer);
    if (b) {
      const i = b.off;
      cam.position.set(f.d[i + 8], f.d[i + 9], f.d[i + 10]);
      cam.rotation.set(f.d[i + 12], f.d[i + 11], 0);
      // We're looking out of their eyes (bots' bodies aren't on a layer of their own).
      b.group.visible = false;
    }
    this.mask = cam.layers.mask;
    cam.layers.enableAll();
    cam.layers.disable(1 + v.killer.id);
    for (const s of this.shots) {
      if (s.by === v.killer && s.t > v.shotT && s.t <= t) {
        this.game.fx.tracer(s.a, s.b, s.color, s.width, { owner: 1000 + p.id, linger: s.linger });
      }
    }
    v.shotT = t;
    return true;
  }

  // After it rendered: the present back.
  end(cam) {
    this.read(this.now);
    cam.layers.mask = this.mask;
  }
}
