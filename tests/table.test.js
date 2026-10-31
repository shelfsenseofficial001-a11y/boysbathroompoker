const test = require('node:test');
const assert = require('node:assert/strict');
const { Table } = require('../server/game/Table');

function tableWith(stacks) {
  const t = new Table({ smallBlind: 5, bigBlind: 10 });
  stacks.forEach((chips, i) => t.addPlayer(i + 1, `p${i + 1}`, chips));
  return t;
}

const totalChips = (t) => t.seats.filter(Boolean).reduce((s, p) => s + p.chips + 0, 0);
const actor = (t) => t.seats[t.actingSeat];

test('chips are conserved through a checked-down hand', () => {
  const t = tableWith([500, 500, 500]);
  t.startHand();
  for (let i = 0; i < 20 && t.phase !== 'showdown'; i++) {
    const p = actor(t);
    t.applyAction(p.userId, t.currentBet > p.betThisStreet ? 'call' : 'check');
  }
  assert.equal(t.phase, 'showdown');
  assert.equal(t.board.length, 5);
  assert.equal(totalChips(t), 1500);
});

test('illegal actions are rejected', () => {
  const t = tableWith([500, 500, 500]);
  t.startHand();
  const p = actor(t);
  const other = t.seats.find((s) => s && s.userId !== p.userId);
  assert.throws(() => t.applyAction(other.userId, 'call'), /Not your turn/);
  assert.throws(() => t.applyAction(p.userId, 'check'), /Cannot check/);
  assert.throws(() => t.applyAction(p.userId, 'raise', 3), /Minimum raise/);
});

test('side pot: short all-in stack can only win what it matched', () => {
  const t = tableWith([100, 1000, 1000]);
  t.startHand();
  // Everyone shoves; deck is random, so check pot structure and conservation.
  for (let i = 0; i < 10 && t.phase !== 'showdown'; i++) {
    const p = actor(t);
    if (!p) break;
    t.applyAction(p.userId, p.chips > 0 && t.currentBet - p.betThisStreet < p.chips ? 'allin' : 'call');
  }
  assert.equal(t.phase, 'showdown');
  assert.equal(totalChips(t), 2100);
  const main = t.pots[0];
  assert.equal(main.amount, 300); // 100 from each of 3 players
  assert.equal(main.eligiblePlayerIds.length, 3);
  const side = t.pots[1];
  assert.equal(side.amount, 1800);
  assert.equal(side.eligiblePlayerIds.includes(1), false);
});

test('player leaving on their turn folds and passes action; their chips stay in the pot', () => {
  const t = tableWith([500, 500, 500]);
  t.startHand();
  const first = actor(t);
  t.applyAction(first.userId, 'call');
  const leaver = actor(t);
  t.removePlayer(leaver.userId);
  assert.notEqual(t.actingSeat, leaver.seat);
  assert.ok(leaver.folded);
  // Play out; total must still include the leaver's committed blind/call.
  for (let i = 0; i < 20 && t.phase !== 'showdown'; i++) {
    const p = actor(t);
    t.applyAction(p.userId, t.currentBet > p.betThisStreet ? 'call' : 'check');
  }
  assert.equal(totalChips(t), 1500);
  t.startHand();
  assert.equal(t.seats.filter(Boolean).length, 2); // leaver's seat cleared
});

test('folded hands are not revealed at showdown', () => {
  const t = tableWith([500, 500, 500]);
  t.startHand();
  const folder = actor(t);
  t.applyAction(folder.userId, 'fold');
  for (let i = 0; i < 20 && t.phase !== 'showdown'; i++) {
    const p = actor(t);
    t.applyAction(p.userId, t.currentBet > p.betThisStreet ? 'call' : 'check');
  }
  const viewer = t.seats.find((s) => s && s.userId !== folder.userId);
  const view = t.getPublicState(viewer.userId);
  assert.equal(view.seats[folder.seat].holeCards, null);
});

test('busted players sit out the next hand and are not dealt in', () => {
  const t = tableWith([500, 500, 500]);
  t.seats[2].chips = 0;
  t.startHand();
  assert.equal(t.seats[2].holeCards.length, 0);
  assert.ok(t.seats[2].sittingOut);
});

test('showdown tells players their kicker when they share a hand', () => {
  const t = tableWith([500, 500, 500]);
  t.startHand();
  // Rig the hands so two players make the same pair and a kicker settles it.
  t.seats[0].holeCards = ['Ks', 'Ad'];
  t.seats[1].holeCards = ['Kh', 'Qc'];
  t.seats[2].holeCards = ['7s', '3d'];
  t.board = ['Kd', '9h', '4c', '8s', '2d'];
  // Everyone has put the same in, so all three contest the one pot.
  for (const p of t.seats.filter(Boolean)) p.committed = 10;
  t._runShowdown();

  const summary = t.lastHandSummary;
  const by = (uid) => summary.showdownHands.find((h) => h.userId === uid);
  assert.equal(by(1).evaluation.description, 'Pair of Kings');
  assert.equal(by(2).evaluation.description, 'Pair of Kings');
  assert.equal(by(1).kicker, 'Kickers Ace, Nine, Eight');
  assert.equal(by(2).kicker, 'Kickers Queen, Nine, Eight');
  // The odd one out made a different hand, so no kicker is shown for them.
  assert.equal(by(3).kicker, '');
  // The winner carries it too, for the banner under the pot.
  assert.equal(summary.winners[0].userId, 1);
  assert.equal(summary.winners[0].kicker, 'Kickers Ace, Nine, Eight');
});

test('a hand nobody else matched shows no kicker', () => {
  const t = tableWith([500, 500]);
  t.startHand();
  t.seats[0].holeCards = ['As', 'Ah'];
  t.seats[1].holeCards = ['7s', '3d'];
  t.board = ['Kd', '9h', '4c', '8s', '2d'];
  t._runShowdown();
  for (const h of t.lastHandSummary.showdownHands) assert.equal(h.kicker, '');
});

test('a late joiner sits out the hand in play and is dealt in next hand', () => {
  const t = tableWith([500, 500]);
  t.startHand();
  const handInPlay = t.handNumber;
  const seat = t.addLatePlayer(99, 'Latecomer', 250);

  // Not part of the hand already running.
  assert.equal(t.seats[seat].sittingOut, true);
  assert.equal(t.seats[seat].holeCards.length, 0);
  assert.ok(!t._playersInHand().some((p) => p.userId === 99));
  assert.equal(t.handNumber, handInPlay);

  // Finish the hand, then deal the next one.
  for (let i = 0; i < 30 && t.phase !== 'showdown'; i++) {
    const p = actor(t);
    t.applyAction(p.userId, t.currentBet > p.betThisStreet ? 'call' : 'check');
  }
  t.startHand();
  assert.equal(t.seats[seat].sittingOut, false);
  assert.equal(t.seats[seat].holeCards.length, 2);
  assert.ok(t._playersInHand().some((p) => p.userId === 99));
});

test('a late joiner gets exactly the stack they were seated with', () => {
  const t = tableWith([500, 500]);
  t.startHand();
  const seat = t.addLatePlayer(99, 'Latecomer', 250);
  assert.equal(t.seats[seat].chips, 250);
});

test('sitting out tracks chips, so a busted player returns if restaked', () => {
  const t = tableWith([500, 500, 500]);
  const playOut = () => {
    for (let i = 0; i < 40 && t.phase !== 'showdown'; i++) {
      const p = actor(t);
      t.applyAction(p.userId, t.currentBet > p.betThisStreet ? 'call' : 'check');
    }
  };
  t.startHand();
  playOut();
  // Emptied once the hand is settled — doing it mid-hand doesn't bust anyone,
  // since they can still win the pot.
  t.seats[2].chips = 0;
  t.startHand();
  assert.equal(t.seats[2].sittingOut, true);
  assert.equal(t.seats[2].holeCards.length, 0); // and not dealt in

  playOut();
  t.seats[2].chips = 400; // restaked
  t.startHand();
  assert.equal(t.seats[2].sittingOut, false);
  assert.equal(t.seats[2].holeCards.length, 2);
});

test('a full table refuses another player', () => {
  const t = tableWith(new Array(t0maxSeats()).fill(100));
  assert.throws(() => t.addPlayer(999, 'One Too Many', 100), /full/i);
  assert.throws(() => t.addLatePlayer(999, 'One Too Many', 100), /full/i);
});

// Pressing an empty chair on the felt asks for that chair in particular.
test('a player sits in the chair they asked for', () => {
  const t = tableWith([100, 100]);
  assert.equal(t.addPlayer(30, 'Picky', 100, false, null, 6), 6);
  assert.equal(t.seats[6].userId, 30);
  // And the seats between are left open rather than closed up over.
  assert.equal(t.seats[2], null);
  assert.equal(t.addLatePlayer(31, 'Also Picky', 100, false, null, 4), 4);
  assert.equal(t.seats[4].sittingOut, true);
});

// Between the press and the server, somebody else can have taken it. Seating
// them one chair along beats turning them away from the table.
test('a chair already taken seats them elsewhere rather than refusing', () => {
  const t = tableWith([100, 100]);
  const seat = t.addPlayer(30, 'Late', 100, false, null, 0);
  assert.notEqual(seat, 0);
  assert.equal(t.seats[0].userId, 1); // whoever was already there stays put
  assert.equal(t.seats[seat].userId, 30);
  // A chair that isn't a chair is no reason to refuse anybody either.
  for (const bad of [-1, 99, 1.5, null, undefined, '3']) {
    const u = new Table({ smallBlind: 5, bigBlind: 10 });
    assert.equal(u.addPlayer(7, 'Odd', 100, false, null, bad), 0);
  }
});

function t0maxSeats() {
  return new Table({ smallBlind: 5, bigBlind: 10 }).maxSeats;
}
