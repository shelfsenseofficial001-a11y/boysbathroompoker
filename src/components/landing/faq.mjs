// The FAQ, as data. Every answer is a claim about this build, so each one is
// checked against the code rather than against what the game is meant to
// become. Anything unbuilt says so, in the future tense.
//
// Where an answer rests on a particular file, it is noted beside it - so the
// next person to change that file has a fighting chance of noticing that the
// front page now says something untrue.

export const DEV_NOTICE =
  'CCPoker is in development. Some features are still being built, things may change or break, and test data such as accounts may be reset.';

/** @type {{ id: string, q: string, a: string, notice?: boolean }[]} */
export const FAQ = [
  {
    id: 'free',
    q: 'Is CCPoker really free? Is any real money involved?',
    // No payment code exists anywhere in the repository.
    a: 'Yes, it’s free, and no. Chips are counters for keeping score: they have no cash value, and there are no deposits, purchases or cashouts of any kind.',
  },
  {
    id: 'carry-over',
    q: 'Do my chips carry over between tables?',
    // The host sets one starting stack per room (setStartingChips); there is
    // no account balance - see docs/supabase.md.
    a: 'No. The host sets one starting stack for the whole table, and every match begins on it. When the match ends, those chips end with it.',
  },
  {
    id: 'account',
    q: 'Do I need an account?',
    // signInAnonymously; guests have no profiles row (migration 0004).
    a: 'No. Play as a guest and you’re at a table in seconds. Nothing is recorded for guests, and guests won’t be ranked once ranked play arrives.',
  },
  {
    id: 'account-perks',
    q: 'What do I get with an account?',
    a: 'A username you log in with and an in-game name the table sees, kept between visits and devices. Stats and rankings are coming soon.',
  },
  {
    id: 'controls',
    q: 'How do I check, fold, bet and raise?',
    // table-renderer.js: double-tap check (2327), drag-to-fold (2255), chip
    // tray (4116), and the Fold/Check/Raise buttons with F/C/R (3560).
    // sockets.js: TURN_SECONDS, default 30, auto-check else auto-fold.
    a: 'Double-tap the felt to check, throw your cards across the table to fold, and drag chips onto the table to bet. There are Fold, Check and Raise buttons too, with F, C and R on a keyboard. You have 30 seconds a turn; run out and you check if you can, or fold if you can’t.',
  },
  {
    id: 'rules',
    q: 'Which poker game does it use?',
    // server/game/Table.js, first line.
    a: 'No-Limit Texas Hold’em: blinds, four betting rounds, all-ins with side pots, and a showdown.',
  },
  {
    id: 'phone',
    q: 'Can I play on my phone?',
    a: 'Yes. The table is built for touch first - every gesture is a tap or a drag - and the whole site works down to small phone screens.',
  },
  {
    id: 'rooms',
    q: 'How do public and private rooms work?',
    // listOpenRooms; isPrivate; room.knocks for the private door.
    a: 'Public rooms are listed for anyone to join. Private rooms stay off the list: share the five-character code or the invite link, and the host lets each person in.',
  },
  {
    id: 'bots',
    q: 'Can I play against bots?',
    // server/game/bot.js: LEVELS.
    a: 'Yes. The host can add bots at four levels - Beginner, Casual, Solid and Expert - from a bot that calls almost anything to one that works out whether the pot is worth the call.',
  },
  {
    id: 'social',
    q: 'Are there friends and leaderboards?',
    a: 'Both are coming soon. For now, invite people with a room code or link.',
  },
  {
    id: 'profile',
    q: 'Can I change my name or password?',
    // ProfilePage.vue. The username is read-only: Supabase refuses the
    // synthetic login domain on its email-change endpoint.
    a: 'Your in-game name and your password, yes - in Settings, under Profile. Your username is fixed once the account exists.',
  },
  {
    id: 'fair',
    q: 'Is the game fair? How are cards dealt?',
    // server/game/deck.js: Fisher-Yates over crypto.randomBytes with
    // rejection sampling. sockets.js: personalised state per player.
    a: 'Cards are shuffled on the server with a cryptographically secure shuffle, and your hole cards are only ever sent to you. Your browser never holds the deck.',
  },
  {
    id: 'offline',
    q: 'Does it work offline?',
    a: 'Not yet. Every table is run by the server, so you need a connection to play.',
  },
  {
    id: 'finished',
    q: 'Is CCPoker finished?',
    a: DEV_NOTICE,
    notice: true,
  },
];
