// What the profile form will accept, decided away from the form.
//
// Pure functions, no imports: the sign-up sheet and the profile page ask the
// same questions about a username, an in-game name and a password, and the
// answers have to agree. Two copies of "at least 8 characters" is how a form
// comes to accept something the next screen refuses - the 1-versus-2
// character drift in shared/displayName.mjs was exactly that, found late.
//
// Every function returns a message or null. Null means fine. The message is
// the one the player reads, so it is written for them rather than for a log.
import { USERNAME_RE, DISPLAY_NAME_RE, MIN_PASSWORD } from '../../shared/displayName.mjs';

export { USERNAME_RE, DISPLAY_NAME_RE, MIN_PASSWORD };

export const normalizeUsername = (value) => String(value ?? '').trim();
export const normalizeIngameName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

// Two usernames differing only in case are one username: they map to the same
// synthetic login address, which is why the database holds a unique index on
// `lower(username)`.
export const sameUsername = (a, b) =>
  normalizeUsername(a).toLowerCase() === normalizeUsername(b).toLowerCase();

export function checkUsername(value) {
  const name = normalizeUsername(value);
  if (!name) return 'Enter a username.';
  if (!USERNAME_RE.test(name)) return 'Use 3–20 letters, numbers or _ . - characters.';
  return null;
}

export function checkIngameName(value) {
  const name = normalizeIngameName(value);
  if (!name) return 'Pick a name for the table.';
  if (!DISPLAY_NAME_RE.test(name)) {
    return 'Use 2–20 letters, numbers, spaces or _ . - characters.';
  }
  return null;
}

export function checkPassword(value) {
  if (!value) return 'Enter a password.';
  if (String(value).length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return null;
}

// The confirmation box exists to catch a typo in the box above it, and only
// this page can see both - Supabase is never told there were two.
export function checkConfirmation(password, confirmation) {
  if (!confirmation) return 'Type the password again.';
  if (password !== confirmation) return 'These don’t match.';
  return null;
}

// The whole change-password form in one answer, in the order the boxes are
// read. A new password equal to the current one is refused here rather than
// at Supabase, which would accept it and report success for a change that
// changed nothing.
export function checkPasswordChange({ current, next, confirmation }) {
  if (!current) return { field: 'current', message: 'Enter your current password.' };

  const bad = checkPassword(next);
  if (bad) return { field: 'next', message: bad };

  if (current === next) {
    return { field: 'next', message: 'That is your current password. Pick a different one.' };
  }

  const mismatch = checkConfirmation(next, confirmation);
  if (mismatch) return { field: 'confirmation', message: mismatch };

  return null;
}

// Whether the profile form has anything to save. An unchanged value is not a
// change, and the Save button says so by being disabled - which also keeps a
// username "change" from running the rename dance for no reason.
export function profileChanges({ username, ingameName }, original) {
  return {
    username: !sameUsername(username, original.username),
    ingameName: normalizeIngameName(ingameName) !== normalizeIngameName(original.ingameName),
    get any() {
      return this.username || this.ingameName;
    },
  };
}
