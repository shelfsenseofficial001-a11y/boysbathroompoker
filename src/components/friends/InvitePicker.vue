<script setup>
// Picking a friend to pull into the room.
//
// A sheet of your friends with a box to filter them by name. Online friends
// are pickable; offline ones are shown too but greyed, because somebody not
// here cannot answer an invite that expires with the table. Choosing one
// sends the invite as a chat message and says so.
//
// Opened from an empty seat at the table, or from the chat's menu. Either way
// it needs a room to invite to (useInvite.room); without one there is nothing
// to send.
import { ref, computed, onMounted } from 'vue';
import { useFriends } from '../../composables/useFriends.js';
import { useInvite, closeInvitePicker } from '../../composables/useInvite.js';
import { sendInvite } from '../../lib/chat.js';
import { showToast } from '../../lib/toast.js';
import BaseModal from '../ui/BaseModal.vue';
import FriendAvatar from './FriendAvatar.vue';

const { friends } = useFriends();
const { room } = useInvite();

const query = ref('');
const sendingTo = ref(null);
const search = ref(null);

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = q ? friends.value.filter((f) => f.name.toLowerCase().includes(q)) : friends.value;
  // Online first - they're the ones who can actually come.
  return list;
});

async function invite(friend) {
  if (!friend.online || sendingTo.value || !room.value) return;
  sendingTo.value = friend.id;
  try {
    await sendInvite(friend.id, {
      code: room.value.code,
      token: room.value.token || '',
      line: `Come play — join my table ${room.value.code}.`,
    });
    showToast(`Invite sent to ${friend.name}.`, { info: true });
    closeInvitePicker();
  } catch (err) {
    showToast(err.message);
  } finally {
    sendingTo.value = null;
  }
}

onMounted(() => search.value?.focus());
</script>

<template>
  <BaseModal title="Invite a friend" @close="closeInvitePicker">
    <div class="invite-pick">
      <input
        ref="search"
        v-model="query"
        type="search"
        class="invite-search"
        placeholder="Search friends"
        aria-label="Search friends"
      />

      <p v-if="!friends.length" class="invite-empty">
        You have no friends to invite yet. Add some from their profile.
      </p>
      <p v-else-if="!shown.length" class="invite-empty">No friend by that name.</p>

      <ul v-else class="invite-list">
        <li v-for="f in shown" :key="f.id">
          <button
            type="button"
            class="invite-row"
            :class="{ 'is-off': !f.online }"
            :disabled="!f.online || sendingTo === f.id"
            :title="f.online ? `Invite ${f.name}` : `${f.name} is offline`"
            @click="invite(f)"
          >
            <FriendAvatar :username="f.username" :name="f.name" :url="f.avatar_url || ''" :online="f.online" />
            <span class="invite-text">
              <span class="invite-name">{{ f.name }}</span>
              <span class="invite-state">{{ f.online ? 'Online' : 'Offline' }}</span>
            </span>
            <span class="invite-cta">{{ sendingTo === f.id ? 'Sending…' : (f.online ? 'Invite' : '') }}</span>
          </button>
        </li>
      </ul>
    </div>
  </BaseModal>
</template>
