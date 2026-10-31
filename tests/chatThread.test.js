// How a chat thread is laid out: bursts, runs, faces and "Seen".
const test = require('node:test');
const assert = require('node:assert');
const { GAP_SECS, MESSAGE_MAX, threadItems, chatTimeLabel, cleanMessage } = require('../shared/chatThread.mjs');

const ME = 'me';
const THEM = 'them';
const base = Date.UTC(2026, 9, 31, 14, 0, 0);
let nextId = 1;
const msg = (sender, secs, extra = {}) => ({
  id: nextId++,
  sender_id: sender,
  created_at: new Date(base + secs * 1000).toISOString(),
  read_at: null,
  ...extra,
});
const shape = (items) =>
  items.map((it) => (it.type === 'time' ? 'T' : `${it.mine ? 'M' : 'O'}${it.first ? '<' : ''}${it.last ? '>' : ''}${it.seen ? '*' : ''}`));

test('threadItems: nothing to draw is nothing', () => {
  assert.deepEqual(threadItems([], ME), []);
  assert.deepEqual(threadItems(null, ME), []);
});

test('threadItems: one burst opens with a time, runs group by sender', () => {
  const items = threadItems([msg(THEM, 0), msg(THEM, 5), msg(ME, 10), msg(ME, 20), msg(THEM, 30)], ME);
  assert.deepEqual(shape(items), ['T', 'O<', 'O>', 'M<', 'M>', 'O<>']);
});

test('threadItems: a long pause starts a new burst and breaks the run', () => {
  const items = threadItems([msg(THEM, 0), msg(THEM, GAP_SECS + 1)], ME);
  assert.deepEqual(shape(items), ['T', 'O<>', 'T', 'O<>']);
});

test('threadItems: a pause of exactly the gap stays in the burst', () => {
  const items = threadItems([msg(THEM, 0), msg(THEM, GAP_SECS)], ME);
  assert.deepEqual(shape(items), ['T', 'O<', 'O>']);
});

test('threadItems: Seen goes on my latest message only, once it is read', () => {
  const unread = threadItems([msg(ME, 0, { read_at: 'x' }), msg(ME, 5)], ME);
  assert.deepEqual(shape(unread), ['T', 'M<', 'M>']);
  const read = threadItems([msg(ME, 0, { read_at: 'x' }), msg(ME, 5, { read_at: 'x' }), msg(THEM, 9)], ME);
  assert.deepEqual(shape(read), ['T', 'M<', 'M>*', 'O<>']);
});

test('threadItems: their read messages are never marked Seen', () => {
  assert.deepEqual(shape(threadItems([msg(THEM, 0, { read_at: 'x' })], ME)), ['T', 'O<>']);
});

test('chatTimeLabel: today is the time, this week the day, then the date', () => {
  const now = new Date(2026, 9, 31, 18, 0).getTime(); // a Saturday
  const opts = { now, locale: 'en-US' };
  assert.equal(chatTimeLabel(new Date(2026, 9, 31, 14, 38), opts), '2:38 PM');
  assert.equal(chatTimeLabel(new Date(2026, 9, 27, 9, 5), opts), 'Tue 9:05 AM');
  assert.equal(chatTimeLabel(new Date(2026, 9, 12, 14, 38), opts), 'Oct 12, 2:38 PM');
  assert.equal(chatTimeLabel(new Date(2025, 9, 12, 14, 38), opts), 'Oct 12, 2025, 2:38 PM');
});

test('cleanMessage: trims the ends and keeps the lines inside', () => {
  assert.equal(cleanMessage('  hi  '), 'hi');
  assert.equal(cleanMessage('one\r\ntwo'), 'one\ntwo');
});

test('cleanMessage: blank or too long sends nothing', () => {
  assert.equal(cleanMessage('   \n '), null);
  assert.equal(cleanMessage(null), null);
  assert.equal(cleanMessage('x'.repeat(MESSAGE_MAX)).length, MESSAGE_MAX);
  assert.equal(cleanMessage('x'.repeat(MESSAGE_MAX + 1)), null);
});
