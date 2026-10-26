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
import AuthModal from './components/auth/AuthModal.vue';
import SvgIcon from './components/ui/SvgIcon.vue';

const auth = useGuestAuth();

const view = ref('boot'); // boot | gate | lobby | table | gone | blocked

// The auth sheet. One of it, opened either by the first-visit prompt (which
// cannot be closed without an answer) or by the top bar's buttons.
const authOpen = ref(false);
const authTab = ref('login');
const authGuest = ref(false);

function openAuth(mode = 'login') {
  authTab.value = mode;
  authGuest.value = false;
  authOpen.value = true;
}
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

  // An account, or a guest one, that this server will actually accept.
  if (config.supabaseAuth && supabaseConfigured) {
    await auth.initPromise;
    // Already somebody - an account, or a guest from a previous visit.
    if (auth.accessToken.value) return signedIn();
    // They answered the prompt once before and the session has since gone.
    // Asking again would be nagging, so put them back in as a guest.
    if (auth.shouldResumeGuest.value) {
      try {
        await auth.continueAsGuest();
        return signedIn();
      } catch (err) {
        bootError.value = err.message;
      }
    }
    // First time here: ask before anything else happens. Nothing is signed
    // in at this point, deliberately - minting a guest account now would
    // answer the question for them.
    if (auth.needsChoice.value) {
      authGuest.value = true;
      authTab.value = 'login';
      authOpen.value = true;
      view.value = 'gate';
      return;
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

// A session in hand, whichever way it arrived. The socket is handed a getter
// rather than the token itself: the handshake is rebuilt on every reconnect
// and wants whatever the current one is by then.
// The user id the socket connected under, so a later sign-in can tell
// whether it is still talking to the same player.
let connectedAs = null;

function signedIn() {
  setTokenSource(() => auth.accessToken.value, auth.username.value);
  connectedAs = auth.userId.value;
  guest.value = auth.isGuest.value;
  return enter();
}

// The sheet got an answer. A player who signed up without confirming their
// email yet is still a guest, and still gets in.
function onAuthed() {
  authOpen.value = false;
  if (!auth.accessToken.value) return; // signed up, waiting on the email
  if (view.value === 'gate') return signedIn();

  guest.value = auth.isGuest.value;
  // Upgrading a guest attaches an email to the account they already had, so
  // the user id - and the socket, and the seat they may be sitting in - is
  // unchanged. Nothing to do but say so.
  if (auth.userId.value === connectedAs) {
    return showToast('Account created — your chips are yours for keeps.', { info: true, atPage: true });
  }
  // A different player entirely: the socket has to come back as them.
  location.reload();
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

// Offered from the avatar menu on every screen that has one. For a guest it
// is not a log out so much as a new identity; for an account it is the real
// thing, and the first-visit prompt is there to meet them afterwards.
async function logout() {
  if (supabaseConfigured) {
    if (auth.hasAccount.value) await auth.signOut();
    else await auth.newGuest();
  } else if (guest.value) {
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

  <!-- The first visit. The prompt is the screen: there is nothing behind it
       to go back to, so the page under it is the brand and nothing else. -->
  <div v-else-if="view === 'gate'" class="screen">
    <div class="auth-wrap">
      <section class="panel auth-card gate-card">
        <div class="auth-brand"><SvgIcon name="logo" /></div>
        <h1 class="display">Boysbathroom Poker</h1>
        <p class="lead">Play-money Texas Hold’em for you and your friends.</p>
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
    @auth="openAuth"
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

  <!-- One sheet for both ways in. On the first visit it carries the guest
       option and cannot be closed without an answer; from the top bar it is
       an ordinary dialog. -->
  <AuthModal
    v-if="authOpen"
    :show-guest="authGuest"
    :closable="!authGuest"
    :initial-tab="authTab"
    @done="onAuthed"
    @close="authOpen = false"
  />
</template>
