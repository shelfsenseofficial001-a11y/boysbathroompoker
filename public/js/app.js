// Top-level view router: auth screen -> lobby -> table.
import { api } from './api.js';
import { renderAuth } from './auth.js';
import { renderLobby } from './lobby.js';
import { renderTable } from './table.js';
import { getSocket, setGuestName, emitAck } from './socket.js';
import { applyMotionClass } from './motion.js';
import { showToast } from './toast.js';

applyMotionClass();

// Belt-and-braces with the CSS user-select rules: block text selection (and
// double-click word selection) everywhere except inputs, error messages and
// the room code, so dragging chips or tapping the felt never highlights text.
const SELECTABLE = 'input, textarea, .selectable, .error-text';
document.addEventListener('selectstart', (e) => {
  if (!(e.target instanceof Element ? e.target : e.target.parentElement)?.closest(SELECTABLE)) e.preventDefault();
});
document.addEventListener('mousedown', (e) => {
  if (e.detail > 1 && !e.target.closest(SELECTABLE)) e.preventDefault();
});

const root = document.getElementById('app');

const state = {
  user: null, // { id, username, bankroll }
  roomCode: null,
};

// Per-tab guest name, kept in sessionStorage so a refresh keeps the same player.
function tabGuestName() {
  let name = null;
  try { name = sessionStorage.getItem('guestName'); } catch {}
  if (!name) {
    name = 'guest_' + Math.random().toString(36).slice(2, 7);
    try { sessionStorage.setItem('guestName', name); } catch {}
  }
  return name;
}

async function boot() {
  const config = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  if (config.skipAuth) {
    state.guest = true;
    setGuestName(tabGuestName());
    return enter();
  }
  try {
    await api.me();
    enter();
  } catch {
    showAuth();
  }
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

// Once identified, go straight back to your table if you were in one
// (e.g. after a page refresh), otherwise follow the link that brought them
// here, otherwise the lobby.
async function enter() {
  const res = await emitAck('whoami');
  state.user = res.user;
  const invite = takeInvite();
  if (res.currentRoom) {
    state.roomCode = res.currentRoom;
    return showTable();
  }
  if (invite) return followInvite(invite);
  showLobby();
}

// A link does the whole job: a seat if the game hasn't started, a seat from
// the next hand if it has, and past the door of a private room, because the
// host handing out the link is the invitation.
async function followInvite({ code, invite }) {
  try {
    const res = await emitAck('joinRoom', { code, invite });
    state.roomCode = res.code;
    showTable(
      res.waiting
        ? `Joining with ${Number(res.chips).toLocaleString('en-US')} chips — you'll be dealt in next hand.`
        : null
    );
  } catch (err) {
    if (err.reason === 'no-room') return showRoomGone(code);
    // Refused for a reason of its own (name taken, table full, blocked):
    // the lobby is where they can do something about it.
    showLobby(err.message);
  }
}

function showAuth() {
  renderAuth(root, { onAuthed: () => enter() });
}

// The link outlived the room. Rooms are held in memory for as long as
// someone is in them, so this is the ordinary end of every link rather than
// a fault, and it says so instead of showing a bare error.
function showRoomGone(code) {
  root.innerHTML = `<div class="screen">
    <header class="topbar">
      <button class="btn btn-primary btn-sm" data-home>Back to the homepage</button>
    </header>
    <main class="page gone-page">
      <div class="eyebrow">Room not found</div>
      <h1 class="display">That table has packed up.</h1>
      <p class="lead">
        There's no room with the code <b class="gone-code"></b> any more. A room lasts
        only as long as someone is sitting at it: once the host leaves and the
        last player walks away, it closes and its code is gone for good. The
        same happens if the server restarts.
      </p>
      <p class="help-text">Ask whoever sent you for a fresh link, or host a table yourself.</p>
      <div class="gone-actions">
        <button class="btn btn-primary btn-lg" data-home>Go to the homepage</button>
      </div>
    </main>
  </div>`;
  root.querySelector('.gone-code').textContent = code;
  root.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', () => showLobby()));
}

function showLobby(notice) {
  renderLobby(root, {
    user: state.user,
    guest: !!state.guest,
    notice,
    onLogout: async () => {
      if (state.guest) {
        // Guest mode: "log out" just gives this tab a fresh guest identity.
        try { sessionStorage.removeItem('guestName'); } catch {}
      } else {
        await api.logout();
      }
      // Reload so the socket reconnects under the new identity.
      location.reload();
    },
    onEnterRoom: (code, notice) => {
      state.roomCode = code;
      showTable(notice);
    },
  });
}

function showTable(notice) {
  renderTable(root, {
    user: state.user,
    roomCode: state.roomCode,
    notice,
    onLeave: (notice, forced) => {
      state.roomCode = null;
      // Walking out is your own doing and needs no fanfare; being removed
      // happens to you, so it gets said plainly on screen. A toast rather
      // than a sheet: the lobby behind it is where they're going anyway, so
      // there's nothing to decide and nothing worth blocking for.
      showLobby(forced ? null : notice);
      if (forced && notice) showToast(notice, { atPage: true, ms: 7000 });
    },
  });
}

// Keep the socket alive across view changes once logged in.
window.addEventListener('beforeunload', () => {
  try { getSocket().disconnect(); } catch {}
});

boot();
