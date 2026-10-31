-- Inviting a friend to a table, through the chat you already have.
--
-- An invite is a message with `kind = 'invite'` and a `meta` carrying the
-- room code and, for a private room, the host's token. It is drawn as a card
-- with a Join button rather than a line of text, but it travels the same
-- path as any other message: into a conversation you're in, with somebody
-- who is your friend right now. 0009's insert policy allowed text only; this
-- widens it to invites without loosening who may write one.
--
-- RUN THIS BY HAND, after 0009. Nothing in the app runs migrations.

-- What a valid invite's meta looks like: a five-character room code, and an
-- optional token. Checked in the database so a hand-rolled message cannot put
-- anything else in a card the other person taps - the code is about to be
-- turned into a link they follow.
create or replace function public.valid_invite_meta(meta jsonb)
  returns boolean
  language sql
  immutable
  set search_path = public
as $$
  select meta is not null
     and jsonb_typeof(meta) = 'object'
     and meta ? 'code'
     and jsonb_typeof(meta -> 'code') = 'string'
     and meta ->> 'code' ~ '^[A-Za-z0-9]{1,8}$'
     and (not (meta ? 'token')
          or (jsonb_typeof(meta -> 'token') = 'string'
              and char_length(meta ->> 'token') <= 64))
     -- Nothing but code and token: an unknown key is a card carrying
     -- something the sender was not meant to put there.
     and not exists (
       select 1 from jsonb_object_keys(meta) as k(key)
        where k.key not in ('code', 'token')
     );
$$;

grant execute on function public.valid_invite_meta(jsonb) to authenticated;

-- The insert policy again, text or invite this time. Everything that made a
-- text message safe still holds: written as yourself, never as a guest, into
-- your own conversation, with a current friend. An invite adds the shape of
-- its meta; a text message still carries none.
drop policy if exists "write to friends" on public.messages;
create policy "write to friends" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and read_at is null
    and (
      (kind = 'text' and meta is null)
      or (kind = 'invite' and public.valid_invite_meta(meta))
    )
    and exists (
      select 1 from public.conversations c
       where c.id = conversation_id
         and auth.uid() in (c.participant_1, c.participant_2)
         and public.are_friends(c.participant_1, c.participant_2)
    )
  );
