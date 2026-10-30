// Single shared Socket.io connection, created lazily once we know who we are.
import { io } from 'socket.io-client';
import { guestSessionId } from './guestSession.js';

let socket = null;
let guestName = null;
let getToken = null;
let getName = null;

// In guest mode (SKIP_AUTH) the socket identifies itself by a per-tab name
// instead of the session cookie, so several tabs can be different players.
export function setGuestName(name) {
  guestName = name;
}

// The Supabase account's access token and display name.
//
// Both are getters rather than values, and the name being a value is what
// made a guest's name follow somebody into their account. The server reads
// the handshake name only when it first creates a players row, so whatever
// is sent on that one connection is the name they are stuck with - and a
// name captured here at sign-in was captured before the new profile had
// loaded, which meant sending the previous one. Read at connect instead, so
// it is whoever the session belongs to by then.
export function setTokenSource(tokenFn, nameFn = null) {
  getToken = tokenFn;
  getName = typeof nameFn === 'function' ? nameFn : () => nameFn;
}

// Throw the connection away so the next getSocket builds a new one.
//
// For the retry on the shut screen. A socket whose server went away keeps
// trying on its own and then gives up, and once it has given up, asking it
// again achieves nothing - which is what made "Try again" look as broken as
// the thing it was offering to fix. A fresh socket means a fresh handshake,
// with whatever token is current by then.
//
// Only safe where nothing is listening on the old one, which on the shut
// screen is the case: there is no table mounted behind it.
export function resetSocket() {
  if (!socket) return;
  try {
    socket.removeAllListeners();
    socket.disconnect();
  } catch {
    // Already gone; the point is only that the next call builds another.
  }
  socket = null;
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
          const name = getName?.();
          if (name) payload.name = name;
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
