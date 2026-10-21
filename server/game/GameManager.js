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
  constructor(hostUserId, hostUsername, { smallBlind, bigBlind, isPrivate = false } = {}) {
    this.code = makeRoomCode();
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
    // Who has pressed skip on the current hand's result screen.
    this.resultHand = null;
    this.resultSkips = new Set();
    // Everyone in the room without a seat: userId -> why they're watching,
    // 'bust' (ran out of chips, seat given up so the table isn't cluttered
    // with empty stacks) or 'watching' (pulled up a chair deliberately).
    // Either way they can talk, and the next game deals them in.
    this.spectators = new Map();
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
    if (this.table.phase === 'waiting') return this.lobby.size;
    return this.table.seats.filter((p) => p && !p.left).length;
  }

  // No seat to give: either every chair is taken or the lobby is at capacity.
  isFull() {
    if (this.lobby.size >= this.table.maxSeats) return true;
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
      .filter((r) => !r.isPrivate && !r.isFull())
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
        hand: r.table.handNumber,
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

  endGame(room) {
    if (!room.gameId) return;
    for (const p of room.table.seats) {
      if (!p || p.isBot) continue; // bots have no account row to record against
      const buyIn = room.lobby.get(p.userId)?.buyIn || 0;
      db.recordGameResult(room.gameId, p.userId, buyIn, p.chips);
    }
    db.endGame(room.gameId);
    room.gameId = null;
  }

  removeRoom(code) {
    this.rooms.delete(code);
  }
}

Room.CHAT_MAX = 80;

module.exports = { GameManager, Room };
