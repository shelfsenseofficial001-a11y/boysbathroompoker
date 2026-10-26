<script setup>
// The fan of cards that spells something out - "404" on a wrong turn, and on
// the screen that tells you a room has closed. The dealing and the
// follow-the-pointer tilt are a physics-ish animation over absolutely
// positioned nodes, so they stay in src/lib/svg/spread.js and this component
// hands them an element to work in.
import { ref, onMounted } from 'vue';
import { dealFigures, followPointer } from '../../lib/svg/spread.js';

const props = defineProps({
  text: { type: String, required: true },
});

const host = ref(null);

onMounted(() => {
  // Dealt after the markup lands, so the cards fly in rather than appearing
  // with the page.
  dealFigures(host.value, props.text);
  followPointer(host.value);
});
</script>

<template>
  <div ref="host" class="spread" role="img" :aria-label="text" />
</template>
