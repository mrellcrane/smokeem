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
  // Muzzle flashes on other players' third-person guns.
  thirdPersonFlashes: true,
  // Light columns and respawn rings on the pickup pads (world/beacons.js).
  beacons: true,
  // Soft halos around the glowing strips (medium and high presets only).
  halos: true,
  // Bullet marks and blast scorches (medium and high presets only).
  decals: true,
  // The game-show stands: crowd and big screen (world/show.js).
  show: true,
  // A low-frame-rate picture of the other side in each portal (combat/portals.js; preset's
  // portalViews, off on low).
  portalViews: true,
  // Normal maps on walls and floors (high preset only).
  normalMaps: true,
  // The facility skyline around outdoor maps, with its smoke plumes (world/skyline.js).
  skyline: true,
  // Sunbeams and dust under the factory's skylights (medium and high presets only).
  shafts: true,
  // Armor, visors and guns reflect the arena (a cube map captured at load, render/reflections.js).
  reflections: true,
  // Bloom (high preset only).
  bloom: true,
  // The color grade and adapting exposure (render/grade.js).
  grade: true,
  // World-space grime over the level's surfaces (world/materials.js).
  grime: true,
  // Photo textures on maps whose look asks for them (world/photos.js).
  photoTextures: true,
  // Rounded edges on level boxes, on maps whose look asks for them (world/materials.js).
  bevels: true,
  // Baked ambient occlusion and bounce light on level geometry, on maps whose look asks
  // (world/staticBuilder.js occlusion, materials.js applyAo).
  bakedAo: true,
  // The sun's lens flare (medium and high presets, outdoor maps; render/flare.js).
  flare: true,
  // God rays from the sun through gaps (high preset, outdoor maps; render/bloom.js).
  godRays: true,
  // Smokehouse Creek's ground blends grass, dirt and rock (world/valley.js).
  terrainBlend: true,
  // Grass tufts on Smokehouse Creek (medium and high presets; world/foliage.js).
  foliage: true,
  // Dynamic resolution: the render scale drops when frames run long (render/dynres.js).
  dynamicResolution: true,
};
