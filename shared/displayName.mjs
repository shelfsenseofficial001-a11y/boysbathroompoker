// What a player is called, decided once for both sides.
//
// This used to be two copies of nearly the same rule: the sign-up form
// accepted an in-game name of 1-20 characters, and the server accepted 2-20.
// A single character passed the form, failed the server's check, and the
// player was quietly seated under a generated `Guest####` instead - the exact
// shape of the bug this file exists to stop. One rule, imported by both.
//
// ESM with an .mjs extension on purpose: the package is `type: commonjs`, so
// a `.js` file here would be parsed as CommonJS and the client could not
// import it. Node 22 can `require()` this directly (engines pins >=22), and
// Vite reads it as the module it is.

// Letters of any script, numbers, and the punctuation a nickname uses.
// Two characters minimum, because a one-character name is not a name anyone
// can address at a table.
export const DISPLAY_NAME_RE = /^[\p{L}\p{N} _.'-]{2,20}$/u;

// A username, which is also the local part of the synthetic login address.
// Narrower than a display name: no spaces, no apostrophes, ASCII only.
export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;

export const MIN_PASSWORD = 8;

// A name generated for somebody who never chose one. Anything matching this
// is the server's own invention and may be replaced; anything else was picked
// by the player and must not be.
export const GENERATED_NAME_RE = /^Guest\d{4}$/;

// Collapses the whitespace a name was typed with, which is the only
// tidying a name gets. Returns null when what is left is not a usable name,
// so a caller has to decide what to do instead rather than receiving
// something that merely looks fine.
export function cleanDisplayName(name) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  return DISPLAY_NAME_RE.test(clean) ? clean : null;
}

// `Guest4817`, derived from the auth id rather than drawn at random, so the
// same guest is called the same thing on every connect without anything
// being stored to remember it by.
//
// The digits are taken from the front of the id. That is not the obvious
// choice, but it is the one already in the database: changing it would
// rename every existing guest the first time they reconnected.
export function guestName(userId) {
  const digits = String(userId ?? '').replace(/\D/g, '').slice(0, 4);
  return `Guest${digits || '0000'}`;
}

// True when a stored name is the server's own invention and may be corrected.
// An empty name counts; a name the player set through `setName` never does.
export function isGeneratedName(name) {
  const stored = String(name ?? '').trim();
  return stored === '' || GENERATED_NAME_RE.test(stored);
}

// The username an account logs in with, read back out of the synthetic
// address it was minted from. The address comes from the verified token, so
// this is the one place a username can be recovered without trusting the
// browser or reading the profiles table.
export function usernameFromEmail(email) {
  const local = String(email ?? '').split('@')[0] || '';
  return USERNAME_RE.test(local) ? local : null;
}

// What this player should be called, from nothing but verified claims.
//
// For an account: the in-game name they chose, else the username their login
// is minted from. Never a generated `Guest####` - that name would stick, and
// a permanent account wearing a guest's name is the bug in Bug 1.
//
// For a guest: the deterministic guest name, every time.
//
// `metadata` is the token's `user_metadata`. It is writable by the account it
// belongs to, which is exactly right for a display name that is allowed to
// duplicate and allowed to change, and exactly wrong for anything that
// decides permission, ownership or uniqueness. Nothing here decides any of
// those: they hang off the verified user id.
// `id` and `userId` are both accepted because both spellings are already in
// use: a verified token's claims call it `id`, and the rest of this file
// calls it `userId`. Reading only one of them is a silent bug - every guest
// comes out as `Guest0000` - and the caller gets no hint, so it is taken here
// rather than left as a convention to remember.
export function resolveDisplayName({ isAnonymous, id, userId, metadata, email } = {}) {
  const uid = userId ?? id;
  if (isAnonymous) return guestName(uid);
  const chosen = cleanDisplayName(metadata?.ingame_name);
  if (chosen) return chosen;
  const username = usernameFromEmail(email) || cleanDisplayName(metadata?.username);
  if (username) return username;
  // An account with neither. Still not a guest name: the id is at least
  // theirs and cannot be mistaken for a name somebody picked.
  return `Player${String(uid ?? '').replace(/\D/g, '').slice(0, 4) || '0000'}`;
}
