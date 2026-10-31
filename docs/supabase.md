# Accounts, and where the chips actually live

Supabase holds **who you are**. It holds nothing about what you have, because
there is nothing to hold: chips belong to a room, not to a player.

## Chips belong to a room

Every room is its own match. The host sets **one starting stack for the whole
table** in the waiting room — `setStartingChips` writes that figure to every
entry in the room's lobby — and a separate late-join figure covers anyone
arriving mid-match (`lateJoinChips`). `table.addPlayer(userId, username,
buyIn)` seeds the seat from it. When the match ends, those chips end with it.

So there is no running balance anywhere, and deliberately so. A per-account
figure would be a number nothing reads and everything is tempted to.

- `profiles` is identity only: `id`, `username`, `ingame_name`, `created_at`.
- `users` on the game server is identity only too. It once had a `bankroll`
  column, written when a row was created and read by nothing; it has been
  dropped, and existing databases drop it on startup.

## Two names, and no email

The forms ask for a **username** and never an email. Supabase Auth has exactly
one way to authenticate, which is by email, so `useAuth` maps the username to a
synthetic address — `nik` becomes `nik@bbp.internal` — and hands *that* to
`signUp()` and `signInWithPassword()`. The player never sees it or types it.

`.internal` is reserved and unroutable, which is the point: nothing is ever
sent to these addresses, and a real domain here would mean mail leaving for a
stranger.

The alternative — storing a real email and looking it up by username before
signing in — was not taken. It would need `profiles` readable by anyone not yet
signed in, and the whole table open to anonymous reads is a steep price for one
lookup.

So there are two names, doing different jobs:

| | `username` | `ingame_name` |
|---|---|---|
| What it's for | logging in | what everyone reads at the table |
| Unique? | yes, case-insensitively | no — duplicates are fine |
| Character set | `A-Z a-z 0-9 _ . -`, 3–20 | any script, spaces, `_ . ' -`, 1–20 |
| Changeable? | **no** | yes, whenever they like |

`username` is narrow because it ends up in the local part of an address, where
a space or an apostrophe is a problem. It cannot be changed because the address
is already minted from it — so migration 0003 revokes the browser's `username`
grant and gives it `ingame_name` instead. That is the teeth, not the intention:
a hand-rolled request cannot rename its way out of its own login.

A guest has a random `username` (`Guest4817`) and no `ingame_name`, so
`displayName` falls back to the random one until they pick something.

### Supabase settings this needs

Neither of these is code, and the scheme does not work without either.

**Allow anonymous sign-ins — on.** Guest play is `signInAnonymously()`. With it
off, every guest is turned away with "Guest play is switched off on this
server."

- Local, if `supabase/config.toml` is ever added: `enable_anonymous_sign_ins =
  true` under `[auth]`. There is no `config.toml` in this repo today — the
  project is hosted, and the dashboard is the only place this lives.
- Hosted: **Authentication → Sign In / Providers → Allow anonymous sign-ins**.
- Or over the Management API, with a personal access token and the project ref
  from the dashboard URL:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/{ref}/config/auth"   -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"   -H "Content-Type: application/json"   -d '{"external_anonymous_users_enabled": true}'
```

**Confirm email — off** (Authentication → Sign In / Providers → Email). A
synthetic address has no inbox, so a confirmation link can never be followed.
With it on, `signUp()` returns no session and the sheet says so plainly rather
than spinning.

Before guest play is opened to anyone who finds the URL, see the CAPTCHA and
rate-limit notes in the README: anonymous sign-in is a free account per click.

## How somebody signs in

1. The page asks `/api/config` whether this server will accept a Supabase token.
2. `useAuth` restores a stored session. It does **not** sign anybody in on its
   own: a first-time visitor is asked how they want to play, and minting an
   anonymous account at boot would answer that question for them before the
   prompt could appear. The answer is remembered in `localStorage`
   (`bbp-auth-chosen`), so it is asked once and never again.
3. The three ways through that prompt:
   - **Continue as guest** → `signInAnonymously()`.
   - **Log in** → username + password → `signInWithPassword()` on the synthetic
     address.
   - **Sign up** → username + in-game name + password + confirmation →
     `signUp()`, or `updateUser({ email, password })` for someone already
     playing as a guest.
4. For an account, it reads or creates the player's row in `profiles` from the
   names chosen at sign-up. A guest gets no row — see below.

`onAuthStateChange` keeps `session` and `profile` in step with whatever the
client decides, including changes this page did not start: a token refresh, a
sign-out in another tab, an expiry. A session that goes away mid-match takes
the player back to the prompt rather than leaving them at a table that has
quietly stopped answering.

### "Is this username free?"

Asked **before** `signUp()`, so a taken name is a sentence under the box it
belongs to rather than a unique violation arriving as a generic auth error
about an address the player never saw.

It cannot be a plain `select`: RLS lets a player read their own profile and no
others, which is the right rule. So it goes through
`username_available(text)` — one `security definer` function returning one
boolean, rather than opening the table for the sake of one question.

A failure there is not a refusal. If the migration hasn't been applied or the
network drops, the answer is "go ahead and try": the `lower(username)` unique
index is the real check, and its error maps to the same sentence.

### A guest signing up keeps their identity

Attaching a username to an anonymous user keeps the **same user id**. That id is
what `users.supabase_id` hangs off on this server, so the players row carries
over — along with the name everyone at the table knows them by, and the seat
they are sitting in while they do it. Signing up is an upgrade rather than a
second account, and the socket does not even need to reconnect.

They arrive with a profile for the first time, too. As a guest they had none;
`updateUser` attaches the chosen names to the user's metadata, and the next read
writes the row from it — the same path a fresh signup takes.

## A guest has no profile

`profiles` holds accounts. A guest has no row in it, and `profile` is simply
null for them — an answer, not a gap, and everything that reads it copes.

Guests used to get a row named `Guest4817` at random. It was identity nobody
asked for: a name taken out of a unique namespace on behalf of someone who
never chose it, to satisfy a `not null` column. Their name comes from the game
server instead, which decided it anyway — the socket handshake carries the
profile name only as a suggestion, and with no profile there is no suggestion
to carry.

Migration 0004 is what makes this true rather than a habit of the client's: the
insert policy on `profiles` now reads `is_anonymous` off the JWT, so a guest
cannot write a row by hand whatever the browser is told to do.

## Who the name at the table comes from

Not from the browser. The socket handshake carries the profile name, but only
as a suggestion for a row that does not exist yet — `server/supabaseAuth.js`
verifies the token first, and `cleanDisplayName` holds the name to the same
rule as a rename. After that the server's `users.display_name` is the name,
and every seat, chat line and hand-history entry reads it from room state that
the server built. There is no client-side placeholder anywhere.

## Fine client-side

The player's own, nobody else can see them, and a lie costs nothing:

- Felt, card back and deck colouring (`localStorage`, never sent anywhere).
- Peek zoom strength and speed, auto-reveal, the gesture tutorial.
- Motion and lite-tier preferences, sound.
- Which lobby page you're on, which settings tab is open.
- Which way they chose to play (`bbp-auth-chosen`). It only decides whether the
  first-visit prompt is shown; it grants nothing.
- The in-game name — validated server-side on `setName`, and refused if someone
  at your table already answers to it.

## Must stay on the server

Every one of these is already in `server/game/` and must not move:

- **Chips** — the starting stack, blinds, bets, calls, raises, side pots and
  payouts. All of it room-scoped and server-owned.
- **The deck** — shuffling, dealing, and above all *who can see which cards*.
  Hole cards are sent only to their owner.
- **Hand evaluation and showdown** — who won, and with what.
- **Turn order, the betting clock, and auto-fold** on timeout.
- **Room membership** — seats, the private-room knock, kicks, host powers.
- **Bots**, which decide from the full table state.

The RLS in `supabase/migrations/` enforces the split on the identity side: a
player can read their own row and no others, and the column-level grant means
`ingame_name` is the only thing the browser may write — not `username`, which
the login is minted from.

## Profiles, stats and the two databases

A profile page is two halves from two different databases, joined by one id.

- **Identity** — picture, bio, names — is in Supabase's `profiles`, read
  publicly through the `public_profiles` view (migration 0006). That view
  names the readable columns and no others; there is no email in it, synthetic
  or otherwise, and no `user_metadata`.
- **The record** — how each finished match went — is in the game server's own
  SQLite `game_results`, served by `GET /api/players/:id/stats` and `/recent`.
  Public, rate-limited, and keyed by the same Supabase auth id.

Neither half is a balance. `profiles` still holds no chips (migration 0002),
and a result is what one match did to one stack. The arithmetic lives in
`shared/stats.mjs` so the server and the page cannot disagree about it.

Avatars are in the `avatars` storage bucket at `<auth.uid()>/avatar.webp`:
public to read, writable only by the account whose folder it is and never by
an anonymous one. The browser re-encodes every upload to a 256px square WebP
before it leaves the machine, which also drops the EXIF a photo arrives with.

## Guests, and what becomes of their games

A guest has no `profiles` row, so a guest has no profile page — their own URL
finds nothing, exactly as a stranger's would.

Their finished matches are not written to any database. The server holds them
in memory, keyed by `(verified user id, guestSessionId)`, where the session id
is made once per browser session and kept in `sessionStorage` — so the
anonymous token in `localStorage`, which outlives the tab, cannot be used to
reclaim a session that has ended. See `server/guestBuffer.js`.

They go one of two ways:

- **Signing up in the same session** keeps the user id (`updateUser` on the
  anonymous session), so the client tells the socket to refresh, the server
  re-verifies the token itself, and — only if the id matches and the user is
  now non-anonymous — writes the buffer under that account with
  `was_guest = 1`. The unique `(user_id, match_id)` index makes a retry a
  no-op.
- **Anything else** discards them: the ten-minute grace period after the last
  disconnect, a logout, a server restart, or logging in to an account that
  already existed — which is a different identity, and is told so in the UI.

The client never submits a result. All of it is derived server-side from a
verified identity.

## Everything is guest-accessible

Hosting, joining, spectating, chat and settings all work as a guest. An
account means two things: your name survives the browser forgetting you, and
your matches are kept.

Guest play needs **Anonymous sign-ins** switched on in Supabase — see the
settings above. It is the default way in, so with it off the front door is shut.

## Friends

`friendships` (migration 0007) holds **one row per pair**, whichever way round
they met. `user_id` is whoever acted — asked, or blocked — and `friend_id` is
the other. A unique index on `(least, greatest)` of the two makes "A asked B"
and "B asked A" the same row, so asking back is accepting.

Both columns reference `profiles`, which is the guest rule enforced rather
than remembered: a guest has no row there, so a guest cannot friend or be
friended.

| Status | The asker / blocker sees | The other player sees |
|---|---|---|
| `pending` | Request Sent | Accept Request |
| `accepted` | Friends | Friends |
| `blocked` | Blocked | nothing — RLS hides the row |

The browser may **read** its own rows and **write none**. Every change is a
`security definer` function, because each is a rule about the pair that a
row policy cannot express:

- `send_friend_request(target)` — refused for guests, yourself, anyone without
  an account, and either side of a block.
- `accept_friend_request(other)` — only by the player who was asked.
- `remove_friend(other)` — cancel, decline and unfriend are the same delete.
  It never touches a block, so the blocked player cannot lift one.
- `block_user(other)` — replaces a request or friendship and is written as the
  blocker's. If the other player already blocked you, their block stands.

The reading of a row from each end lives in `shared/friendship.mjs`, tested in
`tests/friendship.test.js`. There is no unblock yet.

### The list, and who's on

Migration 0008 adds `profiles.last_seen_at` and two functions.

- `touch_last_seen()` stamps it with the database's clock. The page calls it
  once a minute while it is visible — started by the app shell on sign in, not
  by the sidebar, so it keeps beating at a table.
- `my_friends()` returns everyone you have a non-blocked row with: friends,
  requests you were sent, requests you sent. For accepted friends only, it
  gives `seen_secs_ago`, worked out in the database so a wrong clock in the
  browser can't turn somebody green.

A friend seen within two minutes is online (`ONLINE_WITHIN` in
`shared/lastSeen.mjs`) — two beats, so one late one is forgiven. Past that the
list reads `just now`, `5m ago`, `3h ago`, `2d ago`, then the date.

This is a timestamp, not Supabase Presence, on purpose: a presence channel
shows everyone subscribed to it who is online, and this shows only your
friends. `last_seen_at` is in neither the column grant nor `public_profiles`.

`friendships` is in the `supabase_realtime` publication, so a request or an
accept redraws the other player's list without a reload. Realtime applies the
select policy to inserts and updates; deletes carry only an id and can't be
filtered, so any delete makes the list re-read itself through RLS.
