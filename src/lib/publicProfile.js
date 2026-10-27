// Reading somebody else's profile.
//
// A profile page is two halves from two places, joined by one id. This is
// the identity half - name, picture, sentence - read straight from Supabase
// through the `public_profiles` view, which exposes those columns and no
// others (migration 0006). The record half comes from the game server, which
// is the only thing that knows how anyone's matches went.
//
// Nothing here needs a session. The view is granted to `anon`, so a
// signed-out visitor with a link sees exactly what a signed-in one does.
import { supabase, supabaseConfigured } from './supabase.js';

// The stats endpoint is keyed by the Supabase auth id, which is also the
// profile's id - so one lookup by name gives both halves something to use.
export async function profileByUsername(username) {
  if (!supabaseConfigured) return null;
  const name = String(username || '').trim();
  if (!name) return null;
  const { data, error } = await supabase
    .from('public_profiles')
    .select('id, username, ingame_name, avatar_url, bio, created_at')
    // Case-insensitive, because `lower(username)` is what the database holds
    // unique (migration 0003): /u/Nik and /u/nik are the same player, and
    // one of them 404ing would be a link that works depending on how it was
    // typed into a message.
    .ilike('username', name)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// A player's record. Served by the game server, public and rate-limited.
// The id is the same one the profile above carries.
export async function statsFor(id) {
  const res = await fetch(`/api/players/${encodeURIComponent(id)}/stats`);
  if (res.status === 429) throw new Error('Too many requests just now. Try again in a minute.');
  if (!res.ok) throw new Error("That player's games couldn't be loaded.");
  return res.json();
}

export async function recentFor(id, { limit = 10, offset = 0 } = {}) {
  const res = await fetch(
    `/api/players/${encodeURIComponent(id)}/recent?limit=${limit}&offset=${offset}`
  );
  if (res.status === 429) throw new Error('Too many requests just now. Try again in a minute.');
  if (!res.ok) throw new Error("Those games couldn't be loaded.");
  return res.json();
}

// Where a player's page lives. One place, so the seat menu, the account menu
// and the copy button cannot disagree about the shape of a profile link.
export const profilePath = (username) => `/u/${encodeURIComponent(username)}`;
export const profileUrl = (username) => `${location.origin}${profilePath(username)}`;
