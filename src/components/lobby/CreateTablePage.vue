<script setup>
// Making a table, on a page of its own.
//
// The stakes half of this is HostRoomForm, unchanged and unwrapped: the
// starting stack, the blinds that derive themselves from it, and the
// validation that keeps a small blind under its big one all live there and
// are not worth a second copy. What this page adds is who is at the table
// when you arrive - house players, and the friends worth asking.
//
// Both of those need a room to exist first, so they are choices made here
// and acted on the moment the room comes back: the bots are seated before
// the waiting room is drawn, and the invite picker opens on top of it.
import { ref, computed } from 'vue';
import { emitAck } from '../../lib/socket.js';
import { playEntrance } from '../../lib/motion.js';
import { onMounted } from 'vue';
import HostRoomForm from './HostRoomForm.vue';
import BaseButton from '../ui/BaseButton.vue';
import SvgIcon from '../ui/SvgIcon.vue';
import { useAuth } from '../../composables/useAuth.js';

const auth = useAuth();

const emit = defineEmits(['entered', 'back', 'fail']);

// The same four the table's own bot picker offers, named the same way. One
// list in two places would be two lists to keep level, so these read off
// the ids the server normalises; the labels match the picker's.
const LEVELS = [
  { id: 'beginner', label: 'Beginner', desc: 'Calls almost anything, never bluffs' },
  { id: 'casual', label: 'Casual', desc: 'Folds weak hands, raises strong ones' },
  { id: 'solid', label: 'Solid', desc: 'Picky, bets for value, hard to bluff' },
  { id: 'expert', label: 'Expert', desc: 'Counts the odds, bluffs and traps' },
];

// Nine seats, one of them yours.
const MAX_BOTS = 8;
const bots = ref(0);
const level = ref('casual');
// Only worth offering to somebody who has friends to ask - a guest has no
// list to open. The picker itself is the table's, opened over the waiting
// room once there is a room to invite anybody to.
const canInvite = computed(() => auth.hasAccount.value);
const inviteAfter = ref(false);

const screen = ref(null);
const working = ref(false);

const setBots = (n) => {
  bots.value = Math.max(0, Math.min(MAX_BOTS, n));
};

// The room exists. Seat whatever bots were asked for before handing the
// code up, so the waiting room is drawn once, with everybody already at it.
async function onCreated({ code }) {
  working.value = true;
  try {
    for (let i = 0; i < bots.value; i += 1) {
      // One at a time: each one needs the seat the last one took to be
      // taken, and the server counts the seats itself.
      await emitAck('addBot', { level: level.value });
    }
  } catch (err) {
    // The table is made and the player is in it; a bot that would not sit
    // down is worth saying out loud but not worth staying here for.
    emit('fail', err.message || 'The table is open, but a house player could not sit down.');
  } finally {
    working.value = false;
  }
  emit('entered', { code, notice: null, invite: inviteAfter.value && canInvite.value });
}

onMounted(() => playEntrance(screen.value));
</script>

<template>
  <main ref="screen" class="page page-create">
    <div class="settings-head">
      <BaseButton variant="ghost" icon class="settings-back" aria-label="Back" title="Back" @click="emit('back')">
        <SvgIcon name="arrowLeft" />
      </BaseButton>
      <h1 class="h1">Create a table</h1>
    </div>

    <div class="create-grid">
      <!-- The stakes, as the lobby has always asked for them. -->
      <HostRoomForm @entered="onCreated" @fail="emit('fail', $event)" />

      <section class="panel create-side" data-enter>
        <h2 class="h2">Who’s at it</h2>
        <p class="help-text">
          Seats fill as people arrive. House players sit down straight away, so there is a game
          whether anybody else turns up or not.
        </p>

        <div class="field">
          <label>House players</label>
          <div class="create-count">
            <button
              type="button"
              class="create-step"
              aria-label="One fewer house player"
              :disabled="bots === 0"
              @click="setBots(bots - 1)"
            >
              −
            </button>
            <b class="create-count-n">{{ bots }}</b>
            <button
              type="button"
              class="create-step"
              aria-label="One more house player"
              :disabled="bots >= MAX_BOTS"
              @click="setBots(bots + 1)"
            >
              +
            </button>
            <span class="micro create-count-note">
              {{ bots === 0 ? 'People only' : `${bots + 1} of 9 seats taken` }}
            </span>
          </div>
        </div>

        <div class="field" :hidden="bots === 0">
          <label>How they play</label>
          <div class="create-levels" role="radiogroup" aria-label="How the house players play">
            <button
              v-for="l in LEVELS"
              :key="l.id"
              type="button"
              class="create-level"
              :class="[`lvl-${l.id}`, { 'is-on': level === l.id }]"
              role="radio"
              :aria-checked="String(level === l.id)"
              @click="level = l.id"
            >
              <span class="dot" aria-hidden="true"></span>
              <b>{{ l.label }}</b>
              <em>{{ l.desc }}</em>
            </button>
          </div>
        </div>

        <label v-if="canInvite" class="switch-row">
          <input v-model="inviteAfter" type="checkbox" />
          <span>Ask friends to join as soon as the table is open</span>
        </label>
        <p v-else class="help-text create-guest-note">
          The room link is on the table itself — copy it and send it to anybody.
        </p>

        <p v-if="working" class="micro">Seating the house players…</p>
      </section>
    </div>
  </main>
</template>
