<script setup>
// The front of the Play page: the three things somebody can actually do,
// side by side, each one a card with a single button on it.
//
// They are numbered because they are not three equal choices - hosting is
// what most people are here for, joining is what you do when somebody else
// has already hosted, and the bots are there when nobody else is about. The
// numbers read as an order to try them in rather than a ranking.
import SvgIcon from '../ui/SvgIcon.vue';

const emit = defineEmits(['host', 'join', 'ai']);

const CHOICES = [
  {
    id: 'host',
    step: 'Step 1',
    icon: 'plusCircle',
    title: 'Host a Table',
    text: 'Set the blinds and the starting stack, then send the code to whoever you want at it.',
    cta: 'Create a table',
  },
  {
    id: 'join',
    step: 'Step 2',
    icon: 'chair',
    title: 'Join Table',
    text: 'Every public game running right now — the stakes, the stack, and whether a seat is free.',
    cta: 'Browse tables',
  },
  {
    id: 'ai',
    step: 'Step 3',
    icon: 'screen',
    title: 'Play with AI',
    text: 'Four house players, from one that calls anything to one that counts the odds against you.',
    cta: 'Pick an opponent',
  },
];
</script>

<template>
  <section class="play-choices" data-enter>
    <header class="play-choices-head">
      <h1 class="display">Pull up a chair.</h1>
      <p class="lead">
        Play-money Texas Hold’em. Chips are fake — strictly for bragging rights.
      </p>
    </header>

    <div class="play-cards">
      <article v-for="choice in CHOICES" :key="choice.id" class="play-card">
        <span class="play-step">{{ choice.step }}</span>
        <span class="play-card-icon" aria-hidden="true"><SvgIcon :name="choice.icon" /></span>
        <h2 class="play-card-title">{{ choice.title }}</h2>
        <p class="play-card-text">{{ choice.text }}</p>
        <button type="button" class="play-cta" @click="emit(choice.id)">
          {{ choice.cta }}
        </button>
      </article>
    </div>
  </section>
</template>
