<script setup>
// The bar's contents, on a screen too narrow to lay them out.
//
// Below the breakpoint the bar holds the mark and one button, and everything
// else - the page's sections, the way in, the way out - lives in here. It is
// a drawer rather than a dropdown because the auth block belongs at the
// bottom, under the thumb, and because the list is long enough to scroll on
// a phone held sideways.
//
// Teleported to <body> so it is not stacked inside the bar it opens from:
// the bar sits at z-index 50 and the auth sheet at 200, and this has to land
// cleanly between them whatever the bar's own stacking context is doing.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { avatarSVG } from '../../lib/svg/avatars.js';
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  user: { type: Object, default: null },
  links: { type: Array, default: () => [] },
  // Which link is the page being read. Section links are not lit in here:
  // the drawer closes the moment one is chosen, so there is never a moment
  // where it is open and a section is on screen behind it.
  active: { type: String, default: '' },
  loading: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'auth', 'guest', 'pick', 'home', 'nav']);

const auth = useAuth();
const panel = ref(null);
const closeBtn = ref(null);

const isGuest = computed(() => auth.isGuest.value);
const signedIn = computed(() => !!props.user || auth.signedIn.value);
const avatar = computed(() => (props.user ? avatarSVG(props.user.username) : ''));

// Anything chosen in here is a navigation, and a drawer left open over the
// thing you just asked for is a drawer in the way.
function choose(fn) {
  emit('close');
  fn();
}

// --- Focus, scroll and the rest of the page ------------------------------
// The page behind is made inert while this is open, so tab and a screen
// reader's virtual cursor both stay inside the drawer rather than wandering
// into a list nobody can see.
let restoreOverflow = '';
function setPageInert(on) {
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  if (on) shell.setAttribute('inert', '');
  else shell.removeAttribute('inert');
}

function onKeydown(e) {
  if (e.key === 'Escape') return emit('close');
  if (e.key !== 'Tab' || !panel.value) return;
  // The trap. Only the drawer's own controls are reachable, and tabbing off
  // either end comes back round rather than escaping into the inert page.
  const focusable = panel.value.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      restoreOverflow = document.body.style.overflow;
      // `scrollbar-gutter: stable` is already set on <html>, so taking the
      // scrollbar away costs no width and the page does not jump.
      document.body.style.overflow = 'hidden';
      setPageInert(true);
      document.addEventListener('keydown', onKeydown);
      await nextTick();
      closeBtn.value?.focus();
    } else {
      document.body.style.overflow = restoreOverflow;
      setPageInert(false);
      document.removeEventListener('keydown', onKeydown);
    }
  }
);

// A drawer that outlived its page would leave the body locked and the shell
// inert, with nothing left to unset either.
onBeforeUnmount(() => {
  document.body.style.overflow = restoreOverflow;
  setPageInert(false);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <!-- The drawer slides back out the way it came in. Vue is told the
         duration outright because the animations live on the panel and the
         backdrop rather than on the wrapper it is watching, so there is
         nothing on that wrapper for it to time itself from. -->
    <Transition name="drawer" :duration="220">
      <div v-if="open" class="mnav-wrap">
        <div class="mnav-backdrop" @click="emit('close')" />
        <aside
          ref="panel"
          id="mobile-nav"
          class="mnav"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <header class="mnav-head">
            <a class="brand" href="/" aria-label="CCPoker home" @click.prevent="choose(() => emit('home'))">
              <SvgIcon name="logo" /><span class="brand-name">CC<em>Poker</em></span>
            </a>
            <button ref="closeBtn" type="button" class="mnav-x" aria-label="Close menu" @click="emit('close')">
              <SvgIcon name="close" />
            </button>
          </header>

          <nav v-if="links.length" class="mnav-links" aria-label="Pages">
            <!-- The same list as the bar above the breakpoint, in the same
                 order. Anything with an address stays a real link; the lobby
                 has none and is a button. Either way the drawer closes behind
                 it, which is what `choose` is for. -->
            <template v-for="link in links" :key="link.id">
              <a
                v-if="link.href"
                class="mnav-link"
                :class="{ 'is-on': active === link.id }"
                :href="link.href"
                :aria-current="active === link.id ? 'page' : undefined"
                @click.prevent="choose(() => emit('nav', link))"
              >
                {{ link.label }}
              </a>
              <button
                v-else
                type="button"
                class="mnav-link"
                :class="{ 'is-on': active === link.id }"
                :aria-current="active === link.id ? 'page' : undefined"
                @click="choose(() => emit('nav', link))"
              >
                {{ link.label }}
              </button>
              <!-- The same break as the bar, drawn the way a drawer draws
                   one: a rule across it rather than a mark between. -->
              <span v-if="link.endsGroup" class="mnav-sep" aria-hidden="true" />
            </template>
          </nav>

          <!-- Pinned to the foot, where a thumb reaches. -->
          <div class="mnav-foot">
            <!-- The session has not resolved. Hold the space rather than guess
                 and have the block change shape underneath them. -->
            <template v-if="loading">
              <span class="sk sk-line" /><span class="sk sk-line sk-short" />
            </template>

            <template v-else-if="signedIn">
              <div class="mnav-who">
                <span v-if="avatar" class="contents" v-html="avatar" />
                <span class="mnav-name">{{ user?.username || auth.displayName.value }}</span>
              </div>
              <!-- A guest has an account they never asked for; keeping it is
                   the one thing worth offering them here. -->
              <BaseButton v-if="isGuest" variant="primary" size="lg" @click="choose(() => emit('auth', 'signup'))">
                Sign up
              </BaseButton>
              <BaseButton v-if="isGuest" size="lg" @click="choose(() => emit('auth', 'login'))">Log in</BaseButton>
              <!-- An account's own page. A guest has no profile, so they are
                 offered the way to get one instead - which is the Sign up
                 button already above this. -->
            <BaseButton v-if="!isGuest" size="lg" @click="choose(() => emit('pick', 'profile'))">
              Profile
            </BaseButton>
            <BaseButton size="lg" @click="choose(() => emit('pick', 'settings'))">Settings</BaseButton>
              <!-- The one thing in here that takes something away. A guest
                   loses the identity they have been playing under, which is
                   worth looking like a warning rather than like Settings. -->
              <BaseButton variant="danger" size="lg" @click="choose(() => emit('pick', 'logout'))">
                {{ auth.hasAccount.value ? 'Log out' : 'New guest' }}
              </BaseButton>
            </template>

            <template v-else>
              <BaseButton variant="primary" size="lg" @click="choose(() => emit('auth', 'signup'))">Sign up</BaseButton>
              <BaseButton size="lg" @click="choose(() => emit('auth', 'login'))">Log in</BaseButton>
              <BaseButton size="lg" @click="choose(() => emit('guest'))">
                <SvgIcon name="eye" />Play as guest
              </BaseButton>
            </template>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
