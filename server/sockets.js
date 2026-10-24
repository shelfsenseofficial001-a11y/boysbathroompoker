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
    const everyone = room.members();
    for (const userId of everyone) {
      const sockets = socketsByUser.get(userId);
      if (!sockets) continue;
      const payload = {
        code: room.code,
        hostUserId: room.hostUserId,
        lobby: [...room.lobby.entries()].map(([uid, info]) => ({ userId: uid, ...info })),
        table: room.table.getPublicState(userId),
        // Only the people who played it are shown a game's result: someone
        // who walked in afterwards has no stake in a hand they never saw.
        gameOver: room.gameOver?.participants.includes(userId) ? room.gameOver : null,
        joinChips: room.lateJoinChips(),
        isPrivate: room.isPrivate,
        spectators: room.spectatorList(),
        // Whether this viewer is watching, and whether there's a chair for
        // them to take if they are.
        watching: room.spectators.has(userId),
        seatsFree: Math.max(0, room.table.maxSeats - room.seatHolders()),
        // Only the host is asked to answer the door, so only the host is told
        // who is standing at it.
        knocks: userId === room.hostUserId
          ? [...room.knocks.entries()].map(([uid, username]) => ({ userId: uid, username }))
          : [],
        turn,
      };
      for (const s of sockets) s.emit('roomState', payload);
    }
  }

  function scheduleNextHand(room) {
    manager.recordHandResult(room);
    clearTimeout(room.handTimer);
    room.handTimer = setTimeout(() => startNextHand(room), NEXT_HAND_DELAY_MS);
  }

  // Deals the next hand, or ends the game if there's no longer one to play.
  // Called on the timer above, and straight away once everybody still at the
  // table has skipped past the last hand's result.
  function startNextHand(room) {
    clearTimeout(room.handTimer);
    room.handTimer = null;
    retireBustedPlayers(room);
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
        hands: room.table.handNumber,
        // Whoever was in the room for it. A player who arrives later is sent
        // no result at all rather than a celebration for a game they missed.
        participants: [...room.members()],
      };
      manager.endGame(room);
      // Everyone who busted out is back in the waiting room for the next game.
      room.spectators.clear();
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
  }

  // Out of chips is out of the game: the seat is given up before the next
  // deal so the table isn't padded with empty stacks. They stay in the room
  // to watch and talk, and the next game deals them back in.
  function retireBustedPlayers(room) {
    for (const p of room.table.seats) {
      if (!p || p.left || p.chips > 0) continue;
      const { userId: uid, username, isBot } = p;
      room.table.removePlayer(uid);
      if (isBot) {
        room.removeFromLobby(uid); // nobody to watch on a bot's behalf
        announce(room, `${username} is out of chips and left the table.`);
        continue;
      }
      // Their own client asks them whether to stay and watch or go, so the
      // only thing to say here is to everybody else.
      room.spectators.set(uid, 'bust');
      announce(room, `${username} is out of chips and is now watching.`, uid);
    }
  }

  // Nudges everyone sitting in the lobby to re-read the open-tables list.
  // Cheap to send and it keeps the list honest the moment a room appears,
  // fills up, starts, goes private or closes.
  const roomsChanged = () => io.emit('roomsChanged');

  // Tells the room where every open vote stands, so each client can show the
  // toast and count without asking.
  function voteState(room, { closed = null } = {}) {
    const open = [];
    for (const [target, votes] of room.kickVotes) {
      const live = room.voters(target);
      for (const id of [...votes]) if (!live.has(id)) votes.delete(id);
      if (!votes.size) continue;
      const name = room.lobby.get(target)?.username
        || room.table.seats.find((p) => p && p.userId === target)?.username
        || 'Player';
      const keeps = room.keepVotes.get(target) || new Set();
      open.push({
        userId: target,
        name,
        votes: votes.size,
        needed: room.votesNeeded(target),
        voters: [...votes],
        keepers: [...keeps],
      });
    }
    const members = room.members();
    for (const id of members) {
      for (const sock of socketsByUser.get(id) || []) sock.emit('votes', { open, closed });
    }
  }

  // Pushes the whole backlog to everyone in the room. Used when the stored
  // messages themselves change, which only renaming does.
  function broadcastChatHistory(room) {
    const members = room.members();
    for (const id of members) {
      for (const s of socketsByUser.get(id) || []) {
        s.emit('chatHistory', { code: room.code, messages: room.chat });
      }
    }
  }

  // A line of table news for everyone still in the room: who joined, who
  // left. `except` skips the player it's about, who already knows.
  function announce(room, text, except = null) {
    const skip = new Set(Array.isArray(except) ? except : [except]);
    for (const id of room.members()) {
      if (skip.has(id)) continue;
      for (const s of socketsByUser.get(id) || []) s.emit('notice', { text });
    }
  }

  // A line meant for one person in particular, alongside whatever the rest
  // of the room is being told.
  function tell(uid, text) {
    for (const s of socketsByUser.get(uid) || []) s.emit('notice', { text });
  }

  // Shuts a room down for everyone in it. The clients are told why, because
  // no further roomState will arrive and they'd otherwise sit on a table
  // that no longer exists.
  function closeRoom(room, reason) {
    clearTimeout(room.turnTimer);
    clearTimeout(room.handTimer);
    manager.endGame(room);
    const members = room.members();
    manager.removeRoom(room.code);
    roomsChanged();
    for (const id of members) {
      for (const s of socketsByUser.get(id) || []) s.emit('roomClosed', { code: room.code, reason });
    }
  }

  // A socket's room is whichever room the user is in, so a page refresh or
  // second connection picks the game back up.
  function roomFor(userId) {
    return manager.findRoomForUser(userId);
  }

  // Puts someone who is allowed in into the room, whether they walked into a
  // public table or the host just opened the door of a private one. Returns
  // what the joiner's client needs to know, or why they can't come in.
  function admit(room, uid, username) {
    if (room.blocked.has(uid)) return { ok: false, error: 'The host has blocked them from this room.' };
    if (room.nameTaken(username, uid)) {
      return { ok: false, error: 'Someone in that room already uses that name.' };
    }
    // Walking in on a game already under way: the host's stake applies, not
    // whatever the joiner typed, and they wait for the current hand to finish
    // rather than being dealt into the middle of one.
    if (room.table.phase !== 'waiting') {
      if (room.table.seats.every((seat) => seat !== null) || room.lobby.size >= room.table.maxSeats) {
        return { ok: false, error: 'That table is full.' };
      }
      const chips = room.lateJoinChips();
      room.addToLobby(uid, username, chips);
      room.table.addLatePlayer(uid, username, chips);
      announce(room, `${username} joined — in from the next hand.`, uid);
      return { ok: true, code: room.code, chips, waiting: true };
    }
    if (room.lobby.size >= room.table.maxSeats) return { ok: false, error: 'That room is full.' };
    // Before the game starts everyone is on the table's stake, which is the
    // host's own figure — not the separate one set aside for late joiners.
    const stake = room.lobby.get(room.hostUserId)?.buyIn;
    room.addToLobby(uid, username, stake > 0 ? stake : 1000);
    announce(room, `${username} joined the room.`, uid);
    return { ok: true, code: room.code };
  }

  // A seat taken but not yet dealt in is only a place in the queue, so going
  // offline gives it back: nobody wants a hand dealt to a chair that emptied
  // while the last one was still being played. Anyone already in the hand
  // keeps their seat - their chips are in the pot, and a refresh must not
  // cost them that. Giving the seat up puts them back to watching, which is
  // where taking it found them.
  function releaseQueuedSeat(room, uid) {
    const p = room.table.seats.find((s) => s && s.userId === uid && !s.left);
    if (!p || !p.sittingOut) return false;
    // The chair empties outright: held as a folded seat it would keep saying
    // the hand was theirs until the next deal.
    if (!room.table.releaseSeat(uid)) return false;
    if (room.lobby.has(uid)) room.spectators.set(uid, 'watching');
    announce(room, `${p.username} is no longer taking a seat.`, uid);
    roomsChanged(); // a seat has come free again
    return true;
  }

  // Drops anyone who is waiting at a door they've walked away from.
  function clearKnock(uid) {
    for (const room of manager.rooms.values()) {
      if (room.knocks.delete(uid)) broadcastRoom(room);
    }
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
        // Past messages are shown under whatever the player is called now,
        // so the chat doesn't keep addressing them by a name they've dropped.
        let renamed = false;
        for (const m of room.chat) {
          if (m.userId === userId && m.name !== clean) {
            m.name = clean;
            renamed = true;
          }
        }
        if (renamed) broadcastChatHistory(room);
        broadcastRoom(room);
      }
      ack?.({ ok: true, name: clean });
    });

    socket.on('createRoom', ({ buyIn, smallBlind, bigBlind, isPrivate } = {}, ack) => {
      try {
        if (roomFor(userId)) throw new Error('Leave your current room first.');
        const sb = Math.max(1, Math.floor(Number(smallBlind)) || 5);
        const bb = Math.max(sb * 2, Math.floor(Number(bigBlind)) || 10);
        const room = manager.createRoom(userId, nameOf(), { smallBlind: sb, bigBlind: bb, isPrivate: !!isPrivate });
        room.addToLobby(userId, nameOf(), Math.max(1, Math.floor(Number(buyIn)) || 1000));
        attachTableEvents(room);
        ack?.({ ok: true, code: room.code });
        broadcastRoom(room);
        roomsChanged();
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('joinRoom', ({ code, buyIn, fromList } = {}, ack) => {
      const room = manager.getRoom(code);
      if (!room) return ack?.({ ok: false, error: 'Room not found.' });
      if (room.blocked.has(userId)) {
        return ack?.({ ok: false, error: 'The host has blocked you from this room.' });
      }
      // The open-tables list only ever shows public rooms. A click on an entry
      // that has since gone private is refused, unless they're already in it;
      // the code itself still works for the people the host gave it to.
      if (fromList && room.isPrivate && !room.lobby.has(userId)) {
        roomsChanged();
        return ack?.({ ok: false, error: 'That room has gone private — ask the host for the code.' });
      }
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
      // The code only gets you as far as the door of a private room: the host
      // decides who actually comes in.
      if (room.isPrivate && userId !== room.hostUserId) {
        room.knocks.set(userId, nameOf());
        ack?.({ ok: true, code: room.code, knocking: true });
        return broadcastRoom(room);
      }
      const res = admit(room, userId, nameOf());
      ack?.(res);
      if (!res.ok) return;
      broadcastRoom(room);
      roomsChanged();
    });

    // Pulling up a chair behind the table rather than at it: you see the
    // hands play out and can talk, but take no seat and stake no chips. The
    // next game deals you in like anyone else waiting in the room.
    socket.on('spectateRoom', ({ code } = {}, ack) => {
      const room = manager.getRoom(code);
      if (!room) return ack?.({ ok: false, error: 'Room not found.' });
      const current = roomFor(userId);
      if (current === room) return ack?.({ ok: true, code: room.code });
      if (current) return ack?.({ ok: false, error: 'Leave your current room first.' });
      // Before the deal there's nothing to watch, and a seat is free anyway.
      if (room.table.phase === 'waiting') {
        return ack?.({ ok: false, error: 'That game hasn’t started yet — join it instead.' });
      }
      // A private room's door is the host's to answer, for watchers too.
      if (room.isPrivate && userId !== room.hostUserId) {
        return ack?.({ ok: false, error: 'That room is private — ask the host for the code.' });
      }
      // No seat check: a watcher takes no chair, so a full table is still
      // worth watching.
      if (room.blocked.has(userId)) {
        return ack?.({ ok: false, error: 'The host has blocked you from this room.' });
      }
      const username = nameOf();
      if (room.nameTaken(username, userId)) {
        return ack?.({ ok: false, error: 'Someone in that room already uses your name — change yours and try again.' });
      }
      room.addToLobby(userId, username, room.lateJoinChips());
      room.spectators.set(userId, 'watching');
      announce(room, `${username} is watching.`, userId);
      ack?.({ ok: true, code: room.code, spectating: true });
      broadcastRoom(room);
      roomsChanged();
    });

    // The host answering the door of their private room.
    socket.on('answerKnock', ({ userId: target, allow } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can let people in.' });
      const uid = Number(target);
      const knocked = room.knocks.get(uid);
      if (knocked === undefined) return ack?.({ ok: false, error: 'They’re not waiting any more.' });
      room.knocks.delete(uid);
      const tell = (payload) => {
        for (const s of socketsByUser.get(uid) || []) s.emit('knockAnswered', payload);
      };
      if (!allow) {
        tell({ ok: false, code: room.code, error: 'The host didn’t let you in.' });
        ack?.({ ok: true });
        return broadcastRoom(room);
      }
      const fresh = db.getUserById(uid);
      // They didn't wait: by now they're sat somewhere else, and nobody can
      // be in two rooms at once.
      const elsewhere = roomFor(uid);
      const res = elsewhere && elsewhere !== room
        ? { ok: false, error: `${knocked} has joined another room.` }
        : admit(room, uid, fresh ? db.displayName(fresh) : knocked);
      tell({ ...res, code: room.code });
      ack?.(res.ok ? { ok: true } : res);
      broadcastRoom(room);
      roomsChanged();
    });

    // They gave up waiting, or went back to the lobby.
    socket.on('cancelKnock', (_payload, ack) => {
      clearKnock(userId);
      ack?.({ ok: true });
    });

    const sendChatHistory = (room) => socket.emit('chatHistory', { code: room.code, messages: room.chat });

    socket.on('resync', (_payload, ack) => {
      const room = roomFor(userId);
      ack?.({ ok: true, code: room ? room.code : null });
      if (room) {
        sendChatHistory(room);
        voteState(room);
        broadcastRoom(room);
      }
    });

    socket.on('chat', ({ text, replyTo } = {}, ack) => {
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
      // replyTo is stored as an id, not a copy of the quoted text: that way an
      // edited or deleted original updates everywhere it's quoted.
      const replyId = Number(replyTo);
      const entry = {
        id: ++chatSeq,
        userId,
        name: nameOf(),
        text: clean,
        at: now,
        replyTo: room.chat.some((m) => m.id === replyId) ? replyId : null,
        editedAt: null,
        deleted: false,
        // Said from the rail rather than the table, which the bubble shows.
        spectator: room.spectators.has(userId),
      };
      room.addChat(entry);
      const members = room.members();
      for (const id of members) {
        for (const sock of socketsByUser.get(id) || []) sock.emit('chat', entry);
      }
      ack?.({ ok: true });
    });

    // One stake for the whole table: everyone starts the game on the same
    // stack, so there's a single figure to set rather than one per player.
    socket.on('setStartingChips', ({ chips } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can set the stakes.' });
      if (room.table.phase !== 'waiting') return ack?.({ ok: false, error: 'Game already started.' });
      const n = Math.floor(Number(chips));
      if (!Number.isFinite(n) || n < 1) return ack?.({ ok: false, error: 'Enter a chip amount of 1 or more.' });
      for (const info of room.lobby.values()) info.buyIn = n;
      ack?.({ ok: true, chips: n });
      broadcastRoom(room);
    });

    // Blinds can be retuned between games, never mid-hand: the stakes a hand
    // started under are the stakes it finishes under.
    socket.on('setBlinds', ({ smallBlind, bigBlind } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can set the blinds.' });
      if (room.table.phase !== 'waiting') return ack?.({ ok: false, error: 'Wait until the hand is over.' });
      const sb = Math.floor(Number(smallBlind));
      const bb = Math.floor(Number(bigBlind));
      if (!Number.isFinite(sb) || sb < 1) return ack?.({ ok: false, error: 'Small blind must be 1 or more.' });
      if (!Number.isFinite(bb) || bb <= sb) return ack?.({ ok: false, error: 'Big blind must be larger than the small blind.' });
      room.table.smallBlind = sb;
      room.table.bigBlind = bb;
      room.table.minRaise = bb;
      ack?.({ ok: true, smallBlind: sb, bigBlind: bb });
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

    // Only the author may change their own message, and only the text: the
    // author, the time and the thread it sits in are not theirs to rewrite.
    const ownMessage = (room, id) => {
      const m = room.chat.find((x) => x.id === Number(id));
      if (!m) return { error: 'That message is no longer here.' };
      if (m.userId !== userId) return { error: 'You can only change your own messages.' };
      if (m.deleted) return { error: 'That message was already deleted.' };
      return { m };
    };

    const sendChatUpdate = (room, entry) => {
      const members = room.members();
      for (const id of members) {
        for (const sock of socketsByUser.get(id) || []) sock.emit('chatUpdate', entry);
      }
    };

    // An open vote: anyone in the room can call one on anyone else, and a
    // strict majority of the other players carries it. The host isn't special
    // here - a host who misbehaves can be voted out like anyone.
    socket.on('voteKick', ({ userId: targetUserId } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      const target = Number(targetUserId);
      if (target === userId) return ack?.({ ok: false, error: 'Use Leave to exit the room.' });
      const inRoom =
        room.lobby.has(target) || room.table.seats.some((p) => p && p.userId === target && !p.left);
      if (!inRoom) return ack?.({ ok: false, error: 'That player has already gone.' });
      if (target < 0) return ack?.({ ok: false, error: 'Ask the host to remove a bot.' });
      // The room belongs to the host: voting them out would leave everyone in
      // a table nobody can manage.
      if (target === room.hostUserId) return ack?.({ ok: false, error: 'The host can’t be voted out of their own room.' });
      if (!room.voters(target).has(userId)) return ack?.({ ok: false, error: 'You can’t vote here.' });

      let votes = room.kickVotes.get(target);
      if (!votes) {
        votes = new Set();
        room.kickVotes.set(target, votes);
      }
      if (votes.has(userId)) return ack?.({ ok: false, error: 'You have already voted.' });
      votes.add(userId);
      room.keepVotes.get(target)?.delete(userId);

      const name = room.lobby.get(target)?.username
        || room.table.seats.find((p) => p && p.userId === target)?.username
        || 'That player';
      const needed = room.votesNeeded(target);
      // Stale votes from people who have since left would make the bar
      // impossible to reach, so only live voters count.
      const live = room.voters(target);
      for (const id of [...votes]) if (!live.has(id)) votes.delete(id);

      if (votes.size >= needed) {
        room.kickVotes.delete(target);
        room.keepVotes.delete(target);
        room.spectators.delete(target);
        room.removeFromLobby(target);
        room.table.removePlayer(target);
        for (const sock of socketsByUser.get(target) || []) {
          sock.emit('kicked', { code: room.code, reason: 'The table voted to remove you.' });
        }
        announce(room, `${name} was voted out of the room.`, target);
        voteState(room, { closed: target });
        ack?.({ ok: true, passed: true });
        return broadcastRoom(room);
      }
      ack?.({ ok: true, passed: false, votes: votes.size, needed });
      voteState(room);
    });

    // Voting to keep someone. Enough of these and the kick can no longer
    // reach a majority, so the vote is called off rather than left hanging.
    socket.on('voteKeep', ({ userId: targetUserId } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      const target = Number(targetUserId);
      if (!room.kickVotes.has(target)) return ack?.({ ok: false, error: 'There is no vote to answer.' });
      if (!room.voters(target).has(userId)) return ack?.({ ok: false, error: 'You can’t vote here.' });
      let keeps = room.keepVotes.get(target);
      if (!keeps) {
        keeps = new Set();
        room.keepVotes.set(target, keeps);
      }
      if (keeps.has(userId)) return ack?.({ ok: false, error: 'You have already voted.' });
      keeps.add(userId);
      room.kickVotes.get(target)?.delete(userId);

      const live = room.voters(target);
      const needed = room.votesNeeded(target);
      const stillPossible = live.size - keeps.size >= needed;
      if (!stillPossible) {
        room.kickVotes.delete(target);
        room.keepVotes.delete(target);
        const name = room.lobby.get(target)?.username
          || room.table.seats.find((p) => p && p.userId === target)?.username
          || 'That player';
        announce(room, `The table voted to keep ${name}.`);
      }
      voteState(room);
      ack?.({ ok: true, cancelled: !stillPossible });
    });

    socket.on('chatEdit', ({ id, text } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      const { m, error } = ownMessage(room, id);
      if (error) return ack?.({ ok: false, error });
      const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
      if (!clean) return ack?.({ ok: false, error: 'Type something, or delete the message instead.' });
      m.text = clean;
      m.editedAt = Date.now();
      sendChatUpdate(room, m);
      ack?.({ ok: true });
    });

    socket.on('chatDelete', ({ id } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      const { m, error } = ownMessage(room, id);
      if (error) return ack?.({ ok: false, error });
      // Kept as a tombstone rather than spliced out, so replies pointing at
      // it still have something to say.
      m.deleted = true;
      m.text = '';
      sendChatUpdate(room, m);
      ack?.({ ok: true });
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

    // Handing the room over. The room belongs to whoever holds it - they can
    // start hands, set the stakes, answer a private room's door, and closing
    // it is theirs to do - so this is a real change of hands, not a label.
    socket.on('transferHost', ({ userId: targetUserId } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the owner can hand the room over.' });
      const uid = Number(targetUserId);
      if (uid === userId) return ack?.({ ok: false, error: 'You already own this room.' });
      const info = room.lobby.get(uid);
      const seat = room.table.seats.find((p) => p && p.userId === uid && !p.left);
      if (!info && !seat) return ack?.({ ok: false, error: 'That player has already gone.' });
      // Nobody is at the keyboard for a bot, so a room handed to one could
      // never be started, managed or closed again.
      if (uid < 0 || info?.isBot || seat?.isBot) return ack?.({ ok: false, error: 'A bot can’t own the room.' });

      const name = info?.username || seat?.username || 'Player';
      const before = nameOf();
      room.hostUserId = uid;
      room.hostUsername = name;
      // The owner can't be voted out, so any vote already running against
      // them stops the moment they take the room over.
      room.kickVotes.delete(uid);
      room.keepVotes.delete(uid);
      announce(room, `${before} made ${name} the room owner.`, [uid, userId]);
      tell(uid, `${before} made you the room owner.`);
      tell(userId, `${name} owns the room now.`);
      ack?.({ ok: true });
      voteState(room, { closed: uid });
      broadcastRoom(room);
      roomsChanged(); // the open-tables list names the host
    });

    socket.on('removePlayer', ({ userId: targetUserId } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can remove players.' });
      if (room.table.phase !== 'waiting') return ack?.({ ok: false, error: 'Game already started.' });
      if (targetUserId === userId) return ack?.({ ok: false, error: 'Use Leave to exit the room.' });
      if (!room.lobby.has(targetUserId)) return ack?.({ ok: false, error: 'Player not in this room.' });
      const removedName = room.lobby.get(targetUserId).username;
      room.spectators.delete(targetUserId);
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
        roomsChanged();
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

    // A watcher pulling up a chair. There's no seat to take mid-hand, so
    // they're dealt in from the next one, on the host's late-join stake.
    socket.on('takeSeat', (_payload, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (!room.spectators.has(userId)) return ack?.({ ok: false, error: 'You already have a seat.' });
      if (room.isFull()) return ack?.({ ok: false, error: 'Every seat is taken.' });
      const chips = room.lateJoinChips();
      const info = room.lobby.get(userId);
      room.spectators.delete(userId);
      if (info) info.buyIn = chips;
      if (room.table.phase !== 'waiting') room.table.addLatePlayer(userId, nameOf(), chips);
      ack?.({ ok: true, chips });
      announce(room, `${nameOf()} is taking a seat.`, userId);
      broadcastRoom(room);
      roomsChanged();
    });

    // The host clearing a watcher out. Blocking also bars them from coming
    // back, as a player or a watcher, for as long as the room lives.
    socket.on('removeSpectator', ({ userId: targetUserId, block } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can do that.' });
      const target = Number(targetUserId);
      if (target === userId) return ack?.({ ok: false, error: 'Use Leave to exit the room.' });
      if (!room.spectators.has(target)) return ack?.({ ok: false, error: 'They aren’t watching.' });
      const who = room.lobby.get(target)?.username || 'Someone';
      room.spectators.delete(target);
      room.removeFromLobby(target);
      room.table.removePlayer(target);
      if (block) room.blocked.add(target);
      for (const s of socketsByUser.get(target) || []) {
        s.emit('kicked', {
          code: room.code,
          reason: block ? 'The host has blocked you from this room.' : 'The host removed you from the room.',
        });
      }
      ack?.({ ok: true });
      announce(room, `${who} is no longer watching.`, userId);
      broadcastRoom(room);
      roomsChanged();
    });

    // Turning your cards over for the table after the hand. Nobody is ever
    // made to: it's asked for, and it only counts for the hand just played.
    socket.on('showCards', (_payload, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (!room.table.showHand(userId)) {
        return ack?.({ ok: false, error: 'There are no cards of yours to show.' });
      }
      ack?.({ ok: true });
      announce(room, `${nameOf()} showed their hand.`, userId);
      broadcastRoom(room);
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
        room.spectators.delete(userId);
        room.kickVotes.delete(userId); // no vote survives its target leaving
        room.keepVotes.delete(userId);
        for (const votes of room.kickVotes.values()) votes.delete(userId);
        for (const keeps of room.keepVotes.values()) keeps.delete(userId);
        room.removeFromLobby(userId);
        // Somebody with nothing in the hand - queued for the next one, or
        // between hands - gives the chair straight back. Only a seat with
        // chips in the pot has to be held, folded, until the deal is over.
        if (!room.table.releaseSeat(userId)) room.table.removePlayer(userId);
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
          clearKnock(userId);
          const room = roomFor(userId);
          if (!room) return;
          const gaveUpSeat = releaseQueuedSeat(room, userId);
          const peekOff = room.table.setPeeking(userId, false);
          if (gaveUpSeat || peekOff) broadcastRoom(room);
        }
      }
    });
  });

  return manager;
}

module.exports = { attachSockets };
