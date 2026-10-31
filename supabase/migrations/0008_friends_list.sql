-- The friends list, and who on it is around.
--
-- "Around" is a timestamp, not a live connection: the page touches
-- `last_seen_at` once a minute while it is open and in front of somebody, and
-- a friend seen in the last two minutes is drawn as online. Coarser than a
-- presence channel, and deliberately so - a presence channel tells everyone
-- subscribed to it who is online, and this tells only your friends.
--
-- RUN THIS BY HAND, after 0007. Nothing in the app runs migrations.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- Not in the column grant (0006) and not in `public_profiles`: the browser
-- cannot write a time it wasn't seen at, and a stranger cannot read when
-- somebody was last about. Both go through the functions below.

-- "I'm here." Stamped with the database's clock, never the browser's, so a
-- machine set a day fast cannot keep somebody green.
create or replace function public.touch_last_seen()
  returns void
  language sql
  security definer
  set search_path = public
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- Everyone you have a friendship row with, as the list draws them: friends,
-- requests you've been sent, requests you've sent. Blocks are left out from
-- both ends - yours are not friends, and theirs you are not meant to see.
--
-- `seen_secs_ago` is worked out here rather than handing back a timestamp
-- for the browser to subtract from its own clock, which may be wrong. It is
-- only given for accepted friends: somebody who has merely asked you does
-- not get to know when you were last online, nor you them.
create or replace function public.my_friends()
  returns table (
    id uuid,
    username text,
    ingame_name text,
    avatar_url text,
    state text,
    seen_secs_ago integer,
    since timestamptz
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id,
         p.username,
         p.ingame_name,
         p.avatar_url,
         case
           when f.status = 'accepted' then 'friends'
           when f.user_id = auth.uid() then 'sent'
           else 'received'
         end,
         case
           when f.status = 'accepted' and p.last_seen_at is not null
             then greatest(0, extract(epoch from now() - p.last_seen_at))::integer
         end,
         f.updated_at
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
   where (f.user_id = auth.uid() or f.friend_id = auth.uid())
     and f.status <> 'blocked';
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['public.touch_last_seen()', 'public.my_friends()'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- Live changes to friendships, so a request or an accept shows up in the
-- other player's list without them reloading. Realtime applies the select
-- policy from 0007 to what it sends, so nobody hears about a row they could
-- not have read. Guarded, because adding a table twice is an error.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships'
     ) then
    alter publication supabase_realtime add table public.friendships;
  end if;
end $$;
