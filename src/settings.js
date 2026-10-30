// Quality presets and persisted user settings.

export const QUALITY_PRESETS = {
  low: {
    label: 'Low',
    pixelRatioCap: 1.0,
    antialias: false,
    shadowMapSize: 512,
    anisotropy: 1,
    // Texels per side of the baked arena light (bake.js).
    bakeSize: 256,
    // Texels per side of the main surface textures (textures.js).
    textureSize: 256,
    // Soft halos around glowing strips (beacons.js).
    halos: false,
    // Multiplies smoke and ember counts (effects.js), and how many bullet marks and scorches
    // can lie around at once (0: none).
    fxScale: 0.5,
    decals: 0,
    // Portal pictures of the other side: one refreshed every this many frames (0: none, just
    // the swirl).
    portalViews: 0,
    // Sunbeams and dust under indoor skylights (world/shafts.js).
    shafts: false,
    // The sun's lens flare (render/flare.js).
    flare: false,
    // Grass tufts on Smokehouse Creek (world/foliage.js): how many (0: none).
    foliage: 0,
  },
  medium: {
    label: 'Medium',
    pixelRatioCap: 1.5,
    antialias: true,
    shadowMapSize: 1024,
    anisotropy: 4,
    bakeSize: 512,
    textureSize: 512,
    halos: true,
    fxScale: 1,
    decals: 96,
    portalViews: 6,
    shafts: true,
    flare: true,
    foliage: 2200,
  },
  high: {
    label: 'High',
    pixelRatioCap: 2.0,
    antialias: true,
    shadowMapSize: 2048,
    anisotropy: 8,
    bakeSize: 512,
    textureSize: 512,
    halos: true,
    fxScale: 1.25,
    decals: 160,
    portalViews: 3,
    shafts: true,
    flare: true,
    foliage: 3600,
    // Bloom: bright things glow (render/bloom.js).
    bloom: true,
    // Normal maps on the relief-painted surfaces (textures.js).
    normalMaps: true,
  },
};

const STORAGE_KEY = 'smokeem.settings.v1';

const DEFAULTS = {
  quality: 'medium',
  sensitivity: 1.0,
  // Controller look speed multiplier (right stick).
  stickSensitivity: 1.0,
  rumble: true,
  // The view bobs with each footstep.
  headBob: true,
  invertY: false,
  // Horizontal, Halo's (Player.setFov).
  fov: 78,
  showFps: false,
  volume: 0.7,
  bots: 3,
  botSkill: 'normal',
  // Match length in minutes; 0 means no limit.
  timeLimit: 5,
  // Weapon set: 'default' (the map's), a set id, or 'mystery' (random).
  weaponSet: 'default',
  // Match mode: free-for-all, or Rocky Mountain Oysters on top of it.
  mode: 'ffa',
  // Map: a map id (world/maps.js), or 'random'.
  map: 'mudlark',
  // Multiplier on horizontal movement and climbing speed for everyone (players and bots).
  moveSpeed: 0.7,
};

export const SENSITIVITY_RANGE = { min: 0.1, max: 4, step: 0.05 };
export const STICK_SENSITIVITY_RANGE = { min: 0.3, max: 2.5, step: 0.05 };
export const FOV_RANGE = { min: 70, max: 115, step: 1 };
export const VOLUME_RANGE = { min: 0, max: 1, step: 0.05 };
export const MAX_BOTS = 7;
export const MOVE_SPEED_RANGE = { min: 0.4, max: 1.3, step: 0.05 };
export const BOT_SKILLS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
export const TIME_LIMITS = { 3: '3 min', 5: '5 min', 10: '10 min', 0: 'No limit' };
export const MODES = { ffa: 'Free-for-all', oysters: 'Rocky Mountain Oysters' };
// The title screen's map choices (world/maps.js has the maps).
export const MAP_CHOICES = { mudlark: 'Mudlark', factory: 'Smokestack', valley: 'Creek', yard: 'Cook-Off', random: 'Random' };

function load() {
  const out = { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(out, JSON.parse(raw));
  } catch {
    // Private browsing or blocked storage: fall back to defaults.
  }
  if (!QUALITY_PRESETS[out.quality]) out.quality = DEFAULTS.quality;
  if (!Number.isFinite(out.sensitivity)) out.sensitivity = DEFAULTS.sensitivity;
  if (!Number.isFinite(out.stickSensitivity)) out.stickSensitivity = DEFAULTS.stickSensitivity;
  if (!Number.isFinite(out.fov)) out.fov = DEFAULTS.fov;
  // Saved settings from before the field of view's default went from 95 to 78 (rev 2): anyone
  // who never moved it gets the new default.
  if (!(out.rev >= 2)) {
    if (out.fov === 95) out.fov = DEFAULTS.fov;
    out.rev = 2;
  }
  if (typeof out.headBob !== 'boolean') out.headBob = DEFAULTS.headBob;
  if (!Number.isFinite(out.volume)) out.volume = DEFAULTS.volume;
  out.bots = Number.isInteger(out.bots) ? Math.max(0, Math.min(MAX_BOTS, out.bots)) : DEFAULTS.bots;
  if (!BOT_SKILLS[out.botSkill]) out.botSkill = DEFAULTS.botSkill;
  if (!(String(out.timeLimit) in TIME_LIMITS)) out.timeLimit = DEFAULTS.timeLimit;
  if (typeof out.weaponSet !== 'string') out.weaponSet = DEFAULTS.weaponSet;
  if (!MODES[out.mode]) out.mode = DEFAULTS.mode;
  if (!MAP_CHOICES[out.map]) out.map = DEFAULTS.map;
  if (!Number.isFinite(out.moveSpeed)) out.moveSpeed = DEFAULTS.moveSpeed;
  out.moveSpeed = Math.max(MOVE_SPEED_RANGE.min, Math.min(MOVE_SPEED_RANGE.max, out.moveSpeed));
  return out;
}

export const settings = load();

const listeners = new Set();

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function updateSettings(patch) {
  Object.assign(settings, patch);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures; the setting still applies for this session.
  }
  for (const fn of listeners) fn(settings, patch);
}

export function qualityPreset() {
  return QUALITY_PRESETS[settings.quality];
}
