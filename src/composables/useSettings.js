// The player's own preferences, as something a template can bind to.
//
// src/lib/settings.js stays the one place that knows the defaults, the
// clamping and the storage key; this wraps it in a reactive object so a
// checkbox can be a v-model instead of a change listener that redraws a
// panel. Writes go through setSetting, so they are still persisted and still
// validated on the way in.
import { reactive, watch } from 'vue';
import { getSettings, setSetting, resetSettings, ZOOM } from '../lib/settings.js';

const state = reactive({ ...getSettings() });

// One watcher per key rather than one deep watcher: setSetting takes a single
// key, and a deep watcher could not say which one had moved.
for (const key of Object.keys(state)) {
  watch(
    () => state[key],
    (value) => {
      const saved = setSetting(key, value);
      // settings.js clamps and falls back; if it refused the value, show what
      // it actually stored rather than leaving the control lying.
      if (saved[key] !== value) state[key] = saved[key];
    }
  );
}

export { ZOOM };

export function useSettings() {
  return {
    settings: state,
    // For the few controls that still write through src/lib/settings.js on
    // their own - the theme picker, which is a scrolling grid of swatches
    // rather than a form control - so this object catches up with what they
    // stored. Re-writing the same values is a no-op.
    sync() {
      Object.assign(state, getSettings());
    },
    reset() {
      const defaults = resetSettings();
      Object.assign(state, defaults);
      return defaults;
    },
  };
}
