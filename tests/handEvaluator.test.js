const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHand, compareHands, kickers, sameHandRank, describeKickers, CATEGORY } = require('../server/game/handEvaluator');

test('recognizes a royal flush as a straight flush', () => {
  const r = evaluateHand(['As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d']);
  assert.equal(r.category, CATEGORY.STRAIGHT_FLUSH);
  assert.equal(r.tiebreakers[0], 14);
});

test('recognizes the wheel (A-2-3-4-5) as the lowest straight', () => {
  const r = evaluateHand(['As', '2s', '3d', '4h', '5c', 'Kd', '9h']);
  assert.equal(r.category, CATEGORY.STRAIGHT);
  assert.equal(r.tiebreakers[0], 5);
});

test('four of a kind beats full house', () => {
  const quads = evaluateHand(['As', 'Ah', 'Ad', 'Ac', '2s', '3d', '4h']);
  const fullHouse = evaluateHand(['Ks', 'Kh', 'Kd', '2c', '2s', '3d', '4h']);
  assert.equal(quads.category, CATEGORY.QUADS);
  assert.equal(fullHouse.category, CATEGORY.FULL_HOUSE);
  assert.ok(compareHands(quads, fullHouse) > 0);
});

test('flush beats straight, straight beats trips', () => {
  const flush = evaluateHand(['2s', '5s', '9s', 'Js', 'Ks', '3d', '4h']);
  const straight = evaluateHand(['5s', '6h', '7d', '8c', '9s', '2d', 'Kc']);
  const trips = evaluateHand(['5s', '5h', '5d', '2c', '9s', '3d', 'Kc']);
  assert.equal(flush.category, CATEGORY.FLUSH);
  assert.equal(straight.category, CATEGORY.STRAIGHT);
  assert.equal(trips.category, CATEGORY.TRIPS);
  assert.ok(compareHands(flush, straight) > 0);
  assert.ok(compareHands(straight, trips) > 0);
});

test('two pair tiebreak: higher top pair wins', () => {
  const a = evaluateHand(['Ks', 'Kh', '2d', '2c', '9s', '3d', '4h']);
  const b = evaluateHand(['Qs', 'Qh', '2d', '2c', 'As', '3d', '4h']);
  assert.equal(a.category, CATEGORY.TWO_PAIR);
  assert.equal(b.category, CATEGORY.TWO_PAIR);
  assert.ok(compareHands(a, b) > 0); // KK22 beats QQ22
});

test('identical best hands across two players tie (split pot scenario)', () => {
  // The board itself is a royal flush, so every player's best 5 cards are
  // identical no matter what their (irrelevant) hole cards are.
  const board = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
  const p1 = evaluateHand(['2c', '3d', ...board]);
  const p2 = evaluateHand(['4c', '5d', ...board]);
  assert.equal(compareHands(p1, p2), 0);
});

test('kicker breaks a pair tie', () => {
  const a = evaluateHand(['As', 'Ah', 'Kd', '9s', '4c', '2d', '7h']);
  const b = evaluateHand(['Ac', 'Ad', 'Qd', '9s', '4c', '2d', '7h']);
  assert.equal(a.category, CATEGORY.PAIR);
  assert.equal(b.category, CATEGORY.PAIR);
  assert.ok(compareHands(a, b) > 0); // A-K kicker beats A-Q kicker
});

test('descriptions name the hand type, not just the ranks', () => {
  const d = (cards) => evaluateHand(cards).description;
  assert.equal(d(['As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d']), 'Royal Flush');
  assert.equal(d(['9s', '8s', '7s', '6s', '5s', '2c', '3d']), 'Straight Flush, Nine high');
  assert.equal(d(['Ts', 'Th', 'Td', 'Tc', '7s', '3d', '4h']), 'Four of a Kind, Tens');
  assert.equal(d(['Ks', 'Kh', 'Kd', '7c', '7s', '3d', '4h']), 'Full House, Kings full of Sevens');
  assert.equal(d(['2s', '5s', '9s', 'Js', 'Ks', '3d', '4h']), 'Flush, King high');
  assert.equal(d(['As', '2s', '3d', '4h', '5c', 'Kd', '9h']), 'Straight, Five high');
  assert.equal(d(['9s', '9h', '9d', '2c', 'Js', '3d', '4h']), 'Three of a Kind, Nines');
  assert.equal(d(['Ts', 'Th', '6d', '6c', 'Js', '3d', '4h']), 'Two Pair, Tens and Sixes');
  assert.equal(d(['6s', '6h', '2d', '9c', 'Js', '3d', '4h']), 'Pair of Sixes');
  assert.equal(d(['As', 'Jh', '8d', '6c', '3s', '2d', '4h']), 'High Card, Ace');
});

test('throws when fewer than 5 cards are given', () => {
  assert.throws(() => evaluateHand(['As', 'Ks', 'Qs']));
});

test('two players on the same hand are told which kicker they hold', () => {
  const board = ['Kd', '9h', '4c', '7s', '2d'];
  const me = evaluateHand(['Ks', 'As', ...board]); // kings, ace kicker
  const you = evaluateHand(['Kh', 'Qc', ...board]); // kings, queen kicker
  assert.ok(sameHandRank(me, you));
  assert.equal(describeKickers(kickers(me)), 'Kickers Ace, Nine, Seven');
  assert.equal(describeKickers(kickers(you)), 'Kickers Queen, Nine, Seven');
  assert.ok(compareHands(me, you) > 0);
});

test('a hand with a single kicker reads in the singular', () => {
  const trips = evaluateHand(['8s', '8h', '8d', 'Ac', 'Ks', '4d', '2h']);
  assert.equal(describeKickers(kickers(trips).slice(0, 1)), 'Ace kicker');
  const quads = evaluateHand(['8s', '8h', '8d', '8c', 'Ks', '4d', '2h']);
  assert.equal(describeKickers(kickers(quads)), 'King kicker');
});

test('hands that leave no room for a kicker have none', () => {
  const straight = evaluateHand(['9s', '8h', '7d', '6c', '5s', 'Ad', 'Kh']);
  assert.deepEqual(kickers(straight), []);
  assert.equal(describeKickers(kickers(straight)), '');
  const boat = evaluateHand(['Ks', 'Kh', 'Kd', '7c', '7s', 'Ad', '3h']);
  assert.deepEqual(kickers(boat), []);
});

test('different hands of the same category are not kicker situations', () => {
  const kings = evaluateHand(['Ks', 'Kh', '9d', '4c', '2s', '7d', '3h']);
  const nines = evaluateHand(['9s', '9h', 'Kd', '4c', '2s', '7d', '3h']);
  assert.equal(sameHandRank(kings, nines), false); // pair of Kings vs pair of Nines
  const twoPairA = evaluateHand(['Ks', 'Kh', '9d', '9c', '2s', '7d', '3h']);
  const twoPairB = evaluateHand(['Ks', 'Kh', '9d', '9c', '2s', '7d', '4h']);
  assert.ok(sameHandRank(twoPairA, twoPairB)); // same two pair, kicker decides
});
