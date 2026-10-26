<script setup>
// Joining by code. A private room's code only gets you to the door; the host
// answers it, and until they do this panel is the waiting.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { emitAck, getSocket } from '../../lib/socket.js';
import { flagInvalid } from '../../lib/invalid.js';
import { grouped } from '../../lib/format.js';
import BaseButton from '../ui/BaseButton.vue';

const emit = defineEmits(['entered', 'fail']);

const code = ref('');
const knocking = ref(false);
const codeInput = ref(null);

const entryNotice = (res) =>
  res.waiting ? `Joining with ${grouped(res.chips)} chips — you'll be dealt in next hand.` : null;

// `fromList` says the code came off the open-tables list, which is the
// server's own: only a code typed into the box can be wrong, so only that
// marks the box.
async function join(value, fromList = false) {
  const wanted = (value ?? code.value).trim().toUpperCase();
  if (!wanted) {
    if (!fromList) flagInvalid(codeInput.value, { focus: true });
    return emit('fail', 'Enter a room code.');
  }
  // Letters and digits both: the server builds a code out of an alphabet
  // that drops the ambiguous characters but keeps 2-9, so a letters-only
  // test turned away most real codes before they ever reached it.
  if (!fromList && !/^[A-Z0-9]{5}$/.test(wanted)) {
    flagInvalid(codeInput.value, { focus: true });
    return emit('fail', 'A room code is five letters and numbers.');
  }
  try {
    // No buy-in is sent: the host sets every player's stack, in the waiting
    // room or - for someone arriving mid-game - from their late-join figure.
    const res = await emitAck('joinRoom', { code: wanted, fromList });
    if (res.knocking) {
      knocking.value = true;
      return;
    }
    emit('entered', { code: res.code, notice: entryNotice(res) });
  } catch (err) {
    if (!fromList) flagInvalid(codeInput.value);
    emit('fail', err.message);
  }
}

// The host has answered: either we're in, or we're not.
function onKnockAnswered(res) {
  knocking.value = false;
  if (res?.ok) return emit('entered', { code: res.code, notice: entryNotice(res) });
  emit('fail', res?.error || 'The host didn’t let you in.');
}

function cancelKnock() {
  knocking.value = false;
  emitAck('cancelKnock').catch(() => {});
}

const socket = getSocket();
onMounted(() => socket.on('knockAnswered', onKnockAnswered));
onBeforeUnmount(() => socket.off('knockAnswered', onKnockAnswered));

defineExpose({ join });
</script>

<template>
  <section class="panel" data-enter>
    <h2 class="h2">Join a game</h2>
    <p class="help-text">Enter the 5-character code your host shared. They set everyone's chips.</p>
    <div class="field-row">
      <div class="field">
        <label for="join-code">Room code</label>
        <input
          id="join-code"
          ref="codeInput"
          v-model="code"
          type="text"
          maxlength="5"
          autocomplete="off"
          placeholder="AB2DE"
          class="uppercase font-bold tracking-[.2em]"
          @keydown.enter="join()"
        />
      </div>
    </div>
    <BaseButton size="lg" :disabled="knocking" @click="join()">Join room</BaseButton>
    <div class="knock-wait" :hidden="!knocking">
      <span>Waiting for the host to let you in<span class="dots" /></span>
      <BaseButton variant="ghost" size="sm" @click="cancelKnock">Cancel</BaseButton>
    </div>
  </section>
</template>
