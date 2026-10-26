-- Guest profiles: one row per anonymous auth user.
--
-- `chips` is here because a profile is the natural place to look for it, but
-- it is NOT a balance the browser may move. The game server owns every chip
-- in play; the column-level grant at the foot of this file is what makes
-- that true rather than merely intended.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (char_length(username) between 3 and 20),
  chips       integer not null default 1000 check (chips >= 0),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A guest can see and name themselves, and nobody else.
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "create own profile" on public.profiles
  for insert with check (auth.uid() = id);

create policy "rename own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- The teeth: `authenticated` may write the name and nothing else, so a
-- hand-rolled request cannot set its own chip count even though the row is
-- its own and the update policy passes.
revoke update on public.profiles from authenticated;
grant update (username) on public.profiles to authenticated;
