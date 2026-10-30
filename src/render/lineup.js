import * as THREE from 'three';
import { CharacterModel } from '../player/character.js';
import { PLAYER_COLORS } from '../player/player.js';
import { BOT_COLORS } from '../ai/bot.js';
import { CHARACTER_IDS } from '../player/body/cast.js';

// Debug only (smokeem.lineup()): every player and bot color standing in a row facing player 1's
// camera, `distance` meters ahead, for checking that bodies read in a quarter-screen view.
// characters: true lines up every character (cast.js) in each player color instead.
// Returns a function that removes them again.
export function lineup(game, { distance = 10, characters = false, perCharacter = 2 } = {}) {
  const p = game.humans[0];
  const colors = characters
    ? CHARACTER_IDS.flatMap((character) => PLAYER_COLORS.slice(0, perCharacter).map((armor) => ({ armor, character })))
    : [...PLAYER_COLORS.map((armor) => ({ armor })), ...BOT_COLORS];
  const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const spacing = Math.max(1.1, distance * 0.09);
  const models = colors.map((c, i) => {
    const m = new CharacterModel({ armor: c.armor, trim: c.trim ?? null, guns: game.arsenal.guns, character: c.character });
    m.setWeapon(game.arsenal.guns[0]);
    const at = p.center.clone().addScaledVector(fwd, distance).addScaledVector(right, (i - (colors.length - 1) / 2) * spacing);
    m.update(0, { x: at.x, y: p.feetY(), z: at.z, yaw: p.yaw + Math.PI, pitch: 0, speed: 0, grounded: true, crouched: false, climbing: false });
    game.scene.add(m.group);
    return m;
  });
  game.needsRender = true;
  return () => {
    for (const m of models) {
      game.scene.remove(m.group);
      m.dispose();
    }
    game.needsRender = true;
  };
}
