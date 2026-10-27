// A player's record, for anyone with the link.
//
// The profile page is composed from two places and this is the half that
// knows about matches. The other half - name, picture, bio - comes from
// Supabase's `public_profiles` view, read by the browser directly. Both are
// keyed by the same Supabase auth id, which is the only thing the two
// databases share.
//
// What this never serves: an email (synthetic or not), a room code, an
// opponent, a chip balance (there is no such thing - see migration 0002), or
// anything at all about a guest. Guests have no rows here to serve.
const express = require('express');
const db = require('./db');
const { summarize } = require('../shared/stats.mjs');

const router = express.Router();

// The last 50 for the graphs, the last 10 for the list. Both are caps rather
// than suggestions: a profile with a thousand matches is served the same
// amount of data as one with fifty.
const GRAPH_LIMIT = 50;
const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

// A uuid and nothing else. The id goes into a query, so it is checked for
// shape before it gets anywhere near one - and a 404 for a malformed id is
// the same answer as for an id that simply isn't here, which is deliberate:
// probing this endpoint should not teach anyone what a real id looks like.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Enough to stop someone walking the whole table from a loop, loose enough
// that a profile page loading its cards, its graphs and its list in one go
// never trips it. Per IP, in memory, with the window swept as it is read.
const WINDOW_MS = 60 * 1000;
const MAX_HITS = 60;
const hits = new Map(); // ip -> number[] of timestamps

function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  // Everyone else's window, swept while we are here, so an idle server is
  // not holding a map of every address that ever asked.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  if (recent.length > MAX_HITS) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }
  next();
}

router.use(rateLimit);

// Everything the cards and the three graphs need, in one answer. The graphs
// are drawn from the same rows the summary is counted from, so a card and a
// line can never disagree about the same match.
router.get('/:id/stats', (req, res) => {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'No such player.' });

  const rows = db.getPublicResults(id, GRAPH_LIMIT, 0);
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    // The summary is over what was served, and says so: a player with more
    // than 50 matches gets a total here that the graphs' last point does not
    // reach, and the page says "last 50" rather than pretending otherwise.
    total: db.countPublicResults(id),
    window: GRAPH_LIMIT,
    summary: summarize(rows),
    results: rows,
  });
});

// The recent-games list, paginated. Separate from the stats call because it
// pages and the stats don't.
router.get('/:id/recent', (req, res) => {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'No such player.' });

  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || PAGE_SIZE));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const total = db.countPublicResults(id);
  const results = db.getPublicResults(id, limit, offset);
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ total, limit, offset, results, more: offset + results.length < total });
});

module.exports = { router };
