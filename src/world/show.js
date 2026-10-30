import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ordinal } from '../match.js';

// The game show around the arena (GAME_DESIGN.md "Tone and setting"): a crowd filling the
// grandstands (parts.js grandstands) and a big screen with the leader and the top three.
//
// The crowd is one instanced mesh of simple box people with mixed shirt colors (instanceColor,
// on the shirt only). The vertex shader makes them sway, bounce and throw their arms up with
// the crowd's hype, which spikes on every kill and settles back: no per-person work on the CPU,
// one draw call per view and none in the shadow pass. The screen is a canvas texture redrawn only
// when the scores change.

const SPACING = 1.15;
const SHIRTS = [0x3d7bd9, 0xd9443d, 0x3dbd5a, 0xe0b53a, 0x8a4fd0, 0xe05fa0, 0x9fd84a, 0xe8e2d6, 0xff7a1a, 0x2a2d31, 0x5a6a7a, 0xb8382c];
const SKIN = 0xc08a60;

// One person, feet at the origin facing -z: legs, a shirt (aShirt 1: takes the instance's
// color), a head, and two arms (aArm 1: they go up with the hype).
function personGeometry() {
  const part = (w, h, d, x, y, z, color, shirt, arm) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aShirt', new THREE.BufferAttribute(new Float32Array(n).fill(shirt), 1));
    g.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(n).fill(arm), 1));
    return g;
  };
  return mergeGeometries([
    part(0.36, 0.75, 0.24, 0, 0.375, 0, 0x2a2d31, 0, 0),
    part(0.46, 0.62, 0.28, 0, 1.06, 0, 0xffffff, 1, 0),
    part(0.24, 0.26, 0.24, 0, 1.52, 0, 0xffffff, 0, 0),
    part(0.12, 0.55, 0.12, -0.3, 1.02, 0, 0xffffff, 1, 1),
    part(0.12, 0.55, 0.12, 0.3, 1.02, 0, 0xffffff, 1, 1),
  ]);
}

const VERTEX_HEAD = /* glsl */ `
  attribute float aShirt;
  attribute float aArm;
  uniform float uTime;
  uniform float uHype;
`;
const VERTEX_MOVE = /* glsl */ `
  float ph = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
  float beat = 0.5 + 0.5 * sin(uTime * (7.0 + ph * 3.0) + ph * 6.283);
  float hype = clamp(uHype + 0.25 * (ph - 0.5), 0.0, 1.0);
  transformed.y += hype * beat * 0.22 + aArm * hype * (0.45 + 0.25 * beat);
  transformed.x += sin(uTime * 1.3 + ph * 6.283) * 0.05 * (transformed.y / 1.6);
`;

let personGeom = null;

export class Show {
  constructor(game) {
    this.game = game;
    const rows = game.arena.stands ?? [];
    const spots = [];
    for (const r of rows) {
      const dx = r.b[0] - r.a[0];
      const dz = r.b[2] - r.a[2];
      const len = Math.hypot(dx, dz);
      const n = Math.floor(len / SPACING);
      for (let i = 0; i <= n; i++) {
        // A few gaps, so it reads as people rather than a wall of them.
        if ((i * 7 + spots.length * 3) % 11 === 0) continue;
        const t = i / n;
        spots.push({ x: r.a[0] + dx * t, y: r.a[1], z: r.a[2] + dz * t, yaw: Math.atan2(-r.n[0], -r.n[1]) });
      }
    }
    personGeom ??= personGeometry();
    const geom = personGeom.clone();
    this.uniforms = { uTime: { value: 0 }, uHype: { value: 0.2 } };
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'crowd';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MOVE}`).replace(
        '#include <color_vertex>',
        `#include <color_vertex>\n  vColor.xyz = color.xyz * mix(vec3(1.0), instanceColor.xyz, aShirt);`,
      );
    };
    this.material.customProgramCacheKey = () => 'crowd';
    this.crowd = new THREE.InstancedMesh(geom, this.material, Math.max(1, spots.length));
    this.crowd.name = 'crowd';
    this.crowd.castShadow = false;
    this.crowd.receiveShadow = false;
    this.crowd.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    spots.forEach((o, i) => {
      const h = 0.92 + ((i * 37) % 17) / 100;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw + (((i * 13) % 9) - 4) * 0.04);
      m.compose(p.set(o.x + (((i * 29) % 7) - 3) * 0.04, o.y, o.z), q, s.set(h, h, h));
      this.crowd.setMatrixAt(i, m);
      this.crowd.setColorAt(i, c.set(SHIRTS[(i * 7 + (i >> 3)) % SHIRTS.length]));
    });
    this.crowd.count = spots.length;
    // One skin tone for every head keeps it one mesh; the shirts carry the variety.
    const col = geom.attributes.color;
    const skin = new THREE.Color(SKIN);
    for (let i = 0; i < col.count; i++) {
      const y = geom.attributes.position.getY(i);
      if (y > 1.38) skin.toArray(col.array, i * 3);
    }
    col.needsUpdate = true;
    game.scene.add(this.crowd);

    // The big screen (the map says where: one face over Mudlark's north stands, four around
    // the factory's jumbotron), every face showing the same canvas, in one mesh.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.screenMaterial = new THREE.MeshBasicMaterial({ map: this.texture, fog: false, toneMapped: false });
    const scr = game.arena.screen;
    const faces = scr.faces.map((f) => {
      const g = new THREE.PlaneGeometry(scr.w, scr.h);
      g.rotateY(f.yaw);
      g.translate(...f.pos);
      return g;
    });
    this.screen = new THREE.Mesh(faces.length > 1 ? mergeGeometries(faces) : faces[0], this.screenMaterial);
    this.screen.name = 'bigScreen';
    game.scene.add(this.screen);
    this.hype = 0.2;
    this.version = -1;
    this.flashT = 0;
    this.draw();
  }

  // A kill: the crowd goes up (more for a headshot), and the screen shows who did it.
  onKill(victim, info) {
    if (victim.kind !== 'player') return;
    const a = info.attacker;
    const byOther = a && a !== victim && a.kind === 'player';
    this.hype = Math.min(1, this.hype + (byOther ? (info.headshot ? 0.75 : 0.55) : 0.3));
    this.game.sfx.play('cheer', { volume: byOther ? 0.55 : 0.35, rate: 0.95 + Math.random() * 0.1 });
    if (byOther) {
      this.last = `${a.name} smoked ${victim.name}${info.headshot ? ' (headshot)' : ''}`;
      this.lastColor = a.color;
      this.flashT = 2.5;
    }
  }

  // The match is over: the screen names the winner, and the crowd stays on its feet.
  finale(winners) {
    this.winners = winners ?? [];
    this.hype = 1;
    this.draw();
  }

  update(dt) {
    if (this.winners) this.hype = 1;
    this.uniforms.uTime.value += dt;
    this.hype = Math.max(0.18, this.hype - dt * 0.35);
    this.uniforms.uHype.value = this.hype;
    const v = this.game.match.feedVersion;
    const flashing = this.flashT > 0;
    this.flashT = Math.max(0, this.flashT - dt);
    if (v !== this.version || flashing !== this.flashT > 0) {
      this.version = v;
      this.draw();
    }
  }

  // Leader, their score, the next two, and the last kill while it's fresh.
  draw() {
    const g = this.ctx;
    const W = 512;
    const H = 256;
    const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
    g.fillStyle = '#0d0f13';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#ff7a1a';
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);
    const standings = this.game.match.standings();
    const top = standings[0];
    g.textAlign = 'center';
    if (this.winners) {
      const w = this.winners;
      g.fillStyle = '#ff9a40';
      g.font = 'bold 30px sans-serif';
      g.fillText(w.length > 1 ? "IT'S A TIE!" : 'AND THE WINNER IS', W / 2, 60);
      // Names shrink to fit however many tied.
      const size = w.length > 3 ? 26 : w.length > 2 ? 32 : w.length > 1 ? 46 : 72;
      g.font = `bold ${size}px sans-serif`;
      w.slice(0, 4).forEach((p, i) => {
        g.fillStyle = hex(p.color);
        g.fillText(p.name, W / 2, (w.length > 1 ? 84 + size : 150) + i * (size + 4));
      });
      g.fillStyle = '#f4ead8';
      g.font = 'bold 28px sans-serif';
      g.fillText(`${w[0]?.stats.score ?? 0} pts`, W / 2, 228);
      this.texture.needsUpdate = true;
      return;
    }
    g.fillStyle = '#ff9a40';
    g.font = 'bold 26px sans-serif';
    g.fillText('SMOKE EM’ LIVE', W / 2, 38);
    if (top) {
      g.fillStyle = '#f4ead8';
      g.font = 'bold 22px sans-serif';
      g.fillText(top.place === 1 && standings[1]?.place === 1 ? 'TIED FOR THE LEAD' : 'LEADER', W / 2, 74);
      g.fillStyle = hex(top.player.color);
      g.font = 'bold 58px sans-serif';
      g.fillText(top.player.name, W / 2, 132);
      g.fillStyle = '#f4ead8';
      g.font = 'bold 30px sans-serif';
      g.fillText(`${top.player.stats.score} pts`, W / 2, 168);
      g.font = '22px sans-serif';
      const rest = standings.slice(1, 3).map((s) => `${ordinal(s.place)} ${s.player.name} ${s.player.stats.score}`);
      g.fillStyle = '#b9b0a2';
      g.fillText(rest.join('    '), W / 2, 202);
    }
    if (this.flashT > 0 && this.last) {
      g.fillStyle = '#ff7a1a';
      g.fillRect(12, 216, W - 24, 30);
      g.fillStyle = '#0d0f13';
      g.font = 'bold 20px sans-serif';
      g.fillText(this.last, W / 2, 238);
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.crowd.geometry.dispose();
    this.material.dispose();
    this.screen.geometry.dispose();
    this.screenMaterial.dispose();
    this.texture.dispose();
    this.crowd.removeFromParent();
    this.screen.removeFromParent();
  }
}
