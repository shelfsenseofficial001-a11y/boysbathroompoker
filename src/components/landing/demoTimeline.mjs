// The demo table's script: one hand and a short second one, as data.
//
// Every step is a patch over the step before it, applied in order and held
// for `ms`. The runner in DemoTable.vue knows nothing about poker - it walks
// this list, merges each patch, and starts again at the top when it runs
// out. So the hand is written here as a sequence of moments, and changing
// what the visitor sees is a matter of changing this list.
//
// Neutral by design: "You" and three bots, round amounts, and nothing that
// could be read as a real player or a real result. The hand itself is legal
// poker - the community cards, the order of action and the winning hand all
// agree - because somebody who plays will notice if it is not.

/**
 * @typedef {object} DemoSeat
 * @property {string} id
 * @property {string} name
 * @property {number} chips
 * @property {[string, string] | null} cards   Face codes, or null for none dealt.
 * @property {boolean} [faceUp]                Shown to the viewer.
 * @property {boolean} [folded]
 * @property {number}  [bet]                   Chips in front of the seat this street.
 * @property {boolean} [winner]
 */

/**
 * @typedef {object} DemoState
 * @property {DemoSeat[]} seats
 * @property {string[]} board          Up to five face codes.
 * @property {number} pot
 * @property {string} [caption]         What just happened, in words.
 * @property {string} [turn]            Seat id whose turn it is.
 * @property {{ kind: 'tap'|'drag'|'fold', from: [number, number], to?: [number, number] } | null} [gesture]
 * @property {string} [phase]           "Preflop", "Flop", ...
 */

/** @typedef {{ id: string, ms: number, patch: (s: DemoState) => Partial<DemoState> }} DemoStep */

const START = 1000;

/** @returns {DemoState} */
export function initialState() {
  return {
    seats: [
      { id: 'you', name: 'You', chips: START, cards: null, faceUp: true },
      { id: 'b1', name: 'Bot', chips: START, cards: null },
      { id: 'b2', name: 'Bot', chips: START, cards: null },
      { id: 'b3', name: 'Bot', chips: START, cards: null },
    ],
    board: [],
    pot: 0,
    caption: '',
    turn: '',
    gesture: null,
    phase: '',
  };
}

// The hand. You hold the ace and king of spades, the board runs out to a
// spade flush, and you win it at showdown.
//
// Checked as poker, not just as animation. Seats run you, b1, b2, b3 with b1
// on the button, b2 the small blind and b3 the big. Preflop the first to act
// is left of the big blind, which wraps round to you. At showdown your
// ace-high flush (As Ks 9s 4s 2s) beats b1's three queens. b3's Jh Td made a
// straight on the river (Q-J-T-9-8) - but b3 folded on the flop facing a bet
// with only a draw, so it never reaches showdown.
const YOU = ['As', 'Ks'];
const BOTS = { b1: ['Qh', 'Qd'], b2: ['7c', '2d'], b3: ['Jh', 'Td'] };
const BOARD = ['9s', '4s', 'Qc', '2s', '8h'];
const HAND_TWO = { you: ['7d', '2c'], b1: ['Ah', 'Kd'], b2: ['9c', '9d'], b3: ['Js', 'Tc'] };

// Helpers that read as poker rather than as array surgery.
const seat = (s, id, change) => s.seats.map((p) => (p.id === id ? { ...p, ...change } : p));
const bet = (s, id, amount) =>
  s.seats.map((p) => (p.id === id ? { ...p, chips: p.chips - amount, bet: (p.bet || 0) + amount } : p));
// End of a street: what is in front of everybody slides into the middle.
const collect = (s) => ({
  pot: s.pot + s.seats.reduce((n, p) => n + (p.bet || 0), 0),
  seats: s.seats.map((p) => ({ ...p, bet: 0 })),
});

/** @type {DemoStep[]} */
export const STEPS = [
  {
    id: 'deal',
    ms: 1700,
    patch: (s) => ({
      phase: 'Preflop',
      caption: 'Cards are dealt',
      seats: s.seats.map((p) => ({
        ...p,
        cards: p.id === 'you' ? YOU : BOTS[p.id],
        folded: false,
        winner: false,
        bet: 0,
        chips: START,
      })),
      board: [],
      pot: 0,
    }),
  },
  {
    id: 'blinds',
    ms: 1100,
    patch: (s) => {
      let seats = bet({ ...s }, 'b2', 5);
      seats = bet({ ...s, seats }, 'b3', 10);
      return { seats, caption: 'Blinds go in', turn: 'you' };
    },
  },
  {
    // The gesture this whole step exists to show.
    id: 'you-call',
    ms: 2400,
    patch: (s) => ({
      seats: bet(s, 'you', 10),
      caption: 'You call',
      gesture: { kind: 'drag', from: [50, 88], to: [50, 54] },
      turn: 'b1',
    }),
  },
  {
    id: 'b1-call',
    ms: 1200,
    patch: (s) => ({ seats: bet(s, 'b1', 10), caption: 'Bot calls', gesture: null, turn: 'b2' }),
  },
  {
    // A fold, from somebody else, so the muck has been seen before you use it.
    id: 'b2-fold',
    ms: 1300,
    patch: (s) => ({ seats: seat(s, 'b2', { folded: true }), caption: 'Bot folds', turn: 'b3' }),
  },
  {
    id: 'b3-check',
    ms: 1100,
    patch: () => ({ caption: 'Bot checks', turn: '' }),
  },
  {
    id: 'flop',
    ms: 1900,
    patch: (s) => ({ ...collect(s), board: BOARD.slice(0, 3), phase: 'Flop', caption: 'The flop', turn: 'b3' }),
  },
  {
    // After the flop the first live seat left of the button acts first. The
    // small blind has folded, so that is the big blind - before you, not
    // after, which is the mistake a demo hand most often makes.
    id: 'b3-check-flop',
    ms: 1100,
    patch: () => ({ caption: 'Bot checks', turn: 'you' }),
  },
  {
    // Double-tap the felt to check.
    id: 'you-check',
    ms: 2400,
    patch: () => ({ caption: 'Double-tap to check', gesture: { kind: 'tap', from: [50, 66] }, turn: 'b1' }),
  },
  {
    // Nobody has bet this street, so this is a bet and not a raise.
    id: 'b1-bet',
    ms: 1500,
    patch: (s) => ({ seats: bet(s, 'b1', 40), caption: 'Bot bets 40', gesture: null, turn: 'b3' }),
  },
  {
    id: 'b3-fold',
    ms: 1200,
    patch: (s) => ({ seats: seat(s, 'b3', { folded: true }), caption: 'Bot folds', turn: 'you' }),
  },
  {
    // Chips dragged from your stack into the pot.
    id: 'you-call-bet',
    ms: 2400,
    patch: (s) => ({
      seats: bet(s, 'you', 40),
      caption: 'Drag chips in to call',
      gesture: { kind: 'drag', from: [50, 88], to: [50, 54] },
      turn: '',
    }),
  },
  {
    id: 'turn',
    ms: 1700,
    patch: (s) => ({ ...collect(s), board: BOARD.slice(0, 4), phase: 'Turn', caption: 'The turn', gesture: null }),
  },
  {
    id: 'river',
    ms: 1700,
    patch: () => ({ board: BOARD.slice(0, 5), phase: 'River', caption: 'The river' }),
  },
  {
    // Turned over. The flush beats the queens.
    id: 'showdown',
    ms: 2000,
    patch: (s) => ({
      phase: 'Showdown',
      caption: 'Flush wins',
      seats: s.seats.map((p) => ({ ...p, faceUp: !p.folded, winner: p.id === 'you' })),
    }),
  },
  {
    id: 'payout',
    ms: 1700,
    patch: (s) => ({
      caption: 'You take the pot',
      seats: s.seats.map((p) => (p.id === 'you' ? { ...p, chips: p.chips + s.pot } : p)),
      pot: 0,
    }),
  },
  // --- A short second hand, so folding your own cards is seen too. --------
  {
    id: 'deal-2',
    ms: 1600,
    patch: (s) => ({
      phase: 'Preflop',
      caption: 'Next hand',
      board: [],
      pot: 0,
      seats: s.seats.map((p) => ({
        ...p,
        // Distinct cards for every seat, face down or not: a deck has one
        // ace of hearts in it, and so does this one.
        cards: HAND_TWO[p.id],
        faceUp: p.id === 'you',
        folded: false,
        winner: false,
        bet: 0,
      })),
      turn: 'you',
    }),
  },
  {
    // Seven-deuce: the worst hand in the deck, thrown away the way it should be.
    id: 'you-fold',
    ms: 2600,
    patch: (s) => ({
      seats: seat(s, 'you', { folded: true }),
      caption: 'Throw your cards in to fold',
      gesture: { kind: 'fold', from: [50, 82], to: [50, 46] },
      turn: '',
    }),
  },
  {
    id: 'rest',
    ms: 1100,
    patch: () => ({ caption: '', gesture: null, phase: '' }),
  },
];

export const LOOP_MS = STEPS.reduce((n, step) => n + step.ms, 0);

// The frame shown under reduced motion: mid-hand, the flop out, chips in the
// middle, your cards face up. Enough to read as poker without moving.
export function staticFrame() {
  let state = initialState();
  for (const step of STEPS) {
    state = { ...state, ...step.patch(state) };
    if (step.id === 'you-check') break;
  }
  return { ...state, gesture: null, caption: 'Demo table' };
}
