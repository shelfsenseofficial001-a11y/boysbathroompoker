<script setup>
// The icon set is a map of SVG source strings (src/lib/svg/icons.js), which
// is what the table's own drawing code wants. A component so templates can
// ask for one by name instead of carrying v-html about.
import { computed } from 'vue';
import { icons } from '../../lib/svg/icons.js';

const props = defineProps({
  name: { type: String, required: true },
});

const markup = computed(() => icons[props.name] || '');
</script>

<template>
  <!-- The source is our own, from a module in this repo; nothing a player
       types ever reaches here. -->
  <span class="contents" v-html="markup" />
</template>
