// Works out the equity calculator's odds off the main thread. Pre-flop with
// nine hands is twenty thousand sampled boards, and doing that between two
// frames would stall whatever card is being dragged at the time.
import { computeEquity } from '../../../shared/equity.mjs';

self.onmessage = (e) => {
  const { id, hands, board, dead } = e.data;
  try {
    self.postMessage({ id, equity: computeEquity(hands, board, dead) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
