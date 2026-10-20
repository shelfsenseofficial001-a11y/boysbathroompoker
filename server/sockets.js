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

const CHAT_MAX_LEN = 240;
const CHAT_MIN_GAP_MS = 600; // one message per user per this long

function attachSockets(io, sessionMiddleware) {
  const manager = new GameManager();
  const lastChatAt = new Map(); // userId -> when they last spoke
  let chatSeq = 0;
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
        gameOver: room.gameOver,
        joinChips: room.lateJoinChips(),
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
        // The standings are copied off the table first, because the table is
        // replaced below and the winner would go with it.
        const standings = room.table.seats
          .filter((p) => p && !p.left)
          .map((p) => ({ userId: p.userId, username: p.username, chips: p.chips, isBot: !!p.isBot }))
          .sort((a, b) => b.chips - a.chips);
        room.gameOver = {
          winner: standings[0] || null,
          standings,
          hands: room.table.handNumber,
        };
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

  // A line of table news for everyone still in the room: who joined, who
  // left. `except` skips the player it's about, who already knows.
  function announce(room, text, except = null) {
    const members = new Set([
      ...room.lobby.keys(),
      ...room.table.seats.filter(Boolean).map((p) => p.userId),
    ]);
    for (const id of members) {
      if (id === except) continue;
      for (const s of socketsByUser.get(id) || []) s.emit('notice', { text });
    }
  }

  // Shuts a room down for everyone in it. The clients are told why, because
  // no further roomState will arrive and they'd otherwise sit on a table
  // that no longer exists.
  function closeRoom(room, reason) {
    clearTimeout(room.turnTimer);
    clearTimeout(room.handTimer);
    manager.endGame(room);
    const members = new Set([
      ...room.lobby.keys(),
      ...room.table.seats.filter(Boolean).map((p) => p.userId),
    ]);
    manager.removeRoom(room.code);
    for (const id of members) {
      for (const s of socketsByUser.get(id) || []) s.emit('roomClosed', { code: room.code, reason });
    }
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
      // Two players answering to the same name at one table makes the action
      // log and the history unreadable, so a name already in use here is
      // refused. Case-insensitive, because "Sam" and "sam" read as one name.
      const room = roomFor(userId);
      if (room && room.nameTaken(clean, userId)) {
        return ack?.({ ok: false, error: `Someone at this table is already called ${clean}.` });
      }
      db.setDisplayName(userId, clean);
      // Carry the new name into any room this player is already sitting in.
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
      // Same rule as renaming: no two players at one table share a name.
      if (room.nameTaken(nameOf(), userId)) {
        return ack?.({ ok: false, error: 'Someone in that room already uses your name — change yours and try again.' });
      }
      // Walking in on a game already under way: the host's stake applies, not
      // whatever the joiner typed, and they wait for the current hand to
      // finish rather than being dealt into the middle of one.
      if (room.table.phase !== 'waiting') {
        if (room.table.seats.every((seat) => seat !== null) || room.lobby.size >= room.table.maxSeats) {
          return ack?.({ ok: false, error: 'That table is full.' });
        }
        const chips = room.lateJoinChips();
        room.addToLobby(userId, nameOf(), chips);
        room.table.addLatePlayer(userId, nameOf(), chips);
        announce(room, `${nameOf()} joined — in from the next hand.`, userId);
        ack?.({ ok: true, code: room.code, chips, waiting: true });
        return broadcastRoom(room);
      }
      if (room.lobby.size >= room.table.maxSeats) {
        return ack?.({ ok: false, error: 'That room is full.' });
      }
      room.addToLobby(userId, nameOf(), Math.max(1, Math.floor(Number(buyIn)) || 1000));
      ack?.({ ok: true, code: room.code });
      broadcastRoom(room);
    });

    const sendChatHistory = (room) => socket.emit('chatHistory', { code: room.code, messages: room.chat });

    socket.on('resync', (_payload, ack) => {
      const room = roomFor(userId);
      ack?.({ ok: true, code: room ? room.code : null });
      if (room) {
        sendChatHistory(room);
        broadcastRoom(room);
      }
    });

    socket.on('chat', ({ text } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      // Bots hold negative ids and have no socket to speak through, so this
      // can't fire for one. Stated outright so it stays that way: the table
      // talk is between the people at it.
      if (userId < 0) return ack?.({ ok: false, error: 'Bots don’t chat.' });
      // Collapse whitespace so nobody can paste a wall of blank lines.
      const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
      if (!clean) return ack?.({ ok: false, error: 'Type something first.' });
      const now = Date.now();
      if (now - (lastChatAt.get(userId) || 0) < CHAT_MIN_GAP_MS) {
        return ack?.({ ok: false, error: 'One message at a time — give it a second.' });
      }
      lastChatAt.set(userId, now);
      // The name comes from the database, never from the client payload.
      const entry = { id: ++chatSeq, userId, name: nameOf(), text: clean, at: now };
      room.addChat(entry);
      const members = new Set([
        ...room.lobby.keys(),
        ...room.table.seats.filter(Boolean).map((p) => p.userId),
      ]);
      for (const id of members) {
        for (const sock of socketsByUser.get(id) || []) sock.emit('chat', entry);
      }
      ack?.({ ok: true });
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

    socket.on('setJoinChips', ({ chips } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can set that.' });
      const n = Math.floor(Number(chips));
      if (!Number.isFinite(n) || n < 1) return ack?.({ ok: false, error: 'Enter a chip amount of 1 or more.' });
      room.joinChips = n;
      ack?.({ ok: true, chips: n });
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
      if (!room.lobby.has(targetUserId)) return ack?.({ ok: false, error: 'Player not in this room.' });
      const removedName = room.lobby.get(targetUserId).username;
      room.removeFromLobby(targetUserId);
      room.table.removePlayer(targetUserId); // a late joiner holds a seat too
      // No further roomState reaches them, so without this they'd sit on a
      // waiting room they're no longer part of.
      for (const s of socketsByUser.get(targetUserId) || []) {
        s.emit('kicked', { code: room.code, reason: 'You have been kicked from the lobby.' });
      }
      announce(room, `${removedName} was removed from the room.`, targetUserId);
      ack?.({ ok: true });
      broadcastRoom(room);
    });

    socket.on('startGame', (_payload, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can start the game.' });
      try {
        room.gameOver = null; // a new game clears the last one's result
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
        // The host owns the room: when they walk, it goes with them rather
        // than leaving everyone in a table nobody can start or manage.
        if (room.hostUserId === userId) {
          closeRoom(room, 'The host left, so the room was closed.');
          return ack?.({ ok: true });
        }
        const who = nameOf();
        room.removeFromLobby(userId);
        room.table.removePlayer(userId);
        announce(room, `${who} left the game.`, userId);
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
