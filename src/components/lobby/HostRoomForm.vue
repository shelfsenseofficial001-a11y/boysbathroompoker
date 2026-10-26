<script setup>
// Hosting a table: your own starting chips, the blinds, and whether the room
// is listed. The host sets every other player's chips in the waiting room.
import { ref, computed, watch } from 'vue';
import { emitAck } from '../../lib/socket.js';
import { BB_PER_STACK } from '../../lib/stepper.js';
import NumberField from '../ui/NumberField.vue';
import BaseButton from '../ui/BaseButton.vue';

const emit = defineEmits(['entered', 'fail']);

const buyIn = ref(1000);
const smallBlind = ref(5);
const bigBlind = ref(10);
const isPrivate = ref(false);
const creating = ref(false);

const sbField = ref(null);
const bbField = ref(null);
const buyInField = ref(null);

// A stake follows the stack it is played for: a hundred big blinds deep is
// the depth a cash game is built around, so the starting chips pick the
// blinds on their own. The moment the host types a figure of their own the
// pair is theirs, and the stack stops touching it until they ask for auto
// back.
const manualBlinds = ref(false);

watch(buyIn, (stack) => {
  if (manualBlinds.value) return;
  const s = Number(stack);
  if (!Number.isFinite(s) || s <= 0) return;
  // Both figures are written before either is read back, so nothing ever
  // sees the new big blind against the old small one.
  const bb = Math.max(2, Math.round(s / BB_PER_STACK));
  const sb = Math.max(1, Math.min(Math.round(bb / 2), bb - 1));
  bigBlind.value = bb;
  smallBlind.value = sb;
  bbField.value?.set(bb);
  sbField.value?.set(sb);
});

// The two blinds are one setting in two boxes: a big blind at or under the
// small blind isn't a stake anyone can post, and the server refuses the pair
// outright. Rather than let a host assemble a rejected pair and then read a
// complaint about it, whichever box they didn't just touch follows the one
// they did. On `change` rather than while typing, so 5 on its way to 50
// doesn't drag the other one with it.
function balanceFrom(edited) {
  manualBlinds.value = true;
  const sb = smallBlind.value;
  const bb = bigBlind.value;
  if (sb === null || bb === null || bb > sb) return;
  if (edited === 'sb') {
    const next = sb * 2;
    bigBlind.value = next;
    bbField.value?.set(next);
    return;
  }
  // They lowered the big blind under the small one: halve the small blind to
  // match, never below its own floor.
  const next = Math.max(1, Math.floor(bb / 2));
  smallBlind.value = next;
  sbField.value?.set(next);
}

function backToAuto() {
  manualBlinds.value = false;
  const stack = buyIn.value;
  buyIn.value = null;
  buyIn.value = stack; // re-runs the watcher above
}

const canSubmit = computed(() => !creating.value);

async function create() {
  // Read the three figures back before anything is sent: a field that can't
  // be read says so on itself, and the room isn't created on a guess.
  if (smallBlind.value === null) {
    sbField.value?.flag();
    return emit('fail', 'The small blind has to be a whole number.');
  }
  if (bigBlind.value === null) {
    bbField.value?.flag();
    return emit('fail', 'The big blind has to be a whole number.');
  }
  if (bigBlind.value <= smallBlind.value) {
    bbField.value?.flag();
    return emit('fail', 'The big blind has to be larger than the small blind.');
  }
  if (buyIn.value === null) {
    buyInField.value?.flag();
    return emit('fail', 'Your starting chips have to be a whole number.');
  }
  // A blind at or over the starting stack isn't a stake, it's an all-in
  // before a card is dealt.
  if (bigBlind.value >= buyIn.value) {
    bbField.value?.flag();
    return emit('fail', 'The big blind has to be smaller than the starting chips.');
  }

  creating.value = true;
  try {
    const res = await emitAck('createRoom', {
      smallBlind: smallBlind.value,
      bigBlind: bigBlind.value,
      buyIn: buyIn.value,
      isPrivate: isPrivate.value,
    });
    emit('entered', { code: res.code });
  } catch (err) {
    emit('fail', err.message);
    creating.value = false;
  }
}
</script>

<template>
  <section class="panel" data-enter>
    <h2 class="h2">Host a game</h2>
    <p class="help-text">You’ll set every player’s starting chips in the waiting room.</p>
    <div class="field-row">
      <div class="field">
        <label for="buyin-host">Your starting chips</label>
        <NumberField
          id="buyin-host"
          ref="buyInField"
          v-model="buyIn"
          label="your starting chips"
          :min="1"
          :step="100"
        />
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="sb">Small blind</label>
        <NumberField
          id="sb"
          ref="sbField"
          v-model="smallBlind"
          label="small blind"
          :min="1"
          :step="1"
          @change="balanceFrom('sb')"
        />
      </div>
      <div class="field">
        <label for="bb">Big blind</label>
        <NumberField
          id="bb"
          ref="bbField"
          v-model="bigBlind"
          label="big blind"
          :min="2"
          :step="2"
          @change="balanceFrom('bb')"
        />
      </div>
    </div>
    <div class="auto-blinds-row">
      <button v-if="manualBlinds" type="button" class="auto-blinds" @click="backToAuto">
        Reset blinds to auto
      </button>
    </div>
    <label class="switch-row">
      <input v-model="isPrivate" type="checkbox" />
      <span>Private room — hidden from open tables, and you let each player in</span>
    </label>
    <BaseButton variant="primary" size="lg" :disabled="!canSubmit" @click="create">
      Create room
    </BaseButton>
  </section>
</template>
