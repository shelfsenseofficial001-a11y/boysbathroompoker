// Single shared Socket.io connection, created lazily once we know who we are.
import { io } from 'socket.io-client';
import { guestSessionId } from './guestSession.js';

let socket = null;
let retried = 0; // handshakes refused since the last one that got through
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

// How to come by a better token when the one in hand is refused, and what to
// do when there is no better token to be had. See the connect_error handler
// below for why either is a thing that happens.
let renew = null;
let onRefused = null;
export function setTokenRenewer(fn) {
  renew = fn;
}
export function setHandshakeRefused(fn) {
  onRefused = fn;
}

// Callers sitting on a connection that has not come up yet. A door that has
// finally been shut in our face is their answer too - without this they wait
// out their own clock and report a server that is, in fact, answering.
const waiting = new Set();

function failWaiting() {
  for (const fail of [...waiting]) {
    const err = new Error('This session is no longer signed in.');
    err.reason = 'unauthorized';
    fail(err);
  }
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

// A socket that was refused and gave up is not going to try again on its
// own: socket.io leaves a connection its middleware rejected closed for
// good. Somebody signing in afresh is a new handshake with a new token, not
// the corpse of the last one, so the old socket is thrown away and the next
// getSocket builds one.
export function reviveSocket() {
  retried = 0;
  if (socket && !socket.connected && !socket.active) resetSocket();
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

    // The handshake was refused. Nearly always this is a session the auth
    // server has rotated out from under the token sitting in storage: it
    // still looks like a session to the browser, and only the server it is
    // shown to can tell that it is dead. A reload used to fix it, which is
    // what people did - twice, usually, because the first one sent the same
    // dead token again.
    //
    // socket.io does not retry a connection its middleware refused, so this
    // asks for a fresh token and connects again itself. Twice at most: a
    // refusal that survives two good tokens is about something else, and the
    // screens that wait on this say so rather than looping.
    socket.on('connect_error', async (err) => {
      // Still trying on its own - this was the network, not the door.
      if (socket.active) return;
      if (err?.message !== 'unauthorized') return;

      // A token this browser is holding that the auth server has stopped
      // standing behind: the session it names was rotated, signed out or
      // cleared, and nothing in storage shows that. Only the server it is
      // presented to can tell. socket.io does not retry a handshake its
      // middleware refused, so a fresh token is asked for and the connection
      // made again here.
      let better = null;
      if (renew && retried < 2) {
        retried += 1;
        try {
          better = await renew();
        } catch {
          // Treated as no token at all, below.
        }
      }
      if (better) return socket.connect();

      // There is no signing this player back in from here: the refresh
      // itself was refused, which means the session is gone rather than
      // stale. Said plainly and at once. Waiting instead is what put a
      // skeleton on screen until a clock ran out and then blamed the game
      // server, which had done nothing but check a token and say no.
      failWaiting();
      onRefused?.();
    });
    socket.on('connect', () => {
      retried = 0;
    });
  }
  return socket;
}

// A server with no handler for an event simply never calls the ack, so
// without this the promise sits there for ever and the click looks like it
// did nothing at all. Usually it means the server is running an older build
// than the page, which is worth saying out loud.
const ACK_TIMEOUT_MS = 8000;

// The clock above measures an answer from a server that is already listening.
// It is the wrong clock for a connection that has not come up yet - a
// handshake refused over a stale token is renewed and tried again, and that
// is two network round trips before this socket is in a position to answer
// anything. Timing those out as "no answer from the server" is what put the
// shut screen in front of people whose only problem was an old token: it
// said the server had stopped, while the server was refusing them politely
// and the retry that would have worked was still in flight.
const CONNECT_GRACE_MS = 14000;

export function emitAck(event, payload = {}) {
  const sock = getSocket();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const bail = (err) => finish(reject, err);
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiting.delete(bail);
      sock.off('connect', onConnect);
      fn(arg);
    };
    function armAck() {
      clearTimeout(timer);
      timer = setTimeout(
        () => finish(reject, new Error('No answer from the server — it may need restarting.')),
        ACK_TIMEOUT_MS
      );
    }
    function onConnect() {
      sock.off('connect', onConnect);
      if (!settled) send();
    }
    const send = () => {
      armAck();
      sock.emit(event, payload, (res) => {
        if (res && res.ok === false) {
          const err = new Error(res.error || 'Action failed.');
          // Why it was refused, where the server said so in a word a caller
          // can branch on rather than matching the message text.
          if (res.reason) err.reason = res.reason;
          return finish(reject, err);
        }
        finish(resolve, res);
      });
    };
    if (sock.connected) return send();
    // Closed and not trying: a refusal it has given up on, or a disconnect
    // nobody asked about since. Ask once more rather than wait out the clock
    // on a socket that has stopped reaching for the server.
    if (!sock.active) sock.connect();
    // Sent when the connection is up, rather than handed to socket.io now to
    // hold. Its own buffer is emptied when a connection ends, and a handshake
    // the server refuses ends one - so the first question this app asks, on a
    // token that turns out to be stale, went into that buffer and was thrown
    // away by the refusal it caused. The retry connected to a server with
    // nothing left to answer, and the page waited out the clock below for a
    // reply nobody was ever going to send.
    timer = setTimeout(
      () => finish(reject, new Error('No answer from the server — it may need restarting.')),
      CONNECT_GRACE_MS
    );
    waiting.add(bail);
    sock.on('connect', onConnect);
  });
}
