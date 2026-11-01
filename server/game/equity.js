// Each player's chance of winning an all-in, given the cards still to come.
//
// Shown on the nameplates while an all-in is run out, so it has to be quick
// enough to work out between one street and the next on the server's own
// thread. handEvaluator ranks every 5-card subset of the 7 cards, which is
// right for settling a pot and far too slow for the hundreds of thousands of
// boards an equity needs - so this scores 7 cards in one pass instead. The
// numbers it produces only order hands against each other; they never decide
// who is paid. That stays with handEvaluator.
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

function score(cards) {
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

// `hands` is each contender's two hole cards; `board` the community cards
// out so far. Returns, per hand and in the same order, the share of runouts
// it wins outright and the share it ties for the best hand, both 0-100.
function computeEquity(hands, board = []) {
  const seen = new Set([...hands.flat(), ...board]);
  const deck = ALL.filter((c) => !seen.has(c)).map(toCard);
  const holes = hands.map((h) => h.map(toCard));
  const known = board.map(toCard);
  const need = 5 - known.length;
  const wins = new Array(hands.length).fill(0);
  const ties = new Array(hands.length).fill(0);
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
    if (leaders.length === 1) wins[leaders[0]] += 1;
    else for (const i of leaders) ties[i] += 1;
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
  }));
}

module.exports = { computeEquity, score };
