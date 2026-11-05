<script setup>
// A game against the house, in one press.
//
// The four opponents are the ones the server already plays: beginner through
// expert, each with the same name and the same description the table's own
// bot picker uses. Nothing new is taught here - picking one makes a private
// room, seats that many of them, and starts the hand, so what arrives is an
// ordinary table that happens to have nobody human at it.
//
// Below them sits what is not built: opponents somebody could shape
// themselves, the way a chess site lets you pick a bot by face and rating.
// It is drawn rather than described, because a locked row of the real thing
// says what is coming far better than a sentence promising it.
import { ref, computed, onMounted } from 'vue';
import { emitAck } from '../../lib/socket.js';
import { playEntrance } from '../../lib/motion.js';
import BaseButton from '../ui/BaseButton.vue';
import SvgIcon from '../ui/SvgIcon.vue';

const emit = defineEmits(['entered', 'back', 'fail']);

// Same four, same words as the picker at the table.
const LEVELS = [
  {
    id: 'beginner',
    label: 'Beginner',
    desc: 'Calls almost anything, never bluffs',
    long: 'Sits in every pot and pays you off when you have it. The one to learn the buttons against.',
  },
  {
    id: 'casual',
    label: 'Casual',
    desc: 'Folds weak hands, raises strong ones',
    long: 'Plays the hand in front of it and little else. Straightforward, and beatable by paying attention.',
  },
  {
    id: 'solid',
    label: 'Solid',
    desc: 'Picky, bets for value, hard to bluff',
    long: 'Waits for a reason, then bets like it means it. Will not hand you a pot you did not earn.',
  },
  {
    id: 'expert',
    label: 'Expert',
    desc: 'Counts the odds, bluffs and traps',
    long: 'Prices its calls, bluffs when the board lets it, and slow-plays the hands that want you betting.',
  },
];

// What a locked opponent would look like. Faces are initials rather than
// pictures: inventing a portrait for something that does not exist yet is
// a promise about the wrong detail.
const CUSTOM = [
  { name: 'Marcy', rating: 800, trait: 'Loose, calls too much' },
  { name: 'Dex', rating: 1400, trait: 'Tight, punishes limps' },
  { name: 'Iris', rating: 1900, trait: 'Bluffs rivers relentlessly' },
  { name: 'Hollis', rating: 2400, trait: 'Balanced, almost unreadable' },
];

const level = ref('casual');
const opponents = ref(1);
const starting = ref(false);
const screen = ref(null);

const MAX = 8;
const chosen = computed(() => LEVELS.find((l) => l.id === level.value) || LEVELS[1]);
const setCount = (n) => {
  opponents.value = Math.max(1, Math.min(MAX, n));
};

// Private, because it is not a table anybody else is meant to find; the
// stakes are the lobby's own defaults, since there is nothing to agree with
// anybody about. Then the opponents, then the first hand.
async function start() {
  if (starting.value) return;
  starting.value = true;
  try {
    const room = await emitAck('createRoom', {
      smallBlind: 5,
      bigBlind: 10,
      buyIn: 1000,
      isPrivate: true,
    });
    for (let i = 0; i < opponents.value; i += 1) {
      await emitAck('addBot', { level: level.value });
    }
    await emitAck('startGame');
    emit('entered', { code: room.code, notice: null });
  } catch (err) {
    emit('fail', err.message || 'That table would not open. Try again.');
  } finally {
    starting.value = false;
  }
}

onMounted(() => playEntrance(screen.value));
</script>

<template>
  <main ref="screen" class="page page-ai">
    <div class="settings-head">
      <BaseButton variant="ghost" icon class="settings-back" aria-label="Back" title="Back" @click="emit('back')">
        <SvgIcon name="arrowLeft" />
      </BaseButton>
      <h1 class="h1">Play with AI</h1>
    </div>

    <section class="panel" data-enter>
      <h2 class="h2">Pick an opponent</h2>
      <p class="help-text">
        Blinds of 5/10 and a thousand chips each. The table is private, so nobody will wander into
        it.
      </p>

      <div class="ai-levels" role="radiogroup" aria-label="How your opponents play">
        <button
          v-for="l in LEVELS"
          :key="l.id"
          type="button"
          class="ai-level"
          :class="[`lvl-${l.id}`, { 'is-on': level === l.id }]"
          role="radio"
          :aria-checked="String(level === l.id)"
          @click="level = l.id"
        >
          <span class="ai-level-top">
            <span class="dot" aria-hidden="true"></span>
            <b>{{ l.label }}</b>
          </span>
          <em>{{ l.desc }}</em>
        </button>
      </div>

      <p class="ai-long">{{ chosen.long }}</p>

      <div class="field">
        <label>How many of them</label>
        <div class="create-count">
          <button
            type="button"
            class="create-step"
            aria-label="One fewer opponent"
            :disabled="opponents <= 1"
            @click="setCount(opponents - 1)"
          >
            −
          </button>
          <b class="create-count-n">{{ opponents }}</b>
          <button
            type="button"
            class="create-step"
            aria-label="One more opponent"
            :disabled="opponents >= MAX"
            @click="setCount(opponents + 1)"
          >
            +
          </button>
          <span class="micro create-count-note">
            {{ opponents === 1 ? 'Heads-up' : `${opponents + 1} at the table` }}
          </span>
        </div>
      </div>

      <button type="button" class="play-cta ai-start" :disabled="starting" @click="start">
        {{ starting ? 'Dealing…' : 'Deal me in' }}
      </button>
    </section>

    <!-- Not built. Shown as what it will be, and not clickable: every
         control in here is inert, and the whole block is out of the tab
         order so a keyboard never lands inside something that does nothing. -->
    <section class="panel ai-soon" data-enter aria-label="Custom AI players, coming soon">
      <header class="ai-soon-head">
        <div>
          <h2 class="h2">Custom AI players</h2>
          <p class="help-text">
            Opponents you shape yourself — how loose they play, how often they bluff, how hard they
            are to read — saved and brought back to any table.
          </p>
        </div>
        <span class="ai-soon-tag"><SvgIcon name="lock" />Coming soon</span>
      </header>

      <div class="ai-bots" aria-hidden="true" inert>
        <article v-for="bot in CUSTOM" :key="bot.name" class="ai-bot">
          <span class="ai-bot-face">{{ bot.name.slice(0, 1) }}</span>
          <b class="ai-bot-name">{{ bot.name }}</b>
          <span class="ai-bot-rating">{{ bot.rating }}</span>
          <em class="ai-bot-trait">{{ bot.trait }}</em>
          <span class="ai-bot-lock"><SvgIcon name="lock" /></span>
        </article>
      </div>
    </section>
  </main>
</template>
