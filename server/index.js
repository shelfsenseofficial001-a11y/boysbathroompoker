// Entry point: Express app + Socket.io server for BoysbathroomPoker.
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const { router: authRouter, requireAuth } = require('./auth');
const { attachSockets } = require('./sockets');

const app = express();
// Hosts like Render terminate TLS at a proxy and forward plain HTTP, so
// Express has to be told to believe X-Forwarded-* - without this req.secure
// is always false and a secure session cookie would never be sent.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // HTTPS-only once deployed; left off locally, where there's no TLS.
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
  },
});

app.use(express.json());
app.use(sessionMiddleware);
// no-cache = always revalidate, so players never run stale CSS/JS after an update.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.use('/api/auth', authRouter);

app.get('/api/config', (req, res) => res.json({ skipAuth: process.env.SKIP_AUTH === 'true' }));

// Example of a protected REST endpoint (session-based auth, not client-trusted data).
app.get('/api/health', requireAuth, (req, res) => res.json({ ok: true }));

attachSockets(io, sessionMiddleware);

server.listen(PORT, () => {
  console.log(`BoysbathroomPoker listening on http://localhost:${PORT}`);
});
