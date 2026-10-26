// Account creation, login, logout, and "who am I" routes.
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('./db');

const router = express.Router();
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const SALT_ROUNDS = 12;

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters: letters, numbers, underscore.';
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    return 'Password must be 6-72 characters.';
  }
  return null;
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  const error = validateCredentials(username, password);
  if (error) return res.status(400).json({ error });

  if (db.getUserByUsername(username)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId = db.createUser(username, hash);
  req.session.userId = userId;
  res.json({ id: userId, username });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = db.getUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });

  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  const user = db.getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ id: user.id, username: user.username });
});

router.get('/history', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  res.json(db.getResultsForUser(req.session.userId));
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

module.exports = { router, requireAuth };
