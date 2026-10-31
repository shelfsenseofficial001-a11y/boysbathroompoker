<script setup>
// The friends list: who you know, who's on, and who has asked.
//
// A column beside the lobby on a wide screen and a page of its own behind the
// bottom tray on a narrow one - the same component either way. Requests sit
// above the list because they are the one thing on it waiting for you.
//
// The list itself is kept by useFriends, which the app shell starts on sign
// in; this only draws it.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { useFriends } from '../../composables/useFriends.js';
import { openChatWith } from '../../composables/useChat.js';
import { lastSeenLabel } from '../../../shared/lastSeen.mjs';
import { previewLine } from '../../../shared/chatThread.mjs';
import { openConversation, clearConversation } from '../../lib/chat.js';
import { blockUser } from '../../lib/friends.js';
import { showToast } from '../../lib/toast.js';
import BaseButton from '../ui/BaseButton.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import SvgIcon from '../ui/SvgIcon.vue';
import FriendAvatar from './FriendAvatar.vue';

const emit = defineEmits(['profile', 'auth']);

// A friend pressed: open the chat with them. Their name and face carry over,
// so the window has a header before a single message has loaded.
function openChat(f) {
  openChatWith(f);
}

const auth = useAuth();
const { friends, requests, available, loaded, accept, decline, refresh } = useFriends();

// The ⋯ on a row, and the question it opens. Blocking somebody or erasing a
// conversation asks first, in the middle of the screen - a second press on a
// menu item is too easy to do by accident for either of those.
const rowMenu = ref(null);
// { kind: 'clear' | 'block', friend } while the dialog is up.
const asking = ref(null);
const working = ref(false);

function closeRowMenu() {
  rowMenu.value = null;
}

function ask(kind, friend) {
  rowMenu.value = null;
  asking.value = { kind, friend };
}

// What each question says. The wording is the point: clearing is yours alone
// and blocking is not, so neither is left to be guessed at.
const QUESTIONS = {
  clear: (name) => ({
    title: 'Delete messages?',
    body: `This clears your copy of the chat with ${name}. They keep theirs, and either of you can still write.`,
    confirmLabel: 'Delete',
  }),
  block: (name) => ({
    title: `Block ${name}?`,
    body: `${name} won't be able to message you or send you invites, and they'll drop off your friends list. They aren't told.`,
    confirmLabel: 'Block',
  }),
};
const question = computed(() => {
  const at = asking.value;
  return at ? QUESTIONS[at.kind](at.friend.name) : null;
});

async function confirmAsked() {
  const at = asking.value;
  if (!at || working.value) return;
  working.value = true;
  try {
    if (at.kind === 'clear') {
      const id = await openConversation(at.friend.id);
      await clearConversation(id);
      showToast(`Messages with ${at.friend.name} cleared for you.`, { info: true });
    } else {
      await blockUser(at.friend.id);
      showToast(`${at.friend.name} blocked.`, { info: true });
    }
    asking.value = null;
    refresh();
  } catch (err) {
    showToast(err.message);
    asking.value = null;
  } finally {
    working.value = false;
  }
}

// The line under each name: the last thing said, whoever said it. Falls back
// to whether they are about, which is what the row showed before there was
// anything to quote.
function subtitle(f) {
  const line = previewLine(f.last, auth.userId.value);
  return line || (f.online ? 'Online' : lastSeenLabel(f.secsAgo));
}
// Green says "here", so only the line that is actually saying that wears it.
// A message preview is not a status, however recently it arrived.
const isStatus = (f) => !previewLine(f.last, auth.userId.value);

// A press anywhere off the menu closes it.
function onDocClick() {
  if (rowMenu.value !== null) closeRowMenu();
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

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
        <li
          v-for="f in friends"
          :key="f.id"
          class="friend-row"
          :class="{ 'is-online': f.online, 'is-unread': f.unread > 0 }"
        >
          <button type="button" class="friend-main" @click="openChat(f)">
            <FriendAvatar :username="f.username" :name="f.name" :url="f.avatar_url || ''" :online="f.online" />
            <span class="friend-text">
              <span class="friend-name">{{ f.name }}</span>
              <span class="friend-seen" :class="{ 'is-status': isStatus(f) }">{{ subtitle(f) }}</span>
            </span>
            <span v-if="f.unread" class="friend-unread" :aria-label="`${f.unread} unread`">{{ f.unread > 9 ? '9+' : f.unread }}</span>
          </button>

          <!-- What you can do with this friend without opening the chat. -->
          <span class="friend-more-wrap">
            <button
              type="button"
              class="friend-more"
              :aria-label="`More for ${f.name}`"
              :aria-expanded="rowMenu === f.id"
              @click.stop="rowMenu = rowMenu === f.id ? null : f.id"
            >
              <SvgIcon name="more" />
            </button>
            <div v-if="rowMenu === f.id" class="friend-row-menu" @click.stop>
              <button type="button" @click="ask('clear', f)">Delete messages</button>
              <button type="button" class="is-danger" @click="ask('block', f)">Block user</button>
            </div>
          </span>
        </li>
      </ul>
      <p v-else-if="!requests.length" class="friends-empty">
        No friends yet. Open a player's profile to add them.
      </p>
    </template>

    <ConfirmDialog
      v-if="question"
      :title="question.title"
      :body="question.body"
      :confirm-label="question.confirmLabel"
      :busy="working"
      danger
      @confirm="confirmAsked"
      @cancel="asking = null"
    />
  </aside>
</template>
