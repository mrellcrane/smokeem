import * as THREE from 'three';
import { CAMERA } from '../config.js';

// The end of a match, game-show style: the top three stand on a podium on the Summit deck, the
// winner with both arms up, while confetti rains, the crowd goes wild and the big screen names
// the winner. A slow camera orbits the podium, full screen, behind the results panel (which
// moves to the side). Built once when the match ends; nothing here exists before that.

const DECK = 6;
const BLOCKS = [
  // place, x, height, color
  [1, 0, 1.2, 0xe0b53a],
  [2, -1.9, 0.8, 0xb8c0c8],
  [3, 1.9, 0.5, 0xb87a48],
];
const CONFETTI = 600;
const COLORS = [0xff7a1a, 0xe0b53a, 0x3d7bd9, 0xd9443d, 0x3dbd5a, 0xe05fa0, 0x9fd84a, 0xf4ead8, 0x63f2ff];
// The camera's orbit around the podium; `shift` moves the picture left (a fraction of the width)
// so the podium sits beside the results panel, not behind it.
const ORBIT = { radius: 7.2, height: DECK + 2.3, speed: 0.12, look: DECK + 1.6, shift: 0.22 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Finale {
  constructor(game, results) {
    this.game = game;
    this.t = 0;
    this.group = new THREE.Group();
    this.group.name = 'finale';
    // The podium: gold, silver and bronze blocks.
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const parts = BLOCKS.map(([, x, h, color]) => this.box(1.7, h, 1.7, x, DECK + h / 2, 0, color));
    for (const g of parts) this.group.add(new THREE.Mesh(g, this.material));
    // (Casting only: the flat tops banded with shadow acne when they received too.)
    for (const m of this.group.children) m.castShadow = true;
    game.scene.add(this.group);

    // The top three on their blocks (ties keep standings order), facing the start of the orbit.
    const top = results.standings.slice(0, 3);
    this.podium = top.map((s, i) => {
      const [, x, h] = BLOCKS[i];
      const p = s.player;
      p.model.reset();
      p.model.group.visible = true;
      p.model.setWeapon(null);
      return { p, x, y: DECK + h, cheer: s.place === 1 ? 1 : 0.6, phase: i * 1.7 };
    });
    for (const p of game.players) if (!this.podium.some((o) => o.p === p)) p.model.group.visible = false;

    // Confetti: small flat pieces in many colors, blown up from the podium, then raining down.
    this.pieceMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.06), this.pieceMaterial, CONFETTI);
    this.confetti.frustumCulled = false;
    this.pieces = [];
    const c = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) {
      this.confetti.setColorAt(i, c.set(COLORS[i % COLORS.length]));
      const burst = i < CONFETTI / 2;
      const a = Math.random() * Math.PI * 2;
      const piece = {
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
        sway: Math.random() * 6,
      };
      if (burst) {
        // Two cannons at the sides of the podium.
        const side = i % 2 ? 1 : -1;
        piece.pos.set(side * 3.4, DECK + 0.5, 0.5);
        piece.vel.set(-side * (1 + Math.random() * 3), 8 + Math.random() * 6, (Math.random() - 0.5) * 4);
      } else {
        this.respawn(piece, a, Math.random() * 10);
      }
      this.pieces.push(piece);
    }
    game.scene.add(this.confetti);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
    game.show?.finale(results.winners);
    game.sfx.play('cheer', { volume: 1 });
    game.sfx.play('cheer', { volume: 0.7, delay: 0.6, rate: 0.9 });
  }

  box(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const cc = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      // A touch darker toward the bottom.
      const k = 0.75 + 0.25 * Math.min(1, (g.attributes.position.getY(i) - DECK) / 1.2);
      col[i * 3] = cc.r * k;
      col[i * 3 + 1] = cc.g * k;
      col[i * 3 + 2] = cc.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }

  // Throwaway meshes with the finale's material setups, for the match's shader warm-up, so the
  // end of a match doesn't stall compiling them.
  static warmupMeshes() {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshLambertMaterial({ vertexColors: true }));
    box.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(box.geometry.attributes.position.count * 3).fill(1), 3));
    box.castShadow = true;
    const bits = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 1);
    bits.setColorAt(0, new THREE.Color(0xffffff));
    return [box, bits];
  }

  respawn(piece, a, high) {
    const r = Math.sqrt(Math.random()) * 7;
    piece.pos.set(Math.cos(a) * r, DECK + 8 + high, Math.sin(a) * r);
    piece.vel.set(0, -1.2 - Math.random() * 0.8, 0);
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    // The three on the podium: standing, facing out, cheering.
    const state = this.state ?? (this.state = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, fwd: 0, side: 0, grounded: true, crouched: false, climbing: false });
    for (const o of this.podium) {
      state.x = o.x;
      state.y = o.y;
      state.z = 0;
      // (A body faces -z at yaw 0: this faces the orbit's start, south.)
      state.yaw = Math.PI;
      state.pitch = 0.1;
      o.p.model.update(dt, state);
      o.p.model.cheer(t + o.phase, o.cheer);
    }
    // Confetti: falls, sways and spins; the burst arcs up first.
    for (let i = 0; i < this.pieces.length; i++) {
      const c = this.pieces[i];
      c.vel.y -= (c.vel.y > -1.5 ? 9 : 0) * dt;
      c.vel.x *= 1 - dt * 0.8;
      c.vel.z *= 1 - dt * 0.8;
      c.pos.addScaledVector(c.vel, dt);
      c.pos.x += Math.sin(t * 2 + c.sway) * 0.4 * dt;
      c.pos.z += Math.cos(t * 1.6 + c.sway) * 0.4 * dt;
      c.rot.addScaledVector(c.spin, dt);
      if (c.pos.y < DECK - 0.5) this.respawn(c, Math.random() * Math.PI * 2, Math.random() * 3);
      _e.set(c.rot.x, c.rot.y, c.rot.z);
      this.confetti.setMatrixAt(i, _m.compose(c.pos, _q.setFromEuler(_e), _s.set(1, 1, 1)));
    }
    this.confetti.instanceMatrix.needsUpdate = true;
    // The camera orbits slowly, starting from the south.
    const a = t * ORBIT.speed;
    this.camera.position.set(Math.sin(a) * ORBIT.radius, ORBIT.height + Math.sin(t * 0.3) * 0.4, Math.cos(a) * ORBIT.radius);
    this.camera.lookAt(_p.set(0, ORBIT.look, 0));
  }

  render(renderer) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (this.camera.aspect !== W / H || this.w !== W) {
      this.w = W;
      this.camera.aspect = W / H;
      this.camera.setViewOffset(W, H, W * ORBIT.shift, 0, W, H);
      this.camera.updateProjectionMatrix();
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.shadowMap.needsUpdate = true;
    renderer.clear(true, true, false);
    // (Every body layer, so all three show.)
    this.camera.layers.enableAll();
    renderer.render(this.game.scene, this.camera);
  }

  dispose() {
    for (const m of this.group.children) m.geometry.dispose();
    this.material.dispose();
    this.confetti.geometry.dispose();
    this.pieceMaterial.dispose();
    this.group.removeFromParent();
    this.confetti.removeFromParent();
  }
}
