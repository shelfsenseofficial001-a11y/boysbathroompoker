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
    bankroll INTEGER NOT NULL DEFAULT 1000,
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

  createUser(username, passwordHash, bankroll = 1000) {
    const stmt = db.prepare(
      'INSERT INTO users (username, password_hash, bankroll) VALUES (?, ?, ?)'
    );
    const info = stmt.run(username, passwordHash, bankroll);
    return info.lastInsertRowid;
  },

  getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  adjustBankroll(userId, delta) {
    db.prepare('UPDATE users SET bankroll = bankroll + ? WHERE id = ?').run(delta, userId);
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

  recordGameResult(gameId, userId, buyIn, finalChips) {
    db.prepare(
      'INSERT INTO game_results (game_id, user_id, buy_in, final_chips) VALUES (?, ?, ?, ?)'
    ).run(gameId, userId, buyIn, finalChips);
  },

  getHandHistoryForGame(gameId) {
    return db
      .prepare('SELECT * FROM hand_history WHERE game_id = ? ORDER BY hand_number ASC')
      .all(gameId);
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
