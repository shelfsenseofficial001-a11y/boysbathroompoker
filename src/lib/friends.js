// Friends, as far as the browser is concerned.
//
// It may read its own rows in `friendships` and change none of them directly:
// every change is one of the functions in migration 0007, which hold the rules
// - who may accept, what a block outranks - where a console cannot argue with
// them. Each returns where the pair stands afterwards, so a caller can redraw
// from the answer.
import { supabase, supabaseConfigured } from './supabase.js';
import { friendshipState } from '../../shared/friendship.mjs';

// The migration not being applied yet is a state of the server, not an error
// the player did anything to cause. Those calls answer null and the page
// simply doesn't offer friends; anything else is a real failure.
const NOT_SET_UP = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);
const notSetUp = (error) => NOT_SET_UP.has(error?.code);

// Where I stand with `other`: none / sent / received / friends / blocked.
// Null when there is no answer to give - no Supabase, nobody signed in, or a
// server without the friends tables.
export async function friendshipWith(me, other) {
  if (!supabaseConfigured || !me || !other || me === other) return null;
  const { data, error } = await supabase
    .from('friendships')
    .select('user_id, friend_id, status')
    .or(`and(user_id.eq.${me},friend_id.eq.${other}),and(user_id.eq.${other},friend_id.eq.${me})`)
    .maybeSingle();
  if (error) {
    if (notSetUp(error)) return null;
    throw error;
  }
  return friendshipState(data, me);
}

async function change(fn, other) {
  if (!supabaseConfigured) throw new Error('Friends need an account server.');
  const { data, error } = await supabase.rpc(fn, fn === 'send_friend_request' ? { target: other } : { other });
  if (error) {
    if (notSetUp(error)) throw new Error("Friends aren't switched on for this server yet.");
    // The functions raise plain sentences meant for the page.
    throw new Error(error.message || "That didn't go through. Try again.");
  }
  return data;
}

// Everyone I have a friendship row with, blocks aside: friends with how long
// ago they were seen, and requests either way (migration 0008). Null on a
// server without the list, so the sidebar can say nothing rather than fail.
export async function listFriends() {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('my_friends');
  if (error) {
    if (notSetUp(error)) return null;
    throw error;
  }
  return data || [];
}

// "I'm here." Stamped with the database's clock. A failure is not worth a
// word: the next beat tries again, and the worst case is looking offline.
export async function touchLastSeen() {
  if (!supabaseConfigured) return;
  await supabase.rpc('touch_last_seen');
}

// Calls `onChange` whenever a friendship row I can see moves - a request
// arriving, an accept, a removal - so the list redraws without a reload.
// Realtime applies the select policy from 0007 to inserts and updates. A
// delete carries only the row's id and cannot be filtered, so any delete
// wakes the list; re-reading it is cheap, and the read is what RLS checks.
export function watchFriendships(me, onChange) {
  if (!supabaseConfigured || !me) return () => {};
  const channel = supabase
    .channel(`friendships:${me}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_id=eq.${me}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `friend_id=eq.${me}` }, onChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friendships' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export const sendFriendRequest =(other) => change('send_friend_request', other);
export const acceptFriendRequest = (other) => change('accept_friend_request', other);
// Cancelling a request, declining one and unfriending are the same call.
export const removeFriend = (other) => change('remove_friend', other);
export const blockUser = (other) => change('block_user', other);
