<script setup>
// Top-level view router: boot -> lobby -> table, with the dead-link screen
// off to one side.
//
// Identity is a guest account and nothing else in this pass: an anonymous
// Supabase session where the server is set up for it, the server's own
// per-tab guest naming where it isn't. There is no login screen to route to.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { api } from './lib/api.js';
import { getSocket, setGuestName, setTokenSource, emitAck } from './lib/socket.js';
import { supabaseConfigured } from './lib/supabase.js';
import { useAuth } from './composables/useAuth.js';
import { showToast } from './lib/toast.js';
import { grouped } from './lib/format.js';
import LobbyScreen from './components/lobby/LobbyScreen.vue';
import TableScreen from './components/table/TableScreen.vue';
import RoomGoneScreen from './components/screens/RoomGoneScreen.vue';
import AuthModal from './components/auth/AuthModal.vue';
import LandingPage from './components/landing/LandingPage.vue';
import TopBar from './components/layout/TopBar.vue';
import SiteFooter from './components/layout/SiteFooter.vue';
import AuthTransition from './components/auth/AuthTransition.vue';
import SvgIcon from './components/ui/SvgIcon.vue';

const auth = useAuth();

const view = ref('boot'); // boot | gate | lobby | table | gone | blocked

// The auth sheet. One of it, opened either by the first-visit prompt (which
// cannot be closed without an answer) or by the top bar's buttons.
const authOpen = ref(false);
// { mode, label } while a sign-in or sign-out is in flight, null otherwise.
const transit = ref(null);
// The landing page's own guest button, which signs in without opening a sheet.
const landingBusy = ref(false);
const landingError = ref('');
const lobby = ref(null);

// What the last visit ended as. A hint and never a fact: it decides which
// shape to hold the page in while the real answer is still being fetched, so
// a returning player is not shown a signed-out page for half a second before
// their lobby arrives. Wrong only costs one frame of the wrong skeleton.
const AUTH_HINT = 'bbp-auth-hint';
const readHint = () => {
  try {
    return localStorage.getItem(AUTH_HINT) === '1';
  } catch {
    return false;
  }
};
const writeHint = (on) => {
  try {
    localStorage.setItem(AUTH_HINT, on ? '1' : '0');
  } catch {
    // Storage unavailable; the page simply starts from its signed-out shape.
  }
};
const hintSignedIn = ref(readHint());

// The shell is painted before any of this is known. `booting` only holds back
// the parts that genuinely depend on the answer - the bar's account area, and
// which page sits in the content slot - rather than the whole app.
const booting = computed(() => view.value === 'boot');

// The bar lives in the shell, so what it shows has to be decided here.
const showAuth = computed(
  () => supabaseConfigured && !booting.value && (!auth.signedIn.value || auth.isGuest.value)
);
const barUser = computed(() => {
  if (user.value) return user.value;
  if (!auth.signedIn.value) return null;
  return { id: null, username: auth.displayName.value || 'You' };
});

// What the account control offers. A guest and an account get the same
// shape - somewhere to play, something about them, their settings, and a way
// out - with the one difference being that a guest's "something about them"
// is the offer to become somebody.
const menuGroups = computed(() => {
  if (!barUser.value) return [];
  const guest = auth.isGuest.value;
  return [
    [
      { id: 'lobby', icon: 'trophy', label: 'Go to lobby' },
      guest
        ? { id: 'signup', icon: 'key', label: 'Create account' }
        : { id: 'profile', icon: 'key', label: 'Profile' },
      { id: 'settings', icon: 'gear', label: 'Settings' },
    ],
    [
      {
        id: 'logout',
        icon: 'leave',
        label: guest ? 'Leave guest session' : 'Log out',
        danger: true,
      },
    ],
  ];
});

async function onMenuPick(id) {
  if (id === 'logout') return logout();
  if (id === 'signup') return openAuth('signup');
  if (id === 'login') return openAuth('login');
  if (id === 'lobby') return goLobby();
  // Settings and Profile are both pages of the lobby, so getting there is
  // the same move twice: go to the lobby, then open the page.
  if (id === 'settings' || id === 'profile') {
    if (!user.value && !auth.signedIn.value) return openAuth('login');
    if (view.value !== 'lobby') {
      view.value = 'lobby';
      await nextTick();
    }
    return lobby.value?.showPage('settings', id === 'profile' ? 'profile' : null);
  }
}

// The mark in the bar, clicked. Where "/" goes depends on who is reading it:
// the landing page for somebody signed out, the lobby for somebody who is in.
//
// Already there means already there: scroll to the top and change nothing.
// Re-running boot to land on the screen you are looking at is the "appears to
// load but never arrives" the old full-page link produced.
function goHome() {
  const destination = 'home';
  if (view.value === destination) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  notice.value = '';
  view.value = destination;
  try {
    history.replaceState(null, '', '/');
  } catch {
    // A sandboxed frame. The view has changed either way.
  }
  window.scrollTo({ top: 0 });
}

// The lobby, asked for rather than arrived at: from the hero, the closing
// band, or the account menu.
function goLobby() {
  if (!user.value && !auth.signedIn.value) return openAuth('login');
  notice.value = '';
  view.value = 'lobby';
  window.scrollTo({ top: 0 });
}

// A rename from the avatar menu. The bar reads `user.username` and the avatar
// is drawn from it, so both follow from this one assignment.
function onRenamed(name) {
  if (user.value) user.value.username = name;
}
const hold = (ms) => new Promise((r) => setTimeout(r, ms));
const authTab = ref('login');
const authGuest = ref(false);

// `authGuest` means "this is the first-visit prompt": it cannot be dismissed
// without an answer. It does NOT mean "offer to play as a guest" - that offer
// belongs on every sheet shown to somebody who is not signed in, which is
// what `showGuestOption` below decides. Conflating the two is why the guest
// button vanished from every sheet opened from the top bar.
function openAuth(mode = 'login') {
  authTab.value = mode;
  authGuest.value = false;
  authOpen.value = true;
}

// Playing as a guest is offered to anyone who has not already taken a seat.
// Somebody signed in is never shown this sheet at all.
const showGuestOption = computed(() => supabaseConfigured && !auth.signedIn.value);

// The landing page is the only screen long enough to need its own contents
// listing. The lobby is one page and the table is a game; neither has
// anywhere for a link in the bar to go.
const LANDING_LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#faq', label: 'FAQ' },
];
const barLinks = computed(() => {
  if (view.value !== 'home' && view.value !== 'boot') return [];
  return LANDING_LINKS;
});
const user = ref(null); // { id, username } - the server's own record
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
    // Already somebody - an account, or a guest whose session is still good.
    if (auth.accessToken.value) return signedIn();

    // Nobody. The landing page is where a signed-out visitor belongs, every
    // time: first visit, after a logout, after an expiry, after a refresh
    // that failed. It is not the lobby with the panels removed - it is the
    // page that explains the game and offers the two ways in.
    //
    // No guest account is minted here. Resuming one silently was the old
    // behaviour and it meant a logged-out visitor was signed straight back
    // in and dropped in the lobby, never seeing this page at all. Playing as
    // a guest is now something they ask for, with a button that says so.
    view.value = 'home';

    // The sheet, on a true first visit only, over the page rather than
    // instead of it. Somebody who has answered it before is left alone.
    if (auth.needsChoice.value) {
      authGuest.value = true;
      authTab.value = 'login';
      authOpen.value = true;
    }
    bootError.value = auth.error.value || '';
    return;
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

async function signedIn() {
  hintSignedIn.value = true;
  writeHint(true);
  transit.value = { mode: 'in', label: 'Dealing you in…' };
  setTokenSource(() => auth.accessToken.value, auth.displayName.value);
  connectedAs = auth.userId.value;
  guest.value = auth.isGuest.value;
  try {
    // The deal takes about as long as the handshake. Whichever finishes
    // second decides - so a fast connection still sees the cards land, and a
    // slow one is never held up by them.
    await Promise.all([enter(), hold(620)]);
  } finally {
    transit.value = null;
  }
}

// The sheet got an answer. A player who signed up without confirming their
// email yet is still a guest, and still gets in.
function onAuthed() {
  authOpen.value = false;
  if (!auth.accessToken.value) return; // signed up, but held at confirmation
  // They answered the sheet from the signed-out homepage, so this is the
  // first identity of the session and the socket has yet to connect at all.
  if (view.value === 'home') return signedIn();

  guest.value = auth.isGuest.value;
  // Upgrading a guest attaches a username to the account they already had, so
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
    // The front page, whoever is reading it. Signing in used to land here in
    // the lobby, which made "/" mean one thing for a visitor and another for
    // a player; now it is the same page for everybody and the lobby is
    // somewhere you choose to go.
    view.value = 'home';
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

// A session that went away on its own: expired, or signed out in another tab
// of the same browser. The player cannot carry on - the socket's handshake is
// checked against that token - so rather than leaving them at a table that
// has quietly stopped answering, take them back to the prompt and say so.
//
let signingOut = false;

// Everything that ends a session ends here: the menu, the profile page, an
// expiry, a failed refresh, a sign-out in another tab. One way out means one
// state to be in afterwards.
//
// What it does NOT do is open the auth sheet. A sheet over a page nobody
// asked to leave is how you land on a login box floating over nothing; the
// bar offers Log in and Sign up, and they can take it when they want it.
function landOnHomepage({ toast = '' } = {}) {
  try {
    getSocket().disconnect();
  } catch {
    // Never connected.
  }
  // Every cached trace of who they were. The name and avatar are drawn from
  // `user`, the seat from `roomCode`, and the socket's own idea of them from
  // the token getter - all of it goes, or some corner of the page keeps
  // showing a player who has left.
  user.value = null;
  roomCode.value = null;
  connectedAs = null;
  notice.value = '';
  hintSignedIn.value = false;
  writeHint(false);
  setTokenSource(() => null, null);
  authOpen.value = false;
  view.value = 'home';
  // Replace rather than push: Back should not return to a table they are no
  // longer in. There is no router here - the view is a ref - so this is the
  // history entry itself being rewritten.
  try {
    history.replaceState(null, '', '/');
  } catch {
    // A sandboxed frame. The view has changed either way.
  }
  if (toast) showToast(toast, { info: true, atPage: true });
}

watch(
  () => auth.session.value,
  (now, before) => {
    if (!before || now || signingOut || !supabaseConfigured) return;
    landOnHomepage({ toast: 'You’ve been signed out.' });
  }
);

// Offered from the avatar menu on every screen that has one. For a guest it
// is not a log out so much as a new identity; for an account it is the real
// thing, and the first-visit prompt is there to meet them afterwards.
async function logout() {
  signingOut = true;
  try {
    if (supabaseConfigured) {
      // A guest asking to leave is asking for a different guest, and that is
      // a new identity rather than none - so it still reloads, because the
      // socket has to come back as somebody else.
      if (!auth.hasAccount.value) {
        await auth.newGuest();
        return location.reload();
      }
      await auth.signOut();
    } else if (guest.value) {
      try {
        sessionStorage.removeItem('guestName');
      } catch {
        // Nothing to clear.
      }
      return location.reload();
    } else {
      await api.logout();
    }
    transit.value = { mode: 'out', label: 'Cashing you out…' };
    await hold(680);
    landOnHomepage({ toast: 'You’ve been signed out.' });
    transit.value = null;
  } finally {
    signingOut = false;
  }
}

// The landing page's "Play as guest". The same anonymous sign-in the sheet
// offers, reached without opening the sheet at all.
async function playAsGuest() {
  if (landingBusy.value) return;
  landingBusy.value = true;
  landingError.value = '';
  try {
    await auth.continueAsGuest();
    onAuthed();
  } catch (err) {
    landingError.value = err.message;
  } finally {
    landingBusy.value = false;
  }
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
  <!-- The shell. It is painted on the first frame, before anything is known
       about who is reading it: background, bar, content slot, footer.
       Everything that has to wait for the session waits inside it.
       The table is the one screen that keeps its own chrome - it is
       full-bleed and its bar belongs to the felt. -->
  <div class="app-shell">
    <TopBar
      v-if="view !== 'table'"
      :user="barUser"
      :menu-groups="menuGroups"
      :show-auth="showAuth"
      :loading="booting"
      :links="barLinks"
      @pick="onMenuPick"
      @auth="openAuth"
      @home="goHome"
      @guest="playAsGuest"
      @renamed="onRenamed"
    />

    <!-- Still finding out. A returning player is held in the shape their last
         visit ended in, so the page does not swing from signed-out to
         signed-in under them; anyone else simply gets the landing page, which
         is what they were going to be shown anyway. -->
    <div v-if="view === 'boot' && hintSignedIn" class="shell-wait" aria-busy="true">
      <span class="sk sk-title" /><span class="sk sk-line" /><span class="sk sk-line sk-short" />
      <span class="sr-only">Loading your table…</span>
    </div>

  <!-- The door is shut and nobody is behind it. Given the same treatment as
       the 404: an empty table drawn in the dark, and the explanation beside
       it rather than a grey card in the middle of nothing. -->
    <div v-else-if="view === 'blocked'" class="screen shut-screen">
    <div class="shut-felt" aria-hidden="true">
      <span class="shut-seat" v-for="n in 6" :key="n" :style="{ '--i': n - 1 }" />
      <span class="shut-cards"><i /><i /></span>
    </div>
    <div class="shut-say">
      <span class="kicker">No seats dealt</span>
      <h1 class="display">Nobody at the door.</h1>
      <p class="lead">
        This server isn’t handing out accounts, so there’s no way to sit down yet. The felt is
        here — there’s just nobody to deal you in.
      </p>
      <p class="help-text">
        Set the Supabase keys in <b class="selectable">.env</b>, or run with
        <b class="selectable">SKIP_AUTH=true</b>.
      </p>
      <p v-if="bootError" class="error-text selectable">{{ bootError }}</p>
    </div>
  </div>

  <!-- Signed out: the landing page, which is also what the first-visit sheet
       and the logged-out state sit on top of - so there is always a real page
       behind the backdrop rather than a card floating in the dark. -->
    <LandingPage
      v-else-if="view === 'home' || view === 'boot'"
      :user="null"
    :busy="landingBusy"
    :error="landingError"
    @auth="openAuth"
    @guest="playAsGuest"
    @lobby="goLobby"
    @settings="onMenuPick('settings')"
  />

    <LobbyScreen
      ref="lobby"
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
    />

    <SiteFooter
      v-if="view === 'home' || view === 'lobby' || view === 'boot'"
      :show-feature-links="view === 'home' || view === 'boot'"
      @auth="openAuth"
      @guest="playAsGuest"
      @lobby="goLobby"
      @settings="onMenuPick('settings')"
    />
  </div>

  <!-- One sheet for both ways in. On the first visit it carries the guest
       option and cannot be closed without an answer; from the top bar it is
       an ordinary dialog. -->
  <AuthTransition v-if="transit" :mode="transit.mode" :label="transit.label" />

  <AuthModal
    v-if="authOpen && !transit"
    :show-guest="showGuestOption"
    :closable="!authGuest"
    :initial-tab="authTab"
    @done="onAuthed"
    @close="authOpen = false"
  />
</template>
