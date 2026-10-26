<script setup>
// Every public game running right now. The list refreshes itself, so somebody
// waiting for a friend to host doesn't have to keep reloading the page to see
// it appear.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { emitAck, getSocket } from '../../lib/socket.js';
import { fmt } from '../../lib/format.js';
import BaseButton from '../ui/BaseButton.vue';

const emit = defineEmits(['join', 'watch', 'fail']);

const rooms = ref([]);
// Ten to a page: enough to scan without the lobby turning into a list that
// has to be scrolled past to reach the settings below it.
const PER_PAGE = 10;
const page = ref(0);
const loading = ref(true);

// The codes the list already showed, so a table that has just opened can be
// told apart from one that was there all along and arrive with a transition.
// Null until the first list comes back: on that first fill every table is
// new, and animating all of them is the screen's own entrance, not news.
const knownCodes = ref(null);

const pages = computed(() => Math.max(1, Math.ceil(rooms.value.length / PER_PAGE)));
const shown = computed(() => rooms.value.slice(page.value * PER_PAGE, page.value * PER_PAGE + PER_PAGE));
const pageLabel = computed(
  () =>
    `Page ${page.value + 1} of ${pages.value} · ${rooms.value.length} ${rooms.value.length === 1 ? 'table' : 'tables'}`
);
const isFresh = (code) => knownCodes.value !== null && !knownCodes.value.has(code);

async function refresh() {
  try {
    const { rooms: list } = await emitAck('listRooms');
    rooms.value = list;
    // Tables close while you're looking at them, so the page you were on may
    // no longer exist; fall back to the last one that does.
    page.value = Math.min(page.value, pages.value - 1);
    // Every code now on the list counts as seen, including the ones on pages
    // that aren't showing - turning to page two isn't news either.
    knownCodes.value = new Set(list.map((r) => r.code));
  } catch {
    // A failed poll is not worth saying anything about; the next one is in
    // four seconds.
  } finally {
    loading.value = false;
  }
}

const turnPage = (by) => {
  page.value = Math.max(0, Math.min(pages.value - 1, page.value + by));
};

const socket = getSocket();
let timer = null;

onMounted(() => {
  refresh();
  // The server says when the list has actually changed, so a room going
  // private (or filling up, or closing) drops off straight away. The timer
  // stays as a backstop in case an event is missed.
  socket.on('roomsChanged', refresh);
  timer = setInterval(refresh, 4000);
});
onBeforeUnmount(() => {
  socket.off('roomsChanged', refresh);
  clearInterval(timer);
});
</script>

<template>
  <section class="panel mt-5" data-enter>
    <h2 class="h2">Open tables</h2>
    <p class="help-text">
      Every public game running right now — the stakes, the stack you'd sit down with, and how far
      along they are.
    </p>
    <div class="rooms-wrap">
      <table class="rooms">
        <thead>
          <tr>
            <th scope="col">Room</th>
            <th scope="col" class="num">Players</th>
            <th scope="col" class="num">Blinds</th>
            <th scope="col" class="num">Sit-in chips</th>
            <th scope="col">Hand</th>
            <th scope="col" class="num">Watching</th>
            <th scope="col" aria-label="Join or watch" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading" class="rooms-empty"><td colspan="7">Looking for tables…</td></tr>
          <tr v-else-if="!rooms.length" class="rooms-empty">
            <td colspan="7">No open tables right now — host one!</td>
          </tr>
          <tr v-for="room in shown" v-else :key="room.code" :class="{ 'is-new': isFresh(room.code) }">
            <td>
              <span class="code">{{ room.code }}</span>
              <span v-if="room.full" class="room-full">Full</span>
              <span class="sub">{{ room.host }}</span>
            </td>
            <!-- data-label is what the stacked phone layout prints in front
                 of each figure, once the columns are gone and the headings
                 with them. -->
            <td class="num" data-label="Players">
              <b>{{ room.players }}</b><span class="of">/{{ room.seats }}</span>
            </td>
            <td class="num" data-label="Blinds">
              {{ fmt(room.smallBlind) }}<span class="of">/</span>{{ fmt(room.bigBlind) }}
            </td>
            <td class="num" data-label="Sit-in chips">
              <span v-if="room.full" class="of">—</span>
              <template v-else>{{ fmt(room.chips) }}</template>
            </td>
            <td data-label="Hand">
              <span v-if="room.inPlay" class="room-live">Hand #{{ room.hand }}</span>
              <span v-else class="of">Waiting to start</span>
            </td>
            <td class="num" data-label="Watching">
              <b v-if="room.allowSpectators">{{ room.watching }}</b>
              <span v-else class="of">Not allowed</span>
            </td>
            <td class="room-acts">
              <BaseButton
                v-if="room.inPlay && room.allowSpectators"
                variant="ghost"
                size="sm"
                @click="emit('watch', room.code), refresh()"
              >
                Spectate
              </BaseButton>
              <BaseButton
                v-if="!room.full"
                variant="ghost"
                size="sm"
                @click="emit('join', room.code), refresh()"
              >
                Join
              </BaseButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="rooms-pager" :hidden="rooms.length <= PER_PAGE">
      <BaseButton variant="ghost" size="sm" :disabled="page === 0" @click="turnPage(-1)">
        Previous
      </BaseButton>
      <span class="micro">{{ pageLabel }}</span>
      <BaseButton variant="ghost" size="sm" :disabled="page >= pages - 1" @click="turnPage(1)">
        Next
      </BaseButton>
    </div>
  </section>
</template>
