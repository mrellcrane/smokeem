// Every control, shown permanently along the bottom of each player's view.
// Labels per input kind; gamepad labels follow the planned layout in GAME_DESIGN.md.

export const CONTROL_ROWS = {
  keyboardMouse: [
    [
      ['WASD', 'move'],
      ['Mouse', 'look'],
      ['Space', 'jump, again in air or off a wall'],
      ['Shift', 'sprint'],
      ['C', 'crouch, slide from a sprint'],
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
      ['A', 'jump, again in air or off a wall'],
      ['LS click', 'sprint'],
      ['B', 'crouch, slide from a sprint'],
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

// missile: false leaves out the missile hint (for a weapon set without the Smoke Signal).
export function controlsHtml(kind, { missile = true } = {}) {
  const rows = CONTROL_ROWS[kind] ?? CONTROL_ROWS.keyboardMouse;
  return rows
    .map((row) => row.filter(([k]) => missile || k !== 'Missile'))
    .map((row) => `<div class="ctl-row">${row.map(([k, a]) => `<span><kbd>${k}</kbd>${a}</span>`).join('')}</div>`)
    .join('');
}
