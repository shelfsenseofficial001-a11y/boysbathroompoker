-- Usernames become the way in.
--
-- The forms ask for a username and never an email, so `profiles.username` is
-- no longer just a label - it is the handle the account is reached by, mapped
-- to a synthetic address for Supabase Auth, which authenticates by email and
-- nothing else. See docs/supabase.md.
--
-- Two things follow from that. A username has to be unique the way an email
-- is - case and all, since `Nik` and `nik` would map to the same address -
-- and it can no longer be renamed, because the address is already minted.
-- The name everyone reads at the table moves to `ingame_name`, which is free
-- to duplicate and free to change.

alter table public.profiles
  add column if not exists ingame_name text
    check (ingame_name is null or char_length(ingame_name) between 1 and 20);

-- `username` already carries a unique constraint from 0001. This is the other
-- half of it: two names differing only in case map to one synthetic email, so
-- the database refuses the pair rather than letting the second signup collide
-- in auth.users with an error nobody can read.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- The teeth, restated. 0001 granted `username` on the reasoning that a player
-- may rename themselves; now that the login hangs off it, they may not. They
-- write their in-game name instead, and the grant is what makes that true
-- rather than merely intended - the update policy from 0001 still passes.
revoke update on public.profiles from authenticated;
grant update (ingame_name) on public.profiles to authenticated;

-- Is this name free? Asked before signing up, by someone who is nobody yet.
--
-- RLS lets a player read their own row and no others, which is the right rule
-- and makes this question unanswerable by a plain select. So it is answered
-- by one function returning one boolean, rather than by opening the table to
-- anonymous reads for the sake of it.
create or replace function public.username_available(name text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(trim(name))
  );
$$;

grant execute on function public.username_available(text) to anon, authenticated;
