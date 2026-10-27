// What a record adds up to. shared/stats.mjs is the one copy of these
// definitions, so these are the tests that stop the server and the profile
// page drifting apart about what "won" means.
const test = require('node:test');
const assert = require('node:assert');
const {
  summarize,
  cumulativeNet,
  rollingWinRate,
  wonLostPerGame,
  formatRatio,
  ratioSplit,
} = require('../shared/stats.mjs');

// Oldest first here; the module sorts for itself, and some of these are
// handed in backwards on purpose to prove it.
const row = (net, i, extra = {}) => ({
  id: i,
  net_chips: net,
  ended_at: `2026-01-${String(i).padStart(2, '0')}T12:00:00.000Z`,
  ...extra,
});

test('summarize: wins, losses, net and win rate', () => {
  const s = summarize([row(500, 1), row(-200, 2), row(300, 3)]);
  assert.equal(s.gamesPlayed, 3);
  assert.equal(s.chipsWon, 800);
  assert.equal(s.chipsLost, 200);
  assert.equal(s.net, 600);
  assert.equal(s.ratio, 4);
  assert.equal(s.winRate, 2 / 3);
});

test('summarize: nothing played', () => {
  const s = summarize([]);
  assert.equal(s.gamesPlayed, 0);
  assert.equal(s.chipsWon, 0);
  assert.equal(s.chipsLost, 0);
  assert.equal(s.net, 0);
  // Neither of these is a number, and neither may be faked into one: a
  // player with no games has no ratio and no win rate.
  assert.equal(s.ratio, null);
  assert.equal(s.winRate, null);
});

test('summarize: one game', () => {
  const s = summarize([row(1200, 1)]);
  assert.equal(s.gamesPlayed, 1);
  assert.equal(s.net, 1200);
  assert.equal(s.winRate, 1);
  assert.equal(s.ratio, null); // nothing lost to divide by
});

test('summarize: never lost a chip gives no ratio, not Infinity', () => {
  const s = summarize([row(100, 1), row(50, 2)]);
  assert.equal(s.chipsLost, 0);
  assert.equal(s.ratio, null);
  assert.ok(!Number.isNaN(s.ratio));
  assert.equal(formatRatio(s.ratio), '—');
});

test('summarize: a match that came out level is played, not won', () => {
  const s = summarize([row(0, 1), row(400, 2)]);
  assert.equal(s.gamesPlayed, 2);
  assert.equal(s.chipsWon, 400);
  assert.equal(s.chipsLost, 0);
  assert.equal(s.winRate, 0.5);
});

test('summarize: a credited guest row counts like any other', () => {
  const plain = summarize([row(500, 1), row(-200, 2)]);
  const credited = summarize([row(500, 1, { was_guest: 1 }), row(-200, 2, { was_guest: 1 })]);
  assert.deepEqual(credited, plain);
});

test('summarize: a row with no net_chips costs one game, not the sum', () => {
  const s = summarize([row(500, 1), { id: 2, ended_at: null }]);
  assert.equal(s.gamesPlayed, 2);
  assert.equal(s.chipsWon, 500);
  assert.equal(s.net, 500);
});

test('cumulativeNet: runs from zero, oldest first, whatever order it is given', () => {
  const series = cumulativeNet([row(300, 3), row(500, 1), row(-200, 2)]);
  assert.deepEqual(
    series.map((p) => p.value),
    [500, 300, 600]
  );
  assert.deepEqual(
    series.map((p) => p.game),
    [1, 2, 3]
  );
});

test('cumulativeNet: nothing in, nothing out', () => {
  assert.deepEqual(cumulativeNet([]), []);
});

test('rollingWinRate: the record so far, after each match', () => {
  const series = rollingWinRate([row(100, 1), row(-100, 2), row(100, 3), row(100, 4)]);
  assert.deepEqual(
    series.map((p) => p.value),
    [1, 0.5, 2 / 3, 0.75]
  );
});

test('rollingWinRate: a single game is 1 or 0 and never NaN', () => {
  assert.equal(rollingWinRate([row(100, 1)])[0].value, 1);
  assert.equal(rollingWinRate([row(-100, 1)])[0].value, 0);
});

test('wonLostPerGame: each match is on exactly one line, the other at zero', () => {
  const { won, lost } = wonLostPerGame([row(500, 1), row(-200, 2)]);
  assert.deepEqual(
    won.map((p) => p.value),
    [500, 0]
  );
  assert.deepEqual(
    lost.map((p) => p.value),
    [0, 200]
  );
  // Both lines have a point for every game, so neither has a gap in it.
  assert.equal(won.length, lost.length);
});

test('formatRatio: a number, a dash for nothing lost, never Infinity or NaN', () => {
  assert.equal(formatRatio(4), '4.00:1');
  assert.equal(formatRatio(null), '—');
  assert.equal(formatRatio(Infinity), '—');
  assert.equal(formatRatio(NaN), '—');
});

test('ratioSplit: two halves totalling 100, and empty when nothing is played', () => {
  const split = ratioSplit({ chipsWon: 750, chipsLost: 250 });
  assert.equal(split.won, 75);
  assert.equal(split.lost, 25);
  assert.deepEqual(ratioSplit({ chipsWon: 0, chipsLost: 0 }), { won: 0, lost: 0 });
});
