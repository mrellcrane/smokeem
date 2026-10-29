import { WEAPONS } from '../combat/weapons.js';
import { gunIcon } from './gunIcons.js';
import { gunDemo } from './gunDemos.js';

// One loadout as a card: its name and both guns, each with its picture (gunIcons.js) and a
// little looping demo of how it works (gunDemos.js).
// note: a line under the guns (a change that waits for the next spawn).
export function loadoutCard(loadout, note = '') {
  const guns = loadout.guns
    .map((id) => {
      const src = gunIcon(id);
      return `<figure>${src ? `<img src="${src}" alt="">` : ''}${gunDemo(id)}<figcaption>${WEAPONS[id].name}</figcaption></figure>`;
    })
    .join('');
  return `<div class="loadout-card"><b>${loadout.name}</b><div class="guns">${guns}</div>${note ? `<em>${note}</em>` : ''}</div>`;
}
