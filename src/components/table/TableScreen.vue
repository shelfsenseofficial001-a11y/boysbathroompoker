<script setup>
// The table, still drawn by src/lib/table-renderer.js.
//
// That module is the waiting room, the felt, the seats, the board, the chip
// tray, the betting dock, the chat, the hand history, the peek camera and
// the toss-to-fold gesture - one closure with the whole game in it. It keeps
// its own DOM because the seat geometry, the chip flights and the drag
// handling are measured against real elements frame by frame.
//
// So this component is a mount point and nothing more: it hands the renderer
// an element, forwards the one thing it reports back - that the player has
// left - and tears it down when the screen goes away. The decomposition into
// SeatRing / BettingDock / CommunityBoard and the rest happens behind this
// boundary, a component at a time, without the lobby or the shell having to
// know about it.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { renderTable } from '../../lib/table-renderer.js';

const props = defineProps({
  user: { type: Object, required: true },
  roomCode: { type: String, required: true },
  notice: { type: String, default: null },
});
const emit = defineEmits(['leave']);

// Deliberately empty in the template: Vue never patches inside it, so the
// renderer's own markup is left alone.
const host = ref(null);
let teardown = null;

onMounted(() => {
  teardown = renderTable(host.value, {
    user: props.user,
    roomCode: props.roomCode,
    notice: props.notice,
    onLeave: (notice, forced) => emit('leave', { notice, forced }),
  });
});

onBeforeUnmount(() => {
  // Detaches the socket listeners, the clock and the document-level gesture
  // handlers. Safe even when the player left through the renderer's own exit,
  // which has already run it.
  teardown?.();
});
</script>

<template>
  <div ref="host" class="contents" />
</template>
