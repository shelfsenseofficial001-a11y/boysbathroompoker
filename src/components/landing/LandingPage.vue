<script setup>
// The front page, for everybody: a visitor, a guest, or somebody with an
// account. What changes between them is the two buttons, not the page.
//
// Driven by data throughout - features.js for the feature grid and the three
// steps, faq.mjs for the questions - so shipping a feature is one word
// changed there rather than a hunt through this file.
//
// The page is careful about one thing above all: it never says a feature
// works when it does not. Unbuilt work is shown, tagged in words and written
// in the future tense. The hero, its buttons and the three steps describe
// only what works today.
import { computed, onMounted, defineAsyncComponent, h } from 'vue';
import { FEATURES, STEPS, hasUnbuilt } from './features.js';
import { useAuth } from '../../composables/useAuth.js';
import { useAnimations } from '../../composables/useAnimations.js';
import FeatureVisual from './FeatureVisual.vue';
import FaqSection from './FaqSection.vue';
import BaseButton from '../ui/BaseButton.vue';
import SvgIcon from '../ui/SvgIcon.vue';

// The demo table is the heaviest thing on the page and the only part of it
// that runs a loop, so it is split into its own chunk. The hero's words and
// buttons are in this one and render on the first frame; the table's frame
// holds its shape until the real thing arrives, so nothing jumps.
const DemoTable = defineAsyncComponent({
  loader: () => import('./DemoTable.vue'),
  loadingComponent: { render: () => h('div', { class: 'demo demo-placeholder', 'aria-hidden': 'true' }) },
  delay: 0,
});

const props = defineProps({
  user: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['guest', 'auth', 'lobby', 'settings']);

const auth = useAuth();
const signedIn = computed(() => !!props.user || auth.signedIn.value);
const { enabled: animOn, toggle: toggleAnim } = useAnimations();

const TITLE = 'CCPoker — play-money Texas Hold’em with friends';
const META =
  'Free play-money No-Limit Texas Hold’em. Host a private table or join with a room code, ' +
  'drag chips to bet and throw your cards in to fold. Chips only — no real money, ever.';

onMounted(() => {
  document.title = TITLE;
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', META);
});

const TRUST = ['No real money', 'Fresh chips every table', 'Play as a guest'];

// The section anchors the bar links to. Kept as a lookup rather than
// written into the grid, so the grid stays a plain list of features.
const ANCHOR = { 'no-money': 'free', 'double-tap-check': 'hands-on', rooms: 'your-way', leaderboards: 'compete' };
</script>

<template>
  <div class="landing">
    <main class="landing-main">
      <!-- ---------- Hero ----------
           Words on the left, the table on the right - and the words first
           in the document too, so a phone reads the headline and the
           buttons before the table. -->
      <section class="lp-hero" aria-labelledby="lp-hero-h">
        <div class="lp-hero-say">
          <div class="lp-eyebrow-row">
            <p class="lp-eyebrow">Play-money Texas Hold’em</p>
            <span class="lp-dev-badge">Early access · In development</span>
          </div>
          <h1 id="lp-hero-h" class="lp-h1">
            Poker with friends, for <mark class="lp-mark">chips</mark> only.
          </h1>
          <p class="lead lp-hero-lead">
            Host a table in one tap, send the code, and play it out with your hands — drag chips
            in to bet, throw your cards in to fold. No real money, ever.
          </p>

          <div class="lp-cta">
            <template v-if="signedIn">
              <BaseButton variant="primary" size="lg" @click="emit('lobby')">Go to lobby</BaseButton>
              <BaseButton size="lg" @click="emit('settings')">Open settings</BaseButton>
            </template>
            <template v-else>
              <BaseButton variant="primary" size="lg" :disabled="busy" @click="emit('guest')">
                {{ busy ? 'Dealing you in…' : 'Play as guest' }}
              </BaseButton>
              <BaseButton size="lg" @click="emit('auth', 'signup')">Sign up</BaseButton>
            </template>
          </div>
          <p v-if="error" class="error-text" role="alert">{{ error }}</p>

          <ul class="lp-trust">
            <li v-for="t in TRUST" :key="t"><span class="lp-tick" aria-hidden="true">&#10003;</span>{{ t }}</li>
          </ul>
        </div>

        <div class="lp-hero-art">
          <DemoTable />
        </div>
      </section>

      <!-- ---------- How it works ---------- -->
      <section id="how" class="lp-steps" aria-labelledby="lp-steps-h">
        <p class="lp-eyebrow">How it works</p>
        <h2 id="lp-steps-h" class="lp-section-h">Three steps to the <mark class="lp-mark">felt.</mark></h2>
        <ol class="lp-step-row">
          <li v-for="step in STEPS" :key="step.n" class="lp-step">
            <span class="lp-step-n" aria-hidden="true">{{ step.n }}</span>
            <h3 class="lp-step-t">{{ step.title }}</h3>
            <p>{{ step.description }}</p>
          </li>
        </ol>
      </section>

      <!-- ---------- Features ---------- -->
      <section id="features" class="lp-features" aria-labelledby="lp-feat-h">
        <div class="lp-features-head">
          <div>
            <p class="lp-eyebrow">Features</p>
            <h2 id="lp-feat-h" class="lp-section-h">
              Everything at the table.<br />Nothing at <mark class="lp-mark">stake.</mark>
            </h2>
            <p class="lead lp-features-lede">
              A table you play with your hands, rooms for strangers or friends, and bots to
              practise on.<template v-if="hasUnbuilt"> Some features are still in development.</template>
            </p>
          </div>
          <!-- One switch for every moving thing on this page: the demo table
               and the loop on each card below. -->
          <button
            type="button"
            role="switch"
            class="lp-anim-switch"
            :aria-checked="String(animOn)"
            @click="toggleAnim"
          >
            <span>Animations</span>
            <span class="lp-anim-track" aria-hidden="true"><i /></span>
          </button>
        </div>

        <ul class="lp-grid">
          <li
            v-for="f in FEATURES"
            :id="ANCHOR[f.id]"
            :key="f.id"
            class="lp-card"
            :class="{ 'is-soon': f.status === 'soon' }"
          >
            <div class="lp-card-panel"><FeatureVisual :id="f.id" :soon="f.status === 'soon'" /></div>
            <div class="lp-card-say">
              <h3 class="lp-card-t">
                {{ f.title }}
                <span v-if="f.status === 'soon'" class="lp-soon">Coming soon</span>
              </h3>
              <p>{{ f.description }}</p>
            </div>
          </li>
        </ul>
      </section>

      <!-- ---------- FAQ ---------- -->
      <FaqSection />

      <!-- ---------- Closing ---------- -->
      <section class="lp-close" aria-labelledby="lp-close-h">
        <h2 id="lp-close-h" class="lp-section-h">Pull up a <mark class="lp-mark">chair.</mark></h2>
        <p class="lead">It takes one tap, and it costs nothing, because there is nothing to pay.</p>
        <div class="lp-cta lp-cta-mid">
          <template v-if="signedIn">
            <BaseButton variant="primary" size="lg" @click="emit('lobby')">Go to lobby</BaseButton>
          </template>
          <template v-else>
            <BaseButton variant="primary" size="lg" :disabled="busy" @click="emit('guest')">
              {{ busy ? 'Dealing you in…' : 'Play as guest' }}
            </BaseButton>
            <BaseButton size="lg" @click="emit('auth', 'signup')">Sign up</BaseButton>
          </template>
        </div>
      </section>

      <aside class="lp-notice" aria-label="No real money">
        <SvgIcon name="eye" />
        <p>
          <b>No real money.</b> The chips in this game have no cash value. They cannot be bought,
          sold, exchanged or cashed out, and there is no way to put money into a table.
        </p>
      </aside>
    </main>
  </div>
</template>
