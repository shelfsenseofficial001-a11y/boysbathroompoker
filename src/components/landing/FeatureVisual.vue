<script setup>
// One small drawing per feature, so a visitor knows what a thing is before
// they have finished reading the sentence beside it.
//
// All of it is inline SVG against the existing tokens - no image files, no
// libraries, no fonts. Nothing here imports the table renderer: these are
// conceptual illustrations, deliberately not screenshots, and they never show
// data that could be mistaken for somebody's real game.
//
// Every one is `aria-hidden`. The meaning is in the heading and paragraph
// next to it, and a screen reader being read a description of a drawing that
// only restates the text is worse than silence.
//
// Motion runs only while the drawing is on screen, and not at all under
// reduced motion - where the end state is shown instead of the first frame,
// so a paused animation still reads as the thing it was describing.
import { ref, onMounted, onBeforeUnmount } from 'vue';

defineProps({
  id: { type: String, required: true },
});

const root = ref(null);
const live = ref(false);
let observer = null;

onMounted(() => {
  // No IntersectionObserver (or no layout yet): run the animations rather
  // than leave a page of still drawings. Failing open is the right way round
  // for something whose only cost is a few CSS transforms.
  if (typeof IntersectionObserver !== 'function') {
    live.value = true;
    return;
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      live.value = entry.isIntersecting;
    },
    { rootMargin: '80px' }
  );
  observer.observe(root.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="root" class="fviz" :class="{ 'is-live': live }" aria-hidden="true">
    <!-- Chips, and the fact that none of them is worth anything. -->
    <svg v-if="id === 'no-money'" viewBox="0 0 160 120" class="fviz-svg">
      <ellipse cx="80" cy="96" rx="46" ry="10" class="fv-shadow" />
      <g class="fv-stack">
        <ellipse v-for="n in 5" :key="n" cx="80" :cy="88 - (n - 1) * 11" rx="30" ry="9"
          class="fv-chip" :class="{ 'fv-chip-gold': n === 5 }" />
      </g>
      <g class="fv-nocash">
        <circle cx="80" cy="40" r="19" class="fv-ring" />
        <path d="M67 27 L93 53" class="fv-slash" />
        <text x="80" y="47" class="fv-glyph">$</text>
      </g>
    </svg>

    <!-- A stack reset to the table's starting figure, over and over. -->
    <svg v-else-if="id === 'fresh-chips'" viewBox="0 0 160 120" class="fviz-svg">
      <rect x="18" y="20" width="124" height="80" rx="12" class="fv-panel" />
      <text x="80" y="48" class="fv-label">EVERY TABLE</text>
      <g class="fv-refill">
        <ellipse v-for="n in 4" :key="n" cx="80" :cy="84 - (n - 1) * 9" rx="24" ry="7"
          class="fv-chip" :style="{ '--i': n - 1 }" />
      </g>
    </svg>

    <!-- A guest, and the record that is not being kept for them. -->
    <svg v-else-if="id === 'guest-play'" viewBox="0 0 160 120" class="fviz-svg">
      <circle cx="54" cy="52" r="24" class="fv-avatar" />
      <circle cx="54" cy="45" r="8" class="fv-avatar-head" />
      <path d="M38 68a16 16 0 0 1 32 0z" class="fv-avatar-head" />
      <rect x="28" y="84" width="52" height="18" rx="9" class="fv-tag" />
      <text x="54" y="96" class="fv-tag-text">GUEST</text>
      <g class="fv-faded">
        <rect x="96" y="40" width="10" height="26" rx="3" class="fv-bar" />
        <rect x="112" y="30" width="10" height="36" rx="3" class="fv-bar" />
        <rect x="128" y="48" width="10" height="18" rx="3" class="fv-bar" />
      </g>
    </svg>

    <!-- Two taps on the felt, and the word for what they do. -->
    <svg v-else-if="id === 'double-tap-check'" viewBox="0 0 160 120" class="fviz-svg">
      <rect x="14" y="18" width="132" height="84" rx="26" class="fv-felt" />
      <circle cx="80" cy="60" r="10" class="fv-tap-dot" />
      <circle cx="80" cy="60" r="10" class="fv-tap-ring fv-tap-1" />
      <circle cx="80" cy="60" r="10" class="fv-tap-ring fv-tap-2" />
      <rect x="54" y="86" width="52" height="18" rx="9" class="fv-pill" />
      <text x="80" y="98" class="fv-pill-text">CHECK</text>
    </svg>

    <!-- A hand thrown across the felt and into the muck. -->
    <svg v-else-if="id === 'drag-fold'" viewBox="0 0 160 120" class="fviz-svg">
      <rect x="14" y="18" width="132" height="84" rx="26" class="fv-felt" />
      <path d="M96 40 h34 a4 4 0 0 1 4 4 v30 a4 4 0 0 1 -4 4 h-34 z" class="fv-muck" />
      <g class="fv-toss">
        <rect x="24" y="52" width="22" height="32" rx="4" class="fv-card" transform="rotate(-8 35 68)" />
        <rect x="40" y="52" width="22" height="32" rx="4" class="fv-card" transform="rotate(6 51 68)" />
      </g>
    </svg>

    <!-- One chip off the stack and into the pot. -->
    <svg v-else-if="id === 'drag-chips'" viewBox="0 0 160 120" class="fviz-svg">
      <rect x="14" y="18" width="132" height="84" rx="26" class="fv-felt" />
      <ellipse cx="104" cy="52" rx="26" ry="9" class="fv-pot" />
      <text x="104" y="38" class="fv-label">POT</text>
      <g class="fv-stack-sm">
        <ellipse v-for="n in 3" :key="n" cx="38" :cy="86 - (n - 1) * 8" rx="17" ry="6" class="fv-chip" />
      </g>
      <ellipse cx="38" cy="62" rx="14" ry="5" class="fv-chip fv-chip-gold fv-fly" />
    </svg>

    <!-- Two doors: one open to anyone, one that wants the code. -->
    <svg v-else-if="id === 'rooms'" viewBox="0 0 160 120" class="fviz-svg">
      <rect x="10" y="26" width="64" height="68" rx="10" class="fv-panel" />
      <rect x="86" y="26" width="64" height="68" rx="10" class="fv-panel" />
      <text x="42" y="50" class="fv-label">PUBLIC</text>
      <text x="118" y="50" class="fv-label">PRIVATE</text>
      <g class="fv-open">
        <circle cx="42" cy="72" r="11" class="fv-ring" />
        <path d="M36 72h12" class="fv-slash" />
      </g>
      <g class="fv-lock">
        <rect x="110" y="68" width="16" height="13" rx="3" class="fv-lock-body" />
        <path d="M113 68v-4a5 5 0 0 1 10 0v4" class="fv-lock-shackle" />
      </g>
    </svg>

    <!-- A row of people, and room for one more. -->
    <svg v-else-if="id === 'friends'" viewBox="0 0 160 120" class="fviz-svg">
      <g v-for="n in 3" :key="n">
        <circle :cx="34 + (n - 1) * 30" cy="60" r="17" class="fv-avatar" />
        <circle :cx="34 + (n - 1) * 30" cy="54" r="6" class="fv-avatar-head" />
        <path :d="`M${22 + (n - 1) * 30} 71a12 12 0 0 1 24 0z`" class="fv-avatar-head" />
      </g>
      <circle cx="124" cy="60" r="17" class="fv-add" />
      <path d="M124 52v16M116 60h16" class="fv-add-plus" />
    </svg>

    <!-- The four levels, by the names the game actually uses. -->
    <svg v-else-if="id === 'bots'" viewBox="0 0 160 120" class="fviz-svg">
      <g v-for="(lvl, i) in ['Beginner', 'Casual', 'Solid', 'Expert']" :key="lvl">
        <rect :x="16 + i * 34" :y="86 - i * 18" width="24" :height="12 + i * 18" rx="4"
          class="fv-rung" :style="{ '--i': i }" />
      </g>
      <text x="28" y="112" class="fv-micro">BEG</text>
      <text x="130" y="112" class="fv-micro">EXP</text>
    </svg>

    <!-- A standings table with nobody in it: no invented names or numbers. -->
    <svg v-else-if="id === 'leaderboards'" viewBox="0 0 160 120" class="fviz-svg">
      <g v-for="n in 4" :key="n">
        <rect x="16" :y="20 + (n - 1) * 24" width="128" height="18" rx="6" class="fv-row" />
        <text x="26" :y="33 + (n - 1) * 24" class="fv-micro">{{ n }}</text>
        <circle cx="46" :cy="29 + (n - 1) * 24" r="6" class="fv-avatar-head" />
        <rect x="58" :y="26 + (n - 1) * 24" :width="70 - (n - 1) * 12" height="6" rx="3" class="fv-blank" />
      </g>
    </svg>
  </div>
</template>
