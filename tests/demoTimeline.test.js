// The landing page's demo hand. It is a picture, but it is a picture of
// poker, and the people who will notice a mistake in it are exactly the
// people it is meant to win over.
const test = require('node:test');
const assert = require('node:assert');

const { STEPS, LOOP_MS, initialState, staticFrame } = require('../src/components/landing/demoTimeline.mjs');

const run = () => {
  let s = initialState();
  const states = [];
  for (const step of STEPS) {
    s = { ...s, ...step.patch(s) };
    states.push({ id: step.id, s });
  }
  return states;
};
const chipsOnTable = (s) =>
  s.seats.reduce((n, p) => n + p.chips + (p.bet || 0), 0) + s.pot;

test('no chips are created or destroyed at any step', () => {
  for (const { id, s } of run()) {
    assert.equal(chipsOnTable(s), 4000, `after ${id}`);
  }
});

test('the winner is paid the whole pot', () => {
  const states = run();
  const before = states.find((x) => x.id === 'showdown').s;
  const after = states.find((x) => x.id === 'payout').s;
  const you = (s) => s.seats.find((p) => p.id === 'you').chips;
  assert.equal(you(after) - you(before), before.pot);
  assert.equal(after.pot, 0);
});

test('no card appears twice in either hand', () => {
  for (const id of ['deal', 'deal-2']) {
    const step = STEPS.find((x) => x.id === id);
    const s = step.patch(initialState());
    const hole = s.seats.flatMap((p) => p.cards);
    const board = id === 'deal' ? ['9s', '4s', 'Qc', '2s', '8h'] : [];
    const all = [...hole, ...board];
    assert.equal(new Set(all).size, all.length, `duplicate card in ${id}`);
  }
});

// Post-flop, the first live seat left of the button acts first. With the
// small blind gone, that is the big blind (b3) - before "you".
test('after the flop the big blind acts before you', () => {
  const ids = STEPS.map((x) => x.id);
  assert.ok(ids.indexOf('b3-check-flop') < ids.indexOf('you-check'));
});

test('nobody "raises" into an unopened pot', () => {
  const flop = STEPS.findIndex((x) => x.id === 'flop');
  const firstBet = STEPS.slice(flop).find((x) => /bet|raise/i.test(x.id));
  assert.equal(firstBet.id, 'b1-bet');
});

test('the loop is in the 25-35 second range', () => {
  assert.ok(LOOP_MS >= 25000 && LOOP_MS <= 35000, `${LOOP_MS}ms`);
});

test('every loop starts from fresh stacks, so nothing drifts', () => {
  const deal = STEPS.find((x) => x.id === 'deal');
  // Feed it a table that has already been played on.
  const played = { ...initialState(), seats: initialState().seats.map((p) => ({ ...p, chips: 1 })) };
  const s = { ...played, ...deal.patch(played) };
  assert.ok(s.seats.every((p) => p.chips === 1000));
});

test('the still frame shows a hand in progress, not an empty table', () => {
  const f = staticFrame();
  assert.equal(f.board.length, 3);
  assert.ok(f.pot > 0);
  assert.equal(f.gesture, null);
});
