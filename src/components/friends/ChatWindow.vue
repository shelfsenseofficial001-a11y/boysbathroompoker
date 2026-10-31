<script setup>
// Talking to one friend, in a corner of the screen.
//
// Messenger's shape: a column of bubbles, mine on the right and theirs on the
// left with their face beside the last of a run, a centred time between
// bursts, and "Seen" under my latest once they've read it. The layout is
// worked out in shared/chatThread.mjs; this draws it and sends.
//
// Opened by the app shell (useChat), which keeps it alive as the player moves
// between the lobby, a profile and Settings. The 3-dot menu it carries comes
// in Phase 4.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useAuth } from '../../composables/useAuth.js';
import { closeChat, useChat } from '../../composables/useChat.js';
import {
  openConversation, loadMessages, sendMessage, markRead,
  watchConversation, PAGE_SIZE,
} from '../../lib/chat.js';
import { threadItems, chatTimeLabel, cleanMessage, MESSAGE_MAX } from '../../../shared/chatThread.mjs';
import { showToast } from '../../lib/toast.js';
import SvgIcon from '../ui/SvgIcon.vue';
import FriendAvatar from './FriendAvatar.vue';

const auth = useAuth();
const { friend, minimized } = useChat();

const me = computed(() => auth.userId.value);
const conversationId = ref(null);
const messages = ref([]);
const draft = ref('');
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const sending = ref(false);
const body = ref(null);
const input = ref(null);

let unwatch = null;

const items = computed(() => threadItems(messages.value, me.value));
// Line breaks kept, long single words still forced to wrap in CSS.
const atBottom = () => {
  const el = body.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 60;
};

async function scrollToEnd(smooth = false) {
  await nextTick();
  const el = body.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function mergeIn(row) {
  const i = messages.value.findIndex((m) => m.id === row.id);
  if (i === -1) messages.value.push(row);
  else messages.value[i] = row;
}

async function open(who) {
  unwatch?.();
  unwatch = null;
  conversationId.value = null;
  messages.value = [];
  hasMore.value = false;
  if (!who) return;
  loading.value = true;
  try {
    const id = await openConversation(who.id);
    // The friend was switched while this was in flight.
    if (friend.value?.id !== who.id) return;
    conversationId.value = id;
    const page = await loadMessages(id);
    messages.value = page;
    hasMore.value = page.length === PAGE_SIZE;
    unwatch = watchConversation(id, {
      onInsert(row) {
        const stick = atBottom();
        mergeIn(row);
        if (row.sender_id !== me.value) markRead(id);
        if (stick || row.sender_id === me.value) scrollToEnd(true);
      },
      onUpdate: mergeIn,
    });
    await scrollToEnd();
    await markRead(id);
  } catch (err) {
    showToast(err.message);
    closeChat();
  } finally {
    loading.value = false;
  }
}

async function loadOlder() {
  if (loadingMore.value || !hasMore.value || !conversationId.value) return;
  loadingMore.value = true;
  const el = body.value;
  const before = messages.value[0]?.id;
  const keep = el ? el.scrollHeight - el.scrollTop : 0;
  try {
    const page = await loadMessages(conversationId.value, { before });
    messages.value = [...page, ...messages.value];
    hasMore.value = page.length === PAGE_SIZE;
    await nextTick();
    if (el) el.scrollTop = el.scrollHeight - keep;
  } catch (err) {
    showToast(err.message);
  } finally {
    loadingMore.value = false;
  }
}

function onScroll() {
  if (body.value && body.value.scrollTop < 40) loadOlder();
}

async function send() {
  const content = cleanMessage(draft.value);
  if (!content || sending.value || !conversationId.value) return;
  sending.value = true;
  const id = conversationId.value;
  try {
    const row = await sendMessage(id, content);
    draft.value = '';
    mergeIn(row);
    await scrollToEnd(true);
    await nextTick();
    autosize();
    input.value?.focus();
  } catch (err) {
    showToast(err.message);
  } finally {
    sending.value = false;
  }
}

// Enter sends, Shift+Enter is a new line - the Messenger reflex.
function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

// The composer grows with what's typed, up to a few lines.
function autosize() {
  const el = input.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
}

watch(friend, (who) => {
  if (who && !minimized.value) open(who);
});

// Mounted with a friend already chosen - the window was put away for a table
// and is being drawn again. Pick the conversation back up.
onMounted(() => {
  if (friend.value && !minimized.value) open(friend.value);
});

// Reading as they come in while the window is open and in front.
function onVisible() {
  if (document.visibilityState === 'visible' && conversationId.value) markRead(conversationId.value);
}
document.addEventListener('visibilitychange', onVisible);

onBeforeUnmount(() => {
  unwatch?.();
  document.removeEventListener('visibilitychange', onVisible);
});

function toggleMin() {
  minimized.value = !minimized.value;
  if (!minimized.value) {
    if (conversationId.value) scrollToEnd();
    else if (friend.value) open(friend.value);
  }
}
</script>

<template>
  <section v-if="friend" class="chat" :class="{ 'is-min': minimized }" aria-label="Chat">
    <header class="chat-head">
      <button type="button" class="chat-who" @click="toggleMin" :aria-expanded="!minimized">
        <FriendAvatar :username="friend.username" :name="friend.name" :url="friend.avatar_url" />
        <span class="chat-name">{{ friend.name }}</span>
      </button>
      <div class="chat-head-acts">
        <button type="button" class="chat-icon" :aria-label="minimized ? 'Open chat' : 'Minimize chat'" @click="toggleMin">
          <SvgIcon :name="minimized ? 'chevron' : 'minus'" />
        </button>
        <button type="button" class="chat-icon" aria-label="Close chat" @click="closeChat">
          <SvgIcon name="close" />
        </button>
      </div>
    </header>

    <template v-if="!minimized">
      <div ref="body" class="chat-body" @scroll="onScroll">
        <p v-if="loading" class="chat-note" aria-busy="true">Loading…</p>
        <p v-else-if="loadingMore" class="chat-note" aria-busy="true">Loading earlier…</p>
        <p v-else-if="!messages.length" class="chat-note">
          Say hello to {{ friend.name }}.
        </p>

        <template v-for="it in items" :key="it.key">
          <div v-if="it.type === 'time'" class="chat-time">{{ chatTimeLabel(it.at) }}</div>
          <div
            v-else
            class="chat-line"
            :class="[it.mine ? 'is-mine' : 'is-theirs', { 'is-last': it.last }]"
          >
            <span class="chat-face">
              <FriendAvatar
                v-if="!it.mine && it.last"
                :username="friend.username"
                :name="friend.name"
                :url="friend.avatar_url"
              />
            </span>
            <span class="chat-bubble">{{ it.msg.content }}</span>
            <span v-if="it.seen" class="chat-seen">Seen</span>
          </div>
        </template>
      </div>

      <form class="chat-compose" @submit.prevent="send">
        <textarea
          ref="input"
          v-model="draft"
          class="chat-input"
          rows="1"
          :maxlength="MESSAGE_MAX"
          placeholder="Aa"
          aria-label="Message"
          @input="autosize"
          @keydown="onKey"
        />
        <button type="submit" class="chat-send" :disabled="sending || !draft.trim()" aria-label="Send">
          <SvgIcon name="send" />
        </button>
      </form>
    </template>
  </section>
</template>
