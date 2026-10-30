import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Rocky Mountain Oysters (GAME_DESIGN.md "Modes"): a mode on top of free-for-all. Every kill
// grows a cartoon sack hanging off the back of your belt; big ones drag and bounce along the
// ground behind you. Shots that hit it hurt you more, each size slows you a little, smoking
// someone bigger than you is worth a bonus point, crouching three times over someone you just
// smoked shouts SAUCED! (and grows you a size). Your size stays through deaths: it only grows.
//
// Each sack is a point on a short rope from the belt, stepped with the render frame (it's only
// looks and a target; nothing collides with it). The sack always hangs straight off the belt
// (its neck stretches a little as it swings, so it sags rather than dangling on a stalk) and
// drags because it's big. All sacks are one instanced mesh: one draw call per view.

const MAX_SIZE = 12;
// Sack radius and how far its middle can swing from the belt (m) at size n. At about 9 kills
// the bottom reaches the floor.
const radiusAt = (n) => 0.06 + 0.03 * n;
const ropeAt = (n) => 0.02 + radiusAt(n) * 1.07;
// The geometry's neck top, in sack radii above its middle, and how far the sack may sag.
const NECK = 0.93;
const SAG_MAX = 1.6;
// Movement and jump multipliers at size n.
export const speedAt = (n) => Math.max(0.72, 1 - 0.035 * n);
export const jumpAt = (n) => Math.max(0.8, 1 - 0.025 * n);
// Damage taken by a hit on the sack.
export const LOW_BLOW = 1.5;
// SAUCED: this many crouches within this long, this close to the one you just smoked.
const SAUCE_CROUCHES = 3;
const SAUCE_TIME = 3;
const SAUCE_REACH = 2.6;
const GRAVITY = 16;
const SKIN = 0xd99a86;

const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// A two-lobed sack around the origin (radius about 1, the neck up +y), vertex-colored with a
// darker seam down the middle and a little wrinkle shading.
function sackGeometry() {
  const lobe = (x) => {
    const g = new THREE.SphereGeometry(0.62, 18, 12);
    g.scale(1, 1.08, 0.95);
    g.translate(x, -0.05, 0);
    return g;
  };
  // A wide, short neck that flares into both lobes (a sack, not a stalk).
  const neck = new THREE.CylinderGeometry(0.46, 0.72, 0.7, 18, 3, true);
  neck.translate(0, 0.58, 0);
  const g = mergeGeometries([lobe(-0.43), lobe(0.43), neck].map((x) => x.toNonIndexed()), false);
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(SKIN);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const seam = Math.exp(-(x * x) / 0.006) * 0.35;
    const wrinkle = 0.06 * Math.sin(y * 23 + Math.sin(z * 9) * 2) * Math.sin(x * 17);
    const k = 1 - seam - Math.max(0, wrinkle) - Math.max(0, -y - 0.4) * 0.15;
    col[i * 3] = base.r * k;
    col[i * 3 + 1] = base.g * k;
    col[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class Oysters {
  constructor(game, scene) {
    this.game = game;
    const cap = 16;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'oysters';
    // Each sack's owner (aOwner) and the player whose view is drawing (uHide; Game.render sets
    // it): your own sack hides in your own view like your body does, and in a death replay
    // the killer's (we're looking out of their eyes).
    this.uniforms = { uHide: { value: -1 } };
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uHide = this.uniforms.uHide;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aOwner;\nuniform float uHide;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tif (abs(aOwner - uHide) < 0.5) transformed = vec3(0.0);');
    };
    this.material.customProgramCacheKey = () => 'oysters';
    const geom = sackGeometry();
    this.owners = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(-1), 1);
    geom.setAttribute('aOwner', this.owners);
    this.sacks = new THREE.InstancedMesh(geom, this.material, cap);
    const m = this.sacks;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    m.visible = false;
    scene.add(m);
    // Per player: size, the sack's place now and last frame (a point on a rope), SAUCED state.
    this.state = new Map();
  }

  of(p) {
    let s = this.state.get(p);
    if (!s) {
      // pos/prev: the simulated point; mid: the drawn sack's middle (shots aim at it).
      s = { size: 0, pos: new THREE.Vector3(), prev: new THREE.Vector3(), mid: new THREE.Vector3(), r: 0, placed: false, crouched: false, sauce: null };
      this.state.set(p, s);
    }
    return s;
  }

  size(p) {
    return this.state.get(p)?.size ?? 0;
  }

  grow(p, by = 1) {
    const s = this.of(p);
    s.size = Math.min(MAX_SIZE, s.size + by);
    this.applyBurden(p);
  }

  applyBurden(p) {
    const n = this.size(p);
    p.burdenSpeed = speedAt(n);
    p.burdenJump = jumpAt(n);
  }

  // From Game.onKill, after the match scored it. Bounty: smoking someone bigger is worth a point
  // more. Then the killer grows; the victim keeps theirs (owner call: sizes never reset).
  onKill(victim, info, match) {
    if (victim.kind !== 'player') return;
    const a = info.attacker;
    const vs = this.of(victim);
    const byOther = a && a !== victim && a.kind === 'player';
    if (byOther) {
      const as = this.of(a);
      if (vs.size > as.size) {
        a.stats.score++;
        const f = match.feed[match.feed.length - 1];
        if (f) f.how += ' · bounty';
        match.feedVersion++;
      }
      this.grow(a);
      as.sauce = { victim, x: victim.center.x, z: victim.center.z, t: this.game.time, count: 0 };
    }
    // (Hidden while they're down, and hung back on the belt when they respawn.)
    vs.placed = false;
    vs.sauce = null;
  }

  tick() {
    const now = this.game.time;
    const match = this.game.match;
    for (const p of this.game.players) {
      const s = this.of(p);
      // SAUCED: crouch three times over the one you just smoked, while they're still down.
      const down = p.crouched && !s.crouched;
      s.crouched = p.crouched;
      const sc = s.sauce;
      if (!sc) continue;
      if (now - sc.t > SAUCE_TIME || !p.alive) {
        s.sauce = null;
        continue;
      }
      if (down && Math.hypot(p.center.x - sc.x, p.center.z - sc.z) < SAUCE_REACH && ++sc.count >= SAUCE_CROUCHES) {
        s.sauce = null;
        this.grow(p);
        match.feed.push({ t: now, killer: p, victim: sc.victim, how: 'SAUCED!', headshot: false });
        if (match.feed.length > 8) match.feed.shift();
        match.feedVersion++;
        if (!p.isBot) {
          p.feedback.killT = now;
          p.feedback.killText = 'SAUCED!';
        }
        this.game.sfx.play('pickup', { at: p.center, source: p, rate: 0.7 });
      }
    }
  }

  // The belt point (behind the hips) of a body as drawn.
  anchor(p, out) {
    const g = p.model.group;
    const hips = p.model.bones.hips.position.y;
    const yaw = g.rotation.y;
    // Behind the body is +z in its own space.
    return out.set(g.position.x + Math.sin(yaw) * 0.11, g.position.y + hips - 0.06, g.position.z + Math.cos(yaw) * 0.11);
  }

  updateVisuals(dt) {
    const bake = this.game.bake;
    let n = 0;
    const step = Math.min(dt, 1 / 30);
    for (const p of this.game.players) {
      const s = this.of(p);
      if (!p.alive || n >= this.sacks.instanceMatrix.count) {
        s.placed = false;
        continue;
      }
      const r = radiusAt(s.size);
      const L = ropeAt(s.size);
      this.anchor(p, _a);
      if (!s.placed) {
        s.pos.copy(_a).y -= L;
        s.prev.copy(s.pos);
        s.placed = true;
      }
      // Verlet: carry on, fall, then stay within the rope of the belt.
      if (step > 0) {
        _d.subVectors(s.pos, s.prev).multiplyScalar(0.985);
        s.prev.copy(s.pos);
        s.pos.add(_d);
        s.pos.y -= GRAVITY * step * step;
      }
      _d.subVectors(s.pos, _a);
      const len = _d.length();
      if (len > L) s.pos.copy(_a).addScaledVector(_d, L / len);
      // The ground: it drags (friction) and bounces a little.
      const floor = bake ? bake.floorBelow(s.pos.x, s.pos.y + r, s.pos.z) : p.feetY();
      const ground = Number.isFinite(floor) ? floor : p.feetY();
      if (s.pos.y - r < ground) {
        s.pos.y = ground + r;
        s.prev.y = s.pos.y;
        s.prev.x += (s.pos.x - s.prev.x) * 0.25;
        s.prev.z += (s.pos.z - s.prev.z) * 0.25;
      }

      // The sack hangs from the belt: its neck top sits on the anchor and points at it, and it
      // sags (stretches along the neck) toward the swinging point, never further than SAG_MAX.
      _d.subVectors(_a, s.pos);
      const dist = Math.max(1e-3, _d.length());
      _d.divideScalar(dist);
      _q.setFromUnitVectors(UP, _d);
      const sag = Math.min(SAG_MAX, Math.max(1, dist / (r * NECK)));
      _s.set(r * (1 + (sag - 1) * 0.15), r * sag, r);
      s.mid.copy(_a).addScaledVector(_d, -NECK * r * sag);
      _m.compose(s.mid, _q, _s);
      this.sacks.setMatrixAt(n, _m);
      this.owners.array[n] = p.id;
      s.r = r;
      n++;
    }
    const m = this.sacks;
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
    this.owners.needsUpdate = true;
  }

  // The nearest sack a ray hits within maxDist (not the shooter's own), or null. Writes the hit
  // distance into out.distance.
  rayHit(origin, dir, maxDist, excludeCollider, out) {
    let best = maxDist;
    let owner = null;
    for (const [p, s] of this.state) {
      if (!s.placed || !p.alive || p.collider === excludeCollider) continue;
      const r = (s.r || radiusAt(s.size)) * 1.15;
      _d.subVectors(s.mid, origin);
      const along = _d.dot(dir);
      if (along < 0 || along - r > best) continue;
      const d2 = _d.lengthSq() - along * along;
      if (d2 > r * r) continue;
      const t = along - Math.sqrt(r * r - d2);
      if (t >= 0 && t < best) {
        best = t;
        owner = p;
      }
    }
    if (!owner) return null;
    out.distance = best;
    return owner;
  }

  // Shader warm-up: show one of each.
  warmup(on, at) {
    const m = this.sacks;
    m.visible = on;
    m.count = on ? 1 : 0;
    if (on) {
      m.setMatrixAt(0, _m.compose(at, _q.identity(), _s.set(0.2, 0.2, 0.2)));
      m.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.sacks.geometry.dispose();
    this.material.dispose();
    this.sacks.removeFromParent();
  }
}
