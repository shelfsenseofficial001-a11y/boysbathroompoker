// Entry point: Express app + Socket.io server for BoysbathroomPoker.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const { router: authRouter, requireAuth } = require('./auth');
const { attachSockets } = require('./sockets');
const { supabaseAuthEnabled } = require('./supabaseAuth');

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

// The built Vue app. `npm run build` puts it here; in development the Vite
// dev server on :5173 serves the client instead and proxies /api and
// /socket.io back to this process, so this directory may legitimately be
// missing while you work.
const CLIENT_DIR = path.join(__dirname, '..', 'dist');
const clientBuilt = fs.existsSync(path.join(CLIENT_DIR, 'index.html'));
if (!clientBuilt) {
  console.warn('No dist/ build found - run "npm run build", or use "npm run dev" for the Vite dev server.');
}
// Hashed filenames can be cached hard; the two entry documents must always be
// revalidated or players keep running the build they first loaded.
app.use(express.static(CLIENT_DIR, {
  setHeaders: (res, filePath) => {
    const entry = filePath.endsWith('index.html') || filePath.endsWith('404.html');
    res.setHeader('Cache-Control', entry ? 'no-cache' : 'public, max-age=31536000, immutable');
  },
}));

app.use('/api/auth', authRouter);

// What the client needs to know before it decides who it is: whether this
// server will accept a Supabase token, and whether it will accept a per-tab
// guest name instead.
app.get('/api/config', (req, res) =>
  res.json({
    skipAuth: process.env.SKIP_AUTH === 'true',
    supabaseAuth: supabaseAuthEnabled,
  })
);

// Example of a protected REST endpoint (session-based auth, not client-trusted data).
app.get('/api/health', requireAuth, (req, res) => res.json({ ok: true }));

// Anything that matched neither a file nor a route above. An API caller
// wants JSON and would choke on a page; a browser gets the card table's own
// 404. Both carry the real status - a wrong turn that answers 200 is how a
// broken link ends up indexed and never noticed.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  if (!clientBuilt) return res.status(404).type('text').send('Not found (no dist/ build - run "npm run build").');
  res.status(404).sendFile(path.join(CLIENT_DIR, '404.html'));
});

attachSockets(io, sessionMiddleware);

server.listen(PORT, () => {
  console.log(`BoysbathroomPoker listening on http://localhost:${PORT}`);
});
