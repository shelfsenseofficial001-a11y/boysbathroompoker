// The rules the sign-up sheet and the profile page both answer to.
const test = require('node:test');
const assert = require('node:assert');

const {
  checkUsername,
  checkIngameName,
  checkPassword,
  checkConfirmation,
  checkPasswordChange,
  profileChanges,
  sameUsername,
  normalizeIngameName,
} = require('../src/lib/accountRules.mjs');

test('a username is 3-20 of letters, numbers and _ . -', () => {
  assert.equal(checkUsername('nik'), null);
  assert.equal(checkUsername('zztest_claude2'), null);
  assert.equal(checkUsername('a.b-c_d'), null);
  assert.match(checkUsername(''), /Enter a username/);
  assert.match(checkUsername('ab'), /3–20/);
  assert.match(checkUsername('a'.repeat(21)), /3–20/);
  // The ones that would break the synthetic address they are minted into.
  assert.match(checkUsername('nik tahana'), /3–20/, 'no spaces');
  assert.match(checkUsername("o'brien"), /3–20/, 'no apostrophes');
  assert.match(checkUsername('niké'), /3–20/, 'ascii only');
});

test('a username is trimmed before it is judged', () => {
  assert.equal(checkUsername('  nik  '), null);
});

test('an in-game name is 2-20 and may be any script', () => {
  assert.equal(checkIngameName('Nameplate Check'), null);
  assert.equal(checkIngameName('ニコ'), null);
  assert.equal(checkIngameName("O'Brien"), null);
  assert.match(checkIngameName(''), /Pick a name/);
  // One character passed the sign-up form and failed the server, which seated
  // the player under a generated guest name. It fails in one place now.
  assert.match(checkIngameName('x'), /2–20/);
  assert.match(checkIngameName('x'.repeat(21)), /2–20/);
});

test('an in-game name collapses its whitespace', () => {
  assert.equal(normalizeIngameName('  Big   Slick  '), 'Big Slick');
  assert.equal(checkIngameName('  Big   Slick  '), null);
});

test('a password is at least 8 characters', () => {
  assert.equal(checkPassword('hunter2hunter2'), null);
  assert.match(checkPassword(''), /Enter a password/);
  assert.match(checkPassword('short'), /at least 8/);
});

test('a confirmation has to match', () => {
  assert.equal(checkConfirmation('abcdefgh', 'abcdefgh'), null);
  assert.match(checkConfirmation('abcdefgh', ''), /Type the password again/);
  assert.match(checkConfirmation('abcdefgh', 'abcdefgi'), /don’t match/);
});

test('changing a password is checked in the order the boxes are read', () => {
  assert.equal(
    checkPasswordChange({ current: 'oldpassword', next: 'newpassword', confirmation: 'newpassword' }),
    null
  );

  assert.deepEqual(checkPasswordChange({ current: '', next: 'newpassword', confirmation: 'newpassword' }), {
    field: 'current',
    message: 'Enter your current password.',
  });

  assert.equal(
    checkPasswordChange({ current: 'oldpassword', next: 'short', confirmation: 'short' }).field,
    'next'
  );

  // Supabase would accept this and report a successful change of nothing.
  const same = checkPasswordChange({
    current: 'oldpassword',
    next: 'oldpassword',
    confirmation: 'oldpassword',
  });
  assert.equal(same.field, 'next');
  assert.match(same.message, /current password/);

  assert.equal(
    checkPasswordChange({ current: 'oldpassword', next: 'newpassword', confirmation: 'newpassw0rd' })
      .field,
    'confirmation'
  );
});

test('usernames differing only in case are one username', () => {
  assert.equal(sameUsername('ZZTest_Claude2', 'zztest_claude2'), true);
  assert.equal(sameUsername(' nik ', 'nik'), true);
  assert.equal(sameUsername('nik', 'nikk'), false);
});

test('an unchanged profile has nothing to save', () => {
  const original = { username: 'nik', ingameName: 'Big Slick' };

  const none = profileChanges({ username: 'nik', ingameName: 'Big Slick' }, original);
  assert.equal(none.any, false);

  // Case-only is not a change: it is the same username.
  const cased = profileChanges({ username: 'NIK', ingameName: 'Big Slick' }, original);
  assert.equal(cased.username, false);
  assert.equal(cased.any, false);

  const renamed = profileChanges({ username: 'nik2', ingameName: 'Big Slick' }, original);
  assert.equal(renamed.username, true);
  assert.equal(renamed.ingameName, false);
  assert.equal(renamed.any, true);

  // Whitespace alone is not a change either.
  const spaced = profileChanges({ username: 'nik', ingameName: 'Big  Slick ' }, original);
  assert.equal(spaced.ingameName, false);
});
