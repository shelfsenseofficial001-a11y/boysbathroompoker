// The friends list's "last seen", and where online stops.
const test = require('node:test');
const assert = require('node:assert');
const { ONLINE_WITHIN, isOnline, lastSeenLabel } = require('../shared/lastSeen.mjs');

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
const at = (secs) => lastSeenLabel(secs, { now, locale: 'en-US' });

test('isOnline: inside the window is online, the edge of it is not', () => {
  assert.equal(isOnline(0), true);
  assert.equal(isOnline(ONLINE_WITHIN - 1), true);
  assert.equal(isOnline(ONLINE_WITHIN), false);
});

test('isOnline: never seen is not online', () => {
  assert.equal(isOnline(null), false);
  assert.equal(isOnline(undefined), false);
  assert.equal(isOnline(NaN), false);
});

test('lastSeenLabel: under a minute is just now', () => {
  assert.equal(at(0), 'just now');
  assert.equal(at(59), 'just now');
});

test('lastSeenLabel: minutes, then hours, then days, rounded down', () => {
  assert.equal(at(MIN), '1m ago');
  assert.equal(at(5 * MIN + 59), '5m ago');
  assert.equal(at(59 * MIN), '59m ago');
  assert.equal(at(HOUR), '1h ago');
  assert.equal(at(23 * HOUR + 59 * MIN), '23h ago');
  assert.equal(at(DAY), '1d ago');
  assert.equal(at(6 * DAY + 23 * HOUR), '6d ago');
});

test('lastSeenLabel: a week or more is the date', () => {
  assert.equal(at(7 * DAY), 'Oct 24');
  assert.equal(at(30 * DAY), 'Oct 1');
});

test('lastSeenLabel: another year says which', () => {
  assert.equal(at(365 * DAY), 'Oct 31, 2025');
});

test('lastSeenLabel: never seen says offline rather than a made-up time', () => {
  assert.equal(at(null), 'Offline');
});

test('lastSeenLabel: a negative age from a skewed clock is just now', () => {
  assert.equal(at(-30), 'just now');
});
