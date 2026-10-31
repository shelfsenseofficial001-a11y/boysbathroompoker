-- Talking to your friends.
--
-- One conversation per pair, and messages in it. Only friends may write: the
-- insert policy asks `friendships` whether the two are accepted friends right
-- now, so unfriending or blocking stops a conversation at the database rather
-- than at a button. What was said before stays readable to the two of them.
--
-- RUN THIS BY HAND, after 0008. Nothing in the app runs migrations.

-- Are these two accepted friends? Security definer because the caller can
-- only see their own friendship rows - which is exactly the row asked about,
-- but a policy calling this should not depend on that.
create or replace function public.are_friends(a uuid, b uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.friendships
     where least(user_id, friend_id) = least(a, b)
       and greatest(user_id, friend_id) = greatest(a, b)
       and status = 'accepted'
  );
$$;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
-- The pair is stored lower id first, so there is exactly one way to write it
-- and the unique constraint means exactly one conversation per pair.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  participant_1 uuid not null references public.profiles (id) on delete cascade,
  participant_2 uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint conversations_ordered check (participant_1 < participant_2),
  constraint conversations_pair_key unique (participant_1, participant_2)
);
create index if not exists conversations_p2_idx on public.conversations (participant_2);

alter table public.conversations enable row level security;

drop policy if exists "see own conversations" on public.conversations;
create policy "see own conversations" on public.conversations
  for select to authenticated using (auth.uid() in (participant_1, participant_2));

-- Made only through open_conversation(), which checks the friendship first.
revoke all on public.conversations from anon;
revoke insert, update, delete on public.conversations from authenticated;
grant select on public.conversations to authenticated;

-- The conversation with `other`, made the first time it is asked for.
-- Opening one needs a friendship; reading an old one does not.
create or replace function public.open_conversation(other uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
  lo uuid := least(me, other);
  hi uuid := greatest(me, other);
  conv uuid;
begin
  select id into conv from public.conversations
   where participant_1 = lo and participant_2 = hi;
  if conv is not null then
    return conv;
  end if;
  if not public.are_friends(me, other) then
    raise exception 'You can only message friends.';
  end if;
  insert into public.conversations (participant_1, participant_2)
    values (lo, hi)
    on conflict (participant_1, participant_2) do nothing
    returning id into conv;
  if conv is null then
    select id into conv from public.conversations
     where participant_1 = lo and participant_2 = hi;
  end if;
  return conv;
end;
$$;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
-- `kind` and `meta` are for the game invites that arrive in a later
-- migration; until then the insert policy accepts plain text only.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  content text not null,
  kind text not null default 'text' check (kind in ('text', 'invite')),
  meta jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  -- The same limit the composer counts down to. Blank is refused here too:
  -- a message of spaces is a bubble with nothing in it.
  constraint messages_content_length check (char_length(btrim(content)) between 1 and 1000)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id desc);
-- Unread counts look for "not mine, not read" across every conversation.
create index if not exists messages_unread_idx on public.messages (conversation_id) where read_at is null;

alter table public.messages enable row level security;

drop policy if exists "read own conversations" on public.messages;
create policy "read own conversations" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and auth.uid() in (c.participant_1, c.participant_2)
    )
  );

-- The teeth. Written as yourself, never as a guest, into a conversation you
-- are in, with somebody who is your friend at this moment.
drop policy if exists "write to friends" on public.messages;
create policy "write to friends" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and kind = 'text'
    and meta is null
    and read_at is null
    and exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and auth.uid() in (c.participant_1, c.participant_2)
         and public.are_friends(c.participant_1, c.participant_2)
    )
  );

revoke all on public.messages from anon;
revoke update, delete on public.messages from authenticated;
grant select, insert on public.messages to authenticated;

-- Keeps the conversation's own clock, for sorting by most recent. A trigger
-- rather than a grant: the browser cannot update conversations at all.
create or replace function public.messages_touch_conversation()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.messages_touch_conversation();

-- "I've read up to here." Marks the other person's messages in one
-- conversation, never your own, with the database's clock. A function rather
-- than an update grant, so nobody can un-read a message or backdate a read.
create or replace function public.mark_read(conversation uuid)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  update public.messages m
     set read_at = now()
    from public.conversations c
   where c.id = conversation
     and m.conversation_id = c.id
     and auth.uid() in (c.participant_1, c.participant_2)
     and m.sender_id <> auth.uid()
     and m.read_at is null;
$$;

-- Unread messages, per friend, for the badges on the friends list.
create or replace function public.my_unread()
  returns table (friend_id uuid, unread integer)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select m.sender_id, count(*)::integer
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where auth.uid() in (c.participant_1, c.participant_2)
     and m.sender_id <> auth.uid()
     and m.read_at is null
   group by m.sender_id;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.are_friends(uuid, uuid)',
    'public.open_conversation(uuid)',
    'public.mark_read(uuid)',
    'public.my_unread()',
    'public.messages_touch_conversation()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
  end loop;
  foreach fn in array array[
    'public.are_friends(uuid, uuid)',
    'public.open_conversation(uuid)',
    'public.mark_read(uuid)',
    'public.my_unread()'
  ] loop
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- New messages arrive live. Realtime checks the select policy above for each
-- listener, so a message reaches the two people in its conversation and
-- nobody else.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
