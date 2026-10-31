// Messages between friends, as far as the browser is concerned.
//
// Migration 0009 holds the rules: a message is written as yourself, into a
// conversation you're in, with somebody who is your friend right now - and
// read only by the two of you. Everything here is just asking.
import { supabase, supabaseConfigured } from './supabase.js';

// What 0009 and 0010 gave a message, and what 0011 added on top. A database
// that hasn't had 0011 run against it answers "column ... does not exist" to
// the whole select, which would take the thread down with it - so the first
// such refusal drops back to the base set and the chat keeps working without
// replies and edit marks until the migration is applied.
const BASE_COLUMNS = 'id, conversation_id, sender_id, content, kind, meta, created_at, read_at';
const FULL_COLUMNS = `${BASE_COLUMNS}, reply_to, edited_at, deleted_at`;
let extended = true;
const COLUMNS = () => (extended ? FULL_COLUMNS : BASE_COLUMNS);

// True when a refusal is the database being behind this build.
const missingColumn = (error) => error?.code === '42703' || error?.code === 'PGRST204';
export const PAGE_SIZE = 50;

// What a refusal means, said to the person who was refused.
function sentence(error) {
  if (error?.code === '42501') return 'You can only message friends.';
  if (error?.code === '23514') return 'That message is too long.';
  // A table, column or function this build asks for that the database hasn't
  // got: the migrations are behind the code. Said as a sentence rather than
  // handed to the player as "column messages.reply_to does not exist", which
  // is a note for whoever runs the server, not for whoever is typing.
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code)) {
    return 'Chat needs an update on the server before this works.';
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
  const page = async () => {
    let query = supabase
      .from('messages')
      .select(COLUMNS())
      .eq('conversation_id', conversationId)
      .order('id', { ascending: false })
      .limit(limit);
    if (before != null) query = query.lt('id', before);
    return query;
  };
  let { data, error } = await page();
  if (error && missingColumn(error) && extended) {
    extended = false;
    ({ data, error } = await page());
  }
  if (error) throw new Error(sentence(error));
  return (data || []).reverse();
}

export async function sendMessage(conversationId, content, replyTo = null) {
  need();
  const row = () => {
    const body = { conversation_id: conversationId, content };
    // Only sent at all where the column exists, so a plain message still
    // goes through on a database that hasn't had 0011 run against it.
    if (extended && replyTo) body.reply_to = replyTo;
    return supabase.from('messages').insert(body).select(COLUMNS()).single();
  };
  let { data, error } = await row();
  if (error && missingColumn(error) && extended) {
    extended = false;
    ({ data, error } = await row());
  }
  if (error) throw new Error(sentence(error));
  return data;
}

// Whether this server has the reply/edit/unsend columns. False only once a
// select has come back saying they aren't there.
export const chatExtrasReady = () => extended;

// Changing what you said. Your own words only, and the database says so -
// these go through functions because the browser holds no update grant.
export async function editMessage(id, content) {
  need();
  const { error } = await supabase.rpc('edit_message', { message: id, body: content });
  if (error) throw new Error(sentence(error));
}

// Taking it back. The row stays and the words go.
export async function unsendMessage(id) {
  need();
  const { error } = await supabase.rpc('unsend_message', { message: id });
  if (error) throw new Error(sentence(error));
}

// Clearing the thread - for you. The other player keeps their half.
export async function clearConversation(conversationId) {
  need();
  const { error } = await supabase.rpc('clear_conversation', { conversation: conversationId });
  if (error) throw new Error(sentence(error));
}

// An invite to a table, as a message with a card the other person taps. The
// line of text is what a notification and the chat list show; the meta is
// what Join follows. Migration 0010 checks the meta's shape.
export async function sendInvite(other, { code, token = '', line }) {
  need();
  const conversationId = await openConversation(other);
  const meta = token ? { code, token } : { code };
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, content: line, kind: 'invite', meta })
    .select(COLUMNS())
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
