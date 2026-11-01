// Each player's chance of winning a hand from here, given the cards still
// to come. Used by the server while an all-in is run out at a live table,
// and by the equity calculator page in the browser - one copy, so the two
// can never disagree about who is ahead.
//
// ESM with an .mjs extension for the same reason as the rest of shared/: the
// package is `type: commonjs`, Node 22 can `require()` this, and Vite reads it
// as the module it is.
//
// handEvaluator ranks every 5-card subset of the 7 cards, which is right for
// settling a pot and far too slow for the hundreds of thousands of boards an
// equity needs - so this scores 7 cards in one pass instead. The numbers it
// produces only order hands against each other; they never decide who is
// paid. That stays with handEvaluator.
const RANK = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const SUIT = { s: 0, h: 1, d: 2, c: 3 };
const ALL = [];
for (const r of Object.keys(RANK)) for (const s of Object.keys(SUIT)) ALL.push(r + s);

// Above this many unseen boards the runout is sampled rather than counted:
// pre-flop heads-up is 1.7 million boards, the flop 990, the turn 44.
const EXACT_LIMIT = 20000;
const SAMPLES = 20000;

const toCard = (c) => ({ r: RANK[c[0]], s: SUIT[c[1]] });

// Highest card of a five-in-a-row in a mask of ranks (bit n = rank n), the
// ace also counting low for the wheel. 0 when there isn't one.
function straightHigh(mask) {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let h = 14; h >= 5; h--) {
    if (((mask >> (h - 4)) & 31) === 31) return h;
  }
  return 0;
}

// The top `n` ranks set in a mask, best first.
function topRanks(mask, n, skip = 0) {
  const out = [];
  for (let r = 14; r >= 2 && out.length < n; r--) {
    if (mask & (1 << r) && r !== skip) out.push(r);
  }
  return out;
}

// Category first, then up to five tiebreak ranks, packed into one number so
// that a bigger score is simply a better hand.
function pack(category, ranks) {
  let v = category;
  for (let i = 0; i < 5; i++) v = v * 16 + (ranks[i] || 0);
  return v;
}

export function score(cards) {
  const counts = new Array(15).fill(0);
  const suits = [0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  let ranks = 0;
  for (const c of cards) {
    counts[c.r] += 1;
    suits[c.s] |= 1 << c.r;
    suitCount[c.s] += 1;
    ranks |= 1 << c.r;
  }

  let flush = 0;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flush = suits[s];
  if (flush) {
    const sf = straightHigh(flush);
    if (sf) return pack(8, [sf]);
  }

  let quad = 0;
  const trips = [];
  const pairs = [];
  for (let r = 14; r >= 2; r--) {
    if (counts[r] === 4) quad = r;
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }

  if (quad) return pack(7, [quad, topRanks(ranks, 1, quad)[0]]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    return pack(6, [trips[0], Math.max(trips[1] || 0, pairs[0] || 0)]);
  }
  if (flush) return pack(5, topRanks(flush, 5));
  const st = straightHigh(ranks);
  if (st) return pack(4, [st]);
  if (trips.length) return pack(3, [trips[0], ...topRanks(ranks, 2, trips[0])]);
  if (pairs.length > 1) {
    const rest = ranks & ~(1 << pairs[0]) & ~(1 << pairs[1]);
    return pack(2, [pairs[0], pairs[1], topRanks(rest, 1)[0]]);
  }
  if (pairs.length) return pack(1, [pairs[0], ...topRanks(ranks, 3, pairs[0])]);
  return pack(0, topRanks(ranks, 5));
}

function choose(n, k) {
  let v = 1;
  for (let i = 0; i < k; i++) v = (v * (n - i)) / (i + 1);
  return v;
}

// How the boards from here will be counted, given how many cards are known
// and how many of them are on the board: every one of them, or a random
// sample. For saying so beside the result.
export function runoutPlan(knownCards, boardCards) {
  const need = Math.max(0, 5 - boardCards);
  const total = choose(52 - knownCards, need);
  return total <= EXACT_LIMIT ? { exact: true, boards: total } : { exact: false, boards: SAMPLES };
}

// `hands` is each contender's two hole cards; `board` the community cards
// out so far; `dead` any other cards known to be out of the deck (a hand the
// calculator only has one card of yet). Returns, per hand and in the same
// order, the share of runouts it wins outright, the share it ties for the
// best hand, and the share it loses, all 0-100 - and the counts behind
// them, so the working can be shown: how many boards were dealt, how many
// it won and split, its share of the pots it split (half of a two-way split,
// a third of a three-way one), its equity as a share of the pot, and what it
// won with, as a count of boards per hand category (High Card .. Straight
// Flush).
export function computeEquity(hands, board = [], dead = []) {
  const seen = new Set([...hands.flat(), ...board, ...dead]);
  const deck = ALL.filter((c) => !seen.has(c)).map(toCard);
  const holes = hands.map((h) => h.map(toCard));
  const known = board.map(toCard);
  const need = 5 - known.length;
  const wins = new Array(hands.length).fill(0);
  const ties = new Array(hands.length).fill(0);
  const shares = new Array(hands.length).fill(0);
  const byCategory = hands.map(() => new Array(9).fill(0));
  let boards = 0;

  const settle = (extra) => {
    const common = known.concat(extra);
    let best = -1;
    let leaders = [];
    for (let i = 0; i < holes.length; i++) {
      const s = score(holes[i].concat(common));
      if (s > best) {
        best = s;
        leaders = [i];
      } else if (s === best) leaders.push(i);
    }
    const category = Math.floor(best / 1048576); // the top of pack(): 16^5
    if (leaders.length === 1) {
      wins[leaders[0]] += 1;
      byCategory[leaders[0]][category] += 1;
    } else {
      for (const i of leaders) {
        ties[i] += 1;
        shares[i] += 1 / leaders.length;
      }
    }
    boards += 1;
  };

  if (need <= 0) {
    settle([]);
  } else if (choose(deck.length, need) <= EXACT_LIMIT) {
    const pick = [];
    const walk = (from) => {
      if (pick.length === need) return settle(pick);
      for (let i = from; i < deck.length; i++) {
        pick.push(deck[i]);
        walk(i + 1);
        pick.pop();
      }
    };
    walk(0);
  } else {
    // A partial Fisher-Yates per sample: only the first `need` places are
    // shuffled, which is all a board takes.
    const pool = deck.slice();
    for (let n = 0; n < SAMPLES; n++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
      }
      settle(pool.slice(0, need));
    }
  }

  return hands.map((_, i) => ({
    win: (wins[i] / boards) * 100,
    tie: (ties[i] / boards) * 100,
    lose: ((boards - wins[i] - ties[i]) / boards) * 100,
    equity: ((wins[i] + shares[i]) / boards) * 100,
    boards,
    wins: wins[i],
    ties: ties[i],
    share: shares[i],
    byCategory: byCategory[i],
  }));
}


// ---- Explaining a result ----------------------------------------------------
// The equity calculator shows its working: what each hand is now, and which
// cards to come would change that. These read the same scores as above.

export const CATEGORY_NAME = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];
const RANK_WORD = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const plural = (v) => (v === 6 ? 'Sixes' : `${RANK_WORD[v]}s`);

function unpack(v) {
  const ranks = [];
  for (let i = 0; i < 5; i++) {
    ranks.unshift(v % 16);
    v = Math.floor(v / 16);
  }
  return { category: v, ranks };
}

// The best hand in these cards, named the way the table names it.
export function describeHand(cards) {
  const value = score(cards.map(toCard));
  const { category, ranks: t } = unpack(value);
  let description;
  switch (category) {
    case 8: description = t[0] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_WORD[t[0]]} high`; break;
    case 7: description = `Four of a Kind, ${plural(t[0])}`; break;
    case 6: description = `Full House, ${plural(t[0])} full of ${plural(t[1])}`; break;
    case 5: description = `Flush, ${RANK_WORD[t[0]]} high`; break;
    case 4: description = `Straight, ${RANK_WORD[t[0]]} high`; break;
    case 3: description = `Three of a Kind, ${plural(t[0])}`; break;
    case 2: description = `Two Pair, ${plural(t[0])} and ${plural(t[1])}`; break;
    case 1: description = `Pair of ${plural(t[0])}`; break;
    default: description = `High Card, ${RANK_WORD[t[0]]}`;
  }
  return { score: value, name: CATEGORY_NAME[category], description };
}

// What the very next card does for hand `seat`: the unseen cards that leave
// it holding the best hand outright (its outs), and those that leave it
// sharing the best hand. Needs a flop or a turn on the board - before the
// flop there is no "next card" that settles anything, and on the river
// there is no card to come.
export function nextCardOuts(hands, board, dead = [], seat = 0) {
  const seen = new Set([...hands.flat(), ...board, ...dead]);
  const unseen = ALL.filter((c) => !seen.has(c));
  const outs = [];
  const splits = [];
  for (const c of unseen) {
    const common = [...board, c];
    const scores = hands.map((h) => score([...h, ...common].map(toCard)));
    const best = Math.max(...scores);
    if (scores[seat] !== best) continue;
    if (scores.filter((s) => s === best).length === 1) outs.push(c);
    else splits.push(c);
  }
  return { unseen: unseen.length, outs, splits };
}
