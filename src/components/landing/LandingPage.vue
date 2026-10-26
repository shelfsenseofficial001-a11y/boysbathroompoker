<script setup>
// The front door for somebody who has never been here.
//
// Everything on it is driven by features.js - order, headings, tags, which
// sections exist at all - so shipping a feature is one word changed there
// rather than a hunt through this file.
//
// The page is careful about one thing above all: it never says a feature
// works when it does not. Unbuilt work is shown, because it is worth knowing
// where this is going, but it is tagged in words, written in the future
// tense, and not clickable. The hero's buttons and the three steps describe
// only what works today.
import { computed, onMounted } from 'vue';
import { GROUPS, STEPS, byGroup, hasUnbuilt } from './features.js';
import { useAuth } from '../../composables/useAuth.js';
import FeatureVisual from './FeatureVisual.vue';
import BaseButton from '../ui/BaseButton.vue';
import SvgIcon from '../ui/SvgIcon.vue';

const props = defineProps({
  user: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['guest', 'auth', 'lobby', 'settings']);

const auth = useAuth();
const signedIn = computed(() => !!props.user || auth.signedIn.value);

// Sections alternate which side the drawing sits on, so four groups of the
// same shape do not read as one long list.
const sections = computed(() =>
  GROUPS.map((group, i) => ({ ...group, items: byGroup(group.id), flip: i % 2 === 1 }))
);

const TITLE = 'CCPoker — play-money Texas Hold’em with friends';
const META =
  'Free play-money Texas Hold’em. Host a private table or join with a room code, ' +
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
</script>

<template>
  <div class="landing">
    <main class="landing-main">
      <!-- ---------- Hero ---------- -->
      <section class="lp-hero" aria-labelledby="lp-hero-h">
        <div class="lp-hero-say">
          <p class="eyebrow">Play-money Texas Hold’em</p>
          <h1 id="lp-hero-h" class="display lp-h1">
            Poker with your friends. Chips only, no real money, ever.
          </h1>
          <p class="lead">
            Host a table in one tap, send the code, and play it out. The chips are counters for
            keeping score and nothing else.
          </p>

          <div class="lp-cta">
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
          <p class="lp-support">No deposits. No cashouts. Just chips.</p>
          <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        </div>

        <!-- A table, drawn rather than rendered: this is a picture of the
             idea, and it never touches the real table code. -->
        <div class="lp-hero-art" aria-hidden="true">
          <svg viewBox="0 0 320 240" class="lp-table">
            <ellipse cx="160" cy="124" rx="140" ry="92" class="lp-felt-rim" />
            <ellipse cx="160" cy="120" rx="130" ry="84" class="lp-felt" />
            <ellipse cx="160" cy="120" rx="104" ry="62" class="lp-felt-line" />
            <g class="lp-board">
              <rect v-for="n in 5" :key="n" :x="86 + (n - 1) * 30" y="100" width="24" height="34"
                rx="4" class="lp-card" />
            </g>
            <g class="lp-potchips">
              <ellipse v-for="n in 4" :key="n" cx="160" :cy="160 - (n - 1) * 6" rx="22" ry="7"
                class="lp-chip" :class="{ 'lp-chip-gold': n === 4 }" />
            </g>
            <g class="lp-hole">
              <rect x="40" y="166" width="26" height="36" rx="4" class="lp-card lp-card-mine"
                transform="rotate(-10 53 184)" />
              <rect x="62" y="166" width="26" height="36" rx="4" class="lp-card lp-card-mine"
                transform="rotate(7 75 184)" />
            </g>
            <g class="lp-seats">
              <circle v-for="n in 5" :key="n" :cx="160 + Math.cos((n / 5) * Math.PI * 2 - 1.57) * 128"
                :cy="120 + Math.sin((n / 5) * Math.PI * 2 - 1.57) * 80" r="13" class="lp-seat" />
            </g>
          </svg>
        </div>
      </section>

      <!-- ---------- How it works ---------- -->
      <section class="lp-steps" aria-labelledby="lp-steps-h">
        <h2 id="lp-steps-h" class="h2">How it works</h2>
        <ol class="lp-step-row">
          <li v-for="step in STEPS" :key="step.n" class="lp-step">
            <span class="lp-step-n" aria-hidden="true">{{ step.n }}</span>
            <h3 class="lp-step-t">{{ step.title }}</h3>
            <p class="set-note">{{ step.description }}</p>
          </li>
        </ol>
      </section>

      <!-- ---------- Features ---------- -->
      <p v-if="hasUnbuilt" class="lp-dev-note">Some features are still in development.</p>

      <section
        v-for="section in sections"
        :id="section.id"
        :key="section.id"
        class="lp-group"
        :class="{ 'is-flipped': section.flip }"
        :aria-labelledby="`lp-${section.id}-h`"
      >
        <h2 :id="`lp-${section.id}-h`" class="h2 lp-group-h">{{ section.title }}</h2>
        <p class="lead lp-group-lede">{{ section.lede }}</p>

        <ul class="lp-feats">
          <li v-for="feature in section.items" :key="feature.id" class="lp-feat"
            :class="{ 'is-soon': feature.status === 'soon' }">
            <FeatureVisual :id="feature.id" class="lp-feat-art" />
            <div class="lp-feat-say">
              <h3 class="lp-feat-t">
                {{ feature.title }}
                <!-- Words, not a colour: a tag nobody can read is not a tag. -->
                <span v-if="feature.status === 'soon'" class="lp-soon">Coming soon</span>
              </h3>
              <p class="set-note">{{ feature.description }}</p>
            </div>
          </li>
        </ul>
      </section>

      <!-- ---------- Closing ---------- -->
      <section class="lp-close" aria-labelledby="lp-close-h">
        <h2 id="lp-close-h" class="h2">Pull up a chair.</h2>
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
