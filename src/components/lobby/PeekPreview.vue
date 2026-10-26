<script setup>
// Live preview of the peek zoom: replays it at the chosen strength and speed,
// so you can see what the settings feel like without starting a hand. The bar
// underneath fills over exactly the zoom-in time, so speed is visible too.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useSettings } from '../../composables/useSettings.js';

const props = defineProps({
  // Animations on a hidden panel are work nobody can see.
  active: { type: Boolean, default: true },
});

const { settings } = useSettings();
const stage = ref(null);
const bar = ref(null);

const HOLD = 650;
const REST = 450;

function stop() {
  [stage.value, bar.value].forEach((el) => el?.getAnimations().forEach((a) => a.cancel()));
}

function play() {
  stop();
  // Face-up cards are never peeked at, so there's no zoom to preview.
  if (!props.active || !settings.peekZoom || settings.autoReveal) return;
  const { zoomLevel, zoomSpeed } = settings;
  const total = zoomSpeed * 2 + HOLD + REST;
  const inAt = zoomSpeed / total;
  const outStart = (zoomSpeed + HOLD) / total;
  const outAt = (zoomSpeed * 2 + HOLD) / total;
  const timing = { duration: total, iterations: Infinity, easing: 'cubic-bezier(.2,.8,.2,1)' };
  stage.value?.animate(
    [
      { transform: 'scale(1)', offset: 0 },
      { transform: `scale(${zoomLevel})`, offset: inAt },
      { transform: `scale(${zoomLevel})`, offset: outStart },
      { transform: 'scale(1)', offset: outAt },
      { transform: 'scale(1)', offset: 1 },
    ],
    timing
  );
  bar.value?.animate(
    [
      { transform: 'scaleX(0)', offset: 0 },
      { transform: 'scaleX(1)', offset: inAt },
      { transform: 'scaleX(1)', offset: outStart },
      { transform: 'scaleX(0)', offset: outAt },
      { transform: 'scaleX(0)', offset: 1 },
    ],
    { ...timing, easing: 'linear' }
  );
}

onMounted(play);
onBeforeUnmount(stop);
watch(
  () => [props.active, settings.peekZoom, settings.autoReveal, settings.zoomLevel, settings.zoomSpeed],
  play
);
</script>

<template>
  <div class="zoom-preview" :hidden="!settings.peekZoom || settings.autoReveal">
    <div class="pv-felt">
      <div ref="stage" class="pv-stage">
        <div class="pv-board"><span /><span /><span /></div>
        <div class="pv-hand"><span /><span /></div>
      </div>
    </div>
    <div class="pv-timing">
      <span class="pv-bar"><i ref="bar" /></span>
      <span class="micro">
        Zooms to {{ settings.zoomLevel.toFixed(2) }}× in {{ settings.zoomSpeed }} ms
      </span>
    </div>
  </div>
</template>
