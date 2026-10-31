// Where two players stand, read from the one row that can join them.
//
// The row is `friendships` (migration 0007): `user_id` is whoever acted -
// asked, or blocked - and `friend_id` is the other. The same row reads
// differently from each end, and this is the one place that says how, so the
// button and anything else that draws a friendship cannot disagree.
//
//   none      no row, or a block the other player made (RLS hides those)
//   sent      I asked, they haven't answered
//   received  they asked me
//   friends   accepted
//   blocked   I blocked them
export function friendshipState(row, me) {
  if (!row || !me) return 'none';
  if (row.status === 'accepted') return 'friends';
  const mine = row.user_id === me;
  if (row.status === 'blocked') return mine ? 'blocked' : 'none';
  if (row.status === 'pending') return mine ? 'sent' : 'received';
  return 'none';
}
