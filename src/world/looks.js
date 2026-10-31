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
  // skyline: the facility around the arena (skyline.js).
  sky: { zenith: 0x2a5aa0, mid: 0x86b4dc, horizon: 0xcad7d9, below: 0xa58d78, skyline: true },
  // The sun's lens flare and god rays (render/flare.js, render/bloom.js).
  flare: true,
  godRays: true,
  // The first-person gun and hands have their own lights in their own scene.
  vm: { hemi: 2.4, sun: 2.4 },
  // The color grade (render/grade.js): saturation, contrast, white balance, a blue lift in the shadows,
  // where the highlight shoulder starts, the exposure under open sky and under full cover, and how
  // much brighter the sky and the distance haze are drawn (so the horizon blows out).
  grade: { sat: 0.7, contrast: 1.12, tint: [0.95, 1.0, 1.07], lift: [0.0, 0.008, 0.02], knee: 0.62, open: 1.0, shade: 1.15, sky: 1.7, haze: 1.35 },
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
  grade: { sat: 0.7, contrast: 1.15, tint: [0.93, 1.0, 1.08], lift: [0.0, 0.008, 0.022], knee: 0.62, open: 1.02, shade: 1.15, sky: 1.8, haze: 1.0 },
};

// Smokehouse Creek: a green valley under a high afternoon sun, a big sky, distant mesas, a long
// haze. The two smokehouses' smoke drifts up from each end.
export const VALLEY_LOOK = {
  sun: { dir: [-30, 58, 22], color: 0xffe6c4, intensity: 3.0 },
  hemi: { sky: 0xa8c8ff, ground: 0x6a7448, intensity: 1.5 },
  fog: { near: 110, far: 460 },
  sky: { zenith: 0x2a5ea8, mid: 0x8ab8e0, horizon: 0xcfdcdc, below: 0x7f8a6a },
  flare: true,
  godRays: true,
  vm: { hemi: 2.4, sun: 2.4 },
  grade: { sat: 0.74, contrast: 1.12, tint: [0.96, 1.0, 1.06], lift: [0.0, 0.008, 0.02], knee: 0.62, open: 1.0, shade: 1.15, sky: 1.7, haze: 1.3 },
};


// Cook-Off Yard: a hazy late afternoon, the sun low in the northwest so the towers and the shed
// throw long shadows down the yard; the facility's skyline round it.
export const YARD_LOOK = {
  // Photo textures on the ground, concrete and planks (photos.js), rounded edges on the boxes
  // (materials.js applyBevel), baked occlusion and bounce (applyAo), and a shadow map twice the
  // preset's size. With the occlusion darkening the shade, the sun is harder and the sky's fill
  // lower than the other maps': a punchier, higher-contrast light.
  photo: true,
  bevel: true,
  ao: true,
  shadowScale: 2,
  sun: { dir: [-38, 30, -32], color: 0xffc888, intensity: 4.3 },
  hemi: { sky: 0x86aef0, ground: 0x7a5440, intensity: 0.95 },
  fog: { near: 90, far: 400 },
  sky: { zenith: 0x2c5698, mid: 0x8eb0d4, horizon: 0xd8cfc0, below: 0xa58d78, skyline: true },
  flare: true,
  godRays: true,
  vm: { hemi: 2.4, sun: 2.4 },
  grade: { sat: 0.86, contrast: 1.26, tint: [1.0, 0.99, 1.0], lift: [0.0, 0.006, 0.022], knee: 0.66, open: 1.0, shade: 1.3, sky: 1.6, haze: 1.3 },
};

// The Big Stack: a canyon at golden hour, the sun low in the west raking across the decks, warm
// bounce off the rock, the stack's smoke against a deepening sky. No facility round it.
export const STACK_LOOK = {
  sun: { dir: [-48, 34, 14], color: 0xffc890, intensity: 3.1 },
  hemi: { sky: 0x98b4e4, ground: 0x9a6a4a, intensity: 1.5 },
  fog: { near: 80, far: 380 },
  sky: { zenith: 0x233f7c, mid: 0x7d9cc8, horizon: 0xe6c6a0, below: 0x8f6e58 },
  flare: true,
  godRays: true,
  vm: { hemi: 2.4, sun: 2.4 },
  grade: { sat: 0.76, contrast: 1.12, tint: [1.0, 0.99, 1.0], lift: [0.0, 0.008, 0.02], knee: 0.62, open: 1.0, shade: 1.15, sky: 1.6, haze: 1.3 },
};
