<script setup>
// Top-level view router: boot -> lobby -> table, with the dead-link screen
// off to one side.
//
// Identity is a guest account and nothing else in this pass: an anonymous
// Supabase session where the server is set up for it, the server's own
// per-tab guest naming where it isn't. There is no login screen to route to.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { api } from './lib/api.js';
import { getSocket, setGuestName, setTokenSource, emitAck } from './lib/socket.js';
import { supabaseConfigured } from './lib/supabase.js';
import { useGuestAuth } from './composables/useGuestAuth.js';
import { showToast } from './lib/toast.js';
import { grouped } from './lib/format.js';
import LobbyScreen from './components/lobby/LobbyScreen.vue';
import TableScreen from './components/table/TableScreen.vue';
import RoomGoneScreen from './components/screens/RoomGoneScreen.vue';

const auth = useGuestAuth();

const view = ref('boot'); // boot | lobby | table | gone | blocked
const user = ref(null); // { id, username, bankroll } - the server's own record
const guest = ref(false);
const roomCode = ref(null);
const notice = ref('');
const goneCode = ref('');
const bootError = ref('');

// Per-tab guest name, kept in sessionStorage so a refresh keeps the same
// player. Only used where Supabase isn't in play.
function tabGuestName() {
  let name = null;
  try {
    name = sessionStorage.getItem('guestName');
  } catch {
    // Storage unavailable: a fresh name each load, which still plays.
  }
  if (!name) {
    name = 'guest_' + Math.random().toString(36).slice(2, 7);
    try {
      sessionStorage.setItem('guestName', name);
    } catch {
      // As above.
    }
  }
  return name;
}

// An invite link: ?room=CODE&k=TOKEN. Read once and taken off the address
// bar, so a refresh doesn't try to walk back into a room you've since left.
function takeInvite() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('room') || '').trim().toUpperCase();
  if (!code) return null;
  const invite = params.get('k') || '';
  params.delete('room');
  params.delete('k');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  return { code, invite };
}

async function boot() {
  const config = await fetch('/api/config')
    .then((r) => r.json())
    .catch(() => ({}));

  // A guest account this server will actually accept.
  if (config.supabaseAuth && supabaseConfigured) {
    await auth.initPromise;
    if (auth.accessToken.value) {
      // A getter, not the token: the handshake is rebuilt on every reconnect
      // and wants whatever the current one is by then.
      setTokenSource(() => auth.accessToken.value, auth.username.value);
      guest.value = true;
      return enter();
    }
    bootError.value = auth.error.value || '';
  }

  if (config.skipAuth) {
    guest.value = true;
    setGuestName(tabGuestName());
    return enter();
  }

  // Nothing left to be. A session from the old password accounts still works
  // if one is sitting in the cookie jar; otherwise this build has no way to
  // identify anybody, and says so rather than hanging on a dead socket.
  try {
    await api.me();
    return enter();
  } catch {
    view.value = 'blocked';
  }
}

// Once identified, go straight back to your table if you were in one (after a
// page refresh, say), otherwise follow the link that brought you here,
// otherwise the lobby.
async function enter() {
  try {
    const res = await emitAck('whoami');
    user.value = res.user;
    const invite = takeInvite();
    if (res.currentRoom) {
      roomCode.value = res.currentRoom;
      notice.value = '';
      view.value = 'table';
      return;
    }
    if (invite) return followInvite(invite);
    view.value = 'lobby';
  } catch (err) {
    bootError.value = err.message;
    view.value = 'blocked';
  }
}

// A link does the whole job: a seat if the game hasn't started, a seat from
// the next hand if it has, and past the door of a private room, because the
// host handing out the link is the invitation.
async function followInvite({ code, invite }) {
  try {
    const res = await emitAck('joinRoom', { code, invite });
    roomCode.value = res.code;
    notice.value = res.waiting
      ? `Joining with ${grouped(res.chips)} chips — you'll be dealt in next hand.`
      : '';
    view.value = 'table';
  } catch (err) {
    if (err.reason === 'no-room') {
      goneCode.value = code;
      view.value = 'gone';
      return;
    }
    // Refused for a reason of its own (name taken, table full, blocked): the
    // lobby is where they can do something about it.
    notice.value = err.message;
    view.value = 'lobby';
  }
}

function onEnterRoom({ code, notice: message }) {
  roomCode.value = code;
  notice.value = message || '';
  view.value = 'table';
}

// Walking out is your own doing and needs no fanfare; being removed happens
// to you, so it gets said plainly on screen. A toast rather than a sheet: the
// lobby behind it is where they're going anyway, so there's nothing to decide
// and nothing worth blocking for.
function onLeaveTable({ notice: message, forced }) {
  roomCode.value = null;
  notice.value = forced ? '' : message || '';
  view.value = 'lobby';
  if (forced && message) showToast(message, { atPage: true, ms: 7000 });
}

// Offered from the avatar menu on every screen that has one. For a guest this
// is not a log out so much as a new identity.
async function logout() {
  if (supabaseConfigured) await auth.newGuest();
  else if (guest.value) {
    try {
      sessionStorage.removeItem('guestName');
    } catch {
      // Nothing to clear.
    }
  } else {
    await api.logout();
  }
  // Reload so the socket reconnects under the new identity.
  location.reload();
}

// Keep the socket alive across view changes, and let it go with the page.
const dropSocket = () => {
  try {
    getSocket().disconnect();
  } catch {
    // Never connected.
  }
};

onMounted(() => {
  boot();
  window.addEventListener('beforeunload', dropSocket);
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', dropSocket));
</script>

<template>
  <div v-if="view === 'boot'" class="screen">
    <div class="auth-wrap">
      <section class="panel auth-card">
        <h1 class="display">Boysbathroom Poker</h1>
        <p class="lead">Dealing you in…</p>
      </section>
    </div>
  </div>

  <div v-else-if="view === 'blocked'" class="screen">
    <div class="auth-wrap">
      <section class="panel auth-card">
        <h1 class="display">Nobody at the door</h1>
        <p class="lead">
          This server isn't handing out guest accounts, so there's no way to sit down yet.
        </p>
        <p class="help-text">
          Set the Supabase keys in <b class="selectable">.env</b>, or run with
          <b class="selectable">SKIP_AUTH=true</b>.
        </p>
        <p v-if="bootError" class="error-text selectable">{{ bootError }}</p>
      </section>
    </div>
  </div>

  <LobbyScreen
    v-else-if="view === 'lobby'"
    :user="user"
    :guest="guest"
    :notice="notice"
    @enter-room="onEnterRoom"
    @logout="logout"
  />

  <TableScreen
    v-else-if="view === 'table'"
    :key="roomCode"
    :user="user"
    :room-code="roomCode"
    :notice="notice || null"
    @leave="onLeaveTable"
  />

  <RoomGoneScreen
    v-else-if="view === 'gone'"
    :code="goneCode"
    :user="user"
    :guest="guest"
    @home="view = 'lobby'"
    @logout="logout"
  />
</template>
