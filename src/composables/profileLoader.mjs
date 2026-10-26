// One profile load at a time, and never the wrong player's.
//
// This is the guard that Bug 1 came out of. Two callers arrive at once on
// sign-up - `adopt()` on the way in, and the auth-state listener firing at
// the same moment - and the second one used to see a load already running and
// return immediately. That looks like de-duplication and is really a race:
// sign-up resolved before the profile existed, the socket connected carrying
// no name, and the server named the player itself. It reads that name only
// when it first creates their row, so the wrong name stuck for good.
//
// Three rules, which the tests hold it to:
//   - Callers for the same user share one promise and all wait for it.
//   - A failed load clears the in-flight state, so one failure cannot wedge
//     every load after it.
//   - A result that arrives after the session has moved on is discarded.
//     User A's profile must never be applied to user B.
//
// It imports nothing - no vue, no supabase. The load function and a getter
// for whoever the session currently belongs to are passed in, which is what
// makes it testable under plain `node --test`.

// `load(userId)` resolves to the profile, or to null where there legitimately
// is none (a guest has no row). `currentUserId()` returns the id the session
// belongs to right now. `retries` is how many extra attempts a failing load
// gets before the error is handed back.
export function createProfileLoader({ load, currentUserId, retries = 1 }) {
  let loadingFor = null;
  let loadingPromise = null;
  let syncedFor = null;

  async function run(userId) {
    try {
      let lastError = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const profile = await load(userId);
          // Checked after awaiting, not before: the session can change while
          // the request is in the air, and this is the only moment that can
          // tell. A stale result is dropped rather than applied.
          if (currentUserId() !== userId) return { stale: true };
          syncedFor = userId;
          return { profile: profile ?? null };
        } catch (err) {
          lastError = err;
          if (currentUserId() !== userId) return { stale: true };
        }
      }
      return { error: lastError };
    } finally {
      // In `finally` so a throw leaves nothing behind. Guarded on the id
      // because a newer load for a different user may already own these.
      if (loadingFor === userId) {
        loadingFor = null;
        loadingPromise = null;
      }
    }
  }

  return {
    // Resolves to one of:
    //   { profile }  - loaded (null is a real answer: a guest has no row)
    //   { cached: true } - already loaded for this user, nothing fetched
    //   { stale: true }  - the session moved on; the result was discarded
    //   { error }    - every attempt failed, and the caller must say so
    sync(userId) {
      if (!userId) {
        syncedFor = null;
        return Promise.resolve({ profile: null });
      }
      if (syncedFor === userId) return Promise.resolve({ cached: true });
      if (loadingFor === userId) return loadingPromise;

      loadingFor = userId;
      loadingPromise = run(userId);
      return loadingPromise;
    },

    // The same user id now means something new - a guest who has just become
    // an account, and has a row where a moment ago they had none. Asking
    // again is the point, so the "already loaded" answer is withdrawn.
    forget() {
      syncedFor = null;
    },
  };
}
