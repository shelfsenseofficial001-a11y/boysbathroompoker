<script setup>
// A hand of poker playing itself, so a visitor can see how the table works
// before they sit at one.
//
// Built from the game's real art - the felt, the card faces and backs, the
// chip stacks, the avatars, the dealer button, the action buttons - imported
// read-only from the same modules the table renderer draws with. Nothing
// here touches the renderer, the socket or the session: the state is the
// mock in demoTimeline.mjs, and the only moving part is the runner below.
//
// It is a picture of the game, labelled as one ("Demo table"), with neutral
// names and round numbers. It never shows a player count, a result, or
// anything that could be read as somebody's real game.
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { cardFaceSVG } from '../../lib/svg/cards.js';
import { cardBackSVG, feltSVG } from '../../lib/svg/themes.js';
import { chipStackSVG, formatChipLabel } from '../../lib/svg/chips.js';
import { avatarSVG } from '../../lib/svg/avatars.js';
import { dealerButtonSVG } from '../../lib/svg/table.js';
import { getSettings } from '../../lib/settings.js';
import { useAnimations } from '../../composables/useAnimations.js';
import { STEPS, initialState, staticFrame } from './demoTimeline.mjs';

const { playing } = useAnimations();

// The visitor's own felt and card back, if they have chosen them. Somebody
// who already plays sees the table they play at; a first-time visitor sees
// the default, which is what they would get.
const look = (() => {
  try {
    return getSettings();
  } catch {
    return {};
  }
})();
const felt = feltSVG(look.felt, 1.6);
const back = cardBackSVG(look.cardBack);

const root = ref(null);
const state = shallowRef(staticFrame());
const stepIndex = ref(-1);

// --- The runner -----------------------------------------------------------
// One requestAnimationFrame loop, walking STEPS. It keeps its own clock
// rather than trusting setTimeout, so a tab coming back from the background
// picks up where it left off instead of firing every missed step at once.
let raf = 0;
let stepStarted = 0;
let pausedAt = 0;
let visible = false;

function applyStep(i) {
  const step = STEPS[i];
  state.value = { ...state.value, ...step.patch(state.value) };
  stepIndex.value = i;
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (stepIndex.value === -1) {
    // A fresh loop starts from a clean table, so nothing drifts between laps.
    state.value = initialState();
    applyStep(0);
    stepStarted = now;
    return;
  }
  if (now - stepStarted < STEPS[stepIndex.value].ms) return;
  const next = (stepIndex.value + 1) % STEPS.length;
  if (next === 0) stepIndex.value = -1;
  else applyStep(next);
  stepStarted = now;
}

function start() {
  if (raf || !playing.value || !visible || document.hidden) return;
  // Carry on from where it was paused, rather than jumping the step.
  if (pausedAt) stepStarted += performance.now() - pausedAt;
  pausedAt = 0;
  raf = requestAnimationFrame(tick);
}

function stop() {
  if (!raf) return;
  cancelAnimationFrame(raf);
  raf = 0;
  pausedAt = performance.now();
}

// Off, or reduced: a still frame from the middle of the hand.
watch(playing, (on) => {
  if (on) {
    stepIndex.value = -1;
    start();
  } else {
    stop();
    state.value = staticFrame();
    stepIndex.value = -1;
  }
});

let observer = null;
function onVisibility() {
  if (document.hidden) stop();
  else start();
}

onMounted(() => {
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0.15 }
    );
    observer.observe(root.value);
  } else {
    visible = true;
    start();
  }
  document.addEventListener('visibilitychange', onVisibility);
});

onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
  document.removeEventListener('visibilitychange', onVisibility);
});

// --- Drawing -------------------------------------------------------------
// Seat positions as a percentage of the stage, the same way the real table
// places its pods: you at the foot, the bots round the rim.
// The top seat is placed by its top edge rather than its centre (see the CSS
// for .at-b2), so its number is where the plate starts, not where it sits.
const SEAT_AT = { you: [50, 84], b1: [11, 46], b2: [50, 4], b3: [89, 46] };
const BUTTON_AT = [27, 30];

const seats = computed(() =>
  state.value.seats.map((p) => ({
    ...p,
    at: SEAT_AT[p.id],
    avatar: avatarSVG(p.id === 'you' ? 'You' : `Bot ${p.id}`),
    stack: p.chips > 0 ? chipStackSVG(p.chips, { maxCols: 3, maxPerCol: 5 }) : '',
    betChips: p.bet ? chipStackSVG(p.bet, { maxCols: 2, maxPerCol: 4 }) : '',
    faces: (p.cards || []).map((c) => (p.faceUp ? cardFaceSVG(c) : back)),
  }))
);

const board = computed(() => state.value.board.map((c) => ({ code: c, svg: cardFaceSVG(c) })));
const potChips = computed(() => (state.value.pot ? chipStackSVG(state.value.pot, { maxCols: 4, maxPerCol: 5 }) : ''));
const fmt = (n) => formatChipLabel(n);

const gesture = computed(() => state.value.gesture);
// Restarting a CSS animation needs a new element, so the step index keys
// the overlay: the same gesture twice in a row still plays twice.
const gestureKey = computed(() => `${stepIndex.value}-${gesture.value?.kind || 'none'}`);
</script>

<template>
  <figure ref="root" class="demo" :class="{ 'is-still': !playing }">
    <!-- Hidden from assistive tech: every card here is a labelled image, and
         a loop re-dealing them every few seconds would announce "Ace of
         spades, King of spades..." on repeat. The caption below says what
         this is in one sentence instead. -->
    <div class="demo-stage" aria-hidden="true">
      <!-- The real felt, drawn by the real felt function. -->
      <div class="demo-felt" v-html="felt" />

      <!-- The dealer button, where it sits for this hand. -->
      <div class="demo-dealer" :style="{ left: BUTTON_AT[0] + '%', top: BUTTON_AT[1] + '%' }" v-html="dealerButtonSVG()" />

      <!-- Community cards. Each one flips in as it is turned over. -->
      <div class="demo-board">
        <span v-for="c in board" :key="c.code" class="demo-card demo-flip" v-html="c.svg" />
        <span v-for="n in 5 - board.length" :key="'gap' + n" class="demo-card demo-slot" />
      </div>

      <!-- The pot, in the middle. -->
      <div class="demo-pot" :class="{ 'is-empty': !state.pot }">
        <span class="demo-pot-chips" v-html="potChips" />
        <span v-if="state.pot" class="demo-pot-amt">{{ fmt(state.pot) }}</span>
      </div>

      <!-- The seats. -->
      <div
        v-for="p in seats"
        :key="p.id"
        class="demo-seat"
        :class="{
          'is-you': p.id === 'you',
          'is-turn': state.turn === p.id,
          'is-folded': p.folded,
          'is-winner': p.winner,
          [`at-${p.id}`]: true,
        }"
        :style="{ left: p.at[0] + '%', top: p.at[1] + '%' }"
      >
        <!-- Keyed by the cards themselves, so a new hand is a new element and
             the deal animation plays again rather than being skipped. -->
        <div
          v-if="p.faces.length"
          :key="(p.cards || []).join()"
          class="demo-hand"
          :class="{ 'is-mucked': p.folded }"
        >
          <span v-for="(f, i) in p.faces" :key="i" class="demo-card demo-deal" :style="{ '--i': i }" v-html="f" />
        </div>
        <div class="demo-plate">
          <span class="demo-avatar" v-html="p.avatar" />
          <span class="demo-name">{{ p.name }}</span>
          <span class="demo-chips">{{ fmt(p.chips) }}</span>
        </div>
        <span v-if="p.betChips" class="demo-bet" v-html="p.betChips" />
      </div>

      <!-- The gesture being shown, drawn over the table. -->
      <div v-if="gesture" :key="gestureKey" class="demo-gesture" :class="`is-${gesture.kind}`" aria-hidden="true">
        <template v-if="gesture.kind === 'tap'">
          <span class="demo-ring" :style="{ left: gesture.from[0] + '%', top: gesture.from[1] + '%' }" />
          <span class="demo-ring demo-ring-2" :style="{ left: gesture.from[0] + '%', top: gesture.from[1] + '%' }" />
        </template>
        <svg v-if="gesture.to" class="demo-path" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            :x1="gesture.from[0]" :y1="gesture.from[1]"
            :x2="gesture.to[0]" :y2="gesture.to[1]"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <span
          class="demo-pointer"
          :style="{
            '--fx': gesture.from[0] + '%', '--fy': gesture.from[1] + '%',
            '--tx': (gesture.to || gesture.from)[0] + '%', '--ty': (gesture.to || gesture.from)[1] + '%',
          }"
        />
      </div>

      <!-- What just happened, in words, for anybody watching without
           knowing the game - and the label that says this is not live. -->
      <div class="demo-caption">
        <span v-if="state.phase" class="demo-phase">{{ state.phase }}</span>
        <span class="demo-said">{{ state.caption }}</span>
      </div>
    </div>

    <figcaption class="demo-tag">
      Demo table<span class="sr-only"> — a scripted hand of Texas Hold’em showing the deal, a check,
      a bet, a fold and a showdown. Not a live game.</span>
    </figcaption>
  </figure>
</template>
