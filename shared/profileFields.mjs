// What a profile will accept for a bio and a picture.
//
// Same bargain as accountRules.mjs: pure functions, no imports, one copy of
// each rule. The bio length is checked here, by the form, and again by a
// CHECK constraint in the database (migration 0006), because a rule the
// client enforces alone is a rule anyone with a console can break.
//
// Every check returns a message the player reads, or null for fine.

export const BIO_MAX = 160;

// What the avatar bucket will take. Three formats every browser can both
// read and re-encode, so the client-side square crop never has to hand back
// something it could not produce.
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
// What the upload is resized to before it leaves the browser. Square, because
// every place it is drawn is a circle, and small enough that a profile page
// is not a megabyte of somebody's camera roll.
export const AVATAR_SIZE = 256;

// Trailing spaces and a trailing blank line are the shape of a bio that was
// typed and then thought better of. Inner line breaks are kept - the page
// preserves them deliberately - but collapsed to at most one blank line, so
// nobody can push their name off the top of the screen with returns.
export function normalizeBio(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// An empty bio is fine: it is the normal state of a profile nobody has
// written yet, and clearing one is something a player is allowed to do.
export function checkBio(value) {
  const bio = normalizeBio(value);
  if (bio.length > BIO_MAX) {
    return `That's ${bio.length - BIO_MAX} character${bio.length - BIO_MAX === 1 ? '' : 's'} too long.`;
  }
  return null;
}

// How many are left, for the live counter. Negative once it is over, so the
// counter can turn red by reading the sign rather than by comparing again.
export function bioRemaining(value) {
  return BIO_MAX - normalizeBio(value).length;
}

// `file` is a File or anything with `type` and `size`. The messages name the
// limit in the units the player saw it in - "2 MB", not "2097152 bytes".
export function checkAvatarFile(file) {
  if (!file) return 'Choose an image.';
  if (!AVATAR_TYPES.includes(file.type)) return 'Use a PNG, JPEG or WebP image.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'That file looks empty.';
  if (file.size > AVATAR_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That image is ${mb} MB. The limit is 2 MB.`;
  }
  return null;
}

// Where an account's picture is allowed to live: under a folder named for
// its own auth id, which is what the storage policy checks. Built here so
// the upload and the policy cannot disagree about the shape of the path.
export function avatarPath(userId, ext = 'webp') {
  const id = String(userId ?? '').trim();
  if (!id) return null;
  return `${id}/avatar.${ext}`;
}

// The initials behind an avatar that has not been set, or has not loaded.
// Two letters at most, from the first two words, upper-cased. A name made
// only of punctuation or emoji yields nothing, and the caller draws the
// generated identicon instead rather than an empty circle.
export function initialsFrom(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words
    .map((word) => [...word].find((ch) => /\p{L}|\p{N}/u.test(ch)) || '')
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  return letters.toUpperCase();
}
