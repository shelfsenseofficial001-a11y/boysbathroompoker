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
  constructor(hostUserId, hostUsername, { smallBlind, bigBlind } = {}) {
    this.code = makeRoomCode();
    this.hostUserId = hostUserId;
    this.hostUsername = hostUsername;
    this.table = new Table({ smallBlind: smallBlind || 5, bigBlind: bigBlind || 10 });
    this.gameId = null;
    this.lobby = new Map(); // userId -> { username, buyIn, ready }
    this.handTimer = null;
  }

  addToLobby(userId, username, buyIn, isBot = false) {
    this.lobby.set(userId, { username, buyIn, ready: true, isBot });
  }

  botCount() {
    return [...this.lobby.values()].filter((p) => p.isBot).length;
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

  listOpenRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.table.phase === 'waiting')
      .map((r) => ({
        code: r.code,
        host: r.hostUsername,
        players: r.lobby.size,
        bots: r.botCount(),
        smallBlind: r.table.smallBlind,
        bigBlind: r.table.bigBlind,
      }));
  }

  // Seats everyone currently in the lobby with their host-assigned starting
  // chip amount, then begins the first hand. Also creates a games row for history.
  startGame(room) {
    if (room.table.seatedCount() === 0) {
      for (const [userId, info] of room.lobby.entries()) {
        room.table.addPlayer(userId, info.username, info.buyIn, info.isBot);
      }
    }
    if (!room.table.canStartHand()) throw new Error('Need at least 2 players to start.');
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

module.exports = { GameManager, Room };
