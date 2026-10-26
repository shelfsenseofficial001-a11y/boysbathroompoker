// What the landing page says, in one place.
//
// The page is a renderer for this array and nothing else: headings, order,
// tags and visuals all read from here, so a feature that ships is one word
// changed - `status: 'soon'` becomes `status: 'live'` - rather than a hunt
// through markup for every place it was mentioned.
//
// `status` is a promise to the reader, so it is set from the code rather than
// from intent. 'live' means it was found working in this repository; anything
// unbuilt, half-built or unverified is 'soon' and wears a "Coming soon" tag.
// The line numbers in the comments are where each one was confirmed.

/**
 * @typedef {object} Feature
 * @property {string} id        Matches a case in FeatureVisual.vue.
 * @property {string} group     The section it belongs to.
 * @property {string} title
 * @property {string} description Never claims a 'soon' feature works today.
 * @property {'live'|'soon'} status
 */

// The four sections, in the order they are read.
export const GROUPS = [
  {
    id: 'free',
    title: 'Free to play, always',
    lede: 'There is no money in this game. There is nowhere to put any.',
  },
  {
    id: 'hands-on',
    title: 'A table that feels hands-on',
    lede: 'The felt answers to your hands, not to a row of buttons.',
  },
  {
    id: 'your-way',
    title: 'Play your way',
    lede: 'A table of strangers, a table of friends, or a table of robots.',
  },
  {
    id: 'compete',
    title: 'Compete',
    lede: 'For when bragging rights want a number attached.',
  },
];

/** @type {Feature[]} */
export const FEATURES = [
  // --- Free to play, always ------------------------------------------------
  {
    id: 'no-money',
    group: 'free',
    title: 'No real money. Only chips.',
    description:
      'Chips are counters for keeping score. They cannot be bought, sold or cashed out, and there is no payment code anywhere in this game to do it with.',
    status: 'live',
  },
  {
    id: 'fresh-chips',
    group: 'free',
    title: 'Fresh chips at every table',
    description:
      'The room owner sets one starting stack for the table, and every match begins on it. Nothing carries over, so nobody sits down already behind.',
    status: 'live',
  },
  {
    id: 'guest-play',
    group: 'free',
    title: 'Play as a guest',
    description:
      'One tap and you are at a table. No email, no password, nothing to confirm. Make an account later if you want your name to follow you between visits.',
    status: 'live',
  },

  // --- A table that feels hands-on ----------------------------------------
  {
    id: 'double-tap-check',
    group: 'hands-on',
    title: 'Double-tap to check',
    description:
      'Two taps on the felt and the action is yours again. The quickest move in poker is the quickest move here.',
    status: 'live',
  },
  {
    id: 'drag-fold',
    group: 'hands-on',
    title: 'Throw your cards in to fold',
    description:
      'Drag your hand across the table and let go. Folding is a gesture you already know, rather than a button you have to find.',
    status: 'live',
  },
  {
    id: 'drag-chips',
    group: 'hands-on',
    title: 'Drag chips in to bet',
    description:
      'Pull a chip off your stack and push it into the pot. Bets and raises are built the way they are at a real table — one chip at a time.',
    status: 'live',
  },

  // --- Play your way -------------------------------------------------------
  {
    id: 'rooms',
    group: 'your-way',
    title: 'Public and private rooms',
    description:
      'Jump into any open table, or host a private one that stays off the list and opens only to the people you give the code to.',
    status: 'live',
  },
  {
    id: 'friends',
    group: 'your-way',
    title: 'Friends you can invite',
    description:
      'A friends list, so the people you play with most are a tap away instead of a code you have to send again. Room-code invites work today.',
    status: 'soon',
  },
  {
    id: 'bots',
    group: 'your-way',
    title: 'Bots from Beginner to Expert',
    description:
      'Four of them: Beginner calls nearly anything, Casual plays it safe, Solid reads the board, and Expert works out whether the pot is worth the call.',
    status: 'live',
  },

  // --- Compete -------------------------------------------------------------
  {
    id: 'leaderboards',
    group: 'compete',
    title: 'Ranked leaderboards',
    description:
      'Standings for people playing on an account, so a good run is worth something past the end of the hand. Guests will not be ranked, and nothing is recorded for them today.',
    status: 'soon',
  },
];

// Only what works now may appear here. A step that described something
// unbuilt would be a promise the first click breaks.
export const STEPS = [
  {
    n: 1,
    title: 'Sit down',
    description: 'Play as a guest, or make an account. Either way you are at a table in seconds.',
  },
  {
    n: 2,
    title: 'Host or join',
    description: 'Open a public table, or host a private one and send the five-character code.',
  },
  {
    n: 3,
    title: 'Play the hand',
    description: 'Double-tap to check, throw your cards in to fold, drag chips in to bet.',
  },
];

export const byGroup = (groupId) => FEATURES.filter((f) => f.group === groupId);
export const hasUnbuilt = FEATURES.some((f) => f.status === 'soon');
