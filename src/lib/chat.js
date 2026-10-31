// Messages between friends, as far as the browser is concerned.
//
// Migration 0009 holds the rules: a message is written as yourself, into a
// conversation you're in, with somebody who is your friend right now - and
// read only by the two of you. Everything here is just asking.
import { supabase, supabaseConfigured } from './supabase.js';

const COLUMNS = 'id, conversation_id, sender_id, content, kind, meta, created_at, read_at';
export const PAGE_SIZE = 50;

// What a refusal means, said to the person who was refused.
function sentence(error) {
  if (error?.code === '42501') return 'You can only message friends.';
  if (error?.code === '23514') return 'That message is too long.';
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)) {
    return "Chat isn't switched on for this server yet.";
  }
  return error?.message || "That didn't go through. Try again.";
}

function need() {
  if (!supabaseConfigured) throw new Error('Chat needs an account server.');
}

// The conversation with `other`, made on first use. Opening a new one needs a
// friendship; an old one opens to read either way.
export async function openConversation(other) {
  need();
  const { data, error } = await supabase.rpc('open_conversation', { other });
  if (error) throw new Error(sentence(error));
  return data;
}

// A page of messages, oldest first. `before` is a message id, for the page
// above the one already drawn.
export async function loadMessages(conversationId, { before = null, limit = PAGE_SIZE } = {}) {
  need();
  let query = supabase
    .from('messages')
    .select(COLUMNS)
    .eq('conversation_id', conversationId)
    .order('id', { ascending: false })
    .limit(limit);
  if (before != null) query = query.lt('id', before);
  const { data, error } = await query;
  if (error) throw new Error(sentence(error));
  return (data || []).reverse();
}

export async function sendMessage(conversationId, content) {
  need();
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, content })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(sentence(error));
  return data;
}

export async function markRead(conversationId) {
  if (!supabaseConfigured) return;
  await supabase.rpc('mark_read', { conversation: conversationId });
}

// { friendId: count } of messages I haven't read. Null on a server without
// chat, so the list simply draws no badges.
export async function myUnread() {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('my_unread');
  if (error) return null;
  return Object.fromEntries((data || []).map((r) => [r.friend_id, r.unread]));
}

// Live changes to one conversation: new messages, and reads of mine.
export function watchConversation(conversationId, { onInsert, onUpdate }) {
  if (!supabaseConfigured || !conversationId) return () => {};
  const filter = `conversation_id=eq.${conversationId}`;
  const channel = supabase
    .channel(`chat:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, (e) => onInsert?.(e.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, (e) => onUpdate?.(e.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// Any message arriving in any of my conversations. Realtime checks the select
// policy for each one, so this hears my conversations and nobody else's.
export function watchIncoming(me, onInsert) {
  if (!supabaseConfigured || !me) return () => {};
  const channel = supabase
    .channel(`inbox:${me}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (e) => onInsert?.(e.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}
