// Per-map lighting and atmosphere. game.js (lights, fog, the viewmodel's lights) and sky.js
// read a map's look, so a new map can pick its own mood without code changes.
// Colors are sRGB hex. Sunlight is warm and the sky fill cool, so the lit and shaded sides of
// every box separate; the fill is strong enough that shade is never darker than it used to be.
export const MUDLARK_LOOK = {
  // dir: where the sun sits, as a point the light shines from toward the arena's middle.
  sun: { dir: [38, 60, 26], color: 0xffe2b8, intensity: 3.0 },
  hemi: { sky: 0xa8c8ff, ground: 0x8a6040, intensity: 1.55 },
  fog: { near: 90, far: 420 },
  // The fog color is the horizon color, so far walls fade into the sky.
  sky: { zenith: 0x2a5aa0, mid: 0x86b4dc, horizon: 0xcad7d9, below: 0xa58d78 },
  // The first-person gun and hands have their own lights in their own scene.
  vm: { hemi: 2.4, sun: 2.4 },
};

// Smokestack Works: indoors. The sun comes steeply through the skylights in bright bands; the
// rest is warm bounce light off the floor and walls, a smoky haze, and the lamps' pools baked
// into the floor. No mesas (the walls hide the outside anyway).
export const FACTORY_LOOK = {
  sun: { dir: [16, 70, 24], color: 0xffe6c0, intensity: 3.2 },
  hemi: { sky: 0xd6c6ae, ground: 0x7a5e48, intensity: 1.9 },
  fog: { near: 30, far: 150 },
  sky: { zenith: 0x3a68a8, mid: 0x8fb2d2, horizon: 0x9c9284, below: 0x6e6256, mesas: false },
  vm: { hemi: 2.5, sun: 2.0 },
};
