// Players' uploaded pictures, for the table.
//
// The game server has never known about these. It keeps its own players row
// and knows a seat's name and its account handle; the picture lives in
// Supabase, in the `public_profiles` view, and only the browser can read it.
// So the table asks for them here, by handle, and draws whatever has come
// back by the time it next redraws.
//
// Everything about this is best-effort. A face that has not arrived yet, a
// player with no picture, a failed request and a project with no Supabase
// configured all end the same way: the generated initials the table has
// always drawn. Nothing waits on a picture.
import { supabase, supabaseConfigured } from './supabase.js';

// lower(handle) -> url, or null for "asked, and they have none". A null is a
// real answer and stops the handle being asked about again.
const known = new Map();
const asking = new Set();
const listeners = new Set();

const key = (handle) => String(handle || '').trim().toLowerCase();

// What to draw for this handle right now. Synchronous by design: the table
// redraws constantly and must never await anything to paint a seat.
export function avatarFor(handle) {
  return known.get(key(handle)) || null;
}

// Told when a batch arrives, so whoever is drawing can draw again. Returns
// its own unsubscribe, because the table is torn down and rebuilt and a
// listener that outlived it would redraw a screen that has gone.
export function onAvatars(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// One lookup per handle, ever. Nine seats is nine small requests on the
// first draw and none after that - rather than one request built by pasting
// names into a filter string, which is a query somebody's username could
// change the meaning of.
export function lookupAvatars(handles) {
  if (!supabaseConfigured) return;
  const wanted = [...new Set((handles || []).map(key).filter(Boolean))].filter(
    (h) => !known.has(h) && !asking.has(h)
  );
  if (!wanted.length) return;

  for (const handle of wanted) asking.add(handle);
  Promise.all(
    wanted.map((handle) =>
      supabase
        .from('public_profiles')
        .select('username, avatar_url')
        // Case-insensitively, because the handle is minted from the account's
        // address and the profile keeps whatever case they typed.
        .ilike('username', handle)
        .maybeSingle()
        .then(({ data }) => [handle, data?.avatar_url || null])
        // A failure is recorded as "no picture" rather than retried: the
        // table would otherwise ask again on every redraw, several times a
        // second, for as long as it was broken.
        .catch(() => [handle, null])
    )
  ).then((pairs) => {
    let changed = false;
    for (const [handle, url] of pairs) {
      asking.delete(handle);
      known.set(handle, url);
      if (url) changed = true;
    }
    // Only a picture is worth a redraw. Learning that nine players have no
    // picture changes nothing on screen.
    if (changed) for (const fn of listeners) fn();
  });
}

// A player changing their own picture: drop what we knew so the next draw
// asks again. Theirs is the one that can change while the table is open.
export function forgetAvatar(handle) {
  known.delete(key(handle));
}
