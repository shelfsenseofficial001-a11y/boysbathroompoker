<script setup>
// The friends list: who you know, who's on, and who has asked.
//
// A column beside the lobby on a wide screen and a page of its own behind the
// bottom tray on a narrow one - the same component either way. Requests sit
// above the list because they are the one thing on it waiting for you.
//
// The list itself is kept by useFriends, which the app shell starts on sign
// in; this only draws it.
import { computed } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { useFriends } from '../../composables/useFriends.js';
import { openChatWith } from '../../composables/useChat.js';
import { lastSeenLabel } from '../../../shared/lastSeen.mjs';
import { showToast } from '../../lib/toast.js';
import BaseButton from '../ui/BaseButton.vue';
import SvgIcon from '../ui/SvgIcon.vue';
import FriendAvatar from './FriendAvatar.vue';

const emit = defineEmits(['profile', 'auth']);

// A friend pressed: open the chat with them. Their name and face carry over,
// so the window has a header before a single message has loaded.
function openChat(f) {
  openChatWith(f);
}

const auth = useAuth();
const { friends, requests, available, loaded, accept, decline } = useFriends();

const guest = computed(() => !auth.hasAccount.value);
const onlineCount = computed(() => friends.value.filter((f) => f.online).length);

async function answer(fn, id) {
  try {
    await fn(id);
  } catch (err) {
    showToast(err.message);
  }
}
</script>

<template>
  <aside class="panel friends" aria-labelledby="friends-title">
    <header class="friends-head">
      <h2 id="friends-title" class="friends-title">Friends</h2>
      <span v-if="friends.length" class="friends-count">{{ onlineCount }} online</span>
    </header>

    <template v-if="guest">
      <p class="friends-empty">Create an account to add friends and see when they're on.</p>
      <BaseButton size="sm" variant="primary" @click="emit('auth', 'signup')">Sign up</BaseButton>
    </template>

    <p v-else-if="!loaded" class="friends-empty" aria-busy="true">Loading…</p>

    <p v-else-if="!available" class="friends-empty">Friends aren't switched on for this server yet.</p>

    <template v-else>
      <section v-if="requests.length" class="friends-requests" aria-labelledby="friends-req-title">
        <h3 id="friends-req-title" class="friends-sub">Requests</h3>
        <ul class="friends-list">
          <li v-for="r in requests" :key="r.id" class="friend-row is-request">
            <button type="button" class="friend-main" :title="`Open ${r.name}'s profile`" @click="emit('profile', r.username)">
              <FriendAvatar :username="r.username" :name="r.name" :url="r.avatar_url || ''" />
              <span class="friend-text">
                <span class="friend-name">{{ r.name }}</span>
                <span class="friend-seen">Wants to be friends</span>
              </span>
            </button>
            <span class="friend-answer">
              <BaseButton size="sm" icon variant="primary" :aria-label="`Accept ${r.name}`" :title="`Accept ${r.name}`" @click="answer(accept, r.id)">
                <SvgIcon name="check" />
              </BaseButton>
              <BaseButton size="sm" icon variant="ghost" :aria-label="`Decline ${r.name}`" :title="`Decline ${r.name}`" @click="answer(decline, r.id)">
                <SvgIcon name="close" />
              </BaseButton>
            </span>
          </li>
        </ul>
      </section>

      <ul v-if="friends.length" class="friends-list">
        <li v-for="f in friends" :key="f.id" class="friend-row" :class="{ 'is-online': f.online }">
          <button type="button" class="friend-main" @click="openChat(f)">
            <FriendAvatar :username="f.username" :name="f.name" :url="f.avatar_url || ''" :online="f.online" />
            <span class="friend-text">
              <span class="friend-name">{{ f.name }}</span>
              <span class="friend-seen">{{ f.online ? 'Online' : lastSeenLabel(f.secsAgo) }}</span>
            </span>
            <span v-if="f.unread" class="friend-unread" :aria-label="`${f.unread} unread`">{{ f.unread > 9 ? '9+' : f.unread }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="!requests.length" class="friends-empty">
        No friends yet. Open a player's profile to add them.
      </p>
    </template>
  </aside>
</template>
