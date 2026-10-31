<script setup>
// Top-level view router: boot -> lobby -> table, with the dead-link screen
// off to one side.
//
// Identity is a guest account and nothing else in this pass: an anonymous
// Supabase session where the server is set up for it, the server's own
// per-tab guest naming where it isn't. There is no login screen to route to.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { api } from './lib/api.js';
import {
  getSocket,
  setGuestName,
  setTokenSource,
  setTokenRenewer,
  setHandshakeRefused,
  reviveSocket,
  emitAck,
  resetSocket,
} from './lib/socket.js';
import { forgetGuestSession } from './lib/guestSession.js';
import { supabaseConfigured } from './lib/supabase.js';
import { useAuth } from './composables/useAuth.js';
import { showToast } from './lib/toast.js';
import { grouped } from './lib/format.js';
import LobbyScreen from './components/lobby/LobbyScreen.vue';
import TableScreen from './components/table/TableScreen.vue';
import RoomGoneScreen from './components/screens/RoomGoneScreen.vue';
import AuthModal from './components/auth/AuthModal.vue';
import BottomNav from './components/layout/BottomNav.vue';
import LandingPage from './components/landing/LandingPage.vue';
import ProfileView from './components/profile/ProfileView.vue';
import TopBar from './components/layout/TopBar.vue';
import SiteFooter from './components/layout/SiteFooter.vue';
import AuthTransition from './components/auth/AuthTransition.vue';
import SvgIcon from './components/ui/SvgIcon.vue';

const auth = useAuth();

const view = ref('boot'); // boot | home | lobby | table | profile | gone | blocked

// Why the door is shut. Two very different things used to wear the same
// sentence: a server that offers no way to sign in at all, and a server that
// offers one and then doesn't answer. The first is a configuration someone
// has to change; the second is usually a process that stopped, and the right
// response to it is to try again.
const blockedKind = ref('no-accounts'); // 'no-accounts' | 'no-answer'
const retrying = ref(false);

function blockFor(kind, detail = '') {
  blockedKind.value = kind;
  bootError.value = detail;
  view.value = 'blocked';
}

// Whose profile is being read, from /u/<name>. The one address in this app
// that is a path rather than a query string, because a profile is the one
// thing here meant to be pasted into a message and opened by a stranger.
const profileName = ref(readProfilePath());

// Read on boot and on every Back. Returns the name, or null for any other
// address - which is every other address this app uses.
function readProfilePath() {
  const match = /^\/u\/([^/]+)\/?$/.exec(location.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A name that isn't valid percent-encoding belongs to nobody, and the
    // page says so rather than throwing on the way in.
    return match[1];
  }
}

// Going to a profile, from the account menu or a seat. Pushed rather than
// replaced: Back should return to the table or the lobby they came from.
function openProfile(name, { push = true } = {}) {
  if (!name) return;
  profileName.value = name;
  view.value = 'profile';
  if (push) history.pushState({ profile: name }, '', `/u/${encodeURIComponent(name)}`);
}

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

// `from` is where to return to when the page being opened is closed. Only
// Settings uses it; everything else here is a destination rather than a
// detour.
// `tab` is which section of Settings to open on. "Edit profile" means the
// profile tab, not whatever Settings happens to open on by default - which
// is Appearance, and is not what anybody pressing "Edit profile" is after.
async function onMenuPick(id, from = null, tab = null) {
  if (id === 'logout') return logout();
  if (id === 'signup') return openAuth('signup');
  if (id === 'login') return openAuth('login');
  if (id === 'lobby') return goLobby();
  // Their own page, the same one anybody else would be given. "Edit profile"
  // is on it, and in Settings; this is the thing being edited.
  if (id === 'profile') {
    const handle = auth.username.value || user.value?.handle;
    if (!handle) return openAuth('signup');
    return openProfile(handle);
  }
  // Settings and Profile are both pages of the lobby, so getting there is
  // the same move twice: go to the lobby, then open the page.
  if (id === 'settings') {
    if (!user.value && !auth.signedIn.value) return openAuth('login');
    // Where to send them when they press back. Captured before the view
    // changes, because afterwards there is nothing left to say where they
    // came from.
    const origin = from || (view.value === 'profile' && profileName.value
      ? { view: 'profile', handle: profileName.value }
      : null);
    if (view.value !== 'lobby') {
      view.value = 'lobby';
      await nextTick();
    }
    return lobby.value?.showPage('settings', tab, origin);
  }
}

// Which page the lobby is showing. Settings lives inside the lobby view, so
// the view alone cannot say which of the two is on screen - and the bottom
// tray has to light the right one.
const lobbyPage = ref('main');

const navActive = computed(() => {
  if (view.value === 'profile') return 'profile';
  if (view.value === 'lobby') return lobbyPage.value === 'settings' ? 'settings' : 'lobby';
  return '';
});

// Never over the table: the betting dock owns the foot of that screen. And
// nothing to offer somebody who has not arrived yet.
const showBottomNav = computed(
  () => !!barUser.value && ['home', 'lobby', 'profile'].includes(view.value)
);

// The back button on a lobby page, when the way back is out of the lobby.
function onBackTo(origin) {
  if (origin?.view === 'profile' && origin.handle) return openProfile(origin.handle);
  goLobby();
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
  if (!user.value) chosenWhileBooting = destination;
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
async function goLobby() {
  if (!user.value && !auth.signedIn.value) return openAuth('login');
  if (!user.value) chosenWhileBooting = 'lobby';
  notice.value = '';
  view.value = 'lobby';
  // Settings is a page *inside* the lobby view, so setting the view alone
  // does nothing when you are already on it - which is why "Go to lobby"
  // from Settings used to leave you sitting on Settings. Arriving at the
  // lobby has to put the lobby back on its own front page too.
  await nextTick();
  lobby.value?.showPage('main');
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

// Whether this server will take a guest who has no account anywhere - the
// way in when there is no account server to reach. Answered by /api/config
// on boot; false until it has, so nothing offers a door before the server
// has said it is open.
const offlineGuests = ref(false);

// Playing as a guest is offered to anyone who has not already taken a seat.
// Somebody signed in is never shown this sheet at all.
//
// Offered where there is an account server to mint one, and also where there
// is none but this server will take a guest of the browser's own making:
// without the second, a laptop with no internet showed no way in at all.
const showGuestOption = computed(
  () => (supabaseConfigured || offlineGuests.value) && !auth.signedIn.value
);

// The landing page is the only screen long enough to need its own contents
// listing. The lobby is one page and the table is a game; neither has
// anywhere for a link in the bar to go.
// One list, on every page the shell draws. It used to be returned only for
// the landing page, which is why the lobby's bar was a logo and an avatar
// with nothing in between.
//
// `section` marks the three that point at a part of the landing page. They
// are real anchors, so they behave like links wherever they are read; off
// that page the bar catches the click and goes there first. `lobby` has no
// href because it has no address - the lobby is a view this app switches to,
// not a route - so it is a button, and honest about it.
const BAR_LINKS = [
  { id: 'home', label: 'Home', href: '/' },
  // The rule after this one is where the bar stops listing places and
  // starts listing parts of the landing page. Two kinds of destination in
  // one row read as five of the same thing without it.
  { id: 'lobby', label: 'Lobby', endsGroup: true },
  { id: 'how', label: 'How it works', href: '#how', section: 'how' },
  { id: 'features', label: 'Features', href: '#features', section: 'features' },
  { id: 'faq', label: 'FAQ', href: '#faq', section: 'faq' },
];
// The three section links point at parts of the landing page. Anywhere else
// they point at nothing: in the lobby they were four-fifths of the bar, all
// of it leaving the page you were on, and "FAQ" beside "Lobby" reads as a
// page of the app rather than a paragraph on another one.
const barLinks = computed(() =>
  view.value === 'home' || view.value === 'boot'
    ? BAR_LINKS
    : BAR_LINKS.filter((link) => !link.section)
);

// Which of them is the page being read. The three section links answer this
// for themselves - they are lit by what is on screen, not by the view - so
// they are not named here.
const barActive = computed(() => {
  if (view.value === 'lobby') return 'lobby';
  if (view.value === 'home' || view.value === 'boot') return 'home';
  return '';
});

// A link in the bar, chosen. The two that are not plain anchors come through
// here, and so does any anchor clicked from a page that is not the landing
// page: the section has to exist before it can be scrolled to.
async function onNav(link) {
  if (link.id === 'home') return goHome();
  // Straight through the existing guard rather than around it: signed out,
  // this opens the auth sheet instead of navigating, which is what goLobby
  // has always done.
  if (link.id === 'lobby') return goLobby();
  if (!link.section) return;

  if (view.value !== 'home' && view.value !== 'boot') {
    goHome();
    await nextTick();
  }
  // `scroll-margin-top` on the sections keeps the sticky bar off whatever
  // lands under it, and `html { scroll-behavior: smooth }` - already set,
  // and already turned off under reduced motion - decides how it gets there.
  document.getElementById(link.section)?.scrollIntoView({ block: 'start' });
  try {
    history.replaceState(null, '', `/#${link.section}`);
  } catch {
    // A sandboxed frame. The page has scrolled either way.
  }
}
const user = ref(null); // { id, username } - the server's own record

// Where the player asked to go while the handshake was still out.
//
// The bar is live during boot - it has to be, or it appears a second later
// under the pointer - so "Lobby" can be pressed before the server has said
// who they are. The lobby then has nothing to show but "Finding your seat…",
// and `enter()`, arriving a moment later, used to send them wherever a fresh
// load would have gone instead: the front page, or back to their table. Both
// read as the lobby never loading. A destination somebody picked themselves
// outranks the one a reload would have picked for them.
let chosenWhileBooting = null;
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
  // A profile link, opened cold. The page is shown before anything is known
  // about the reader: it is public, it needs no session, and holding it back
  // behind the auth handshake is what would make a shared link flash white
  // on the way in. Identity resolves underneath it and only decides the bar.
  if (profileName.value) view.value = 'profile';

  // Whether anything answered. A server that is down fails here first, and
  // that is the difference between "no accounts offered" and "no reply".
  let serverAnswered = true;
  const config = await fetch('/api/config')
    .then((r) => r.json())
    .catch(() => {
      serverAnswered = false;
      return {};
    });

  offlineGuests.value = config.offlineGuests === true;

  // An account, or a guest one, that this server will actually accept.
  if (config.supabaseAuth && supabaseConfigured) {
    await auth.initPromise;
    // Already somebody - an account, or a guest whose session is still good.
    if (auth.accessToken.value) return signedIn({ announce: takeGreeting() });
    // A signed-out visitor on a profile link stays on it. Everything below
    // is about where to put somebody who arrived at the front door.
    if (profileName.value) return;

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
    blockFor(serverAnswered ? 'no-accounts' : 'no-answer');
  }
}

// Going round again, from the shut screen.
//
// A reload would also work and is what people did instead, but it throws away
// the socket's own reconnection - which, by the time somebody has read the
// screen and reached for the button, has usually already succeeded. This just
// asks again.
async function retry() {
  if (retrying.value) return;
  retrying.value = true;
  bootError.value = '';
  view.value = 'boot';
  // The old connection is why this screen is up. Left in place it would be
  // asked again and give the same silence, so it goes and boot builds a new
  // one - which is the whole difference between this button and a reload.
  resetSocket();
  try {
    await boot();
  } finally {
    retrying.value = false;
  }
}

// A session in hand, whichever way it arrived. The socket is handed a getter
// rather than the token itself: the handshake is rebuilt on every reconnect
// and wants whatever the current one is by then.
// The user id the socket connected under, so a later sign-in can tell
// whether it is still talking to the same player.
let connectedAs = null;

// `announce` is for an actual sign-in, as opposed to a session being picked
// back up on load. Only one of those is news.
async function signedIn({ announce = false } = {}) {
  hintSignedIn.value = true;
  writeHint(true);
  setTokenSource(
    () => auth.accessToken.value,
    // A getter too: at this moment the profile may still be loading, and the
    // name that was current a tick ago can be the guest they just stopped
    // being. See setTokenSource.
    () => auth.displayName.value
  );
  // Where the socket goes when the server will not take the token it has.
  // It can only ask; the answer comes from Supabase, which is this end's
  // business rather than the socket's.
  setTokenRenewer(() => auth.renewSession());
  setHandshakeRefused(sessionRefused);
  // Whatever the last identity ran into is not this one's to inherit.
  sessionGone = false;
  // Who the server thinks it is talking to is settled once, in the
  // handshake. A socket that shook hands as somebody else - the guest they
  // were a moment ago - goes on answering as them however good the new token
  // is: `whoami` comes back with the guest's row, and the bar reads
  // Guest7726 at the top of an account somebody has just logged into. A
  // different player is a different connection.
  if (connectedAs && connectedAs !== auth.userId.value) resetSocket();
  else reviveSocket();
  connectedAs = auth.userId.value;
  guest.value = auth.isGuest.value;
  await enter();
  // Said in a toast rather than behind a full-screen transition. Signing in
  // is not a journey: the page it lands on is the page they were already
  // looking at, and covering it for two thirds of a second to say so made
  // every login feel like a load - and made a login that then failed look
  // like the app had hung.
  if (announce && view.value !== 'blocked') {
    showToast('Logged in!', { info: true, atPage: true });
  }
}

// The sheet got an answer. A player who signed up without confirming their
// email yet is still a guest, and still gets in.
async function onAuthed() {
  authOpen.value = false;
  if (!auth.accessToken.value) return; // signed up, but held at confirmation
  // They answered the sheet from the signed-out homepage, so this is the
  // first identity of the session and the socket has yet to connect at all.
  if (view.value === 'home' || view.value === 'profile') return signedIn({ announce: true });

  guest.value = auth.isGuest.value;
  // Upgrading a guest attaches a username to the account they already had, so
  // the user id - and the socket, and the seat they may be sitting in - is
  // unchanged. What has changed is what the server should make of them, and
  // it has no way to find that out on its own: identity is settled in the
  // handshake, and this socket's handshake happened while they were still a
  // guest. So it is told, with the new token, and it verifies that for
  // itself before believing any of it.
  if (auth.userId.value === connectedAs) {
    await syncTableName();
    return creditGuestSession();
  }
  // A different player entirely. Logging in to an account that already
  // exists is not an upgrade: the guest who played those matches is not this
  // person, so the session's results are dropped rather than handed over.
  // Said out loud, because somebody who has just played three hands as a
  // guest and then logged in would otherwise go looking for them.
  await discardGuestSession();
  // The socket has to come back as them, which takes the page with it - so
  // the sentence is left where the next load will find it, and so is the
  // toast saying the sign-in worked.
  leaveGreeting();
  location.reload();
}

// Dropped on purpose, with nothing said about it: this is the player
// leaving a guest session, where losing the session is the thing they asked
// for rather than a consequence to explain.
async function forgetGuestResultsNow() {
  try {
    await emitAck('forgetGuestResults');
  } catch {
    // Never connected, or already gone. It expires on its own either way.
  }
  forgetGuestSession();
}

// Signing in as somebody else reloads the page, which would otherwise swallow
// the toast saying it worked. Left here for the next load to pick up.
const GREET_KEY = 'bbp-just-signed-in';

function leaveGreeting() {
  try {
    sessionStorage.setItem(GREET_KEY, '1');
  } catch {
    // Not persisted: they get no toast, which is the smallest thing to lose.
  }
}

function takeGreeting() {
  try {
    if (sessionStorage.getItem(GREET_KEY) !== '1') return false;
    sessionStorage.removeItem(GREET_KEY);
    return true;
  } catch {
    return false;
  }
}

const DISCARD_KEY = 'bbp-guest-discarded';

async function discardGuestSession() {
  try {
    const res = await emitAck('guestResultCount');
    if (res?.count > 0) sessionStorage.setItem(DISCARD_KEY, '1');
  } catch {
    // Nothing to say if we can't find out whether there was anything.
  }
  try {
    // The server drops the buffer itself once it sees the ids differ; this
    // is the same instruction said plainly, for the case where the token
    // cannot be verified at all.
    await emitAck('forgetGuestResults');
  } catch {
    // It expires on its own at the end of the grace period regardless.
  }
  forgetGuestSession();
}

// The other half of the above, after the reload that interrupted it.
function sayIfDiscarded() {
  let flagged = false;
  try {
    flagged = sessionStorage.getItem(DISCARD_KEY) === '1';
    if (flagged) sessionStorage.removeItem(DISCARD_KEY);
  } catch {
    return;
  }
  if (flagged) {
    showToast("Guest games aren't added when you log in to an existing account.", { info: true });
  }
}

// The session's matches, handed over.
//
// Everything that decides whether this credits anything happens on the
// server - see the `refreshIdentity` handler in server/sockets.js. This end
// sends a token and reports what came back, and the one number it trusts is
// the one the server returned: a client that counted for itself would be
// claiming a result rather than reading one.
// The name the table knows them by, brought up to date with the name they
// just chose.
//
// The server names a player once, when it first creates their row, and never
// again except on a deliberate rename. On the upgrade path that first time
// was while they were still a guest - same account, same id, same row - so
// picking a name during sign-up changed the profile and left the table still
// calling them Guest2144. This is that deliberate rename, made on their
// behalf at the one moment it is unambiguously what they meant.
async function syncTableName() {
  const wanted = auth.displayName.value;
  if (!wanted || wanted === user.value?.username) return;
  try {
    const res = await emitAck('setName', { name: wanted });
    if (user.value) user.value.username = res.name;
  } catch {
    // Refused - most likely somebody at this table already answers to it.
    // They keep the name they had and can change it from their profile;
    // interrupting a sign-up over it would be worse than the wrong name.
  }
}

async function creditGuestSession() {
  try {
    const res = await emitAck('refreshIdentity', { token: auth.accessToken.value });
    if (res?.credited > 0) {
      const n = res.credited;
      return showToast(`Added ${n} game${n === 1 ? '' : 's'} from this session to your stats.`, {
        info: true,
        atPage: true,
      });
    }
  } catch {
    // The account is made and they are still at their seat; only the
    // crediting failed, and the server has kept the results for the rest of
    // the session. Saying the account was created is both true and the part
    // they asked for.
  }
  showToast('Account created — your games now count towards your stats.', {
    info: true,
    atPage: true,
  });
}

// Once identified, go straight back to your table if you were in one (after a
// page refresh, say), otherwise follow the link that brought you here,
// otherwise the lobby.
// The game server will not have this player, and no better token could be
// got: the Supabase session behind it is gone - rotated, signed out
// elsewhere, or cleared - while storage still held something that looked
// like one. Nothing here can mend that; what it can do is stop pretending to
// be loading and put the way back in front of them.
let sessionGone = false;

async function sessionRefused() {
  if (sessionGone) return;
  sessionGone = true;
  // So the watcher on `auth.session` doesn't say it a second time.
  signingOut = true;
  try {
    await auth.signOut();
  } catch {
    // The dead session is being dropped either way.
  }
  signingOut = false;
  landOnHomepage({ toast: 'Your session expired — log in again to sit down.' });
}

async function enter() {
  try {
    const res = await emitAck('whoami');
    user.value = res.user;
    // Signing in underneath a profile link leaves the reader where they
    // are. The handshake decides the bar, not the page: a link somebody was
    // given should not turn into the lobby because they happened to have a
    // session.
    if (profileName.value) {
      view.value = 'profile';
      if (res.currentRoom) roomCode.value = res.currentRoom;
      return;
    }
    // Pressed while this was in the air. Their seat is remembered either way,
    // so Back and a refresh still return to it; they are simply not carried
    // there against a choice they made in the meantime.
    const chose = chosenWhileBooting;
    chosenWhileBooting = null;
    if (chose) {
      if (res.currentRoom) roomCode.value = res.currentRoom;
      notice.value = '';
      view.value = chose;
      return;
    }
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
    // The handshake was refused over a session that cannot be renewed.
    // sessionRefused has already put them on the homepage with the reason;
    // a shut screen on top of it would blame the server for saying no.
    if (err.reason === 'unauthorized') return;
    // Reaching here means identity was settled and the socket still gave
    // nothing back - a timeout, or a handshake it refused. Either way the
    // server exists, so this is not "nobody at the door".
    blockFor('no-answer', err.message);
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
  setTokenSource(() => null, () => null);
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
        // Their session's matches go now rather than at the end of the
        // grace period: they have just said they are done being this guest,
        // and nobody else may ever be credited with what this one played.
        await forgetGuestResultsNow();
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

// A guest this browser makes for itself, with no account server in it.
//
// The same thing the SKIP_AUTH boot path does, and for the same reason: the
// game server deals the cards and keeps the chips, and it will take a player
// who is nobody in particular. There is no token, so nothing here is signed
// in - `guest` is what the rest of the page reads to know that.
function playOffline() {
  authOpen.value = false;
  landingError.value = '';
  guest.value = true;
  setGuestName(tabGuestName());
  return enter();
}

// The landing page's "Play as guest". The same anonymous sign-in the sheet
// offers, reached without opening the sheet at all.
//
// With no account server in reach it falls through to a guest of this
// browser's own making, where the game server will take one. An evening of
// poker on a laptop with no internet should not be stopped by an account
// nobody needs: there is nothing to sign in to, and nothing to sign in for.
async function playAsGuest() {
  if (landingBusy.value) return;
  landingBusy.value = true;
  landingError.value = '';
  try {
    if (!supabaseConfigured) return await playOffline();
    await auth.continueAsGuest();
    onAuthed();
  } catch (err) {
    if (err.offline && offlineGuests.value) {
      try {
        return await playOffline();
      } catch (e) {
        landingError.value = e.message;
        return;
      }
    }
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

// Back and forward across a profile link. The only history this app pushes,
// so the question is only ever "is this a profile address or not".
function onPopState() {
  const name = readProfilePath();
  profileName.value = name;
  if (name) return (view.value = 'profile');
  // Off a profile and back to whatever they were doing. A seat they still
  // hold wins over the lobby, the same way a refresh resolves it.
  if (view.value === 'profile') {
    view.value = roomCode.value ? 'table' : auth.signedIn.value ? 'lobby' : 'home';
  }
}

onMounted(() => {
  sayIfDiscarded();
  boot();
  window.addEventListener('popstate', onPopState);
  window.addEventListener('beforeunload', dropSocket);
});
onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState);
  window.removeEventListener('beforeunload', dropSocket);
});
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
      :active="barActive"
      @pick="onMenuPick"
      @nav="onNav"
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
    <!-- Two different dead ends, which used to share one sentence. One is a
         server with no way in configured; the other is a server that was
         there a moment ago and isn't answering now - and that one is worth
         trying again rather than reloading. -->
    <div v-if="blockedKind === 'no-answer'" class="shut-say">
      <span class="kicker">No reply</span>
      <h1 class="display">The table isn’t answering.</h1>
      <p class="lead">
        The page is here, but nothing came back from the game server. It may be restarting, or
        it may have stopped.
      </p>
      <p class="help-text">
        If you’re running it yourself, check it’s still up — then try again.
      </p>
      <p v-if="bootError" class="error-text selectable">{{ bootError }}</p>
      <button class="btn btn-primary btn-lg" :disabled="retrying" @click="retry">
        {{ retrying ? 'Trying…' : 'Try again' }}
      </button>
    </div>

    <div v-else class="shut-say">
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
      <button class="btn btn-primary btn-lg" :disabled="retrying" @click="retry">
        {{ retrying ? 'Trying…' : 'Try again' }}
      </button>
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
    @back-to="onBackTo"
    @page="lobbyPage = $event"
  />

    <TableScreen
      v-else-if="view === 'table'"
    :key="roomCode"
    :user="user"
    :room-code="roomCode"
    :notice="notice || null"
    @leave="onLeaveTable"
  />

    <!-- A player's page. Its own address, and the only one here that can be
         opened by somebody who has never seen this app before. -->
    <ProfileView
      v-else-if="view === 'profile'"
      :key="profileName"
      :username="profileName"
      @auth="openAuth"
      @home="goHome"
      @edit="onMenuPick('settings', null, 'profile')"
    />

    <RoomGoneScreen
      v-else-if="view === 'gone'"
      :code="goneCode"
      :user="user"
      :guest="guest"
      @home="view = 'lobby'"
    />

    <!-- The three places worth a thumb, on a phone or a tablet. Hidden on
         the table, where the dock owns the bottom of the screen. -->
    <BottomNav
      v-if="showBottomNav"
      :active="navActive"
      :guest="auth.isGuest.value"
      @pick="onMenuPick"
    />

    <SiteFooter
      v-if="view === 'home' || view === 'lobby' || view === 'boot' || view === 'profile'"
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
    @offline="playOffline"
    @close="authOpen = false"
  />
</template>
