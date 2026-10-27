<script setup>
// The foot of the page. Every link here goes somewhere that exists: this app
// has no Terms, Privacy or Contact page, so there are none listed - a footer
// full of dead links is worse than a short one.
//
// What it offers depends on who is reading it. Somebody signed out is offered
// the way in; somebody already playing is offered the lobby and their
// settings. Nothing is shown that would do nothing when clicked.
import { computed } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import SvgIcon from '../ui/SvgIcon.vue';

defineProps({
  // Anchors only make sense on the page that has those sections.
  showFeatureLinks: { type: Boolean, default: false },
});
const emit = defineEmits(['auth', 'guest', 'lobby', 'settings']);

const auth = useAuth();
const signedIn = computed(() => auth.signedIn.value);

// Computed, not written in: a hard-coded year is wrong every January.
const year = new Date().getFullYear();
</script>

<template>
  <footer class="site-foot">
    <div class="foot-inner">
      <div class="foot-brand">
        <span class="brand foot-mark"><SvgIcon name="logo" /><span class="brand-name">CC<em>Poker</em></span></span>
        <p class="foot-line">
          Play-money Texas Hold’em for you and your friends. Host a table, send the code, and
          settle it on the felt.
        </p>
      </div>

      <nav class="foot-nav" aria-label="Footer">
        <div class="foot-col">
          <h2 class="foot-head">Play</h2>
          <ul>
            <li v-if="!signedIn">
              <button type="button" class="link" @click="emit('guest')">Play as guest</button>
            </li>
            <li v-if="!signedIn">
              <button type="button" class="link" @click="emit('auth', 'signup')">Sign up</button>
            </li>
            <li v-if="signedIn">
              <button type="button" class="link" @click="emit('lobby')">Lobby</button>
            </li>
          </ul>
        </div>

        <div v-if="showFeatureLinks" class="foot-col">
          <h2 class="foot-head">Features</h2>
          <ul>
            <li><a class="link" href="#free">Free to play</a></li>
            <li><a class="link" href="#hands-on">The table</a></li>
            <li><a class="link" href="#your-way">Rooms and bots</a></li>
            <li><a class="link" href="#compete">Compete</a></li>
            <li><a class="link" href="#faq">FAQ</a></li>
          </ul>
        </div>

        <div class="foot-col">
          <h2 class="foot-head">Account</h2>
          <ul>
            <li v-if="!signedIn">
              <button type="button" class="link" @click="emit('auth', 'login')">Log in</button>
            </li>
            <li v-if="signedIn">
              <button type="button" class="link" @click="emit('settings')">Settings</button>
            </li>
          </ul>
        </div>
      </nav>
    </div>

    <div class="foot-bar">
      <p>© {{ year }} CCPoker</p>
      <p class="foot-note">In development. Chips only. No real money.</p>
    </div>
  </footer>
</template>
