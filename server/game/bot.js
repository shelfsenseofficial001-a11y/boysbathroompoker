// Computer opponents, at four skill levels.
//
//   beginner — a calling station: plays nearly any hand, hates folding,
//              only raises with something huge, never bluffs.
//   casual   — the straightforward one: folds weak, calls medium, raises
//              strong, with the odd bluff.
//   solid    — tighter and more deliberate: picks better starting hands,
//              bets for value, respects the price it's being offered.
//   expert   — works out how often it would actually win by playing the
//              hand out many times, then bets on the maths, bluffs on
//              purpose and occasionally traps with a monster.
//
// Whatever the level, a call is priced before it is judged. What a bot is
// being asked for is weighed against the pot it would win and the stack it
// would come out of - never against the word "all-in", which says nothing
// about cost: a player shoving their last 12k is asking a 1M stack for about
// one percent of it, and folding that is a bug however the hand is read.
//
// Simulations use Math.random: these are only the bots' own guesses, never
// the real deal. Shuffling and dealing stay on the secure RNG in deck.js.
const { evaluateHand, compareHands, CATEGORY } = require('./handEvaluator');
const { RANKS, SUITS } = require('./deck');

const RANK_VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

const LEVELS = ['beginner', 'casual', 'solid', 'expert'];
const LEVEL_LABEL = { beginner: 'Beginner', casual: 'Casual', solid: 'Solid', expert: 'Expert' };

const NAMES = {
  beginner: ['Lucky Lou', 'Call-Me Cal', 'Hopeful Hana', 'Chasin\' Chaz'],
  casual: ['Easy Eli', 'Chip Chloe', 'Flop Fay', 'Limp Leo'],
  solid: ['Steady Sam', 'Patient Pia', 'Ironside Ida', 'Grinder Gus'],
  expert: ['Sharp Shan', 'Cold-Deck Cole', 'Razor Rae', 'Maths Mika'],
};

let nextBotId = -1;
function makeBotId() {
  return nextBotId--;
}

function pickBotName(taken, level = 'casual') {
  const pool = NAMES[level] || NAMES.casual;
  const free = pool.filter((n) => !taken.includes(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  // Pool exhausted: fall back to any unused name, then to a numbered one.
  const all = Object.values(NAMES).flat().filter((n) => !taken.includes(n));
  if (all.length) return all[Math.floor(Math.random() * all.length)];
  return `${pool[0]} ${taken.length + 1}`;
}

function normalizeLevel(level) {
  return LEVELS.includes(level) ? level : 'casual';
}

// --- Hand strength -------------------------------------------------------

// Pre-flop: score two hole cards from 0 (trash) to 1 (aces).
function preflopStrength([a, b]) {
  const hi = Math.max(RANK_VALUE[a[0]], RANK_VALUE[b[0]]);
  const lo = Math.min(RANK_VALUE[a[0]], RANK_VALUE[b[0]]);
  const suited = a[1] === b[1];
  const gap = hi - lo;

  if (hi === lo) return 0.55 + (hi / 14) * 0.45; // a pair
  let score = (hi / 14) * 0.45 + (lo / 14) * 0.2;
  if (suited) score += 0.1;
  if (gap === 1) score += 0.08;
  else if (gap === 2) score += 0.04;
  else if (gap > 4) score -= 0.08;
  return Math.max(0, Math.min(0.95, score));
}

// Post-flop: score the made hand by category, nudged by its top card.
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
  return Math.min(1, base + (tiebreakers[0] / 14) * 0.08);
}

function strengthFor(table, player) {
  return table.board.length === 0
    ? preflopStrength(player.holeCards)
    : postflopStrength(player.holeCards, table.board);
}

// --- Expert equity -------------------------------------------------------

function remainingDeck(known) {
  const seen = new Set(known);
  const out = [];
  for (const s of SUITS) for (const r of RANKS) {
    const c = r + s;
    if (!seen.has(c)) out.push(c);
  }
  return out;
}

// Plays the hand out `trials` times against random opponent hands and
// returns how often we end up with the best hand (ties counted as a share).
function equity(hole, board, opponents, trials) {
  const deck = remainingDeck([...hole, ...board]);
  const needed = 5 - board.length;
  let score = 0;

  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates: only shuffle the cards this trial needs.
    const draw = needed + opponents * 2;
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(Math.random() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const fullBoard = board.concat(deck.slice(0, needed));
    const mine = evaluateHand([...hole, ...fullBoard]);
    let better = 0;
    let equal = 0;
    for (let o = 0; o < opponents; o++) {
      const at = needed + o * 2;
      const theirs = evaluateHand([deck[at], deck[at + 1], ...fullBoard]);
      const cmp = compareHands(theirs, mine);
      if (cmp > 0) {
        better++;
        break;
      }
      if (cmp === 0) equal++;
    }
    if (!better) score += 1 / (1 + equal);
  }
  return score / trials;
}

// Fewer trials as the table grows, to keep a bot's turn snappy.
function trialsFor(opponents) {
  return opponents <= 1 ? 220 : opponents <= 3 ? 150 : 100;
}

// --- Decisions -----------------------------------------------------------

function tableContext(table, player) {
  const live = table.seats.filter((s) => s && !s.folded);
  const toCall = Math.max(0, table.currentBet - player.betThisStreet);
  // What the call would really cost. A bet larger than the chips behind can
  // only win those chips: the rest of it is not a price anyone is paying, and
  // reading it as one is what makes a deep stack flinch at a short all-in.
  const effectiveToCall = Math.min(toCall, player.chips);
  const pot = table.seats.filter(Boolean).reduce((s, p) => s + p.committed, 0);
  // Two players already in for a raised price: a pot where a cheap call can
  // still be the start of an expensive street.
  const atPrice = live.filter((s) => s !== player && s.betThisStreet >= table.currentBet).length;
  return {
    toCall,
    effectiveToCall,
    pot,
    maxTotal: player.chips + player.betThisStreet,
    opponents: Math.max(1, live.length - 1),
    // The pot odds: the share of the final pot this call is buying.
    price: effectiveToCall > 0 ? effectiveToCall / (pot + effectiveToCall) : 0,
    // And what it costs as a share of everything the bot has behind.
    costRatio: player.chips > 0 ? effectiveToCall / player.chips : 1,
    allInToCall: toCall >= player.chips,
    invested: player.betThisStreet > 0 || player.committed > 0,
    // Calling would end the street: nobody live is still owed a turn.
    closing: live.every((s) => s === player || s.allIn || s.betThisStreet >= table.currentBet),
    reraisedMultiway: live.length - 1 >= 2 && table.currentBet > table.bigBlind && atPrice >= 2,
  };
}

// --- Price ---------------------------------------------------------------
// A call small enough that folding costs more than being wrong does. Calling
// a hundredth of a stack is not a read on anyone's hand, it is arithmetic,
// and a bot that folds it looks broken however good its reasoning was after
// that point. So this is settled before hand strength is ever consulted.
const TRIVIAL_STACK_SHARE = 0.02;
// Hands with so little going for them that even a free-ish look isn't worth
// the trouble - the bottom of the deck, by the pre-flop scorer's reckoning.
const UNPLAYABLE_PREFLOP = 0.18;

function isTrivialCall(table, ctx, strength, level) {
  if (ctx.toCall <= 0) return false;
  const cheap = ctx.effectiveToCall <= table.bigBlind * 0.5 || ctx.costRatio <= TRIVIAL_STACK_SHARE;
  if (!cheap) return false;
  // The calling station doesn't need a reason; at this price, nor does it.
  if (level === 'beginner') return true;
  // Money already in, or the call ends the street: there is nothing left to
  // be protected from, so nothing to fold for.
  if (ctx.invested || ctx.closing) return true;
  if (table.board.length === 0 && strength < UNPLAYABLE_PREFLOP) return false;
  // Two others in for a raise, with streets still to play: cheap now, but
  // this is the hand that goes on costing.
  return !ctx.reraisedMultiway;
}

// Builds a legal bet/raise to roughly `fraction` of the pot.
function sizedRaise(table, player, ctx, fraction) {
  const target = Math.round(table.currentBet + Math.max(ctx.pot * fraction, table.bigBlind));
  const min = Math.min(table.currentBet + table.minRaise, ctx.maxTotal);
  const capped = Math.max(min, Math.min(target, ctx.maxTotal));
  if (capped >= ctx.maxTotal) return { type: 'allin' };
  return table.currentBet > 0
    ? { type: 'raise', amount: capped - table.currentBet }
    : { type: 'bet', amount: capped };
}

function decideBeginner(table, player, ctx, strength, roll) {
  const canRaise = ctx.maxTotal > table.currentBet;
  if (ctx.toCall === 0) {
    // Bets only the genuinely big hands, otherwise happily checks.
    if (canRaise && strength > 0.85 && roll < 0.5) return sizedRaise(table, player, ctx, 0.4);
    return { type: 'check' };
  }
  if (isTrivialCall(table, ctx, strength, 'beginner')) return { type: 'call' };
  if (ctx.allInToCall) {
    // Its whole stack - but a stack it is being laid a price on.
    return strength > 0.62 || strength > ctx.price + 0.05 ? { type: 'allin' } : { type: 'fold' };
  }
  if (canRaise && strength > 0.92 && roll < 0.35) return sizedRaise(table, player, ctx, 0.5);
  // Calls far too often — only folds the worst hands against a real bet.
  if (strength < 0.18 && ctx.price > 0.3) return { type: 'fold' };
  return { type: 'call' };
}

function decideCasual(table, player, ctx, strength, roll) {
  const canRaise = ctx.maxTotal > table.currentBet;
  if (ctx.toCall === 0) {
    if (canRaise && (strength > 0.7 || (strength > 0.5 && roll < 0.5) || roll < 0.12)) {
      return sizedRaise(table, player, ctx, 0.65);
    }
    return { type: 'check' };
  }
  if (isTrivialCall(table, ctx, strength, 'casual')) return { type: 'call' };
  const price = ctx.price;
  if (ctx.allInToCall) {
    return strength > 0.72 || (strength > 0.6 && roll < 0.35) || strength > price + 0.25
      ? { type: 'allin' }
      : { type: 'fold' };
  }
  if (canRaise && strength > 0.82 && roll < 0.7) return sizedRaise(table, player, ctx, 0.65);
  if (strength > 0.8) return { type: 'call' };
  if (strength > price + 0.25) return { type: 'call' };
  if (strength > price && roll < 0.5) return { type: 'call' };
  return { type: 'fold' };
}

function decideSolid(table, player, ctx, strength, roll) {
  const canRaise = ctx.maxTotal > table.currentBet;
  const preflop = table.board.length === 0;
  // Demands a better hand than the casual bot before putting money in.
  const entry = preflop ? 0.52 : 0.42;

  if (ctx.toCall === 0) {
    if (canRaise && strength > 0.72) return sizedRaise(table, player, ctx, 0.7);
    if (canRaise && strength > 0.5 && roll < 0.4) return sizedRaise(table, player, ctx, 0.5);
    if (canRaise && strength < 0.3 && roll < 0.15) return sizedRaise(table, player, ctx, 0.45); // bluff
    return { type: 'check' };
  }
  if (isTrivialCall(table, ctx, strength, 'solid')) return { type: 'call' };
  const price = ctx.price;
  if (ctx.allInToCall) {
    return strength > 0.78 || strength > price + 0.22 ? { type: 'allin' } : { type: 'fold' };
  }
  if (canRaise && strength > 0.86 && roll < 0.75) return sizedRaise(table, player, ctx, 0.75);
  if (strength > 0.82) return { type: 'call' };
  // The hand it demands moves with the price it is being offered: a
  // pot-sized bet asks for the full entry, a cheap one proportionally less.
  // Without this the bar sits where a full-price bet put it, and a short
  // stack gets folded on at odds nobody should refuse.
  const bar = entry * Math.min(1, price / 0.33);
  if (strength < bar) return { type: 'fold' };
  return strength > price + 0.15 ? { type: 'call' } : { type: 'fold' };
}

function decideExpert(table, player, ctx, strength, roll) {
  const canRaise = ctx.maxTotal > table.currentBet;
  // Pre-flop the quick score is reliable enough; after the flop, work out
  // how often this hand actually wins from here.
  const eq = table.board.length === 0
    ? strength
    : equity(player.holeCards, table.board, ctx.opponents, trialsFor(ctx.opponents));

  if (ctx.toCall === 0) {
    if (canRaise && eq > 0.8 && roll < 0.25) return { type: 'check' }; // trap with a monster
    if (canRaise && eq > 0.62) return sizedRaise(table, player, ctx, eq > 0.85 ? 0.85 : 0.6);
    if (canRaise && eq < 0.25 && roll < 0.3) return sizedRaise(table, player, ctx, 0.55); // bluff
    return { type: 'check' };
  }

  if (isTrivialCall(table, ctx, strength, 'expert')) return { type: 'call' };

  // Facing a bet: call only when the hand wins more often than the price.
  // Counting the odds means counting them on both sides. The pre-flop score
  // is a ranking, not a probability, and holding it up against pot odds
  // compares two unlike things - which is exactly how a 12k shove gets
  // folded on by a stack being laid 5 to 1. So the hand is played out here
  // too, and what comes back is the same kind of number as the price.
  const odds = table.board.length === 0
    ? equity(player.holeCards, table.board, ctx.opponents, trialsFor(ctx.opponents))
    : eq;
  const price = ctx.price;
  if (ctx.allInToCall) {
    return odds > price + 0.04 ? { type: 'allin' } : { type: 'fold' };
  }
  if (canRaise && odds > 0.78 && roll < 0.8) return sizedRaise(table, player, ctx, 0.8);
  if (odds > price + 0.08) return { type: 'call' };
  if (odds > price && roll < 0.4) return { type: 'call' };
  return { type: 'fold' };
}

const STRATEGY = {
  beginner: decideBeginner,
  casual: decideCasual,
  solid: decideSolid,
  expert: decideExpert,
};

// Decides this bot's action. Returns { type, amount } ready for applyAction.
function decide(table, player) {
  const ctx = tableContext(table, player);
  const strength = strengthFor(table, player);
  const level = normalizeLevel(player.botLevel);
  return STRATEGY[level](table, player, ctx, strength, Math.random());
}

// Stronger bots take a little longer to "think".
function thinkingTime(level = 'casual') {
  const base = { beginner: 500, casual: 700, solid: 850, expert: 1000 }[normalizeLevel(level)];
  return base + Math.floor(Math.random() * 800);
}

module.exports = {
  decide,
  makeBotId,
  pickBotName,
  thinkingTime,
  normalizeLevel,
  equity,
  LEVELS,
  LEVEL_LABEL,
  NAMES,
};
