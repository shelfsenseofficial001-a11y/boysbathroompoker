<script setup>
// The bar every page screen wears: a brand on the left, everything about you
// on the right, and nothing else.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import UserMenu from './UserMenu.vue';
import MobileNav from './MobileNav.vue';

defineProps({
  user: { type: Object, default: null },
  menuGroups: { type: Array, default: () => [] },
  // A guest is playing on an account they never asked for, so the way to
  // keep it is offered here rather than hidden in a menu. Somebody already
  // signed in has nothing to do with these.
  showAuth: { type: Boolean, default: false },
  // The session has not resolved yet. The bar is drawn anyway - it is the
  // shell, and the shell does not wait - but its right-hand side holds a
  // placeholder of the same size rather than guessing. Guessing wrong means
  // signed-out buttons flashing at somebody who is signed in, and the bar
  // changing width underneath them when the answer arrives.
  loading: { type: Boolean, default: false },
  // Where this page can send people, as [{ href, label }]. Empty on screens
  // that have nowhere to go - the lobby is one page, and a bar of links to
  // itself is furniture. The landing page has sections worth reaching.
  links: { type: Array, default: () => [] },
});
const emit = defineEmits(['pick', 'renamed', 'auth', 'home', 'guest']);

// The drawer, below the breakpoint. Closed again by anything that counts as
// having arrived somewhere: a link, a button, the backdrop, Escape, or the
// window growing past the width that needed it in the first place.
const menuOpen = ref(false);

function onResize() {
  if (window.innerWidth >= 860) menuOpen.value = false;
}
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

// The mark is a real link to "/" so it behaves like one: keyboard reachable,
// focusable, and openable in a new tab with ctrl/cmd or the middle button.
// The plain left click is handled in the app instead of followed, because
// following it would reload the whole page - this app has no router, it has
// a view, and a reload would re-run boot and the session check to arrive at
// the screen it was already able to show.
function onBrandClick(e) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  emit('home');
}
</script>

<template>
  <header class="topbar topbar-page">
    <!-- A link, because a brand in a bar is the way back to the front page
         and people try it whether or not it is one. The label covers the
         width where the wordmark is hidden and the mark alone is left. -->
    <a class="brand" href="/" aria-label="CCPoker home" @click="onBrandClick">
      <SvgIcon name="logo" />
      <span class="brand-name">CC<em>Poker</em></span>
    </a>
    <!-- Between the mark and the account: what this page actually contains.
         Hidden on a phone, where the bar has room for the logo and one
         control and nothing else - the same sections are a scroll away, and
         the footer lists them. -->
    <nav v-if="links.length" class="topbar-nav" aria-label="Sections">
      <a v-for="link in links" :key="link.href" class="topbar-link" :href="link.href">
        {{ link.label }}
      </a>
    </nav>

    <!-- Below the breakpoint the bar is the mark and this, and the drawer
         carries everything else. -->
    <button
      type="button"
      class="topbar-burger"
      :aria-label="menuOpen ? 'Close menu' : 'Open menu'"
      :aria-expanded="String(menuOpen)"
      aria-controls="mobile-nav"
      @click="menuOpen = !menuOpen"
    >
      <span class="burger-bars" :class="{ 'is-x': menuOpen }" aria-hidden="true"><i /><i /><i /></span>
    </button>

    <MobileNav
      :open="menuOpen"
      :user="user"
      :links="links"
      :loading="loading"
      @close="menuOpen = false"
      @auth="emit('auth', $event)"
      @guest="emit('guest')"
      @pick="emit('pick', $event)"
      @home="emit('home')"
    />

    <div class="topbar-user">
      <span v-if="loading" class="topbar-wait" aria-hidden="true">
        <span class="sk sk-pill" />
      </span>
      <div v-else-if="showAuth" class="topbar-auth">
        <BaseButton variant="ghost" size="sm" @click="$emit('auth', 'login')">Log in</BaseButton>
        <BaseButton variant="primary" size="sm" @click="$emit('auth', 'signup')">Sign up</BaseButton>
      </div>
      <UserMenu
        v-if="user && !loading"
        :user="user"
        :groups="menuGroups"
        @pick="$emit('pick', $event)"
        @renamed="$emit('renamed', $event)"
      />
    </div>
  </header>
</template>
