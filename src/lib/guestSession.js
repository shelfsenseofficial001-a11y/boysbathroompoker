// Which browser session this is.
//
// A guest's finished matches are held on the server for the length of one
// browser session and credited only if they sign up before it ends. That
// promise needs something that ends when the session ends - and the guest's
// Supabase token is not it: it lives in localStorage and deliberately
// outlives the tab, so a browser reopened a week later arrives with the same
// anonymous identity it had before.
//
// sessionStorage is the thing that ends. It is per-tab, it is cleared when
// the browser session does, and a fresh tab gets a fresh one - so results
// from a session that has closed cannot be reclaimed by anybody, which is
// the whole point.
const KEY = 'bbp-guest-session';

// Held here as well as in storage, so a browser that refuses storage still
// gets one id for the life of the page rather than a new one per call.
let cached = null;

function makeId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // No crypto at all: a weaker id is still better than none. It names a
    // buffer on the server and decides nothing about permission - the other
    // half of that key is a verified user id, which this cannot forge.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // base64url, to match the character class the server checks it against.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function guestSessionId() {
  if (cached) return cached;
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return cached;
    }
  } catch {
    // Private mode, or storage turned off. Fall through to a fresh id held
    // in memory: this session simply ends with the page rather than with the
    // browser, which costs a reload and nothing else.
  }
  cached = makeId();
  try {
    sessionStorage.setItem(KEY, cached);
  } catch {
    // Not persisted; the in-memory copy carries it for this page.
  }
  return cached;
}

// Leaving a guest session on purpose. The next connect gets a new id, so
// nothing from before it can be credited to whoever comes next.
export function forgetGuestSession() {
  cached = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored to remove.
  }
}
