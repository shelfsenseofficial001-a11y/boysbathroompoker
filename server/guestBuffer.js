// What a guest's matches are worth before they are anybody.
//
// A guest's results are never written to a database. They are held here, in
// memory, for the length of one browser session, and they go one of two
// ways: credited to an account if the guest signs up before the session
// ends, or dropped and forgotten if it ends first. There is no third way,
// and in particular there is no row sitting in a table waiting to be
// claimed by whoever turns up with the right id.
//
// Two things make that honest rather than merely intended:
//
//   The key is (verified user id, guestSessionId). The first half comes off
//   a verified token and cannot be chosen by the browser. The second is a
//   random id the tab makes once per browser session and keeps in
//   sessionStorage, so the anonymous Supabase token - which lives in
//   localStorage and outlives the tab - cannot be used to reclaim a buffer
//   from a session that has already ended.
//
//   Nothing in here is ever written by the client. The server appends what
//   the table reports at the end of a match, and the flush is driven by the
//   server re-verifying the token for itself.
//
// Dependency-free and injectable (`now`), so the expiry rules can be tested
// without waiting ten minutes for them.

const GRACE_MS = 10 * 60 * 1000; // after the last disconnect
const MAX_RESULTS = 50; // per guest session
const MAX_BUFFERS = 500; // across the server

class GuestBuffer {
  constructor({
    graceMs = GRACE_MS,
    maxResults = MAX_RESULTS,
    maxBuffers = MAX_BUFFERS,
    now = () => Date.now(),
  } = {}) {
    this.graceMs = graceMs;
    this.maxResults = maxResults;
    this.maxBuffers = maxBuffers;
    this.now = now;
    // key -> { results: [], sockets: number, lastSeen: number }
    this.buffers = new Map();
  }

  // Both halves or nothing. A missing session id is not a key with one half
  // missing - it is a client that cannot be told apart from the next one,
  // and it gets no buffer at all.
  static key(userId, sessionId) {
    const uid = String(userId ?? '').trim();
    const sid = String(sessionId ?? '').trim();
    if (!uid || !sid) return null;
    return `${uid}\u0000${sid}`;
  }

  _entry(key, make = false) {
    let entry = this.buffers.get(key);
    if (!entry && make) {
      entry = { results: [], sockets: 0, lastSeen: this.now() };
      this.buffers.set(key, entry);
    }
    return entry || null;
  }

  // A guest's socket arrived. While at least one is connected the buffer
  // cannot expire, so a long match never outlives its own results.
  connected(userId, sessionId) {
    const key = GuestBuffer.key(userId, sessionId);
    if (!key) return;
    const entry = this._entry(key, true);
    entry.sockets += 1;
    entry.lastSeen = this.now();
  }

  // ...and went. The clock starts from the last one, so a refresh - which is
  // a disconnect followed a second later by a connect - costs nothing.
  disconnected(userId, sessionId) {
    const key = GuestBuffer.key(userId, sessionId);
    if (!key) return;
    const entry = this._entry(key);
    if (!entry) return;
    entry.sockets = Math.max(0, entry.sockets - 1);
    entry.lastSeen = this.now();
  }

  // One finished match. Returns true if it was kept.
  //
  // The cap drops the oldest rather than refusing the newest: a session long
  // enough to overflow it is one where the recent matches are the ones worth
  // crediting.
  append(userId, sessionId, result) {
    const key = GuestBuffer.key(userId, sessionId);
    if (!key || !result) return false;
    this.sweep();
    // Asked before the entry is made, not after: `_entry(key, true)` would
    // have created the very buffer the cap is meant to refuse, and the test
    // for "is this new" would then always say no.
    if (!this.buffers.has(key) && this.buffers.size >= this.maxBuffers) {
      // Room for one more, not merely "down to the cap". `_capBuffers` is
      // the wrong tool here and said so by doing nothing: it stops the
      // moment size equals the cap, which is exactly the state this is
      // trying to get out of.
      this._evictIdle(this.maxBuffers - 1);
      if (this.buffers.size >= this.maxBuffers) return false;
    }
    const entry = this._entry(key, true);
    entry.results.push(result);
    if (entry.results.length > this.maxResults) {
      entry.results.splice(0, entry.results.length - this.maxResults);
    }
    entry.lastSeen = this.now();
    this._capBuffers();
    return true;
  }

  // How many are waiting, for the one line the sign-up sheet shows a guest.
  // A count and never the contents: the client has no business knowing what
  // it is about to be credited with, only that there is something.
  count(userId, sessionId) {
    this.sweep();
    const key = GuestBuffer.key(userId, sessionId);
    if (!key) return 0;
    return this._entry(key)?.results.length || 0;
  }

  // Hand the results over and forget them, in one step. A caller that read
  // them and then deleted them could be interrupted between the two and
  // credit the same session twice; the unique (user_id, match_id) index is
  // the other half of that guarantee, for the case where the write itself
  // is retried.
  take(userId, sessionId) {
    this.sweep();
    const key = GuestBuffer.key(userId, sessionId);
    if (!key) return [];
    const entry = this._entry(key);
    if (!entry) return [];
    this.buffers.delete(key);
    return entry.results;
  }

  // Put them back, because the write did not happen. Credit is all-or-
  // nothing: a half-credited account is worse than an uncredited one, since
  // nothing afterwards knows which half it has.
  restore(userId, sessionId, results) {
    const key = GuestBuffer.key(userId, sessionId);
    if (!key || !results?.length) return;
    const entry = this._entry(key, true);
    entry.results = [...results, ...entry.results].slice(-this.maxResults);
    entry.lastSeen = this.now();
  }

  // Thrown away unread: a logout, or a guest who logged in to an account
  // that already existed. Those matches were played by somebody who no
  // longer exists, and they belong to nobody.
  drop(userId, sessionId) {
    const key = GuestBuffer.key(userId, sessionId);
    if (key) this.buffers.delete(key);
  }

  // Everything past its grace period, gone. Called on every way in, so a
  // server nobody is using is not holding results nobody can claim.
  sweep() {
    const cutoff = this.now() - this.graceMs;
    for (const [key, entry] of this.buffers) {
      if (entry.sockets > 0) continue;
      if (entry.lastSeen <= cutoff) this.buffers.delete(key);
    }
  }

  _capBuffers() {
    this._evictIdle(this.maxBuffers);
  }

  // Down to `target`, when sweeping has not got there on its own: longest
  // idle goes first, and a buffer with a live socket is never one of them -
  // somebody is still playing into it.
  _evictIdle(target) {
    if (this.buffers.size <= target) return;
    const idle = [...this.buffers.entries()]
      .filter(([, entry]) => entry.sockets === 0)
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (const [key] of idle) {
      if (this.buffers.size <= target) break;
      this.buffers.delete(key);
    }
  }

  // For the tests, and for anything that wants to know how much is being
  // held without reaching into the map.
  get size() {
    return this.buffers.size;
  }
}

module.exports = { GuestBuffer, GRACE_MS, MAX_RESULTS, MAX_BUFFERS };
