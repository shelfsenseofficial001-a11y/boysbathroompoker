# Guest accounts, and where the chips actually live

Supabase holds **who you are**. The Node server holds **what you have**. Nothing
in the browser is allowed to be the authority on a chip.

## How a guest signs in

1. The page asks `/api/config` whether this server will accept a Supabase token.
2. `useGuestAuth` calls `supabase.auth.signInAnonymously()` on the first visit
   and reuses the stored session on every visit after it. There is no login
   screen, no password and no OAuth.
3. It reads or creates the player's row in `profiles` — `Guest4817`, 1000 chips,
   `created_at`.
4. The socket handshake carries the access token. `server/supabaseAuth.js`
   verifies it (locally against `SUPABASE_JWT_SECRET`, or by asking the auth
   server), and only the verified `sub` claim is allowed to name a player.
5. `server/sockets.js` maps that id onto a row in the server's own `users`
   table, creating one the first time. That row's `bankroll` is the real one.

With no Supabase keys set, all of this is skipped and the server's existing
`SKIP_AUTH` per-tab guest naming takes over, so the game still runs on a laptop
with no internet.

## Fine client-side

These are the player's own, nobody else can see them, and a lie costs nothing:

- Felt, card back and deck colouring (`localStorage`, never sent anywhere).
- Peek zoom strength and speed, auto-reveal, the gesture tutorial.
- Motion and lite-tier preferences, sound.
- Which lobby page you're on, which settings tab is open.
- The display name — validated server-side on `setName`, and refused if someone
  at your table already answers to it.

## Must stay on the server

Every one of these is already in `server/game/` and must not move:

- **Chip transactions of any kind** — buy-ins, blinds, bets, calls, raises,
  side pots, payouts, rebuys. `profiles.chips` is a starting figure the server
  reads, never a balance the page writes.
- **The deck** — shuffling, dealing, and above all *who can see which cards*.
  Hole cards are sent only to their owner.
- **Hand evaluation and showdown** — who won, and with what.
- **Turn order, the betting clock, and auto-fold** on timeout.
- **Room membership** — seats, the private-room knock, kicks, host powers.
- **Bots**, which decide from the full table state.

The RLS in `supabase/migrations/0001_profiles.sql` enforces the split: a guest
can read their own row and rename themselves, and the column-level grant means
`chips` cannot be written by the browser even though the row is its own.

## If chips should ever persist across sessions

They don't today — a table's stacks live in memory and the bankroll lives in
SQLite. If that moves to Supabase, the write has to come from the server with
the service-role key (or a Postgres function the anon role may only *call*),
never from the page. An Edge Function would work; a client-side `update` would
mean a player can type themselves a million chips.
