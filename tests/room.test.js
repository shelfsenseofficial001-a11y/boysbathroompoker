const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/game/GameManager');

function roomWith(members) {
  const room = new Room(1, 'Host');
  for (const [id, username] of members) room.addToLobby(id, username, 100);
  return room;
}

test('a name already used in the lobby is taken', () => {
  const room = roomWith([[1, 'Sam'], [2, 'Riley']]);
  assert.equal(room.nameTaken('Sam', 3), true);
  assert.equal(room.nameTaken('Riley', 3), true);
  assert.equal(room.nameTaken('Jordan', 3), false);
});

test('your own name is not taken by you', () => {
  const room = roomWith([[1, 'Sam'], [2, 'Riley']]);
  // Sam re-submitting "Sam" must be allowed, or saving an unchanged name fails.
  assert.equal(room.nameTaken('Sam', 1), false);
  assert.equal(room.nameTaken('Sam', 2), true);
});

test('names clash regardless of case or surrounding spaces', () => {
  const room = roomWith([[1, 'Sam']]);
  for (const variant of ['sam', 'SAM', 'SaM', '  Sam  ']) {
    assert.equal(room.nameTaken(variant, 2), true, `${variant} should clash`);
  }
});

test('a name used by someone seated at the table is taken', () => {
  const room = roomWith([[1, 'Sam']]);
  room.table.addPlayer(7, 'Dealer Dan', 500);
  assert.equal(room.nameTaken('Dealer Dan', 2), true);
  assert.equal(room.nameTaken('dealer dan', 2), true);
});

test('a player who has left frees their name up again', () => {
  const room = roomWith([[1, 'Sam']]);
  room.table.addPlayer(7, 'Gone Greg', 500);
  const seat = room.table.seats.find((s) => s && s.userId === 7);
  seat.left = true;
  assert.equal(room.nameTaken('Gone Greg', 2), false);
});
