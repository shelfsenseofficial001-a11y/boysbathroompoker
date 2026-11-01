// No-Limit Texas Hold'em table: blinds, betting rounds, side pots, showdown.
// All game-affecting logic runs here, server-side, so clients cannot see
// hidden cards or manipulate outcomes. Chips are fake/play-money only.
const EventEmitter = require('events');
const { Deck } = require('./deck');
const { evaluateHand, compareHands, kickers, sameHandRank, describeKickers } = require('./handEvaluator');
const { computeEquity } = require('./equity');

const PHASES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'];

class Table {
  // `pacedRunout`: when nobody is left to bet, the remaining streets are
  // dealt one at a time by whoever drives the table (see advanceRunout)
  // rather than all at once, so an all-in can be watched. Off by default,
  // where a hand plays straight through to its showdown.
  constructor({ maxSeats = 9, smallBlind = 5, bigBlind = 10, pacedRunout = false } = {}) {
    this.maxSeats = maxSeats;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.seats = new Array(maxSeats).fill(null);
    this.dealerSeat = -1;
    this.deck = null;
    this.board = [];
    this.phase = 'waiting';
    this.handNumber = 0;
    this.pots = []; // computed at showdown: [{amount, eligiblePlayerIds}]
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.actingSeat = -1;
    this.toAct = new Set();
    this.lastHandSummary = null;
    this.actionCount = 0; // bumps on every decision; used to key the turn timer
    this.events = new EventEmitter();
    this.pacedRunout = pacedRunout;
    // While an all-in is being run out: the hands are face up and each
    // contender's chance of winning is known. null at any other time.
    this.runout = null; // { step, equity: [{ userId, win, tie }] }
  }

  // ---- Seating ----

  // `preferSeat` is the chair somebody actually pressed on the felt. It is a
  // preference and not a demand: between the press and this call another
  // player can have sat down in it, and turning somebody away from the table
  // over that would be worse than seating them one chair along.
  addPlayer(userId, username, buyIn, isBot = false, botLevel = null, preferSeat = null) {
    const wanted = Number.isInteger(preferSeat) ? preferSeat : -1;
    const free = wanted >= 0 && wanted < this.seats.length && this.seats[wanted] === null;
    const seat = free ? wanted : this.seats.findIndex((s) => s === null);
    if (seat === -1) throw new Error('Table is full.');
    this.seats[seat] = {
      seat,
      userId,
      username,
      isBot,
      botLevel,
      chips: buyIn,
      holeCards: [],
      betThisStreet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      sittingOut: false,
      // Sitting this one out by choice: the chair and the chips stay
      // theirs, and they are dealt out from the next hand until they say
      // otherwise. Apart from `sittingOut`, which is the table's own answer
      // to "can this seat play" and is worked out afresh at every deal.
      away: false,
      lastAction: null,
    };
    return seat;
  }

  // Seats someone while a hand is already running. They take no part in the
  // hand in progress - it would be dealt and bet without them - and are dealt
  // in from the next one, which startHand() handles by clearing sittingOut
  // for anyone holding chips.
  addLatePlayer(userId, username, buyIn, isBot = false, botLevel = null, preferSeat = null) {
    const seat = this.addPlayer(userId, username, buyIn, isBot, botLevel, preferSeat);
    this.seats[seat].sittingOut = true;
    this.seats[seat].folded = true;
    return seat;
  }

  // Turning your cards face up for the table once the hand is over. Anyone
  // still holding cards may, winner or not; a pot nobody contested is never
  // shown down, so without this there's no way to prove what you had.
  showHand(userId) {
    const sum = this.lastHandSummary;
    if (this.phase !== 'showdown' || !sum) return false;
    const p = this.seats.find((s) => s && s.userId === userId);
    if (!p || p.folded || !p.holeCards.length) return false;
    if (sum.showdownHands.some((h) => h.userId === userId)) return false;
    sum.showdownHands.push({ userId, username: p.username, holeCards: p.holeCards.slice(), shown: true });
    return true;
  }

  // Stepping away from the table, and coming back. The seat is kept either
  // way; only whether it is dealt in changes, and not until the next hand -
  // a hand already in front of them is theirs to finish.
  setAway(userId, on) {
    const p = this.seats.find((s) => s && s.userId === userId && !s.left);
    if (!p) return false;
    const away = !!on;
    if (p.away === away) return false;
    // Nobody may step away out of a game that cannot go on without them.
    // Coming back is always allowed.
    if (away && !this.canStepAway(userId)) return false;
    p.away = away;
    // Between hands there is nothing to finish, so a player coming back is
    // back now rather than at a deal that cannot happen without them.
    if (!away && this.phase === 'waiting') p.sittingOut = p.chips <= 0;
    this.actionCount += 1;
    return true;
  }

  // How many seats the next deal would include: chips to play with, and
  // nobody stepped away. Not the same question as `canStartHand`, which
  // reads `sittingOut` - the last deal's answer, and not rewritten until
  // the next one.
  dealableCount() {
    return this.seats.filter((p) => p && !p.left && p.chips > 0 && !p.away).length;
  }

  // Whether this seat may step away: only while two others would still be
  // left to play the hand. Heads-up there is no game without them, so the
  // answer is no - and coming back is never refused.
  canStepAway(userId) {
    const p = this.seats.find((s) => s && s.userId === userId && !s.left);
    if (!p) return false;
    if (p.away) return true;
    const others = this.seats.filter(
      (q) => q && !q.left && !q.away && q.chips > 0 && q.userId !== userId
    );
    return others.length >= 2;
  }

  // Marks a player as looking at their cards, so everyone else sees the tell.
  // It expires on its own in case a client vanishes mid-peek.
  setPeeking(userId, on) {
    const p = this.seats.find((s) => s && s.userId === userId);
    if (!p) return false;
    const until = on ? Date.now() + 8000 : 0;
    if (p.peekUntil === until) return false;
    p.peekUntil = until;
    return true;
  }

  removePlayer(userId) {
    const idx = this.seats.findIndex((s) => s && s.userId === userId);
    if (idx === -1) return;
    const p = this.seats[idx];
    if (this.phase === 'waiting' || this.phase === 'showdown') {
      this.seats[idx] = null;
      return;
    }
    // Mid-hand: keep the seat (its chips are already in the pot) and fold it.
    // The seat is cleared when the next hand starts.
    p.left = true;
    if (p.folded) return;
    p.folded = true;
    p.lastAction = 'left';
    if (this.runout) {
      const remaining = this._playersInHand().filter((q) => !q.folded);
      if (remaining.length === 1) this._awardUncontestedPot(remaining[0]);
      else this.runout.equity = this._equity();
      return;
    }
    if (this.actingSeat === idx) {
      this._afterAction(idx);
      return;
    }
    this.toAct.delete(idx);
    this.actionCount += 1;
    const remaining = this._playersInHand().filter((q) => !q.folded);
    if (remaining.length === 1) this._awardUncontestedPot(remaining[0]);
  }

  // Hands a seat straight back. Only for somebody who has nothing in the
  // hand - no cards, nothing in the pot - so the chair can be emptied there
  // and then rather than being held, folded, until the next deal the way
  // removePlayer has to hold a seat whose chips are already in the middle.
  releaseSeat(userId) {
    const idx = this.seats.findIndex((s) => s && s.userId === userId);
    if (idx === -1) return false;
    const p = this.seats[idx];
    if (p.committed > 0 || p.betThisStreet > 0 || p.holeCards.length) return false;
    this.seats[idx] = null;
    this.toAct.delete(idx);
    return true;
  }

  activePlayers() {
    return this.seats.filter((s) => s && !s.sittingOut);
  }

  seatedCount() {
    return this.activePlayers().length;
  }

  // ---- Hand lifecycle ----

  canStartHand() {
    return this.seatedCount() >= 2;
  }

  startHand() {
    for (let i = 0; i < this.seats.length; i++) {
      const p = this.seats[i];
      if (p && p.left) this.seats[i] = null;
      // Who is dealt in, decided once per hand: you need chips, and you
      // need to want them. Busted players drop out here, anyone who has
      // chips again - a late joiner waiting for this moment, or a rebuy -
      // is dealt back in, and anyone who stepped away stays out until they
      // come back. This is the point where stepping away takes effect,
      // which is what lets it be asked for mid-hand.
      else if (p) p.sittingOut = p.chips <= 0 || !!p.away;
    }
    if (!this.canStartHand()) throw new Error('Need at least 2 players to start a hand.');
    this.handNumber += 1;
    this.actionCount += 1;
    this.deck = new Deck();
    this.board = [];
    this.pots = [];
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastHandSummary = null;
    this.runout = null;

    for (const p of this.seats) {
      if (!p) continue;
      p.holeCards = [];
      p.peekUntil = 0;
      p.betThisStreet = 0;
      p.committed = 0;
      p.lastAction = null;
      p.allIn = false;
      p.folded = p.sittingOut || p.chips <= 0;
    }

    this._rotateDealer();
    this._dealHoleCards();
    this._postBlinds();
    this.phase = 'preflop';
    this._beginBettingRound(this._seatAfter(this._bigBlindSeat()));
    this.events.emit('handStarted');
  }

  _seatOrder() {
    // Seat indices of players still in the hand (joined this hand), in seat order.
    return this.seats
      .map((p, i) => (p ? i : null))
      .filter((i) => i !== null && this.seats[i] && !this.seats[i].sittingOut);
  }

  _seatAfter(seat) {
    const order = this._seatOrder();
    if (order.length === 0) return -1;
    const pos = order.indexOf(seat);
    return order[(pos + 1) % order.length];
  }

  _rotateDealer() {
    const order = this._seatOrder();
    if (this.dealerSeat === -1 || !order.includes(this.dealerSeat)) {
      this.dealerSeat = order[0];
    } else {
      this.dealerSeat = this._seatAfter(this.dealerSeat);
    }
  }

  _smallBlindSeat() {
    const order = this._seatOrder();
    if (order.length === 2) return this.dealerSeat; // heads-up: dealer posts SB
    return this._seatAfter(this.dealerSeat);
  }

  _bigBlindSeat() {
    const order = this._seatOrder();
    if (order.length === 2) return this._seatAfter(this.dealerSeat);
    return this._seatAfter(this._smallBlindSeat());
  }

  _dealHoleCards() {
    const order = this._seatOrder();
    for (const seat of order) {
      const p = this.seats[seat];
      p.holeCards = this.deck.drawMany(2);
    }
  }

  _postBlinds() {
    const sb = this._smallBlindSeat();
    const bb = this._bigBlindSeat();
    this._commit(sb, Math.min(this.smallBlind, this.seats[sb].chips));
    this.seats[sb].lastAction = 'small blind';
    this._commit(bb, Math.min(this.bigBlind, this.seats[bb].chips));
    this.seats[bb].lastAction = 'big blind';
    this.currentBet = this.seats[bb].betThisStreet;
  }

  _commit(seat, amount) {
    const p = this.seats[seat];
    amount = Math.min(amount, p.chips);
    p.chips -= amount;
    p.betThisStreet += amount;
    p.committed += amount;
    if (p.chips === 0) p.allIn = true;
  }

  // ---- Betting rounds ----

  _playersInHand() {
    return this._seatOrder().map((s) => this.seats[s]);
  }

  _playersWhoCanAct() {
    return this._playersInHand().filter((p) => !p.folded && !p.allIn);
  }

  _beginBettingRound(firstToAct) {
    const canAct = this._playersWhoCanAct();
    if (canAct.length <= 1) {
      // Everyone else is folded or all-in; nothing left to decide this street.
      this._finishBettingRound();
      return;
    }
    this.toAct = new Set(canAct.map((p) => p.seat));
    this.actingSeat = this._nextActingSeat(firstToAct, true);
  }

  _nextActingSeat(fromSeat, inclusive = false) {
    const order = this._seatOrder();
    if (order.length === 0) return -1;
    let pos = order.indexOf(fromSeat);
    if (pos === -1) pos = 0;
    const start = inclusive ? pos : pos + 1;
    for (let i = 0; i < order.length; i++) {
      const seat = order[(start + i) % order.length];
      const p = this.seats[seat];
      if (!p.folded && !p.allIn) return seat;
    }
    return -1;
  }

  getCurrentPlayer() {
    return this.actingSeat >= 0 ? this.seats[this.actingSeat] : null;
  }

  // Validates and applies a player action. Throws on illegal actions so the
  // caller (socket handler) can reject manipulated/invalid client requests.
  applyAction(userId, action, amount = 0) {
    const seat = this.seats.findIndex((s) => s && s.userId === userId);
    if (seat === -1) throw new Error('Player not seated at this table.');
    if (this.actingSeat !== seat) throw new Error('Not your turn.');
    const p = this.seats[seat];
    if (p.folded || p.allIn) throw new Error('You cannot act right now.');

    const toCall = this.currentBet - p.betThisStreet;

    switch (action) {
      case 'fold':
        p.folded = true;
        p.lastAction = 'fold';
        this._afterFold(seat);
        return this._afterAction(seat);

      case 'check':
        if (toCall > 0) throw new Error('Cannot check: a bet must be called.');
        p.lastAction = 'check';
        return this._afterAction(seat);

      case 'call': {
        if (toCall <= 0) throw new Error('Nothing to call; check instead.');
        this._commit(seat, toCall);
        p.lastAction = p.allIn ? 'call (all-in)' : 'call';
        return this._afterAction(seat);
      }

      case 'bet': {
        if (toCall > 0) throw new Error('Cannot bet: must call or raise instead.');
        if (amount <= 0) throw new Error('Bet must be positive.');
        const capped = Math.min(amount, p.chips);
        if (capped < this.bigBlind && capped < p.chips) {
          throw new Error(`Minimum bet is ${this.bigBlind}.`);
        }
        this._commit(seat, capped);
        this.currentBet = p.betThisStreet;
        this.minRaise = Math.max(this.bigBlind, capped);
        p.lastAction = p.allIn ? 'bet (all-in)' : `bet ${capped}`;
        this._reopenAction(seat);
        return this._afterAction(seat, true);
      }

      case 'raise': {
        if (amount <= 0) throw new Error('Raise must be positive.');
        const targetTotal = p.betThisStreet + toCall + amount; // amount = raise increment above the call
        const totalNeeded = targetTotal - p.betThisStreet;
        const capped = Math.min(totalNeeded, p.chips);
        const newBetThisStreet = p.betThisStreet + capped;
        const raiseSize = newBetThisStreet - this.currentBet;
        if (raiseSize < this.minRaise && capped < p.chips) {
          throw new Error(`Minimum raise is ${this.minRaise}.`);
        }
        this._commit(seat, capped);
        this.currentBet = p.betThisStreet;
        this.minRaise = Math.max(this.minRaise, raiseSize);
        p.lastAction = p.allIn ? 'raise (all-in)' : `raise to ${p.betThisStreet}`;
        this._reopenAction(seat);
        return this._afterAction(seat, true);
      }

      case 'allin': {
        const capped = p.chips;
        if (capped <= 0) throw new Error('No chips left to go all-in with.');
        this._commit(seat, capped);
        if (p.betThisStreet > this.currentBet) {
          const raiseSize = p.betThisStreet - this.currentBet;
          this.currentBet = p.betThisStreet;
          if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
          this._reopenAction(seat);
        }
        p.lastAction = 'all-in';
        return this._afterAction(seat, true);
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  _reopenAction(raiserSeat) {
    // A bet/raise reopens action for everyone else still able to act.
    this.toAct = new Set(this._playersWhoCanAct().filter((p) => p.seat !== raiserSeat).map((p) => p.seat));
  }

  _afterFold(seat) {
    this.toAct.delete(seat);
  }

  _afterAction(seat) {
    this.actionCount += 1;
    this.toAct.delete(seat);

    const remaining = this._playersInHand().filter((p) => !p.folded);
    if (remaining.length === 1) {
      this._awardUncontestedPot(remaining[0]);
      return { handEnded: true };
    }

    if (this.toAct.size === 0) {
      this._finishBettingRound();
      return { roundEnded: true, phase: this.phase };
    }

    this.actingSeat = this._nextActingSeat(seat);
    return { nextSeat: this.actingSeat };
  }

  _finishBettingRound() {
    const remaining = this._playersInHand().filter((p) => !p.folded);
    if (remaining.length <= 1) {
      if (remaining.length === 1) this._awardUncontestedPot(remaining[0]);
      return;
    }

    // With at most one player still holding chips there is nobody left to
    // bet against: the rest of the board is simply dealt.
    const canStillAct = this._playersWhoCanAct();
    if (this.phase === 'river') {
      this._runToShowdown();
      return;
    }
    if (canStillAct.length <= 1) {
      if (this.pacedRunout) this._startRunout();
      else this._runToShowdown();
      return;
    }

    this._advancePhase();
  }

  _advancePhase() {
    for (const p of this._playersInHand()) p.betThisStreet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    const idx = PHASES.indexOf(this.phase);
    this.phase = PHASES[idx + 1];

    if (this.phase === 'flop') this.board.push(...this.deck.drawMany(3));
    else if (this.phase === 'turn' || this.phase === 'river') this.board.push(this.deck.draw());
    else if (this.phase === 'showdown') return this._runShowdown();

    const firstSeat = this._nextActingSeat(this.dealerSeat);
    this._beginBettingRound(firstSeat);
  }

  _runToShowdown() {
    while (this.phase !== 'river') {
      for (const p of this._playersInHand()) p.betThisStreet = 0;
      const idx = PHASES.indexOf(this.phase);
      this.phase = PHASES[idx + 1];
      if (this.phase === 'flop') this.board.push(...this.deck.drawMany(3));
      else if (this.phase === 'turn' || this.phase === 'river') this.board.push(this.deck.draw());
    }
    for (const p of this._playersInHand()) p.betThisStreet = 0;
    this.phase = 'showdown';
    this._runShowdown();
  }

  // Every contender's hand goes face up and the bets go into the middle; the
  // board is then dealt a street at a time by advanceRunout. No timing lives
  // here - the 'runout' event tells the caller to start the clock.
  _startRunout() {
    for (const p of this._playersInHand()) p.betThisStreet = 0;
    this.currentBet = 0;
    this.actingSeat = -1;
    this.toAct = new Set();
    this.runout = { step: 0, equity: this._equity() };
    this.actionCount += 1;
    this.events.emit('runout');
  }

  // Deals the next street of a runout, or - with the board complete - turns
  // it into the showdown. Returns false when there is no runout to advance.
  advanceRunout() {
    if (!this.runout) return false;
    if (this.board.length >= 5) {
      this.runout = null;
      this.phase = 'showdown';
      this._runShowdown();
      return true;
    }
    const idx = PHASES.indexOf(this.phase);
    this.phase = PHASES[idx + 1];
    if (this.phase === 'flop') this.board.push(...this.deck.drawMany(3));
    else this.board.push(this.deck.draw());
    this.runout = { step: this.runout.step + 1, equity: this._equity() };
    this.actionCount += 1;
    return true;
  }

  // Each contender's chance of taking the pot from here, rounded for show.
  _equity() {
    const live = this._playersInHand().filter((p) => !p.folded);
    const eq = computeEquity(live.map((p) => p.holeCards), this.board);
    return live.map((p, i) => ({
      userId: p.userId,
      win: Math.round(eq[i].win * 10) / 10,
      tie: Math.round(eq[i].tie * 10) / 10,
    }));
  }

  _awardUncontestedPot(winner) {
    this.runout = null;
    const potTotal = this._playersInHand().reduce((sum, p) => sum + p.committed, 0);
    winner.chips += potTotal;
    this.phase = 'showdown';
    this.actingSeat = -1;
    this.lastHandSummary = {
      handNumber: this.handNumber,
      board: this.board.slice(),
      uncontested: true,
      winners: [{ userId: winner.userId, username: winner.username, amount: potTotal }],
      showdownHands: [],
    };
    this.events.emit('handEnded', this.lastHandSummary);
  }

  _buildPots() {
    const contributors = this._playersInHand()
      .filter((p) => p.committed > 0)
      .map((p) => ({ seat: p.seat, userId: p.userId, committed: p.committed, folded: p.folded }));
    const levels = [...new Set(contributors.map((p) => p.committed))].sort((a, b) => a - b);
    const pots = [];
    let prevLevel = 0;
    for (const level of levels) {
      const layer = level - prevLevel;
      const payers = contributors.filter((p) => p.committed >= level);
      const amount = layer * payers.length;
      const eligible = payers.filter((p) => !p.folded).map((p) => p.userId);
      if (amount > 0 && eligible.length > 0) pots.push({ amount, eligiblePlayerIds: eligible });
      prevLevel = level;
    }
    return pots;
  }

  _runShowdown() {
    this.actingSeat = -1;
    const inHand = this._playersInHand().filter((p) => !p.folded);
    const evaluations = {};
    for (const p of inHand) {
      evaluations[p.userId] = evaluateHand([...p.holeCards, ...this.board]);
    }

    // When two players turn over the same hand - both a pair of Kings, both
    // two pair - the side cards are what decided it, so each of them is told
    // which kicker they were playing. On a hand with no kicker (a straight,
    // a full house) this stays empty and nothing is shown.
    const kickerByUser = {};
    for (const p of inHand) {
      const mine = evaluations[p.userId];
      const shared = inHand.some((q) => q.userId !== p.userId && sameHandRank(mine, evaluations[q.userId]));
      kickerByUser[p.userId] = shared ? describeKickers(kickers(mine)) : '';
    }

    this.pots = this._buildPots();
    const winningsByUser = {};
    const potResults = [];

    for (const pot of this.pots) {
      const eligible = pot.eligiblePlayerIds;
      let best = null;
      for (const uid of eligible) {
        if (!best || compareHands(evaluations[uid], evaluations[best[0]]) > 0) best = [uid];
        else if (compareHands(evaluations[uid], evaluations[best[0]]) === 0) best.push(uid);
      }
      const share = Math.floor(pot.amount / best.length);
      let remainder = pot.amount - share * best.length;
      // Order winners by seat position after the dealer so the odd chip goes
      // to the first eligible winner in standard poker order.
      const order = this._seatOrder();
      const dealerPos = order.indexOf(this.dealerSeat);
      const bySeatOrder = best
        .map((uid) => this.seats.find((s) => s && s.userId === uid))
        .sort((a, b) => {
          const ra = (order.indexOf(a.seat) - dealerPos + order.length) % order.length;
          const rb = (order.indexOf(b.seat) - dealerPos + order.length) % order.length;
          return ra - rb;
        });

      for (const winnerPlayer of bySeatOrder) {
        let amt = share;
        if (remainder > 0) {
          amt += 1;
          remainder -= 1;
        }
        winningsByUser[winnerPlayer.userId] = (winningsByUser[winnerPlayer.userId] || 0) + amt;
      }
      potResults.push({ amount: pot.amount, winners: best });
    }

    for (const [userId, amount] of Object.entries(winningsByUser)) {
      const p = this.seats.find((s) => s && s.userId === Number(userId));
      if (p) p.chips += amount;
    }

    this.lastHandSummary = {
      handNumber: this.handNumber,
      board: this.board.slice(),
      uncontested: false,
      pots: potResults,
      winners: Object.entries(winningsByUser).map(([userId, amount]) => {
        const p = this.seats.find((s) => s && s.userId === Number(userId));
        return { userId: Number(userId), username: p.username, amount, hand: evaluations[userId], kicker: kickerByUser[userId] || '' };
      }),
      showdownHands: inHand.map((p) => ({
        userId: p.userId,
        username: p.username,
        holeCards: p.holeCards,
        evaluation: evaluations[p.userId],
        kicker: kickerByUser[p.userId],
      })),
    };
    this.events.emit('handEnded', this.lastHandSummary);
  }

  // ---- Public state for broadcasting ----

  // Returns a sanitized view of the table for a given viewer; other players'
  // hole cards are hidden unless we're at showdown.
  getPublicState(viewerUserId) {
    return {
      phase: this.phase,
      board: this.board.slice(),
      dealerSeat: this.dealerSeat,
      actingSeat: this.actingSeat,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      handNumber: this.handNumber,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      lastHandSummary: this.lastHandSummary,
      runout: this.runout,
      actionCount: this.actionCount,
      maxSeats: this.maxSeats,
      seats: this.seats.map((p) => {
        if (!p) return null;
        const isViewer = p.userId === viewerUserId;
        // Someone else's cards are visible exactly when they're part of the
        // showdown: everyone still in at a contested one, and anyone who
        // chose to show after a pot nobody contested. Folded hands stay down.
        // An all-in being run out is shown face up from the moment the
        // betting stops, which is the point of watching it.
        const shownAtShowdown =
          (!!this.runout && !p.folded) ||
          (this.phase === 'showdown' &&
            !p.folded &&
            !!this.lastHandSummary?.showdownHands.some((h) => h.userId === p.userId));
        return {
          seat: p.seat,
          userId: p.userId,
          username: p.username,
          chips: p.chips,
          betThisStreet: p.betThisStreet,
          committed: p.committed,
          folded: p.folded,
          allIn: p.allIn,
          sittingOut: p.sittingOut,
          away: !!p.away,
          lastAction: p.lastAction,
          holeCards: isViewer || shownAtShowdown ? p.holeCards : null,
          hasCards: p.holeCards.length > 0,
          left: !!p.left,
          isBot: !!p.isBot,
          botLevel: p.botLevel || null,
          peeking: !isViewer && p.peekUntil > Date.now(),
        };
      }),
    };
  }
}

module.exports = { Table };
