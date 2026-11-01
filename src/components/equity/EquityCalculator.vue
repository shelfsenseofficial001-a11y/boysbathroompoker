<script setup>
// The equity calculator: put cards in hands and on the board, and read off
// each hand's chance of winning from here.
//
// A tool page, standing on its own. No room, no socket, no account - the
// state is the cards on this screen and nothing else. It borrows the game's
// art read-only (the felt, the card faces) the way the landing page's demo
// table does, and the odds come from shared/equity.mjs, the same maths the
// live table uses while an all-in is run out, so the two always agree.
//
// Cards go in two ways, because native drag and drop is unreliable on touch:
//   - drag a card from the deck onto a slot, or a placed card to another
//     slot or back off the table (pointer events, so mouse and touch alike);
//   - or tap. One slot is always the target, outlined in gold; tapping a
//     card in the deck puts it there and moves the target on to the next
//     empty slot. Tap a slot to make it the target, or tap a placed card to
//     send it back to the deck.
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { cardFaceSVG, suitColors } from '../../lib/svg/cards.js';
import { feltSVG } from '../../lib/svg/themes.js';
import { getSettings } from '../../lib/settings.js';
import { computeEquity, runoutPlan } from '../../../shared/equity.mjs';
import SvgIcon from '../ui/SvgIcon.vue';
import EquityExplainer from './EquityExplainer.vue';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;
// One colour per seat, so a seat's badge and its share in the explanation
// panel are read as the same player. None of them is the gold used for a
// split pot, or the green and red of the win and lose bars.
const SEAT_COLORS = ['#4aa8e8', '#f07a5f', '#9b7cf0', '#4fd1c5', '#f0b04a', '#f07ab8', '#a3c85a', '#7f9cff', '#d9a07a'];
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = [
  { id: 's', name: 'Spades', glyph: '♠' },
  { id: 'h', name: 'Hearts', glyph: '♥' },
  { id: 'd', name: 'Diamonds', glyph: '♦' },
  { id: 'c', name: 'Clubs', glyph: '♣' },
];
const RANK_NAME = {
  A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten', 9: 'Nine', 8: 'Eight',
  7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two',
};
const cardName = (c) => `${RANK_NAME[c[0]]} of ${SUITS.find((s) => s.id === c[1]).name}`;
const BOARD_LABELS = ['Flop', 'Flop', 'Flop', 'Turn', 'River'];

// The player's own felt and deck colours, as they chose them for the game.
const look = (() => {
  try {
    return getSettings();
  } catch {
    return {};
  }
})();
// The colour each suit is printed in on this player's deck, so a row's label
// matches the cards in it (four-colour decks tint diamonds and clubs).
const suitInk = suitColors(look.deck);
const faces = new Map();
const face = (c) => {
  if (!faces.has(c)) faces.set(c, cardFaceSVG(c, { simple: true, deck: look.deck }));
  return faces.get(c);
};

// ---- The cards on the table -------------------------------------------------
const players = ref(2);
const hands = reactive(Array.from({ length: MAX_PLAYERS }, () => [null, null]));
const board = reactive([null, null, null, null, null]);

// Slots are { kind: 'hand', p, i } or { kind: 'board', i }.
const slotKey = (s) => (s.kind === 'hand' ? `h${s.p}-${s.i}` : `b${s.i}`);
const parseKey = (k) => {
  if (k[0] === 'b') return { kind: 'board', i: Number(k.slice(1)) };
  const [p, i] = k.slice(1).split('-').map(Number);
  return { kind: 'hand', p, i };
};
const getCard = (s) => (s.kind === 'hand' ? hands[s.p][s.i] : board[s.i]);
function setCard(s, c) {
  if (s.kind === 'hand') hands[s.p][s.i] = c;
  else board[s.i] = c;
}

// Every slot in play, in the order the tap target walks them: each player's
// two cards, then the board left to right.
const order = computed(() => {
  const out = [];
  for (let p = 0; p < players.value; p++) out.push({ kind: 'hand', p, i: 0 }, { kind: 'hand', p, i: 1 });
  for (let i = 0; i < 5; i++) out.push({ kind: 'board', i });
  return out;
});

// Where each card in play is, by card.
const placed = computed(() => {
  const at = new Map();
  for (const s of order.value) {
    const c = getCard(s);
    if (c) at.set(c, s);
  }
  return at;
});

// ---- Tap to place -------------------------------------------------------------
const target = ref({ kind: 'hand', p: 0, i: 0 });

// The next empty slot after `from`, wrapping round; null when every slot is full.
function nextEmpty(from) {
  const list = order.value;
  const start = from ? list.findIndex((s) => slotKey(s) === slotKey(from)) : -1;
  for (let n = 1; n <= list.length; n++) {
    const s = list[(start + n + list.length) % list.length];
    if (!getCard(s)) return s;
  }
  return null;
}

// Puts a card in a slot. A card already elsewhere moves rather than being
// copied, and if the slot held a card that one goes back to wherever the
// moving card came from - or to the deck.
function place(card, slot) {
  const from = placed.value.get(card);
  const displaced = getCard(slot);
  if (from) setCard(from, null);
  setCard(slot, card);
  if (displaced && displaced !== card && from) setCard(from, displaced);
  target.value = nextEmpty(slot);
}

function unplace(slot) {
  setCard(slot, null);
  target.value = slot;
}

const isTarget = (s) => !!target.value && slotKey(target.value) === slotKey(s);

function onDeckTap(card) {
  if (placed.value.has(card)) return;
  const slot = target.value || nextEmpty(null);
  if (slot) place(card, slot);
}

function onSlotTap(slot) {
  if (getCard(slot)) return unplace(slot);
  target.value = isTarget(slot) ? null : slot;
}

// ---- Drag ---------------------------------------------------------------------
// Pointer events rather than HTML drag and drop: one path for a mouse, a pen
// and a finger. A press only becomes a drag once it has moved a few pixels,
// so a tap is still a tap.
const ghost = ref(null); // { card, x, y } while a card is being dragged
const hoverKey = ref('');
let drag = null;
let swallowClick = false;

function slotUnder(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('[data-slot]');
  return el ? el.dataset.slot : '';
}

function onPointerDown(e, card, fromKey = '') {
  if (e.button !== 0 || !card) return;
  if (!fromKey && placed.value.has(card)) return;
  drag = { card, fromKey, x0: e.clientX, y0: e.clientY, id: e.pointerId, moving: false };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', endDrag);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moving) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.moving = true;
  }
  e.preventDefault();
  ghost.value = { card: drag.card, x: e.clientX, y: e.clientY };
  hoverKey.value = slotUnder(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moving) {
    const key = slotUnder(e.clientX, e.clientY);
    if (key) place(drag.card, parseKey(key));
    // A placed card dropped anywhere but a slot goes back to the deck.
    else if (drag.fromKey) unplace(parseKey(drag.fromKey));
    // The click that follows the release is the drag's, not a tap.
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
  }
  endDrag();
}

function endDrag() {
  drag = null;
  ghost.value = null;
  hoverKey.value = '';
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', endDrag);
}

const tapDeck = (c) => !swallowClick && onDeckTap(c);
const tapSlot = (s) => !swallowClick && onSlotTap(s);

// ---- Controls -----------------------------------------------------------------
function setPlayers(n) {
  const next = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
  // Seats taken away give their cards back.
  for (let p = next; p < MAX_PLAYERS; p++) hands[p].splice(0, 2, null, null);
  players.value = next;
  if (!target.value || (target.value.kind === 'hand' && target.value.p >= next)) target.value = nextEmpty(null);
}
function clearHand(p) {
  hands[p].splice(0, 2, null, null);
  target.value = { kind: 'hand', p, i: 0 };
}
function clearBoard() {
  board.splice(0, 5, null, null, null, null, null);
  target.value = nextEmpty(null);
}
function clearAll() {
  for (const h of hands) h.splice(0, 2, null, null);
  clearBoard();
  target.value = { kind: 'hand', p: 0, i: 0 };
}
const anyCards = computed(() => placed.value.size > 0);
const left = computed(() => 52 - placed.value.size);
const leftInSuit = (s) => RANKS.filter((r) => !placed.value.has(r + s)).length;
const boardCount = computed(() => board.filter(Boolean).length);

// ---- The odds -----------------------------------------------------------------
// Hands with both cards are in the calculation; a hand with only one is not,
// but that one card is still out of the deck.
const ready = computed(() => {
  const seats = [];
  const dead = [];
  for (let p = 0; p < players.value; p++) {
    const [a, b] = hands[p];
    if (a && b) seats.push(p);
    else if (a || b) dead.push(a || b);
  }
  return { seats, dead };
});
const canCalc = computed(() => ready.value.seats.length >= 2);

const odds = ref(null); // { key, bySeat: Map(seat -> { win, tie, lose }) }
const pending = ref(false);
const failed = ref('');
const plan = computed(() => runoutPlan(placed.value.size, boardCount.value));

const STREET = { 0: 'Pre-flop', 3: 'Flop', 4: 'Turn', 5: 'River' };
const street = computed(() => STREET[boardCount.value] || `${boardCount.value} board card${boardCount.value === 1 ? '' : 's'}`);

let worker = null;
let reqId = 0;
let timer = 0;
let latestSeats = [];
let latestKey = '';

function received(id, equity, error) {
  if (id !== reqId) return; // an answer to a question nobody is asking any more
  pending.value = false;
  if (error) {
    failed.value = 'Couldn’t work these odds out. Try changing a card.';
    return;
  }
  failed.value = '';
  odds.value = { key: latestKey, bySeat: new Map(latestSeats.map((p, i) => [p, equity[i]])) };
}

function calculate() {
  clearTimeout(timer);
  if (!canCalc.value) {
    reqId += 1;
    odds.value = null;
    pending.value = false;
    failed.value = '';
    return;
  }
  const { seats, dead } = ready.value;
  const payload = {
    hands: seats.map((p) => [...hands[p]]),
    board: board.filter(Boolean),
    dead: [...dead],
  };
  const key = JSON.stringify(payload);
  if (odds.value?.key === key && !pending.value) return;
  const id = ++reqId;
  pending.value = true;
  // A moment's grace, so several cards placed in quick succession are one
  // calculation rather than one each.
  timer = setTimeout(() => {
    latestSeats = seats;
    latestKey = key;
    if (worker) {
      worker.postMessage({ id, ...payload });
      return;
    }
    try {
      received(id, computeEquity(payload.hands, payload.board, payload.dead));
    } catch (err) {
      received(id, null, err);
    }
  }, 60);
}

watch(
  () => [players.value, hands.map((h) => h.join()).join('|'), board.join()],
  calculate,
  { immediate: true }
);

const leader = computed(() => {
  if (!odds.value) return -1;
  let best = -1;
  let seat = -1;
  for (const [p, e] of odds.value.bySeat) if (e.win > best) [best, seat] = [e.win, p];
  return seat;
});
const pct = (v) => (v > 0 && v < 0.1 ? '<0.1' : v > 99.9 && v < 100 ? '>99.9' : v.toFixed(1));
// What a seat's panel leads with: the share of runouts it wins - or, where
// that number would mislead, that it only ever splits, or cannot win at all.
// "0%" over "Tie 100%" read as a hand that loses, when it never does.
function seatSummary(e) {
  if (e.win + e.tie <= 0.05) return { kind: 'dead', head: '0%', sub: 'Drawing dead' };
  if (e.tie >= 99.95) return { kind: 'split', head: 'Split', sub: 'Ties on every runout' };
  return { kind: 'live', head: `${pct(e.win)}%`, sub: `Tie ${pct(e.tie)}% · Lose ${pct(e.lose)}%` };
}
const seatOdds = (p) => (odds.value && hands[p][0] && hands[p][1] ? odds.value.bySeat.get(p) || null : null);

// ---- Table shape --------------------------------------------------------------
// Wide on a desktop, tall on a phone, the way the live table does it, with
// the cloth cut to whichever shape the stage has.
const stage = ref(null);
const portrait = ref(false);
let watcher = null;
// A wide table with seven or more round it is cut a little deeper, so the
// seats down each end have the height to stand clear of one another.
const crowded = computed(() => players.value > 6);
const aspect = computed(() => (portrait.value ? 0.74 : crowded.value ? 1.6 : 1.9));
const felt = computed(() => feltSVG(look.felt, aspect.value));

// Seats round the rail, player 1 at the foot and the rest clockwise.
const seatPos = computed(() => {
  const n = players.value;
  const rx = portrait.value ? 38 : 45;
  const ry = portrait.value ? 44 : 40;
  return Array.from({ length: n }, (_, p) => {
    const a = ((90 + (p * 360) / n) * Math.PI) / 180;
    let sin = Math.sin(a);
    // A tall table's board runs nearly rail to rail, so a seat level with it
    // would sit on its end cards. Up to six seats there is room to move them
    // above or below it instead; a fuller table is laid out to fit as is.
    if (portrait.value && n <= 6 && Math.abs(sin) < 0.42) sin = sin > 0.001 ? 0.42 : -0.42;
    return { x: 50 + rx * Math.cos(a), y: 50 + ry * sin };
  });
});

// On a phone the deck shows one suit at a time, large enough to tap.
const deckSuit = ref('s');

// What the explanation panel needs: the hands in the calculation, the board
// placed so far, and any loose cards out of the deck.
const explainSeats = computed(() => ready.value.seats.map((p) => ({ p, hand: [...hands[p]] })));
const placedBoard = computed(() => board.filter(Boolean));

onMounted(() => {
  try {
    worker = new Worker(new URL('./equityWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => received(e.data.id, e.data.equity, e.data.error);
    worker.onerror = () => {
      worker = null; // carry on in the page instead
      calculate();
    };
  } catch {
    worker = null;
  }
  const measure = () => {
    portrait.value = (stage.value?.clientWidth || 0) < 560;
  };
  measure();
  if (window.ResizeObserver) {
    watcher = new ResizeObserver(measure);
    watcher.observe(stage.value);
  }
  calculate();
});

onBeforeUnmount(() => {
  endDrag();
  clearTimeout(timer);
  watcher?.disconnect();
  worker?.terminate();
});
</script>

<template>
  <main class="page eq-page">
    <div class="eq-layout">
    <!-- Left on a wide screen, last on a narrow one: the working. -->
    <aside class="eq-side eq-side-learn">
      <EquityExplainer
        :seats="explainSeats"
        :board="placedBoard"
        :dead="ready.dead"
        :odds="odds && !pending ? odds.bySeat : null"
        :plan="plan"
        :colors="SEAT_COLORS"
        :deck="look.deck"
      />
    </aside>

    <div class="eq-main">
    <header class="eq-head">
      <div>
        <div class="eyebrow">Tool</div>
        <h1 class="display eq-title">Equity Calculator</h1>
        <p class="lead">
          Deal hands and a board, and see each hand’s chance of winning. Drag cards from the deck, or tap
          a card to drop it in the highlighted slot.
        </p>
      </div>
      <div class="eq-controls">
        <div class="eq-stepper" role="group" aria-label="Players">
          <button
            type="button"
            class="eq-step"
            :disabled="players <= MIN_PLAYERS"
            aria-label="One player fewer"
            @click="setPlayers(players - 1)"
          >
            <SvgIcon name="minus" />
          </button>
          <span class="eq-step-val" aria-live="polite"><b>{{ players }}</b> players</span>
          <button
            type="button"
            class="eq-step"
            :disabled="players >= MAX_PLAYERS"
            aria-label="One more player"
            @click="setPlayers(players + 1)"
          >
            <SvgIcon name="plus" />
          </button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="!boardCount" @click="clearBoard">
          Clear board
        </button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="!anyCards" @click="clearAll">Clear all</button>
      </div>
    </header>

    <!-- The table. -->
    <section
      ref="stage"
      class="eq-stage"
      :class="{ 'is-portrait': portrait, 'is-crowded': crowded }"
      :style="{ aspectRatio: aspect }"
      aria-label="Table"
    >
      <div class="eq-felt" aria-hidden="true" v-html="felt" />

      <!-- The board, in the middle, with what each card is. -->
      <div class="eq-center">
        <div class="eq-street">
          {{ street }}
          <span v-if="canCalc" class="eq-method">
            · {{ plan.exact ? `every runout (${plan.boards.toLocaleString('en-US')})` : `${plan.boards.toLocaleString('en-US')} sampled runouts` }}
          </span>
        </div>
        <div class="eq-board">
          <div v-for="(c, i) in board" :key="i" class="eq-board-col">
            <button
              type="button"
              class="eq-slot is-board"
              :class="{ 'is-target': isTarget({ kind: 'board', i }), 'is-hover': hoverKey === `b${i}`, 'has-card': !!c }"
              :data-slot="`b${i}`"
              :aria-label="c ? `${BOARD_LABELS[i]}: ${cardName(c)}. Tap to remove` : `${BOARD_LABELS[i]} card, empty`"
              @pointerdown="c && onPointerDown($event, c, `b${i}`)"
              @click="tapSlot({ kind: 'board', i })"
            >
              <span v-if="c" class="eq-card" v-html="face(c)" />
            </button>
            <span class="eq-board-label" :class="{ 'is-group': i === 1 }">{{ i === 1 ? 'Flop' : i > 2 ? BOARD_LABELS[i] : '' }}</span>
          </div>
        </div>
        <div class="eq-status" aria-live="polite">
          <template v-if="failed">{{ failed }}</template>
          <template v-else-if="!canCalc">Give at least two players both cards to see their odds.</template>
          <template v-else-if="pending">Calculating…</template>
        </div>
      </div>

      <!-- The seats. -->
      <div
        v-for="(pos, p) in seatPos"
        :key="p"
        class="eq-seat"
        :class="{ 'is-lead': leader === p, 'is-pending': pending && seatOdds(p) }"
        :style="{ left: `${pos.x}%`, top: `${pos.y}%` }"
      >
        <div class="eq-hole">
          <button
            v-for="i in [0, 1]"
            :key="i"
            type="button"
            class="eq-slot"
            :class="{ 'is-target': isTarget({ kind: 'hand', p, i }), 'is-hover': hoverKey === `h${p}-${i}`, 'has-card': !!hands[p][i] }"
            :data-slot="`h${p}-${i}`"
            :aria-label="hands[p][i] ? `Player ${p + 1}, card ${i + 1}: ${cardName(hands[p][i])}. Tap to remove` : `Player ${p + 1}, card ${i + 1}, empty`"
            @pointerdown="hands[p][i] && onPointerDown($event, hands[p][i], `h${p}-${i}`)"
            @click="tapSlot({ kind: 'hand', p, i })"
          >
            <span v-if="hands[p][i]" class="eq-card" v-html="face(hands[p][i])" />
          </button>
        </div>
        <!-- The seat's panel: who it is, then how the hand stands. -->
        <div class="eq-panel" :class="seatOdds(p) ? `is-${seatSummary(seatOdds(p)).kind}` : 'is-empty'">
          <div class="eq-plate">
            <span class="eq-badge" :style="{ '--seat-c': SEAT_COLORS[p] }">{{ p + 1 }}</span>
            <span class="eq-name">Player {{ p + 1 }}</span>
            <button
              v-if="hands[p][0] || hands[p][1]"
              type="button"
              class="eq-clear"
              :aria-label="`Clear player ${p + 1}’s hand`"
              title="Clear hand"
              @click="clearHand(p)"
            >
              <SvgIcon name="close" />
            </button>
          </div>
          <div v-if="seatOdds(p)" class="eq-odds">
            <b class="eq-odds-head">{{ seatSummary(seatOdds(p)).head }}</b>
            <!-- Win, tie and lose as one bar, in that order. -->
            <span class="eq-odds-bar" aria-hidden="true">
              <i class="is-win" :style="{ width: `${seatOdds(p).win}%` }" />
              <i class="is-tie" :style="{ width: `${seatOdds(p).tie}%` }" />
              <i class="is-lose" :style="{ width: `${seatOdds(p).lose}%` }" />
            </span>
            <span class="eq-odds-sub">{{ seatSummary(seatOdds(p)).sub }}</span>
          </div>
          <div v-else class="eq-odds is-empty">{{ hands[p][0] && hands[p][1] ? 'Calculating…' : 'Add 2 cards' }}</div>
        </div>
      </div>
    </section>

    </div>

    <!-- The deck. Every card, in suit rows; one used on the table is greyed
         out where it was, so the deck keeps its shape. -->
    <aside class="eq-side eq-side-deck">
    <section class="eq-deck" aria-label="Deck">
      <div class="eq-deck-head">
        <span class="eq-deck-title">Deck</span>
        <span class="eq-deck-count"><b>{{ left }}</b> of 52 left</span>
        <span class="eq-deck-hint">Drag a card onto the table, or tap it to fill the highlighted slot</span>
      </div>
      <div class="eq-suit-tabs" role="tablist" aria-label="Suit">
        <button
          v-for="s in SUITS"
          :key="s.id"
          type="button"
          role="tab"
          class="eq-suit-tab"
          :class="[`suit-${s.id}`, { 'is-on': deckSuit === s.id }]"
          :aria-selected="deckSuit === s.id"
          @click="deckSuit = s.id"
        >
          <span aria-hidden="true">{{ s.glyph }}</span>{{ s.name }}
        </button>
      </div>
      <div v-for="s in SUITS" :key="s.id" class="eq-deck-row" :class="{ 'is-on': deckSuit === s.id }">
        <div class="eq-row-label" :style="{ '--ink': suitInk[s.id] }">
          <span class="eq-row-glyph" aria-hidden="true">{{ s.glyph }}</span>
          <span class="eq-row-name">{{ s.name }}</span>
          <span class="eq-row-left">{{ leftInSuit(s.id) }}/13</span>
        </div>
        <button
          v-for="r in RANKS"
          :key="r + s.id"
          type="button"
          class="eq-deck-card"
          :class="{ 'is-used': placed.has(r + s.id) }"
          :disabled="placed.has(r + s.id)"
          :aria-label="placed.has(r + s.id) ? `${cardName(r + s.id)}, on the table` : cardName(r + s.id)"
          @pointerdown="onPointerDown($event, r + s.id)"
          @click="tapDeck(r + s.id)"
        >
          <span class="eq-card" v-html="face(r + s.id)" />
        </button>
      </div>
    </section>
    </aside>
    </div>


    <!-- The card under a finger or a pointer while it is being dragged. -->
    <div v-if="ghost" class="eq-ghost" :style="{ left: `${ghost.x}px`, top: `${ghost.y}px` }" aria-hidden="true">
      <span class="eq-card" v-html="face(ghost.card)" />
    </div>
  </main>
</template>
