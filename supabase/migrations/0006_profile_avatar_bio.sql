-- A profile becomes something to look at.
--
-- 0002 settled what a profile is for: identity, and nothing that counts. The
-- two columns here are identity too - a picture and a sentence - and the rule
-- from 0002 still holds, so there is still no chip, balance or score anywhere
-- in this table. A player's record lives in the game server's own results
-- table, keyed by the same auth id, and is served from there.
--
-- RUN THIS BY HAND. Nothing in the app runs migrations.

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists bio text;

-- The length rule, where it cannot be argued with. The form checks it too
-- (shared/profileFields.mjs), but a rule only the client enforces is a rule
-- anyone with a console can break, and a bio is drawn on a page other people
-- read.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_length'
  ) then
    alter table public.profiles
      add constraint profiles_bio_length check (bio is null or char_length(bio) <= 160);
  end if;
end $$;

-- The teeth, restated once more. 0005 granted username and ingame_name; the
-- picture and the sentence join them. Everything still withheld stays
-- withheld: `id` and `created_at` are not in the grant, so a row cannot be
-- reassigned to another account or backdated.
revoke update on public.profiles from authenticated;
grant update (username, ingame_name, avatar_url, bio) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- The public half of a profile
-- ---------------------------------------------------------------------------
-- RLS on `profiles` lets a player read their own row and no others, which is
-- the right rule for the table and the wrong one for a page anybody may open.
-- Rather than loosening it, the readable columns are named here and that view
-- is what the world is given.
--
-- What is not in this list is the point of the list. There is no email - the
-- address an account authenticates by is synthetic, minted from the username,
-- and showing it would be showing somebody a thing they never typed. There is
-- no user_metadata, and no way to ask this view about an anonymous user,
-- because guests have no row in `profiles` at all (0004).
create or replace view public.public_profiles
  with (security_invoker = false)
as
  select id, username, ingame_name, avatar_url, bio, created_at
    from public.profiles;

grant select on public.public_profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Avatars
-- ---------------------------------------------------------------------------
-- Wrapped in a block that survives being refused.
--
-- `storage.objects` is not owned by the role the SQL editor runs as on every
-- project, and where it isn't, CREATE POLICY on it raises insufficient
-- privilege. Left bare, that one error would roll back this whole file -
-- including the columns and the view above, which have nothing to do with
-- storage and would otherwise have applied cleanly. So it is caught, and
-- says what to do instead rather than failing the migration.
--
-- The policies are the same three questions either way: anyone may read a
-- picture, and only the account whose folder it is - never an anonymous one -
-- may write, replace or remove it. The path is `<auth.uid()>/avatar.webp`,
-- built in one place (shared/profileFields.mjs) so the upload and this check
-- cannot drift apart.
do $do$
begin
  insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true)
    on conflict (id) do update set public = true;

  execute $p$drop policy if exists "avatars are public" on storage.objects$p$;
  execute $p$create policy "avatars are public" on storage.objects
    for select using (bucket_id = 'avatars')$p$;

  execute $p$drop policy if exists "write own avatar" on storage.objects$p$;
  execute $p$create policy "write own avatar" on storage.objects
    for insert to authenticated with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    )$p$;

  execute $p$drop policy if exists "replace own avatar" on storage.objects$p$;
  execute $p$create policy "replace own avatar" on storage.objects
    for update to authenticated using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    )$p$;

  execute $p$drop policy if exists "remove own avatar" on storage.objects$p$;
  execute $p$create policy "remove own avatar" on storage.objects
    for delete to authenticated using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    )$p$;
exception
  when insufficient_privilege then
    raise notice 'Storage policies were refused on this project. Everything else applied. Create them by hand under Storage > avatars > Policies: public SELECT, and INSERT/UPDATE/DELETE where (storage.foldername(name))[1] = auth.uid()::text.';
end
$do$;
