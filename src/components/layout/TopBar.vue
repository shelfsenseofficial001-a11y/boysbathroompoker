<script setup>
// The bar every page screen wears: a brand on the left, everything about you
// on the right, and nothing else.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import UserMenu from './UserMenu.vue';
import MobileNav from './MobileNav.vue';

const props = defineProps({
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
  // Where the app can send people, as [{ id, label, href?, section? }]. The
  // same list on every page the shell draws: a bar whose contents change
  // under you as you move around is a bar you have to re-read each time.
  links: { type: Array, default: () => [] },
  // Which link is the page being read: 'home', 'lobby', or '' for a page
  // that is in none of them. The section links are not named here - they are
  // lit by what is on screen, which this works out for itself below.
  active: { type: String, default: '' },
});
const emit = defineEmits(['pick', 'renamed', 'auth', 'home', 'guest', 'nav']);

// Which part of the landing page is under the reader. Watched only while
// that page is the one being shown: everywhere else the sections do not
// exist, and a section link pointing at a page you are not on is not the
// page you are on.
const inView = ref('');

let spy = null;
let retry = 0;

// Which section is being read: the last one whose top has reached the bar.
//
// Worked out from the rects rather than from which one is intersecting a
// band across the middle, which is what this did first and got wrong. A
// short section jumped to from the bar sits entirely above that band, so the
// band was over the *next* section and lit it instead - clicking "How it
// works" lit "Features". The question is not "what is in the middle of the
// window", it is "what have I scrolled to", and that is the last top to have
// passed under the bar.
function readSection() {
  const bar = document.querySelector('.topbar')?.getBoundingClientRect().height || 56;
  const line = bar + 20;
  let found = '';
  for (const link of props.links) {
    if (!link.section) continue;
    const el = document.getElementById(link.section);
    if (!el) continue;
    const { top, bottom } = el.getBoundingClientRect();
    // Reached, and not yet scrolled past.
    if (top <= line && bottom > line) found = link.section;
  }
  inView.value = found;
}

function watchSections() {
  spy?.disconnect();
  spy = null;
  inView.value = '';
  cancelAnimationFrame(retry);
  window.removeEventListener('scroll', readSection);
  if (props.active !== 'home') return;
  const sections = props.links
    .filter((l) => l.section)
    .map((l) => document.getElementById(l.section))
    .filter(Boolean);
  // The bar is painted before the page under it, and it outlives every page
  // it sits over - so the sections it is asked about are routinely not there
  // yet when it goes looking. Rather than guess at the right moment, it
  // looks again on the next frame until they are.
  if (!sections.length) {
    retry = requestAnimationFrame(watchSections);
    return;
  }

  // The scroll listener is the one that matters; the observer is here to
  // catch the cases a scroll event does not describe - a section growing or
  // collapsing under a reader who has not moved.
  window.addEventListener('scroll', readSection, { passive: true });
  if (window.IntersectionObserver) {
    spy = new IntersectionObserver(readSection);
    for (const section of sections) spy.observe(section);
  }
  readSection();
}

const isActive = (link) => {
  if (link.section) return props.active === 'home' && inView.value === link.section;
  // Home gives the light up to whichever section is being read. Two lit at
  // once would be two answers to "where am I", and the section is the more
  // precise of them.
  if (link.id === 'home') return props.active === 'home' && !inView.value;
  return props.active === link.id;
};

// A plain anchor on the landing page: the browser's own smooth scroll is
// already the behaviour wanted, and already flattened under reduced motion.
// Anywhere else the section does not exist yet, so the app is asked to go
// there first.
function onLink(link, event) {
  if (link.section && props.active === 'home') return;
  event.preventDefault();
  emit('nav', link);
}

// `immediate` because the bar mounts before any page does, and watching
// `active` alone because the link list is a constant - a getter returning
// both never re-ran on boot -> home, where the view changes but neither
// value does, which is how this came to watch nothing at all.
watch(() => props.active, watchSections, { immediate: true, flush: 'post' });
onBeforeUnmount(() => {
  cancelAnimationFrame(retry);
  window.removeEventListener('scroll', readSection);
  spy?.disconnect();
});

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
    <nav v-if="links.length" class="topbar-nav" aria-label="Pages">
      <!-- Two shapes, one look. Anything with an address is a real link, so
           it can be middle-clicked and opened in a tab; the lobby has no
           address, so it is a button rather than a link that lies about
           where it goes. -->
      <template v-for="link in links" :key="link.id">
        <a
          v-if="link.href"
          class="topbar-link"
          :class="{ 'is-on': isActive(link) }"
          :href="link.href"
          :aria-current="isActive(link) ? 'page' : undefined"
          @click="onLink(link, $event)"
        >
          {{ link.label }}
        </a>
        <button
          v-else
          type="button"
          class="topbar-link"
          :class="{ 'is-on': isActive(link) }"
          :aria-current="isActive(link) ? 'page' : undefined"
          @click="emit('nav', link)"
        >
          {{ link.label }}
        </button>
        <!-- Decoration between two groups of links, so it is hidden from a
             screen reader, which hears the grouping from the order. -->
        <span v-if="link.endsGroup" class="topbar-sep" aria-hidden="true" />
      </template>
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
      :active="active"
      :loading="loading"
      @close="menuOpen = false"
      @auth="emit('auth', $event)"
      @guest="emit('guest')"
      @pick="emit('pick', $event)"
      @nav="emit('nav', $event)"
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
