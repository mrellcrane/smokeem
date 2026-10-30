import * as THREE from 'three';
import { CAMERA } from '../config.js';
import { setView } from '../fx/viewUniforms.js';

// Portal Gun (Portal's): fire opens your blue portal and the aim button your orange one, on any
// flat wall, floor or ceiling with room for it (not mud, nets, ropes, belts or the invisible
// blockers). Shooting a color again moves it. Each player has their own pair, ringed in their
// armor color; your two link to each other. Anyone goes through anyone's linked portals with
// their speed turned along (speedy thing goes in, speedy thing comes out): players, bullets,
// rockets, grenades, coals, sticky bombs, props, jars and bugs. Your portals close when you're
// smoked.
//
// A portal is an oval in a plane: center c, normal n (out of the surface), up u and right r
// (r = u x n). Going through one maps a point or direction from the entry's frame to the exit's,
// turned half a turn about up: right flips, up stays, into-the-surface becomes out-of-it.
// All portals draw as one instanced mesh with a swirling surface. On Medium and High each linked
// portal also shows a picture of what's out of the other one: a low-resolution snapshot from a
// camera at the exit, refreshed a few times a second (one portal every few frames, round robin),
// all in one atlas texture so they stay one draw call. It's a picture, not a window: it doesn't
// shift as you move.

export const PORTAL = {
  // Half width and half height of the oval (m).
  hw: 0.62,
  hh: 1.0,
  // Drawn this far off the surface.
  lift: 0.012,
  // Out of an exit at least this fast (m/s), so nothing sits in the doorway.
  minExit: 3,
  // Nothing goes back through a portal this soon after coming out of one.
  cooldown: 0.2,
};
export const PORTAL_COLORS = [0x2e8bff, 0xff7a12];
// Surfaces a portal won't stick to (materials.js).
const NO_SURFACE = new Set(['mud', 'cloth']);
const MAX = 32;
// A wall portal settles onto floor this far (m) under its bottom edge.
const SETTLE_REACH = 2.5;
// The pictures' atlas: CELLS x CELLS cells of CW x CH texels (the oval's shape).
const CELLS = 4;
const CW = 160;
const CH = 256;
// Where a portal may slide to from the hit point to find room, nearest first.
const NUDGES = (() => {
  const out = [[0, 0]];
  for (let d = 0.15; d <= 1.2 + 1e-6; d += 0.15) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      out.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
  }
  return out;
})();
// The oval's rim (as fractions of the half sizes) and its middle, checked for a flat surface.
const RIM = [[0, 0], ...Array.from({ length: 12 }, (_, k) => [Math.cos((k / 12) * Math.PI * 2) * 0.97, Math.sin((k / 12) * Math.PI * 2) * 0.97]), [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]];

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _keep = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute vec3 aOwner;
  attribute float aLinked;
  attribute float aCell;
  varying vec2 vP;
  varying vec3 vColor;
  varying vec3 vOwner;
  varying float vLinked;
  varying float vCell;
  void main() {
    vP = position.xy;
    vCell = aCell;
    vColor = aColor;
    vOwner = aOwner;
    vLinked = aLinked;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
// The quad is 1.12x the oval: the edge sits at 1 / 1.12 of it, the owner's ring just outside.
const FRAG = /* glsl */ `
  uniform float uTime;
  #ifdef PORTAL_VIEWS
  uniform sampler2D uAtlas;
  #endif
  varying float vCell;
  varying vec2 vP;
  varying vec3 vColor;
  varying vec3 vOwner;
  varying float vLinked;
  void main() {
    float e = length(vP) * 1.12;
    if (e > 1.1) discard;
    vec3 col;
    if (e > 1.03) {
      col = vOwner;
    } else if (e > 1.0) {
      discard;
    } else {
      float a = atan(vP.y, vP.x);
      float swirl = 0.5 + 0.5 * sin(a * 3.0 + e * 9.0 - uTime * (2.0 + vLinked * 2.0));
      vec3 inner = mix(vColor * 0.12, vColor * 0.55, swirl * (1.0 - e * 0.6));
      // Unlinked: a dimmer, slower surface.
      inner *= 0.55 + 0.45 * vLinked;
      #ifdef PORTAL_VIEWS
      // The picture of the other side, with the swirl around its edge.
      if (vCell >= 0.0 && vLinked > 0.5) {
        vec2 cell = vec2(mod(vCell, ${CELLS}.0), floor(vCell / ${CELLS}.0));
        vec2 uv = (cell + clamp(vP * 1.12 * 0.5 + 0.5, 0.0, 1.0)) / ${CELLS}.0;
        vec3 view = texture2D(uAtlas, uv).rgb;
        inner = mix(view, inner, smoothstep(0.55, 0.95, e) * 0.9);
      }
      #endif
      float rim = smoothstep(0.8, 0.97, e);
      col = mix(inner, vColor * 1.4 + 0.15, rim);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Portals {
  // viewEvery: refresh a portal's picture every this many frames (0: no pictures).
  constructor(game, viewEvery = 0) {
    this.game = game;
    this.viewEvery = viewEvery;
    this.frame = 0;
    this.next = 0;
    // Every open portal, and each player's pair ([blue, orange], either may be null).
    this.list = [];
    this.pairs = new Map();
    const geom = new THREE.PlaneGeometry(2, 2);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.aOwner = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.aLinked = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(MAX).fill(-1), 1);
    geom.setAttribute('aCell', this.aCell);
    geom.setAttribute('aColor', this.aColor);
    geom.setAttribute('aOwner', this.aOwner);
    geom.setAttribute('aLinked', this.aLinked);
    // The pictures: an atlas render target, free cells, and the camera that takes them.
    const uniforms = { uTime: { value: 0 } };
    const defines = {};
    if (viewEvery > 0) {
      this.atlas = new THREE.WebGLRenderTarget(CW * CELLS, CH * CELLS, { depthBuffer: true });
      this.atlas.texture.name = 'portalViews';
      this.atlas.scissorTest = true;
      this.freeCells = Array.from({ length: CELLS * CELLS }, (_, i) => CELLS * CELLS - 1 - i);
      this.camera = new THREE.PerspectiveCamera(75, CW / CH, CAMERA.near, CAMERA.far);
      this.camera.layers.enableAll();
      uniforms.uAtlas = { value: this.atlas.texture };
      defines.PORTAL_VIEWS = '';
    }
    this.material = new THREE.ShaderMaterial({
      uniforms,
      defines,
      vertexShader: VERT,
      fragmentShader: FRAG,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.material.name = 'portals';
    this.mesh = new THREE.InstancedMesh(geom, this.material, MAX);
    this.mesh.name = 'portals';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    game.scene.add(this.mesh);
    this.ray = new game.physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    this._cross = { portal: null, t: 0 };
  }

  pair(p) {
    let pr = this.pairs.get(p);
    if (!pr) {
      pr = [null, null];
      this.pairs.set(p, pr);
    }
    return pr;
  }

  // The portal this one leads to, or null.
  exitOf(portal) {
    return this.pairs.get(portal.owner)?.[1 - portal.which] ?? null;
  }

  // Open one of p's portals where a shot hit the level (hit: castShot's result, with handle).
  // look: the aim, which turns floor and ceiling portals. Returns false (and opens nothing) when
  // there's no room there.
  place(p, which, hit, look) {
    const game = this.game;
    if (!hit.hit || hit.entity || NO_SURFACE.has(hit.surface) || game.arena.blockers.has(hit.handle)) return false;
    const n = _a.copy(hit.normal).normalize();
    // Up along a wall; on a floor or ceiling, away from the shooter.
    if (Math.abs(n.y) > 0.7) _u.set(look.x, 0, look.z);
    else _u.copy(UP);
    _u.addScaledVector(n, -_u.dot(n));
    if (_u.lengthSq() < 1e-6) _u.set(0, 0, -1).addScaledVector(n, -n.z);
    _u.normalize();
    _r.crossVectors(_u, n).normalize();
    const mine = this.pair(p);
    for (const [dx, dy] of NUDGES) {
      _b.copy(hit.point).addScaledVector(_r, dx * PORTAL.hw).addScaledVector(_u, dy * PORTAL.hh);
      if (!this.fits(_b, n, _u, _r, mine[which])) continue;
      // A wall portal with floor not far under it settles down onto the floor, like a doorway,
      // so you can walk into it wherever you aimed on the wall.
      if (Math.abs(n.y) < 0.3) this.settle(_b, n, _u, _r, mine[which]);
      let portal = mine[which];
      if (!portal) {
        if (this.list.length >= MAX) return false;
        portal = { owner: p, which, c: new THREE.Vector3(), n: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), cell: this.freeCells?.pop() ?? -1 };
        mine[which] = portal;
        this.list.push(portal);
      }
      // No picture until the next snapshot of its other side (or of this side, for the other).
      portal.shot = false;
      const other = this.exitOf(portal);
      if (other) other.shot = false;
      portal.c.copy(_b).addScaledVector(n, PORTAL.lift);
      portal.n.copy(n);
      portal.u.copy(_u);
      portal.r.copy(_r);
      game.sfx.play('portalOpen', { at: portal.c });
      return true;
    }
    return false;
  }

  // Move a wall portal at c (in place) down to sit just above the floor in front of it, if
  // there's floor within reach under its bottom and it still fits there.
  settle(c, n, u, r, replacing) {
    const game = this.game;
    const ray = this.ray;
    _p.copy(c).addScaledVector(u, -PORTAL.hh).addScaledVector(n, 0.35);
    ray.origin.x = _p.x;
    ray.origin.y = _p.y;
    ray.origin.z = _p.z;
    ray.dir.x = 0;
    ray.dir.y = -1;
    ray.dir.z = 0;
    const h = game.physics.world.castRayAndGetNormal(ray, SETTLE_REACH, true, game.shotFilter, undefined, undefined, undefined, game.notBody);
    if (!h || h.normal.y < 0.7 || h.timeOfImpact < 0.05) return;
    _keep.copy(c);
    c.y -= h.timeOfImpact - 0.03;
    if (!this.fits(c, n, u, r, replacing)) c.copy(_keep);
  }

  // Whether an oval at c (frame n, u, r) lies on one flat stretch of level with nothing standing
  // proud of it, and clear of every other portal on that plane (but `replacing`).
  fits(c, n, u, r, replacing) {
    const game = this.game;
    const world = game.physics.world;
    const ray = this.ray;
    for (const [fx, fy] of RIM) {
      _p.copy(c).addScaledVector(r, fx * PORTAL.hw).addScaledVector(u, fy * PORTAL.hh).addScaledVector(n, 0.1);
      ray.origin.x = _p.x;
      ray.origin.y = _p.y;
      ray.origin.z = _p.z;
      ray.dir.x = -n.x;
      ray.dir.y = -n.y;
      ray.dir.z = -n.z;
      const h = world.castRayAndGetNormal(ray, 0.2, true, game.shotFilter, undefined, undefined, undefined, game.notBody);
      if (!h || Math.abs(h.timeOfImpact - 0.1) > 0.04) return false;
      if (h.normal.x * n.x + h.normal.y * n.y + h.normal.z * n.z < 0.98) return false;
      if (game.arena.blockers.has(h.collider.handle) || NO_SURFACE.has(game.arena.surfaces.get(h.collider.handle))) return false;
    }
    // The mud's surface has no collider: never over it.
    if (game.zones.mudTop(c, 0.5) !== null) return false;
    for (const q of this.list) {
      if (q === replacing) continue;
      if (q.n.dot(n) < 0.98 || Math.abs(_d.subVectors(q.c, c).dot(n)) > 0.05) continue;
      // On the same plane: keep the ovals apart (by the frames' sizes, roughly).
      const x = _d.dot(r) / (PORTAL.hw * 2);
      const y = _d.dot(u) / (PORTAL.hh * 2);
      if (x * x + y * y < 1) return false;
    }
    return true;
  }

  // Close a player's portals (smoked, or gone).
  close(p) {
    const pr = this.pairs.get(p);
    if (!pr) return;
    for (let i = 0; i < 2; i++) {
      if (!pr[i]) continue;
      if (pr[i].cell >= 0) this.freeCells.push(pr[i].cell);
      this.list.splice(this.list.indexOf(pr[i]), 1);
      pr[i] = null;
    }
  }

  // The nearest linked portal whose front a ray (unit dir) goes into within maxDist, as
  // { portal, t } (a reused object), or null.
  cross(origin, dir, maxDist) {
    let best = null;
    let bt = maxDist;
    for (const q of this.list) {
      const denom = dir.dot(q.n);
      if (denom > -1e-4 || !this.exitOf(q)) continue;
      const t = _d.subVectors(q.c, origin).dot(q.n) / denom;
      if (t < -0.05 || t > bt) continue;
      _p.copy(origin).addScaledVector(dir, t).sub(q.c);
      const x = _p.dot(q.r) / PORTAL.hw;
      const y = _p.dot(q.u) / PORTAL.hh;
      if (x * x + y * y > 1) continue;
      best = q;
      bt = t;
    }
    if (!best) return null;
    this._cross.portal = best;
    this._cross.t = Math.max(0, bt);
    return this._cross;
  }

  // A point through a portal (out may be pos).
  warpPoint(portal, pos, out) {
    const ex = this.exitOf(portal);
    _d.subVectors(pos, portal.c);
    const x = _d.dot(portal.r);
    const y = _d.dot(portal.u);
    const z = _d.dot(portal.n);
    return out.copy(ex.c).addScaledVector(ex.r, -x).addScaledVector(ex.u, y).addScaledVector(ex.n, -z);
  }

  // A direction or velocity through a portal (out may be dir).
  warpDir(portal, dir, out) {
    const ex = this.exitOf(portal);
    const x = dir.dot(portal.r);
    const y = dir.dot(portal.u);
    const z = dir.dot(portal.n);
    return out.set(0, 0, 0).addScaledVector(ex.r, -x).addScaledVector(ex.u, y).addScaledVector(ex.n, -z);
  }

  // A shot through any portals in its way (up to 3 of them): casts each leg from where the last
  // came out. legs gets each leg's start and end ([a, b] pairs of vectors, reused). Returns the
  // last leg's castShot result, and the number of legs in legs.count.
  trace(origin, dir, range, exclude, legs) {
    const game = this.game;
    _a.copy(origin);
    _b.copy(dir);
    let left = range;
    let ex = exclude;
    let hit = null;
    legs.count = 0;
    for (let leg = 0; leg < 4; leg++) {
      hit = game.castShot(_a, _b, left, ex);
      const reach = hit.hit ? hit.distance + 0.05 : left;
      const c = leg < 3 ? this.cross(_a, _b, reach) : null;
      const L = legs[legs.count++];
      L[0].copy(_a);
      if (!c) {
        L[1].copy(_a).addScaledVector(_b, hit.hit ? hit.distance : left);
        return hit;
      }
      L[1].copy(_a).addScaledVector(_b, c.t);
      left -= c.t;
      const portal = c.portal;
      this.warpPoint(portal, L[1], _a);
      this.warpDir(portal, _b, _b);
      _a.addScaledVector(this.exitOf(portal).n, 0.03);
      // Through a portal, your own shot can come back at you.
      ex = undefined;
    }
    return hit;
  }

  // A player moving by (dx, dy, dz) this tick: through a portal they walk, fall or jump into
  // (a standing player drops through a floor portal under them). Returns true if they went.
  movePlayer(p, dx, dy, dz) {
    if (!this.list.length || p.portalT > this.game.time) return false;
    const len = Math.hypot(dx, dy, dz);
    let c = null;
    // Any part of the body going in counts: rays along the move from the middle, low and high.
    if (len > 1e-4) {
      _r.set(dx / len, dy / len, dz / len);
      const k = p.halfHeight + p.radius * 0.5;
      for (const off of [0, -k, k]) {
        _u.copy(p.center);
        _u.y += off;
        c = this.cross(_u, _r, len + p.radius);
        if (c) break;
      }
    }
    if (!c && p.grounded && dy <= 0) {
      c = this.cross(p.center, DOWN, p.halfHeight + p.radius + 0.12);
      if (c && c.portal.n.y < 0.7) c = null;
    }
    if (!c) return false;
    const entry = c.portal;
    const exit = this.exitOf(entry);
    // Where we come out: our place on the oval carried across, kept well inside it, then out of
    // the surface far enough to clear it.
    this.warpPoint(entry, p.center, _a);
    _d.subVectors(_a, exit.c);
    const x = THREE.MathUtils.clamp(_d.dot(exit.r), -PORTAL.hw * 0.4, PORTAL.hw * 0.4);
    const y = THREE.MathUtils.clamp(_d.dot(exit.u), -PORTAL.hh * 0.4, PORTAL.hh * 0.4);
    const clear = Math.abs(exit.n.y) > 0.7 ? p.halfHeight + p.radius + 0.06 : p.radius + 0.12;
    _a.copy(exit.c).addScaledVector(exit.r, x).addScaledVector(exit.u, y).addScaledVector(exit.n, clear);
    // A wall exit near the floor: rise until the body fits (or give up).
    const shape = p.crouched ? p.crouchShape : p.standShape;
    let lift = 0;
    while (lift <= 1 && p.overlaps(shape, _a.x, _a.y + lift, _a.z)) lift += 0.1;
    if (lift > 1) return false;
    _a.y += lift;
    // Speed carried across, at least minExit out of the exit.
    this.warpDir(entry, p.vel, p.vel);
    const out = p.vel.dot(exit.n);
    if (out < PORTAL.minExit) p.vel.addScaledVector(exit.n, PORTAL.minExit - out);
    // The view turns with us.
    _d.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    this.warpDir(entry, _d, _d);
    if (Math.hypot(_d.x, _d.z) > 0.2) p.yaw = Math.atan2(-_d.x, -_d.z);
    p.center.copy(_a);
    p.prevCenter.copy(_a);
    p.body.setTranslation(p.center, true);
    p.grounded = false;
    p.coyote = 0;
    p.portalT = this.game.time + PORTAL.cooldown;
    this.game.sfx.play('portalEnter', { at: p.center, source: p });
    return true;
  }

  // Something flying (a missile, bolt or bug) at pos along unit dir, stepping `step` this tick:
  // through a portal if one is in the way before `before` (the distance to whatever it would hit).
  // Moves pos and turns dir (and vel, if given) in place. Returns the portal used, or null.
  carry(pos, dir, step, before = Infinity, vel = null) {
    if (!this.list.length) return null;
    const c = this.cross(pos, dir, Math.min(step, before + 0.05));
    if (!c) return null;
    const entry = c.portal;
    pos.addScaledVector(dir, c.t);
    this.warpPoint(entry, pos, pos);
    pos.addScaledVector(this.exitOf(entry).n, 0.05);
    this.warpDir(entry, dir, dir);
    if (vel) this.warpDir(entry, vel, vel);
    return entry;
  }

  // A physics body (grenade, coal, sticky, prop) at pos with vel, radius r: if its next step goes
  // into a portal, put it out of the exit now. Returns true if it went.
  carryBody(body, pos, vel, r, dt) {
    if (!this.list.length) return false;
    const speed = vel.length();
    if (speed < 0.5) return false;
    _r.copy(vel).divideScalar(speed);
    const c = this.cross(pos, _r, speed * dt + r + 0.05);
    if (!c) return false;
    const entry = c.portal;
    const exit = this.exitOf(entry);
    this.warpPoint(entry, pos, _a);
    _d.subVectors(_a, exit.c);
    _a.addScaledVector(exit.n, r + 0.08 - _d.dot(exit.n));
    this.warpDir(entry, vel, vel);
    const out = vel.dot(exit.n);
    if (out < PORTAL.minExit) vel.addScaledVector(exit.n, PORTAL.minExit - out);
    pos.copy(_a);
    body.setTranslation({ x: _a.x, y: _a.y, z: _a.z }, true);
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    return true;
  }

  updateVisuals(dt) {
    this.material.uniforms.uTime.value += dt;
    const m = this.mesh;
    let n = 0;
    for (const q of this.list) {
      _m.makeBasis(_r.copy(q.r).multiplyScalar(PORTAL.hw * 1.12), _u.copy(q.u).multiplyScalar(PORTAL.hh * 1.12), q.n);
      _m.setPosition(q.c);
      m.setMatrixAt(n, _m);
      _col.set(PORTAL_COLORS[q.which]).toArray(this.aColor.array, n * 3);
      _col.set(q.owner.color ?? 0xffffff).toArray(this.aOwner.array, n * 3);
      this.aLinked.array[n] = this.exitOf(q) ? 1 : 0;
      this.aCell.array[n] = q.shot ? q.cell : -1;
      n++;
    }
    m.count = n;
    m.visible = n > 0;
    if (n) {
      m.instanceMatrix.needsUpdate = true;
      this.aColor.needsUpdate = this.aOwner.needsUpdate = this.aLinked.needsUpdate = this.aCell.needsUpdate = true;
    }
  }

  // After the views render: every viewEvery frames, the next linked portal's picture of its
  // other side (from just out of the exit, looking out, its up the exit's up).
  snapshot(renderer, force = false) {
    if (!this.atlas || (!force && ++this.frame % this.viewEvery)) return;
    const linked = this.list.filter((q) => q.cell >= 0 && this.exitOf(q));
    if (!linked.length) return;
    const q = linked[this.next++ % linked.length];
    const ex = this.exitOf(q);
    const cam = this.camera;
    cam.position.copy(ex.c).addScaledVector(ex.n, 0.05);
    cam.up.copy(ex.u);
    cam.lookAt(_p.copy(ex.c).addScaledVector(ex.n, 1));
    const x = (q.cell % CELLS) * CW;
    const y = Math.floor(q.cell / CELLS) * CH;
    this.atlas.viewport.set(x, y, CW, CH);
    this.atlas.scissor.set(x, y, CW, CH);
    // Everyone's own effects and bodies show in the picture.
    setView(-1, CH);
    if (this.game.oysters) this.game.oysters.uniforms.uHide.value = -1;
    const was = this.mesh.visible;
    this.mesh.visible = false;
    renderer.setRenderTarget(this.atlas);
    renderer.clear(true, true, false);
    renderer.render(this.game.scene, cam);
    renderer.setRenderTarget(null);
    this.mesh.visible = was;
    q.shot = true;
  }

  warmup(on, at) {
    const m = this.mesh;
    if (on) {
      m.setMatrixAt(0, _m.makeTranslation(at.x, at.y, at.z));
      m.instanceMatrix.needsUpdate = true;
    }
    m.count = on ? 1 : 0;
    m.visible = on;
  }

  dispose() {
    this.atlas?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
