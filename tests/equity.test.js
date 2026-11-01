const test = require('node:test');
const assert = require('node:assert');
const { computeEquity, score } = require('../server/game/equity');
const { evaluateHand, compareHands } = require('../server/game/handEvaluator');

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const DECK = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
const toCard = (c) => ({ r: RANKS.indexOf(c[0]) + 2, s: SUITS.indexOf(c[1]) });

function deal(n) {
  const pool = DECK.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

test('the fast scorer orders 7-card hands exactly as the hand evaluator does', () => {
  for (let i = 0; i < 3000; i++) {
    const cards = deal(9);
    const a = cards.slice(0, 7);
    const b = [...cards.slice(7), ...cards.slice(2, 7)];
    const slow = Math.sign(compareHands(evaluateHand(a), evaluateHand(b)));
    const fast = Math.sign(score(a.map(toCard)) - score(b.map(toCard)));
    assert.equal(fast, slow, `${a} vs ${b}`);
  }
});

test('a made hand on a complete board is a certainty', () => {
  const [hero, villain] = computeEquity([['As', 'Ah'], ['Ks', 'Kh']], ['2c', '7d', '9h', 'Js', '3c']);
  assert.equal(hero.win, 100);
  assert.equal(villain.win, 0);
});

test('the same hand on the board is a tie, not a win', () => {
  const eq = computeEquity([['2s', '3h'], ['2d', '3c']], ['As', 'Ks', 'Qd', 'Jh', 'Tc']);
  assert.deepEqual(eq.map((e) => e.tie), [100, 100]);
});

test('aces against kings pre-flop is about four to one', () => {
  const [aces, kings] = computeEquity([['As', 'Ah'], ['Kd', 'Kc']]);
  assert.ok(Math.abs(aces.win - 81.9) < 1.5, `aces ${aces.win}`);
  assert.ok(Math.abs(kings.win - 17.7) < 1.5, `kings ${kings.win}`);
});

test('on the turn every river is counted', () => {
  // Kings need one of the two kings left: 2 outs in 44.
  const [, kings] = computeEquity([['As', 'Ah'], ['Kd', 'Kc']], ['2c', '7d', '9h', '3s']);
  assert.ok(Math.abs(kings.win - (2 / 44) * 100) < 1e-9);
});

test('a known dead card is never dealt to the board', () => {
  // Kings need a king: with both left ones known to be gone, they are drawing dead.
  const [, kings] = computeEquity([['As', 'Ah'], ['Kd', 'Kc']], ['2c', '7d', '9h', '3s'], ['Ks', 'Kh']);
  assert.equal(kings.win, 0);
  assert.equal(kings.lose, 100);
});

test('hands are named the way the table names them', async () => {
  const { describeHand } = await import('../shared/equity.mjs');
  assert.equal(describeHand(['As', 'Ah', 'Ad', 'Kc', 'Kd', '2s', '3h']).description, 'Full House, Aces full of Kings');
  assert.equal(describeHand(['5s', '4h', '3d', '2c', 'Ad', 'Kh', 'Qc']).description, 'Straight, Five high');
  assert.equal(describeHand(['9s', '9h', '4d', '2c', 'Jd']).description, 'Pair of Nines');
});

test('outs are the cards that put a hand ahead on the next card', async () => {
  const { nextCardOuts } = await import('../shared/equity.mjs');
  // Kings behind aces on the turn: the two kings left, of 44 unseen.
  const r = nextCardOuts([['As', 'Ah'], ['Kd', 'Kc']], ['2c', '7d', '9h', '3s'], [], 1);
  assert.equal(r.unseen, 44);
  assert.deepEqual(r.outs.sort(), ['Kh', 'Ks']);
  assert.equal(r.splits.length, 0);
});

test('the counts behind a result add up to it', () => {
  const [a, b] = computeEquity([['As', 'Ah'], ['Kd', 'Kc']], ['2c', '7d', '9h']);
  assert.equal(a.boards, 990);
  assert.equal(a.wins + b.wins + a.ties, 990);
  assert.equal(a.byCategory.reduce((n, x) => n + x, 0), a.wins);
  assert.ok(Math.abs(a.equity - (a.win + a.tie / 2)) < 1e-9);
  // Kings are behind a bigger pair, so they only ever win by improving:
  // never with a pair or two pair.
  assert.deepEqual(b.byCategory.slice(0, 3), [0, 0, 0]);
  assert.ok(b.byCategory[3] > 0);
});

test('a two-way split is half a pot each', () => {
  const [a, b] = computeEquity([['2s', '3h'], ['2d', '3c']], ['As', 'Ks', 'Qd', 'Jh', 'Tc']);
  assert.equal(a.share, 0.5);
  assert.equal(a.equity, 50);
  assert.equal(b.equity, 50);
});
