// The server half of Bug 1: a name was read only when the row was created,
// so one connect arriving before the browser had its profile left an account
// called `Guest2341` for good.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// db.js opens its database when it is first required, so the file has to be
// chosen before anything pulls it in.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bbp-identity-'));
process.env.DB_FILE = path.join(tmp, 'test.db');

const db = require('../server/db');
const { getOrCreateSupabaseUser } = require('../server/identity');
const { resolveDisplayName, guestName } = require('../shared/displayName.mjs');

const ACCOUNT = {
  id: '9f4ced65-e3df-4be0-9251-5ab69f68f484',
  isAnonymous: false,
  metadata: { username: 'zztest', ingame_name: 'Nameplate Check' },
  email: 'zztest@bbp.internal',
};

test('an account is named from its profile, never from a generated guest name', () => {
  const user = getOrCreateSupabaseUser(ACCOUNT);
  assert.equal(user.display_name, 'Nameplate Check');
});

test('the same account reconnecting keeps one row', () => {
  const again = getOrCreateSupabaseUser(ACCOUNT);
  assert.equal(again.display_name, 'Nameplate Check');
  const rows = db.db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE supabase_id = ?')
    .get(ACCOUNT.id);
  assert.equal(rows.n, 1);
});

// The regression itself.
test('a stale generated name on an account is corrected on the next connect', () => {
  const claims = {
    id: '23e4a1e1-43d2-4f5e-8e7e-f5d4a8b316b7',
    isAnonymous: false,
    metadata: { username: 'zztest_claude', ingame_name: 'ZZ Test Account' },
    email: 'zztest_claude@bbp.internal',
  };
  // The row as Bug 1 left it: a real account wearing a guest's name.
  getOrCreateSupabaseUser({ ...claims, metadata: {}, email: '', isAnonymous: true });
  const broken = db.getUserBySupabaseId(claims.id);
  assert.match(broken.display_name, /^Guest\d{4}$/, 'precondition: the bad name is there');

  const healed = getOrCreateSupabaseUser(claims);
  assert.equal(healed.display_name, 'ZZ Test Account');
  assert.equal(healed.healed, true, 'the caller is told, so a seat can follow');
  assert.equal(db.getUserBySupabaseId(claims.id).display_name, 'ZZ Test Account');
});

test('a name the player chose is never overwritten by the handshake', () => {
  const claims = {
    id: '11111111-2222-3333-4444-555555555555',
    isAnonymous: false,
    metadata: { username: 'picky', ingame_name: 'From Metadata' },
    email: 'picky@bbp.internal',
  };
  getOrCreateSupabaseUser(claims);
  // They rename themselves at the table, which writes the users row directly.
  db.setDisplayName(db.getUserBySupabaseId(claims.id).id, 'Chosen At Table');

  const after = getOrCreateSupabaseUser(claims);
  assert.equal(after.display_name, 'Chosen At Table');
  assert.equal(after.healed, undefined);
});

test('a guest keeps the deterministic guest name on every connect', () => {
  const claims = { id: '3a4f31b8-61f1-455c-b961-23b0dc5a90eb', isAnonymous: true, metadata: {}, email: '' };
  const first = getOrCreateSupabaseUser(claims);
  const second = getOrCreateSupabaseUser(claims);
  assert.equal(first.display_name, guestName(claims.id));
  assert.equal(second.display_name, first.display_name);
});

test('an account with no in-game name falls back to its username, not a guest name', () => {
  const name = resolveDisplayName({
    isAnonymous: false,
    userId: '77777777-8888-9999-0000-111111111111',
    metadata: {},
    email: 'solo_player@bbp.internal',
  });
  assert.equal(name, 'solo_player');
  assert.doesNotMatch(name, /^Guest/);
});

test('the username is read from the verified address, not from client metadata', () => {
  const name = resolveDisplayName({
    isAnonymous: false,
    userId: '77777777-8888-9999-0000-111111111111',
    // A client that lied about its username in metadata.
    metadata: { username: 'someone_else' },
    email: 'real_owner@bbp.internal',
  });
  assert.equal(name, 'real_owner');
});

test.after(() => {
  try {
    db.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // A locked WAL file on Windows; the temp directory goes with the machine.
  }
});
