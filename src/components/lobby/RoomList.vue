<script setup>
// Every public game running right now. The list refreshes itself, so somebody
// waiting for a friend to host doesn't have to keep reloading the page to see
// it appear.
//
// A card each rather than a row each. A table is a handful of figures - the
// stakes, the stack, how full it is, how far along - and in a table of seven
// columns the one thing a reader is actually choosing between, the code and
// whether there is a seat, was the narrowest thing on the screen.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { emitAck, getSocket } from '../../lib/socket.js';
import { fmt } from '../../lib/format.js';
import BaseButton from '../ui/BaseButton.vue';
import SvgIcon from '../ui/SvgIcon.vue';

const emit = defineEmits(['join', 'watch', 'fail', 'host']);

const rooms = ref([]);
// Nine to a page: three rows of three on a wide screen, and few enough to
// scan without the page turning into something to scroll past.
const PER_PAGE = 9;
const page = ref(0);
const loading = ref(true);

// What a reader is usually after: a seat, or a game to watch. Each one is
// read off the list the server already sends - nothing here asks it for
// anything it was not going to say anyway.
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Seats free', test: (r) => !r.full },
  { id: 'live', label: 'In play', test: (r) => r.inPlay },
  { id: 'waiting', label: 'Waiting', test: (r) => !r.inPlay },
];
const filter = ref('all');

// The codes the list already showed, so a table that has just opened can be
// told apart from one that was there all along and arrive with a transition.
// Null until the first list comes back: on that first fill every table is
// new, and animating all of them is the screen's own entrance, not news.
const knownCodes = ref(null);

const filtered = computed(() => {
  const chosen = FILTERS.find((f) => f.id === filter.value);
  return chosen?.test ? rooms.value.filter(chosen.test) : rooms.value;
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER_PAGE)));
const shown = computed(() =>
  filtered.value.slice(page.value * PER_PAGE, page.value * PER_PAGE + PER_PAGE)
);
const pageLabel = computed(
  () =>
    `Page ${page.value + 1} of ${pages.value} · ${filtered.value.length} ${
      filtered.value.length === 1 ? 'table' : 'tables'
    }`
);
const isFresh = (code) => knownCodes.value !== null && !knownCodes.value.has(code);

// How full a table is, drawn as its seats. A count says four of nine; the
// seats say which kind of table that is at a glance - nearly empty, nearly
// full - without the reader doing the division.
const seats = (room) =>
  Array.from({ length: room.seats }, (_, i) => (i < room.players ? 'taken' : 'free'));

// What is happening at it, in the fewest words that are still true.
function statusOf(room) {
  if (room.full) return { text: 'Full', kind: 'full' };
  if (room.inPlay) return { text: `Hand ${room.hand}`, kind: 'live' };
  return { text: 'Waiting to start', kind: 'waiting' };
}

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

// A filter that empties the page under you would otherwise leave a reader
// looking at nothing on page three of one.
function pick(id) {
  filter.value = id;
  page.value = 0;
}

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
  <section class="rooms-section" data-enter>
    <header class="rooms-head">
      <div class="rooms-head-text">
        <h2 class="h2">Open tables</h2>
        <p class="help-text">
          Every public game running right now — the stakes, the stack you'd sit down with, and how
          far along they are.
        </p>
      </div>
      <div class="rooms-filter" role="group" aria-label="Filter tables">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          type="button"
          class="rooms-filter-btn"
          :class="{ 'is-on': filter === f.id }"
          :aria-pressed="String(filter === f.id)"
          @click="pick(f.id)"
        >
          {{ f.label }}
        </button>
      </div>
    </header>

    <p v-if="loading" class="rooms-note">Looking for tables…</p>
    <p v-else-if="!rooms.length" class="rooms-note">
      No open tables right now. Host one and send the code to whoever you want at it.
    </p>
    <p v-else-if="!filtered.length" class="rooms-note">Nothing matches that filter just now.</p>

    <div class="rooms-cards">
      <article
        v-for="room in shown"
        :key="room.code"
        class="room-card"
        :class="{ 'is-new': isFresh(room.code) }"
      >
        <div class="room-card-top">
          <h3 class="room-card-code">
            <span class="room-dot" :class="`is-${statusOf(room).kind}`" aria-hidden="true"></span>
            <span class="code">{{ room.code }}</span>
          </h3>
          <span class="room-card-status" :class="`is-${statusOf(room).kind}`">
            {{ statusOf(room).text }}
          </span>
        </div>

        <p class="room-card-host">Hosted by {{ room.host }}</p>

        <dl class="room-card-figures">
          <div>
            <dt>Blinds</dt>
            <dd>{{ fmt(room.smallBlind) }}<span class="of">/</span>{{ fmt(room.bigBlind) }}</dd>
          </div>
          <div>
            <dt>Sit-in chips</dt>
            <dd><span v-if="room.full" class="of">—</span><template v-else>{{ fmt(room.chips) }}</template></dd>
          </div>
        </dl>

        <div class="room-card-seats">
          <span class="seat-pips" aria-hidden="true">
            <i v-for="(seat, i) in seats(room)" :key="i" :class="`is-${seat}`"></i>
          </span>
          <span class="room-card-count">
            {{ room.players }} of {{ room.seats }}<template v-if="room.bots"> · {{ room.bots }} bot<template v-if="room.bots > 1">s</template></template>
          </span>
          <span v-if="room.allowSpectators && room.watching" class="room-card-watchers">
            <SvgIcon name="eye" />{{ room.watching }}
          </span>
        </div>

        <div class="room-card-acts">
          <BaseButton
            v-if="!room.full"
            variant="primary"
            size="sm"
            @click="emit('join', room.code), refresh()"
          >
            Take a seat
          </BaseButton>
          <BaseButton
            v-if="room.inPlay && room.allowSpectators"
            variant="ghost"
            size="sm"
            @click="emit('watch', room.code), refresh()"
          >
            Watch
          </BaseButton>
          <span v-if="room.full && !room.allowSpectators" class="room-card-shut">No room, no watching</span>
        </div>
      </article>

      <!-- The way out of an empty list, and of a list with nothing on it you
           fancy: it sits with the tables rather than under them. -->
      <button v-if="!loading" type="button" class="room-card is-host" @click="emit('host')">
        <span class="room-host-title">Host your own</span>
        <span class="room-host-text">
          Set the blinds and the stack, then send the code to whoever you want at it.
        </span>
        <span class="room-host-cta"><SvgIcon name="plus" />Host a table</span>
      </button>
    </div>

    <div class="rooms-pager" :hidden="filtered.length <= PER_PAGE">
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
