// Manages in-memory game rooms. Each room wraps one Table plus lobby info
// (host, room code, buy-in settings) so players can gather before a hand starts.
const crypto = require('crypto');
const { Table } = require('./Table');
const db = require('../db');

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

class Room {
  constructor(hostUserId, hostUsername, { smallBlind, bigBlind, isPrivate = false, allowSpectators = true } = {}) {
    this.code = makeRoomCode();
    // Carried in the shareable link. The code alone still only gets you to
    // the door of a private room; this is what makes a link an invitation,
    // so passing the code around by word of mouth doesn't become one.
    this.inviteToken = crypto.randomBytes(9).toString('base64url');
    this.hostUserId = hostUserId;
    this.hostUsername = hostUsername;
    this.table = new Table({ smallBlind: smallBlind || 5, bigBlind: bigBlind || 10 });
    this.gameId = null;
    this.lobby = new Map(); // userId -> { username, buyIn, ready }
    this.handTimer = null;
    // Set when a game finishes so the result outlives the table it was won
    // on: the table is reset for the next game the moment the last hand
    // ends, which would otherwise take the standings down with it.
    this.gameOver = null;
    // Stake handed to anyone who joins with the code once play has started.
    // The host owns this number, not the joiner, so nobody can walk into a
    // running game and award themselves a stack. null = match the host's own.
    this.joinChips = null;
    // Every hand this game has finished, oldest first, so somebody who
    // arrives part-way through - a watcher, or a player dealt in late - can
    // read back the hands they missed instead of starting from an empty
    // sidebar. Cleared when the next game begins.
    this.handLog = [];
    // Recent table talk, kept so somebody refreshing or arriving part-way
    // through doesn't land in a silent room. Oldest first.
    this.chat = [];
    // Private rooms are never listed publicly, and the code alone isn't
    // enough: the host lets each newcomer in by hand.
    this.isPrivate = !!isPrivate;
    // Waiting at the door of a private room: userId -> username.
    this.knocks = new Map();
    // Open vote-kick: targetUserId -> Set of userIds who voted to remove them.
    this.kickVotes = new Map();
    // The other side of the same vote: who has spoken up to keep them.
    this.keepVotes = new Map();
    // Everyone in the room without a seat: userId -> why they're watching,
    // 'bust' (ran out of chips, seat given up so the table isn't cluttered
    // with empty stacks) or 'watching' (pulled up a chair deliberately).
    // Either way they can talk, and the next game deals them in.
    this.spectators = new Map();
    // Watchers the host has turned away. They can't come back, as a player
    // or a watcher, until the room is gone.
    this.blocked = new Set();
    // Whether anyone may pull up a chair behind the table and watch. The
    // host's call when they open the room; some games would rather not have
    // an audience reading the chat.
    this.allowSpectators = allowSpectators;
  }

  // Lobby members who hold or are owed a seat. Watchers are in the lobby so
  // they can talk and be dealt in next game, but they aren't taking a chair,
  // so a full table never stops someone watching.
  seatHolders() {
    let n = 0;
    for (const id of this.lobby.keys()) if (!this.spectators.has(id)) n += 1;
    return n;
  }

  // Everyone in the room: waiting in the lobby, sat at the table, or watching
  // after busting out (who are still lobby members).
  members() {
    const ids = new Set(this.lobby.keys());
    for (const p of this.table.seats) if (p) ids.add(p.userId);
    return ids;
  }

  // Who's watching, for the panel at the table. `bust` separates the player
  // who lost their stack from the one who chose to sit this game out: only
  // the first is owed an explanation.
  spectatorList() {
    return [...this.spectators]
      .filter(([id]) => this.lobby.has(id))
      .map(([id, why]) => ({
        userId: id,
        username: this.lobby.get(id)?.username || 'Player',
        bust: why === 'bust',
      }));
  }

  // People who chose to watch. Players who busted out are watching too, but
  // they're the room's own, counted separately: turning spectators away was
  // never meant to throw a player out of the game they just lost.
  watcherCount() {
    let n = 0;
    for (const [id, why] of this.spectators) if (why === 'watching' && this.lobby.has(id)) n += 1;
    return n;
  }

  addToLobby(userId, username, buyIn, isBot = false, botLevel = null) {
    this.lobby.set(userId, { username, buyIn, ready: true, isBot, botLevel });
  }

  // True when someone other than `exceptUserId` already answers to this name
  // here, whether they're waiting in the lobby or sat at the table. Compared
  // case-insensitively, because "Sam" and "sam" read as the same player.
  nameTaken(name, exceptUserId) {
    const wanted = String(name).trim().toLowerCase();
    for (const [id, info] of this.lobby) {
      if (id !== exceptUserId && String(info.username).toLowerCase() === wanted) return true;
    }
    return this.table.seats.some(
      (p) => p && !p.left && p.userId !== exceptUserId && String(p.username).toLowerCase() === wanted
    );
  }

  // Everyone who could cast a vote: humans still in the room. Bots don't get
  // a say, and nor does the player being voted on.
  voters(exceptUserId = null) {
    const ids = new Set();
    for (const [id, info] of this.lobby) if (!info.isBot && id > 0) ids.add(id);
    for (const p of this.table.seats) if (p && !p.isBot && !p.left && p.userId > 0) ids.add(p.userId);
    if (exceptUserId != null) ids.delete(exceptUserId);
    return ids;
  }

  // A strict majority of everyone eligible to vote, so two players out of
  // three is enough but one out of two is not.
  votesNeeded(targetUserId) {
    return Math.floor(this.voters(targetUserId).size / 2) + 1;
  }

  // Whether a vote is a vote at all.
  //
  // Below three people it isn't. With two, the target is excluded from their
  // own vote, which leaves an electorate of one and a majority of one: the
  // other player removes them on their own say-so, and calling that a vote
  // dresses up something nobody agreed to. Under three it is the host's job
  // - they can already remove anyone from their own room - and the control
  // is taken off the table rather than left there to be refused.
  //
  // Bots are not counted. They cannot vote and cannot be voted out, so a
  // table of two people and four bots is still two people.
  canVoteKick() {
    return this.voters().size >= Room.VOTEKICK_MIN;
  }

  recordHand(summary) {
    if (!summary?.winners?.length) return;
    const at = this.handLog.findIndex((h) => h.handNumber === summary.handNumber);
    if (at >= 0) this.handLog[at] = summary;
    else this.handLog.push(summary);
    if (this.handLog.length > Room.HANDS_MAX) this.handLog.splice(0, this.handLog.length - Room.HANDS_MAX);
  }

  addChat(entry) {
    this.chat.push(entry);
    if (this.chat.length > Room.CHAT_MAX) this.chat.splice(0, this.chat.length - Room.CHAT_MAX);
    return entry;
  }

  // What a late joiner is actually given, falling back to the host's own
  // buy-in so a host who never touches the setting still gets a sane stake.
  lateJoinChips() {
    if (this.joinChips > 0) return this.joinChips;
    const host = this.lobby.get(this.hostUserId);
    if (host?.buyIn > 0) return host.buyIn;
    const seated = this.table.seats.find((p) => p && p.userId === this.hostUserId);
    return seated?.chips > 0 ? seated.chips : 1000;
  }

  botCount() {
    return [...this.lobby.values()].filter((p) => p.isBot).length;
  }

  // Everyone actually in the room: waiting in the lobby before the deal, or
  // still sitting at the table once it's under way.
  playerCount() {
    if (this.table.phase === 'waiting') return this.seatHolders();
    return this.table.seats.filter((p) => p && !p.left).length;
  }

  // No seat to give: either every chair is taken or the lobby is at capacity.
  isFull() {
    if (this.seatHolders() >= this.table.maxSeats) return true;
    return this.table.phase !== 'waiting' && this.table.seats.every((seat) => seat !== null);
  }

  // What someone joining right now would sit down with: the table's stake
  // before the deal, the host's late-join figure once it's running.
  stakeForJoiner() {
    if (this.table.phase !== 'waiting') return this.lateJoinChips();
    const host = this.lobby.get(this.hostUserId);
    return host?.buyIn > 0 ? host.buyIn : 1000;
  }

  removeFromLobby(userId) {
    this.lobby.delete(userId);
  }
}

class GameManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  createRoom(hostUserId, hostUsername, options) {
    const room = new Room(hostUserId, hostUsername, options);
    this.rooms.set(room.code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(String(code).toUpperCase());
  }

  findRoomForUser(userId) {
    for (const room of this.rooms.values()) {
      if (room.lobby.has(userId)) return room;
      if (room.table.seats.some((s) => s && s.userId === userId && !s.left)) return room;
    }
    return null;
  }

  // Public rooms with a seat free, whether they're still gathering players or
  // already playing: walking into a game in progress is allowed, and the
  // joiner is dealt in from the next hand.
  listOpenRooms() {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate)
      .map((r) => ({
        code: r.code,
        host: r.hostUsername,
        players: r.playerCount(),
        seats: r.table.maxSeats,
        bots: r.botCount(),
        smallBlind: r.table.smallBlind,
        bigBlind: r.table.bigBlind,
        chips: r.stakeForJoiner(),
        inPlay: r.table.phase !== 'waiting',
        // Listed even with every chair taken: there's no seat to join, but
        // a game is still worth watching.
        full: r.isFull(),
        hand: r.table.handNumber,
        watching: r.watcherCount(),
        allowSpectators: r.allowSpectators,
      }));
  }

  // Seats everyone currently in the lobby with their host-assigned starting
  // chip amount, then begins the first hand. Also creates a games row for history.
  startGame(room) {
    if (room.table.seatedCount() === 0) {
      for (const [userId, info] of room.lobby.entries()) {
        room.table.addPlayer(userId, info.username, info.buyIn, info.isBot, info.botLevel);
      }
    }
    if (!room.table.canStartHand()) throw new Error('Need at least 2 players to start.');
    room.spectators.clear(); // a fresh game deals the last one's busted players back in
    room.gameId = db.createGame(room.code);
    room.table.startHand();
  }

  // Called after each hand resolves: records history and chip balances,
  // then starts the next hand after a short pause (handled by caller).
  recordHandResult(room) {
    const summary = room.table.lastHandSummary;
    if (!summary || !room.gameId) return;
    db.recordHand(room.gameId, summary.handNumber, summary);
  }

  // The end of a match, as a record.
  //
  // Two kinds of player sit at this table and they are recorded in two
  // different places. An account's result is written to the results table,
  // where it is theirs for good. A guest's is handed to the caller instead,
  // for the in-memory session buffer - a guest has no profile and no history,
  // and writing one would be keeping a record of somebody who never asked for
  // one and cannot read it. Bots are recorded nowhere at all.
  //
  // `onGuestResult` is how the buffer is reached without this file knowing
  // about sockets: sockets.js passes it, because only sockets.js knows which
  // browser session a given player is connected under.
  endGame(room, { onGuestResult } = {}) {
    if (!room.gameId) return;

    // Where everyone came. Worked out once, off the stacks as they stand at
    // the end, so every seat's placement agrees with every other's. Bots are
    // in this ordering - finishing second behind a bot is still second.
    const standing = room.table.seats
      .filter((p) => p && !p.left)
      .sort((a, b) => b.chips - a.chips);
    const placeOf = new Map(standing.map((p, i) => [p.userId, i + 1]));

    // One id for one match, shared by every row it produces, so a credited
    // guest batch cannot be written twice and a retry is a no-op.
    const matchId = `g${room.gameId}`;
    const endedAt = new Date().toISOString();

    for (const p of room.table.seats) {
      if (!p || p.isBot) continue; // bots have no account row to record against
      const result = this.resultFor(room, p, {
        matchId,
        placement: placeOf.get(p.userId) || null,
        endedAt,
      });
      if (onGuestResult?.(p.userId, result)) continue; // held for the session, not stored
      db.recordGameResult(room.gameId, p.userId, result);
    }
    db.endGame(room.gameId);
    room.gameId = null;
  }

  // One seat's match, as a row. Shared by the two things that produce one -
  // a match ending, and a player leaving one - so a record cannot depend on
  // which way the player left the table.
  resultFor(room, p, { matchId, placement, endedAt }) {
    const info = room.lobby.get(p.userId);
    return {
      gameId: room.gameId,
      matchId,
      startStack: info?.buyIn || 0,
      endStack: p.chips,
      placement,
      mode: room.isPrivate ? 'Private' : 'Casual',
      hands: room.table.handNumber || 0,
      smallBlind: room.table.smallBlind,
      bigBlind: room.table.bigBlind,
      endedAt,
    };
  }

  // A player walking out of a match that is still running.
  //
  // Their chips are counted where they stand and the row is written now,
  // rather than at a finish they will not be present for. Leaving a match
  // used to record nothing at all: a player who sat down, won, and left was
  // a player who had never played.
  //
  // The match carries on, so `gameId` is left alone and `db.endGame` is not
  // called. The row is written under the same `matchId` the finish would
  // use, which is what makes this safe to do twice: the unique index on
  // (user_id, match_id) means if the match later ends with their seat still
  // in the list, that second write is ignored and this one - taken when they
  // actually left - is the one that stands.
  //
  // Returns true if anything was recorded or buffered.
  recordDeparture(room, userId, { onGuestResult } = {}) {
    if (!room.gameId) return false; // nothing running: no match to leave
    const p = room.table.seats.find((s) => s && s.userId === userId);
    if (!p || p.isBot) return false; // never sat down, or isn't a person
    const result = this.resultFor(room, p, {
      matchId: `g${room.gameId}`,
      // They left; they did not place. Where they would have finished is not
      // knowable, and guessing it from the current stacks would record a
      // position in a match that went on without them.
      placement: null,
      endedAt: new Date().toISOString(),
    });
    if (onGuestResult?.(userId, result)) return true;
    return !!db.recordGameResult(room.gameId, userId, result);
  }

  removeRoom(code) {
    this.rooms.delete(code);
  }
}

Room.CHAT_MAX = 80;
// Fewest people at a table for a vote to mean anything. See canVoteKick.
Room.VOTEKICK_MIN = 3;
// Matching the sidebar's own ceiling on the client.
Room.HANDS_MAX = 60;

module.exports = { GameManager, Room };
