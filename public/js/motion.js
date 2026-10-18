// Animation preference: follows the OS "reduce motion" setting unless the
// player picks otherwise with the in-game toggle (remembered per browser).
const KEY = 'bbp-motion';

export function motionReduced() {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v === 'reduced';
  } catch {
    // Storage unavailable (private mode etc.): fall back to the OS setting.
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
