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

test("a game's stats count hands dealt, won and the best hand shown", () => {
  const { Table } = require('../server/game/Table');
  const room = new Room(1, 'Host');
  const t = new Table();
  t.addPlayer(1, 'a', 100);
  t.addPlayer(2, 'b', 100);
  t.startHand();
  const flush = { category: 5, tiebreakers: [14, 9, 7, 4, 2], name: 'Flush', description: 'Flush, Ace high' };
  const pair = { category: 1, tiebreakers: [9, 14, 7, 4], name: 'Pair', description: 'Pair of Nines' };
  room.tallyHand(t, {
    uncontested: false,
    winners: [{ userId: 1, amount: 40 }],
    showdownHands: [{ userId: 1, evaluation: flush }, { userId: 2, evaluation: pair }],
  });
  room.tallyHand(t, { uncontested: true, winners: [{ userId: 2, amount: 15 }], showdownHands: [] });

  assert.deepEqual(room.statsFor(1), { dealt: 2, won: 1, showdownsWon: 1, biggestPot: 40, bestHand: 'Flush, Ace high' });
  assert.deepEqual(room.statsFor(2), { dealt: 2, won: 1, showdownsWon: 0, biggestPot: 15, bestHand: 'Pair of Nines' });
  assert.equal(room.statsFor(3), null);
});

test('every page a reload can land on is served the app shell', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'server', 'index.js'), 'utf8');
  // The one route that answers a bare page address. A page added to the
  // client without being added here is a 404 on reload, which is how both
  // /equity and /tables shipped broken.
  const line = src.split('\n').find((l) => l.startsWith('app.get(/^') && l.includes('settings'));
  assert.ok(line, 'the page route should still be a single regex');
  for (const page of ['lobby', 'create', 'play-ai', 'tables', 'equity', 'settings', 'friends']) {
    assert.ok(line.includes(page), `${page} should be served the shell on reload`);
  }
});
