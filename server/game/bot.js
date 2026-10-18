// Simple computer opponents. The rules are deliberately readable: judge how
// strong the hand looks, then fold weak hands, call medium ones and raise
// strong ones, with a little randomness so they aren't perfectly predictable.
const { evaluateHand, CATEGORY } = require('./handEvaluator');

const RANK_VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

const BOT_NAMES = [
  'Ace Ava', 'Bluff Ben', 'Chip Chloe', 'Dealer Dan', 'Easy Eli', 'Flop Fay',
  'Gutshot Gus', 'Hold Hana', 'Ivory Ian', 'Jack Jo', 'Kicker Kim', 'Limp Leo',
];

// Bots use negative ids so they can never collide with real user accounts.
let nextBotId = -1;
function makeBotId() {
  return nextBotId--;
}

function pickBotName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Pre-flop: score the two hole cards from 0 (trash) to 1 (aces).
function preflopStrength([a, b]) {
  const hi = Math.max(RANK_VALUE[a[0]], RANK_VALUE[b[0]]);
  const lo = Math.min(RANK_VALUE[a[0]], RANK_VALUE[b[0]]);
  const suited = a[1] === b[1];
  const gap = hi - lo;

  if (hi === lo) return 0.55 + (hi / 14) * 0.45; // a pair: 0.63 (deuces) .. 1.0 (aces)
  let score = (hi / 14) * 0.45 + (lo / 14) * 0.2;
  if (suited) score += 0.1;
  if (gap === 1) score += 0.08; // connected
  else if (gap === 2) score += 0.04;
  else if (gap > 4) score -= 0.08;
  return Math.max(0, Math.min(0.95, score));
}

// Post-flop: score the made hand by its category, nudged by the top card.
function postflopStrength(hole, board) {
  const { category, tiebreakers } = evaluateHand([...hole, ...board]);
  const base = {
    [CATEGORY.HIGH_CARD]: 0.15,
    [CATEGORY.PAIR]: 0.45,
    [CATEGORY.TWO_PAIR]: 0.68,
    [CATEGORY.TRIPS]: 0.8,
    [CATEGORY.STRAIGHT]: 0.87,
    [CATEGORY.FLUSH]: 0.91,
    [CATEGORY.FULL_HOUSE]: 0.95,
    [CATEGORY.QUADS]: 0.99,
    [CATEGORY.STRAIGHT_FLUSH]: 1,
  }[category];
  // A pair of aces beats a pair of twos; nudge within the category.
  return Math.min(1, base + (tiebreakers[0] / 14) * 0.08);
}

function strengthFor(table, player) {
  return table.board.length === 0
    ? preflopStrength(player.holeCards)
    : postflopStrength(player.holeCards, table.board);
}

// Decides this bot's action. Returns { type, amount } ready for applyAction.
function decide(table, player) {
  const strength = strengthFor(table, player);
  const toCall = Math.max(0, table.currentBet - player.betThisStreet);
  const pot = table.seats.filter(Boolean).reduce((s, p) => s + p.committed, 0);
  const maxTotal = player.chips + player.betThisStreet;
  const roll = Math.random();

  // Raise sizing: about two thirds of the pot, clamped to what's legal.
  const raiseTo = () => {
    const target = Math.round(table.currentBet + Math.max(pot * 0.65, table.bigBlind));
    const min = Math.min(table.currentBet + table.minRaise, maxTotal);
    const capped = Math.max(min, Math.min(target, maxTotal));
    if (capped >= maxTotal) return { type: 'allin' };
    return table.currentBet > 0
      ? { type: 'raise', amount: capped - table.currentBet }
      : { type: 'bet', amount: capped };
  };

  const canRaise = maxTotal > table.currentBet;

  if (toCall === 0) {
    // Nothing to call: bet strong hands, occasionally bluff, otherwise check.
    if (canRaise && (strength > 0.7 || (strength > 0.5 && roll < 0.5) || roll < 0.12)) return raiseTo();
    return { type: 'check' };
  }

  // Facing a bet: compare the price with how strong the hand feels.
  const price = toCall / (pot + toCall); // share of the pot this call costs
  if (toCall >= player.chips) {
    // Calling means going all-in, so demand a genuinely strong hand.
    return strength > 0.72 || (strength > 0.6 && roll < 0.35) ? { type: 'allin' } : { type: 'fold' };
  }
  if (canRaise && strength > 0.82 && roll < 0.7) return raiseTo();
  // Premium hands are never folded, however steep the price.
  if (strength > 0.8) return { type: 'call' };
  if (strength > price + 0.25) return { type: 'call' };
  if (strength > price && roll < 0.5) return { type: 'call' };
  return { type: 'fold' };
}

// How long a bot "thinks" before acting, so hands stay readable.
function thinkingTime() {
  return 700 + Math.floor(Math.random() * 900);
}

module.exports = { decide, makeBotId, pickBotName, thinkingTime, BOT_NAMES };
