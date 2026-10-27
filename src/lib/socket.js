// Single shared Socket.io connection, created lazily once we know who we are.
import { io } from 'socket.io-client';
import { guestSessionId } from './guestSession.js';

let socket = null;
let guestName = null;
let getToken = null;
let profileName = null;

// In guest mode (SKIP_AUTH) the socket identifies itself by a per-tab name
// instead of the session cookie, so several tabs can be different players.
export function setGuestName(name) {
  guestName = name;
}

// The Supabase guest's access token. A getter rather than the token itself,
// because the handshake is rebuilt on every reconnect and the token it needs
// then is the refreshed one, not the one that was current at boot.
export function setTokenSource(fn, name = null) {
  getToken = fn;
  profileName = name;
}

export function getSocket() {
  if (!socket) {
    socket = io({
      // Called afresh for each connection attempt, so a reconnect after a
      // token refresh carries the new token.
      auth: (cb) => {
        const payload = {};
        const token = getToken?.();
        if (token) {
          payload.token = token;
          // The name to show. Verified against the same rule as a rename on
          // the server, which does not take it on trust.
          if (profileName) payload.name = profileName;
        }
        if (guestName) payload.guestName = guestName;
        // Which browser session this is, so a guest's finished matches can be
        // held for it and credited if they sign up before it ends. Sent on
        // every connection attempt because the handshake is rebuilt each
        // time, and a reconnect has to land on the same buffer it left.
        payload.guestSessionId = guestSessionId();
        cb(payload);
      },
    });
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
