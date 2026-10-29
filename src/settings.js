// Quality presets and persisted user settings.

export const QUALITY_PRESETS = {
  low: {
    label: 'Low',
    pixelRatioCap: 1.0,
    antialias: false,
    shadowMapSize: 512,
    anisotropy: 1,
  },
  medium: {
    label: 'Medium',
    pixelRatioCap: 1.5,
    antialias: true,
    shadowMapSize: 1024,
    anisotropy: 4,
  },
  high: {
    label: 'High',
    pixelRatioCap: 2.0,
    antialias: true,
    shadowMapSize: 2048,
    anisotropy: 8,
  },
};

const STORAGE_KEY = 'smokeem.settings.v1';

const DEFAULTS = {
  quality: 'medium',
  sensitivity: 1.0,
  invertY: false,
  fov: 95,
  showFps: false,
  volume: 0.7,
  bots: 3,
  botSkill: 'normal',
};

export const SENSITIVITY_RANGE = { min: 0.1, max: 4, step: 0.05 };
export const FOV_RANGE = { min: 70, max: 115, step: 1 };
export const VOLUME_RANGE = { min: 0, max: 1, step: 0.05 };
export const MAX_BOTS = 7;
export const BOT_SKILLS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

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
  if (!Number.isFinite(out.fov)) out.fov = DEFAULTS.fov;
  if (!Number.isFinite(out.volume)) out.volume = DEFAULTS.volume;
  out.bots = Number.isInteger(out.bots) ? Math.max(0, Math.min(MAX_BOTS, out.bots)) : DEFAULTS.bots;
  if (!BOT_SKILLS[out.botSkill]) out.botSkill = DEFAULTS.botSkill;
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
