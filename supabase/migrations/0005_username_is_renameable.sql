-- A username can be changed after all.
--
-- 0003 revoked `username` from `authenticated` on the reasoning that the
-- login address is minted from it, so renaming would lock the owner out. That
-- reasoning was right about the danger and wrong about the conclusion: the
-- answer is to move the address with the name, not to forbid the name from
-- moving. The profile page does exactly that, in an order that cannot leave
-- the two disagreeing:
--
--   1. check the new name is free
--   2. update profiles.username          <- needs the grant below
--   3. updateUser({ email: <new>@... })
--   4. if 3 fails, put 2 back
--
-- Step 2 is deliberately the reversible one and goes first; step 3 is the one
-- that cannot be undone and goes last. Without this grant step 2 fails with
-- "permission denied for table profiles", which is safe - nothing moves - but
-- means the page cannot do the job it exists for.
--
-- `lower(username)` stays unique (0003), so a rename into a name somebody
-- else holds is refused by the database whatever the browser believes.

revoke update on public.profiles from authenticated;
grant update (username, ingame_name) on public.profiles to authenticated;

-- What is still withheld is everything else: `id` and `created_at` are not in
-- the grant, so a row cannot be reassigned to another account or backdated.
-- The update policy from 0001 still limits all of this to the caller's own
-- row; the grant limits which columns of it they may touch.
