// What a profile will accept for a bio and a picture. The bio rule is also a
// CHECK constraint in migration 0006, and these are the tests that keep the
// two saying the same thing.
const test = require('node:test');
const assert = require('node:assert');
const {
  BIO_MAX,
  AVATAR_MAX_BYTES,
  normalizeBio,
  checkBio,
  bioRemaining,
  checkAvatarFile,
  avatarPath,
  initialsFrom,
} = require('../shared/profileFields.mjs');

test('normalizeBio: trims the edges and keeps the breaks inside', () => {
  assert.equal(normalizeBio('  hello  '), 'hello');
  assert.equal(normalizeBio('one\ntwo'), 'one\ntwo');
  assert.equal(normalizeBio('one\r\ntwo'), 'one\ntwo');
  // Trailing spaces on a line are the shape of a sentence thought better of.
  assert.equal(normalizeBio('one   \ntwo'), 'one\ntwo');
});

test('normalizeBio: nobody pushes their name off the screen with returns', () => {
  assert.equal(normalizeBio('one\n\n\n\n\ntwo'), 'one\n\ntwo');
});

test('normalizeBio: nothing at all is an empty string, not null', () => {
  assert.equal(normalizeBio(null), '');
  assert.equal(normalizeBio(undefined), '');
  assert.equal(normalizeBio('   '), '');
});

test('checkBio: empty is fine - it is the normal state of a new profile', () => {
  assert.equal(checkBio(''), null);
  assert.equal(checkBio(null), null);
});

test('checkBio: the limit is the limit, and one over is refused', () => {
  assert.equal(checkBio('a'.repeat(BIO_MAX)), null);
  assert.ok(checkBio('a'.repeat(BIO_MAX + 1)));
});

test('checkBio: measured after trimming, so trailing spaces do not fail it', () => {
  assert.equal(checkBio(`${'a'.repeat(BIO_MAX)}    `), null);
});

test('bioRemaining: counts down, and goes negative past the limit', () => {
  assert.equal(bioRemaining(''), BIO_MAX);
  assert.equal(bioRemaining('abc'), BIO_MAX - 3);
  assert.equal(bioRemaining('a'.repeat(BIO_MAX + 5)), -5);
});

test('checkAvatarFile: the three formats the bucket takes', () => {
  assert.equal(checkAvatarFile({ type: 'image/png', size: 1000 }), null);
  assert.equal(checkAvatarFile({ type: 'image/jpeg', size: 1000 }), null);
  assert.equal(checkAvatarFile({ type: 'image/webp', size: 1000 }), null);
});

test('checkAvatarFile: anything else is refused by type', () => {
  assert.ok(checkAvatarFile({ type: 'image/gif', size: 1000 }));
  assert.ok(checkAvatarFile({ type: 'image/svg+xml', size: 1000 }));
  assert.ok(checkAvatarFile({ type: 'application/pdf', size: 1000 }));
});

test('checkAvatarFile: nothing chosen, and nothing in the file', () => {
  assert.ok(checkAvatarFile(null));
  assert.ok(checkAvatarFile({ type: 'image/png', size: 0 }));
});

test('checkAvatarFile: two megabytes, and the message says so in megabytes', () => {
  assert.equal(checkAvatarFile({ type: 'image/png', size: AVATAR_MAX_BYTES }), null);
  const complaint = checkAvatarFile({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 });
  assert.ok(complaint);
  assert.match(complaint, /MB/);
});

test('avatarPath: a folder named for the account, which is what the policy checks', () => {
  assert.equal(avatarPath('abc-123'), 'abc-123/avatar.webp');
  assert.equal(avatarPath('abc-123', 'png'), 'abc-123/avatar.png');
});

test('avatarPath: no id means no path, rather than a path belonging to nobody', () => {
  assert.equal(avatarPath(''), null);
  assert.equal(avatarPath(null), null);
  assert.equal(avatarPath('   '), null);
});

test('initialsFrom: up to two, from the first two words', () => {
  assert.equal(initialsFrom('Ada Lovelace'), 'AL');
  assert.equal(initialsFrom('Ada'), 'A');
  assert.equal(initialsFrom('Ada Byron Lovelace'), 'AB');
  assert.equal(initialsFrom('  ada   lovelace '), 'AL');
});

test('initialsFrom: a name with no letters yields none, for the caller to replace', () => {
  assert.equal(initialsFrom('🂡🂢'), '');
  assert.equal(initialsFrom('...'), '');
  assert.equal(initialsFrom(''), '');
  assert.equal(initialsFrom(null), '');
});

test('initialsFrom: digits count, since a name may be made of them', () => {
  assert.equal(initialsFrom('7 Spades'), '7S');
});
