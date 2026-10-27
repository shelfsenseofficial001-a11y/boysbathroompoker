// Who the player is: a guest, or an account.
//
// A guest is an anonymous Supabase user. An account is the same thing with a
// username and password attached - which matters, because attaching them
// keeps the user id, and the user id is what the game server's own players
// row hangs off. A guest who signs up keeps everything they had, because they
// are still the same player.
//
// The forms ask for a username and never an email. Supabase Auth has only one
// way to authenticate, which is by email, so a username is mapped to a
// synthetic address - `nik` becomes `nik@bbp.internal` - and that address is
// what signUp and signInWithPassword are given. It is never shown and never
// typed. The alternative, looking an email up by username before signing in,
// would need `profiles` open to anonymous reads; this needs nothing.
//
// Two names, then. `username` is the handle the account is reached by: unique,
// ASCII, and fixed once minted, because the synthetic address is derived from
// it. `ingame_name` is what everyone reads at the table: duplicates welcome,
// changeable, and the one a rename writes.
//
// A guest has no profile row at all - `profile` is null for them, and that is
// an answer rather than a gap. Their name comes from the game server, which
// decided it anyway. Everything reading `profile` here copes with null.
//
// A profile is identity and nothing else. There is no chip balance here and
// there should never be one - every room is its own match, with a starting
// stack the host sets for that table. See docs/supabase.md.
import { ref, computed } from 'vue';
import { supabase, supabaseConfigured } from '../lib/supabase.js';
import { createProfileLoader } from './profileLoader.mjs';
import {
  USERNAME_RE as SHARED_USERNAME_RE,
  DISPLAY_NAME_RE,
  MIN_PASSWORD as SHARED_MIN_PASSWORD,
} from '../../shared/displayName.mjs';

// Set once the player has said how they want to play. Its only job is to stop
// the first-visit prompt coming back at someone who already answered it.
const CHOSE_KEY = 'bbp-auth-chosen';

// Not a real domain, and deliberately not a routable one: nothing is ever
// sent to these addresses, and a typo'd public domain here would mean mail
// leaving for a stranger. `.internal` is reserved for exactly this. Settable
// per deployment, since the server reads the username back out of the local
// part and does not care what follows the @.
const SYNTHETIC_DOMAIN = import.meta.env.VITE_AUTH_EMAIL_DOMAIN || 'bbp.internal';

// Both rules come from shared/displayName.mjs, which the server imports too.
// They were two near-copies before, and the difference between them - 1
// character here, 2 there - was enough to seat a player under a generated
// guest name without a word. One rule now, or it drifts again.
export const USERNAME_RE = SHARED_USERNAME_RE;
export const INGAME_NAME_RE = DISPLAY_NAME_RE;
export const MIN_PASSWORD = SHARED_MIN_PASSWORD;

// The mapping, in one place. Lower-cased, so a username is case-insensitive
// to log in with - which is what the `lower(username)` index in migration
// 0003 holds to on the way in.
export const usernameToEmail = (username) =>
  `${String(username).trim().toLowerCase()}@${SYNTHETIC_DOMAIN}`;

const session = ref(null);
const profile = ref(null);
const ready = ref(false);
const error = ref(null);
const chose = ref(readChose());
let started = null;

function readChose() {
  try {
    return localStorage.getItem(CHOSE_KEY) === '1';
  } catch {
    // Storage unavailable: the prompt is shown again, which is the safe way
    // to be wrong - it asks a question rather than guessing an identity.
    return false;
  }
}

function markChosen() {
  chose.value = true;
  try {
    localStorage.setItem(CHOSE_KEY, '1');
  } catch {
    // Not persisted; it still holds for this page.
  }
}

// Supabase says what went wrong in its own words, some of which are for
// developers rather than players - and some of which are about an email the
// player never saw, so they are answered in terms of the username instead.
// These are the ones a form can actually produce; anything unlisted is passed
// through rather than swallowed, since a vague "something went wrong" is
// worse than an odd sentence.
const AUTH_MESSAGES = [
  [/invalid login credentials/i, 'That username and password don’t match an account.'],
  [/user already registered|already been registered/i, 'That username is taken.'],
  [/identity.*already (exists|linked)/i, 'That username is taken.'],
  [/password should be at least/i, `Use a password of at least ${MIN_PASSWORD} characters.`],
  // Both of these are about the synthetic address, which the player did not
  // type. If either turns up, the username it was built from is the problem.
  [/unable to validate email|invalid format/i, 'Use only letters, numbers and _ . - in a username.'],
  [
    /email not confirmed/i,
    'This account is waiting on an email confirmation it can never get — switch confirmation off in Supabase.',
  ],
  [/anonymous sign-ins are disabled/i, 'Guest play is switched off on this server.'],
  // The profiles insert policy refusing a token that still says the account
  // is a guest. The player did nothing wrong and can do nothing about it, so
  // it says what will actually help rather than quoting Postgres.
  [
    /row-level security policy/i,
    'Couldn’t finish setting up your account. Sign in again and it will pick up where it left off.',
  ],
  // The column grant refusing a write. It means a migration has not been
  // applied rather than anything the player did, so it says what it is
  // instead of showing them a sentence about Postgres tables.
  [
    /permission denied for table/i,
    'Renaming isn’t switched on for this server yet. Your account hasn’t been changed.',
  ],
  // Nothing here sends mail, so an email rate limit is not a player trying
  // too often - it is Supabase attempting a confirmation email for a
  // synthetic address, which only happens with confirmation switched on. The
  // message names the real cause rather than blaming the person typing.
  [
    /email rate limit|over_email_send_rate_limit/i,
    'Accounts can’t be created while this server is set to confirm them by email — switch confirmation off in Supabase.',
  ],
  [/rate limit|too many requests/i, 'Too many attempts — wait a moment and try again.'],
  // What a dropped connection looks like coming out of fetch. Worth naming,
  // because it is the one failure here that is nothing to do with what the
  // player typed.
  [/failed to fetch|networkerror|network request failed/i, 'Couldn’t reach the server. Check your connection and try again.'],
];

export function authMessage(err) {
  const raw = err?.message || String(err || '');
  const known = AUTH_MESSAGES.find(([re]) => re.test(raw));
  return known ? known[1] : raw || 'Something went wrong. Try again.';
}

// Asked before signing up, so a taken name is a sentence under the box rather
// than a unique violation surfacing as a generic auth error. Through an RPC
// because RLS - rightly - lets a player read their own profile and no others.
//
// A failure here is not a refusal. If the function is missing (migration not
// applied) or the network drops, the answer is "go ahead and try": the unique
// index is the real check, and its error maps to the same sentence.
export async function usernameAvailable(username) {
  try {
    const { data, error: err } = await supabase.rpc('username_available', {
      name: String(username).trim(),
    });
    if (err) return true;
    return data !== false;
  } catch {
    return true;
  }
}

// The row is this player's own: read it, and make it the first time they
// arrive with an account.
//
// A guest has no row and never gets one. There is nothing to put in it that
// they chose - `username` is `not null`, and filling it with `Guest4817`
// would take a name out of the namespace on behalf of someone who never asked
// for it. The game server names guests, as it always did. Migration 0004 is
// what makes this true rather than merely the client's habit: an anonymous
// JWT fails the insert policy.
//
// So this resolves to null quite normally, and every reader of `profile` has
// to cope with that.
async function loadProfile(user) {
  const { data, error: readErr } = await supabase
    .from('profiles')
    .select('id, username, ingame_name, avatar_url, bio, created_at')
    .eq('id', user.id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (data) return data;
  if (user.is_anonymous === true) return null;

  // An account with no row yet: either the sign-up that made it, or the guest
  // who just upgraded and is arriving under their chosen name for the first
  // time. Both carry the names on the user's metadata.
  const username = String(user.user_metadata?.username || '').trim();
  const ingame = String(user.user_metadata?.ingame_name || '').trim() || null;
  if (!username) return null;

  const insert = () =>
    supabase
      .from('profiles')
      .insert({ id: user.id, username, ingame_name: ingame })
      .select('id, username, ingame_name, avatar_url, bio, created_at')
      .single();

  let { data: made, error: writeErr } = await insert();

  // 42501 = the insert policy refused it. For a user who is not anonymous
  // that can mean one thing: the access token in hand still says they are,
  // because upgrading a guest keeps the user id and does not reissue the
  // token. The row is written against the token, not against the user object
  // the browser is holding, so the database is right and the token is stale.
  //
  // A session that got into this state before signUp learned to refresh
  // would otherwise retry the same refused insert on every page load for as
  // long as the token lived. One refresh puts it right for good.
  if (writeErr?.code === '42501' && user.is_anonymous !== true) {
    const { error: refreshErr } = await supabase.auth.refreshSession();
    if (!refreshErr) ({ data: made, error: writeErr } = await insert());
  }

  // 23505 = unique violation. It should not happen, the name having been
  // checked before signing up - but if it does, it is the one thing it can
  // mean, and seating them under some other name would be a lie about who
  // they are.
  if (writeErr) throw writeErr.code === '23505' ? new Error('That username is taken.') : writeErr;
  return made;
}

// Everything that ends with a session in hand finishes here.
async function adopt(next) {
  session.value = next;
  // Through syncProfile rather than loadProfile, so this and the auth-state
  // listener can't both decide to create the same row at once - and so both
  // of them wait for that one load, rather than the second walking past it.
  await syncProfile(next?.user || null, { strict: true });
  if (next) markChosen();
  return next;
}

// Boot only restores what is already there. It deliberately does NOT sign
// anybody in: a first-time visitor is asked how they want to play, and
// minting an anonymous account here would answer that question for them
// before the prompt could appear.
async function start() {
  if (!supabaseConfigured) {
    ready.value = true;
    return;
  }
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) await adopt(data.session);
  } catch (err) {
    error.value = authMessage(err);
  } finally {
    ready.value = true;
  }
}

if (supabaseConfigured) {
  // Every change of session lands here, not just the ones this page started:
  // a token refresh, a sign-out in another tab, an expiry. The access token
  // is what the socket handshake is checked against, and the profile has to
  // follow whoever the session now belongs to.
  supabase.auth.onAuthStateChange((_event, next) => {
    session.value = next;
    syncProfile(next?.user || null);
  });
}

// The guard that Bug 1 came out of lives in profileLoader.js, which imports
// nothing and is tested on its own. What is left here is the wiring: what a
// load actually is, and who the session belongs to at the moment one lands.
const loader = createProfileLoader({
  load: () => loadProfile(session.value.user),
  currentUserId: () => session.value?.user?.id || null,
  retries: 1,
});

// Keeps `profile` pointing at the session's owner. A token refresh is the
// same person and needs no fetch; a sign-out leaves nobody, and the stale
// name has to go with them rather than sitting in the top bar under someone
// else's session.
//
// `strict` is set by the callers a player is waiting on - signing in, signing
// up - where a profile that will not load has to stop the flow and say so. A
// failure there used to fall through to a socket connecting with no name, and
// the server then named the player permanently. The auth-state listener calls
// it without `strict`, because a background token refresh is no place to throw.
async function syncProfile(user, { strict = false } = {}) {
  if (!user) {
    profile.value = null;
    await loader.sync(null);
    return;
  }

  const result = await loader.sync(user.id);

  // The session moved on while this was in the air. Dropping it is the whole
  // point: applying it would put one player's profile on another's session.
  if (result.stale || result.cached) return;

  if (result.error) {
    const message = authMessage(result.error);
    error.value = message;
    if (strict) throw new Error(message);
    return;
  }

  profile.value = result.profile;
}

// After a guest becomes an account the same user id means something new: a
// row they now have, and may not have had a moment ago. Asking again is the
// point, so the "already loaded" answer is withdrawn first.
async function refreshProfile(user) {
  loader.forget();
  await syncProfile(user, { strict: true });
}

export function useAuth() {
  if (!started) started = start();

  const user = computed(() => session.value?.user || null);
  // Supabase marks anonymous users; a session without the flag is an account.
  const isGuest = computed(() => user.value?.is_anonymous === true);

  return {
    ready,
    error,
    session,
    profile,
    initPromise: started,
    accessToken: computed(() => session.value?.access_token || null),
    userId: computed(() => user.value?.id || null),
    // The handle they log in with.
    username: computed(() => profile.value?.username || null),
    ingameName: computed(() => profile.value?.ingame_name || null),
    // What a nameplate should read - or null for a guest, who has no profile
    // at all. Null is the right answer rather than a gap to paper over: the
    // handshake carries this only as a suggestion, and with none the server
    // names them, which is where a guest's name has always come from.
    displayName: computed(() => profile.value?.ingame_name || profile.value?.username || null),
    // The picture on the bar, the seats and the chat. Null for a guest, and
    // null for an account that has not set one - both draw the generated
    // mark instead, which every player has had all along.
    avatarUrl: computed(() => profile.value?.avatar_url || null),
    bio: computed(() => profile.value?.bio || ''),
    isGuest,
    signedIn: computed(() => !!session.value),
    hasAccount: computed(() => !!session.value && !isGuest.value),

    // True when nobody has said how they want to play yet. The first-visit
    // prompt hangs off this, and an existing session of either kind - or an
    // answer given on a previous visit - takes it away.
    needsChoice: computed(
      () => supabaseConfigured && ready.value && !session.value && !chose.value
    ),
    // They answered once before but the session has since gone (expired, or
    // cleared). Asking again would be nagging, so this says to put them back
    // in as a guest without a word.
    shouldResumeGuest: computed(
      () => supabaseConfigured && ready.value && !session.value && chose.value
    ),

    // --- The three ways in ---------------------------------------------
    async continueAsGuest() {
      const { data, error: err } = await supabase.auth.signInAnonymously();
      if (err) throw new Error(authMessage(err));
      return adopt(data.session);
    },

    async signIn({ username, password }) {
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (err) throw new Error(authMessage(err));
      return adopt(data.session);
    },

    // Signing up as a guest does not start again from nothing: the username
    // and password are attached to the anonymous user already in hand, which
    // keeps the user id - and so the players row the game server has been
    // keeping against it, and the seat they are sitting in while they do it.
    //
    // The name is checked for a clash before either call, so a taken username
    // says so instead of arriving as a unique violation or a generic auth
    // error from somewhere inside auth.users.
    //
    // Resolves to { needsConfirmation }. That should always be false here - a
    // synthetic address has no inbox to confirm from, so email confirmation
    // has to be off in Supabase for usernames to work at all - but if it is
    // on, this is how it shows up, and the caller says so rather than
    // pretending the account is ready.
    async signUp({ username, ingameName, password }) {
      const handle = String(username).trim();
      if (!(await usernameAvailable(handle))) {
        throw new Error('That username is taken.');
      }
      const names = {
        username: handle,
        ingame_name: String(ingameName || '').trim() || null,
      };

      if (isGuest.value) {
        const { data, error: err } = await supabase.auth.updateUser({
          email: usernameToEmail(handle),
          password,
          data: names,
        });
        if (err) throw new Error(authMessage(err));
        // An upgrade keeps the session it already had, so there is nothing to
        // adopt. What it does have now is a profile: they had none as a
        // guest, and the row is written on this next read, from the metadata
        // the call above just attached.
        const confirmed = !!data.user?.email_confirmed_at;
        if (confirmed) {
          // First the token, and this order is not optional. The user id does
          // not change on an upgrade, so the access token in hand is still the
          // anonymous one - `is_anonymous: true` - until it is reissued. The
          // insert policy on `profiles` reads that claim, so writing the row
          // before refreshing is refused by the database with "new row
          // violates row-level security policy", which is the policy working
          // exactly as intended on a token that has not caught up.
          const { error: refreshErr } = await supabase.auth.refreshSession();
          if (refreshErr) throw new Error(authMessage(refreshErr));
          await refreshProfile(data.user);
        }
        return { needsConfirmation: !confirmed };
      }

      const { data, error: err } = await supabase.auth.signUp({
        email: usernameToEmail(handle),
        password,
        options: { data: names },
      });
      if (err) throw new Error(authMessage(err));
      // No session means the account exists but is waiting on a confirmation
      // email. The profile row is made whenever the session first turns up.
      if (!data.session) return { needsConfirmation: true };
      await adopt(data.session);
      return { needsConfirmation: false };
    },

    // --- The ways out ---------------------------------------------------
    // Signing out leaves them on the homepage, signed out, with the bar
    // offering the way back in.
    //
    // It deliberately does NOT forget the first-visit answer. That flag means
    // "this person has been asked how they want to play", which is still true
    // the moment after they log out - clearing it would throw the opening
    // prompt back in the face of somebody who just chose to leave.
    async signOut() {
      try {
        await supabase.auth.signOut();
      } catch {
        // The network, most likely. The session is going either way: a
        // sign-out that leaves the player looking signed in is worse than
        // one the server hears about late.
      }
      session.value = null;
      profile.value = null;
    },

    // A guest dropping this identity for a fresh one. The choice stands -
    // they have said they want to play as a guest - so no prompt.
    async newGuest() {
      await supabase.auth.signOut();
      session.value = null;
      profile.value = null;
      markChosen();
    },

    setIngameName: renameProfile,
    saveProfileExtras,
    changeUsername,
    changePassword,
  };
}

// Changing the username, which is also changing the way in.
//
// The login address is minted from the username, so the two cannot disagree:
// a profile saying `nik2` while the account authenticates as `nik@...` is an
// account whose owner can no longer sign in under the name they are shown.
// Four steps, and the order is the whole of it.
async function changeUsername(handle) {
  if (!supabaseConfigured || !session.value) throw new Error('You’re not signed in.');
  const next = String(handle).trim();
  const previous = profile.value?.username;
  if (!previous) throw new Error('Your profile hasn’t loaded yet. Try again in a moment.');

  // 1. Ask before writing anything, so a taken name is a sentence under the
  //    box rather than a unique violation from inside the rename.
  if (!(await usernameAvailable(next))) throw new Error('Username taken');

  // 2. The profile row. Done first because it is the one that can be undone.
  const { data, error: writeErr } = await supabase
    .from('profiles')
    .update({ username: next })
    .eq('id', session.value.user.id)
    .select('id, username, ingame_name, avatar_url, bio, created_at')
    .single();
  // 23505 = unique violation: somebody took it between the check and here.
  if (writeErr) throw new Error(writeErr.code === '23505' ? 'Username taken' : authMessage(writeErr));

  // 3. The address the account signs in with.
  const { error: authErr } = await supabase.auth.updateUser({
    email: usernameToEmail(next),
    data: { username: next },
  });

  // 4. If the address would not move, the profile must not have moved either.
  //    Rolling back by hand because there is no transaction spanning the two:
  //    one is a table, the other is the auth service.
  if (authErr) {
    await supabase
      .from('profiles')
      .update({ username: previous })
      .eq('id', session.value.user.id);
    // `email_address_invalid` here is not about the username at all: it is
    // Supabase refusing the synthetic domain on the change endpoint, which it
    // accepts perfectly well at sign-up. Saying "try another name" would send
    // the player round a loop that cannot end, so it says what is true -
    // nothing changed, and this is not theirs to fix.
    if (/email_address_invalid|address .*is invalid/i.test(authErr.message || '')) {
      throw new Error(
        'Renaming isn’t available on this server — the login address it would need is refused. ' +
          'Your account hasn’t been changed.'
      );
    }
    throw new Error(authMessage(authErr));
  }

  // The token still carries the old address until it is reissued, and the
  // socket handshake is checked against the token.
  await supabase.auth.refreshSession();
  profile.value = data;
  return data;
}

// Changing the password, with the current one actually checked.
//
// `updateUser({ password })` does not ask for the current password: anyone
// holding a live session can set a new one. That is fine for a password
// reset and wrong for a change made from a settings page, where the whole
// point is proving it is still you - a borrowed laptop with a session open
// should not be able to lock the owner out.
async function changePassword({ current, next }) {
  if (!supabaseConfigured || !session.value) throw new Error('You’re not signed in.');
  const username = profile.value?.username;
  if (!username) throw new Error('Your profile hasn’t loaded yet. Try again in a moment.');

  // Verified by signing in again as this account. It returns a fresh session
  // for the same user, so nothing is disturbed by the check itself.
  const { error: wrongPassword } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password: current,
  });
  if (wrongPassword) {
    if (/invalid login credentials/i.test(wrongPassword.message || '')) {
      throw new Error('Current password is incorrect');
    }
    throw new Error(authMessage(wrongPassword));
  }

  const { error: err } = await supabase.auth.updateUser({ password: next });
  if (err) throw new Error(authMessage(err));

  // Every other session this account has open is now holding a password that
  // no longer opens anything. Ending them is the point of changing it.
  try {
    await supabase.auth.signOut({ scope: 'others' });
  } catch {
    // Best effort: the password is changed either way, and this session is
    // still good. Failing here would report a failure that did not happen.
  }
  return true;
}

// The player renaming themselves. This writes `ingame_name` and only that:
// the username is the handle the synthetic address was minted from, so
// changing it would leave them unable to log in - which is why migration 0003
// grants `authenticated` the one column and not the other.
//
// The table's own name change goes through the socket, because the server
// tells everyone sitting down; this keeps the profile row in step so the name
// survives into a new tab.
// The picture and the sentence, saved together.
//
// Deliberately apart from renameProfile: a name change is two writes that
// have to agree (the row, then the token's metadata the server reads), and
// these are one write to the row and nothing else. The server never reads a
// bio or an avatar - they are drawn by the browser, on a page - so there is
// no copy here to keep in step.
//
// `fields` may carry either or both. `avatar_url: null` is a removal and is
// passed through as one, which is why this checks for the key rather than
// for a truthy value.
async function saveProfileExtras(fields) {
  if (!supabaseConfigured || !session.value) return null;
  if (session.value.user?.is_anonymous === true) return null;
  const patch = {};
  if ('avatar_url' in fields) patch.avatar_url = fields.avatar_url || null;
  if ('bio' in fields) patch.bio = fields.bio || null;
  if (!Object.keys(patch).length) return profile.value;

  const { data, error: err } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', session.value.user.id)
    .select('id, username, ingame_name, avatar_url, bio, created_at')
    .single();
  if (err) throw err;
  profile.value = data;
  return data;
}

async function renameProfile(name) {
  if (!supabaseConfigured || !session.value) return null;
  // A guest has no row to write to. Their name at the table is the server's,
  // changed through the socket like everyone else's; there is simply nothing
  // here to keep in step with it.
  if (session.value.user?.is_anonymous === true) return null;
  const ingame = String(name || '').trim() || null;
  const { data, error: err } = await supabase
    .from('profiles')
    .update({ ingame_name: ingame })
    .eq('id', session.value.user.id)
    .select('id, username, ingame_name, avatar_url, bio, created_at')
    .single();
  if (err) throw err;
  profile.value = data;

  // And into the user's metadata, which is what the socket handshake is read
  // from. The server cannot see `profiles` - RLS lets a player read their own
  // row and nobody else's, and the server holds only the anon key - so the
  // token is where it learns the name. Written second on purpose: the profile
  // row is the record, and metadata is a copy of it that has to follow.
  //
  // Metadata is writable by the account it belongs to. That is right for a
  // display name, which may duplicate and may change, and would be wrong for
  // anything deciding permission, ownership or uniqueness. Nothing reads it
  // for those: they hang off the verified user id.
  const { error: metaErr } = await supabase.auth.updateUser({ data: { ingame_name: ingame } });
  if (metaErr) {
    // The name is saved; only the copy the server reads is behind. Say so
    // rather than failing a rename that did happen - the next sign-in or
    // rename puts it right, and the table already shows the new name.
    error.value = authMessage(metaErr);
  }
  return data;
}
