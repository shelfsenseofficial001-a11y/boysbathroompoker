// Wires Socket.io events to the GameManager/Table. All game logic stays on
// the server; sockets only relay validated actions and personalized state.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('./db');
const { GameManager } = require('./game/GameManager');
const { Table } = require('./game/Table');
const bot = require('./game/bot');

const GUEST_NAME_RE = /^guest_[a-z0-9]{4,8}$/;
const NEXT_HAND_DELAY_MS = 5000;
const TURN_MS = (Number(process.env.TURN_SECONDS) || 30) * 1000;
const BETTING_PHASES = ['preflop', 'flop', 'turn', 'river'];

function getOrCreateGuest(name) {
  if (typeof name !== 'string' || !GUEST_NAME_RE.test(name)) return null;
  const existing = db.getUserByUsername(name);
  if (existing) return existing;
  // Random unusable password so guest accounts can't be logged into normally.
  const hash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 4);
  db.createUser(name, hash, 1000);
  return db.getUserByUsername(name);
}

function wrapSessionMiddleware(sessionMiddleware) {
  return (socket, next) => sessionMiddleware(socket.request, {}, next);
}

function attachSockets(io, sessionMiddleware) {
  const manager = new GameManager();
  const socketsByUser = new Map(); // userId -> Set<socket>

  io.use(wrapSessionMiddleware(sessionMiddleware));

  io.use((socket, next) => {
    const userId = socket.request.session?.userId;
    if (userId) {
      socket.userId = userId;
      return next();
    }
    // TEMPORARY dev mode: each tab connects as its own guest player.
    if (process.env.SKIP_AUTH === 'true') {
      const guest = getOrCreateGuest(socket.handshake.auth?.guestName);
      if (guest) {
        socket.userId = guest.id;
        return next();
      }
    }
    next(new Error('unauthorized'));
  });

  function attachTableEvents(room) {
    room.table.events.on('handEnded', () => scheduleNextHand(room));
  }

  // Server-side turn clock: when it expires the player auto-checks if legal,
  // otherwise auto-folds. Keyed on hand + action count so it re-arms exactly
  // once per decision, not on unrelated broadcasts.
  function armTurnTimer(room) {
    const t = room.table;
    const betting = BETTING_PHASES.includes(t.phase) && t.actingSeat >= 0;
    const key = betting ? `${t.handNumber}:${t.actionCount}` : null;
    if (key === room.turnKey) return;
    clearTimeout(room.turnTimer);
    room.turnKey = key;
    room.turnDeadline = null;
    if (!betting) return;

    const p = t.seats[t.actingSeat];

    // Bots check their cards, think briefly, then play their hand.
    if (p.isBot) {
      if (t.board.length === 0 && t.setPeeking(p.userId, true)) {
        setTimeout(() => {
          if (room.turnKey === key) {
            t.setPeeking(p.userId, false);
            broadcastRoom(room);
          }
        }, 600);
      }
      room.turnTimer = setTimeout(() => {
        if (room.turnKey !== key) return;
        t.setPeeking(p.userId, false);
        try {
          const move = bot.decide(t, p);
          t.applyAction(p.userId, move.type, move.amount || 0);
        } catch {
          // Fall back to the safest legal move if the chosen one was rejected.
          try {
            t.applyAction(p.userId, t.currentBet > p.betThisStreet ? 'fold' : 'check');
          } catch {
            // The hand moved on without this bot; nothing to do.
          }
        }
        broadcastRoom(room);
      }, bot.thinkingTime(p.botLevel));
      return;
    }

    room.turnDeadline = Date.now() + TURN_MS;
    room.turnTimer = setTimeout(() => {
      if (room.turnKey !== key) return;
      const toCall = t.currentBet - p.betThisStreet;
      try {
        t.applyAction(p.userId, toCall > 0 ? 'fold' : 'check');
        p.lastAction = toCall > 0 ? 'timed out' : 'check (time)';
      } catch {
        // State moved on in the meantime; nothing to do.
      }
      broadcastRoom(room);
    }, TURN_MS);
  }

  function broadcastRoom(room) {
    armTurnTimer(room);
    const turn = room.turnDeadline
      ? { remainingMs: Math.max(0, room.turnDeadline - Date.now()), totalMs: TURN_MS }
      : null;
    const everyone = new Set([...room.lobby.keys(), ...room.table.seats.filter(Boolean).map((p) => p.userId)]);
    for (const userId of everyone) {
      const sockets = socketsByUser.get(userId);
      if (!sockets) continue;
      const payload = {
        code: room.code,
        hostUserId: room.hostUserId,
        lobby: [...room.lobby.entries()].map(([uid, info]) => ({ userId: uid, ...info })),
        table: room.table.getPublicState(userId),
        turn,
      };
      for (const s of sockets) s.emit('roomState', payload);
    }
  }

  function scheduleNextHand(room) {
    manager.recordHandResult(room);
    clearTimeout(room.handTimer);
    room.handTimer = setTimeout(() => {
      const playersWithChips = room.table.seats.filter((p) => p && !p.left && p.chips > 0);
      const humansSeated = room.table.seats.some((p) => p && !p.left && !p.isBot);
      if (playersWithChips.length < 2 || !humansSeated) {
        // Game over: save results and send everyone back to the waiting room.
        manager.endGame(room);
        const { smallBlind, bigBlind } = room.table;
        room.table = new Table({ smallBlind, bigBlind });
        attachTableEvents(room);
        broadcastRoom(room);
        return;
      }
      try {
        room.table.startHand();
      } catch {
        // Not enough players right now; wait for host to restart.
      }
      broadcastRoom(room);
    }, NEXT_HAND_DELAY_MS);
  }

  // A socket's room is whichever room the user is in, so a page refresh or
  // second connection picks the game back up.
  function roomFor(userId) {
    return manager.findRoomForUser(userId);
  }

  io.on('connection', (socket) => {
    const userId = socket.userId;
    if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
    socketsByUser.get(userId).add(socket);

    // Normalize every event to (payloadObject, ackFunction) so a malformed
    // client message can't throw inside a handler and take the server down.
    socket.use((packet, next) => {
      const ack = typeof packet[packet.length - 1] === 'function' ? packet.pop() : () => {};
      const payload = packet[1] && typeof packet[1] === 'object' ? packet[1] : {};
      packet.length = 1;
      packet.push(payload, ack);
      next();
    });

    socket.on('whoami', (_payload, ack) => {
      const user = db.getUserById(userId);
      const room = roomFor(userId);
      ack?.({
        ok: true,
        user: { id: user.id, username: db.displayName(user), accountName: user.username, bankroll: user.bankroll },
        currentRoom: room ? room.code : null,
      });
    });

    socket.on('listRooms', (_payload, ack) => {
      ack?.({ rooms: manager.listOpenRooms() });
    });

    // Display names always come from the database, never from the client payload.
    const nameOf = () => db.displayName(db.getUserById(userId));

    socket.on('setName', ({ name } = {}, ack) => {
      const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
      if (!/^[\p{L}\p{N} _.'-]{2,20}$/u.test(clean)) {
        return ack?.({ ok: false, error: 'Use 2-20 letters, numbers, spaces or _ . - characters.' });
      }
      db.setDisplayName(userId, clean);
      // Carry the new name into any room this player is already sitting in.
      const room = roomFor(userId);
      if (room) {
        const entry = room.lobby.get(userId);
        if (entry) entry.username = clean;
        const seat = room.table.seats.find((s) => s && s.userId === userId);
        if (seat) seat.username = clean;
        if (room.hostUserId === userId) room.hostUsername = clean;
        broadcastRoom(room);
      }
      ack?.({ ok: true, name: clean });
    });

    socket.on('createRoom', ({ buyIn, smallBlind, bigBlind } = {}, ack) => {
      try {
        if (roomFor(userId)) throw new Error('Leave your current room first.');
        const sb = Math.max(1, Math.floor(Number(smallBlind)) || 5);
        const bb = Math.max(sb * 2, Math.floor(Number(bigBlind)) || 10);
        const room = manager.createRoom(userId, nameOf(), { smallBlind: sb, bigBlind: bb });
        room.addToLobby(userId, nameOf(), Math.max(1, Math.floor(Number(buyIn)) || 1000));
        attachTableEvents(room);
        ack?.({ ok: true, code: room.code });
        broadcastRoom(room);
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('joinRoom', ({ code, buyIn } = {}, ack) => {
      const room = manager.getRoom(code);
      if (!room) return ack?.({ ok: false, error: 'Room not found.' });
      const current = roomFor(userId);
      if (current && current !== room) return ack?.({ ok: false, error: 'Leave your current room first.' });
      if (room.lobby.has(userId)) {
        ack?.({ ok: true, code: room.code });
        return broadcastRoom(room);
      }
      if (room.table.phase !== 'waiting') return ack?.({ ok: false, error: 'Game already in progress.' });
      room.addToLobby(userId, nameOf(), Math.max(1, Math.floor(Number(buyIn)) || 1000));
      ack?.({ ok: true, code: room.code });
      broadcastRoom(room);
    });

    socket.on('resync', (_payload, ack) => {
      const room = roomFor(userId);
      ack?.({ ok: true, code: room ? room.code : null });
      if (room) broadcastRoom(room);
    });

    socket.on('setBuyIn', ({ userId: targetUserId, buyIn }, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can set buy-ins.' });
      if (room.table.phase !== 'waiting') return ack?.({ ok: false, error: 'Game already started.' });
      const info = room.lobby.get(targetUserId);
      if (!info) return ack?.({ ok: false, error: 'Player not in lobby.' });
      info.buyIn = Math.max(1, Math.floor(Number(buyIn)) || info.buyIn);
      ack?.({ ok: true });
      broadcastRoom(room);
    });

    socket.on('addBot', ({ buyIn, level } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can add bots.' });
      if (room.table.phase !== 'waiting') return ack?.({ ok: false, error: 'Game already started.' });
      if (room.lobby.size >= room.table.maxSeats) return ack?.({ ok: false, error: 'Table is full.' });
      const taken = [...room.lobby.values()].map((p) => p.username);
      const seatedBuyIn = Math.max(1, Math.floor(Number(buyIn)) || room.lobby.get(userId)?.buyIn || 1000);
      const botLevel = bot.normalizeLevel(level);
      room.addToLobby(bot.makeBotId(), bot.pickBotName(taken, botLevel), seatedBuyIn, true, botLevel);
      ack?.({ ok: true });
      broadcastRoom(room);
    });

    socket.on('removePlayer', ({ userId: targetUserId } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can remove players.' });
      if (room.table.phase !== 'waiting') return ack?.({ ok: false, error: 'Game already started.' });
      if (targetUserId === userId) return ack?.({ ok: false, error: 'Use Leave to exit the room.' });
      room.removeFromLobby(targetUserId);
      ack?.({ ok: true });
      broadcastRoom(room);
    });

    socket.on('startGame', (_payload, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can start the game.' });
      try {
        manager.startGame(room);
        ack?.({ ok: true });
        broadcastRoom(room);
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('action', ({ type, amount }, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      try {
        // Hand-end bookkeeping happens via the table's 'handEnded' event.
        room.table.applyAction(userId, type, Math.floor(Number(amount)) || 0);
        ack?.({ ok: true });
        broadcastRoom(room);
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // "I'm looking at my cards" — shown to everyone else as a tell only; no
    // card data is ever sent with it.
    socket.on('peek', ({ on } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: true });
      if (room.table.setPeeking(userId, !!on)) broadcastRoom(room);
      ack?.({ ok: true });
    });

    socket.on('leaveRoom', (_payload, ack) => {
      const room = roomFor(userId);
      if (room) {
        room.removeFromLobby(userId);
        room.table.removePlayer(userId);
        broadcastRoom(room);
        // Once the last human is gone the room (and its bots) is finished.
        const humansLeft =
          [...room.lobby.keys()].some((id) => id > 0) ||
          room.table.seats.some((s) => s && !s.left && !s.isBot);
        if (!humansLeft) {
          clearTimeout(room.turnTimer);
          clearTimeout(room.handTimer);
          manager.removeRoom(room.code);
        }
      }
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      const set = socketsByUser.get(userId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) {
          socketsByUser.delete(userId);
          const room = roomFor(userId);
          if (room?.table.setPeeking(userId, false)) broadcastRoom(room);
        }
      }
    });
  });

  return manager;
}

module.exports = { attachSockets };
