-- The last thing said, for the friends list.
--
-- A name with a green dot tells you somebody is there; it doesn't tell you
-- they asked you something an hour ago. This is the one line under each name
-- that does - the latest message in that chat, whoever sent it.
--
-- It answers with the same reach the thread itself has: a message you cleared
-- (0011) is not the last thing said as far as you are concerned, and the
-- other player's clearing has no bearing on yours.
--
-- RUN THIS BY HAND, after 0011. Nothing in the app runs migrations.

create or replace function public.my_chat_previews()
  returns table (
    friend_id uuid,
    content text,
    sender_id uuid,
    kind text,
    deleted boolean,
    at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- One row per conversation: `distinct on` with the newest message first
  -- keeps the latest and drops the rest.
  select distinct on (c.id)
         case when c.participant_1 = auth.uid() then c.participant_2 else c.participant_1 end,
         -- An unsent message carries no words to show, and the flag beside
         -- it is what the list draws instead.
         m.content,
         m.sender_id,
         m.kind,
         (m.deleted_at is not null),
         m.created_at
    from public.conversations c
    join public.messages m on m.conversation_id = c.id
   where auth.uid() in (c.participant_1, c.participant_2)
     and (
       (auth.uid() = c.participant_1 and (c.p1_cleared_at is null or m.created_at > c.p1_cleared_at))
       or
       (auth.uid() = c.participant_2 and (c.p2_cleared_at is null or m.created_at > c.p2_cleared_at))
     )
   order by c.id, m.id desc;
$$;

revoke execute on function public.my_chat_previews() from public, anon;
grant execute on function public.my_chat_previews() to authenticated;
