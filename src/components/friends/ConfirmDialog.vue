<script setup>
// "Are you sure?", in the middle of the screen.
//
// The friends list and the chat each had a second press on the same menu
// item standing in for this, which is cheap and easy to do by accident -
// and blocking somebody or erasing a conversation is not something to find
// out you have done. Each of those now stops and says what will happen.
//
// Built on BaseModal, so it is centred, takes focus, traps Tab, and closes
// on Escape like every other dialog in the app.
import BaseModal from '../ui/BaseModal.vue';

defineProps({
  title: { type: String, required: true },
  // What it will actually do, in a sentence. Worth saying plainly: "clears
  // for you" and "clears for both of you" are different promises.
  body: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Confirm' },
  // The one that takes something away is red, and is still the first thing
  // under the question - the dialog is here because the player asked for it.
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['confirm', 'cancel']);
</script>

<template>
  <BaseModal @close="emit('cancel')">
    <h2 class="confirm-title">{{ title }}</h2>
    <p v-if="body" class="confirm-body">{{ body }}</p>
    <div class="confirm-acts">
      <button
        type="button"
        class="confirm-act"
        :class="{ 'is-danger': danger }"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ busy ? 'Working…' : confirmLabel }}
      </button>
      <button type="button" class="confirm-act" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </div>
  </BaseModal>
</template>
