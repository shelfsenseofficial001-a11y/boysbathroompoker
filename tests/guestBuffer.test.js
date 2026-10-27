// The promise a guest is made: their matches are kept for this browser
// session and credited if they sign up before it ends, and otherwise they
// are gone. These are the tests that make that a rule rather than a hope.
const test = require('node:test');
const assert = require('node:assert');
const { GuestBuffer } = require('../server/guestBuffer');

// A clock that only moves when a test moves it, so a ten-minute grace period
// can be tested in no time at all.
function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => (now += ms),
  };
}

const result = (n) => ({ matchId: `m${n}`, netChips: n * 100, endedAt: '2026-01-01T00:00:00.000Z' });

test('append and take: what went in comes back out', () => {
  const buf = new GuestBuffer();
  buf.append('user-1', 'sess-1', result(1));
  buf.append('user-1', 'sess-1', result(2));
  assert.equal(buf.count('user-1', 'sess-1'), 2);
  const taken = buf.take('user-1', 'sess-1');
  assert.equal(taken.length, 2);
  // Taken means gone: a second flush credits nothing.
  assert.equal(buf.count('user-1', 'sess-1'), 0);
  assert.deepEqual(buf.take('user-1', 'sess-1'), []);
});

test('both halves of the key or nothing: a missing session id gets no buffer', () => {
  const buf = new GuestBuffer();
  assert.equal(buf.append('user-1', null, result(1)), false);
  assert.equal(buf.append('user-1', '', result(1)), false);
  assert.equal(buf.append(null, 'sess-1', result(1)), false);
  assert.equal(buf.size, 0);
});

test('the cap keeps the most recent, and drops the oldest', () => {
  const buf = new GuestBuffer({ maxResults: 3 });
  for (let i = 1; i <= 5; i++) buf.append('user-1', 'sess-1', result(i));
  const taken = buf.take('user-1', 'sess-1');
  assert.equal(taken.length, 3);
  assert.deepEqual(
    taken.map((r) => r.matchId),
    ['m3', 'm4', 'm5']
  );
});

test('key isolation: two sessions of the same user never see each other', () => {
  const buf = new GuestBuffer();
  buf.append('user-1', 'sess-1', result(1));
  buf.append('user-1', 'sess-2', result(2));
  assert.equal(buf.count('user-1', 'sess-1'), 1);
  assert.equal(buf.count('user-1', 'sess-2'), 1);
  // This is the rule that stops a reopened browser - same anonymous token,
  // new session id - from claiming a buffer that has already been closed.
  assert.deepEqual(buf.take('user-1', 'sess-1').map((r) => r.matchId), ['m1']);
  assert.equal(buf.count('user-1', 'sess-2'), 1);
});

test('key isolation: two users with the same session id never see each other', () => {
  const buf = new GuestBuffer();
  buf.append('user-1', 'sess-1', result(1));
  buf.append('user-2', 'sess-1', result(2));
  assert.equal(buf.count('user-1', 'sess-1'), 1);
  assert.equal(buf.count('user-2', 'sess-1'), 1);
});

test('grace period: dropped once it has passed with nobody connected', () => {
  const clock = fakeClock();
  const buf = new GuestBuffer({ graceMs: 10 * 60 * 1000, now: clock.now });
  buf.connected('user-1', 'sess-1');
  buf.append('user-1', 'sess-1', result(1));
  buf.disconnected('user-1', 'sess-1');

  clock.advance(9 * 60 * 1000);
  assert.equal(buf.count('user-1', 'sess-1'), 1, 'still inside the grace period');

  clock.advance(2 * 60 * 1000);
  assert.equal(buf.count('user-1', 'sess-1'), 0, 'past it, and gone');
});

test('grace period: a refresh costs nothing, because the clock restarts', () => {
  const clock = fakeClock();
  const buf = new GuestBuffer({ graceMs: 10 * 60 * 1000, now: clock.now });
  buf.connected('user-1', 'sess-1');
  buf.append('user-1', 'sess-1', result(1));

  // The shape of a refresh: gone, and back a moment later.
  buf.disconnected('user-1', 'sess-1');
  clock.advance(1000);
  buf.connected('user-1', 'sess-1');

  clock.advance(60 * 60 * 1000); // an hour at the table
  assert.equal(buf.count('user-1', 'sess-1'), 1, 'a connected session never expires');
});

test('grace period: a long match does not outlive its own results', () => {
  const clock = fakeClock();
  const buf = new GuestBuffer({ graceMs: 10 * 60 * 1000, now: clock.now });
  buf.connected('user-1', 'sess-1');
  clock.advance(45 * 60 * 1000);
  buf.append('user-1', 'sess-1', result(1));
  assert.equal(buf.count('user-1', 'sess-1'), 1);
});

test('two sockets: the clock runs from the last one to go', () => {
  const clock = fakeClock();
  const buf = new GuestBuffer({ graceMs: 10 * 60 * 1000, now: clock.now });
  buf.connected('user-1', 'sess-1');
  buf.connected('user-1', 'sess-1'); // a second tab
  buf.append('user-1', 'sess-1', result(1));

  buf.disconnected('user-1', 'sess-1');
  clock.advance(30 * 60 * 1000);
  assert.equal(buf.count('user-1', 'sess-1'), 1, 'one tab is still open');

  buf.disconnected('user-1', 'sess-1');
  clock.advance(11 * 60 * 1000);
  assert.equal(buf.count('user-1', 'sess-1'), 0);
});

test('drop: a logout, or a login to an account that already exists', () => {
  const buf = new GuestBuffer();
  buf.append('user-1', 'sess-1', result(1));
  buf.drop('user-1', 'sess-1');
  assert.equal(buf.count('user-1', 'sess-1'), 0);
  assert.deepEqual(buf.take('user-1', 'sess-1'), []);
});

test('restore: a failed write puts them back, all of them', () => {
  const buf = new GuestBuffer();
  buf.append('user-1', 'sess-1', result(1));
  buf.append('user-1', 'sess-1', result(2));
  const taken = buf.take('user-1', 'sess-1');
  assert.equal(buf.count('user-1', 'sess-1'), 0);

  buf.restore('user-1', 'sess-1', taken);
  assert.equal(buf.count('user-1', 'sess-1'), 2);
});

test('the buffer cap drops idle sessions rather than growing without limit', () => {
  const clock = fakeClock();
  const buf = new GuestBuffer({ maxBuffers: 3, now: clock.now });
  for (let i = 1; i <= 3; i++) {
    buf.append(`user-${i}`, `sess-${i}`, result(i));
    clock.advance(1000);
  }
  assert.equal(buf.size, 3);
  buf.append('user-4', 'sess-4', result(4));
  assert.ok(buf.size <= 3, 'never more than the cap');
  // The oldest idle one is the one that went.
  assert.equal(buf.count('user-1', 'sess-1'), 0);
  assert.equal(buf.count('user-4', 'sess-4'), 1);
});

test('a session with a live socket is not evicted to make room', () => {
  const clock = fakeClock();
  const buf = new GuestBuffer({ maxBuffers: 2, now: clock.now });
  buf.connected('user-1', 'sess-1');
  buf.append('user-1', 'sess-1', result(1));
  clock.advance(1000);
  buf.append('user-2', 'sess-2', result(2));
  clock.advance(1000);
  buf.append('user-3', 'sess-3', result(3));

  assert.equal(buf.count('user-1', 'sess-1'), 1, 'still connected, so still here');
});
