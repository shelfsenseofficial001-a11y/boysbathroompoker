<script setup>
// Questions, answered - as an accordion, one open at a time.
//
// One at a time, rather than many, so the page does not grow by a screen
// every time somebody is curious, and because the answers are short enough
// that comparing two side by side is not something anybody needs to do.
// The first is open on arrival, so the section never looks like a closed
// list of headings with nothing visible.
import { ref } from 'vue';
import { FAQ, DEV_NOTICE } from './faq.mjs';

const open = ref(FAQ[0].id);
const headers = ref([]);

function toggle(id) {
  open.value = open.value === id ? null : id;
}

// Up and Down move between the questions themselves, Home and End jump to
// the ends - the keyboard pattern an accordion is expected to have.
function onKeys(e, index) {
  const last = FAQ.length - 1;
  const go = (i) => {
    e.preventDefault();
    headers.value[i]?.focus();
  };
  if (e.key === 'ArrowDown') return go(index === last ? 0 : index + 1);
  if (e.key === 'ArrowUp') return go(index === 0 ? last : index - 1);
  if (e.key === 'Home') return go(0);
  if (e.key === 'End') return go(last);
}
</script>

<template>
  <section id="faq" class="faq" aria-labelledby="faq-h">
    <div class="faq-intro">
      <p class="lp-eyebrow">FAQ</p>
      <h2 id="faq-h" class="lp-section-h">Questions, <mark class="lp-mark">answered.</mark></h2>
      <p class="lead">
        The short version of how the game works, what it costs (nothing) and what is still on its
        way.
      </p>
      <p class="faq-dev-note">{{ DEV_NOTICE }}</p>
    </div>

    <div class="faq-list">
      <div
        v-for="(item, i) in FAQ"
        :key="item.id"
        class="faq-item"
        :class="{ 'is-open': open === item.id, 'is-notice': item.notice }"
      >
        <h3 class="faq-q-wrap">
          <button
            :id="`faq-q-${item.id}`"
            :ref="(el) => (headers[i] = el)"
            type="button"
            class="faq-q"
            :aria-expanded="String(open === item.id)"
            :aria-controls="`faq-a-${item.id}`"
            @click="toggle(item.id)"
            @keydown="onKeys($event, i)"
          >
            <span>{{ item.q }}</span>
            <!-- A plus that turns into a cross. -->
            <span class="faq-toggle" aria-hidden="true"><i /><i /></span>
          </button>
        </h3>
        <div
          :id="`faq-a-${item.id}`"
          class="faq-a"
          role="region"
          :aria-labelledby="`faq-q-${item.id}`"
          :hidden="open !== item.id"
        >
          <p>{{ item.a }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
