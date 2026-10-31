// Animation preference: the player's own, remembered per browser, and on
// until they say otherwise.
//
// The OS "reduce motion" setting is deliberately not consulted. Windows turns
// it on for reasons that have nothing to do with this game - a laptop on
// battery, a box that once ticked "performance" - and reading it meant the
// table arrived flat, with the switch already off and no hint as to why. The
// switch below is how somebody asks for less, and it is the only way in: see
// styles.css, where the same decision is made for the CSS.
const KEY = 'bbp-motion';

export function motionReduced() {
  try {
    return localStorage.getItem(KEY) === 'reduced';
  } catch {
    // Storage unavailable (private mode etc.): the default, held for this page.
    return false;
  }
}

export function applyMotionClass() {
  document.documentElement.classList.toggle('reduce-motion', motionReduced());
}

export function toggleMotion() {
  try {
    localStorage.setItem(KEY, motionReduced() ? 'full' : 'reduced');
  } catch {
    // Not persisted; still apply for this page.
  }
  applyMotionClass();
}

// --- Lite tier -------------------------------------------------------------
// A weak device still gets the motion, just cheaper: shorter, opacity-only,
// and without backdrop blur, which is what actually drops frames on a budget
// GPU. Decided from hardware hints first, then confirmed by watching real
// frames, since the hints are missing on most browsers and wrong on some.
const LITE_KEY = 'bbp-lite';

function hintsSayLite() {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8; // Chromium only; GB, rounded
  const saveData = !!navigator.connection?.saveData;
  return saveData || cores <= 2 || memory <= 2;
}

function setLite(on) {
  document.documentElement.classList.toggle('lite', on);
  try {
    sessionStorage.setItem(LITE_KEY, on ? '1' : '0');
  } catch {
    // Unpersisted: decided afresh on the next page load.
  }
}

// Times ~40 frames once the page has settled. A median well past a 60Hz
// frame means the device is struggling with what's already on screen, so
// anything more ambitious would only make it worse.
function probeFrames() {
  const gaps = [];
  let last = 0;
  const step = (now) => {
    if (last) gaps.push(now - last);
    last = now;
    if (gaps.length < 40) return requestAnimationFrame(step);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median > 24) setLite(true); // slower than ~42fps
  };
  requestAnimationFrame(step);
}

export function applyLiteClass() {
  let known = null;
  try {
    known = sessionStorage.getItem(LITE_KEY);
  } catch {
    // Fall through to detection.
  }
  if (known != null) return setLite(known === '1');
  setLite(hintsSayLite());
  // Once the first screen has painted, so the probe measures the app rather
  // than the browser starting up.
  setTimeout(probeFrames, 1200);
}

// --- Entrances -------------------------------------------------------------
// Plays a screen's arrival once and then steps aside. Screens here redraw
// their markup on every update, so an entrance left switched on would replay
// every few seconds - which reads as the page glitching, not as polish.
// `[data-enter]` blocks inside rise in turn; their order is the stagger.
export const ENTRANCE_MS = 1100;

export function playEntrance(el) {
  resumeEntrance(el, performance.now());
}

// The same entrance, picked up partway. A screen rebuilt mid-entrance would
// otherwise either snap its blocks to the end or start them all again; this
// hands the new markup how far along it was, as a negative delay, so it
// carries on from the same point as if nothing had been rebuilt.
export function resumeEntrance(el, startedAt) {
  if (!el || document.documentElement.classList.contains('reduce-motion')) return;
  const elapsed = performance.now() - startedAt;
  if (elapsed >= ENTRANCE_MS) return;
  el.querySelectorAll('[data-enter]').forEach((node, i) => node.style.setProperty('--i', String(i)));
  el.style.setProperty('--enter-elapsed', `${Math.round(elapsed)}ms`);
  el.classList.add('is-entering');
  setTimeout(() => el.classList.remove('is-entering'), ENTRANCE_MS - elapsed);
}
