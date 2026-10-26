<script setup>
// The moment between being one person and being nobody, given something to
// look at.
//
// Signing out used to be a reload: the page went white, came back, and the
// player was somewhere else with no account of how they got there. Signing in
// was the same journey in reverse. Neither was slow - they just happened
// without a sentence, which reads as a stutter rather than a transition.
//
// Three cards, gathered in or dealt out. It answers something the player just
// did and lasts exactly as long as the work behind it, which is the line this
// codebase draws between information and decoration (see lib/invalid.js).
// Under reduced motion the cards hold still and the words do the work.
defineProps({
  // 'out' gathers the cards up, 'in' deals them down.
  mode: { type: String, default: 'out' },
  label: { type: String, default: '' },
});
</script>

<template>
  <div class="auth-transit" :class="`is-${mode}`" role="status" aria-live="polite">
    <div class="auth-transit-cards" aria-hidden="true">
      <span class="transit-card" />
      <span class="transit-card" />
      <span class="transit-card" />
    </div>
    <p class="auth-transit-label">{{ label }}</p>
  </div>
</template>
