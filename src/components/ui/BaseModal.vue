<script setup>
// A dialog, using the sheet the table already puts its questions in
// (.overlay / .sheet in styles.css), so a question asked by the app looks
// like a question asked by the game.
//
// Teleported to the body: the overlay is fixed and full-screen, and leaving
// it inside a transformed ancestor would position it against that ancestor
// instead of the viewport.
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import SvgIcon from './SvgIcon.vue';

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  // A dialog the player may simply close. When false there is no close
  // button, and Escape and the backdrop emit `dismiss` for the caller to
  // answer however it likes - which is how the first-visit prompt turns
  // "go away" into a choice rather than a dead end.
  closable: { type: Boolean, default: true },
  labelledBy: { type: String, default: 'modal-title' },
});
const emit = defineEmits(['close', 'dismiss']);

const sheet = ref(null);
let returnFocusTo = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusable = () => [...(sheet.value?.querySelectorAll(FOCUSABLE) || [])].filter((el) => el.offsetParent !== null);

// Tab stays inside the dialog. Without this the player can tab out onto the
// page behind, which for a prompt they have to answer is a way to lose the
// cursor entirely.
function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    return props.closable ? emit('close') : emit('dismiss');
  }
  if (e.key !== 'Tab') return;
  const items = focusable();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !sheet.value.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function onBackdrop(e) {
  if (e.target !== e.currentTarget) return;
  return props.closable ? emit('close') : emit('dismiss');
}

onMounted(async () => {
  returnFocusTo = document.activeElement;
  document.addEventListener('keydown', onKeydown, true);
  await nextTick();
  focusable()[0]?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true);
  // Back where they were, so closing a dialog doesn't drop the cursor at the
  // top of the page.
  try {
    returnFocusTo?.focus();
  } catch {
    // The element it came from has gone; the browser's default will do.
  }
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @mousedown="onBackdrop">
      <div
        ref="sheet"
        class="sheet"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy"
      >
        <button
          v-if="closable"
          type="button"
          class="sheet-x"
          aria-label="Close"
          @click="emit('close')"
        >
          <SvgIcon name="close" />
        </button>
        <h2 v-if="title" :id="labelledBy" class="sheet-title">{{ title }}</h2>
        <p v-if="subtitle" class="sheet-sub">{{ subtitle }}</p>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
