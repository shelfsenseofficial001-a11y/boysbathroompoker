<script setup>
// The felt, the card backs and the deck, as grids of swatches.
//
// Each swatch is a rendered SVG of the real thing, the grids scroll with
// their own arrows, and picking one moves a ring rather than redrawing
// twenty swatches. That is all in src/lib/themepicker.js, which writes the
// setting itself; this component gives it an element and tells the settings
// store to catch up afterwards.
import { ref, onMounted, nextTick, watch } from 'vue';
import { themePickerHTML, wireThemePicker, syncThemeArrows } from '../../lib/themepicker.js';
import { useSettings } from '../../composables/useSettings.js';

const props = defineProps({
  // Whether the panel holding this is on screen. The grids have no height
  // while hidden, so whether they overflow can only be measured once shown.
  active: { type: Boolean, default: true },
});

const { settings, sync } = useSettings();
const host = ref(null);
const markup = themePickerHTML(settings);

onMounted(() => {
  wireThemePicker(host.value, () => sync());
  if (props.active) syncThemeArrows(host.value);
});

watch(
  () => props.active,
  async (on) => {
    if (!on) return;
    await nextTick();
    syncThemeArrows(host.value);
  }
);
</script>

<template>
  <div ref="host" class="set-dress" v-html="markup" />
</template>
