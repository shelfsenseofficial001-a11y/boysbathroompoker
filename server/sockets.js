// Wires Socket.io events to the GameManager/Table. All game logic stays on
// the server; sockets only relay validated actions and personalized state.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('./db');
const { verifyAccessToken, supabaseAuthEnabled } = require('./supabaseAuth');
const { getOrCreateSupabaseUser } = require('./identity');
const { DISPLAY_NAME_RE, usernameFromEmail, guestName } = require('../shared/displayName.mjs');
const { GuestBuffer } = require('./guestBuffer');
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
  db.createUser(name, hash);
  return db.getUserByUsername(name);
}

// Whether somebody with no account at all may sit down here.
//
// This game is meant to run on a laptop with no internet - that is most of
// what it is for - and an account server is not needed to deal cards. When
// there is none in reach the browser makes a guest for itself and the table
// takes it, which is the difference between a working evening and a landing
// page that says "couldn't reach the server".
//
// Open everywhere except a deployed build that has an auth server of its
// own: there, a guest is already offered through Supabase, which can rate
// limit what this cannot, and a door that mints a player row for every
// caller is one worth keeping shut. ALLOW_OFFLINE_GUESTS overrules either
// way, for a deployment that does want the open door.
const offlineGuestsAllowed =
  process.env.ALLOW_OFFLINE_GUESTS === 'true'
    ? true
    : process.env.ALLOW_OFFLINE_GUESTS === 'false'
      ? false
      : !(supabaseAuthEnabled && process.env.NODE_ENV === 'production');

// A guest this browser made for itself, with nothing verifying it.
//
// Keyed on the browser's own session id and not on a name, which is the
// whole of its safety: a name can be typed by anybody, and `getOrCreateGuest`
// below hands back whatever row already carries it - so a guest who picked
// their name would be wearing somebody else's the moment the names collided.
// The id is sixteen random bytes the browser keeps to itself (see
// lib/guestSession.js), so a row can only be returned to the tab that made
// it.
//
// Shaped exactly like the Supabase guest beside it: an account name derived
// from the id, and a generated `Guest####` for the table to show. Nothing
// about either is the browser's to choose.
function getOrCreateLocalGuest(sessionId) {
  if (!sessionId) return null;
  const username = `lg_${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16)}`;
  const existing = db.getUserByUsername(username);
  if (existing) return existing;
  const hash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 4);
  const id = db.createUser(username, hash);
  db.setDisplayName(id, guestName(id));
  return db.getUserByUsername(username);
}

function wrapSessionMiddleware(sessionMiddleware) {
  return (socket, next) => sessionMiddleware(socket.request, {}, next);
}

// The browser session a socket belongs to. The tab makes this once per
// browser session and keeps it in sessionStorage; it is half the key a
// guest's results are held under, and it is the half that stops a reopened
// browser - which still has the same anonymous token in localStorage - from
// claiming a session that has already ended.
//
// Length-capped and character-checked because it arrives from the client and
// ends up as a map key: an id is 1-64 of these or it is nothing.
const GUEST_SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
function guestSessionIdOf(socket) {
  const id = socket.handshake.auth?.guestSessionId;
  return typeof id === 'string' && GUEST_SESSION_RE.test(id) ? id : null;
}

// The handle this account's profile page is reached by, kept in step on
// every connect. Guests have none - they have no profile - and an account
// that has just renamed itself gets the new one here before the old one is
// read by anything.
function rememberHandle(player, claims) {
  const handle = claims.isAnonymous ? null : usernameFromEmail(claims.email);
  if ((player.handle || null) !== (handle || null)) db.setHandle(player.id, handle);
  player.handle = handle;
}

const CHAT_MAX_LEN = 240;
const CHAT_MIN_GAP_MS = 600; // one message per user per this long

function attachSockets(io, sessionMiddleware) {
  const manager = new GameManager();
  // A guest's finished matches, held for their browser session and written
  // to no database. See server/guestBuffer.js for why the key has two halves.
  const guestResults = new GuestBuffer();
  const lastChatAt = new Map(); // userId -> when they last spoke
  let chatSeq = 0;
  const socketsByUser = new Map(); // userId -> Set<socket>

  io.use(wrapSessionMiddleware(sessionMiddleware));

  io.use(async (socket, next) => {
    const userId = socket.request.session?.userId;
    if (userId) {
      socket.userId = userId;
      return next();
    }
    // A guest who signed in anonymously with Supabase. Verified here before
    // it is allowed to name anybody - see server/supabaseAuth.js.
    if (supabaseAuthEnabled) {
      const claims = await verifyAccessToken(socket.handshake.auth?.token);
      if (claims) {
        // The name comes out of the verified token, not out of the handshake
        // beside it. For an account the client's `name` is ignored entirely.
        const player = getOrCreateSupabaseUser(claims);
        if (player) {
          socket.userId = player.id;
          socket.healedName = player.healed ? player.display_name : null;
          // Both read off the verified token and never off the handshake
          // beside it. `isAnonymous` decides whether this player's results
          // are stored at all; `handle` is the name their profile page is
          // reached by, recovered from the synthetic address so a rename
          // follows them without this server being told.
          socket.isAnonymous = claims.isAnonymous === true;
          socket.supabaseId = claims.id;
          socket.guestSessionId = guestSessionIdOf(socket);
          rememberHandle(player, claims);
          if (socket.isAnonymous) guestResults.connected(claims.id, socket.guestSessionId);
          return next();
        }
      }
    }
    // TEMPORARY dev mode: each tab connects as its own guest player.
    if (process.env.SKIP_AUTH === 'true') {
      const guest = getOrCreateGuest(socket.handshake.auth?.guestName);
      if (guest) {
        socket.userId = guest.id;
        return next();
      }
    }
    // Nobody verified, and nobody to verify them: a guest the browser made
    // for itself because there was no auth server to ask. Last, so a real
    // token is always preferred to one of these - a player whose session
    // went stale is sent back to sign in rather than quietly becoming
    // somebody new with none of their chips.
    if (offlineGuestsAllowed && !socket.handshake.auth?.token) {
      const local = getOrCreateLocalGuest(guestSessionIdOf(socket));
      if (local) {
        socket.userId = local.id;
        socket.guestSessionId = guestSessionIdOf(socket);
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

  // Every seated account's public handle, for the "View profile" link on
  // their seat. Null for a guest and for a bot, which is what hides the link:
  // a guest has no profile page, and the seat menu has nowhere to point.
  //
  // Read once per broadcast rather than once per seat per viewer. A broadcast
  // goes out on every action at the table and to everyone in the room, so the
  // per-seat version of this was nine row reads multiplied by the size of the
  // room, several times a hand, to answer a question whose answer is the same
  // for all of them.
  // The account handle for everyone in the room, seated or still waiting.
  //
  // The waiting room lists people before any of them has a seat, and it draws
  // their faces - so the lobby has to be walked too, or a player's picture
  // appears only once the cards are out.
  function handlesFor(room) {
    const handles = new Map();
    const remember = (userId, isBot) => {
      if (isBot || userId <= 0 || handles.has(userId)) return;
      handles.set(userId, db.getUserById(userId)?.handle || null);
    };
    for (const p of room.table.seats) if (p) remember(p.userId, p.isBot);
    for (const [userId, info] of room.lobby) remember(userId, info.isBot);
    return handles;
  }

  // Offered to endGame for every human seat. Returns true when the result was
  // taken for a guest's session buffer, which is endGame's signal not to
  // write it anywhere. A guest whose browser sent no session id gets no
  // buffer and no row either: their match is simply not recorded, which is
  // the safe end of that failure rather than a row they never asked for.
  function bufferGuestResult(userId, result) {
    const sockets = [...(socketsByUser.get(userId) || [])];
    if (!sockets.length) return false;
    // Every socket, not the first one. A player with two tabs open who signs
    // up in one of them has an upgraded socket and a stale one, and reading
    // whichever happened to be first would decide a match's fate on the
    // order of a Set. Still a guest only if none of their connections has
    // become an account.
    if (!sockets.every((s) => s.isAnonymous)) return false;
    const socket = sockets[0];
    guestResults.append(socket.supabaseId, socket.guestSessionId, result);
    return true;
  }

  function endMatch(room) {
    manager.endGame(room, { onGuestResult: bufferGuestResult });
  }

  function broadcastRoom(room) {
    armTurnTimer(room);
    const handles = handlesFor(room);
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
        lobby: [...room.lobby.entries()].map(([uid, info]) => ({
          userId: uid,
          ...info,
          // So the waiting room can draw their picture, the same way a seat
          // does. Null for bots and for guests, who have no account to have
          // uploaded one.
          handle: handles.get(uid) || null,
        })),
        table: withHandles(room.table.getPublicState(userId), handles),
        // Only the people who played it are shown a game's result: someone
        // who walked in afterwards has no stake in a hand they never saw.
        gameOver: room.gameOver?.participants.includes(userId) ? room.gameOver : null,
        joinChips: room.lateJoinChips(),
        isPrivate: room.isPrivate,
        // Members get the room's invite token so they can share a link.
        invite: room.inviteToken,
        spectators: room.spectatorList(),
        allowSpectators: room.allowSpectators,
        // Whether this viewer is watching, and whether there's a chair for
        // them to take if they are.
        watching: room.spectators.has(userId),
        seatsFree: Math.max(0, room.table.maxSeats - room.seatHolders()),
        // Whether a vote to remove somebody is on offer at all. Sent rather
        // than worked out again on the client, so the control on screen and
        // the rule in the handler cannot drift apart.
        canVoteKick: room.canVoteKick(),
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

  // The one thing the table payload gains: each human account's handle, so a
  // seat can link to a profile. Added out here rather than inside Table,
  // which knows about chips and cards and has no business knowing what a
  // player is called on the web. Nothing else about the account goes with it
  // - no id, no email, no metadata.
  function withHandles(state, handles) {
    return {
      ...state,
      seats: state.seats.map((p) =>
        p && !p.isBot ? { ...p, handle: handles.get(p.userId) || null } : p
      ),
    };
  }

  function scheduleNextHand(room) {
    manager.recordHandResult(room);
    announceHandResult(room);
    room.recordHand(room.table.lastHandSummary);
    clearTimeout(room.handTimer);
    room.handTimer = setTimeout(() => startNextHand(room), NEXT_HAND_DELAY_MS);
  }

  // Every hand's result goes in the chat as it happens. The banner on the
  // felt and the result sheet are both gone within seconds; the chat is the
  // only place somebody who looked away can catch up.
  function announceHandResult(room) {
    const sum = room.table.lastHandSummary;
    if (!sum?.winners?.length) return;
    const pot = sum.winners.reduce((n, w) => n + w.amount, 0);
    const money = (n) => n.toLocaleString('en-US');
    const names = sum.winners.map((w) => w.username);
    const who =
      names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    let line;
    if (sum.winners.length > 1) {
      line = `Hand #${sum.handNumber}: ${who} split ${money(pot)} chips.`;
    } else if (sum.uncontested) {
      line = `Hand #${sum.handNumber}: ${who} wins ${money(pot)} chips — everyone else folded.`;
    } else {
      const made = sum.winners[0].hand?.description || sum.winners[0].hand?.name;
      line = `Hand #${sum.handNumber}: ${who} wins ${money(pot)} chips${made ? ` with ${made}` : ''}.`;
    }
    sendSystemChat(room, line, 'result');
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
      endMatch(room);
      // A line in the chat so the result survives the table being torn down:
      // the felt and its banner are about to be replaced by the waiting room,
      // but the chat carries on and anybody scrolling back still finds it.
      if (room.gameOver.winner) {
        const w = room.gameOver.winner;
        const hands = room.gameOver.hands;
        sendSystemChat(
          room,
          `${w.username} wins the game with ${w.chips.toLocaleString('en-US')} chips, after ${hands} hand${hands === 1 ? '' : 's'}.`
        );
      }
      // Everyone who busted out is back in the waiting room for the next game.
      room.spectators.clear();
      room.handLog = []; // a new game starts its history over, as the sidebar does
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

  // The room talking rather than a player: it sits in the log with everything
  // else, so it's there when somebody reads back, but it answers to nobody
  // and can't be replied to, edited or deleted.
  // `kind` marks a line the reader may not want: 'result' is a hand's
  // winner, which some would rather read off the felt than have scroll the
  // table's talk away. Everything else is unmarked and always shown.
  function sendSystemChat(room, text, kind = null) {
    const entry = {
      id: ++chatSeq,
      userId: 0,
      name: '',
      text,
      at: Date.now(),
      replyTo: null,
      editedAt: null,
      deleted: false,
      spectator: false,
      system: true,
      kind,
    };
    room.addChat(entry);
    for (const id of room.members()) {
      for (const sock of socketsByUser.get(id) || []) sock.emit('chat', entry);
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
    endMatch(room);
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

  // Carries a new name into the room a player is already sitting in. The seat
  // is kept - it is the same player, under a name that has caught up - so a
  // hand in progress is untouched and only what everyone reads changes.
  //
  // Shared by the rename a player asks for and the correction the handshake
  // makes when it finds a generated name on a real account.
  function carryNameIntoRoom(room, userId, clean) {
    if (!room) return;
    const entry = room.lobby.get(userId);
    if (entry) entry.username = clean;
    const seat = room.table.seats.find((s) => s && s.userId === userId);
    if (seat) seat.username = clean;
    if (room.hostUserId === userId) room.hostUsername = clean;
    // Past messages are shown under whatever the player is called now, so the
    // chat doesn't keep addressing them by a name they've dropped.
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

  // Puts someone who is allowed in into the room, whether they walked into a
  // public table or the host just opened the door of a private one. Returns
  // what the joiner's client needs to know, or why they can't come in.
  function admit(room, uid, username, { invited = false } = {}) {
    if (room.blocked.has(uid)) return { ok: false, error: 'The host has blocked them from this room.' };
    if (room.nameTaken(username, uid)) {
      return { ok: false, error: 'Someone in that room already uses that name.' };
    }
    // Walking in on a game already under way. They come in watching and pick
    // their own chair from the felt, rather than being planted in whichever
    // one happened to be free: the empty seats are on screen with a plus in
    // them, and pressing one is what puts them in the queue for the next
    // hand. The host's stake applies when they do, not whatever they typed.
    //
    // Where the host allows no watchers there is no rail to wait on, so the
    // old way in stands: a chair is found for them or they are turned away.
    if (room.table.phase !== 'waiting') {
      if (room.table.seats.every((seat) => seat !== null) || room.lobby.size >= room.table.maxSeats) {
        return { ok: false, error: 'That table is full.' };
      }
      const chips = room.lateJoinChips();
      room.addToLobby(uid, username, chips);
      if (!room.allowSpectators) {
        room.table.addLatePlayer(uid, username, chips);
        announce(room, `${username} joined — in from the next hand.`, uid);
        return { ok: true, code: room.code, chips, waiting: true };
      }
      // Somebody who followed an invite didn't come to watch - they were
      // asked to play. They go straight into the queue for the next hand,
      // into the seat that was free for them, rather than landing on the rail
      // to press a plus they were effectively just handed. There is room: the
      // full check above has already passed.
      if (invited) {
        room.table.addLatePlayer(uid, username, chips);
        announce(room, `${username} joined — in from the next hand.`, uid);
        return { ok: true, code: room.code, chips, waiting: true };
      }
      room.spectators.set(uid, 'watching');
      announce(room, `${username} is here — they can take any empty seat.`, uid);
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

    // The handshake found a generated name on a real account and put it
    // right. If they are already at a table - a reconnect mid-hand - the seat
    // keeps its place and only the name on it changes.
    if (socket.healedName) carryNameIntoRoom(roomFor(userId), userId, socket.healedName);

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
        user: {
          id: user.id,
          username: db.displayName(user),
          accountName: user.username,
          // The handle their own profile page is at, so the bar can offer it
          // without asking Supabase a second time. Null for a guest.
          handle: user.handle || null,
        },
        currentRoom: room ? room.code : null,
      });
    });

    // How many matches this guest has waiting, and nothing about them.
    //
    // A count is all the sign-up sheet needs to decide whether to offer the
    // line about crediting, and it is all the browser is told: the results
    // themselves are the server's business until they belong to somebody.
    socket.on('guestResultCount', (_payload, ack) => {
      if (!socket.isAnonymous) return ack?.({ ok: true, count: 0 });
      ack?.({ ok: true, count: guestResults.count(socket.supabaseId, socket.guestSessionId) });
    });

    // A guest became an account, in this session, and says so.
    //
    // Nothing here takes the claim on trust. The token in the payload is
    // verified from scratch, and the results are credited only when all
    // three of these hold:
    //
    //   the token is good and names a non-anonymous user,
    //   that user is the one this socket already connected as,
    //   and a buffer exists under this socket's own browser session id.
    //
    // The second is what makes a login to an existing account different from
    // an upgrade. An upgrade keeps the user id it had, so the ids match; a
    // login is a different account, the ids differ, and the buffer is
    // dropped rather than credited - those matches were played by somebody
    // who no longer exists.
    socket.on('refreshIdentity', async (payload, ack) => {
      const claims = await verifyAccessToken(payload?.token);
      if (!claims) return ack?.({ ok: false, error: 'That session could not be verified.' });

      if (claims.id !== socket.supabaseId) {
        // Somebody else entirely. Their guest session ends here, unclaimed.
        guestResults.drop(socket.supabaseId, socket.guestSessionId);
        return ack?.({ ok: true, credited: 0, reconnect: true, discarded: true });
      }
      if (claims.isAnonymous) {
        // Still a guest. Nothing to credit to, and nothing is dropped: they
        // may yet sign up before the session ends.
        return ack?.({ ok: true, credited: 0, pending: true });
      }

      const player = getOrCreateSupabaseUser(claims);
      if (!player) return ack?.({ ok: false, error: 'That account could not be read.' });
      rememberHandle(player, claims);
      // From here on they are an account, so their next match is written to
      // the results table in the ordinary way rather than buffered. Said to
      // every socket they hold, not just the one that asked: the others are
      // open tabs that still believe they are a guest, and any one of them
      // could be the one a result is read from.
      for (const s of socketsByUser.get(userId) || []) {
        s.isAnonymous = false;
        s.supabaseId = claims.id;
      }
      guestResults.disconnected(socket.supabaseId, socket.guestSessionId);

      const results = guestResults.take(claims.id, socket.guestSessionId);
      if (!results.length) return ack?.({ ok: true, credited: 0 });
      try {
        const credited = db.recordGameResults(
          player.id,
          results.map((r) => ({ ...r, wasGuest: true }))
        );
        return ack?.({ ok: true, credited });
      } catch {
        // The write failed as a whole - the transaction saw to that - so the
        // results go back and the session keeps them. Half a record is worse
        // than none: nothing afterwards could tell which half it had.
        guestResults.restore(claims.id, socket.guestSessionId, results);
        return ack?.({ ok: false, error: 'Those games could not be added. They are still here.' });
      }
    });

    // Leaving a guest session on purpose. The results go now rather than at
    // the end of the grace period, because the player has just said they are
    // done being this person.
    socket.on('forgetGuestResults', (_payload, ack) => {
      guestResults.drop(socket.supabaseId, socket.guestSessionId);
      ack?.({ ok: true });
    });

    socket.on('listRooms', (_payload, ack) => {
      ack?.({ rooms: manager.listOpenRooms() });
    });

    // Display names always come from the database, never from the client payload.
    const nameOf = () => db.displayName(db.getUserById(userId));

    socket.on('setName', ({ name } = {}, ack) => {
      const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
      if (!DISPLAY_NAME_RE.test(clean)) {
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
      carryNameIntoRoom(room, userId, clean);
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

    socket.on('joinRoom', ({ code, buyIn, fromList, invite, fromInvite } = {}, ack) => {
      const room = manager.getRoom(code);
      if (!room) return ack?.({ ok: false, error: 'Room not found.', reason: 'no-room' });
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
      // decides who actually comes in. A link the host shared is that
      // decision already made, so it goes straight through.
      const invited = !!invite && invite === room.inviteToken;
      if (room.isPrivate && userId !== room.hostUserId && !invited) {
        room.knocks.set(userId, nameOf());
        ack?.({ ok: true, code: room.code, knocking: true });
        return broadcastRoom(room);
      }
      // Auto-queue anyone who came from an invite - a private room's by its
      // token, a public one's by the flag the invite card carries. Joining a
      // public room off the open list is unchanged: that lands on the rail.
      const res = admit(room, userId, nameOf(), { invited: invited || !!fromInvite });
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
      if (!room) return ack?.({ ok: false, error: 'Room not found.', reason: 'no-room' });
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
      // worth watching — but the host says how big the crowd may get.
      if (!room.allowSpectators) {
        return ack?.({ ok: false, error: 'That host isn’t allowing spectators.' });
      }
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
    // The hands this game has already played. Sent on arrival rather than
    // with every table update: it's a backlog, and it only grows by one at
    // the end of a hand, which the client sees for itself.
    const sendHandHistory = (room) => socket.emit('handHistory', { code: room.code, hands: room.handLog });

    socket.on('resync', (_payload, ack) => {
      const room = roomFor(userId);
      ack?.({ ok: true, code: room ? room.code : null });
      if (room) {
        sendChatHistory(room);
        sendHandHistory(room);
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

    // Whether this table has an audience. Turning it off doesn't clear the
    // people already watching - they were let in under the old answer, and
    // the host has Remove for anyone they'd rather not have there - it just
    // shuts the door behind them.
    socket.on('setAllowSpectators', ({ allow } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (room.hostUserId !== userId) return ack?.({ ok: false, error: 'Only the host can set that.' });
      room.allowSpectators = allow !== false;
      ack?.({ ok: true, allow: room.allowSpectators });
      broadcastRoom(room);
      roomsChanged();
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
      // Below three people a vote is one player removing another unopposed.
      // The control is hidden on the client at the same threshold; this is
      // the half that cannot be clicked past.
      if (!room.canVoteKick()) {
        return ack?.({ ok: false, error: 'A vote needs three players. Ask the host to remove them.' });
      }
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
      if (room.isFull()) return ack?.({ ok: false, error: 'Table is full.' });
      const taken = [...room.lobby.values()].map((p) => p.username);
      // A game already running: the bot sits down on the same terms as a
      // late joiner - the host's late-join stack, out of the hand in play
      // and dealt in from the next one.
      const live = room.table.phase !== 'waiting';
      const seatedBuyIn = live
        ? room.lateJoinChips()
        : Math.max(1, Math.floor(Number(buyIn)) || room.lobby.get(userId)?.buyIn || 1000);
      const botLevel = bot.normalizeLevel(level);
      const botId = bot.makeBotId();
      const botName = bot.pickBotName(taken, botLevel);
      room.addToLobby(botId, botName, seatedBuyIn, true, botLevel);
      if (live) {
        room.table.addLatePlayer(botId, botName, seatedBuyIn, true, botLevel);
        announce(room, `${botName} is taking a seat.`);
      }
      ack?.({ ok: true });
      broadcastRoom(room);
      roomsChanged(); // the open-tables list counts the seats
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
      if (targetUserId === userId) return ack?.({ ok: false, error: 'Use Leave to exit the room.' });
      const info = room.lobby.get(targetUserId);
      const seat = room.table.seats.find((p) => p && p.userId === targetUserId && !p.left);
      if (!info && !seat) return ack?.({ ok: false, error: 'Player not in this room.' });
      // Mid-game this is for bots alone. Nobody is at the keyboard for one,
      // so taking it off the table is the host's to do and nobody's loss;
      // a player has to be voted out, which is the room's business.
      const isBot = !!(info?.isBot || seat?.isBot);
      if (room.table.phase !== 'waiting' && !isBot) {
        return ack?.({ ok: false, error: 'A player can only be voted out once the game is running.' });
      }
      const removedName = info?.username || seat?.username || 'Player';
      room.spectators.delete(targetUserId);
      room.removeFromLobby(targetUserId);
      // Nothing in the hand: the chair goes straight back. Chips already in
      // the middle: the seat is held, folded, until the next deal.
      if (!room.table.releaseSeat(targetUserId)) room.table.removePlayer(targetUserId);
      // No further roomState reaches them, so without this they'd sit on a
      // waiting room they're no longer part of.
      for (const s of socketsByUser.get(targetUserId) || []) {
        s.emit('kicked', { code: room.code, reason: 'You have been kicked from the lobby.' });
      }
      announce(room, `${removedName} was removed from the room.`, targetUserId);
      ack?.({ ok: true });
      broadcastRoom(room);
      roomsChanged();
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

    // A watcher pulling up a chair - the one they pressed on the felt, where
    // it is free. There's no seat to take mid-hand, so they're dealt in from
    // the next one, on the host's late-join stake.
    socket.on('takeSeat', ({ seat } = {}, ack) => {
      const room = roomFor(userId);
      if (!room) return ack?.({ ok: false, error: 'Not in a room.' });
      if (!room.spectators.has(userId)) return ack?.({ ok: false, error: 'You already have a seat.' });
      if (room.isFull()) return ack?.({ ok: false, error: 'Every seat is taken.' });
      const chips = room.lateJoinChips();
      const info = room.lobby.get(userId);
      room.spectators.delete(userId);
      if (info) info.buyIn = chips;
      const wanted = Number.isInteger(seat) ? seat : null;
      if (room.table.phase !== 'waiting') room.table.addLatePlayer(userId, nameOf(), chips, false, null, wanted);
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
        // The host leaving used to take the room with them. It doesn't any
        // more: a table mid-hand is other people's game too, and ending it
        // because one person walked away is the host's departure costing
        // everybody else theirs.
        //
        // So the room changes hands instead. `voters` is the right list to
        // draw from without building another one - humans, seated or waiting,
        // never bots, never the person leaving - and the pick is random
        // because any rule (longest seated, biggest stack) would be a rule
        // players could work, and none of them is fairer than a draw.
        //
        // Only when there is nobody left to hand it to does the room close.
        if (room.hostUserId === userId) {
          const heirs = [...room.voters(userId)];
          if (!heirs.length) {
            closeRoom(room, 'The host left, so the room was closed.');
            return ack?.({ ok: true });
          }
          const heir = heirs[Math.floor(Math.random() * heirs.length)];
          const seat = room.table.seats.find((p) => p && p.userId === heir && !p.left);
          const heirName = room.lobby.get(heir)?.username || seat?.username || 'Player';
          const leaving = nameOf();
          room.hostUserId = heir;
          room.hostUsername = heirName;
          // The owner can't be voted out, so any vote already running against
          // them stops the moment the room becomes theirs.
          room.kickVotes.delete(heir);
          room.keepVotes.delete(heir);
          announce(room, `${leaving} left. ${heirName} is the room owner now.`, [heir]);
          tell(heir, `${leaving} left, so the room is yours now.`);
        }
        // Their chips, counted where they stand, before the seat is given up
        // and there is nothing left to count. A match they walked out of is
        // still a match they played. Does nothing when no match is running.
        manager.recordDeparture(room, userId, { onGuestResult: bufferGuestResult });
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
      // The grace period runs from the last socket to go, so a refresh -
      // a disconnect and a connect a second apart - costs a guest nothing.
      if (socket.isAnonymous) guestResults.disconnected(socket.supabaseId, socket.guestSessionId);
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

module.exports = { attachSockets, offlineGuestsAllowed };
