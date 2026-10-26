-- A guest is not a profile.
--
-- Guests used to get a row here, named `Guest4817` at random. It was identity
-- nobody asked for: a username taken out of the namespace for somebody who
-- never chose it, a row to keep in step, and a `username` column that is
-- `not null` being filled with noise to satisfy itself.
--
-- A guest now has no row at all. Their name comes from the game server, which
-- was always the thing that decided it - the socket handshake carries the
-- profile name only as a suggestion, and with no profile there is simply no
-- suggestion to carry. `profiles` holds accounts, and an account is something
-- a player asked for.

-- 0001 let anyone insert their own row. Anyone now means anyone who is not
-- anonymous: the claim is read off the JWT, so a guest cannot write one by
-- hand whatever the browser is told to do.
drop policy if exists "create own profile" on public.profiles;

create policy "create own profile" on public.profiles
  for insert with check (
    auth.uid() = id
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

-- The rows guests were given before this. They are not referenced by anything
-- - the server keeps its own players table, keyed by user id, and reads no
-- name from here - so they go, and the names they were holding go back into
-- the namespace.
delete from public.profiles p
  using auth.users u
 where u.id = p.id
   and coalesce(u.is_anonymous, false) = true;
