// Guest identity: an anonymous Supabase account, made on the first visit and
// reused on every one after it.
//
// There is no login screen. A player arrives, gets an account they never
// asked for and never have to think about, and keeps it as long as the
// browser keeps its localStorage. The profile row carries the display name;
// `chips` on it is a starting figure the server reads, never a balance the
// page is trusted to write.
import { ref, computed } from 'vue';
import { supabase, supabaseConfigured } from '../lib/supabase.js';

const session = ref(null);
const profile = ref(null);
const ready = ref(false);
const error = ref(null);
let started = null;

// "Guest4817". Four digits is plenty for a table of nine and short enough to
// read off a nameplate.
const randomGuestName = () => `Guest${Math.floor(1000 + Math.random() * 9000)}`;

// The row is this player's own: read it, and make it on the first visit.
// `username` is unique, so a collision on a four-digit name is retried
// rather than left to fail the sign-in.
async function loadProfile(userId) {
  const { data, error: readErr } = await supabase
    .from('profiles')
    .select('id, username, chips, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (data) return data;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: made, error: writeErr } = await supabase
      .from('profiles')
      .insert({ id: userId, username: randomGuestName() })
      .select('id, username, chips, created_at')
      .single();
    if (!writeErr) return made;
    // 23505 = unique violation: that name is taken, so try another.
    if (writeErr.code !== '23505') throw writeErr;
  }
  throw new Error('Could not pick a free guest name.');
}

async function start() {
  if (!supabaseConfigured) {
    // No Supabase in this checkout: the socket falls back to its own guest
    // naming and nothing here needs to run.
    ready.value = true;
    return;
  }
  try {
    const { data: existing } = await supabase.auth.getSession();
    // A return visit reuses the session rather than minting a second guest.
    let current = existing.session;
    if (!current) {
      const { data, error: signInErr } = await supabase.auth.signInAnonymously();
      if (signInErr) throw signInErr;
      current = data.session;
    }
    session.value = current;
    profile.value = await loadProfile(current.user.id);
  } catch (err) {
    // A guest account that cannot be made must not be a dead white page: the
    // app carries on against the server's own guest naming.
    error.value = err.message || String(err);
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
  // Kicked off once per page, however many components ask for it.
  if (!started) started = start();

  return {
    ready,
    error,
    session,
    profile,
    initPromise: started,
    accessToken: computed(() => session.value?.access_token || null),
    userId: computed(() => session.value?.user?.id || null),
    username: computed(() => profile.value?.username || null),

    // "New guest" in the avatar menu: throw this identity away and take a
    // fresh one. The only thing here that looks like signing out.
    async newGuest() {
      if (!supabaseConfigured) return;
      await supabase.auth.signOut();
      session.value = null;
      profile.value = null;
    },

    // The player renaming themselves. The table's own name change goes
    // through the socket, because the server tells everyone sitting down;
    // this keeps the profile row in step so the name survives a new tab.
    async setUsername(name) {
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
    },
  };
}
