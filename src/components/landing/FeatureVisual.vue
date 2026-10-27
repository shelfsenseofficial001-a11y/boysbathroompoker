<script setup>
// A sample of the real interface for each feature, so a visitor sees the
// thing itself rather than a drawing of the idea of it.
//
// Built from the game's real art (cards, chips, avatars, icons) and the real
// classes the live screens use (.act buttons, .switch-row, .umenu-who and its
// badge, .player-row). The live components are deliberately not mounted:
// RoomList opens a socket in its setup and asks the server for rooms on
// mount, and HostRoomForm submits through it - neither belongs on a public
// page for somebody who has not signed in. Their markup is reproduced in
// their own classes instead, so it looks exactly like them and does nothing.
//
// Features that are not built yet wear a "Preview" label on the panel and
// use only neutral placeholders - "Player 1", blank bars - never a name, a
// score or a count that could be mistaken for somebody's real data.
//
// One small loop each, run only while on screen and only while the page's
// Animations switch is on.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { cardFaceSVG } from '../../lib/svg/cards.js';
import { cardBackSVG } from '../../lib/svg/themes.js';
import { chipSVG, chipStackSVG, formatChipLabel } from '../../lib/svg/chips.js';
import { avatarSVG } from '../../lib/svg/avatars.js';
import { icons } from '../../lib/svg/icons.js';
import { useAnimations } from '../../composables/useAnimations.js';

const props = defineProps({
  id: { type: String, required: true },
  soon: { type: Boolean, default: false },
});

const { playing } = useAnimations();
const root = ref(null);
const inView = ref(false);
let observer = null;

onMounted(() => {
  if (typeof IntersectionObserver !== 'function') {
    inView.value = true;
    return;
  }
  observer = new IntersectionObserver(([e]) => (inView.value = e.isIntersecting), { rootMargin: '60px' });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const live = computed(() => playing.value && inView.value);

// Real art, drawn once.
const back = cardBackSVG();
const ak = [cardFaceSVG('As'), cardFaceSVG('Ks')];
const flop = ['9s', '4s', 'Qc'].map((c) => cardFaceSVG(c));
const stack = chipStackSVG(1000, { maxCols: 3, maxPerCol: 6 });
const smallStack = chipStackSVG(250, { maxCols: 2, maxPerCol: 5 });
const chip = chipSVG(25);
const fmt = formatChipLabel;
const avatar = (n) => avatarSVG(n);
const BOTS = ['Beginner', 'Casual', 'Solid', 'Expert'];
</script>

<template>
  <div ref="root" class="fprev" :class="[`is-${id}`, { 'is-live': live }]" aria-hidden="true">
    <span v-if="soon" class="fprev-tag">Preview</span>

    <!-- No real money: a real chip stack, and what it is worth. -->
    <div v-if="id === 'no-money'" class="fprev-body">
      <span class="fprev-stack" v-html="stack" />
      <div class="fprev-figure">
        <b>{{ fmt(1000) }}</b>
        <span>chips</span>
      </div>
      <span class="fprev-pill">No cash value</span>
    </div>

    <!-- Fresh chips: the host's starting-stack field, as it appears. -->
    <div v-else-if="id === 'fresh-chips'" class="fprev-body fprev-form">
      <div class="field">
        <label>Everyone starts with</label>
        <div class="stepper">
          <span class="step-btn">−</span>
          <span class="input fprev-input">{{ fmt(1000) }}</span>
          <span class="step-btn">+</span>
        </div>
      </div>
      <span class="fprev-refill" v-html="smallStack" />
    </div>

    <!-- Guest play: the real account menu's header, for a guest. -->
    <div v-else-if="id === 'guest-play'" class="fprev-body">
      <div class="umenu fprev-menu">
        <div class="umenu-who">
          <div class="fprev-whorow">
            <span class="fprev-avatar" v-html="avatar('Guest')" />
            <p class="umenu-whoname">Guest 1234</p>
          </div>
          <span class="umenu-badge is-guest">Guest</span>
        </div>
        <span class="umenu-item"><span class="contents" v-html="icons.key" />Create account</span>
        <span class="umenu-item"><span class="contents" v-html="icons.gear" />Settings</span>
      </div>
    </div>

    <!-- Double-tap to check: real cards, a tap on the felt, the Check button. -->
    <div v-else-if="id === 'double-tap-check'" class="fprev-body fprev-felt">
      <div class="fprev-board">
        <span v-for="(c, i) in flop" :key="i" class="fprev-card" v-html="c" />
      </div>
      <span class="fprev-ring" /><span class="fprev-ring fprev-ring-2" />
      <span class="act act-call fprev-act"><span class="act-label"><span class="contents" v-html="icons.check" />Check</span></span>
    </div>

    <!-- Throw your cards in to fold. -->
    <div v-else-if="id === 'drag-fold'" class="fprev-body fprev-felt">
      <span class="fprev-muck">Muck</span>
      <div class="fprev-hand fprev-toss">
        <span class="fprev-card" v-html="ak[0]" /><span class="fprev-card" v-html="ak[1]" />
      </div>
      <span class="act act-fold fprev-act"><span class="act-label"><span class="contents" v-html="icons.fold" />Fold</span></span>
    </div>

    <!-- Drag a chip into the pot. -->
    <div v-else-if="id === 'drag-chips'" class="fprev-body fprev-felt">
      <div class="fprev-pot"><span class="pot-label">Pot</span><span class="pot-amt">{{ fmt(115) }}</span></div>
      <span class="fprev-stack fprev-mine" v-html="smallStack" />
      <span class="fprev-chip fprev-fly" v-html="chip" />
      <span class="act act-raise fprev-act"><span class="act-label"><span class="contents" v-html="icons.raise" />Raise</span></span>
    </div>

    <!-- Public and private: the real switch from the host form. -->
    <div v-else-if="id === 'rooms'" class="fprev-body fprev-form">
      <div class="fprev-room">
        <span class="fprev-code">AB2DE</span>
        <span class="fprev-room-kind">Open table</span>
      </div>
      <label class="switch-row fprev-switch">
        <input type="checkbox" checked tabindex="-1" disabled />
        <span>Private room — hidden from open tables, and you let each player in</span>
      </label>
    </div>

    <!-- Friends: not built. Real avatars and a real button, placeholder names. -->
    <div v-else-if="id === 'friends'" class="fprev-body">
      <div class="fprev-avatars">
        <span v-for="n in 3" :key="n" class="fprev-avatar" v-html="avatar(`Player ${n}`)" />
        <span class="fprev-add" v-html="icons.plus" />
      </div>
      <span class="btn btn-sm fprev-btn">Invite to table</span>
    </div>

    <!-- Bots: the four real level names, in the real lobby row style. -->
    <div v-else-if="id === 'bots'" class="fprev-body fprev-list">
      <div v-for="(lvl, i) in BOTS" :key="lvl" class="player-row is-bot fprev-row" :style="{ '--i': i }">
        <span class="avatar-sm"><span class="contents" v-html="icons.robot" /></span>
        <span class="fprev-rowname">{{ lvl }}</span>
        <span class="fprev-meter"><i :style="{ width: 25 + i * 25 + '%' }" /></span>
      </div>
    </div>

    <!-- Leaderboards: not built. Ranks and blank bars, no names or numbers. -->
    <div v-else-if="id === 'leaderboards'" class="fprev-body fprev-list">
      <div v-for="n in 4" :key="n" class="player-row fprev-row">
        <span class="fprev-rank">{{ n }}</span>
        <span class="avatar-sm" v-html="avatar(`Player ${n}`)" />
        <span class="fprev-rowname">Player {{ n }}</span>
        <span class="fprev-blank" />
      </div>
    </div>
  </div>
</template>
