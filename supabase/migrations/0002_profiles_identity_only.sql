-- A profile is identity, and nothing else.
--
-- 0001 put a `chips` column here on the reasoning that a profile is the
-- natural place to look for one. It isn't, for this game: there is no running
-- balance to keep. Every room is its own match, the host sets one starting
-- stack for the table in the waiting room, and those chips exist for that
-- match and end with it. A per-account figure would be a number nothing reads
-- and everything is tempted to.

alter table public.profiles drop column if exists chips;

-- The grant from 0001 named the column it was protecting. The column has gone,
-- so the grant is restated against what is actually left: a player may write
-- their own name, and nothing else.
revoke update on public.profiles from authenticated;
grant update (username) on public.profiles to authenticated;
