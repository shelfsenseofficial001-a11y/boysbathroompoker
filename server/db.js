// SQLite database setup and query helpers. All chips here are fake/play-money.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || './data/poker.db';
const resolved = path.resolve(process.cwd(), DB_FILE);
fs.mkdirSync(path.dirname(resolved), { recursive: true });

const db = new Database(resolved);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS hand_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    hand_number INTEGER NOT NULL,
    summary TEXT NOT NULL, -- JSON blob: board, pot, winners, showdown hands
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    buy_in INTEGER NOT NULL,
    final_chips INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Players can pick a display name without changing the account they log in
// with. Added here so existing databases upgrade on startup.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'display_name')) {
  db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
}

// There is no chip balance on an account, and there never was one that
// counted: `bankroll` was written when a row was made and read by nothing.
// Chips belong to a room - the host sets one starting stack for the table and
// it ends with the match - so a per-account figure was a number nothing used
// and everything was tempted to. Dropped here so existing databases lose it
// on startup, the same way display_name was added.
if (db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'bankroll')) {
  db.exec('ALTER TABLE users DROP COLUMN bankroll');
}

// The Supabase auth user this row belongs to, for guests who arrived with an
// anonymous account. Null for password accounts and for SKIP_AUTH guests, so
// the three can sit in one table. Added here so existing databases upgrade on
// startup, like display_name above.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'supabase_id')) {
  db.exec('ALTER TABLE users ADD COLUMN supabase_id TEXT');
  // Unique but nullable: SQLite counts each NULL as distinct, so every
  // non-Supabase row still fits.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_id ON users (supabase_id)');
}

// The handle an account is reached by - `profiles.username` in Supabase, and
// the thing /u/:username resolves. Read off the verified token's synthetic
// address on every connect, so it follows a rename without this table being
// told about it. Null for guests, who have no profile and no public page.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'handle')) {
  db.exec('ALTER TABLE users ADD COLUMN handle TEXT');
}

// What a finished match did to one stack.
//
// `buy_in` and `final_chips` were the whole of a result until now, which is
// enough to know whether somebody finished up and nothing else: not where
// they came, not how long it took, not which match it was. The columns below
// are added the way `display_name` and `supabase_id` were, so a database
// made by an earlier build upgrades on startup rather than being rebuilt.
//
// `match_id` is the one that matters. A result is credited at most once,
// and the unique index below is what makes that true rather than intended:
// the guest flush writes a batch under a new owner, and a flush that is
// retried - a dropped connection, a double handshake - must not double it.
const resultCols = db.prepare('PRAGMA table_info(game_results)').all().map((c) => c.name);
const addResultCol = (name, decl) => {
  if (!resultCols.includes(name)) db.exec(`ALTER TABLE game_results ADD COLUMN ${name} ${decl}`);
};
addResultCol('match_id', 'TEXT');
addResultCol('start_stack', 'INTEGER');
addResultCol('end_stack', 'INTEGER');
addResultCol('net_chips', 'INTEGER');
addResultCol('placement', 'INTEGER');
addResultCol('mode', 'TEXT');
addResultCol('hands', 'INTEGER');
// The stakes the match was played for. Recorded per result rather than read
// back off the room, because a room's blinds can be retuned between games and
// the figure a finished match is listed under has to be the one it was
// actually played at. Null on rows written before this existed.
addResultCol('small_blind', 'INTEGER');
addResultCol('big_blind', 'INTEGER');
addResultCol('ended_at', 'TEXT');
// A result credited from a guest session, kept so the profile can say where
// its oldest games came from. It changes no sum: a credited match counts
// exactly like any other.
addResultCol('was_guest', 'INTEGER NOT NULL DEFAULT 0');

// Rows written before `match_id` existed have none, and SQLite counts each
// NULL as distinct, so they neither collide with each other nor block the
// index being made.
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS game_results_user_match ON game_results (user_id, match_id)'
);

// The name other players see: their chosen one, else the account name.
function displayName(user) {
  return user ? user.display_name || user.username : '';
}

module.exports = {
  db,
  displayName,

  setDisplayName(userId, name) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, userId);
  },

  createUser(username, passwordHash) {
    const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    const info = stmt.run(username, passwordHash);
    return info.lastInsertRowid;
  },

  getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  getUserBySupabaseId(supabaseId) {
    return db.prepare('SELECT * FROM users WHERE supabase_id = ?').get(supabaseId);
  },

  // A player arriving with a verified Supabase guest account. `username` is
  // the account name and has to be unique, so it is derived from the auth id
  // rather than from anything the browser asked for; `displayName` is the
  // name the table shows, which the player may change freely.
  createSupabaseUser(supabaseId, username, displayName, passwordHash) {
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, supabase_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(username, passwordHash, displayName || null, supabaseId);
    return info.lastInsertRowid;
  },

  createGame(roomCode) {
    const info = db.prepare('INSERT INTO games (room_code) VALUES (?)').run(roomCode);
    return info.lastInsertRowid;
  },

  endGame(gameId) {
    db.prepare("UPDATE games SET ended_at = datetime('now') WHERE id = ?").run(gameId);
  },

  recordHand(gameId, handNumber, summary) {
    db.prepare(
      'INSERT INTO hand_history (game_id, hand_number, summary) VALUES (?, ?, ?)'
    ).run(gameId, handNumber, JSON.stringify(summary));
  },

  setHandle(userId, handle) {
    db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle || null, userId);
  },

  // One player's line in one finished match.
  //
  // `OR IGNORE` leans on the unique (user_id, match_id) index: a retried
  // flush, or a match somehow ended twice, writes nothing the second time
  // rather than doubling a player's record. Returns true when a row was
  // actually written, so a caller crediting a batch can report how many.
  recordGameResult(gameId, userId, result = {}) {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO game_results
           (game_id, user_id, buy_in, final_chips, match_id, start_stack, end_stack,
            net_chips, placement, mode, hands, small_blind, big_blind, ended_at, was_guest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        gameId,
        userId,
        result.startStack || 0,
        result.endStack || 0,
        result.matchId || null,
        result.startStack || 0,
        result.endStack || 0,
        (result.endStack || 0) - (result.startStack || 0),
        result.placement || null,
        result.mode || null,
        result.hands || 0,
        result.smallBlind ?? null,
        result.bigBlind ?? null,
        result.endedAt || new Date().toISOString(),
        result.wasGuest ? 1 : 0
      );
    return info.changes > 0;
  },

  // Several at once, under one transaction: crediting a guest's session is
  // all-or-nothing, so a failure part-way through leaves the account with
  // none of it rather than some of it.
  recordGameResults(userId, results) {
    const write = db.transaction((rows) => {
      let written = 0;
      for (const row of rows) {
        if (module.exports.recordGameResult(row.gameId || null, userId, row)) written += 1;
      }
      return written;
    });
    return write(results || []);
  },

  getHandHistoryForGame(gameId) {
    return db
      .prepare('SELECT * FROM hand_history WHERE game_id = ? ORDER BY hand_number ASC')
      .all(gameId);
  },

  // The public record, by Supabase auth id. Safe fields only: this is what
  // the stats endpoint serves to anyone with the link, so it names no room,
  // no opponent and nothing about the account beyond how its matches went.
  //
  // `LIMIT` is applied by the caller's page size rather than fetched whole -
  // a profile reads the last 50 for its graphs, never the lot.
  getPublicResults(supabaseId, limit = 50, offset = 0) {
    return db
      .prepare(
        `SELECT gr.id, gr.match_id, gr.net_chips, gr.start_stack, gr.end_stack,
                gr.placement, gr.mode, gr.hands, gr.small_blind, gr.big_blind,
                gr.ended_at, gr.was_guest
           FROM game_results gr
           JOIN users u ON u.id = gr.user_id
          WHERE u.supabase_id = ?
          ORDER BY datetime(gr.ended_at) DESC, gr.id DESC
          LIMIT ? OFFSET ?`
      )
      .all(supabaseId, limit, offset);
  },

  countPublicResults(supabaseId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM game_results gr
           JOIN users u ON u.id = gr.user_id
          WHERE u.supabase_id = ?`
      )
      .get(supabaseId);
    return row?.n || 0;
  },

  getResultsForUser(userId) {
    return db
      .prepare(
        `SELECT gr.*, g.room_code, g.started_at, g.ended_at
         FROM game_results gr JOIN games g ON g.id = gr.game_id
         WHERE gr.user_id = ? ORDER BY gr.id DESC`
      )
      .all(userId);
  },
};
