// Player preferences kept in this browser. Motion and sound live in their
// own modules; this covers how the peek camera behaves.
const KEY = 'bbp-settings';

export const ZOOM = {
  level: { min: 1, max: 2.2, step: 0.05, def: 1.45 }, // 1 = no zoom at all
  speed: { min: 80, max: 800, step: 20, def: 300 }, // transition time, ms
};

const DEFAULTS = {
  // Off by default: holding your cards to look at them, and the tell that
  // gives the table, is how the game is meant to be played.
  autoReveal: false,
  // Hand history sidebar, remembered between visits.
  showHistory: false,
  peekZoom: true,
  zoomLevel: ZOOM.level.def,
  zoomSpeed: ZOOM.speed.def,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let cache = null;

export function getSettings() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    // Unreadable or unavailable storage: fall back to the defaults.
  }
  cache = {
    autoReveal: stored.autoReveal === true,
    showHistory: stored.showHistory === true,
    peekZoom: stored.peekZoom !== false,
    zoomLevel: clamp(Number(stored.zoomLevel) || DEFAULTS.zoomLevel, ZOOM.level.min, ZOOM.level.max),
    zoomSpeed: clamp(Number(stored.zoomSpeed) || DEFAULTS.zoomSpeed, ZOOM.speed.min, ZOOM.speed.max),
  };
  return cache;
}

export function setSetting(key, value) {
  const next = { ...getSettings(), [key]: value };
  cache = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    cache = next; // Can't persist, but keep it for this session.
    return cache;
  }
  return getSettings();
}

export function resetSettings() {
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    cache = { ...DEFAULTS };
  }
  return getSettings();
}
