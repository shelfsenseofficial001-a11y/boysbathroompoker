// Mapping a verified Supabase user onto this server's own player row.
//
// Pulled out of sockets.js so it can be tested without standing up a socket
// server, and because it stopped being a one-liner: Bug 1 was this code
// reading the player's name only at the moment it created their row. One
// connect arriving a fraction early - before the browser had loaded the
// profile - and the player was called `Guest2341` for the rest of the
// account's life, with nothing to put it right.
//
// The name is now worked out on every connect, from the verified token and
// nothing else.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('./db');
const { resolveDisplayName, isGeneratedName } = require('../shared/displayName.mjs');

// The account name this row is keyed by. Derived from the auth id so it is
// unique without asking the browser for anything.
const accountName = (supabaseId) => `sb_${supabaseId.replace(/-/g, '').slice(0, 16)}`;

// Random unusable password: a Supabase account is not something you can log
// into with a password here, and a row still needs a hash.
const unusablePassword = () => bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 4);

// `claims` is what verifyAccessToken returned: { id, isAnonymous, metadata,
// email }. Nothing the client sent alongside it is read - for an account the
// handshake's own `name` field is ignored outright, because a name that
// decides what everyone at the table calls you should not be worth forging.
//
// Returns the users row, with `display_name` already correct, or null if the
// row could not be made.
function getOrCreateSupabaseUser(claims) {
  const { id: supabaseId } = claims;
  const resolved = resolveDisplayName(claims);
  const existing = db.getUserBySupabaseId(supabaseId);

  if (!existing) {
    db.createSupabaseUser(supabaseId, accountName(supabaseId), resolved, unusablePassword());
    return db.getUserBySupabaseId(supabaseId);
  }

  // Self-healing, and deliberately narrow. A stored name is replaced only
  // when it is one this server invented - `Guest####`, or nothing at all.
  // A name the player set through `setName` is theirs and is never overwritten,
  // however out of step with their profile it looks: they chose it later.
  if (existing.display_name !== resolved && isGeneratedName(existing.display_name)) {
    db.setDisplayName(existing.id, resolved);
    // `healed` tells the caller the name changed under a player who may be
    // sitting at a table right now, so the seat can be updated in place.
    return { ...existing, display_name: resolved, healed: true };
  }

  return existing;
}

module.exports = { getOrCreateSupabaseUser, accountName };
