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

## Everything is guest-accessible

Hosting, joining, spectating, chat and settings all work as a guest. An
account means one thing: your name survives the browser forgetting you.

Guest play needs **Anonymous sign-ins** switched on in Supabase — see the
settings above. It is the default way in, so with it off the front door is shut.
