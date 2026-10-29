// Graphics feature switches, all on by default. ?bench&off=name,name turns some off for a
// before/after comparison on the same machine (and ?debug exposes them as smokeem.gfx).
// Most take effect at the next match load. Each graphics change adds its switch here.
export const gfx = {
  // Draw the sky dome after the arena, so the arena's depth hides most of its pixels.
  skyLast: true,
  // Baked floor light: contact shadows, tone variation and glow pools (world/bake.js).
  bake: true,
  // Per-vertex light on static geometry: darker toward the floor and into corners.
  vertexLight: true,
};
