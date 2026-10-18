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
  const taken = [];
  for (let i = 0; i < bot.BOT_NAMES.length; i++) taken.push(bot.pickBotName(taken));
  assert.equal(new Set(taken).size, bot.BOT_NAMES.length);
});
