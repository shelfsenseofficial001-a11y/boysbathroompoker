// Player preferences kept in this browser. Motion and sound live in their
// own modules; this covers how the peek camera behaves and how the table is
// dressed. The cloth and the card backs are each player's own: two people at
// one table can sit at different-looking felts without disagreeing about the
// game, since nothing here is sent to the server.
import { FELTS, BACKS, DECKS } from './svg/themes.js';

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
  // Table chat sidebar, also remembered between visits.
  showChat: false,
  // Every hand's winner, announced in the chat. On by default: it's the only
  // place to catch up on a hand you looked away from.
  showResults: true,
  peekZoom: true,
  zoomLevel: ZOOM.level.def,
  zoomSpeed: ZOOM.speed.def,
  // The three gestures the table is played with, shown as a game starts.
  // Turned off from the tutorial itself, by the player who already knows
  // them; kept on by default, since nothing on the table says the cards and
  // chips can be dragged.
  showTutorial: true,
  // Set once the "hold to peek" hint has been read, so it's never shown
  // again on this browser.
  peekHintSeen: false,
  // How the table is dressed. See svg/themes.js for what's on offer.
  felt: 'green',
  cardBack: 'classic',
  // Two colours, the way a deck on a table is printed. Four is there for
  // anyone who reads a suit faster off its colour.
  deck: 'two',
};

// An id saved by an older build - or edited by hand - must not leave the
// table with no cloth on it.
const oneOf = (list, v, fallback) => (list.some((x) => x.id === v) ? v : fallback);

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
    showChat: stored.showChat === true,
    showResults: stored.showResults !== false,
    peekZoom: stored.peekZoom !== false,
    zoomLevel: clamp(Number(stored.zoomLevel) || DEFAULTS.zoomLevel, ZOOM.level.min, ZOOM.level.max),
    zoomSpeed: clamp(Number(stored.zoomSpeed) || DEFAULTS.zoomSpeed, ZOOM.speed.min, ZOOM.speed.max),
    showTutorial: stored.showTutorial !== false,
    peekHintSeen: stored.peekHintSeen === true,
    felt: oneOf(FELTS, stored.felt, DEFAULTS.felt),
    cardBack: oneOf(BACKS, stored.cardBack, DEFAULTS.cardBack),
    deck: oneOf(DECKS, stored.deck, DEFAULTS.deck),
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
