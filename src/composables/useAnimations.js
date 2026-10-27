// The landing page's "Animations" switch, shared by everything on it that
// moves: the demo table in the hero and the micro-loop on every feature card.
//
// One switch rather than one per drawing, because "this page is too busy" is
// a single opinion about the page, not nine opinions about nine pictures.
//
// It is not the game's own motion setting (lib/motion.js), though it defers to
// it: somebody who has turned animations off for the table, or whose system
// asks for reduced motion, should not be met by a page that loops at them
// anyway. This switch can only turn motion off on top of that, never back on.
import { ref, computed } from 'vue';
import { motionReduced } from '../lib/motion.js';

const KEY = 'bbp-landing-anim';

function read() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    // Storage blocked: default on, held for this page only.
    return true;
  }
}

const enabled = ref(read());

export function useAnimations() {
  return {
    // What the switch says.
    enabled,
    // Whether anything should actually move: the switch, AND the game's own
    // motion preference, AND the operating system's.
    playing: computed(() => enabled.value && !motionReduced()),
    toggle() {
      enabled.value = !enabled.value;
      try {
        localStorage.setItem(KEY, enabled.value ? 'on' : 'off');
      } catch {
        // Not persisted; still applies until the page goes.
      }
    },
  };
}
