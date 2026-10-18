// Evaluates the best 5-card poker hand out of any 5, 6, or 7 cards.
// Cards are strings like "Ah", "Td", "2c" (rank + suit).
const RANK_VALUE = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

const CATEGORY_NAME = {
  0: 'High Card',
  1: 'Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
};

function combinations(arr, k) {
  const results = [];
  const combo = [];
  function go(start) {
    if (combo.length === k) {
      results.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      go(i + 1);
      combo.pop();
    }
  }
  go(0);
  return results;
}

// Ranks exactly 5 cards. Returns { category, tiebreakers: [..] } where higher
// category and then higher tiebreakers (compared lexicographically) is better.
function rankFive(cards) {
  const values = cards.map((c) => RANK_VALUE[c[0]]).sort((a, b) => b - a);
  const suits = cards.map((c) => c[1]);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => (b.c - a.c) || (b.v - a.v));

  // Straight check (handles wheel A-2-3-4-5).
  const uniqueDesc = [...new Set(values)].sort((a, b) => b - a);
  let straightHigh = null;
  if (uniqueDesc.length === 5) {
    if (uniqueDesc[0] - uniqueDesc[4] === 4) straightHigh = uniqueDesc[0];
    else if (uniqueDesc.join(',') === '14,5,4,3,2') straightHigh = 5; // wheel
  }

  if (straightHigh && isFlush) return { category: CATEGORY.STRAIGHT_FLUSH, tiebreakers: [straightHigh] };
  if (groups[0].c === 4) {
    const kicker = groups[1].v;
    return { category: CATEGORY.QUADS, tiebreakers: [groups[0].v, kicker] };
  }
  if (groups[0].c === 3 && groups[1] && groups[1].c >= 2) {
    return { category: CATEGORY.FULL_HOUSE, tiebreakers: [groups[0].v, groups[1].v] };
  }
  if (isFlush) return { category: CATEGORY.FLUSH, tiebreakers: values };
  if (straightHigh) return { category: CATEGORY.STRAIGHT, tiebreakers: [straightHigh] };
  if (groups[0].c === 3) {
    const kickers = groups.slice(1).map((g) => g.v);
    return { category: CATEGORY.TRIPS, tiebreakers: [groups[0].v, ...kickers] };
  }
  if (groups[0].c === 2 && groups[1] && groups[1].c === 2) {
    const pairVals = [groups[0].v, groups[1].v].sort((a, b) => b - a);
    const kicker = groups[2].v;
    return { category: CATEGORY.TWO_PAIR, tiebreakers: [...pairVals, kicker] };
  }
  if (groups[0].c === 2) {
    const kickers = groups.slice(1).map((g) => g.v);
    return { category: CATEGORY.PAIR, tiebreakers: [groups[0].v, ...kickers] };
  }
  return { category: CATEGORY.HIGH_CARD, tiebreakers: values };
}

function compareRanked(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreakers[i] || 0;
    const bv = b.tiebreakers[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

const RANK_NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const plural = (v) => (v === 6 ? 'Sixes' : `${RANK_NAME[v]}s`);

// Human-readable hand, e.g. "Pair of Aces", "Kings full of Sevens".
function describe({ category, tiebreakers: t }) {
  switch (category) {
    case CATEGORY.STRAIGHT_FLUSH: return t[0] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAME[t[0]]} high`;
    case CATEGORY.QUADS: return `Four ${plural(t[0])}`;
    case CATEGORY.FULL_HOUSE: return `${plural(t[0])} full of ${plural(t[1])}`;
    case CATEGORY.FLUSH: return `Flush, ${RANK_NAME[t[0]]} high`;
    case CATEGORY.STRAIGHT: return `Straight, ${RANK_NAME[t[0]]} high`;
    case CATEGORY.TRIPS: return `Three ${plural(t[0])}`;
    case CATEGORY.TWO_PAIR: return `${plural(t[0])} and ${plural(t[1])}`;
    case CATEGORY.PAIR: return `Pair of ${plural(t[0])}`;
    default: return `${RANK_NAME[t[0]]} high`;
  }
}

// Finds the best 5-card hand among 5-7 cards. Returns the ranked result plus
// a human-readable description and the 5 cards that make up the best hand.
function evaluateHand(cards) {
  if (cards.length < 5) throw new Error('Need at least 5 cards to evaluate a hand.');
  let best = null;
  let bestCombo = null;
  for (const combo of combinations(cards, 5)) {
    const ranked = rankFive(combo);
    if (!best || compareRanked(ranked, best) > 0) {
      best = ranked;
      bestCombo = combo;
    }
  }
  return { ...best, name: CATEGORY_NAME[best.category], description: describe(best), cards: bestCombo };
}

// Compares two full evaluations; >0 means a beats b, <0 means b beats a, 0 is a tie.
function compareHands(a, b) {
  return compareRanked(a, b);
}

module.exports = { evaluateHand, compareHands, CATEGORY, CATEGORY_NAME, combinations };
