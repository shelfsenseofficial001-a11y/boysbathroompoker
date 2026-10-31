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
import { useInvite } from '../../composables/useInvite.js';
import { clearUnreadFor } from '../../composables/useFriends.js';
import { removeFriend, blockUser } from '../../lib/friends.js';
import {
  openConversation, loadMessages, sendMessage, sendInvite, markRead,
  editMessage, unsendMessage, clearConversation, chatExtrasReady,
  watchConversation, PAGE_SIZE,
} from '../../lib/chat.js';
import { threadItems, chatTimeLabel, cleanMessage, MESSAGE_MAX } from '../../../shared/chatThread.mjs';
import { showToast } from '../../lib/toast.js';
import { aliveRooms } from '../../lib/rooms.js';
import { avatarSVG } from '../../lib/svg/avatars.js';
import SvgIcon from '../ui/SvgIcon.vue';
import FriendAvatar from './FriendAvatar.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const emit = defineEmits(['join', 'profile']);

const auth = useAuth();
const { friend, minimized } = useChat();
const { canInvite, room } = useInvite();

// The kebab menu, and the question a destructive item opens. Removing a
// friend, blocking, and erasing a thread each stop and say what will happen
// rather than taking a second press on a menu item as consent.
const menuOpen = ref(false);
// 'remove' | 'block' | 'clear' while the dialog is up.
const asking = ref(null);
const working = ref(false);

function closeMenu() {
  menuOpen.value = false;
}

function ask(kind) {
  menuOpen.value = false;
  asking.value = kind;
}

const QUESTIONS = {
  remove: (name) => ({
    title: `Remove ${name}?`,
    body: `You'll both drop off each other's friends list and won't be able to message until one of you asks again. The messages stay.`,
    confirmLabel: 'Remove',
  }),
  block: (name) => ({
    title: `Block ${name}?`,
    body: `${name} won't be able to message you or send you invites, and they'll drop off your friends list. They aren't told.`,
    confirmLabel: 'Block',
  }),
  clear: (name) => ({
    title: 'Delete chat?',
    body: `This clears your copy of the chat with ${name}. They keep theirs, and either of you can still write.`,
    confirmLabel: 'Delete',
  }),
};
const question = computed(() =>
  asking.value ? QUESTIONS[asking.value](friend.value?.name || 'them') : null
);

async function confirmAsked() {
  const kind = asking.value;
  if (!kind || working.value) return;
  working.value = true;
  const other = friend.value?.id;
  try {
    if (kind === 'clear') {
      const id = conversationId.value;
      if (id) {
        await clearConversation(id);
        messages.value = [];
        hasMore.value = false;
      }
      showToast('Chat cleared for you.', { info: true });
      asking.value = null;
    } else {
      if (kind === 'remove') await removeFriend(other);
      else await blockUser(other);
      showToast(kind === 'remove' ? 'Friend removed.' : 'Blocked.', { info: true });
      asking.value = null;
      closeChat();
    }
  } catch (err) {
    showToast(err.message);
    asking.value = null;
  } finally {
    working.value = false;
  }
}

// Their page, from the face or the name at the top of the window.
function openProfile() {
  if (friend.value?.username) emit('profile', friend.value.username);
}

// Invite to lobby, from the menu: send this friend an invite to the room
// we're in. Only there when there is a room to invite to (canInvite).
async function inviteToLobby() {
  closeMenu();
  const r = room.value;
  if (!friend.value || !r) return;
  try {
    await sendInvite(friend.value.id, {
      code: r.code,
      token: r.token || '',
      line: `Come play — join my table ${r.code}.`,
    });
    showToast(`Invite sent to ${friend.value.name}.`, { info: true });
  } catch (err) {
    showToast(err.message);
  }
}

// Following an invite's Join: hand the room back up to the app, which knows
// how to walk through a private room's door with the token.
function joinInvite(msg) {
  const code = msg?.meta?.code;
  if (!code || isDead(msg)) return;
  emit('join', { code, invite: msg.meta.token || '' });
}

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
// Their generated face, for the slot when they have no picture.
const faceSVG = computed(() => avatarSVG(friend.value?.username || ''));

// Tables the invites in this thread point at, and which are still there.
// Null while unasked, so a card is never struck through on a guess.
const liveCodes = ref(null);
const inviteCodes = computed(() => [
  ...new Set(
    messages.value.filter((m) => m.kind === 'invite' && m.meta?.code).map((m) => m.meta.code)
  ),
]);
const isDead = (msg) => {
  const code = msg?.meta?.code;
  if (!code || !liveCodes.value) return false;
  return !liveCodes.value.has(code);
};

async function checkRooms() {
  const codes = inviteCodes.value;
  if (!codes.length) {
    liveCodes.value = null;
    return;
  }
  liveCodes.value = await aliveRooms(codes);
}
// Asked again whenever the set of invited tables changes - a new invite
// arriving, or an older page of the thread loading in.
watch(inviteCodes, checkRooms, { immediate: true });
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

// Seen. Tells the database, then drops the badge on the list at once -
// waiting for the next refresh left a chat you were looking at still marked
// unread beside it.
async function markSeen() {
  const id = conversationId.value;
  const who = friend.value?.id;
  if (!id) return;
  try {
    await markRead(id);
  } catch {
    // Nothing to say: the next open tries again.
  }
  if (who) clearUnreadFor(who);
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
    extras.value = chatExtrasReady();
    messages.value = page;
    hasMore.value = page.length === PAGE_SIZE;
    unwatch = watchConversation(id, {
      onInsert(row) {
        const stick = atBottom();
        mergeIn(row);
        // Only while it is open in front of them: a message that lands in a
        // folded-away window has not been read.
        if (row.sender_id !== me.value && watching.value) markSeen();
        if (stick || row.sender_id === me.value) scrollToEnd(true);
      },
      onUpdate: mergeIn,
    });
    await scrollToEnd();
    await markSeen();
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

// What the composer is doing besides starting a new message: answering one,
// or rewriting one. Both are the same strip above the box, the way the
// table's chat does it.
const replyTo = ref(null);
const editing = ref(null);
// Which message's ⋯ menu is open.
const msgMenu = ref(null);
// Whether this server has had 0011 run against it. Until it has there is no
// reply, edit or unsend to offer, so none is drawn - a control that can only
// apologise is worse than no control.
const extras = ref(true);

// The message a reply points at, for the quote above the bubble.
const quoted = (msg) => (msg?.reply_to ? messages.value.find((m) => m.id === msg.reply_to) : null);
// Who a reply was aimed at, said the way the table's chat says it.
function repliedTo(msg) {
  const to = quoted(msg);
  if (!to) return 'an earlier message';
  if (to.sender_id === msg.sender_id) return msg.sender_id === me.value ? 'yourself' : 'themselves';
  return to.sender_id === me.value ? 'you' : friend.value?.name || 'them';
}
const quoteText = (msg) => {
  const to = quoted(msg);
  if (!to) return 'No longer shown';
  return to.deleted_at ? 'Message deleted' : to.content;
};

function startReply(msg) {
  msgMenu.value = null;
  editing.value = null;
  replyTo.value = msg;
  input.value?.focus();
}

function startEdit(msg) {
  msgMenu.value = null;
  replyTo.value = null;
  editing.value = msg;
  draft.value = msg.content;
  nextTick(() => {
    autosize();
    input.value?.focus();
  });
}

function cancelContext() {
  if (editing.value) draft.value = '';
  replyTo.value = null;
  editing.value = null;
  nextTick(autosize);
}

async function unsend(msg) {
  msgMenu.value = null;
  try {
    await unsendMessage(msg.id);
    // The row stays and loses its words, so the thread keeps its shape.
    mergeIn({ ...msg, content: '', deleted_at: new Date().toISOString(), meta: null });
    if (editing.value?.id === msg.id) cancelContext();
  } catch (err) {
    showToast(err.message);
  }
}

async function send() {
  const content = cleanMessage(draft.value);
  if (!content || sending.value || !conversationId.value) return;
  sending.value = true;
  const id = conversationId.value;
  const target = editing.value;
  try {
    if (target) {
      await editMessage(target.id, content);
      mergeIn({ ...target, content, edited_at: new Date().toISOString() });
      editing.value = null;
    } else {
      const row = await sendMessage(id, content, replyTo.value?.id || null);
      mergeIn(row);
      replyTo.value = null;
      await scrollToEnd(true);
    }
    draft.value = '';
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
    return;
  }
  // Escape backs out of answering or rewriting, rather than closing the
  // whole window out from under a half-written line.
  if (e.key === 'Escape' && (replyTo.value || editing.value)) {
    e.preventDefault();
    cancelContext();
  }
}

// The composer grows with what's typed, up to a few lines.
function autosize() {
  const el = input.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
}

// Reading only counts while the window is actually open in front of you -
// not closed, not folded away. Without this a message that arrived after the
// chat was shut was marked read by the subscription that outlived it, so it
// never got to be unread and the row never went bold.
const watching = computed(() => !!friend.value && !minimized.value);

// Shut the chat down when it closes: a live subscription on a window nobody
// is looking at is what was quietly marking new messages read.
function teardown() {
  unwatch?.();
  unwatch = null;
  conversationId.value = null;
  messages.value = [];
  hasMore.value = false;
  replyTo.value = null;
  editing.value = null;
  draft.value = '';
}

watch(friend, (who) => {
  if (!who) return teardown();
  if (!minimized.value) open(who);
});

// Mounted with a friend already chosen - the window was put away for a table
// and is being drawn again. Pick the conversation back up.
onMounted(() => {
  if (friend.value && !minimized.value) open(friend.value);
});

// Reading as they come in while the window is open and in front.
function onVisible() {
  if (document.visibilityState === 'visible' && watching.value && conversationId.value) {
    markSeen();
  }
}
// A press anywhere off a menu puts it away.
function onDocClick() {
  if (menuOpen.value) closeMenu();
  if (msgMenu.value !== null) msgMenu.value = null;
}
document.addEventListener('visibilitychange', onVisible);
document.addEventListener('click', onDocClick);

onBeforeUnmount(() => {
  unwatch?.();
  document.removeEventListener('visibilitychange', onVisible);
  document.removeEventListener('click', onDocClick);
});

function toggleMin() {
  minimized.value = !minimized.value;
  if (minimized.value) return;
  // Opening it back up is seeing what came in while it was folded away.
  if (conversationId.value) {
    scrollToEnd();
    markSeen();
  } else if (friend.value) {
    open(friend.value);
  }
}
</script>

<template>
  <!-- Shell is the window's own (.friend-chat*); the message column and the
       composer reuse the table chat's classes, so this reads as the same
       chat drawn in a corner. -->
  <section v-if="friend" class="friend-chat" :class="{ 'is-min': minimized }" aria-label="Chat">
    <header class="friend-chat-bar">
      <!-- The face and the name go to their page; the chevron is what folds
           the window away, so a press on somebody's name does the thing a
           press on somebody's name does everywhere else. -->
      <button
        type="button"
        class="friend-chat-who"
        :title="`View ${friend.name}'s profile`"
        :aria-label="`View ${friend.name}'s profile`"
        @click="openProfile"
      >
        <FriendAvatar :username="friend.username" :name="friend.name" :url="friend.avatar_url" />
        <span class="friend-chat-name">{{ friend.name }}</span>
      </button>
      <div class="friend-chat-acts">
        <div v-if="!minimized" class="friend-chat-menu-wrap">
          <button
            type="button"
            class="friend-chat-icon"
            aria-label="More"
            :aria-expanded="menuOpen"
            @click.stop="menuOpen ? closeMenu() : (menuOpen = true)"
          >
            <SvgIcon name="more" />
          </button>
          <div v-if="menuOpen" class="friend-chat-menu" @click.stop>
            <button v-if="canInvite" type="button" @click="inviteToLobby">Invite to lobby</button>
            <button type="button" @click="closeMenu(); openProfile()">View profile</button>
            <button v-if="extras" type="button" @click="ask('clear')">Delete chat</button>
            <button type="button" @click="ask('remove')">Remove friend</button>
            <button type="button" class="is-danger" @click="ask('block')">Block</button>
          </div>
        </div>
        <button type="button" class="friend-chat-icon" :aria-label="minimized ? 'Open chat' : 'Minimize chat'" @click="toggleMin">
          <SvgIcon :name="minimized ? 'chevron' : 'minus'" />
        </button>
        <button type="button" class="friend-chat-icon" aria-label="Close chat" @click="closeChat">
          <SvgIcon name="close" />
        </button>
      </div>
    </header>

    <template v-if="!minimized">
      <ol ref="body" class="chat-log" @scroll="onScroll">
        <li v-if="loading" class="friend-chat-note" aria-busy="true">Loading…</li>
        <li v-else-if="loadingMore" class="friend-chat-note" aria-busy="true">Loading earlier…</li>
        <li v-else-if="!messages.length" class="friend-chat-note">Say hello to {{ friend.name }}.</li>

        <template v-for="it in items" :key="it.key">
          <li v-if="it.type === 'time'" class="friend-chat-when">{{ chatTimeLabel(it.at) }}</li>
          <li
            v-else
            class="chat-row"
            :class="{ 'is-mine': it.mine, 'is-first': it.first, 'is-last': it.last }"
          >
            <!-- Who is talking, and who they answered, on one line above the
                 bubble - the table chat's shape exactly. -->
            <span v-if="(it.first && !it.mine) || it.msg.reply_to" class="chat-meta">
              <span v-if="it.msg.reply_to" class="reply-arrow"><SvgIcon name="call" /></span>
              <span v-if="it.first && !it.mine" class="chat-who">{{ friend.name }}</span>
              <span v-if="it.msg.reply_to" class="reply-note">Replied to {{ repliedTo(it.msg) }}</span>
            </span>
            <span v-if="it.msg.reply_to" class="reply-quote">{{ quoteText(it.msg) }}</span>
            <div class="bubble-line">
              <span v-if="!it.mine" class="chat-face" :class="{ 'is-blank': !it.last }">
                <template v-if="it.last">
                  <img v-if="friend.avatar_url" :src="friend.avatar_url" alt="" />
                  <span v-else class="contents" v-html="faceSVG" />
                </template>
              </span>
              <div
                v-if="it.msg.kind === 'invite'"
                class="bubble fchat-invite"
                :class="{ 'is-dead': isDead(it.msg) }"
              >
                <span class="fchat-invite-head">
                  <SvgIcon name="trophy" />{{ isDead(it.msg) ? 'Table closed' : 'Table invite' }}
                </span>
                <span class="bubble-text">{{ it.msg.content }}</span>
                <button
                  type="button"
                  class="fchat-invite-join"
                  :disabled="isDead(it.msg)"
                  @click="joinInvite(it.msg)"
                >
                  {{ isDead(it.msg) ? 'No longer running' : it.mine ? 'Open table' : 'Join' }}
                </button>
              </div>
              <!-- Unsent: the row stays so the thread keeps its shape, and
                   says which side took it back. -->
              <div v-else-if="it.msg.deleted_at" class="bubble is-gone">
                {{ it.mine ? 'You unsent this' : 'Message unsent' }}
              </div>
              <div v-else class="bubble">
                <span class="bubble-text">{{ it.msg.content }}</span>
                <span v-if="it.msg.edited_at" class="bubble-edited">edited</span>
              </div>

              <!-- Reply is one tap; the rest sit behind the dots. Nothing is
                   offered on a message already taken back. -->
              <span v-if="extras && !it.msg.deleted_at" class="bubble-acts">
                <button
                  type="button"
                  class="bubble-act"
                  title="Reply"
                  aria-label="Reply"
                  @click.stop="startReply(it.msg)"
                >
                  <SvgIcon name="call" />
                </button>
                <button
                  v-if="it.mine"
                  type="button"
                  class="bubble-act"
                  title="More"
                  aria-label="Message actions"
                  :aria-expanded="msgMenu === it.msg.id"
                  @click.stop="msgMenu = msgMenu === it.msg.id ? null : it.msg.id"
                >
                  <SvgIcon name="more" />
                </button>
                <div v-if="it.mine && msgMenu === it.msg.id" class="msg-menu" @click.stop>
                  <button v-if="it.msg.kind !== 'invite'" type="button" @click="startEdit(it.msg)">Edit</button>
                  <button type="button" class="is-danger" @click="unsend(it.msg)">Unsend</button>
                </div>
              </span>
            </div>
          </li>
        </template>
      </ol>

      <!-- What the box is about to do, when it isn't simply a new message. -->
      <div v-if="replyTo || editing" class="chat-context">
        <span class="ctx-kind">{{ editing ? 'Editing' : `Replying to ${replyTo.sender_id === me ? 'yourself' : friend.name}` }}</span>
        <span class="ctx-text">{{ (editing || replyTo).content }}</span>
        <button type="button" class="ctx-x" aria-label="Cancel" @click="cancelContext">
          <SvgIcon name="close" />
        </button>
      </div>

      <form class="chat-form" :class="{ 'is-editing': !!editing }" @submit.prevent="send">
        <textarea
          ref="input"
          v-model="draft"
          class="input"
          rows="1"
          :maxlength="MESSAGE_MAX"
          :placeholder="editing ? 'Edit your message…' : 'Say something…'"
          aria-label="Message"
          @input="autosize"
          @keydown="onKey"
        />
        <button type="submit" class="btn btn-primary btn-icon" :disabled="sending || !draft.trim()" aria-label="Send">
          <SvgIcon name="send" />
        </button>
      </form>
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
  </section>
</template>
