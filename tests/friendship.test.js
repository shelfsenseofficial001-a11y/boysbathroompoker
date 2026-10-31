// One friendships row, read from either end. Migration 0007 decides what the
// row holds; these keep the page reading it the same way.
const test = require('node:test');
const assert = require('node:assert');
const { friendshipState } = require('../shared/friendship.mjs');

const A = 'a';
const B = 'b';

test('friendshipState: no row is no friendship', () => {
  assert.equal(friendshipState(null, A), 'none');
  assert.equal(friendshipState(undefined, A), 'none');
});

test('friendshipState: nobody signed in has no side to read it from', () => {
  assert.equal(friendshipState({ user_id: A, friend_id: B, status: 'accepted' }, null), 'none');
});

test('friendshipState: a request reads as sent by the asker and received by the asked', () => {
  const row = { user_id: A, friend_id: B, status: 'pending' };
  assert.equal(friendshipState(row, A), 'sent');
  assert.equal(friendshipState(row, B), 'received');
});

test('friendshipState: accepted is friends from both ends', () => {
  const row = { user_id: A, friend_id: B, status: 'accepted' };
  assert.equal(friendshipState(row, A), 'friends');
  assert.equal(friendshipState(row, B), 'friends');
});

test('friendshipState: a block is the blocker\'s to see and nobody else\'s', () => {
  const row = { user_id: A, friend_id: B, status: 'blocked' };
  assert.equal(friendshipState(row, A), 'blocked');
  // RLS should never hand B this row; if something does, it still reads as nothing.
  assert.equal(friendshipState(row, B), 'none');
});

test('friendshipState: a status it does not know is nothing, not a guess', () => {
  assert.equal(friendshipState({ user_id: A, friend_id: B, status: 'muted' }, A), 'none');
});
