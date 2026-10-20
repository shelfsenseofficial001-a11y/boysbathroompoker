// Top-level view router: auth screen -> lobby -> table.
import { api } from './api.js';
import { renderAuth } from './auth.js';
import { renderLobby } from './lobby.js';
import { renderTable } from './table.js';
import { getSocket, setGuestName, emitAck } from './socket.js';
import { applyMotionClass } from './motion.js';

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

// Once identified, go straight back to your table if you were in one
// (e.g. after a page refresh), otherwise to the lobby.
async function enter() {
  const res = await emitAck('whoami');
  state.user = res.user;
  if (res.currentRoom) {
    state.roomCode = res.currentRoom;
    showTable();
  } else {
    showLobby();
  }
}

function showAuth() {
  renderAuth(root, { onAuthed: () => enter() });
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
    onEnterRoom: (code) => {
      state.roomCode = code;
      showTable();
    },
  });
}

function showTable() {
  renderTable(root, {
    user: state.user,
    roomCode: state.roomCode,
    onLeave: (notice) => {
      state.roomCode = null;
      showLobby(notice);
    },
  });
}

// Keep the socket alive across view changes once logged in.
window.addEventListener('beforeunload', () => {
  try { getSocket().disconnect(); } catch {}
});

boot();
