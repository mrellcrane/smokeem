// Every control, shown permanently along the bottom of each player's view.
// Labels per input kind; gamepad labels follow the planned layout in GAME_DESIGN.md.

export const CONTROL_ROWS = {
  keyboardMouse: [
    [
      ['WASD', 'move'],
      ['Mouse', 'look'],
      ['Space', 'jump, again in air'],
      ['Shift', 'sprint'],
      ['C', 'crouch'],
      ['Tab', 'scores'],
      ['Esc', 'pause'],
    ],
    [
      ['Click', 'fire'],
      ['Right click', 'zoom'],
      ['R', 'reload'],
      ['G', 'grenade'],
      ['Q', 'melee'],
      ['E', 'pick up'],
      ['X / wheel', 'swap gun'],
      ['Missile', 'mouse steers, click blows it'],
    ],
  ],
  gamepad: [
    [
      ['LS', 'move'],
      ['RS', 'look'],
      ['A', 'jump, again in air'],
      ['LS click', 'sprint'],
      ['B', 'crouch'],
      ['View', 'scores'],
      ['Menu / D-pad ↓', 'pause'],
    ],
    [
      ['RT', 'fire'],
      ['RS click', 'zoom'],
      ['X', 'reload'],
      ['LT', 'grenade'],
      ['RB', 'melee'],
      ['X hold', 'pick up'],
      ['Y', 'swap gun'],
      ['Missile', 'RS steers, RT blows it'],
    ],
  ],
};

export function controlsHtml(kind) {
  const rows = CONTROL_ROWS[kind] ?? CONTROL_ROWS.keyboardMouse;
  return rows
    .map((row) => `<div class="ctl-row">${row.map(([k, a]) => `<span><kbd>${k}</kbd>${a}</span>`).join('')}</div>`)
    .join('');
}
