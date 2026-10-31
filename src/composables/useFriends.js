// The friends list, one copy for the whole page.
//
// Started by the app shell when an account signs in and stopped when it
// leaves, not by the sidebar: the heartbeat that keeps you green on your
// friends' lists has to keep beating while you sit at a table, where no
// sidebar is drawn.
import { ref, computed } from 'vue';
import { listFriends, touchLastSeen, watchFriendships, acceptFriendRequest, removeFriend } from '../lib/friends.js';
import { myUnread, myPreviews, watchIncoming } from '../lib/chat.js';
import { receiveInvite } from './useInvite.js';
import { useChat } from './useChat.js';
import { isOnline } from '../../shared/lastSeen.mjs';

// The chat that's open, so an invite from that friend is left to the window
// rather than also thrown as a toast.
const { friend: openChatFriend } = useChat();

// One beat a minute while the page is in front of somebody. ONLINE_WITHIN in
// shared/lastSeen.mjs is two of these, so a single late beat is forgiven.
const BEAT_MS = 60_000;
// How often the "5m ago" labels move on between reads.
const TICK_MS = 30_000;

const rows = ref([]);
// { friendId: count } of messages not yet read, for the badges.
const unread = ref({});
// { friendId: last message } for the line under each name.
const previews = ref({});
// False until a list has come back, and false for good on a server without
// the friends tables - the sidebar draws nothing then rather than an error.
const available = ref(false);
const loaded = ref(false);
const fetchedAt = ref(0);
const now = ref(Date.now());

let me = null;
let beat = null;
let tick = null;
let unwatch = null;
let unwatchInbox = null;
let pending = null;

async function refresh() {
  const who = me;
  if (!who) return;
  try {
    const [list, counts, lasts] = await Promise.all([listFriends(), myUnread(), myPreviews()]);
    // Signed out, or somebody else signed in, while that was in flight.
    if (who !== me) return;
    unread.value = counts || {};
    previews.value = lasts || {};
    available.value = list !== null;
    rows.value = list || [];
    fetchedAt.value = Date.now();
    now.value = fetchedAt.value;
  } catch {
    // Keep what was drawn. The next beat reads it again.
  } finally {
    if (who === me) loaded.value = true;
  }
}

// Several changes land together - an accept is an update here and another in
// the other tab - so they are gathered into one read.
function refreshSoon() {
  clearTimeout(pending);
  pending = setTimeout(refresh, 250);
}

async function heartbeat() {
  if (document.visibilityState !== 'visible') return;
  try {
    await touchLastSeen();
  } catch {
    // Nothing to say about it; the next beat tries again.
  }
  refresh();
}

function onVisible() {
  if (document.visibilityState === 'visible') heartbeat();
}

export function startFriends(userId) {
  if (!userId || userId === me) return;
  stopFriends();
  me = userId;
  heartbeat();
  beat = setInterval(heartbeat, BEAT_MS);
  tick = setInterval(() => (now.value = Date.now()), TICK_MS);
  document.addEventListener('visibilitychange', onVisible);
  unwatch = watchFriendships(userId, refreshSoon);
  // A message arriving moves a badge; an invite from someone whose chat
  // isn't open is also thrown up as a toast, the way a knock is answered.
  unwatchInbox = watchIncoming(userId, (row) => {
    refreshSoon();
    if (row?.kind === 'invite' && row.sender_id !== me) {
      if (openChatFriend.value?.id === row.sender_id) return;
      const from = rows.value.find((r) => r.id === row.sender_id);
      receiveInvite(row, from);
    }
  });
}

export function stopFriends() {
  me = null;
  clearInterval(beat);
  clearInterval(tick);
  clearTimeout(pending);
  document.removeEventListener('visibilitychange', onVisible);
  unwatch?.();
  unwatch = null;
  unwatchInbox?.();
  unwatchInbox = null;
  rows.value = [];
  unread.value = {};
  previews.value = {};
  available.value = false;
  loaded.value = false;
}

// Seconds since they were seen, as of now rather than as of the last read.
function secsAgo(row) {
  if (row.seen_secs_ago == null) return null;
  return row.seen_secs_ago + Math.max(0, (now.value - fetchedAt.value) / 1000);
}

const nameOf = (row) => row.ingame_name || row.username || '';

// Online first, then whoever was about most recently, then never-seen; names
// break ties so the list doesn't shuffle between reads.
const friends = computed(() =>
  rows.value
    .filter((r) => r.state === 'friends')
    .map((r) => {
      const ago = secsAgo(r);
      return { ...r, name: nameOf(r), secsAgo: ago, online: isOnline(ago), unread: unread.value[r.id] || 0, last: previews.value[r.id] || null };
    })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if ((a.secsAgo == null) !== (b.secsAgo == null)) return a.secsAgo == null ? 1 : -1;
      if (a.secsAgo !== b.secsAgo) return a.secsAgo - b.secsAgo;
      return a.name.localeCompare(b.name);
    })
);

const requests = computed(() =>
  rows.value.filter((r) => r.state === 'received').map((r) => ({ ...r, name: nameOf(r) }))
);

async function answer(action, id) {
  try {
    await action(id);
  } finally {
    refresh();
  }
}

export function useFriends() {
  return {
    friends,
    requests,
    available,
    loaded,
    refresh,
    accept: (id) => answer(acceptFriendRequest, id),
    decline: (id) => answer(removeFriend, id),
  };
}
