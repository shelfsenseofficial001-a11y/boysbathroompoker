// Single shared Socket.io connection, created lazily after login.
let socket = null;
let guestName = null;

// In guest mode (SKIP_AUTH) the socket identifies itself by a per-tab name
// instead of the session cookie, so several tabs can be different players.
export function setGuestName(name) {
  guestName = name;
}

export function getSocket() {
  if (!socket) {
    socket = guestName ? window.io({ auth: { guestName } }) : window.io();
  }
  return socket;
}

export function emitAck(event, payload = {}) {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (res) => {
      if (res && res.ok === false) reject(new Error(res.error || 'Action failed.'));
      else resolve(res);
    });
  });
}
