-- Answering, changing your mind, and clearing a chat.
--
-- Four things the table chat has had all along, brought to the one between
-- friends: a reply that names what it answers, an edit, an unsend that
-- leaves a mark rather than a hole, and a way to clear the whole thread.
--
-- The rule from 0009 stands: the browser may read and insert, and nothing
-- else. An edit and an unsend each change a row that is already written, so
-- each is a function that checks whose row it is - otherwise an update grant
-- would let anyone rewrite anyone's message, which is the whole point of the
-- grant being withheld.
--
-- RUN THIS BY HAND, after 0010. Nothing in the app runs migrations.

alter table public.messages
  -- What this message answers. `on delete set null` because the message
  -- replied to may be unsent later, and the reply is still a reply.
  add column if not exists reply_to bigint references public.messages (id) on delete set null,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists messages_reply_to_idx on public.messages (reply_to);

-- An unsent message keeps its row and loses its words, so the thread still
-- reads as a conversation with something taken out of it. That means empty
-- content has to be legal, but only for a row that says why it is empty.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'messages_content_length') then
    alter table public.messages drop constraint messages_content_length;
  end if;
end $$;

alter table public.messages
  add constraint messages_content_length check (
    (deleted_at is not null and content = '')
    or char_length(btrim(content)) between 1 and 1000
  );

-- ---------------------------------------------------------------------------
-- Clearing a chat, for yourself
-- ---------------------------------------------------------------------------
-- Deleting the conversation outright would reach into somebody else's chat
-- and take their half of it with you. So clearing is per person: a mark on
-- the conversation saying how far back you can see. Your thread empties, the
-- other player's is untouched, and neither of you can delete the other's.
alter table public.conversations
  add column if not exists p1_cleared_at timestamptz,
  add column if not exists p2_cleared_at timestamptz;

create or replace function public.clear_conversation(conversation uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
begin
  update public.conversations
     set p1_cleared_at = case when participant_1 = me then now() else p1_cleared_at end,
         p2_cleared_at = case when participant_2 = me then now() else p2_cleared_at end
   where id = conversation
     and me in (participant_1, participant_2);
  if not found then
    raise exception 'That chat isn''t yours to clear.';
  end if;
end;
$$;

-- Reading, with the clearing mark applied. Enforced here rather than left to
-- the browser to filter: a cleared thread that a hand-rolled request can read
-- back is not cleared.
drop policy if exists "read own conversations" on public.messages;
create policy "read own conversations" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and auth.uid() in (c.participant_1, c.participant_2)
         and (
           (auth.uid() = c.participant_1 and (c.p1_cleared_at is null or messages.created_at > c.p1_cleared_at))
           or
           (auth.uid() = c.participant_2 and (c.p2_cleared_at is null or messages.created_at > c.p2_cleared_at))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- Writing, with a reply allowed
-- ---------------------------------------------------------------------------
-- Asking "is that message in this conversation?" from a policy on `messages`
-- would send the planner back through the same policy to answer it, which
-- Postgres refuses as infinite recursion. So the question is answered by a
-- security definer function, the way `are_friends` answers its own. It tells
-- the caller nothing: they must already be in the conversation they name for
-- the rest of the policy to pass.
create or replace function public.reply_in_conversation(reply bigint, conversation uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.messages
     where id = reply and conversation_id = conversation
  );
$$;

revoke execute on function public.reply_in_conversation(bigint, uuid) from public, anon;
grant execute on function public.reply_in_conversation(bigint, uuid) to authenticated;

-- 0010's policy again, plus: a reply may only point at a message in the same
-- conversation, and a message arrives neither edited nor unsent.
drop policy if exists "write to friends" on public.messages;
create policy "write to friends" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and read_at is null
    and edited_at is null
    and deleted_at is null
    and (
      (kind = 'text' and meta is null)
      or (kind = 'invite' and public.valid_invite_meta(meta))
    )
    and (reply_to is null or public.reply_in_conversation(reply_to, conversation_id))
    and exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and auth.uid() in (c.participant_1, c.participant_2)
         and public.are_friends(c.participant_1, c.participant_2)
    )
  );

-- ---------------------------------------------------------------------------
-- Changing what you said
-- ---------------------------------------------------------------------------
-- Your own words only, and only words: an invite is a card pointing at a
-- room, not a sentence to rewrite. An unsent message stays unsent.
create or replace function public.edit_message(message bigint, body text)
  returns timestamptz
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
  at timestamptz := now();
begin
  if char_length(btrim(coalesce(body, ''))) not between 1 and 1000 then
    raise exception 'That message is too long.';
  end if;
  update public.messages
     set content = btrim(body), edited_at = at
   where id = message
     and sender_id = me
     and kind = 'text'
     and deleted_at is null;
  if not found then
    raise exception 'That message can''t be edited.';
  end if;
  return at;
end;
$$;

-- Taking it back. The row stays so the thread keeps its shape, and the words
-- go - there is no copy of them left to read.
create or replace function public.unsend_message(message bigint)
  returns timestamptz
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  me uuid := public.friends_caller();
  at timestamptz := now();
begin
  update public.messages
     set content = '', deleted_at = at, meta = null
   where id = message
     and sender_id = me
     and deleted_at is null;
  if not found then
    raise exception 'That message is already gone.';
  end if;
  return at;
end;
$$;

-- An unsent message is nobody's unread, and neither is anything you cleared.
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
     and m.deleted_at is null
     and (
       (auth.uid() = c.participant_1 and (c.p1_cleared_at is null or m.created_at > c.p1_cleared_at))
       or
       (auth.uid() = c.participant_2 and (c.p2_cleared_at is null or m.created_at > c.p2_cleared_at))
     )
   group by m.sender_id;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.clear_conversation(uuid)',
    'public.edit_message(bigint, text)',
    'public.unsend_message(bigint)',
    'public.my_unread()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
