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

// --- Vote kick needs a table big enough for a vote -------------------------

test('a vote to remove somebody needs three people', () => {
  const room = roomWith([[1, 'Host'], [2, 'Riley']]);
  // Two people: the target is excluded from their own vote, which leaves one
  // voter and a majority of one. That is not a vote.
  assert.equal(room.canVoteKick(), false);
  room.addToLobby(3, 'Sam', 100);
  assert.equal(room.canVoteKick(), true);
});

test('bots do not count towards a vote', () => {
  const room = roomWith([[1, 'Host'], [2, 'Riley']]);
  room.addToLobby(-1, 'Bot One', 100, true, 'casual');
  room.addToLobby(-2, 'Bot Two', 100, true, 'casual');
  // Four at the table, two of them people. Still not a vote.
  assert.equal(room.canVoteKick(), false);
});

// --- Leaving a match mid-way is still a match you played ------------------
// Driven through onGuestResult, which takes the row before it reaches the
// database: these are about what gets recorded, not about storing it.

const { GameManager } = require('../server/game/GameManager');

function matchInProgress() {
  const room = roomWith([[1, 'Host'], [2, 'Riley']]);
  room.gameId = 99;
  room.table.addPlayer(2, 'Riley', 500);
  return room;
}

test('a player who leaves mid-match has their chips recorded', () => {
  const room = matchInProgress();
  let captured = null;
  const recorded = new GameManager().recordDeparture(room, 2, {
    onGuestResult: (id, result) => { captured = { id, result }; return true; },
  });
  assert.equal(recorded, true);
  assert.equal(captured.id, 2);
  assert.equal(captured.result.matchId, 'g99', 'same id the finish would use, so neither can double-credit');
  assert.equal(captured.result.startStack, 100);
  assert.equal(captured.result.endStack, 500);
  // They left; they did not place.
  assert.equal(captured.result.placement, null);
  // The stakes it was played at, for the recent-games list.
  assert.equal(captured.result.smallBlind, room.table.smallBlind);
  assert.equal(captured.result.bigBlind, room.table.bigBlind);
});

test('leaving a room with no match running records nothing', () => {
  const room = roomWith([[1, 'Host'], [2, 'Riley']]);
  room.table.addPlayer(2, 'Riley', 500); // seated, but no game started
  let called = false;
  const recorded = new GameManager().recordDeparture(room, 2, {
    onGuestResult: () => { called = true; return true; },
  });
  assert.equal(recorded, false);
  assert.equal(called, false);
});

test('a bot leaving records nothing', () => {
  const room = matchInProgress();
  room.table.addPlayer(-1, 'Bot One', 500, true, 'casual');
  let called = false;
  const recorded = new GameManager().recordDeparture(room, -1, {
    onGuestResult: () => { called = true; return true; },
  });
  assert.equal(recorded, false);
  assert.equal(called, false);
});
