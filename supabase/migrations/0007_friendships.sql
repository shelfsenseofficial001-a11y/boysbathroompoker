-- Friends.
--
-- One row per pair of players, whichever way round they met. `user_id` is the
-- one who acted - who asked, or who blocked - and `friend_id` is the other.
-- The pair is unique however it is written (the index below), so "A asked B"
-- and "B asked A" cannot both exist; a second request from the other side is
-- an answer to the first one, not a row of its own.
--
-- Both ends reference `profiles`, which is the guest rule with teeth: a guest
-- has no row there (0004), so a guest can neither be friended nor friend
-- anyone, whatever the browser is told to do.
--
-- Chat and presence come in later migrations. This one is only who knows whom.
--
-- RUN THIS BY HAND. Nothing in the app runs migrations.

create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self check (user_id <> friend_id)
);

create unique index if not exists friendships_pair_key
  on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));
-- The primary lookups are "rows I'm in" from either side; the pair index
-- serves neither column on its own.
create index if not exists friendships_user_idx on public.friendships (user_id);
create index if not exists friendships_friend_idx on public.friendships (friend_id);

-- ---------------------------------------------------------------------------
-- Who may see a row
-- ---------------------------------------------------------------------------
-- Your own rows and nobody else's. A block is the one exception, and it is
-- one-sided: the player who blocked sees the row, the player blocked does not.
-- To them it reads as no friendship at all, which is what a block should look
-- like from the outside.
alter table public.friendships enable row level security;

drop policy if exists "see own friendships" on public.friendships;
create policy "see own friendships" on public.friendships
  for select to authenticated using (
    auth.uid() = user_id
    or (auth.uid() = friend_id and status <> 'blocked')
  );

-- No insert, update or delete policy, and no grant for them either. Every
-- change goes through the functions below, because each one is a rule about
-- two rows' worth of state - "accept only what was asked of you", "a block
-- outranks a request" - that a policy on one row cannot express.
revoke all on public.friendships from anon;
revoke insert, update, delete on public.friendships from authenticated;
grant select on public.friendships to authenticated;

-- ---------------------------------------------------------------------------
-- The changes
-- ---------------------------------------------------------------------------
-- Each returns the caller's view of the pair afterwards - 'sent', 'friends',
-- 'none' - so the button can redraw from the answer without a second read.
-- A refusal is an exception with a sentence in it; the page shows it as is.

-- Who is asking, and are they allowed to. An account and nothing less: the
-- same `is_anonymous` claim 0004 reads, since a guest is `authenticated` too.
create or replace function public.friends_caller()
  returns uuid
  language plpgsql
  stable
  set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Create an account to add friends.';
  end if;
  if not exists (select 1 from public.profiles where id = me) then
    raise exception 'Create an account to add friends.';
  end if;
  return me;
end;
$$;

create or replace function public.send_friend_request(target uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
  pair public.friendships;
begin
  if target is null or target = me then
    raise exception 'You can''t add yourself.';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'That player doesn''t have an account.';
  end if;

  insert into public.friendships (user_id, friend_id, status)
    values (me, target, 'pending')
    on conflict do nothing;
  if found then
    return 'sent';
  end if;

  -- There was a row already. Locked, so two people pressing at once settle
  -- into one answer.
  select * into pair from public.friendships
   where least(user_id, friend_id) = least(me, target)
     and greatest(user_id, friend_id) = greatest(me, target)
   for update;

  if pair.status = 'blocked' then
    -- Either direction. The same sentence both ways, so it tells the blocked
    -- player nothing they couldn't have guessed from no answer.
    raise exception 'You can''t add this player.';
  elsif pair.status = 'accepted' then
    return 'friends';
  elsif pair.user_id = me then
    return 'sent';
  end if;

  -- They had already asked you. Asking back is saying yes.
  update public.friendships
     set status = 'accepted', updated_at = now()
   where id = pair.id;
  return 'friends';
end;
$$;

-- Yes to a request somebody sent you. Only the person asked can accept it,
-- and only while it is still a request.
create or replace function public.accept_friend_request(other uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
begin
  update public.friendships
     set status = 'accepted', updated_at = now()
   where user_id = other and friend_id = me and status = 'pending';
  if not found then
    raise exception 'That request isn''t there any more.';
  end if;
  return 'friends';
end;
$$;

-- The row goes, whichever way round it was: cancelling a request you sent,
-- declining one you were sent, and unfriending are the same act. A block is
-- not touched - the blocked player cannot lift it by "removing" a friendship
-- they cannot even see.
create or replace function public.remove_friend(other uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
begin
  delete from public.friendships
   where least(user_id, friend_id) = least(me, other)
     and greatest(user_id, friend_id) = greatest(me, other)
     and status <> 'blocked';
  return 'none';
end;
$$;

-- A block replaces whatever was there - request or friendship - and is
-- written as the blocker's, which is what makes it theirs alone to see.
-- If the other player had already blocked you the row is left as it is:
-- one block is enough to keep two people apart.
create or replace function public.block_user(other uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
begin
  if other is null or other = me then
    raise exception 'You can''t block yourself.';
  end if;
  if not exists (select 1 from public.profiles where id = other) then
    raise exception 'That player doesn''t have an account.';
  end if;

  insert into public.friendships (user_id, friend_id, status)
    values (me, other, 'blocked')
    on conflict ((least(user_id, friend_id)), (greatest(user_id, friend_id)))
    do update set
      user_id = excluded.user_id,
      friend_id = excluded.friend_id,
      status = 'blocked',
      updated_at = now()
    where public.friendships.status <> 'blocked';
  return 'blocked';
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, and Supabase grants it to
-- `anon` on top. Each function checks the caller anyway; this is the door
-- being shut as well as locked.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.friends_caller()',
    'public.send_friend_request(uuid)',
    'public.accept_friend_request(uuid)',
    'public.remove_friend(uuid)',
    'public.block_user(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
