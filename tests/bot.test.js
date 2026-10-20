const test = require('node:test');
const assert = require('node:assert/strict');
const { Table } = require('../server/game/Table');
const bot = require('../server/game/bot');

function playBotHand(t) {
  t.startHand();
  let guard = 0;
  while (t.phase !== 'showdown' && guard++ < 200) {
    const p = t.seats[t.actingSeat];
    if (!p) break;
    const move = bot.decide(t, p); // throws here would mean an illegal choice
    t.applyAction(p.userId, move.type, move.amount || 0);
  }
  assert.ok(guard < 200, 'hand should finish rather than loop forever');
  return t;
}

test('bots play full hands without making illegal moves, and chips are conserved', () => {
  for (let game = 0; game < 25; game++) {
    const t = new Table({ smallBlind: 5, bigBlind: 10 });
    const seats = 2 + (game % 4); // tables of 2-5 bots
    for (let i = 0; i < seats; i++) t.addPlayer(bot.makeBotId(), `Bot${i}`, 1000, true);
    const bank = seats * 1000;
    for (let hand = 0; hand < 4; hand++) {
      if (t.seats.filter((p) => p && p.chips > 0).length < 2) break;
      playBotHand(t);
      const total = t.seats.filter(Boolean).reduce((s, p) => s + p.chips, 0);
      assert.equal(total, bank, 'chips must be conserved across the hand');
    }
  }
});

test('bots fold weak hands facing a big bet and raise premium ones', () => {
  const t = new Table({ smallBlind: 5, bigBlind: 10 });
  t.addPlayer(-101, 'A', 1000, true);
  t.addPlayer(-102, 'B', 1000, true);
  t.startHand();
  const p = t.seats[t.actingSeat];

  p.holeCards = ['2c', '7d']; // worst starting hand
  t.currentBet = 400;
  p.betThisStreet = 0;
  const weak = Array.from({ length: 20 }, () => bot.decide(t, p).type);
  assert.ok(weak.every((a) => a === 'fold'), `expected folds, saw ${[...new Set(weak)].join(',')}`);

  p.holeCards = ['As', 'Ah']; // best starting hand
  const strong = Array.from({ length: 20 }, () => bot.decide(t, p).type);
  assert.ok(!strong.includes('fold'), 'aces should never be folded here');
});

test('bot names and ids are unique', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(bot.makeBotId());
  assert.equal(ids.size, 50);

  // Filling every seat must never produce two bots with the same name.
  const taken = [];
  for (let i = 0; i < 9; i++) {
    const level = bot.LEVELS[i % bot.LEVELS.length];
    taken.push(bot.pickBotName(taken, level));
  }
  assert.equal(new Set(taken).size, taken.length);
});

test('each level is offered a name from its own set', () => {
  for (const level of bot.LEVELS) {
    assert.ok(bot.NAMES[level].includes(bot.pickBotName([], level)));
  }
});

test('unknown levels fall back to casual', () => {
  assert.equal(bot.normalizeLevel('wizard'), 'casual');
  assert.equal(bot.normalizeLevel(undefined), 'casual');
  assert.equal(bot.normalizeLevel('expert'), 'expert');
});

test('every level plays legal poker and conserves chips', () => {
  for (const level of bot.LEVELS) {
    const t = new Table({ smallBlind: 5, bigBlind: 10 });
    for (let i = 0; i < 3; i++) t.addPlayer(bot.makeBotId(), `${level}${i}`, 1000, true, level);
    for (let hand = 0; hand < 3; hand++) {
      if (t.seats.filter((p) => p && p.chips > 0).length < 2) break;
      playBotHand(t);
      const total = t.seats.filter(Boolean).reduce((s, p) => s + p.chips, 0);
      assert.equal(total, 3000, `${level} must not create or lose chips`);
    }
  }
});

// How often a level keeps playing 7-2 on an A-K-Q board facing a big bet.
function stayRate(level, trials = 40) {
  let stayed = 0;
  for (let i = 0; i < trials; i++) {
    const t = new Table({ smallBlind: 5, bigBlind: 10 });
    t.addPlayer(-910, 'a', 1000, true, level);
    t.addPlayer(-911, 'b', 1000, true, level);
    t.startHand();
    const me = t.seats[t.actingSeat];
    me.holeCards = ['2c', '7d']; // trash
    t.board = ['Ah', 'Kd', 'Qc']; // misses it completely
    t.currentBet = 120;
    me.betThisStreet = 0;
    if (bot.decide(t, me).type !== 'fold') stayed++;
  }
  return stayed / trials;
}

test('beginners chase hopeless hands; experts let them go', () => {
  assert.ok(stayRate('beginner') > stayRate('expert'), 'beginner should be the looser caller');
  assert.ok(stayRate('expert') < 0.25, 'expert should mostly fold trash to a big bet');
  assert.ok(stayRate('solid') < 0.35, 'solid should fold trash too');
});

test('expert equity: the nuts beats a random hand nearly always', () => {
  // Holding quad aces on this board, almost nothing can beat us.
  const eq = bot.equity(['As', 'Ah'], ['Ad', 'Ac', '7h'], 1, 150);
  assert.ok(eq > 0.95, `expected a near-certain win, got ${eq}`);
  // Holding the worst possible hand against three opponents.
  const bad = bot.equity(['2c', '7d'], ['As', 'Kh', 'Qd'], 3, 150);
  assert.ok(bad < 0.3, `expected a weak hand, got ${bad}`);
});
