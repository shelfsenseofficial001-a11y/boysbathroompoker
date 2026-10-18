// A single standard 52-card deck with a cryptographically secure Fisher-Yates shuffle.
// One Deck instance backs exactly one hand; it is discarded after the hand ends.
const crypto = require('crypto');

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c']; // spades, hearts, diamonds, clubs

function freshCards() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push(rank + suit); // e.g. "As", "Th", "2c"
    }
  }
  return cards;
}

// Returns a random integer in [0, max) using rejection sampling over
// crypto.randomBytes so the distribution is unbiased (no modulo bias).
function secureRandomInt(max) {
  if (max <= 0) return 0;
  const range = max;
  const bitsNeeded = Math.ceil(Math.log2(range));
  const bytesNeeded = Math.ceil(bitsNeeded / 8) || 1;
  const maxValue = 2 ** (bytesNeeded * 8);
  const limit = maxValue - (maxValue % range);

  let value;
  do {
    const buf = crypto.randomBytes(bytesNeeded);
    value = 0;
    for (let i = 0; i < buf.length; i++) value = value * 256 + buf[i];
  } while (value >= limit);

  return value % range;
}

class Deck {
  constructor() {
    this.cards = freshCards();
    this.shuffle();
    this.dealt = new Set();
  }

  // Fisher-Yates shuffle using a secure RNG.
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  // Draws the next card from the top of the deck. Throws if the deck is
  // exhausted rather than silently reusing/duplicating a card.
  draw() {
    if (this.cards.length === 0) {
      throw new Error('Deck exhausted: no cards left to deal.');
    }
    const card = this.cards.pop();
    if (this.dealt.has(card)) {
      // Should never happen with a fresh 52-card deck; guards against bugs.
      throw new Error(`Duplicate card dealt: ${card}`);
    }
    this.dealt.add(card);
    return card;
  }

  drawMany(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.draw());
    return out;
  }

  remaining() {
    return this.cards.length;
  }
}

module.exports = { Deck, RANKS, SUITS, freshCards, secureRandomInt };
