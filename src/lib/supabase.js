// The Supabase client, one per page.
//
// Identity only - a name, and the account it belongs to. Every chip in this
// game is moved by the Node server, which owns the deck, the pot and the
// stacks; and those stacks belong to a room rather than to a player, so there
// is nothing here for an account to be worth. See docs/supabase.md.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Unset in a plain checkout, and deliberately survivable: the game is meant
// to run on a laptop with no internet, where it falls back to the server's
// own per-tab guest naming (SKIP_AUTH). Anything reading this must cope with
// a null client rather than assume Supabase is there.
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // The guest session is the account: it has to outlive the tab, and
        // Supabase keeps it in localStorage for us.
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'bbp-auth',
        // No OAuth redirects to read back - there is no login page.
        detectSessionInUrl: false,
      },
    })
  : null;
