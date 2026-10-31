<script setup>
// The friend button on somebody else's profile.
//
// One button that says where the two of you stand, and does the next thing
// from there: ask, take the ask back, say yes or no. Being friends already is
// a label rather than a control - unfriending and blocking live in the chat's
// menu, away from a button a stray press lands on.
//
// Drawn only for an account looking at another account. A guest has nobody
// to befriend and nobody can befriend a guest (migration 0007 refuses both),
// so for them there is simply nothing here.
import { ref, computed, watch, onMounted } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { friendshipWith, sendFriendRequest, acceptFriendRequest, removeFriend } from '../../lib/friends.js';
import { showToast } from '../../lib/toast.js';
import SvgIcon from '../ui/SvgIcon.vue';
import BaseButton from '../ui/BaseButton.vue';

const props = defineProps({
  // The profile's id, which is the other player's auth id.
  userId: { type: String, required: true },
});

const auth = useAuth();
// Null until known, and null for good when there is no answer - no account,
// or a server without the friends tables - which draws nothing at all.
const state = ref(null);
const busy = ref(false);

const me = computed(() => (auth.hasAccount.value ? auth.userId.value : null));

async function load() {
  state.value = null;
  if (!me.value || me.value === props.userId) return;
  try {
    state.value = await friendshipWith(me.value, props.userId);
  } catch {
    // A friendship that can't be read is not worth a red line on somebody's
    // profile. The button just isn't offered.
    state.value = null;
  }
}

async function run(action) {
  if (busy.value) return;
  busy.value = true;
  try {
    state.value = await action(props.userId);
  } catch (err) {
    showToast(err.message);
    // Whatever was refused, the row may have moved under us - they accepted,
    // they blocked - so read it again rather than trust the old label.
    await load();
  } finally {
    busy.value = false;
  }
}

onMounted(load);
watch([() => props.userId, me], load);
</script>

<template>
  <div v-if="state" class="friend-acts" :aria-busy="busy">
    <BaseButton
      v-if="state === 'none'"
      size="sm"
      variant="primary"
      :disabled="busy"
      @click="run(sendFriendRequest)"
    >
      <SvgIcon name="plus" />Add Friend
    </BaseButton>

    <template v-else-if="state === 'sent'">
      <BaseButton size="sm" disabled><SvgIcon name="clock" />Request Sent</BaseButton>
      <BaseButton size="sm" variant="ghost" :disabled="busy" @click="run(removeFriend)">Cancel</BaseButton>
    </template>

    <template v-else-if="state === 'received'">
      <BaseButton size="sm" variant="primary" :disabled="busy" @click="run(acceptFriendRequest)">
        <SvgIcon name="check" />Accept Request
      </BaseButton>
      <BaseButton size="sm" variant="ghost" :disabled="busy" @click="run(removeFriend)">Decline</BaseButton>
    </template>

    <BaseButton v-else-if="state === 'friends'" size="sm" disabled>
      <SvgIcon name="check" />Friends
    </BaseButton>

    <BaseButton v-else-if="state === 'blocked'" size="sm" disabled>Blocked</BaseButton>
  </div>
</template>
