// Obstacle-course moves for Mudlark Gauntlet that the auto-sampled nav grid can't discover.
// Points are approximate; each snaps to the nearest nav node.
//   over  run at a wall and get over it (jumps: 0 = vault, 1 = jump, 2 = double jump)
//   net   climb a cargo net to the top
//   rope  climb a rope up to the catwalk
//   bars  cross the monkey bars

const WALLS = [
  { z: -8, jumps: 0 },
  { z: -1, jumps: 1 },
  { z: 6, jumps: 2 },
];

export const MUDLARK_LINKS = [
  ...WALLS.flatMap((w) =>
    [-25, -21].map((x) => ({
      type: 'over',
      a: [x, 0, w.z - 1.6],
      b: [x, 0, w.z + 1.6],
      mid: [x, 0, w.z],
      jumps: w.jumps,
      twoWay: true,
    })),
  ),
  { type: 'net', a: [0, 0, -9], b: [0, 6, -3] },
  { type: 'net', a: [0, 0, 9], b: [0, 6, 3] },
  { type: 'net', a: [21, 0, -19], b: [21, 5, -23.5] },
  // `mid` is where the rope hangs, so bots walk right into it.
  ...[-7, 0, 7].map((x) => ({ type: 'rope', a: [x, 0, 23], b: [x, 5.5, 27.5], mid: [x, 0, 25.6] })),
  // `mid` gives the bars' centerline so bots line up under them.
  { type: 'bars', a: [9, 2.4, 0], b: [23, 2.4, 0], mid: [16, 2.4, 0], twoWay: true },
];

// Smokestack Works: the ladders at the catwalks' far ends (climbed like ropes) and the hook rail
// over the grease vat. Stairs, bridges and belts are plain walking.
export const FACTORY_LINKS = [
  { type: 'rope', a: [28, 0, -16.6], b: [28, 5, -20.2], mid: [28, 0, -18.1] },
  { type: 'rope', a: [-28, 0, 16.6], b: [-28, 5, 20.2], mid: [-28, 0, 18.1] },
  { type: 'bars', a: [14, 2.4, 0], b: [28, 2.4, 0], mid: [21, 2.4, 0], twoWay: true },
];
