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

// A server with no handler for an event simply never calls the ack, so
// without this the promise sits there for ever and the click looks like it
// did nothing at all. Usually it means the server is running an older build
// than the page, which is worth saying out loud.
const ACK_TIMEOUT_MS = 8000;

export function emitAck(event, payload = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('No answer from the server — it may need restarting.'));
    }, ACK_TIMEOUT_MS);
    getSocket().emit(event, payload, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res && res.ok === false) {
        const err = new Error(res.error || 'Action failed.');
        // Why it was refused, where the server said so in a word a caller
        // can branch on rather than matching the message text.
        if (res.reason) err.reason = res.reason;
        return reject(err);
      }
      else resolve(res);
    });
  });
}
