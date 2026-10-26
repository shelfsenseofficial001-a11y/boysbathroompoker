// The guard Bug 1 came out of: a second caller used to walk past a load that
// was already running, so sign-up resolved before the profile existed and the
// socket connected with no name to send.
const test = require('node:test');
const assert = require('node:assert');

const { createProfileLoader } = require('../src/composables/profileLoader.mjs');

// A load that resolves when the test says so, so two callers can be caught
// inside the same one.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('concurrent callers share one load and both wait for it', async () => {
  const gate = deferred();
  let calls = 0;
  const loader = createProfileLoader({
    load: () => {
      calls++;
      return gate.promise;
    },
    currentUserId: () => 'u1',
  });

  const first = loader.sync('u1');
  const second = loader.sync('u1');

  gate.resolve({ id: 'u1', username: 'nik' });
  const [a, b] = await Promise.all([first, second]);

  assert.equal(calls, 1, 'the row is fetched once, not once per caller');
  assert.deepEqual(a.profile, { id: 'u1', username: 'nik' });
  // The point of the whole fix: the second caller got the profile too,
  // rather than an early return with nothing in it.
  assert.deepEqual(b.profile, { id: 'u1', username: 'nik' });
});

test('a failed load clears the in-flight state and can be retried', async () => {
  let attempts = 0;
  const loader = createProfileLoader({
    load: () => {
      attempts++;
      return Promise.reject(new Error('network down'));
    },
    currentUserId: () => 'u1',
    retries: 1,
  });

  const result = await loader.sync('u1');
  assert.equal(attempts, 2, 'one retry before giving up');
  assert.equal(result.error.message, 'network down');

  // Nothing is wedged: a later load for the same user runs rather than
  // returning the dead promise from the failure.
  const after = await loader.sync('u1');
  assert.equal(attempts, 4, 'the next sync tries again');
  assert.ok(after.error, 'and still reports the failure');
});

test('a result for a user who is no longer current is discarded', async () => {
  const gate = deferred();
  let current = 'u1';
  const loader = createProfileLoader({
    load: () => gate.promise,
    currentUserId: () => current,
  });

  const pending = loader.sync('u1');
  // They sign out and somebody else signs in while the request is in the air.
  current = 'u2';
  gate.resolve({ id: 'u1', username: 'nik' });

  const result = await pending;
  assert.equal(result.stale, true, 'user A never lands on user B');
  assert.equal(result.profile, undefined);
});

test('a loaded user is not fetched again until forgotten', async () => {
  let calls = 0;
  const loader = createProfileLoader({
    load: () => {
      calls++;
      return Promise.resolve({ id: 'u1' });
    },
    currentUserId: () => 'u1',
  });

  await loader.sync('u1');
  const again = await loader.sync('u1');
  assert.equal(calls, 1);
  assert.equal(again.cached, true);

  // A guest becoming an account: same id, and now there is a row where a
  // moment ago there was none.
  loader.forget();
  await loader.sync('u1');
  assert.equal(calls, 2);
});

test('a guest resolves to no profile, which is an answer and not a failure', async () => {
  const loader = createProfileLoader({
    load: () => Promise.resolve(null),
    currentUserId: () => 'guest',
  });
  const result = await loader.sync('guest');
  assert.equal(result.profile, null);
  assert.equal(result.error, undefined);
});
