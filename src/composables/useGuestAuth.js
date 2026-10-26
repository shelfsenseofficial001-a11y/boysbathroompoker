// Who the player is: a guest, or an account.
//
// A guest is an anonymous Supabase user. An account is the same thing with an
// email and password attached - which matters, because attaching them keeps
// the user id, and the user id is what the game server's own players row
// hangs off. A guest who signs up walks into their account carrying the chips
// they already had.
//
// Nothing here is the authority on those chips. The profile row's `chips` is
// a starting figure the server reads; the server owns the rest. See
// docs/supabase.md.
import { ref, computed } from 'vue';
import { supabase, supabaseConfigured } from '../lib/supabase.js';

// Set once the player has said how they want to play. Its only job is to stop
// the first-visit prompt coming back at someone who already answered it.
const CHOSE_KEY = 'bbp-auth-chosen';

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

function forgetChoice() {
  chose.value = false;
  try {
    localStorage.removeItem(CHOSE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// "Guest4817". Four digits is plenty for a table of nine and short enough to
// read off a nameplate.
const randomGuestName = () => `Guest${Math.floor(1000 + Math.random() * 9000)}`;

// Supabase says what went wrong in its own words, some of which are for
// developers rather than players. These are the ones a form can actually
// produce; anything unlisted is passed through rather than swallowed, since a
// vague "something went wrong" is worse than an odd sentence.
const AUTH_MESSAGES = [
  [/invalid login credentials/i, 'That email and password don’t match an account.'],
  [/email not confirmed/i, 'Check your email and confirm your account first.'],
  [/user already registered|already been registered/i, 'There’s already an account with that email.'],
  [/password should be at least/i, 'Use a password of at least 8 characters.'],
  [/unable to validate email|invalid format/i, 'That doesn’t look like an email address.'],
  [/anonymous sign-ins are disabled/i, 'Guest play is switched off on this server.'],
  [/email rate limit|over_email_send_rate_limit/i, 'Too many emails just now — wait a minute and try again.'],
  [/rate limit|too many requests/i, 'Too many attempts — wait a moment and try again.'],
  [/identity.*already (exists|linked)/i, 'That email is already attached to another account.'],
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

// The row is this player's own: read it, and make it the first time they
// arrive. A name chosen at sign-up rides in on the user's metadata; a guest
// gets a random one. `username` is unique, so a clash is worked around rather
// than left to fail the sign-in - the player can rename themselves from the
// avatar menu, and nothing is worth blocking the door for.
async function loadProfile(user) {
  const { data, error: readErr } = await supabase
    .from('profiles')
    .select('id, username, chips, created_at')
    .eq('id', user.id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (data) return data;

  const wanted = String(user.user_metadata?.username || '').trim();
  for (let attempt = 0; attempt < 5; attempt++) {
    // The chosen name on the first go; a varied one after it loses a race.
    const username =
      wanted && attempt === 0
        ? wanted
        : wanted
          ? `${wanted.slice(0, 16)}${Math.floor(10 + Math.random() * 89)}`
          : randomGuestName();
    const { data: made, error: writeErr } = await supabase
      .from('profiles')
      .insert({ id: user.id, username })
      .select('id, username, chips, created_at')
      .single();
    if (!writeErr) return made;
    // 23505 = unique violation: that name is taken, so try another.
    if (writeErr.code !== '23505') throw writeErr;
  }
  throw new Error('Could not pick a free name.');
}

// Everything that ends with a session in hand finishes here.
async function adopt(next) {
  session.value = next;
  profile.value = next ? await loadProfile(next.user) : null;
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
  // The access token is what the socket handshake is checked against, so a
  // refresh has to land here rather than only inside the client.
  supabase.auth.onAuthStateChange((_event, next) => {
    session.value = next;
  });
}

export function useGuestAuth() {
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
    username: computed(() => profile.value?.username || null),
    email: computed(() => user.value?.email || null),
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

    async signIn({ email, password }) {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw new Error(authMessage(err));
      return adopt(data.session);
    },

    // Signing up as a guest does not start again from nothing: the email and
    // password are attached to the anonymous user already in hand, which
    // keeps the user id and so keeps the players row - and the chips - that
    // the game server has been keeping against it.
    //
    // Resolves to { needsConfirmation }. With email confirmation switched on
    // Supabase hands back no session, and the player is in neither state: not
    // signed in as the new account, and - on the upgrade path - still holding
    // the guest session they had. Both are fine to carry on from.
    async signUp({ email, password, username }) {
      if (isGuest.value) {
        const { data, error: err } = await supabase.auth.updateUser({
          email,
          password,
          data: { username },
        });
        if (err) throw new Error(authMessage(err));
        // An upgrade keeps the session it already had, so there is nothing to
        // adopt - but the profile should answer to the chosen name now.
        const confirmed = !!data.user?.email_confirmed_at;
        if (confirmed) await renameProfile(username);
        return { needsConfirmation: !confirmed };
      }

      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (err) throw new Error(authMessage(err));
      // No session means the account exists but is waiting on a confirmation
      // email. The profile row is made whenever the session first turns up.
      if (!data.session) return { needsConfirmation: true };
      await adopt(data.session);
      return { needsConfirmation: false };
    },

    // --- The ways out ---------------------------------------------------
    // Signing out is an explicit "ask me again": the choice is forgotten, so
    // the prompt is there to meet them rather than an anonymous account they
    // never asked for.
    async signOut() {
      await supabase.auth.signOut();
      session.value = null;
      profile.value = null;
      forgetChoice();
    },

    // A guest dropping this identity for a fresh one. The choice stands -
    // they have said they want to play as a guest - so no prompt.
    async newGuest() {
      await supabase.auth.signOut();
      session.value = null;
      profile.value = null;
      markChosen();
    },

    setUsername: renameProfile,
  };
}

// The player renaming themselves. The table's own name change goes through
// the socket, because the server tells everyone sitting down; this keeps the
// profile row in step so the name survives into a new tab.
async function renameProfile(name) {
  if (!supabaseConfigured || !session.value) return null;
  const { data, error: err } = await supabase
    .from('profiles')
    .update({ username: name })
    .eq('id', session.value.user.id)
    .select('id, username, chips, created_at')
    .single();
  if (err) throw err;
  profile.value = data;
  return data;
}
