import * as THREE from 'three';
import { CharacterModel } from '../player/character.js';

// Debug only (smokeem.poseViewer()): a row of bodies in front of player 1, each run through
// one movement state (walk, strafe, backpedal, sprint, firing, jump, double jump, landing,
// crouch walk), for checking body language. With `time` the bodies are simulated that many
// seconds and stay put (for screenshots); without it they animate live. Returns a function
// that removes them.
const STATES = [
  { name: 'idle' },
  { name: 'walk', fwd: 4.9 },
  { name: 'strafe right', side: 4.9 },
  { name: 'backpedal', fwd: -4.9 },
  { name: 'sprint', fwd: 7.3, sprinting: true },
  { name: 'firing', fwd: 2, fire: 0.11 },
  { name: 'aiming', aiming: true },
  { name: 'jump', air: true, velY: 5 },
  { name: 'double jump', air: true, velY: 5, doubleJump: 0.1 },
  { name: 'landing', land: 0.05 },
  { name: 'crouch walk', fwd: 2.5, crouched: true },
];

// turn: extra yaw for every body (Math.PI / 2 shows them side on).
export function poseViewer(game, { distance = 6, time = null, turn = 0 } = {}) {
  const p = game.humans[0];
  const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const gun = game.arsenal.guns[0];
  const bodies = STATES.map((st, i) => {
    const m = new CharacterModel({ armor: 0x3d7bff, guns: game.arsenal.guns });
    m.setWeapon(gun);
    const at = p.center.clone().addScaledVector(fwd, distance).addScaledVector(right, (i - (STATES.length - 1) / 2) * 1.1);
    game.scene.add(m.group);
    return { m, st, at, t: 0, state: { x: at.x, y: p.feetY(), z: at.z, yaw: p.yaw + Math.PI + turn, pitch: 0, speed: 0, lands: 0, airJumps: 0, shots: 0, fireT: 99 } };
  });
  const step = (dt) => {
    for (const b of bodies) {
      const { st, state: s } = b;
      b.t += dt;
      s.fwd = st.fwd ?? 0;
      s.side = st.side ?? 0;
      s.speed = Math.hypot(s.fwd, s.side);
      s.grounded = !st.air;
      s.velY = st.velY ?? 0;
      s.sprinting = !!st.sprinting;
      s.aiming = !!st.aiming;
      s.crouched = !!st.crouched;
      s.climbing = false;
      s.kick = 1;
      if (st.fire) {
        // A shot every `fire` seconds.
        if (b.t - (b.lastShot ?? -1) >= st.fire) {
          b.lastShot = b.t;
          s.shots++;
        }
        s.fireT = b.t - b.lastShot;
      }
      // Re-trigger the one-off events every second so a live viewer keeps showing them.
      const cyc = b.t % 1;
      if (st.doubleJump !== undefined && cyc < dt) s.airJumps++;
      if (st.land !== undefined && cyc < dt) {
        s.lands++;
        s.landSpeed = 14;
      }
      b.m.update(dt, s);
    }
  };
  let raf = 0;
  if (time !== null) {
    // Simulate up to `time`, with the last second of event cycle lined up to show each pose.
    for (let t = 0; t < time; t += 1 / 60) step(1 / 60);
  } else {
    let last = performance.now();
    const tick = (now) => {
      step(Math.min(0.05, (now - last) / 1000));
      last = now;
      game.needsRender = true;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  game.needsRender = true;
  return () => {
    cancelAnimationFrame(raf);
    for (const b of bodies) {
      game.scene.remove(b.m.group);
      b.m.dispose();
    }
    game.needsRender = true;
  };
}
