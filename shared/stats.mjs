// What a player's record adds up to, decided once for both sides.
//
// The server serves these numbers and the profile page draws them, and the
// two have to agree about what "won" means down to the chip. Two copies of
// "sum the positive nets" is how a card reading 12,400 ends up over a graph
// whose last point is 12,350 - the drift this file exists to stop, in the
// same spirit as shared/displayName.mjs.
//
// ESM with an .mjs extension on purpose: the package is `type: commonjs`, so
// a `.js` file here would be parsed as CommonJS and the client could not
// import it. Node 22 can `require()` this directly (engines pins >=22), and
// Vite reads it as the module it is.
//
// None of this is a balance. A result is what one match did to one stack,
// and chips never leave the room they were won in - see migration 0002. The
// numbers below are history, which is why they may be summed at all.

// A row as it comes back from the results table. Anything missing is taken
// as zero rather than as a reason to throw: a half-written row should cost
// one game's accuracy, not the whole profile.
function net(row) {
  const value = Number(row?.net_chips);
  return Number.isFinite(value) ? value : 0;
}

// Oldest first, which is the order a graph is drawn in and the opposite of
// the order a list is read in. Rows arrive newest-first from the endpoint,
// so every series here sorts for itself rather than trusting the caller.
function chronological(rows) {
  return [...(rows || [])].sort((a, b) => {
    const at = Date.parse(a?.ended_at ?? '') || 0;
    const bt = Date.parse(b?.ended_at ?? '') || 0;
    if (at !== bt) return at - bt;
    // Two matches that ended in the same second still happened in some
    // order, and the id is the only record of which.
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
}

// The six figures on the cards.
//
// `ratio` is null rather than Infinity when nothing has been lost. A player
// who has never lost a chip has no ratio - there is nothing to divide by -
// and the page shows "—" for it. Returning Infinity would put the word
// "Infinity" on a stat card, and NaN would put "NaN" there, which are the
// two ways this calculation is usually seen to fail.
export function summarize(rows) {
  const list = rows || [];
  let won = 0;
  let lost = 0;
  let winners = 0;

  for (const row of list) {
    const value = net(row);
    if (value > 0) {
      won += value;
      winners += 1;
    } else if (value < 0) {
      lost += -value;
    }
    // A match that came out exactly level counts as played and as neither
    // won nor lost. It is rare and it is not a win.
  }

  const played = list.length;
  return {
    gamesPlayed: played,
    chipsWon: won,
    chipsLost: lost,
    net: won - lost,
    // Both halves of the split bar, so the page never divides for itself.
    ratio: lost > 0 ? won / lost : null,
    winRate: played > 0 ? winners / played : null,
  };
}

// Graph 1: where the player stands after each match, running from zero.
// Returns [{ game, ended_at, value }], oldest first, where `game` is 1-based
// so the axis reads "game 1" rather than "game 0".
export function cumulativeNet(rows) {
  let running = 0;
  return chronological(rows).map((row, i) => {
    running += net(row);
    return { game: i + 1, ended_at: row?.ended_at ?? null, value: running };
  });
}

// Graph 2: win rate as it stood after each match, as a fraction of 1.
//
// Rolling in the sense of "so far", not a sliding window: a window would
// make the first N points mean something different from the rest, and the
// question the line answers is "has this player been getting better", which
// is a question about the whole record up to each point.
export function rollingWinRate(rows) {
  let winners = 0;
  return chronological(rows).map((row, i) => {
    if (net(row) > 0) winners += 1;
    return { game: i + 1, ended_at: row?.ended_at ?? null, value: winners / (i + 1) };
  });
}

// Graph 3: the two sides of each match on their own lines. A match is on
// exactly one of them - you finished up or you finished down - so the other
// line sits at zero for that game rather than being left undrawn, which
// would put a gap in a line that has no gap in it.
export function wonLostPerGame(rows) {
  const list = chronological(rows);
  return {
    won: list.map((row, i) => ({
      game: i + 1,
      ended_at: row?.ended_at ?? null,
      value: Math.max(0, net(row)),
    })),
    lost: list.map((row, i) => ({
      game: i + 1,
      ended_at: row?.ended_at ?? null,
      value: Math.max(0, -net(row)),
    })),
  };
}

// The ratio as a sentence, for the card and for the screen reader reading
// the split bar. "—" is the same dash the empty stat cards use.
export function formatRatio(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${ratio.toFixed(2)}:1`;
}

// The split bar's two widths, as percentages that always total 100. With
// nothing played at all both are zero and the bar is drawn empty, which is
// honest: a half-and-half bar would claim an even record nobody has.
export function ratioSplit({ chipsWon = 0, chipsLost = 0 } = {}) {
  const total = chipsWon + chipsLost;
  if (!total) return { won: 0, lost: 0 };
  const won = (chipsWon / total) * 100;
  return { won, lost: 100 - won };
}
