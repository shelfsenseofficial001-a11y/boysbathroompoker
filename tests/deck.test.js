const test = require('node:test');
const assert = require('node:assert/strict');
const { Deck, freshCards, secureRandomInt } = require('../server/game/deck');

test('a fresh deck has exactly 52 unique cards', () => {
  const cards = freshCards();
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards).size, 52);
});

test('shuffled deck still has exactly 52 unique cards', () => {
  const deck = new Deck();
  assert.equal(deck.cards.length, 52);
  assert.equal(new Set(deck.cards).size, 52);
});

test('no card is dealt more than once in a hand', () => {
  const deck = new Deck();
  const dealt = [];
  // Deal like a real hand: 2 hole cards x 6 players, flop(3), turn(1), river(1).
  for (let i = 0; i < 6; i++) dealt.push(...deck.drawMany(2));
  dealt.push(...deck.drawMany(3));
  dealt.push(deck.draw());
  dealt.push(deck.draw());
  assert.equal(dealt.length, 17);
  assert.equal(new Set(dealt).size, 17);
});

test('correct number of cards dealt per stage and deck shrinks accordingly', () => {
  const deck = new Deck();
  assert.equal(deck.remaining(), 52);
  const hole = deck.drawMany(2);
  assert.equal(hole.length, 2);
  assert.equal(deck.remaining(), 50);
  const flop = deck.drawMany(3);
  assert.equal(flop.length, 3);
  assert.equal(deck.remaining(), 47);
  deck.draw(); // turn
  assert.equal(deck.remaining(), 46);
  deck.draw(); // river
  assert.equal(deck.remaining(), 45);
});

test('drawing past an empty deck throws instead of reusing a card', () => {
  const deck = new Deck();
  deck.drawMany(52);
  assert.equal(deck.remaining(), 0);
  assert.throws(() => deck.draw());
});

test('secureRandomInt stays within bounds and is reasonably distributed', () => {
  const buckets = new Array(10).fill(0);
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const v = secureRandomInt(10);
    assert.ok(v >= 0 && v < 10);
    buckets[v]++;
  }
  // Each bucket should be roughly n/10; allow generous tolerance to avoid flakiness.
  const expected = n / 10;
  for (const count of buckets) {
    assert.ok(Math.abs(count - expected) < expected * 0.25, `bucket count ${count} too far from expected ${expected}`);
  }
});

test('repeated shuffles produce varied orderings (not deterministic)', () => {
  const orderings = new Set();
  for (let i = 0; i < 20; i++) {
    const deck = new Deck();
    orderings.add(deck.cards.join(','));
  }
  // Extremely unlikely to collide if the shuffle is working.
  assert.ok(orderings.size > 15);
});
