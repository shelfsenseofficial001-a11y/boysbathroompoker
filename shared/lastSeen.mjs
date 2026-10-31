// How long ago a friend was about, in as few characters as a list row has.
//
// The input is seconds since they were last seen, worked out by the database
// against its own clock (migration 0008) - never a timestamp for this machine
// to subtract from a clock that may be wrong.
//
// The page touches `last_seen_at` once a minute while it is open, so anyone
// seen inside two minutes is still here: one missed beat is a slow network,
// not somebody leaving.
export const ONLINE_WITHIN = 120;

export function isOnline(secsAgo) {
  return Number.isFinite(secsAgo) && secsAgo < ONLINE_WITHIN;
}

// just now → 5m ago → 3h ago → 2d ago → Oct 12 (→ Oct 12, 2025 in another year).
// `now` and `locale` are there for the tests; the page passes neither.
export function lastSeenLabel(secsAgo, { now = Date.now(), locale } = {}) {
  if (!Number.isFinite(secsAgo)) return 'Offline';
  const s = Math.max(0, Math.floor(secsAgo));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const then = new Date(now - s * 1000);
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
