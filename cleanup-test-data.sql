-- Removing the test data left by the auth work.
--
-- The SQLite half of this HAS BEEN RUN (26 Oct): 4 rows deleted from `users`,
-- 0 from `game_results`. What is left below is the Supabase half, which needs
-- the SQL editor - RLS lets a player read and write their own profile and
-- nothing else, and deleting an auth user is admin-only, so it cannot be done
-- from the browser the way the rest of this session's checks were.
--
-- Run each SELECT and read it before the DELETE under it. The DELETEs carry
-- the same WHERE clause as the SELECT above them, so the preview is exactly
-- what goes.

BEGIN;

-- ===========================================================================
-- 1. The two test accounts
-- ===========================================================================
-- Deleting an auth user cascades its profiles row (on delete cascade, 0001).
-- Matched on `is_anonymous = false` as well as on the name, so the guest
-- clause below can never catch a real account or the other way round.

-- PREVIEW
SELECT u.id, u.email, u.is_anonymous, p.username, p.ingame_name
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
 WHERE coalesce(u.is_anonymous, false) = false
   AND p.username IN ('zztest_claude', 'zztest_claude2');
-- Expect 2 rows: zztest_claude@bbp.internal and zztest_claude2@bbp.internal.
-- zztest_claude2's in-game name reads "Pocket Rockets" - that is the rename
-- test, not a different account.

-- DELETE
DELETE FROM auth.users u
 USING public.profiles p
 WHERE p.id = u.id
   AND coalesce(u.is_anonymous, false) = false
   AND p.username IN ('zztest_claude', 'zztest_claude2');
-- Expect 2 rows. Their profiles rows go with them.


-- ===========================================================================
-- 2. The anonymous guests
-- ===========================================================================
-- There are far more of these than the first version of this file listed -
-- every reload during testing minted one, and the server named each of them
-- `GuestNNNN` from its own id. They own no profiles row (migration 0004
-- forbids it), so nothing cascades and nothing references them.
--
-- This is deliberately NOT "every anonymous user": it is every anonymous user
-- that has no profile AND was created on the testing day. Widen the date if
-- you want the lot, but read the count first - a guest who signed up later
-- stops being anonymous, so this clause cannot catch a converted account.

-- PREVIEW: how many, and from when.
SELECT count(*) AS guests,
       min(created_at) AS earliest,
       max(created_at) AS latest
  FROM auth.users u
 WHERE coalesce(u.is_anonymous, false) = true
   AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
   AND u.created_at >= date '2026-10-26';

-- PREVIEW: the rows themselves, newest first.
SELECT u.id, u.created_at, u.last_sign_in_at
  FROM auth.users u
 WHERE coalesce(u.is_anonymous, false) = true
   AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
   AND u.created_at >= date '2026-10-26'
 ORDER BY u.created_at DESC;

-- DELETE
DELETE FROM auth.users u
 WHERE coalesce(u.is_anonymous, false) = true
   AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
   AND u.created_at >= date '2026-10-26';


-- ===========================================================================
-- 3. Check
-- ===========================================================================
SELECT count(*) AS leftover_test_profiles
  FROM public.profiles
 WHERE username IN ('zztest_claude', 'zztest_claude2');
-- Expect 0.

SELECT count(*) AS remaining_profiles FROM public.profiles;
-- Expect only the accounts you actually want: your own, and nothing else.
-- If a username here is unfamiliar, stop and look before committing.

COMMIT;
-- ROLLBACK; -- if any count came back other than what is written above.
