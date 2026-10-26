<script setup>
// The link outlived the room. Rooms are held in memory for as long as someone
// is in them, so this is the ordinary end of every link rather than a fault,
// and it says so instead of showing a bare error.
import { onMounted, ref } from 'vue';
import { playEntrance } from '../../lib/motion.js';
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import CardSpread from '../ui/CardSpread.vue';

defineProps({
  code: { type: String, required: true },
});
defineEmits(['home']);

const screen = ref(null);
onMounted(() => playEntrance(screen.value));
</script>

<template>
  <div ref="screen" class="gone-screen">
    <main class="page gone-page">
      <!-- The same figures the 404 page deals, so a dead link and a dead room
           are plainly the same game talking. -->
      <CardSpread text="404" />
      <div class="say" data-enter>
        <span class="eyebrow">Room not found</span>
        <h1 class="display">That table has packed up.</h1>
        <p class="lead">
          There's no room with the code <b class="gone-code">{{ code }}</b> any more. A room lasts
          only as long as someone is sitting at it: once the host leaves and the last player walks
          away, it closes and its code is gone for good. The same happens if the server restarts.
        </p>
        <p class="help-text">Ask whoever sent you for a fresh link, or host a table yourself.</p>
        <BaseButton variant="primary" size="lg" class="gone-home" @click="$emit('home')">
          <SvgIcon name="arrowLeft" />Back to the lobby
        </BaseButton>
      </div>
    </main>
  </div>
</template>
