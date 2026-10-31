// Which tables are still standing.
//
// An invite card outlives the table it points at: rooms end when the last
// player leaves, and the message saying "join my table" stays in the chat
// forever. This is what lets a card show a shut door rather than a button
// that only fails once pressed.
//
// Answers are cached briefly, because a chat redrawing its thread asks about
// the same handful of codes over and over, and a room does not come back.
import { emitAck } from './socket.js';

const CACHE_MS = 20_000;
const cache = new Map(); // code -> { alive, at }

function fresh(code) {
  const hit = cache.get(code);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit;
}

// Returns a Set of the codes that still exist. On any failure - no socket, a
// server that doesn't know the question - it returns every code asked about:
// not knowing is not the same as knowing a table has gone, and a card wrongly
// struck through is worse than one that fails when pressed.
export async function aliveRooms(codes) {
  const asked = [...new Set((codes || []).filter(Boolean))];
  if (!asked.length) return new Set();

  const known = new Set();
  const toAsk = [];
  for (const code of asked) {
    const hit = fresh(code);
    if (!hit) toAsk.push(code);
    else if (hit.alive) known.add(code);
  }
  if (!toAsk.length) return known;

  try {
    const res = await emitAck('roomsAlive', { codes: toAsk });
    const alive = new Set(res?.alive || []);
    const at = Date.now();
    for (const code of toAsk) {
      const isAlive = alive.has(code);
      cache.set(code, { alive: isAlive, at });
      if (isAlive) known.add(code);
    }
    return known;
  } catch {
    for (const code of toAsk) known.add(code);
    return known;
  }
}

// A room we have just been told is gone - a join that came back 'no-room'.
export function markRoomGone(code) {
  if (code) cache.set(code, { alive: false, at: Date.now() });
}
