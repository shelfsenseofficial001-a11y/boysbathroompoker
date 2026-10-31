// Turning a list of messages into what a chat window draws.
//
// Messenger's shape: a centred time between bursts of conversation, runs of
// bubbles from the same person stacked tightly, the other person's face only
// beside the last bubble of their run, and "Seen" under your latest message
// once they've read it. Worked out here, away from the component, so the
// rules can be tested without a browser.

// A pause longer than this starts a new burst, with its own time above it.
export const GAP_SECS = 10 * 60;
// The composer's limit, and migration 0009's CHECK constraint.
export const MESSAGE_MAX = 1000;

const ms = (at) => Date.parse(at);

// `messages` oldest first. Returns rows of two kinds:
//   { type: 'time', key, at }
//   { type: 'msg', key, msg, mine, first, last, seen }
// `first` / `last` are the ends of a run from one sender, for the bubble
// corners and the avatar. `seen` is set on one row at most.
export function threadItems(messages, me) {
  const items = [];
  const list = messages || [];
  let lastMine = -1;
  list.forEach((m, i) => {
    if (m.sender_id === me) lastMine = i;
  });

  list.forEach((m, i) => {
    const prev = list[i - 1];
    const next = list[i + 1];
    const gapBefore = !prev || (ms(m.created_at) - ms(prev.created_at)) / 1000 > GAP_SECS;
    const gapAfter = !next || (ms(next.created_at) - ms(m.created_at)) / 1000 > GAP_SECS;
    if (gapBefore) items.push({ type: 'time', key: `t${m.id}`, at: m.created_at });
    const mine = m.sender_id === me;
    items.push({
      type: 'msg',
      key: m.id,
      msg: m,
      mine,
      first: gapBefore || prev.sender_id !== m.sender_id,
      last: gapAfter || next.sender_id !== m.sender_id,
      seen: i === lastMine && !!m.read_at,
    });
  });
  return items;
}

// The centred time between bursts. "2:38 PM" today, "Tue 2:38 PM" this week,
// "Oct 12, 2:38 PM" this year, with the year after that.
// `now` and `locale` are for the tests; the page passes neither.
export function chatTimeLabel(at, { now = Date.now(), locale } = {}) {
  const then = new Date(at);
  const today = new Date(now);
  const time = then.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (then.getTime() >= startOfToday) return time;
  const days = (startOfToday - then.getTime()) / 86_400_000;
  if (days < 6) return `${then.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  const sameYear = then.getFullYear() === today.getFullYear();
  const date = then.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}

// What the composer sends: trimmed, and nothing at all if that leaves
// nothing. Line breaks inside are kept - they're how people write.
export function cleanMessage(text) {
  const out = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  return out.length > MESSAGE_MAX ? null : out || null;
}
