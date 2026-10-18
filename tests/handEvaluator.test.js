const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHand, compareHands, CATEGORY } = require('../server/game/handEvaluator');

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

test('describes hands in plain English', () => {
  assert.equal(evaluateHand(['As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d']).description, 'Royal Flush');
  assert.equal(evaluateHand(['Ks', 'Kh', 'Kd', '7c', '7s', '3d', '4h']).description, 'Kings full of Sevens');
  assert.equal(evaluateHand(['6s', '6h', '2d', '9c', 'Js', '3d', '4h']).description, 'Pair of Sixes');
  assert.equal(evaluateHand(['As', '2s', '3d', '4h', '5c', 'Kd', '9h']).description, 'Straight, Five high');
});

test('throws when fewer than 5 cards are given', () => {
  assert.throws(() => evaluateHand(['As', 'Ks', 'Qs']));
});
