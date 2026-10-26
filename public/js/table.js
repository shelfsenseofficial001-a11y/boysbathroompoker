// Poker table screen: waiting room, live table, betting dock and all table
// animations. The table skeleton is built once; each server update redraws
// only the parts that change so inputs, hover states and animations survive.
import { getSocket, emitAck } from './socket.js';
import { cardFaceSVG } from './svg/cards.js';
import { cardBackSVG, feltSVG, feltTheme } from './svg/themes.js';
import { chipSVG, chipStackSVG, breakdown, chipSet } from './svg/chips.js';
import { feltLogoSVG, dealerButtonSVG, turnRingSVG } from './svg/table.js';
import { avatarSVG } from './svg/avatars.js';
import { icons } from './svg/icons.js';
import { motionReduced, toggleMotion, resumeEntrance, ENTRANCE_MS } from './motion.js';
import { play, soundMuted, toggleSound } from './sound.js';
import { userMenuHTML, wireUserMenu } from './name.js';
import { getSettings, setSetting, ZOOM } from './settings.js';
import { syncThemeArrows, themePickerHTML, wireThemePicker } from './themepicker.js';
import { showToast } from './toast.js';
import { balanceBlinds, numberFieldHTML, readField, wireSteppers } from './stepper.js';
import { flagInvalid } from './invalid.js';

const BETTING = ['preflop', 'flop', 'turn', 'river'];
const PHASE_LABEL = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
// The tag played as each street lands ('turn' is already the it's-your-turn
// chime, so the turn card gets its own name).
const STREET_SOUND = { flop: 'flop', turn: 'turnCard', river: 'river' };
// Table landmarks, in % of the camera box. Portrait (phones) stacks the
// board lower so it clears the upper seats' bets.
const CENTER = { x: 50, y: 50 };
const LANDMARKS = {
  // The muck, the community cards and the pot run down the centre line, in
  // that order: the board is the middle of the table, the discards are pushed
  // away from the players to the far side of it, and the pot sits under the
  // cards on the near side, where it is being played for - one column, rather
  // than things left around the felt. `pot.y` is where the TOP of the pot
  // block sits, not its middle (see .pot in the stylesheet), so it keeps the
  // same small gap under the board however many lines it is showing and grows
  // downward. computeLayout may slide the whole column down to clear a seat
  // at the top of the table.
  // cardsK is how far my own hand sits from my seat toward the middle.
  landscape: { board: { x: 50, y: 42 }, pot: { x: 50, y: 53 }, muck: { x: 50, y: 26 }, cardsK: 0.24 },
  portrait: { board: { x: 50, y: 48 }, pot: { x: 50, y: 58 }, muck: { x: 50, y: 32 }, cardsK: 0.22 },
};

let BOARD = LANDMARKS.landscape.board;
let POT = LANDMARKS.landscape.pot;
let MUCK = LANDMARKS.landscape.muck;
let DECK = BOARD;

let reduceMotion = motionReduced();
const BOT_LEVELS = [
  { id: 'beginner', label: 'Beginner', desc: 'Calls almost anything, never bluffs' },
  { id: 'casual', label: 'Casual', desc: 'Folds weak hands, raises strong ones' },
  { id: 'solid', label: 'Solid', desc: 'Picky, bets for value, hard to bluff' },
  { id: 'expert', label: 'Expert', desc: 'Counts the odds, bluffs and traps' },
];
const levelLabel = (id) => BOT_LEVELS.find((l) => l.id === id)?.label || 'Bot';
// Each difficulty carries its own colour through the whole UI.
const levelClass = (id) => `lvl-${BOT_LEVELS.some((l) => l.id === id) ? id : 'casual'}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Money. Past a thousand it reads as 1.01k, 1.23m, 4.5b rather than 1,010 -
// a pot in the millions is meant to be taken in at a glance, not counted.
// Cut rather than rounded, so a figure never reads as more than there is,
// and trailing zeroes go: 1000 is 1k, not 1.00k. The exact number is still
// what the bet box holds and what every button acts on.
const MONEY_UNITS = [
  [1e12, 't'],
  [1e9, 'b'],
  [1e6, 'm'],
  [1e3, 'k'],
];
const fmt = (n) => {
  const v = Math.trunc(Number(n) || 0);
  const abs = Math.abs(v);
  const unit = MONEY_UNITS.find(([size]) => abs >= size);
  if (!unit) return v.toLocaleString('en-US');
  const [size, suffix] = unit;
  // Divided by a hundredth of the unit, so the two decimals are whole
  // numbers: 1010/10 is 101 exactly, where 1010/1000*100 is 100.999...
  return `${v < 0 ? '-' : ''}${Math.floor(abs / (size / 100)) / 100}${suffix}`;
};

// Headcounts that have to fit in a small badge: 1,200 watchers reads as
// 1.2k. Trailing zeroes are dropped, so it's 2k rather than 2.0k.
const compact = (n) => {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  const units = [
    [1e9, 'b'],
    [1e6, 'm'],
    [1e3, 'k'],
  ];
  for (const [size, suffix] of units) {
    if (v < size) continue;
    const scaled = v / size;
    return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.floor(scaled)}${suffix}`;
  }
  return String(v);
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function describeAction(a) {
  if (!a) return null;
  // The server names the action with the amount already inside the string -
  // "raise to 299026", "bet 4000". The figure still has to read the way every
  // other figure on the table does, so it goes through fmt here rather than
  // being shown exactly as the server wrote it.
  const money = (s) => s.replace(/\d+/g, (n) => fmt(n));
  if (a === 'small blind') return { text: 'SB', cls: '' };
  if (a === 'big blind') return { text: 'BB', cls: '' };
  if (a.startsWith('raise') || a.startsWith('bet')) return { text: money(a.replace(' (all-in)', '')), cls: a.includes('all-in') ? 't-allin' : 't-raise' };
  if (a === 'all-in' || a.includes('all-in')) return { text: 'All-in', cls: 't-allin' };
  if (a === 'fold' || a === 'timed out') return { text: a === 'fold' ? 'Fold' : 'Timed out', cls: 't-fold' };
  if (a.startsWith('check')) return { text: 'Check', cls: '' };
  if (a === 'call') return { text: 'Call', cls: '' };
  if (a === 'left') return { text: 'Left', cls: 't-fold' };
  return { text: money(a), cls: '' };
}

// Who's sitting on the biggest stack. Only when one player is clearly ahead:
// at the start of a game everybody is level, and badging the whole table
// would say nothing.
function chipLeaderId(t) {
  const live = t.seats.filter((p) => p && !p.left);
  if (live.length < 2) return null;
  let best = null;
  let tied = false;
  for (const p of live) {
    if (!best || p.chips > best.chips) {
      best = p;
      tied = false;
    } else if (p.chips === best.chips) {
      tied = true;
    }
  }
  return tied || !best || best.chips <= 0 ? null : best.userId;
}

function winningCards(summary) {
  const set = new Set();
  if (!summary || summary.uncontested) return set;
  for (const w of summary.winners) for (const c of w.hand?.cards || []) set.add(c);
  return set;
}

export function renderTable(root, { user, roomCode, onLeave, notice }) {
  const socket = getSocket();
  let latest = null; // newest roomState from the server
  let shown = null; // state currently drawn (lags `latest` during a peek)
  let mode = null; // 'waiting' | 'table'
  let els = null; // cached skeleton elements in table mode
  let layout = null; // seat anchors for the current draw
  let model = null; // derived betting info for the local player
  let peeking = false;
  let zoomClearTimer = null; // clears the camera's inline transition after a peek
  let settingsTab = 'cards'; // which section of the settings sheet is showing
  let pendingTotal = null; // chosen bet/raise-to total, null = use minimum
  let trayDenoms = []; // denominations the chip tray is holding (see syncTray)
  let askingTutorial = false; // the gesture tutorial, shown as a game starts
  let tutorialClosing = false; // ...and playing its way back out
  let holding = false; // a pointer is down on my cards (peek or drag in progress)
  let dragging = false; // my cards are being dragged (toss-to-fold)
  let selfTossedHand = null; // hand number in which I threw my cards in myself
  let myTurnKey = '';
  let turnEndsAt = 0;
  let turnTotal = 0;
  let lastTouchCheck = 0;
  let lastTickSec = -1;
  let renderedHand = 0; // hand number the cards on screen belong to
  let renderedBoard = 0; // community cards already on the felt, for this hand
  let renderedShowdown = 0; // hand number whose showdown reveal has been drawn
  let botLevel = 'casual'; // difficulty used for the next bot the host adds
  let foldArmed = false; // Fold needs a second click to confirm
  let foldArmTimer = null;
  let queuedFold = null; // hand number a fold is lined up for, out of turn
  let allinArmed = false; // All-in needs a second press to confirm
  let allinArmTimer = null;
  const timers = new Set();

  // Whether my hole cards sit face up for the whole hand (a player setting,
  // toggled from the top bar or the lobby). Read fresh rather than cached, so
  // flipping it takes effect on the very next draw.
  const autoReveal = () => getSettings().autoReveal;

  // Finished hands, newest first, for the sidebar. Kept per room in this
  // browser so a refresh doesn't wipe the record of the session.
  const HISTORY_KEY = `bbp-history-${roomCode}`;
  const HISTORY_MAX = 60;
  const history = loadHistory();
  const expanded = new Set(); // hands whose cards are showing
  let historyOpen = getSettings().showHistory;
  let specOpen = false; // the watchers panel at the foot of the table
  let bustAnswered = false; // chose to watch on after running out of chips
  const chatLog = []; // table talk, oldest first
  let chatOpen = getSettings().showChat;
  // Whether each hand's winner is announced in the log. A reader's own
  // preference, not the room's: the line is sent either way.
  let showResults = getSettings().showResults;
  let chatUnread = 0; // messages that arrived while the panel was shut
  let chatReplyTo = null; // id of the message being replied to
  let chatEditing = null; // id of my message being edited
  let chatMenuFor = null; // id whose actions menu is open
  let chatMissed = []; // messages that landed while reading back, newest last
  // The emoji picker over the composer. The set itself is fetched once and
  // kept for the visit - it's every emoji there is, so it's worth not asking
  // for twice, and worth not shipping inside the table's own script.
  let emojiOpen = false;
  let emojiGroups = null;
  let emojiLoading = null;
  let emojiTab = 0;
  let emojiQuery = '';
  let openVotes = []; // vote-kicks currently running at this table
  let seatMenuFor = null; // userId whose seat menu is open
  let dismissedGameOver = null; // key of a result the player has closed
  let askingLeave = false; // the leave confirmation is up
  let enteredAt = 0; // when the current screen's entrance began (motion.js)
  let showAskDone = 0; // hand whose "show your cards?" prompt has been answered
  let askingTransfer = null; // userId being offered the room, pending confirmation
  let askingSettings = false; // the settings panel is up

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0, HISTORY_MAX) : [];
    } catch {
      return []; // unreadable or unavailable storage: start fresh
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // Full or unavailable storage: the list still works for this visit.
    }
  }

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  socket.on('roomState', onRoomState);
  socket.on('roomClosed', onRoomClosed);
  socket.on('kicked', onRoomClosed); // same outcome: out of the room, with a reason
  socket.on('notice', onNotice);
  socket.on('chat', onChat);
  socket.on('chatUpdate', onChatUpdate);
  socket.on('votes', onVotes);
  socket.on('chatHistory', onChatHistory);
  socket.on('handHistory', onHandHistory);
  socket.on('connect', resync);
  const clock = setInterval(tickClock, 200);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDocPointerDown);
  resync();
  // A note carried in from the lobby, e.g. joining a hand already in play.
  if (notice) later(() => showNotice(notice), 400);

  function resync() {
    emitAck('resync')
      .then((res) => {
        if (!res.code) exit();
      })
      .catch(() => {});
  }

  function cleanup() {
    socket.off('roomState', onRoomState);
    socket.off('roomClosed', onRoomClosed);
    socket.off('kicked', onRoomClosed);
    socket.off('notice', onNotice);
    socket.off('chat', onChat);
    socket.off('chatUpdate', onChatUpdate);
    socket.off('votes', onVotes);
    socket.off('chatHistory', onChatHistory);
    socket.off('handHistory', onHandHistory);
    socket.off('connect', resync);
    clearInterval(clock);
    timers.forEach(clearTimeout);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onDocPointerDown);
    feltWatch?.disconnect();
  }

  function exit(notice, forced = false) {
    cleanup();
    onLeave(notice, forced);
  }

  // ---------------------------------------------------------------------------
  // Table chat
  // ---------------------------------------------------------------------------
  // The backlog, sent to this socket alone when it syncs: it can't ride along
  // with roomState, which goes out on every single action.
  function onChatHistory(payload) {
    if (payload?.code && payload.code !== roomCode) return;
    chatLog.length = 0;
    chatLog.push(...(payload.messages || []));
    drawChat({ keepUnread: true });
  }

  function onChat(entry) {
    if (!entry?.text) return;
    if (chatLog.some((m) => m.id === entry.id)) return; // already have it
    chatLog.push(entry);
    if (chatLog.length > 80) chatLog.shift();
    // A line this reader has turned off is no news at all: no dot, no sound
    // and nothing waiting on the jump button.
    const hidden = entry.kind === 'result' && !showResults;
    if (hidden) return drawChat({ keepUnread: true });
    // Somebody else talking while the panel is shut is worth a nudge; your
    // own message never is.
    if (!chatShowing() && entry.userId !== user.id) chatUnread += 1;
    // Its own cue rather than the general click, so talk is recognisable
    // from across the room with the panel shut. The table's own lines say
    // nothing a sound would add - the hand they report has already been
    // heard.
    if (!entry.system && entry.userId !== user.id) play('chat');
    // Reading back when it landed: hold on to it for the jump button, so the
    // way down also says what is waiting at the bottom.
    const mine = entry.userId === user.id;
    if (!mine && chatShowing() && !chatAtBottom()) {
      chatMissed.push({ name: entry.system ? 'Table' : entry.name, text: entry.text });
      if (chatMissed.length > 99) chatMissed.shift();
    }
    drawChat({ keepUnread: true });
    markArriving();
    if (mine) scrollChatToEnd(); // your own message always brings you down
  }

  // The message that just landed rises into place. The rest of the log is
  // redrawn without any motion, so this is the only line that moves.
  function markArriving() {
    const last = els?.chatLog?.lastElementChild;
    if (last && !last.classList.contains('chat-empty')) last.classList.add('is-arriving');
  }

  // An edit or a delete: swap the stored copy, keep its place in the log.
  function onChatUpdate(entry) {
    const i = chatLog.findIndex((m) => m.id === entry.id);
    if (i < 0) return;
    chatLog[i] = entry;
    if (chatEditing === entry.id && entry.deleted) chatEditing = null;
    drawChat({ keepUnread: true });
  }

  // Near enough the foot of the log to count as reading the newest message.
  const CHAT_FOOT = 40;
  const chatAtBottom = () => {
    const log = els?.chatLog;
    return !log || log.scrollHeight - log.scrollTop - log.clientHeight < CHAT_FOOT;
  };

  // What this reader has asked to see. Hand results are dropped rather than
  // never stored, so turning them back on brings the ones already sent with
  // it instead of starting from the next hand.
  const visibleChat = () => (showResults ? chatLog : chatLog.filter((m) => m.kind !== 'result'));

  function drawChat({ keepUnread = false } = {}) {
    if (!els?.chatLog) return;
    if (!keepUnread) chatUnread = 0;
    drawUnread();
    drawComposer();
    const visible = visibleChat();
    if (!visible.length) {
      setHTML(els.chatLog, '<li class="chat-empty">Nobody has said anything yet.</li>');
      drawJump();
      return;
    }
    // Stick to the newest message unless the reader has scrolled up to read
    // back, in which case leave their place alone.
    const log = els.chatLog;
    const atBottom = chatAtBottom();
    setHTML(log, visible.map(bubbleHTML).join(''));
    if (atBottom) scrollChatToEnd();
    drawJump();
  }

  // Lands at the foot of the log once the browser has laid the messages out:
  // straight after writing them the heights aren't known yet, so a scroll set
  // there stops short of the newest one.
  function scrollChatToEnd() {
    const log = els?.chatLog;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
    requestAnimationFrame(() => {
      const live = els?.chatLog;
      if (live) live.scrollTop = live.scrollHeight;
    });
    chatMissed = [];
    drawJump();
  }

  // The way back down, with whoever spoke while you were reading back. It
  // only appears once you've actually left the foot of the log.
  function drawJump() {
    const btn = els?.chatJump;
    if (!btn) return;
    const away = !chatAtBottom() && chatLog.length > 0;
    btn.hidden = !away;
    if (!away) return;
    const last = chatMissed[chatMissed.length - 1];
    const n = chatMissed.length;
    if (!last) {
      setHTML(btn, `<span class="jump-arrow">${icons.chevron}</span><span class="jump-text">Jump to newest</span>`);
      btn.classList.remove('has-news');
      return;
    }
    btn.classList.add('has-news');
    setHTML(
      btn,
      `<span class="jump-face">${avatarSVG(last.name)}</span>
       <span class="jump-text"><b>${esc(last.name)}</b>${esc(last.text)}</span>
       ${n > 1 ? `<span class="jump-count">${n > 99 ? '99+' : n}</span>` : ''}
       <span class="jump-arrow">${icons.chevron}</span>`
    );
  }

  // `rows` is the list being drawn, which map passes in as the third
  // argument. The neighbours have to come from it rather than from chatLog:
  // with each hand's winner hidden the two lists run out of step, and a row
  // was grouped against whatever message happened to share its index in the
  // full log - which is how a name and face landed in the middle of a run
  // instead of at its head.
  function bubbleHTML(m, i, rows) {
    // The room talking: centred, plain, and nobody's to reply to.
    if (m.system) return `<li class="chat-system">${esc(m.text)}</li>`;
    const mine = m.userId === user.id;
    // Messages from one person in a row are grouped: only the first shows a
    // name and face, and the corner radii round off the outside of the run
    // so it reads as one block rather than a stack of separate boxes.
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const first = !prev || prev.userId !== m.userId;
    const last = !next || next.userId !== m.userId;
    const group = `${first ? ' is-first' : ''}${last ? ' is-last' : ''}`;
    const face = first
      ? `<span class="chat-face">${avatarSVG(m.name)}</span>`
      : '<span class="chat-face is-blank"></span>';

    if (m.deleted) {
      return `<li class="chat-row${mine ? ' is-mine' : ''}${group}">
        ${first && !mine ? `<span class="chat-meta"><span class="chat-who">${esc(m.name)}</span></span>` : ''}
        <div class="bubble-line">${mine ? '' : face}
          <div class="bubble is-gone">${mine ? 'You deleted this' : 'Message deleted'}</div>
        </div>
      </li>`;
    }

    const quoted = m.replyTo ? chatLog.find((x) => x.id === m.replyTo) : null;
    // “Replied to Quinn” rides on the same line as the sender's name, with
    // the message being answered sitting outside the bubble rather than
    // crammed inside it.
    let noteHTML = '';
    let quoteHTML = '';
    if (m.replyTo) {
      const to = !quoted
        ? 'an earlier message'
        : quoted.userId === m.userId
          ? mine
            ? 'yourself'
            : 'themselves'
          : quoted.userId === user.id
            ? 'you'
            : esc(quoted.name);
      // The quote carries no name of its own: the note above it has already
      // said whose message this is answering.
      noteHTML = `<span class="reply-note">Replied to ${to}</span>`;
      quoteHTML = `<span class="reply-quote">${
        quoted ? (quoted.deleted ? 'Message deleted' : esc(quoted.text)) : 'No longer shown'
      }</span>`;
    }
    // Said from the rail: worth marking, because a watcher can't act on
    // anything that's being discussed at the table.
    const specHTML = m.spectator && first
      ? `<span class="chat-spec" title="Watching, not playing" aria-label="Watching">${icons.eye}</span>`
      : '';
    const whoHTML = first && !mine ? `<span class="chat-who">${esc(m.name)}</span>` : '';
    // Arrow, then who is talking, then who they answered.
    const arrow = noteHTML ? `<span class="reply-arrow">${icons.call}</span>` : '';
    const metaHTML =
      whoHTML || noteHTML || specHTML
        ? `<span class="chat-meta">${arrow}${whoHTML}${specHTML}${noteHTML}</span>`
        : '';
    const open = chatMenuFor === m.id;
    // Reply sits on its own, then the dots: the one everybody uses is a
    // single tap rather than two.
    const actions = `<span class="bubble-acts">
      <button class="bubble-act" data-msg-reply="${m.id}" title="Reply" aria-label="Reply">${icons.call}</button>
      <button class="bubble-act" data-msg-menu="${m.id}" title="More" aria-label="Message actions" aria-expanded="${open}">⋯</button>
      ${
        open
          ? `<div class="msg-menu">
              <button data-msg-reply="${m.id}">Reply</button>
              ${mine ? `<button data-msg-edit="${m.id}">Edit</button>` : ''}
              ${mine ? `<button class="is-danger" data-msg-delete="${m.id}">Delete</button>` : ''}
            </div>`
          : ''
      }
    </span>`;

    return `<li class="chat-row${mine ? ' is-mine' : ''}${group}${m.spectator ? ' is-spec' : ''}">
      ${metaHTML}
      ${quoteHTML}
      <div class="bubble-line">${mine ? '' : face}
        <div class="bubble"><span class="bubble-text">${esc(m.text)}</span>${
          m.editedAt ? '<span class="bubble-edited">edited</span>' : ''
        }</div>
        ${actions}
      </div>
    </li>`;
  }

  // The strip above the input: what you're replying to, or that you're
  // editing rather than writing something new.
  function drawComposer() {
    const bar = root.querySelector('#chat-context');
    if (!bar) return;
    const target = chatEditing ?? chatReplyTo;
    if (!target) {
      bar.hidden = true;
      setHTML(bar, '');
      els.chatForm?.classList.remove('is-editing');
      return;
    }
    const m = chatLog.find((x) => x.id === target);
    bar.hidden = false;
    els.chatForm?.classList.toggle('is-editing', chatEditing != null);
    setHTML(
      bar,
      `<span class="ctx-kind">${chatEditing ? 'Editing' : `Replying to ${esc(m?.name || '')}`}</span>
       <span class="ctx-text">${esc(m?.text || '')}</span>
       <button class="ctx-x" data-msg-cancel aria-label="Cancel">${icons.fold}</button>`
    );
  }

  // How many messages arrived while the panel was shut. A count rather than a
  // plain dot: three missed messages and thirty look nothing alike.
  function drawUnread() {
    const dot = root.querySelector('.chat-dot');
    if (!dot) return;
    dot.hidden = chatUnread === 0;
    dot.textContent = chatUnread > 99 ? '99+' : String(chatUnread);
    dot.classList.toggle('is-wide', chatUnread > 9);
  }

  const chatShowing = () => mode === 'waiting' || chatOpen;

  function applyChatOpen() {
    if (mode === 'waiting') return; // the panel is part of the page here
    root.querySelector('.table-screen')?.classList.toggle('show-chat', chatOpen);
    if (els?.chat) els.chat.setAttribute('aria-hidden', String(!chatOpen));
    const btn = root.querySelector('[data-chat]');
    if (btn) {
      btn.classList.toggle('is-off', !chatOpen);
      btn.setAttribute('aria-pressed', String(chatOpen));
    }
    if (chatOpen) {
      chatUnread = 0;
      drawUnread();
      scrollChatToEnd();
    }
  }

  // On a phone both side panels float over the felt, so only one may be open
  // at a time whichever way round they're opened.
  const narrow = () => window.matchMedia('(max-width: 1024px)').matches;

  // Remembered on this browser, like the panel's own open state.
  function setShowResults(on) {
    showResults = on;
    setSetting('showResults', on);
    const btn = root.querySelector('[data-chat-results]');
    if (btn) {
      const label = on ? 'Hide each hand’s winner' : 'Show each hand’s winner';
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    play('click');
    drawChat({ keepUnread: true });
  }

  function setChatOpen(on) {
    chatOpen = on;
    setSetting('showChat', on);
    if (on && historyOpen && narrow()) setHistoryOpen(false);
    // The watchers list floats over the same corner of a phone screen.
    if (on && specOpen && narrow()) {
      specOpen = false;
      drawSpectators(shown);
    }
    applyChatOpen();
    drawVotes(); // the toast shifts aside for the panel
  }

  function setHistoryOpen(on) {
    historyOpen = on;
    setSetting('showHistory', on);
    if (on && chatOpen && narrow()) setChatOpen(false);
    applyHistoryOpen();
  }

  // The panel itself. `waiting` swaps the floating column for one that sits
  // in the waiting room's layout, with no close button — there it's simply
  // part of the page rather than something covering the felt.
  function chatAsideHTML(waiting = false) {
    return `<aside class="${waiting ? 'waiting-chat' : 'chat'}"${waiting ? ' data-enter' : ''} id="chat" aria-label="Table chat">
      <div class="chat-head"><span>Table chat</span>
        <button class="chat-x chat-results${showResults ? ' is-on' : ''}" data-chat-results
          aria-pressed="${showResults}"
          title="${showResults ? 'Hide each hand’s winner' : 'Show each hand’s winner'}"
          aria-label="${showResults ? 'Hide each hand’s winner' : 'Show each hand’s winner'}">${icons.trophy}</button>
        ${waiting ? '' : `<button class="chat-x" data-chat-close aria-label="Close chat">${icons.fold}</button>`}
      </div>
      <div class="chat-scroll">
        <ol class="chat-log" id="chat-log"></ol>
        <button class="chat-jump" id="chat-jump" type="button" hidden></button>
      </div>
      <div class="chat-context" id="chat-context" hidden></div>
      <form class="chat-form" id="chat-form">
        <textarea class="input" id="chat-input" rows="1" maxlength="240" autocomplete="off"
          placeholder="Say something…" aria-label="Message"></textarea>
        <div class="emoji-wrap">
          <div class="emoji-pop" id="emoji-pop" hidden></div>
          <button class="btn btn-ghost btn-icon chat-emoji" type="button" data-emoji-toggle
            aria-expanded="false" aria-controls="emoji-pop" title="Emoji" aria-label="Emoji">${icons.emoji}</button>
        </div>
        <button class="btn btn-primary btn-icon" type="submit" aria-label="Send">${icons.send}</button>
      </form>
    </aside>`;
  }

  // Caches the panel's elements on `els` after either screen has drawn it.
  function captureChatEls() {
    const $ = (id) => root.querySelector(`#${id}`);
    els = els || {};
    els.chat = $('chat');
    els.chatLog = $('chat-log');
    els.chatJump = $('chat-jump');
    els.chatForm = $('chat-form');
    els.chatInput = $('chat-input');
    els.emojiPop = $('emoji-pop');
    // A panel drawn fresh with the screen has nothing open in it.
    emojiOpen = false;
  }

  // The box grows down the way a message does, instead of scrolling a single
  // line sideways. Capped so a long message can't swallow the whole panel.
  // scrollHeight measures the content box, and the field is sized border-box,
  // so the borders have to be added back - without them every line sits two
  // pixels short of its own text and the scrollbar never goes away.
  const INPUT_MAX = 120;
  function autoSizeInput() {
    const el = els?.chatInput;
    if (!el) return;
    const cs = getComputedStyle(el);
    const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + borders, INPUT_MAX)}px`;
  }

  function wireChat() {
    root.querySelector('[data-chat]')?.addEventListener('click', () => {
      setChatOpen(!chatOpen);
      // Not on a phone: focusing the box summons the keyboard, which used to
      // shove the whole table sideways just for opening the messages. There
      // the panel opens quietly and the box is a tap away when they want it.
      if (chatOpen && !narrow()) els.chatInput?.focus();
    });

    els.chatForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = els.chatInput.value.trim();
      if (!text) return;
      const editing = chatEditing;
      const replyTo = chatReplyTo;
      els.chatInput.value = '';
      autoSizeInput();
      chatEditing = null;
      chatReplyTo = null;
      drawComposer();
      try {
        if (editing != null) await emitAck('chatEdit', { id: editing, text });
        else await emitAck('chat', { text, replyTo });
      } catch (err) {
        // Put it back exactly as it was, so nothing is lost to an error.
        els.chatInput.value = text;
        autoSizeInput();
        chatEditing = editing;
        chatReplyTo = replyTo;
        drawComposer();
        showError(err.message);
      }
    });

    // Escape backs out of replying or editing.
    els.chatInput?.addEventListener('input', autoSizeInput);
    els.chatInput?.addEventListener('keydown', (e) => {
      // A textarea would otherwise take Enter as a newline; sending is what
      // people expect from it, so a line break needs Shift.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        els.chatForm.requestSubmit();
        return;
      }
      if (e.key !== 'Escape') return;
      if (chatEditing == null && chatReplyTo == null) return;
      e.stopPropagation();
      cancelComposer();
    });

    // Leaving the foot of the log raises the way back; returning clears it.
    els.chatLog?.addEventListener('scroll', () => {
      if (chatAtBottom()) chatMissed = [];
      drawJump();
    });
    els.chatJump?.addEventListener('click', () => {
      scrollChatToEnd();
      play('click');
    });

    els.chat?.addEventListener('click', onChatClick);
    // Only the grid is redrawn as they type, so the field they're typing
    // into survives the search.
    els.emojiPop?.addEventListener('input', (e) => {
      if (!e.target.matches('[data-emoji-find]')) return;
      emojiQuery = e.target.value;
      drawEmojiGrid();
    });
  }

  // ---------------------------------------------------------------------------
  // The emoji picker
  // ---------------------------------------------------------------------------
  // Every emoji there is, grouped the way Unicode groups them. The set is
  // kept as its own file rather than in this script: it's fetched the first
  // time somebody opens the picker and not at all for the people who never
  // do, and the table loads no slower for carrying it.
  const EMOJI_SRC = '/data/emoji.json';
  const EMOJI_FOUND_MAX = 240; // drawn at once while searching

  function loadEmoji() {
    if (emojiGroups) return Promise.resolve(emojiGroups);
    if (!emojiLoading) {
      emojiLoading = fetch(EMOJI_SRC)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no emoji'))))
        .then((groups) => {
          emojiGroups = groups;
          return groups;
        })
        .catch(() => {
          emojiLoading = null; // a later open may still find the network
          return null;
        });
    }
    return emojiLoading;
  }

  const emojiTotal = () => (emojiGroups || []).reduce((n, g) => n + g.emoji.length, 0);

  async function setEmojiOpen(on) {
    if (!els?.emojiPop) return;
    emojiOpen = on;
    els.chat?.querySelector('[data-emoji-toggle]')?.setAttribute('aria-expanded', String(on));
    els.emojiPop.hidden = !on;
    if (!on) return;
    emojiQuery = '';
    drawEmojiPop(); // opens on whatever is known, so the panel never hangs
    if (await loadEmoji()) {
      if (!emojiOpen) return; // closed again while it was loading
      drawEmojiPop();
      // Same reasoning as the message box: on a phone, focusing a field
      // throws the keyboard over the thing being picked from.
      if (!narrow()) els.emojiPop.querySelector('[data-emoji-find]')?.focus();
    }
  }

  // The frame: the groups to flick through, and the search that looks past
  // them. Drawn once per opening, so typing never replaces the field being
  // typed into - only the grid under it is redrawn.
  function drawEmojiPop() {
    if (!emojiGroups) {
      return setHTML(
        els.emojiPop,
        `<p class="emoji-note">${emojiLoading ? 'Fetching the emoji…' : 'The emoji list didn’t load.'}</p>`
      );
    }
    const tabs = emojiGroups
      .map(
        (g, i) =>
          `<button type="button" class="emoji-tab" data-emoji-tab="${i}" title="${esc(g.name)}" aria-label="${esc(g.name)}">${g.icon}</button>`
      )
      .join('');
    setHTML(
      els.emojiPop,
      `<div class="emoji-tabs" role="tablist">${tabs}</div>
       <label class="emoji-find">
         <input type="search" data-emoji-find autocomplete="off" aria-label="Search emoji"
           placeholder="Search ${emojiTotal()} emoji">
         <button type="button" class="emoji-x" data-emoji-clear hidden aria-label="Clear search">${icons.fold}</button>
       </label>
       <div class="emoji-grid" data-emoji-grid></div>`
    );
    drawEmojiGrid();
  }

  // What the search or the open group has to show. A search runs over every
  // group's names at once; without one the picker is simply that group.
  function drawEmojiGrid() {
    const grid = els.emojiPop?.querySelector('[data-emoji-grid]');
    if (!grid || !emojiGroups) return;
    const q = emojiQuery.trim().toLowerCase();
    const found = q
      ? emojiGroups.flatMap((g) => g.emoji).filter(([, name]) => name.includes(q)).slice(0, EMOJI_FOUND_MAX)
      : emojiGroups[emojiTab].emoji;
    els.emojiPop.querySelectorAll('[data-emoji-tab]').forEach((b) => {
      b.classList.toggle('is-on', !q && Number(b.dataset.emojiTab) === emojiTab);
    });
    // The way out of a search, there only while there is one to leave.
    const clear = els.emojiPop.querySelector('[data-emoji-clear]');
    if (clear) clear.hidden = !emojiQuery;
    setHTML(
      grid,
      found
        .map(
          ([ch, name]) =>
            `<button type="button" class="emoji-cell" data-emoji="${esc(ch)}" title="${esc(name)}" aria-label="${esc(name)}">${ch}</button>`
        )
        .join('') || '<p class="emoji-note">Nothing goes by that name.</p>'
    );
    grid.scrollTop = 0;
  }

  // Dropped in where the cursor is, replacing whatever is selected, the way
  // typing one would. The box keeps the cursor after it so a message can be
  // carried on without reaching for the mouse again.
  const CHAT_MAX = 240;
  function insertEmoji(ch) {
    const el = els?.chatInput;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + ch + el.value.slice(end);
    // The box holds 240 characters and an emoji is two of them: a message
    // already at the limit says so rather than silently dropping the pick.
    if (next.length > CHAT_MAX) return flagInvalid(el);
    el.value = next;
    const caret = start + ch.length;
    el.setSelectionRange(caret, caret);
    el.focus();
    autoSizeInput();
  }

  function cancelComposer() {
    chatEditing = null;
    chatReplyTo = null;
    els.chatInput.value = '';
    autoSizeInput();
    drawComposer();
  }

  async function onChatClick(e) {
    const menu = e.target.closest('[data-msg-menu]');
    const reply = e.target.closest('[data-msg-reply]');
    const edit = e.target.closest('[data-msg-edit]');
    const del = e.target.closest('[data-msg-delete]');
    const cancel = e.target.closest('[data-msg-cancel]');

    if (e.target.closest('[data-chat-results]')) return setShowResults(!showResults);
    if (e.target.closest('[data-chat-close]')) return setChatOpen(false);
    // The picker: its own button, the group tabs along its top, and the
    // emoji themselves. Picking one leaves the picker up - people send more
    // than one at a time, and closing after each would make a row of them a
    // chore.
    if (e.target.closest('[data-emoji-toggle]')) return setEmojiOpen(!emojiOpen);
    if (e.target.closest('[data-emoji-clear]')) {
      emojiQuery = '';
      const field = els.emojiPop.querySelector('[data-emoji-find]');
      if (field) {
        field.value = '';
        if (!narrow()) field.focus();
      }
      return drawEmojiGrid();
    }
    const tab = e.target.closest('[data-emoji-tab]');
    if (tab) {
      emojiTab = Number(tab.dataset.emojiTab);
      // Flicking to a group is a way of saying the search is done with.
      emojiQuery = '';
      const find = els.emojiPop.querySelector('[data-emoji-find]');
      if (find) find.value = '';
      return drawEmojiGrid();
    }
    const pick = e.target.closest('[data-emoji]');
    if (pick) return insertEmoji(pick.dataset.emoji);
    if (cancel) return cancelComposer();
    if (menu) {
      const id = Number(menu.dataset.msgMenu);
      chatMenuFor = chatMenuFor === id ? null : id;
      return drawChat({ keepUnread: true });
    }
    if (reply) {
      chatReplyTo = Number(reply.dataset.msgReply);
      chatEditing = null;
      chatMenuFor = null;
      drawChat({ keepUnread: true });
      return els.chatInput.focus();
    }
    if (edit) {
      const id = Number(edit.dataset.msgEdit);
      chatEditing = id;
      chatReplyTo = null;
      chatMenuFor = null;
      els.chatInput.value = chatLog.find((m) => m.id === id)?.text || '';
      autoSizeInput();
      drawChat({ keepUnread: true });
      els.chatInput.focus();
      return els.chatInput.select();
    }
    if (del) {
      const id = Number(del.dataset.msgDelete);
      chatMenuFor = null;
      if (chatEditing === id) cancelComposer();
      drawChat({ keepUnread: true });
      try {
        await emitAck('chatDelete', { id });
      } catch (err) {
        showError(err.message);
      }
      return;
    }
    // A click anywhere else in the panel shuts an open menu.
    if (chatMenuFor != null) {
      chatMenuFor = null;
      drawChat({ keepUnread: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Watchers
  // ---------------------------------------------------------------------------
  // Anyone who ran out of chips keeps their place in the room but gives up
  // their seat, so the felt isn't padded with empty stacks. They show up here
  // instead: an eye in the bottom corner that opens the list of who's
  // watching, built like the chat panel because it's the same kind of thing -
  // people in the room who aren't in the hand.
  function drawSpectators(cur) {
    if (!els?.spectators) return;
    const list = cur?.spectators || [];
    const isHost = cur?.hostUserId === user.id;
    // The eye stays out for the host even with nobody behind the table:
    // it's where they say whether there may be anyone there at all, and
    // that's a decision usually taken while the crowd is still empty.
    els.spectators.hidden = list.length === 0 && !isHost;
    if (els.spectators.hidden) {
      specOpen = false;
      els.specPanel.hidden = true;
      return;
    }
    els.specCount.textContent = compact(list.length);
    const btn = els.spectators.querySelector('[data-spec]');
    btn.setAttribute('aria-expanded', String(specOpen));
    btn.classList.toggle('is-open', specOpen);
    btn.title = list.length ? `${fmt(list.length)} watching` : 'Nobody is watching';
    els.specPanel.hidden = !specOpen;
    if (!specOpen) return;
    const allows = cur?.allowSpectators !== false;
    setHTML(
      els.specPanel,
      `<div class="spec-head">${icons.eye}Watching<b>${compact(list.length)}</b></div>
       ${
         isHost
           ? `<label class="spec-allow">
               <span>Let people watch<small>${
                 allows ? 'Anyone with the code can pull up a chair' : 'The door is shut — nobody new can watch'
               }</small></span>
               <input type="checkbox" data-allow-specs ${allows ? 'checked' : ''}>
             </label>`
           : ''
       }
       ${list.length ? '' : '<p class="spec-none">Nobody is watching.</p>'}
       <ul class="spec-list">${list
         .map(
           (sp) => `<li class="spec-row${sp.userId === user.id ? ' is-me' : ''}">
             <span class="spec-face">${avatarSVG(sp.username)}</span>
             <span class="spec-who"><span class="spec-name">${esc(sp.username)}</span>${
               sp.userId === user.id ? '<em>you</em>' : ''
             }</span>
             ${sp.bust ? '<span class="spec-why" title="Out of chips">0</span>' : ''}
             ${
               isHost && sp.userId !== user.id
                 ? `<span class="spec-acts">
                     <button class="spec-act" data-spec-remove="${sp.userId}" title="Remove ${esc(sp.username)}" aria-label="Remove ${esc(sp.username)}">${icons.fold}</button>
                     <button class="spec-act is-block" data-spec-block="${sp.userId}" title="Block ${esc(sp.username)} from the room" aria-label="Block ${esc(sp.username)}">${icons.leave}</button>
                   </span>`
                 : ''
             }
           </li>`
         )
         .join('')}</ul>`
    );
  }

  // ---------------------------------------------------------------------------
  // Vote-kick toasts
  // ---------------------------------------------------------------------------
  function onVotes(payload) {
    openVotes = payload?.open || [];
    drawVotes();
  }

  function drawVotes() {
    let host = root.querySelector('#vote-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'vote-host';
      host.className = 'vote-host';
      host.addEventListener('click', onVoteClick);
      root.appendChild(host);
    }
    // Sits clear of the chat panel when that's open, so a vote never lands
    // on top of the messages.
    host.classList.toggle('is-shifted', chatOpen && mode === 'table');
    const others = openVotes.filter((v) => v.userId !== user.id);
    // Only the host is sent these: somebody with the code is at the door of a
    // private room, waiting to be let in.
    const knocks = (shown?.knocks || [])
      .map(
        (k) => `<div class="vote-toast is-knock" role="status">
          <div class="vote-top">
            <span class="vote-face">${avatarSVG(k.username)}</span>
            <span class="vote-text">
              <b>${esc(k.username)}</b>
              <em>${icons.key}Knocking at your private room</em>
            </span>
          </div>
          <div class="vote-acts">
            <button class="vote-btn is-no" data-knock-deny="${k.userId}">Not now</button>
            <button class="vote-btn is-let" data-knock-allow="${k.userId}">Let them in</button>
          </div>
        </div>`
      )
      .join('');
    setHTML(
      host,
      knocks +
      others
        .map((v) => {
          const kicked = v.voters.includes(user.id);
          const keeps = (v.keepers || []).length;
          const kept = (v.keepers || []).includes(user.id);
          // Both sides on one bar: kick fills from the left, keep from the right,
          // so a Keep visibly lands somewhere instead of changing nothing.
          const total = Math.max(v.needed, v.votes + keeps);
          const kickPct = Math.round((v.votes / total) * 100);
          const keepPct = Math.round((keeps / total) * 100);
          const left = Math.max(0, v.needed - v.votes);
          return `<div class="vote-toast is-vote" role="status">
            <div class="vote-top">
              <span class="vote-face">${avatarSVG(v.name)}</span>
              <span class="vote-text">
                <b>Remove ${esc(v.name)}?</b>
                <em>${left ? `${left} more vote${left === 1 ? '' : 's'} removes them` : 'The table has decided'}</em>
              </span>
            </div>
            <div class="vote-bar"><i class="is-kick" style="width:${kickPct}%"></i><i class="is-keep" style="width:${keepPct}%"></i></div>
            <div class="vote-tally">
              <span class="t-kick"><b>${v.votes}</b> kick</span>
              <span class="vote-need">${v.needed} needed</span>
              <span class="t-keep"><b>${keeps}</b> keep</span>
            </div>
            ${
              kicked || kept
                ? `<div class="vote-done ${kicked ? 'is-kick' : 'is-keep'}">${icons.check}You voted to ${kicked ? 'remove' : 'keep'} them</div>`
                : `<div class="vote-acts">
                    <button class="vote-btn is-keep" data-keep="${v.userId}">Keep</button>
                    <button class="vote-btn is-kick" data-vote="${v.userId}">Remove</button>
                  </div>`
            }
          </div>`;
        })
        .join('')
    );
  }

  async function onVoteClick(e) {
    const kick = e.target.closest('[data-vote]');
    const keep = e.target.closest('[data-keep]');
    const allow = e.target.closest('[data-knock-allow]');
    const deny = e.target.closest('[data-knock-deny]');
    if (!kick && !keep && !allow && !deny) return;
    try {
      if (kick) await emitAck('voteKick', { userId: Number(kick.dataset.vote) });
      else if (keep) await emitAck('voteKeep', { userId: Number(keep.dataset.keep) });
      else if (allow) await emitAck('answerKnock', { userId: Number(allow.dataset.knockAllow), allow: true });
      else await emitAck('answerKnock', { userId: Number(deny.dataset.knockDeny), allow: false });
    } catch (err) {
      showError(err.message);
    }
  }

  // Table news from the server: someone joined, left or was removed.
  function onNotice(payload) {
    if (payload?.text) showNotice(payload.text);
  }

  // The room is gone (the host left, or it emptied out). No more state is
  // coming, so step back to the lobby and say why rather than leaving a dead
  // table on screen.
  function onRoomClosed(payload) {
    if (payload?.code && payload.code !== roomCode) return;
    exit(payload?.reason || 'That room was closed.', true);
  }

  // ---------------------------------------------------------------------------
  // Full-screen overlays: the end of a game, and running out of chips
  // ---------------------------------------------------------------------------
  // Lives directly on `root`, as a sibling of whichever screen is drawn, so
  // that rebuilding the table or the waiting room doesn't remove it.
  function overlayHost() {
    let el = root.querySelector('#overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'overlay';
      el.className = 'overlay is-empty';
      el.addEventListener('click', onOverlayClick);
      el.addEventListener('input', onSettingsChange);
      el.addEventListener('change', onSettingsChange);
      // Swatches in the settings sheet: picked here, the felt changes under
      // the sheet so the choice can be seen while it's being made.
      wireThemePicker(el, redressTable);
      root.appendChild(el);
    }
    // Never moved once it's there. A screen rebuild wipes root, so the
    // overlay is rebuilt from scratch anyway; the only thing that ever put
    // it out of order was the vote host being appended after it, and moving
    // the node for that replayed the open sheet's entrance - which is how a
    // tutorial shown as a game started appeared to pop a second time on the
    // next update. Stacking is settled by z-index, not by order.
    return el;
  }

  function drawOverlay(cur) {
    const el = overlayHost();
    // An open settings sheet keeps itself up to date in place. Rebuilding it
    // replaces the node under the switch being pressed, which replays its
    // entrance animation — every toggle made the panel blink out and back.
    if (askingSettings && el.querySelector('.sheet-settings')) return syncSettingsSheet();
    // Same reasoning, for the sheet on its way out: an update arriving in
    // those few frames would replace the node mid-animation and the sheet
    // would vanish instead of leaving.
    if (tutorialClosing) return;
    const html = overlayHTML(cur);
    el.classList.toggle('is-empty', !html);
    setHTML(el, html);
    // The swatch grids have only just been given a size, so whether they
    // overflow - and so whether their arrows belong - is measured now.
    if (askingSettings) syncThemeArrows(el);
  }

  function overlayHTML(cur) {
    if (askingLeave) return leaveConfirmHTML(cur);
    if (askingTutorial) return tutorialHTML();
    if (askingTransfer != null) return transferConfirmHTML(cur);
    if (askingSettings) return settingsHTML();
    const over = cur.gameOver;
    if (over && dismissedGameOver !== gameOverKey(over)) return celebrationHTML(over);
    // Out of chips: the seat is already given up, but staying to watch is
    // still a choice, so it's asked rather than assumed. Nobody who chose to
    // watch from the lobby is asked anything - they've already decided.
    const busted = (cur.spectators || []).some((sp) => sp.userId === user.id && sp.bust);
    if (!busted) bustAnswered = false; // dealt back in; ask again next time
    if (busted && !bustAnswered) return bustedHTML(cur);
    return '';
  }

  const gameOverKey = (o) => `${o.hands}:${o.winner?.userId ?? 'none'}`;

  // Every sheet closes from its own top-right corner as well as from its
  // buttons and the dimmed area around it, since a corner cross is where
  // people look first. `dismiss` is read by onOverlayClick, which knows which
  // sheet is open and what backing out of it means.
  const sheetX = `<button type="button" class="sheet-x" data-ov="dismiss" aria-label="Close" title="Close">${icons.close}</button>`;

  // The three gestures the table is played with. Each one is shown rather
  // than described, and shown with the table's own pieces - the real cards,
  // the real chips, the real buttons, on the cloth the player has chosen -
  // so that what they read here is exactly what they will see in front of
  // them a moment later.
  function tutorialHTML() {
    const s = getSettings();
    const felt = feltTheme(s.felt);
    const back = cardBackSVG(s.cardBack);
    const hole = `<div class="tut-card">${back}</div><div class="tut-card">${back}</div>`;
    const board = ['5c', '4s', 'Td']
      .map((c) => `<div class="tut-card is-board">${cardFaceSVG(c)}</div>`)
      .join('');
    // The scene and the words share one panel, the picture on the left and
    // what it means on the right, so a step costs one row instead of two.
    const stage = (cls, inner) => `<div class="tut-scene ${cls}" aria-hidden="true">${inner}</div>`;

    const steps = [
      {
        stage: stage(
          'tut-fold',
          `<div class="tut-board">${board}</div>
           <div class="tut-hand is-thrown">${hole}</div>
           <span class="tut-banner">Release to fold</span>`
        ),
        title: 'Throw your cards in to fold',
        body: 'Drag your hand out onto the table and let go.',
      },
      {
        stage: stage(
          'tut-bet',
          `<div class="tut-hand">${hole}</div>
           <div class="tut-chip">${chipSVG(1000)}</div>
           <div class="tut-pending">
             <div class="tut-pending-chips">${chipStackSVG(13000, { maxCols: 2, maxPerCol: 5 })}<span class="pending-amt">+13k</span></div>
             <div class="tut-pending-actions">
               <span class="pending-btn is-raise">Bet <b>13k</b></span>
               <span class="pending-btn is-clear">${icons.fold}</span>
             </div>
           </div>`
        ),
        title: 'Drag chips out to bet or raise',
        body: 'Take a chip from the tray onto the felt, then press the button that appears.',
      },
      {
        stage: stage(
          'tut-check',
          `<div class="tut-hand">${hole}</div>
           <span class="tut-tap"></span>
           <span class="tut-check">Check</span>`
        ),
        title: 'Double-tap the table to check',
        body: 'Two taps anywhere on the felt, when there is nothing to call.',
      },
    ];

    return `<div class="sheet sheet-tutorial" role="dialog" aria-modal="true" aria-label="How this table is played">
      ${sheetX}
      <h2 class="sheet-title">How this table is played</h2>
      <p class="sheet-sub">Three gestures, and you know the whole game.</p>
      <ol class="tut-steps">
        ${steps
          .map(
            (st, i) => `<li class="tut-step tut-stage" style="--felt-a:${felt.felt[0]};--felt-b:${felt.felt[1]};--felt-c:${felt.felt[2]}">
          ${st.stage}
          <div class="tut-text"><span class="tut-no">${i + 1}</span>
            <div><b>${st.title}</b><span>${st.body}</span></div>
          </div>
        </li>`
          )
          .join('')}
      </ol>
      <div class="tut-foot">
        <label class="switch-row tut-again">
          <input type="checkbox" data-set="showTutorial" ${s.showTutorial ? 'checked' : ''}>
          <span>Show this at the start of every game</span>
        </label>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-lg" data-ov="tutorial-ok">${icons.check}Yes, I understand</button>
        </div>
      </div>
    </div>`;
  }

  function celebrationHTML(over) {
    const w = over.winner;
    const iWon = w?.userId === user.id;
    return `<div class="sheet sheet-win" role="dialog" aria-modal="true" aria-label="Game over">
      ${sheetX}
      <div class="sheet-kicker">${over.hands} hand${over.hands === 1 ? '' : 's'} played</div>
      <div class="sheet-crown">${icons.crown}</div>
      <h2 class="sheet-title">${iWon ? 'You win!' : `${esc(w?.username || 'Nobody')} wins!`}</h2>
      <p class="sheet-sub">${iWon ? 'Every chip on the table is yours.' : 'They finished with every chip on the table.'}</p>
      <div class="sheet-stack">${chipStackSVG(w?.chips || 0, { maxCols: 6, maxPerCol: 6 })}</div>
      <div class="sheet-amt">${fmt(w?.chips || 0)}</div>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-lg" data-ov="close">Back to the waiting room</button>
        <button class="btn btn-ghost" data-ov="leave">Leave room</button>
      </div>
    </div>`;
  }

  // What sits under the avatar in the bar at the top of the table. Leaving
  // isn't in here: it stays a button of its own beside the avatar, because
  // it's the one thing on this bar people reach for in a hurry.
  const TOPBAR_MENU = [[{ id: 'settings', icon: icons.gear, label: 'Table settings' }]];

  // Which section of the settings sheet is showing. Kept out here so it
  // survives a rebuild of the sheet and you come back to where you were.
  const SET_TABS = ['cards', 'look', 'feel'];
  const tabButton = (id, icon, label) =>
    `<button type="button" class="set-tab${settingsTab === id ? ' is-on' : ''}" role="tab"
      aria-selected="${settingsTab === id}" data-tab="${id}">${icon}<span>${label}</span></button>`;
  const panelHidden = (id) => (settingsTab === id ? '' : 'hidden');

  // The same visual settings the lobby offers, reachable without leaving the
  // table. Everything here is per-browser and takes effect on the next draw.
  function settingsHTML() {
    const s = getSettings();
    const zoomOff = s.autoReveal || !s.peekZoom;
    return `<div class="sheet sheet-settings" role="dialog" aria-modal="true" aria-label="Table settings">
      ${sheetX}
      <h2 class="sheet-title">Table settings</h2>
      <div class="set-split">
        <nav class="set-nav" role="tablist" aria-label="Settings sections">
          <span class="set-nav-head">Play</span>
          ${tabButton('cards', icons.eye, 'Your cards')}
          <span class="set-nav-head">Table</span>
          ${tabButton('look', icons.sparkle, 'Appearance')}
          ${tabButton('feel', icons.soundOn, 'Motion &amp; sound')}
        </nav>
        <div class="set-pane">
          <section class="set-panel" data-panel="cards" role="tabpanel" ${panelHidden('cards')}>
            <h3 class="set-lede">How your own cards behave</h3>
            <p class="set-note">Only you see this. Nobody at the table is told how you look at your hand.</p>
            <label class="switch-row">
              <input type="checkbox" data-set="autoReveal" ${s.autoReveal ? 'checked' : ''}>
              <span>Turn my cards face up as soon as they're dealt<small>Nothing left to peek at, and the table can't see you looking</small></span>
            </label>
            <label class="switch-row">
              <input type="checkbox" data-set="peekZoom" ${s.peekZoom ? 'checked' : ''} ${s.autoReveal ? 'disabled' : ''}>
              <span>Zoom in on my cards when peeking</span>
            </label>
            <label class="switch-row">
              <input type="checkbox" data-set="showTutorial" ${s.showTutorial ? 'checked' : ''}>
              <span>Show how to play when a game starts<small>Peeking, folding and betting by drag - the guide you can switch off from the guide itself</small></span>
            </label>
            <div class="set-field" data-zoom-field ${zoomOff ? 'hidden' : ''}>
              <label for="set-zoom-level">Zoom strength <b>${s.zoomLevel.toFixed(2)}×</b></label>
              <input class="range" type="range" id="set-zoom-level" data-set="zoomLevel"
                min="${ZOOM.level.min}" max="${ZOOM.level.max}" step="${ZOOM.level.step}" value="${s.zoomLevel}">
            </div>
            <div class="set-field" data-zoom-field ${zoomOff ? 'hidden' : ''}>
              <label for="set-zoom-speed">Zoom speed <b>${s.zoomSpeed} ms</b></label>
              <input class="range" type="range" id="set-zoom-speed" data-set="zoomSpeed"
                min="${ZOOM.speed.min}" max="${ZOOM.speed.max}" step="${ZOOM.speed.step}" value="${s.zoomSpeed}">
            </div>
          </section>
          <section class="set-panel" data-panel="look" role="tabpanel" ${panelHidden('look')}>
            <h3 class="set-lede">How the table looks to you</h3>
            <p class="set-note">Yours alone — everyone here can sit at a different-looking felt.</p>
            ${themePickerHTML(s)}
          </section>
          <section class="set-panel" data-panel="feel" role="tabpanel" ${panelHidden('feel')}>
            <h3 class="set-lede">Motion and sound</h3>
            <p class="set-note">Turn either off if the table feels busy, or to save a slower device some work.</p>
            <label class="switch-row">
              <input type="checkbox" data-set="motion" ${reduceMotion ? '' : 'checked'}>
              <span>Animations<small>Cards dealing, chips moving, the countdown ring</small></span>
            </label>
            <label class="switch-row">
              <input type="checkbox" data-set="sound" ${soundMuted() ? '' : 'checked'}>
              <span>Sounds<small>Chips, the flip of a card, your turn coming round</small></span>
            </label>
          </section>
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-lg" data-ov="settings-close">Done</button>
      </div>
    </div>`;
  }

  function bustedHTML(cur) {
    const live = cur.table.seats.filter((s) => s && !s.left && s.chips > 0).length;
    return `<div class="sheet sheet-bust" role="dialog" aria-modal="true" aria-label="Out of chips">
      ${sheetX}
      <div class="sheet-crown is-bust">${icons.allin}</div>
      <h2 class="sheet-title">You're out of chips</h2>
      <p class="sheet-sub">Your seat has gone back to the table. ${live} player${
        live === 1 ? ' is' : 's are'
      } still in — stay and watch how it ends, or head back to the lobby.</p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-lg" data-ov="spectate">${icons.eye}Watch the rest</button>
        <button class="btn btn-ghost" data-ov="leave">${icons.leave}Leave room</button>
      </div>
      <p class="sheet-note">You're dealt back in with a fresh stack when the next game starts.</p>
    </div>`;
  }

  // Handing the room over is not something to do by accident: it's the one
  // action here that takes something away from you and can't be undone from
  // your side afterwards.
  function transferConfirmHTML(cur) {
    const who =
      cur.table.seats.find((p) => p && p.userId === askingTransfer)?.username ||
      cur.lobby.find((p) => p.userId === askingTransfer)?.username;
    // They left while the question was on screen.
    if (!who) {
      askingTransfer = null;
      return '';
    }
    return `<div class="sheet sheet-ask" role="dialog" aria-modal="true" aria-label="Hand the room over">
      ${sheetX}
      <div class="sheet-crown">${icons.key}</div>
      <h2 class="sheet-title">Make ${esc(who)} the owner?</h2>
      <p class="sheet-sub">They'll deal the hands, set the stakes and answer the door, and closing the room becomes theirs to do. You'll stay at the table as an ordinary player — and you can't take it back yourself.</p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-lg" data-ov="transfer-yes">${icons.key}Hand it over</button>
        <button class="btn btn-ghost" data-ov="transfer-no">Keep the room</button>
      </div>
    </div>`;
  }

  function leaveConfirmHTML(cur) {
    const host = cur.hostUserId === user.id;
    const others = new Set([
      ...cur.lobby.map((p) => p.userId),
      ...cur.table.seats.filter(Boolean).map((p) => p.userId),
    ]);
    others.delete(user.id);
    const n = others.size;
    const mid = cur.table.phase !== 'waiting';
    return `<div class="sheet sheet-ask" role="dialog" aria-modal="true" aria-label="Leave the room">
      ${sheetX}
      <div class="sheet-crown is-bust">${icons.leave}</div>
      <h2 class="sheet-title">${host ? 'Close the room?' : 'Leave the room?'}</h2>
      <p class="sheet-sub">${
        host
          ? `You're the host, so leaving ends the room for everyone${
              n ? ` — ${n} other player${n === 1 ? '' : 's'} will be sent back to the lobby` : ''
            }. This can't be undone.`
          : mid
            ? 'Your chips stay on the table and the hand carries on without you.'
            : 'You can rejoin later with the room code.'
      }</p>
      <div class="sheet-actions">
        <button class="btn ${host ? 'btn-danger' : 'btn-primary'} btn-lg" data-ov="leave-yes">${host ? 'Close the room' : 'Leave'}</button>
        <button class="btn btn-ghost" data-ov="leave-no">Stay</button>
      </div>
    </div>`;
  }

  function onSettingsChange(e) {
    const el = e.target.closest('[data-set]');
    if (!el) return;
    const key = el.dataset.set;
    if (key === 'motion') {
      if (el.checked === reduceMotion) toggleMotion();
      reduceMotion = motionReduced();
    } else if (key === 'sound') {
      if (el.checked === soundMuted()) toggleSound();
    } else if (key === 'zoomLevel' || key === 'zoomSpeed') {
      const v = Number(el.value);
      setSetting(key, v);
      // Only the figure beside the label is touched: redrawing the sheet
      // mid-drag would tear the slider out from under the finger.
      const out = el.closest('.set-field')?.querySelector('b');
      if (out) out.textContent = key === 'zoomLevel' ? `${v.toFixed(2)}×` : `${v} ms`;
      return;
    } else {
      setSetting(key, el.checked);
    }
    // Updated where it stands rather than redrawn. Rebuilding the sheet
    // replaced the node under the switch, which replayed its entrance
    // animation — the panel appeared to blink out and back on every toggle.
    syncSettingsSheet();
    if (key === 'autoReveal' || key === 'motion') draw(); // the felt changes too
  }

  // The only parts of the settings sheet that answer to another control:
  // turning the cards face up takes the peek zoom out of play.
  // The cloth is cut to the shape of the table it's going on - stretching it
  // would turn the rounded ends back into elliptical ones - so the felt is
  // redrawn whenever the table changes shape. Measured rather than assumed,
  // since the portrait layout is a container query the stylesheet owns.
  function feltAspect() {
    const w = els?.camera?.clientWidth;
    const h = els?.camera?.clientHeight;
    return w && h ? w / h : 1.9;
  }
  // The aspect the cloth on screen was cut for, so a resize that doesn't
  // change the shape doesn't rebuild it.
  let feltCutFor = 0;
  let feltWatch = null;

  function drawFelt() {
    const felt = els?.camera?.querySelector('.felt');
    if (!felt) return;
    feltCutFor = feltAspect();
    setHTML(felt, feltSVG(getSettings().felt, feltCutFor));
  }

  function redressTable() {
    if (mode !== 'table' || !els?.camera) return;
    const s = getSettings();
    drawFelt();
    if (els.feltLogo) setHTML(els.feltLogo, feltLogoSVG(feltTheme(s.felt).logo));
    draw(); // the card backs, wherever they are
  }

  function syncSettingsSheet() {
    const sheet = root.querySelector('.sheet-settings');
    if (!sheet) return;
    const s = getSettings();
    const zoom = sheet.querySelector('[data-set="peekZoom"]');
    if (zoom) zoom.disabled = s.autoReveal;
    // Only the two zoom sliders follow the peek switch. This used to say
    // '.set-field', which was every field in the sheet back when the sliders
    // were the only ones - the felt and card-back rows are fields too, so
    // with peek zoom off they were hidden along with them.
    const off = s.autoReveal || !s.peekZoom;
    sheet.querySelectorAll('[data-zoom-field]').forEach((f) => (f.hidden = off));
  }

  // Backs out of whichever sheet is up, if it's one you're allowed to
  // decline. The end of a game and busting out both need a real answer, so
  // they aren't listed here.
  // The tutorial leaves the way it arrived rather than blinking out. The
  // state is only flipped once the sheet has played its exit, because
  // flipping it redraws the overlay and would take the sheet with it.
  const TUTORIAL_OUT_MS = 240;
  function closeTutorial() {
    if (tutorialClosing) return;
    const sheet = root.querySelector('.sheet-tutorial');
    if (!sheet || reduceMotion) {
      askingTutorial = false;
      return drawOverlay(shown);
    }
    const host = root.querySelector('#overlay');
    tutorialClosing = true;
    sheet.classList.add('is-closing');
    host?.classList.add('is-closing');
    later(() => {
      tutorialClosing = false;
      askingTutorial = false;
      host?.classList.remove('is-closing');
      drawOverlay(shown);
    }, TUTORIAL_OUT_MS);
  }

  function closeSheet() {
    if (askingTutorial) return closeTutorial(), true;
    if (askingSettings) askingSettings = false;
    else if (askingLeave) askingLeave = false;
    else if (askingTransfer !== null) askingTransfer = null;
    else return false;
    drawOverlay(shown);
    return true;
  }

  function onOverlayClick(e) {
    // Clicking the dimmed area around a sheet backs out of it, the same as
    // its cancel button does.
    if (e.target === e.currentTarget) {
      if (closeSheet()) return;
      if (resultHand) return dismissResult(resultHand);
      return;
    }
    // Switching section swaps which panel is showing rather than rebuilding
    // the sheet: a rebuild would replay the sheet's entrance and throw away
    // where each swatch row had been scrolled to.
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      const id = tab.dataset.tab;
      if (!SET_TABS.includes(id) || id === settingsTab) return;
      settingsTab = id;
      const sheet = tab.closest('.sheet-settings');
      sheet.querySelectorAll('[data-tab]').forEach((b) => {
        const on = b === tab;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });
      sheet.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== id));
      sheet.querySelector('.set-pane').scrollTop = 0;
      return;
    }
    const btn = e.target.closest('[data-ov]');
    if (!btn) return;
    const kind = btn.dataset.ov;
    // The corner cross: back out of whichever sheet is up. The first three
    // are questions, so closing one is the same as answering no; the other
    // two are notices, and closing one puts it away for this game.
    if (kind === 'dismiss') {
      if (closeSheet()) return;
      if (shown?.gameOver) dismissedGameOver = gameOverKey(shown.gameOver);
      else bustAnswered = true; // staying on to watch, same as the button
      return drawOverlay(shown);
    }
    if (kind === 'tutorial-ok') return closeTutorial();
    if (kind === 'leave') { askingLeave = true; return drawOverlay(shown); }
    if (kind === 'leave-yes') return leaveRoom();
    if (kind === 'leave-no') askingLeave = false;
    if (kind === 'transfer-no') askingTransfer = null;
    if (kind === 'transfer-yes') {
      const target = askingTransfer;
      askingTransfer = null;
      drawOverlay(shown);
      emitAck('transferHost', { userId: target }).catch((err) => showError(err.message));
      return;
    }
    if (kind === 'settings-close') askingSettings = false;
    if (kind === 'spectate') {
      bustAnswered = true; // for this game only; being dealt back in clears it
      play('click');
    }
    if (kind === 'close' && shown?.gameOver) dismissedGameOver = gameOverKey(shown.gameOver);
    drawOverlay(shown);
  }

  function leaveRoom() {
    emitAck('leaveRoom').finally(exit);
  }

  function onRoomState(payload) {
    if (payload.code !== roomCode) return;
    latest = payload;
    if (payload.turn) {
      turnTotal = payload.turn.totalMs;
      turnEndsAt = performance.now() + payload.turn.remainingMs;
    } else {
      turnEndsAt = 0;
    }
    // The table keeps playing while you look at your cards: updates are drawn
    // as they arrive, and drawTable keeps the cards you're holding in place.
    draw();
  }

  function draw() {
    const prev = shown === latest ? null : shown; // null = redraw, not a step forward
    shown = latest;
    if (shown.table.phase === 'waiting') {
      if (mode !== 'waiting') enteredAt = performance.now(); // arriving
      mode = 'waiting';
      drawWaiting(shown); // keeps the chat panel, drops the table's elements
      resumeEntrance(root.querySelector('.screen'), enteredAt);
    } else if (mode !== 'table') {
      // Only a game this screen watched begin: the waiting room giving way
      // to the table. Loading straight onto a table - a reload, a reconnect,
      // a link into a game already going - is arriving, not a start, and
      // the first hand alone wasn't enough to tell them apart: every reload
      // during it brought the guide back.
      const started = mode === 'waiting';
      enteredAt = performance.now();
      buildTable();
      resumeEntrance(root.querySelector('.table-screen'), enteredAt);
      mode = 'table';
      renderedHand = 0; // fresh table: let the first hand deal in
      // A match is starting, so the three gestures it is played with are
      // worth a word - to someone holding cards; a spectator has no use for
      // them.
      const seated = shown.table.seats.some((p) => p && p.userId === user.id && !p.left);
      if (getSettings().showTutorial && seated && started) askingTutorial = true;
      drawTable(null, shown);
    } else {
      drawTable(prev && prev.table.phase !== 'waiting' ? prev : null, shown);
    }
    // Last, and outside the screen itself: both screens above rebuild their
    // own markup, which would take any overlay inside them with it.
    drawOverlay(shown);
    drawVotes();
    resetHistoryOnNewMatch();
    refreshHistoryNames();
  }

  // Someone renaming themselves changes how every hand they won is listed,
  // and what the winner filter offers. Redrawn only when a name has actually
  // changed, so an ordinary update doesn't throw away the scroll position or
  // close the cards somebody has open.
  // A match's hands are numbered from one, so the next match's hand #1 ran
  // straight into the last one's entry and overwrote it instead of being
  // added — which is why the log looked like it stopped recording after a
  // game was won. The log belongs to the match, so it starts empty with one.
  let seenGameOver = null;
  function resetHistoryOnNewMatch() {
    const over = shown?.gameOver;
    if (!over) return;
    const key = gameOverKey(over);
    if (seenGameOver === key) return;
    seenGameOver = key;
    if (!history.length) return;
    history.length = 0;
    expanded.clear();
    saveHistory();
    drawHistory();
  }

  let nameSig = '';
  function refreshHistoryNames() {
    if (!els?.historyList) return;
    const sig = [
      ...(shown?.table.seats || []).filter(Boolean).map((s) => `${s.userId}:${s.username}`),
      ...(shown?.lobby || []).map((l) => `${l.userId}:${l.username}`),
    ].join('|');
    if (sig === nameSig) return;
    nameSig = sig;
    drawHistory();
  }

  function showError(msg) {
    toast(msg, { info: false });
  }

  // Table news rather than a problem: who joined, who left.
  function showNotice(msg) {
    toast(msg, { info: true });
  }

  function toast(msg, { info }) {
    showToast(msg, { info });
  }

  // ---------------------------------------------------------------------------
  // Shared top bar
  // ---------------------------------------------------------------------------
  // `page` lines the bar's contents up with the column of content beneath it.
  // The table itself is full-bleed, so its bar stays full width too.
  function topbarHTML(t, { page = false } = {}) {
    return `<header class="topbar${page ? ' topbar-page' : ''}">
      <div class="brand">${icons.logo}<span>CC<em>Poker</em></span></div>
      <div class="topbar-meta">
      <span class="room-kind hide-sm${shown?.isPrivate ? ' is-private' : ''}" title="${
        shown?.isPrivate ? 'Hidden from open tables — the host lets each player in' : 'Listed in open tables for anyone to join'
      }">${shown?.isPrivate ? icons.key : icons.eye}${shown?.isPrivate ? 'Private' : 'Public'}</span>
        <span class="meta-chip">Room <b class="code selectable">${esc(roomCode)}</b>
          <button class="code-copy" data-copy-code="link" title="Copy invite link" aria-label="Copy invite link">${icons.copy}</button>
          <button class="code-copy" data-copy-code="code" title="Copy room code" aria-label="Copy room code">${icons.key}</button>
        </span>
        <span class="meta-chip hide-sm">Blinds <b>${fmt(t.smallBlind)}/${fmt(t.bigBlind)}</b></span>
        <span class="meta-chip hide-sm" id="hand-chip" ${t.handNumber ? '' : 'hidden'}>Hand <b id="hand-no">#${t.handNumber}</b></span>
      </div>
      <div class="topbar-user">
        ${userMenuHTML(user, TOPBAR_MENU)}
        <button class="btn btn-ghost btn-sm" data-leave aria-label="Leave room">${icons.leave}<span class="hide-sm">Leave</span></button>
      </div>
    </header>`;
  }

  function wireTopbar() {
    root.querySelector('[data-leave]').addEventListener('click', () => {
      askingLeave = true;
      drawOverlay(shown);
    });
    // Copying the code is how anyone else gets in, so it sits on the code
    // itself rather than only in the waiting room.
    root.querySelectorAll('[data-copy-code]').forEach((btn) => {
      const wantsLink = btn.dataset.copyCode === 'link';
      const idle = wantsLink ? icons.copy : icons.key;
      btn.addEventListener('click', async () => {
        if (!(await copyText(wantsLink ? inviteLink() : roomCode))) {
          return showError('Couldn’t reach the clipboard — the room code is in the bar beside this.');
        }
        btn.classList.add('is-done');
        btn.innerHTML = icons.check;
        later(() => {
          btn.classList.remove('is-done');
          btn.innerHTML = idle;
        }, 1400);
      });
    });
    wireUserMenu(root, user, {
      groups: TOPBAR_MENU,
      onPick: (id) => {
        if (id === 'settings') {
          askingSettings = true;
          drawOverlay(shown);
        }
      },
    });
    const hist = root.querySelector('[data-history]');
    hist?.addEventListener('click', () => {
      setHistoryOpen(!historyOpen);
      play('click');
    });
    root.querySelector('[data-history-close]')?.addEventListener('click', () => {
      setHistoryOpen(false);
      play('click');
    });

    wireHistoryFilters();
  }

  // --- Difficulty picker ---------------------------------------------------
  // A custom listbox rather than a native <select>, so each difficulty can
  // carry its own colour and a line explaining how it plays.
  function levelSelectHTML(selected, disabled) {
    const current = BOT_LEVELS.find((l) => l.id === selected) || BOT_LEVELS[1];
    return `<div class="picker ${levelClass(current.id)}" data-picker>
      <button type="button" class="picker-btn" data-picker-btn aria-haspopup="listbox" aria-expanded="false" ${disabled ? 'disabled' : ''}>
        <span class="dot"></span>
        <span class="picker-label">${current.label}</span>
        ${icons.chevron}
      </button>
      <ul class="picker-menu" role="listbox" aria-label="Bot difficulty" hidden>
        ${BOT_LEVELS.map(
          (l) => `<li role="option" tabindex="-1" data-value="${l.id}" class="${levelClass(l.id)}" aria-selected="${l.id === current.id}">
            <span class="dot"></span>
            <span class="picker-text"><b>${l.label}</b><em>${esc(l.desc)}</em></span>
          </li>`
        ).join('')}
      </ul>
    </div>`;
  }

  function wirePicker(onPick) {
    const picker = root.querySelector('[data-picker]');
    if (!picker) return;
    const btn = picker.querySelector('[data-picker-btn]');
    const menu = picker.querySelector('.picker-menu');
    const options = [...menu.querySelectorAll('li')];

    const open = (yes) => {
      menu.hidden = !yes;
      picker.classList.toggle('is-open', yes);
      btn.setAttribute('aria-expanded', String(yes));
      if (yes) (options.find((o) => o.getAttribute('aria-selected') === 'true') || options[0]).focus();
    };
    const choose = (li) => {
      const id = li.dataset.value;
      picker.className = `picker ${levelClass(id)}`;
      picker.querySelector('.picker-label').textContent = levelLabel(id);
      options.forEach((o) => o.setAttribute('aria-selected', String(o === li)));
      open(false);
      btn.focus();
      onPick(id);
    };

    btn.addEventListener('click', () => open(menu.hidden));
    options.forEach((li) => {
      li.addEventListener('click', () => choose(li));
      li.addEventListener('keydown', (e) => {
        const i = options.indexOf(li);
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose(li);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          options[(i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length].focus();
        } else if (e.key === 'Escape') {
          open(false);
          btn.focus();
        }
      });
    });
    // Clicking anywhere else closes it.
    document.addEventListener('pointerdown', (e) => {
      if (!picker.contains(e.target)) open(false);
    });
  }

  // ---------------------------------------------------------------------------
  // Waiting room
  // ---------------------------------------------------------------------------
  function drawWaiting(state) {
    const isHost = state.hostUserId === user.id;
    const t = state.table;
    const n = state.lobby.length;
    // Everyone starts on the same stack, so the host's own figure is the
    // table's figure — whoever else is here already matches it.
    const startChips = state.lobby.find((p) => p.userId === state.hostUserId)?.buyIn ?? 1000;
    // The waiting room redraws itself whole on every update, which would
    // take the chat panel - and the half-typed message in it - down with it.
    // The live node is lifted out beforehand and dropped back into the new
    // markup, so only the parts that actually changed are rebuilt.
    const keptChat = els?.chat?.classList.contains('waiting-chat') && root.contains(els.chat) ? els.chat : null;
    root.innerHTML = `<div class="screen">
      ${topbarHTML(t, { page: true })}
      <main class="page waiting-page">
        <section class="panel waiting-panel" data-enter>
          <div class="eyebrow">Waiting room</div>
          <h1 class="display">Gather your players</h1>
          <p class="lead">${isHost ? 'Share the code, set everyone’s starting chips, then deal the first hand.' : 'The host sets everyone’s starting chips and deals the first hand.'}</p>
          <div class="code-block">
            <div class="code-id"><div class="micro">Room code</div><div class="room-code selectable">${esc(roomCode)}</div></div>
            <span class="code-acts">
              <button class="btn btn-ghost btn-sm" data-copy="link" title="Copy a link that drops them straight into this room">${icons.copy}<span>Copy link</span></button>
              <button class="btn btn-ghost btn-sm" data-copy="code" title="Copy just the five-character code">${icons.copy}<span>Copy code</span></button>
            </span>
          </div>
          <div class="meta-row">
            <span class="seat-count"><b>${n}</b>/${t.maxSeats || 9} seats</span>
            ${isHost ? `<span class="add-bot">
              ${levelSelectHTML(botLevel, n >= (t.maxSeats || 9))}
              <button class="btn btn-ghost btn-sm" data-add-bot ${n >= (t.maxSeats || 9) ? 'disabled' : ''}>${icons.robot}Add bot</button>
            </span>` : ''}
          </div>
          <ul class="player-list">
            ${state.lobby.map((p) => `
              <li class="player-row${p.isBot ? ' is-bot' : ''}">
                <span class="avatar-sm">${p.isBot ? icons.robot : avatarSVG(p.username)}</span>
                <span class="pname">${esc(p.username)}${p.isBot ? `<span class="badge bot ${levelClass(p.botLevel)}">${esc(levelLabel(p.botLevel))}</span>` : ''}${p.userId === state.hostUserId ? `<span class="mark is-owner" title="Room owner" aria-label="Room owner" role="img">${icons.key}</span>` : ''}${p.userId === user.id ? '<span class="badge you">You</span>' : ''}</span>
                <span class="buyin">
                  <span class="amt">${fmt(p.buyIn)}</span>
                  <span class="micro">chips</span>
                  ${isHost && p.userId !== user.id ? `<button class="btn btn-ghost btn-icon" data-remove="${p.userId}" title="Remove ${esc(p.username)}" aria-label="Remove ${esc(p.username)}">${icons.fold}</button>` : '<span class="btn-icon-spacer"></span>'}
                </span>
              </li>`).join('')}
          </ul>
          ${
            isHost
              ? `<section class="room-settings" aria-label="Room settings">
                  <div class="rs-head">Room settings</div>
                  <div class="rs-row">
                    <span class="rs-label">Starting chips<small>The same stack for everyone</small></span>
                    ${numberFieldHTML({ id: 'start-chips', value: startChips, min: 1, step: 100, label: 'starting chips for everyone', attrs: 'data-start-chips', wide: false })}
                  </div>
                  <div class="rs-row">
                    <span class="rs-label">Blinds<small>Small / big</small></span>
                    <span class="blind-edit">
                      <input class="input input-sm" type="number" min="1" step="1" value="${t.smallBlind}" data-blind="sb" aria-label="Small blind">
                      <i>/</i>
                      <input class="input input-sm" type="number" min="2" step="1" value="${t.bigBlind}" data-blind="bb" aria-label="Big blind">
                    </span>
                  </div>
                  <div class="rs-row">
                    <span class="rs-label">Late joiners<small>Dealt in from the next hand</small></span>
                    ${numberFieldHTML({ id: 'join-chips', value: state.joinChips ?? 1000, min: 1, step: 100, label: 'chips for late joiners', attrs: 'data-join-chips', wide: false })}
                  </div>
                  <label class="rs-row rs-switch">
                    <span class="rs-label">Spectators<small>Watch without a seat, and talk</small></span>
                    <input type="checkbox" data-allow-specs ${state.allowSpectators === false ? '' : 'checked'}>
                  </label>
                </section>`
              : `<div class="room-summary">
                  <span>Blinds <b>${fmt(t.smallBlind)} / ${fmt(t.bigBlind)}</b></span>
                </div>`
          }
          ${isHost
            ? `<button class="btn btn-primary btn-lg" data-start ${n < 2 ? 'disabled' : ''}>Deal first hand</button>
               <p class="help-text">${n < 2 ? 'Add a bot or wait for a friend — you need at least 2 players.' : 'Play money only — chips have no real value.'}</p>`
            : '<p class="help-text">Waiting for the host to start<span class="dots"></span></p>'}
        </section>
        <div id="chat-slot"></div>
      </main>
    </div>`;

    // Everything on `els` belonged to the table and has just been thrown away;
    // the chat's elements are read back off whichever panel ends up in place.
    els = null;
    const slot = root.querySelector('#chat-slot');
    if (keptChat) {
      slot.replaceWith(keptChat); // listeners and draft come with it
      captureChatEls();
    } else {
      slot.outerHTML = chatAsideHTML(true);
      captureChatEls();
      wireChat();
      drawChat();
      scrollChatToEnd(); // a game ending rebuilds this panel; don't reopen at the top
      autoSizeInput();
    }

    wireTopbar();
    wireSteppers(root);
    root.querySelectorAll('[data-copy]').forEach((btn) => {
      const wantsLink = btn.dataset.copy === 'link';
      const label = btn.querySelector('span');
      const idle = wantsLink ? 'Copy link' : 'Copy code';
      btn.addEventListener('click', async () => {
        const ok = await copyText(wantsLink ? inviteLink() : roomCode);
        label.textContent = ok ? (wantsLink ? 'Copied link' : 'Copied code') : 'Copy failed';
        if (!ok) showError('Couldn’t reach the clipboard — read the room code out instead.');
        later(() => (label.textContent = idle), 1600);
      });
    });
    root.querySelector('[data-start]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await emitAck('startGame');
      } catch (err) {
        showError(err.message);
        e.currentTarget.disabled = false;
      }
    });
    root.querySelector('[data-start-chips]')?.addEventListener('change', async (e) => {
      const chips = readField(e.target, 'Starting chips', showError);
      if (chips === null) return;
      try {
        await emitAck('setStartingChips', { chips });
      } catch (err) {
        draw(); // put the old figure back before the message, which it would wipe
        showError(err.message);
      }
    });
    // The two blinds are saved as a pair. Balancing runs inside this handler
    // rather than on its own listener so the figure it corrects is already in
    // the field by the time the pair is sent - and the change it fires on that
    // field re-enters here, which `saving` turns into one save, not two.
    let saving = false;
    root.querySelectorAll('[data-blind]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (saving) return;
        const field = (k) => root.querySelector(`[data-blind="${k}"]`);
        const name = input.dataset.blind === 'bb' ? 'The big blind' : 'The small blind';
        if (readField(input, name, showError) === null) return;
        saving = true;
        let pair;
        try {
          pair = balanceBlinds(field('sb'), field('bb'), input.dataset.blind);
        } finally {
          saving = false;
        }
        try {
          await emitAck('setBlinds', { smallBlind: pair.sb, bigBlind: pair.bb });
        } catch (err) {
          // No marking the field here: draw() replaces it with the server's
          // own figures, so there's nothing left in it that was wrong.
          draw(); // put the old figures back first: it rebuilds the screen,
          showError(err.message); // and would wipe the message if it followed
        }
      });
    });
    root.querySelector('[data-join-chips]')?.addEventListener('change', async (e) => {
      const chips = readField(e.target, 'Late-joiner chips', showError);
      if (chips === null) return;
      try {
        await emitAck('setJoinChips', { chips });
      } catch (err) {
        flagInvalid(e.target);
        showError(err.message);
      }
    });
    root.querySelector('[data-allow-specs]')?.addEventListener('change', async (e) => {
      try {
        await emitAck('setAllowSpectators', { allow: e.target.checked });
      } catch (err) {
        e.target.checked = !e.target.checked; // put the switch back before saying why
        showError(err.message);
      }
    });
    wirePicker((id) => {
      botLevel = id; // remembered for the next bot added
    });
    root.querySelector('[data-add-bot]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const mine = state.lobby.find((p) => p.userId === user.id);
      try {
        await emitAck('addBot', { buyIn: mine?.buyIn, level: botLevel });
      } catch (err) {
        showError(err.message);
        e.currentTarget.disabled = false;
      }
    });
    root.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await emitAck('removePlayer', { userId: Number(btn.dataset.remove) });
        } catch (err) {
          showError(err.message);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Table skeleton (built once per game)
  // ---------------------------------------------------------------------------
  function buildTable() {
    const t = latest.table;
    root.innerHTML = `<div class="table-screen">
      ${topbarHTML(t)}
      <div class="table-body">
      <button class="history-toggle${historyOpen ? '' : ' is-off'}" data-history aria-pressed="${historyOpen}" title="Show or hide the hand history" aria-label="Hand history">${icons.history}</button>
      <aside class="history" id="history" aria-label="Hand history">
        <div class="history-head">
          <button class="chat-x" data-history-close aria-label="Close hand history">${icons.fold}</button>
          <span>Hand history</span>
        </div>
        <div class="hh-find">
          <label class="hh-search">
            <input type="search" id="hh-q" placeholder="Search name, hand or #" aria-label="Search hands" autocomplete="off">
            <button type="button" class="hh-x" id="hh-x" hidden aria-label="Clear search">${icons.fold}</button>
          </label>
          <div class="hh-filters">
            <select id="hh-winner" aria-label="Filter by winner"><option value="">Any winner</option></select>
            <select id="hh-type" aria-label="Filter by hand"><option value="">Any hand</option></select>
            <input type="number" id="hh-no" min="1" step="1" placeholder="Hand #" aria-label="Filter by hand number">
            <button type="button" class="hh-clear" id="hh-clear" hidden>Clear</button>
          </div>
        </div>
        <ol class="history-list" id="history-list"></ol>
      </aside>
      <main class="stage" id="stage">
        <div class="camera" id="camera">
          <div class="felt"></div>
          <div class="felt-logo" aria-hidden="true">${feltLogoSVG(feltTheme(getSettings().felt).logo)}</div>
          <div class="anchor" style="left:${BOARD.x}%;top:${BOARD.y}%"><div class="board" id="board"></div><div class="phase-label" id="phase"></div></div>
          <div class="anchor pot" id="pot" style="left:${POT.x}%;top:${POT.y}%"></div>
          <div class="anchor muck" id="muck" style="left:${MUCK.x}%;top:${MUCK.y}%"></div>
          <div id="seats"></div>
          <div class="anchor pending is-empty" id="pending" data-pending></div>
          <div class="anchor fold-zone" id="fold-zone"><span id="fold-zone-label">Release to fold</span></div>
          <div class="fx" id="fx"></div>
        </div>
      </main>
      <button class="table-join" data-take-seat id="table-join" hidden>${icons.chevron}Take a seat</button>
      <div class="spectators" id="spectators" hidden>
        <button class="spec-toggle" data-spec aria-expanded="false" aria-controls="spec-panel">${icons.eye}<b class="spec-count">0</b></button>
        <div class="spec-panel" id="spec-panel" role="group" aria-label="Watching" hidden></div>
      </div>
      <button class="chat-toggle${chatOpen ? '' : ' is-off'}" data-chat aria-pressed="${chatOpen}" title="Show or hide table chat" aria-label="Table chat">${icons.chat}<span class="chat-dot" aria-label="unread messages" hidden></span></button>
      ${chatAsideHTML()}
      </div>
      <footer class="dock" id="dock"></footer>
    </div>`;
    const $ = (id) => root.querySelector(`#${id}`);
    els = {
      stage: $('stage'), camera: $('camera'), board: $('board'), phase: $('phase'), pot: $('pot'),
      muck: $('muck'), seats: $('seats'), pending: $('pending'), fx: $('fx'), dock: $('dock'),
      handChip: $('hand-chip'), handNo: $('hand-no'), foldZone: $('fold-zone'), foldLabel: $('fold-zone-label'),
      feltLogo: root.querySelector('.felt-logo'),
      history: $('history'), historyList: $('history-list'),
      hhQ: $('hh-q'), hhWinner: $('hh-winner'), hhType: $('hh-type'), hhNo: $('hh-no'),
      hhClear: $('hh-clear'), hhX: $('hh-x'),
      spectators: $('spectators'), specCount: root.querySelector('.spec-count'), specPanel: $('spec-panel'),
      tableJoin: $('table-join'),
      chat: $('chat'), chatLog: $('chat-log'), chatForm: $('chat-form'), chatInput: $('chat-input'),
      chatJump: $('chat-jump'),
    };
    // The cloth needs the camera's measured shape, so it goes in once the
    // markup is in the document rather than as part of the string above.
    drawFelt();
    // The table turns between landscape and portrait on a container query the
    // stylesheet owns, and opening the chat reshapes it too - neither of which
    // is a state update, so drawTable wouldn't hear about it. Watching the
    // camera itself catches every one of them.
    feltWatch?.disconnect();
    feltWatch = new ResizeObserver(() => {
      if (mode === 'table' && Math.abs(feltAspect() - feltCutFor) > 0.01) drawFelt();
    });
    feltWatch.observe(els.camera);
    buildDock();
    wireTopbar();
    applyHistoryOpen();
    drawHistory();
    applyChatOpen();
    drawChat();
    scrollChatToEnd();
    wireChat();
    // Tapping anywhere off the panel closes it. On a phone it covers the
    // felt, so dismissing it has to be as easy as opening it; pointerdown
    // rather than click so it goes before whatever was tapped underneath.
    root.addEventListener('pointerdown', (e) => {
      if (historyOpen && !e.target.closest('#history') && !e.target.closest('[data-history]')) {
        setHistoryOpen(false);
      }
      // Same for chat, but only where it floats over the felt: as a column on
      // a wide screen it's out of the way, and closing it every time someone
      // clicks the table would make it useless to watch while playing.
      if (
        chatOpen &&
        narrow() &&
        !e.target.closest('#chat') &&
        !e.target.closest('[data-chat]')
      ) {
        setChatOpen(false);
      }
      // The watchers list is a popover, so anywhere else shuts it.
      if (specOpen && !e.target.closest('#spectators')) {
        specOpen = false;
        drawSpectators(shown);
      }
    });
    els.historyList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cards]');
      if (!btn) return;
      const no = Number(btn.dataset.cards);
      if (expanded.has(no)) expanded.delete(no);
      else expanded.add(no);
      redrawEntry(no);
    });

    // My cards: hold to peek, drag and throw toward the middle to fold.
    // Seat menus: the ⋯ on another player's nameplate, and the vote it offers.
    els.seats.addEventListener('click', async (e) => {
      const open = e.target.closest('[data-seat-menu]');
      const vote = e.target.closest('[data-vote-kick]');
      const give = e.target.closest('[data-make-host]');
      if (give) {
        askingTransfer = Number(give.dataset.makeHost);
        seatMenuFor = null;
        drawTable(null, shown);
        return drawOverlay(shown);
      }
      if (open) {
        const id = Number(open.dataset.seatMenu);
        seatMenuFor = seatMenuFor === id ? null : id;
        return drawTable(null, shown);
      }
      if (vote) {
        const id = Number(vote.dataset.voteKick);
        seatMenuFor = null;
        drawTable(null, shown);
        try {
          await emitAck('voteKick', { userId: id });
        } catch (err) {
          showError(err.message);
        }
        return;
      }
      if (seatMenuFor != null) {
        seatMenuFor = null;
        drawTable(null, shown);
      }
    });
    // Dealing in is a one-off, so the class comes off once it has played.
    // My own hand is the one node carried across redraws rather than rebuilt
    // (a peek owns it, pointer capture and all), and putting an element back
    // into the document restarts any animation still named on it — so every
    // redraw during a peek re-dealt the cards I was already holding.
    els.seats.addEventListener('animationend', (e) => {
      if (e.animationName === 'dealIn') e.target.classList.remove('deal');
      // The hint has had its say. Remembered, so it never appears again.
      if (e.animationName === 'hintFade') retireHint(e.target);
    });
    // First time the cards are hovered, the hint plays once and bows out.
    els.camera.addEventListener('pointerover', (e) => {
      if (!e.target.closest('[data-mine]')) return;
      els.seats.querySelector('[data-mine] .peek-hint')?.classList.add('is-showing');
    });
    els.camera.addEventListener('pointerdown', onHandPointerDown);
    // Right-click holds a peek, so suppress the menu that would interrupt it.
    els.camera.addEventListener('contextmenu', (e) => {
      if (e.target.closest('[data-mine]')) e.preventDefault();
    });
    els.camera.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-mine]')) {
        e.preventDefault();
        peekBriefly();
      }
    });

    // Check gesture: double-click the felt (mouse) or double-tap it (touch).
    els.camera.addEventListener('dblclick', (e) => {
      if (Date.now() - lastTouchCheck < 600) return;
      if (e.target.closest('[data-mine], .pod')) return;
      tryCheck();
    });
    let lastTap = { t: 0, x: 0, y: 0 };
    els.camera.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch' || e.target.closest('[data-mine], .pod')) return;
      const now = Date.now();
      if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTouchCheck = now;
        lastTap = { t: 0, x: 0, y: 0 };
        tryCheck();
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    });

    els.pending.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-commit]');
      if (!btn || btn.disabled) return;
      const kind = btn.dataset.commit;
      if (kind === 'clear') {
        pendingTotal = null;
        syncAmount();
        return;
      }
      if (kind === 'show' || kind === 'show-no') {
        showAskDone = shown?.table.handNumber ?? 0;
        if (kind === 'show') revealCards();
        else drawPending(); // showing redraws itself when the table updates
        return;
      }
      doAction(kind === 'raise' ? 'raise' : kind);
    });

    // The switch is inside the panel, which is rebuilt on every update, so
    // the listener sits on the corner that outlives it.
    els.spectators.addEventListener('change', async (e) => {
      const sw = e.target.closest('[data-allow-specs]');
      if (!sw) return;
      try {
        await emitAck('setAllowSpectators', { allow: sw.checked });
      } catch (err) {
        sw.checked = !sw.checked; // put the switch back before saying why
        showError(err.message);
      }
    });

    els.spectators.addEventListener('click', async (e) => {
      // The switch's own label; the click handler below would read it as a
      // tap on the eye and close the panel out from under it.
      if (e.target.closest('.spec-allow')) return;
      const take = e.target.closest('[data-take-seat]');
      const remove = e.target.closest('[data-spec-remove]');
      const block = e.target.closest('[data-spec-block]');
      if (take || remove || block) {
        try {
          if (take) return takeSeat();
          if (remove) await emitAck('removeSpectator', { userId: Number(remove.dataset.specRemove) });
          else await emitAck('removeSpectator', { userId: Number(block.dataset.specBlock), block: true });
        } catch (err) {
          showError(err.message);
        }
        return;
      }
      if (!e.target.closest('[data-spec]')) return;
      specOpen = !specOpen;
      play('click');
      drawSpectators(shown);
    });

    // It sits on the felt rather than in the dock or the spectator panel, so
    // neither of their delegated handlers reaches it.
    els.tableJoin?.addEventListener('click', () => takeSeat());
    els.dock.addEventListener('click', onDockClick);
    els.dock.addEventListener('input', onDockInput);
    els.dock.addEventListener('pointerdown', onTrayPointerDown);
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  // How much of a hand held behind a nameplate sticks up above it, as a
  // fraction of a card. The stylesheet positions the cards with it (see
  // .pod-hand) and the layout below needs the same figure to leave room for
  // them above the plate, so it's set here and handed to the CSS.
  const POD_HAND_SHOW = 0.62;
  // The same for a hand turned over at showdown. More of it shows, since it's
  // there to be read - but it stays tucked behind the plate rather than
  // standing on top of it, because on a phone two seats stacked up a rail have
  // no room for two whole cards and two badges between them. The rank and
  // suit are in a card's top corner, so they read either way.
  const POD_REVEAL_SHOW = 0.72;
  // How far a face-down hand lifts, as a fraction of a card, when its player
  // peeks: the tilt (peekTiltL/R in the stylesheet) raises the cards and turns
  // them, so their top corners climb about a quarter of a card. The badge
  // above sits clear of that permanently - a badge that hopped up every time
  // someone looked at their cards would be its own distraction.
  const PEEK_RISE = 0.25;
  // The most of a rail seat's plate that may hang past the camera's edge, in
  // % of its width. The camera box is the felt's bounding box, so a plate
  // anchored inside it sits on the cloth; this takes it off the table. Capped
  // so a wide stage doesn't strand the plates out in the dark.
  const RAIL_OUT_MAX = 6;

  function computeLayout(table) {
    const portrait = els.camera.clientWidth < els.camera.clientHeight;
    const lm = portrait ? LANDMARKS.portrait : LANDMARKS.landscape;
    BOARD = lm.board;
    POT = lm.pot;
    MUCK = lm.muck;
    DECK = lm.board;
    const place = (el, p) => {
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
    };
    // An x percentage is of the camera's width and a y percentage of its
    // height, so anything comparing the two needs both in pixels.
    const camW = els.camera.clientWidth || 1;
    const camH = els.camera.clientHeight || 1;
    place(els.board.parentElement, BOARD);
    place(els.muck, MUCK);
    place(els.foldZone, BOARD);
    place(els.pot, POT);
    // Printed where the cards are played, the way a real table's mark sits
    // under the board - not at the geometric middle, where the pot readout
    // landed on top of it.
    if (els.feltLogo) place(els.feltLogo, BOARD);
    // Someone who has left (or been voted out) mid-hand still holds a seat on
    // the server until the hand ends — their chips are in the pot — but
    // they're gone from the table, so the remaining seats close up around
    // the gap straight away rather than leaving a “Left” plate behind.
    const list = table.seats.filter((p) => p && !p.left);
    let start = list.findIndex((s) => s.userId === user.id);
    if (start < 0) start = 0;
    const ordered = [...list.slice(start), ...list.slice(0, start)];
    const n = ordered.length;
    els.camera.style.setProperty('--pod-hand-show', String(POD_HAND_SHOW));
    els.camera.style.setProperty('--pod-reveal-show', String(POD_REVEAL_SHOW));
    els.camera.style.setProperty('--peek-rise', String(PEEK_RISE));
    // Everyone else's cards sit behind their nameplate with part of them
    // showing above it - more once they're turned over at showdown, at a
    // larger size - and their badge above that again. A plate any closer to the top of the
    // table puts the badge, and then the cards, under the bar across the top
    // of the screen.
    //
    // Measured from the plate's TOP edge, which is what the cards stand on,
    // and then back to the anchor at its middle. Reserving from the middle
    // left exactly half a plate too little: enough to get away with on a tall
    // phone, not on a wide desktop table, where the badge was cut in half.
    //
    // showW mirrors --card-show in the stylesheet: a hand turned over is drawn
    // larger than the backs, and it is the showdown that needs the room. The
    // plate and the badge are read off the ones already on screen - both are
    // sized in em off a clamp, so a guess here would drift from the stylesheet.
    const cqmin = Math.min(camW, camH);
    // Everything a seat is made of is sized in em off the plate's font, so the
    // spacing below is worked out from that font rather than read off what's
    // on screen. Reading it back made the table move whenever something came
    // or went mid-hand: a badge appearing, a two-line hand name at showdown,
    // the first bet of a street. Mirrors .pod's font-size clamps.
    const podFont = portrait
      ? Math.min(13, Math.max(9, 0.026 * cqmin))
      : Math.min(14, Math.max(10, 0.0235 * cqmin));
    const showW = portrait
      ? Math.min(64, Math.max(44, 0.13 * cqmin))
      : Math.min(60, Math.max(38, 0.106 * cqmin));
    // The plate is as tall as its avatar plus padding and border.
    const podH = (portrait ? 2.9 : 3.5) * podFont + 2;
    // A one-line badge ("Call", "Your turn"), and the hand name shown at
    // showdown, which can run to two lines. Plus the air above the hand.
    const tagH = 1.26 * podFont + 2 + 7;
    const tagShowH = 1.9 * podFont + 2 + 7;
    // How far a seat's hand and badge stand above its plate at showdown, the
    // taller of a hand's two states. A revealed hand is tucked behind the plate
    // like a face-down one, just showing more of it.
    const standPx = showW * 1.4 * POD_REVEAL_SHOW + tagShowH;
    const minPodY = ((podH / 2 + standPx + 4) / camH) * 100;
    // My own hand is drawn much larger than anyone else's (--card-me against
    // --card-o), and it now sits low enough to tuck under my own tag - which
    // leaves the space straight above it free for my chips. They go there,
    // squared up over the middle of the hand: half a card plus the stack and
    // a little air.
    const myCardW = Math.min(77, Math.max(37, 0.1 * Math.min(camW, camH)));
    const myBetRise = ((myCardW * 1.4) / 2 + 30) / camH * 100;
    const rx = portrait ? 36 : 44;
    const ry = 43;
    const map = new Map();

    // --- What's already on screen ------------------------------------------
    // A plate is as wide as the name in it, so its width is read off the one
    // drawn last time; the very first draw has nothing to read and estimates.
    // Nothing else on a plate changes its width mid-hand (the chip stack in it
    // has a fixed box - see .pod .stack), so neither does the table.
    const pct = (px, of) => (px / of) * 100;
    const plateSize = (seat) => {
      const el = els.seats.querySelector(`.pod[data-seat="${seat}"]`);
      return { w: pct(el?.offsetWidth || 15 * podFont, camW), h: pct(podH, camH) };
    };
    // A bet's chips, as tall as .bet svg's clamp. The stack is drawn to a
    // fixed viewBox (see chipStackSVG), so its height sets its width: at most
    // two columns, 46 viewBox units across to 28.8 tall.
    const betHpx = Math.min(28, Math.max(14, 0.042 * cqmin));
    const betH = pct(betHpx, camH);
    const chipW = pct(betHpx * (46 / 28.8), camW);
    // How far the bet tray hangs below its plate (1.2em, from just inside the
    // plate's border), and the acting outline round it. Reserved whether or
    // not anyone has bet yet, so the first chips of a street move nothing.
    const trayDrop = pct(1.2 * podFont - 1 + 4, camH);
    const dealerW = pct(Math.min(30, Math.max(18, 0.046 * cqmin)), camW);
    const gapX = pct(5, camW);
    // Chips beside a plate get a wider berth than the dealer button does: the
    // acting seat's plate wears an outline a few pixels outside its own box,
    // and chips tucked right up against the edge sat on it. Only the chips go
    // out here now - the figure is on the plate's tray - so this is all the
    // width a bet takes beside a seat.
    const betGap = pct(10, camW);
    // --- The edge of the cloth ----------------------------------------------
    // The felt is a stadium on a wide table and an oval on a tall one, drawn
    // by feltSVG from these same two numbers: half-width 45% of the camera,
    // half-height 41.8%, with the ends rounding off over `cap` of the width.
    // (feltSVG's viewBox is stretched to the camera box, which .felt covers
    // exactly, so its units are these percentages.) An oval is the stadium
    // with its cap as wide as the whole half, so one formula does both.
    const feltCap = portrait ? 45 : (41.8 * camH) / camW;
    // The cloth's top and bottom edges. The rails are laid out between these
    // rather than between the camera's own edges: a seat spread to the foot
    // of the camera put its chips below the table altogether, where no amount
    // of sideways nudging could bring them back onto the felt.
    const feltTop = 50 - 41.8;
    const feltBottom = 50 + 41.8;
    // How much room the cloth has at a given height, as a half-width.
    const feltHalfW = (y) => {
      const k = Math.max(0, 1 - ((y - 50) / 41.8) ** 2);
      return 45 - feltCap + feltCap * Math.sqrt(k);
    };
    // Chips are never left hanging off the table. A seat's own geometry puts
    // them beside or under its plate, but a plate low down the rail has the
    // cloth curving away beneath it, and chips placed off its edge ended up
    // on the background. This pulls the whole stack back inside the felt,
    // measured at the height the chips actually sit at - `grow` says which
    // way the stack runs from its anchor (see .bet.grow-* in the stylesheet).
    const onFelt = (p) => {
      const half = Math.max(0, feltHalfW(p.y) - pct(5, camW));
      const lead = p.grow ? chipW : chipW / 2;
      const lo = 50 - half + (p.grow === 'right' ? 0 : lead);
      const hi = 50 + half - (p.grow === 'left' ? 0 : lead);
      // Vertically too, as a last resort: a stack can only be on the cloth if
      // it is between the cloth's own top and bottom edges.
      const pad = betH / 2 + pct(1, camH);
      const y = clamp(p.y, feltTop + pad, feltBottom - pad);
      return { ...p, y, x: hi < lo ? 50 : clamp(p.x, lo, hi) };
    };

    // Where the centre column's three parts are. Worked out from the landmark
    // each one is placed on and the card sizes in the stylesheet, NOT measured
    // off the screen: a peek scales the whole camera, and a box read through
    // that scale came back half as far down the table again as it really was.
    // The lower rail, spread from the board's bottom edge, was pushed off the
    // foot of the table and under the dock, and stayed there.
    const cardB = Math.min(72, Math.max(30, 0.098 * cqmin)); // --card-board
    const cardO = Math.min(54, Math.max(26, 0.074 * cqmin)); // --card-o
    const span = (centre, w, h) => ({
      t: centre.y - pct(h / 2, camH),
      b: centre.y + pct(h / 2, camH),
      l: centre.x - pct(w / 2, camW),
      r: centre.x + pct(w / 2, camW),
    });
    // Five cards with a gap of 0.12 of a card between them (see .board).
    const boardBox = span(BOARD, cardB * 5.48, cardB * 1.4);
    // The pot's readout changes with what it holds - more chips, a "current
    // bet" line, the winner's banner at showdown - so the room it is given is
    // a fixed allowance, not its size right now: the board slid every time
    // the pot grew. Its top is pinned under the board (see .pot), so only the
    // allowance below it matters.
    const potChipsH = Math.min(40, Math.max(18, 0.06 * cqmin));
    const potFoot = POT.y + pct(potChipsH + 1.05 * Math.min(30, Math.max(16, 0.046 * cqmin)) + 32, camH);
    const potHalfW = pct(1.4 * potChipsH, camW);
    const muckBox = span(MUCK, cardO, cardO * 1.4);
    // A seat's footprint, top to bottom: its badge, the hand behind the plate,
    // the plate itself and - on a phone, where the chips go under the plate -
    // its bet. It has two shapes, and they never coexist: while the betting
    // is on, the hand is face down and small and there may be chips under the
    // plate; at showdown the hand is turned up and larger and the chips are
    // already in the pot. So seats are spaced for whichever shape is taller,
    // not for both stacked together - adding them up asked for room a phone
    // doesn't have. Measured from the plate's centre: up, and down.
    const gapY = pct(4, camH);
    const aboveBet = pct(podH / 2 + cardO * 1.4 * (POD_HAND_SHOW + PEEK_RISE) + tagH + 2, camH);
    const aboveShow = pct(podH / 2 + standPx + 2, camH);
    const belowBet = pct(podH / 2, camH) + trayDrop + (portrait ? gapY + betH : 0);
    const belowShow = pct(podH / 2, camH);
    const above = Math.max(aboveBet, aboveShow);
    const below = Math.max(belowBet, belowShow);
    // Centre to centre, two seats one above the other need this much.
    const step = Math.max(aboveBet + belowBet, aboveShow + belowShow);

    // --- Portrait: two rails and, for an odd count, one seat at the top ------
    // A tall table has the board straight across its middle, so the seats go
    // down the two rails - above the board and below it - spread out by the
    // room each one actually needs. An angle round an ellipse can't do that:
    // at nine players it put two seats on each rail a few pixels apart.
    // How far out the rail seats can go. The stage is wider than the camera
    // on a tablet and barely wider on a phone, so the plates take whatever is
    // there rather than a fixed nudge - both are layout widths, so a peek's
    // zoom doesn't change them.
    const railOut = Math.min(
      RAIL_OUT_MAX,
      Math.max(0, pct((els.stage.clientWidth - camW) / 2 - 2, camW))
    );
    const slot = new Map();
    // Index 0 is my own seat and is laid out on its own, at the bottom - but
    // only when I have one. Watching from the rail, every seat on the table
    // belongs on a side rail, and the rails run the whole height, since
    // there is no plate of mine at the foot for them to stop short of.
    const seated = ordered[0]?.userId === user.id;
    if (portrait) {
      const m = seated ? n - 1 : n;
      // One seat at the top when there is an odd one out, and the rest split
      // evenly between the two rails - so the table is symmetric about its
      // middle however many are playing.
      const top = m % 2 === 1;
      const perSide = (m - (top ? 1 : 0)) / 2;
      // Centre to centre, two seats are never closer than a whole plate and a
      // clear gap on top of it, whatever else the arithmetic says. A rail
      // with less room than its seats want gives them the natural spacing
      // where it can, then tightens toward this floor - it never closes the
      // gap up altogether, which is what had plates touching at nine players.
      const minPitch = pct(podH, camH) + gapY;
      // Seats one above another, sharing out the room they are given evenly.
      const spread = (count, from, to) => {
        if (!count) return [];
        const need = above + (count - 1) * step + below;
        const room = Math.max(0, to - from - need);
        const gap = room / (count + 1);
        // What the rail can actually give each seat when it is short.
        const squeezed = count > 1 ? (to - from - above - below) / (count - 1) : step;
        const pitch = room > 0 ? step + gap : clamp(squeezed, minPitch, step);
        const run = above + (count - 1) * pitch + below;
        // Centred in the run when tight, so what overflows is shared top and
        // bottom rather than all falling off one end.
        let first = room > 0 ? from + gap + above : (from + to) / 2 - run / 2 + above;
        // Then nudged back inside the table if that pushed it off either end.
        first += Math.max(0, 0.6 + above - first);
        first -= Math.max(0, first + (count - 1) * pitch + below - 99.4);
        return Array.from({ length: count }, (_, q) => first + q * pitch);
      };
      // Each rail runs the whole height of the table, from the top down to my
      // own seat - not the stretch above the board and the stretch below it
      // taken separately. Split that way, a table of four put its one seat per
      // rail in the upper stretch and the three opponents piled into the top
      // third with the bottom half of the felt empty. A rail seat is pinned to
      // the edge and my plate is in the middle of the bottom, so the two never
      // meet and the rail has no business stopping short of it.
      //
      // The full height, too, not just the cloth: a seat sits ON the rail,
      // which is the camera's own edge. Only the chips have to be on the
      // cloth, and onFelt sees to that where they land.
      const myPodY = 50 + ry + 2.5;
      const railBottom = seated ? myPodY - pct(podH, camH) - gapY : 99.4;
      const railYs = spread(perSide, 0.6, railBottom);
      // Clockwise from me at the bottom: up the left rail, across the top,
      // down the right.
      const order = [
        ...railYs.slice().reverse().map((y) => ({ side: 'left', y })),
        ...(top ? [{ side: null, y: spread(1, 0.6, muckBox.t - 0.8)[0] }] : []),
        ...railYs.map((y) => ({ side: 'right', y })),
      ];
      order.forEach((o, j) => slot.set(seated ? j + 1 : j, o));
    }

    ordered.forEach((p, i) => {
      const isMe = p.userId === user.id;
      const size = plateSize(p.seat);
      // Seat 0 (me) at the bottom; others follow clockwise in action order.
      const a = ((90 + (i * 360) / n) * Math.PI) / 180;
      const pod = { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
      let side = null;
      if (isMe) {
        // My own cards, my “Your turn” tag and my nameplate stack up in the
        // same narrow strip at the bottom; the plate drops a little to make
        // room for them.
        pod.y += portrait ? 2.5 : 1.5;
        // ...but not so far that the bet tray under it, and the acting
        // outline round that, run off the foot of the table.
        pod.y = Math.min(pod.y, 100 - size.h / 2 - trayDrop - pct(6, camH));
      } else if (portrait) {
        const s = slot.get(i);
        side = s.side;
        pod.y = s.y;
        pod.x = side === 'left' ? -railOut : side === 'right' ? 100 + railOut : 50;
      } else {
        // Room above for the hand and badge, and the whole plate on the table.
        pod.y = Math.max(pod.y, minPodY);
        pod.x = clamp(pod.x, size.w / 2 + 0.6, 100 - size.w / 2 - 0.6);
      }
      // The plate as it will be drawn: a seat pinned to a rail grows inward
      // from it rather than straddling its anchor.
      const plateL = side === 'left' ? pod.x : side === 'right' ? pod.x - size.w : pod.x - size.w / 2;
      const plate = { l: plateL, r: plateL + size.w, t: pod.y - size.h / 2, b: pod.y + size.h / 2 };
      const plateCx = (plate.l + plate.r) / 2;
      const stack = { x: plateCx, y: pod.y };

      if (isMe) {
        const toward = (k) => ({ x: pod.x + (CENTER.x - pod.x) * k, y: pod.y + (CENTER.y - pod.y) * k });
        const cards = toward(lm.cardsK);
        // Dealer button beside my cards.
        const off = portrait ? 16 : 10;
        const dealer = { x: cards.x + off, y: cards.y };
        // My chips sit squarely above my hand rather than off to one side.
        const bet = onFelt({ x: cards.x, y: clamp(cards.y - myBetRise, 8, 92) });
        map.set(p.seat, { pod, cards, bet, dealer, stack, isMe, side, index: i, plate });
        return;
      }

      // Everyone else's chips and the dealer button sit right against their
      // plate: as close to the player as they can be without going under it,
      // and out of the column the pot, board and muck run down. The dealer
      // button is beside the plate, on the side facing the middle. The chips
      // go beside it too on a wide table; on a phone there's no width to
      // spare - two plates and the pot fill it - so they go just under the
      // plate, in the room the spacing above set aside for them.
      const inward = plateCx <= 50 ? 1 : -1;
      const edge = inward > 0 ? plate.r : plate.l;
      const isDealer = table.dealerSeat === p.seat;
      const dealer = { x: edge + inward * (gapX + dealerW / 2), y: pod.y };
      const betFrom = edge + inward * ((isDealer ? gapX + dealerW : 0) + betGap);
      // On a wide table the chips hang off that point and grow away from the
      // plate, rather than being centred on a guess at their width: one sample
      // width stood in for every seat, so a four-figure bet - or a taller chip
      // stack - ran straight back under the nameplate.
      // On a phone a plate is pinned to the rail, which is off the cloth, so
      // its chips can't sit beside it or under it - under it is where the
      // bottom seats found my own nameplate. They go out onto the open felt
      // instead, on the line from the player toward the middle of the table:
      // in front of them, the way chips are pushed in at a real table.
      const toCentre = (k) => ({ x: plateCx + (50 - plateCx) * k, y: pod.y + (50 - pod.y) * k });
      const under = plate.b + trayDrop + gapY + betH / 2;
      const bet = onFelt(
        !portrait
          ? { x: betFrom, y: pod.y, grow: inward > 0 ? 'right' : 'left' }
          : side
            ? { ...toCentre(0.3), grow: side === 'left' ? 'right' : 'left' }
            : { x: plateCx, y: under }
      );
      // Where this player's cards are: behind the plate, at its top edge.
      const cards = { x: plateCx, y: plate.t };
      map.set(p.seat, { pod, cards, bet, dealer, stack, isMe, side, index: i, plate });
    });

    // --- The centre column ---------------------------------------------------
    // The muck, board and pot run down the middle. If a seat at the top of
    // the table reaches into that column - the seat facing me, at an even
    // count - the whole column slides down to clear it, as far as the room
    // above my own chips allows.
    const colL = Math.min(50 - potHalfW, muckBox.l) - 0.5;
    const colR = Math.max(50 + potHalfW, muckBox.r) + 0.5;
    let topClear = -Infinity;
    let bottomLimit = 99;
    for (const L of map.values()) {
      if (L.isMe) {
        bottomLimit = Math.min(bottomLimit, L.bet.y - pct(14, camH));
        continue;
      }
      if (L.plate.r < colL || L.plate.l > colR) continue;
      // A phone seat's chips hang under its plate, so they count too.
      const foot = portrait ? L.bet.y + betH / 2 : L.plate.b + trayDrop;
      if (L.pod.y < boardBox.t) topClear = Math.max(topClear, foot);
      else bottomLimit = Math.min(bottomLimit, L.pod.y - above);
    }
    // The muck is the top of the column now and the pot its foot, so those
    // are the two edges the shift is measured against.
    const need = topClear + 1 - muckBox.t;
    const room = bottomLimit - 1 - potFoot;
    const shift = need > 0 ? Math.min(need, Math.max(0, room)) : 0;
    if (shift > 0) {
      POT = { x: POT.x, y: POT.y + shift };
      BOARD = { x: BOARD.x, y: BOARD.y + shift };
      MUCK = { x: MUCK.x, y: MUCK.y + shift };
      DECK = BOARD;
      place(els.board.parentElement, BOARD);
      place(els.pot, POT);
      place(els.muck, MUCK);
      place(els.foldZone, BOARD);
      if (els.feltLogo) place(els.feltLogo, BOARD);
    }
    return { portrait, n, map };
  }

  function myLayout() {
    const me = shown?.table.seats.find((s) => s && s.userId === user.id && !s.left);
    return me && layout ? layout.map.get(me.seat) : null;
  }

  function onResize() {
    if (mode !== 'table' || !layout) return;
    const portrait = els.camera.clientWidth < els.camera.clientHeight;
    if (portrait !== layout.portrait) drawTable(shown, shown);
  }

  // ---------------------------------------------------------------------------
  // Drawing the live table
  // ---------------------------------------------------------------------------
  function drawTable(prev, cur) {
    const t = cur.table;
    const pt = prev ? prev.table : null;
    layout = computeLayout(t);
    els.camera.classList.toggle('is-portrait', layout.portrait);
    // A resize that reshapes the table needs the cloth cut again. Compared
    // with a little slack, so a pixel of reflow doesn't rebuild the felt.
    if (Math.abs(feltAspect() - feltCutFor) > 0.01) drawFelt();
    els.camera.classList.toggle('is-crowded', layout.n >= 5);
    // Only a genuinely new hand deals cards in. Plain redraws (cancelling a
    // fold, ending a peek, resizing) must not replay everyone's deal.
    const newHand = t.handNumber !== renderedHand;
    const summary = t.phase === 'showdown' ? t.lastHandSummary : null;
    const ctx = {
      t,
      newHand,
      summary,
      winners: new Set((summary?.winners || []).map((w) => w.userId)),
      winCards: winningCards(summary),
      hostUserId: cur.hostUserId,
      chipLeader: chipLeaderId(t),
      // Keyed off what's already drawn, not off `pt`: a plain redraw (taking
      // back a fold, ending a peek) passes no previous state, and must not
      // flip everyone's cards over a second time.
      justShowdown: t.phase === 'showdown' && renderedShowdown !== t.handNumber,
    };

    els.handChip.hidden = !t.handNumber;
    els.handNo.textContent = `#${t.handNumber}`;

    // A peek or drag owns the live hand element (it holds the pointer capture
    // and the lifted/dragging state), so that node is carried across the
    // redraw rather than replaced. A new hand deals new cards, so it ends the
    // gesture instead.
    const gesture = peeking || holding || dragging;
    const mine = els.seats.querySelector('[data-mine]');
    const keptHand = gesture && !newHand ? mine : null;
    // Outside a gesture the cards are still worth keeping. Every table update
    // redraws this seat - a bot betting, anyone at all peeking - and building
    // the element again restarts whatever it carries, so a peek that only
    // ends up redrawing the same two cards reads as them being dealt afresh.
    // The markup is compared, and where nothing about the hand has changed
    // the live node goes back rather than a copy of it.
    const mineHTML = !keptHand && mine && !newHand ? mine.outerHTML : null;
    if (gesture && newHand) endPeek();

    // Seats are rebuilt on every update; one landing mid-entrance carries on
    // from the same point rather than starting its rise over.
    const sinceEntry = performance.now() - enteredAt;
    if (sinceEntry < ENTRANCE_MS) {
      root.querySelector('.table-screen')?.style.setProperty('--seat-elapsed', `${Math.round(sinceEntry)}ms`);
    }
    els.seats.innerHTML = t.seats
      .filter((p) => p && !p.left)
      .map((p) => seatHTML(p, layout.map.get(p.seat), ctx))
      .join('');

    if (keptHand) {
      const fresh = els.seats.querySelector('[data-mine]');
      if (fresh) settleIn(fresh, keptHand);
      else keptHand.remove(); // I folded mid-gesture; let the cards go
    } else if (mineHTML) {
      const fresh = els.seats.querySelector('[data-mine]');
      if (fresh && fresh.outerHTML === mineHTML) settleIn(fresh, mine);
    }
    drawBoard(t, newHand, ctx.winCards);
    drawPot(t, summary);
    drawMuck(t);
    drawDock(cur);
    drawSpectators(cur);
    drawPending();
    tickClock();
    renderedHand = t.handNumber;
    renderedBoard = t.board.length;
    if (ctx.justShowdown) renderedShowdown = t.handNumber;
    // Not only on the first draw: a hand turned over after the fact has to
    // reach the entry that's already in the list.
    if (t.phase === 'showdown') recordHand(t.lastHandSummary);
    // Sound is deliberately not tied to the animation pass: the table is
    // meant to be followable by ear alone, so it still plays with animations
    // turned off (and when the player isn't looking at the screen at all).
    if (pt) playEffects(pt, t);
    if (pt && !reduceMotion) runEffects(pt, t);
  }

  // ---------------------------------------------------------------------------
  // Hand history sidebar
  // ---------------------------------------------------------------------------
  // Called when a hand's showdown is first drawn, and again whenever its
  // summary changes — somebody can turn their cards over after the fact, and
  // the entry already in the list has to pick that up.
  // The hands this game played before we got here. Somebody who sat down
  // late, or pulled up a chair to watch, starts with an empty sidebar
  // otherwise - the history is built from showdowns as they happen, and
  // theirs began mid-game. Oldest first, because each one goes on the front.
  function onHandHistory({ code, hands } = {}) {
    if (code !== roomCode || !Array.isArray(hands)) return;
    for (const summary of hands) recordHand(summary);
  }

  function recordHand(summary) {
    if (!summary || !summary.winners?.length) return;
    const shownHands = new Map((summary.showdownHands || []).map((h) => [h.userId, h]));
    // My own cards go in my own history whatever happened. A pot nobody
    // contested is never shown down, so this is the only record I get of
    // what I was actually holding.
    const mySeat = latest?.table.seats.find((s) => s && s.userId === user.id && !s.left);
    const winnerIds = new Set(summary.winners.map((w) => w.userId));
    const entry = {
      hand: summary.handNumber,
      uncontested: !!summary.uncontested,
      yourCards: shownHands.get(user.id)?.holeCards || mySeat?.holeCards || [],
      split: summary.winners.length > 1,
      // Kept even when everyone folded: the community cards were turned over
      // in front of the table, so they're no secret - only the hole cards
      // nobody ever saw stay hidden.
      board: summary.board || [],
      winners: summary.winners.map((w) => ({
        // The name as it was, plus who it belongs to. Players can rename
        // themselves, and the history should follow them rather than keep
        // calling them what they were called at the time.
        id: w.userId,
        name: w.username,
        amount: w.amount,
        mine: w.userId === user.id,
        // An uncontested pot has no hand to name, since it was never read
        // against anyone else's. Cards appear only if they were turned over.
        desc: summary.uncontested ? '' : w.hand?.description || w.hand?.name || '',
        kicker: summary.uncontested ? '' : w.kicker || '',
        cards: shownHands.get(w.userId)?.holeCards || [],
        // The category on its own ("Flush"), kept apart from the description
        // ("Flush, Ace high") so hands can be filtered by what they were.
        cat: summary.uncontested ? '' : w.hand?.name || '',
      })),
      // Hands shown by players who didn't win the pot.
      showed: [...shownHands.values()]
        .filter((h) => !winnerIds.has(h.userId) && h.holeCards?.length)
        .map((h) => ({ id: h.userId, name: h.username, cards: h.holeCards, mine: h.userId === user.id })),
    };

    const at = history.findIndex((h) => h.hand === entry.hand);
    if (at >= 0) {
      if (JSON.stringify(history[at]) === JSON.stringify(entry)) return; // nothing new
      history[at] = entry;
      saveHistory();
      redrawEntry(entry.hand);
      syncHistoryOptions(); // a hand turned over can add a new kind of hand
      return;
    }
    history.unshift(entry);
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    saveHistory();
    prependEntry(history[0]);
    // The dropdowns offer what the history holds, so a finished hand can put
    // a new winner or a new kind of hand in them. Without this they only
    // caught up on a reload.
    syncHistoryOptions();
  }

  // What the sidebar is currently narrowed to.
  const hhFilter = { q: '', winner: '', type: '', no: '' };

  // A history entry keeps the name a player had when the hand was recorded.
  // They can rename themselves afterwards, so the name shown — and the one
  // offered in the filter — is whatever they go by now, falling back to the
  // stored one for anyone who has since left.
  function liveName(p) {
    if (p?.id == null) return p?.name || '';
    const t = shown?.table;
    const seated = t?.seats.find((s) => s && s.userId === p.id);
    if (seated) return seated.username;
    const waiting = shown?.lobby?.find((l) => l.userId === p.id);
    return waiting?.username || p.name || '';
  }

  // Narrowing the history. Every control feeds the same filter and redraws
  // the list; none of them touch what's stored. The waiting room shares the
  // top bar but has no history panel, so this does nothing there rather than
  // throwing and taking the rest of that screen's wiring down with it.
  function wireHistoryFilters() {
    if (!els?.historyList) return;
    const onFilter = () => {
      hhFilter.q = els.hhQ?.value || '';
      hhFilter.winner = els.hhWinner?.value || '';
      hhFilter.type = els.hhType?.value || '';
      hhFilter.no = els.hhNo?.value || '';
      if (els.hhX) els.hhX.hidden = !hhFilter.q;
      drawHistory();
    };
    const clearFilters = () => {
      for (const el of [els.hhQ, els.hhNo, els.hhWinner, els.hhType]) if (el) el.value = '';
      onFilter();
    };
    els.hhQ?.addEventListener('input', onFilter);
    els.hhNo?.addEventListener('input', onFilter);
    els.hhWinner?.addEventListener('change', onFilter);
    els.hhType?.addEventListener('change', onFilter);
    els.hhClear?.addEventListener('click', clearFilters);
    // Empties the search box alone; the dropdowns beneath it stay as they are.
    els.hhX?.addEventListener('click', () => {
      if (els.hhQ) els.hhQ.value = '';
      onFilter();
      els.hhQ?.focus();
    });
    els.historyList.addEventListener('click', (e) => {
      if (e.target.closest('[data-hh-clear]')) clearFilters();
    });
  }

  const hhActive = () => !!(hhFilter.q || hhFilter.winner || hhFilter.type || hhFilter.no);

  // A hand matches the text if the search appears in anyone's name, in what
  // they made, or in the hand's own number — so "flush", "quinn" and "12"
  // all find something without having to say which you meant.
  function hhMatches(h) {
    if (hhFilter.no && h.hand !== Number(hhFilter.no)) return false;
    if (hhFilter.winner && !h.winners.some((w) => liveName(w) === hhFilter.winner)) return false;
    if (hhFilter.type && !h.winners.some((w) => (w.cat || w.desc || '').startsWith(hhFilter.type))) return false;
    const q = hhFilter.q.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      `#${h.hand}`,
      String(h.hand),
      h.uncontested ? 'everyone else folded uncontested' : '',
      h.split ? 'split pot' : '',
      ...h.winners.map((w) => `${liveName(w)} ${w.name} ${w.desc} ${w.cat || ''} ${w.kicker}`),
      ...(h.showed || []).map((s) => `${liveName(s)} ${s.name}`),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  }

  // The two dropdowns only ever offer what the history actually holds, so
  // there's no picking a player or a hand that returns nothing.
  function syncHistoryOptions() {
    const fill = (el, values, current, anyLabel) => {
      if (!el) return;
      const want = [anyLabel, ...values].join('|');
      if (el._want === want) return; // unchanged; leave the open dropdown alone
      el._want = want;
      el.innerHTML =
        `<option value="">${anyLabel}</option>` +
        values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      el.value = values.includes(current) ? current : '';
    };
    const names = [...new Set(history.flatMap((h) => h.winners.map(liveName)))].sort();
    const cats = [...new Set(history.flatMap((h) => h.winners.map((w) => w.cat).filter(Boolean)))].sort();
    fill(els?.hhWinner, names, hhFilter.winner, 'Any winner');
    fill(els?.hhType, cats, hhFilter.type, 'Any hand');
    if (els?.hhClear) els.hhClear.hidden = !hhActive();
  }

  function drawHistory() {
    if (!els?.historyList) return;
    syncHistoryOptions();
    if (!history.length) {
      setHTML(els.historyList, '<li class="history-empty">Finished hands show up here.</li>');
      return;
    }
    const rows = history.filter(hhMatches);
    if (!rows.length) {
      setHTML(
        els.historyList,
        `<li class="history-empty">No hands match.${hhActive() ? '<button type="button" class="hh-reset" data-hh-clear>Clear the filters</button>' : ''}</li>`
      );
      return;
    }
    // What a search turned up is marked for a moment, so the hands that
    // answered it are obvious before the glow settles away.
    const found = hhActive() ? ' is-found' : '';
    setHTML(els.historyList, rows.map((h) => entryHTML(h, found)).join(''));
  }

  // A finished hand is added on its own rather than by rebuilding the list:
  // replacing the markup threw away whatever the player was reading. The new
  // entry goes on top, so anyone scrolled into the older hands is nudged down
  // by its height to keep the same hands under their eyes.
  function prependEntry(h) {
    const list = els?.historyList;
    if (!list) return;
    // With a filter on, whether the new hand belongs in the list at all is
    // the filter's call, so the list is rebuilt rather than pushed onto.
    if (hhActive()) return drawHistory();
    if (history.length === 1 || !list.querySelector('.hh')) {
      drawHistory(); // first entry replaces the placeholder
      return;
    }
    const before = list.scrollHeight;
    const top = list.scrollTop;
    list.insertAdjacentHTML('afterbegin', entryHTML(h));
    list.firstElementChild?.classList.add('is-new'); // slides into the top
    list.querySelectorAll('.hh').forEach((li, i) => i >= HISTORY_MAX && li.remove());
    list._html = null; // the cached markup no longer matches the DOM
    if (top > 0) list.scrollTop = top + (list.scrollHeight - before);
  }

  // Opening or closing one hand's cards only rewrites that hand.
  function redrawEntry(no) {
    const list = els?.historyList;
    const li = list?.querySelector(`.hh-eye[data-cards="${no}"]`)?.closest('.hh');
    const h = history.find((x) => x.hand === no);
    if (!li || !h) return drawHistory();
    li.outerHTML = entryHTML(h);
    list._html = null;
  }

  function entryHTML(h, extra = '') {
    // Anything worth opening the hand for: cards somebody turned over, my own
    // which I can always look back at, or just the board a folded hand left
    // on the table.
    const cards =
      h.winners.some((w) => w.cards?.length) ||
      !!h.yourCards?.length ||
      !!h.showed?.length ||
      !!h.board?.length;
    const open = expanded.has(h.hand);
    const note = h.uncontested ? 'Everyone else folded' : h.split ? 'Split pot' : '';
    // The eye rides on the first winner's row, beside what they won. On a
    // split pot one eye still opens every winner's cards, so it isn't
    // repeated down the rows.
    const eye = `<button type="button" class="hh-eye" data-cards="${h.hand}" data-tip="View"
      aria-expanded="${open}" aria-label="${open ? 'Hide' : 'View'} the cards from hand ${h.hand}">${icons.eye}</button>`;
    const wins = h.winners
      .map(
        (w, i) => `<div class="hh-win${w.mine ? ' is-me' : ''}">
          <span class="hh-who">${esc(liveName(w))}</span>
          <span class="hh-amt">+${fmt(w.amount)}</span>
          ${i === 0 && cards ? eye : ''}
        </div>
        ${w.desc ? `<div class="hh-hand">${esc(w.desc)}${w.kicker ? `<span class="hh-kick">${esc(w.kicker)}</span>` : ''}</div>` : ''}
        ${open && w.cards?.length ? `<div class="hh-cards">${w.cards.map((c) => cardHTML(c, { simple: true })).join('')}</div>` : ''}`
      )
      .join('');
    return `<li class="hh${extra}">
      <div class="hh-no">Hand #${h.hand}</div>
      ${wins}
      ${note ? `<div class="hh-note">${note}</div>` : ''}
      ${
        open
          ? (h.showed || [])
              .filter((s) => !s.mine)
              .map(
                (s) => `<div class="hh-board"><span class="hh-label">${esc(liveName(s))} showed</span><div class="hh-cards">${s.cards
                  .map((c) => cardHTML(c, { simple: true }))
                  .join('')}</div></div>`
              )
              .join('')
          : ''
      }
      ${
        open && h.yourCards?.length && !h.winners.some((w) => w.mine && w.cards?.length)
          ? `<div class="hh-board"><span class="hh-label">You held</span><div class="hh-cards">${h.yourCards.map((c) => cardHTML(c, { simple: true })).join('')}</div></div>`
          : ''
      }
      ${open && h.board?.length ? `<div class="hh-board"><span class="hh-label">Board</span><div class="hh-cards">${h.board.map((c) => cardHTML(c, { simple: true })).join('')}</div></div>` : ''}
    </li>`;
  }

  function applyHistoryOpen() {
    root.querySelector('.table-screen')?.classList.toggle('show-history', historyOpen);
    if (els?.history) els.history.setAttribute('aria-hidden', String(!historyOpen));
    const btn = root.querySelector('[data-history]');
    if (btn) {
      btn.classList.toggle('is-off', !historyOpen);
      btn.setAttribute('aria-pressed', String(historyOpen));
    }
  }

  function seatTag(p, { acting, isMe, isWinner, t, summary }) {
    if (isWinner) {
      // The green glow and the crown already say "winner", so the label only
      // needs to carry the hand - and only which hand it is, not what it was
      // made of: `name` is the bare category ("Two Pair"), where `description`
      // spells out the ranks ("Two Pair, Nines and Fours"). The kicker that
      // settled it is left off for the same reason. Both are still written out
      // in full on the showdown banner and in the hand history.
      // A royal flush keeps its own name: that's which hand it is, not what it
      // was made of, so it belongs here as much as "Two Pair" does.
      const w = summary?.winners.find((x) => x.userId === p.userId);
      const cat = w?.hand && (w.hand.description === 'Royal Flush' ? 'Royal Flush' : w.hand.name || w.hand.description);
      return { text: cat || 'Winner', cls: 't-win', icon: icons.crown };
    }
    if (p.left) return { text: 'Left', cls: 't-away' };
    // Waiting for the next deal (just joined, or restaked) rather than out
    // of the game: chips in front of them is what tells the two apart.
    if (p.sittingOut) return p.chips > 0 ? { text: 'Next round', cls: 't-away' } : { text: 'Out', cls: 't-away' };
    if (acting && isMe) return { text: 'Your turn', cls: 't-turn' };
    if (p.folded) return { text: 'Folded', cls: 't-fold' };
    // At a real showdown the hand they made matters more than how they got there.
    if (summary && !summary.uncontested) {
      const sh = summary.showdownHands.find((h) => h.userId === p.userId);
      // The kicker rides along only when someone else made the same hand —
      // that's the card that actually settled it.
      if (sh) return { text: sh.evaluation.description || sh.evaluation.name, cls: 't-hand', kicker: sh.kicker };
    }
    if (p.allIn) return { text: 'All-in', cls: 't-allin' };
    return describeAction(p.lastAction);
  }

  // Icons only, no labels: who owns the room, and who's in front.
  function marksHTML(p, ctx) {
    let out = '';
    if (p.userId === ctx.hostUserId) {
      out += `<span class="mark is-owner" title="Room owner" aria-label="Room owner" role="img">${icons.key}</span>`;
    }
    if (p.userId === ctx.chipLeader) {
      out += `<span class="mark is-leader" title="Biggest stack" aria-label="Biggest stack" role="img">${icons.trophy}</span>`;
    }
    return out;
  }

  function seatHTML(p, L, ctx) {
    const { t } = ctx;
    const acting = t.actingSeat === p.seat && BETTING.includes(t.phase);
    const isWinner = ctx.winners.has(p.userId);
    // Once the pot is awarded, everyone who didn't take a share of it fades
    // back, so the winner reads at a glance instead of having to be picked
    // out of a row of identical nameplates.
    const isLoser = !!ctx.summary && !isWinner;
    const away = p.left || p.sittingOut;
    const menuOpen = seatMenuFor === p.userId;
    const hasBet = BETTING.includes(t.phase) && p.betThisStreet > 0;
    // 'anchor' has moved to the group around the plate - the plate is now
    // placed by that group, so that the cards tucked behind it can be
    // positioned against the plate's own box.
    const cls = ['pod', L.isMe && 'is-me', acting && 'is-acting', p.folded && !away && 'is-folded', away && 'is-away', isWinner && 'is-winner', isLoser && 'is-loser', menuOpen && 'has-menu', hasBet && 'has-bet', L.pod.y > 62 && 'is-low', L.side && `side-${L.side}`, p.isBot && levelClass(p.botLevel)]
      .filter(Boolean)
      .join(' ');
    const groupCls = ['anchor', 'seat-group', L.isMe && 'is-me', L.side && `side-${L.side}`]
      .filter(Boolean)
      .join(' ');
    const tag = seatTag(p, { acting, isMe: L.isMe, isWinner, t, summary: ctx.summary });
    let ring = '';
    if (acting && turnEndsAt) {
      const remaining = Math.max(0, turnEndsAt - performance.now());
      ring = turnRingSVG(turnTotal, turnTotal - remaining);
    }
    const stack = p.chips > 0 ? `<div class="stack">${chipStackSVG(p.chips, { maxCols: 3, maxPerCol: 6 })}</div>` : '';
    // What this player has out in front of them this street. The chips go on
    // the felt beside the seat; the figure rides in a tray under the
    // nameplate, where it is read against the player it belongs to and can't
    // crowd anything on the table. Mine too - my plate is lifted clear of the
    // foot of the table to leave room for it (see computeLayout).
    const betTray = hasBet ? `<span class="pod-bet"><b>${fmt(p.betThisStreet)}</b></span>` : '';

    let html = `<div class="${groupCls}" style="left:${L.pod.x}%;top:${L.pod.y}%;--i:${L.index}">
      ${L.isMe ? '' : handHTML(p, L, ctx)}
      <div class="${cls}" data-seat="${p.seat}">
      <div class="avatar">${avatarSVG(p.username)}${p.isBot ? `<span class="bot-mark">${icons.robot}</span>` : ''}${ring}</div>
      <div class="who"><span class="name-row"><span class="name">${esc(p.username)}</span>${marksHTML(p, ctx)}</span><span class="amt">${fmt(p.chips)}</span></div>
      ${stack}
      ${betTray}
      ${tag ? `<span class="tag ${tag.cls}">${tag.icon || ''}${esc(tag.text)}${tag.kicker ? `<span class="tag-kick">${esc(tag.kicker)}</span>` : ''}</span>` : ''}
      ${acting && !L.isMe ? `<span class="turn-marker">${icons.chevron}</span>` : ''}
      ${
        // No menu on the host: their room can't be voted away from them.
        !L.isMe && !p.isBot && !p.left && p.userId !== ctx.hostUserId
          ? `<button class="pod-more" data-seat-menu="${p.userId}" aria-label="Options for ${esc(p.username)}" aria-expanded="${seatMenuFor === p.userId}">⋯</button>
             ${
               seatMenuFor === p.userId
                 ? `<div class="pod-menu">
                      ${
                        ctx.hostUserId === user.id
                          ? `<button data-make-host="${p.userId}">${icons.key}Make room owner</button>`
                          : ''
                      }
                      <button data-vote-kick="${p.userId}">Vote kick</button>
                    </div>`
                 : ''
             }`
          : ''
      }
      </div>
    </div>`;
    // Mine stay where they were: out on the felt, big enough to peek at and to
    // throw in to fold.
    if (L.isMe) html += handHTML(p, L, ctx);
    if (hasBet) {
      html += `<div class="anchor bet${L.bet.grow ? ` grow-${L.bet.grow}` : ''}" style="left:${L.bet.x}%;top:${L.bet.y}%">${chipStackSVG(p.betThisStreet, { maxCols: 2, maxPerCol: 5 })}</div>`;
    }
    if (t.dealerSeat === p.seat) {
      html += `<div class="anchor dealer" style="left:${L.dealer.x}%;top:${L.dealer.y}%">${dealerButtonSVG()}</div>`;
    }
    return html;
  }

  // Puts a node that was carried across a redraw back into the new markup.
  // Rebuilding the seats detaches it, and Chrome keeps the computed style of
  // an element it already knows, so re-attaching it animated the difference:
  // the hand slid across the felt on every single table update. Transitions
  // are pinned off for the frame it lands in, so it arrives where it belongs
  // instead of travelling there.
  function settleIn(fresh, node) {
    node.classList.add('is-settling');
    fresh.replaceWith(node);
    void node.offsetWidth; // commit the landing position before they resume
    node.classList.remove('is-settling');
  }

  // Deal animation offset: each card flies in from the deck, round-robin.
  function dealStyle(L, cardIdx, to = L.cards) {
    const W = els.camera.clientWidth;
    const H = els.camera.clientHeight;
    const dx = ((DECK.x - to.x) / 100) * W;
    const dy = ((DECK.y - to.y) / 100) * H;
    return `--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--d:${(cardIdx * layout.n + L.index) * 90}ms`;
  }

  // `flip: true` builds a two-sided card that turns over in 3D (used for my
  // own hole cards, which flip face-up while I peek).
  function cardHTML(code, { cls = '', style = '', face = true, flip = false, simple = false } = {}) {
    if (flip) {
      return `<div class="card ${cls}" style="${style}"><div class="flip">
        <div class="back">${cardBackSVG(getSettings().cardBack)}</div>
        <div class="face">${cardFaceSVG(code, { simple })}</div>
      </div></div>`;
    }
    const faceLayer = face ? `<div class="face">${cardFaceSVG(code, { simple })}</div>` : '';
    return `<div class="card ${cls}" style="${style}">${faceLayer}<div class="back">${cardBackSVG(getSettings().cardBack)}</div></div>`;
  }

  function handHTML(p, L, ctx) {
    const { t, newHand, summary, winCards, justShowdown } = ctx;
    if (!p.hasCards || p.folded) return '';
    const lost = !!summary && !ctx.winners.has(p.userId) ? ' is-loser' : '';
    const pos = `left:${L.cards.x}%;top:${L.cards.y}%`;
    const deal = newHand && !reduceMotion;
    const winCls = (c) => (winCards.size ? (winCards.has(c) ? ' is-win' : '') : '');

    if (L.isMe && p.holeCards) {
      const faceUp = t.phase === 'showdown' && summary && !summary.uncontested;
      // “Turn my cards up as they're dealt”: they sit open for the whole hand,
      // so there's nothing to peek at. They can still be thrown to fold, which
      // is why this isn't the `shown` class used at showdown — that one ends
      // the gesture along with the hand.
      const open = !faceUp && autoReveal();
      const up = faceUp || open;
      const cls = faceUp ? ' shown' : open ? ' is-open' : '';
      const label = open ? 'Throw your cards to fold' : 'Hold to peek at your cards';
      return `<div class="anchor hand mine${cls}${lost}" style="${pos}" data-mine ${faceUp ? '' : `role="button" tabindex="0" aria-label="${label}"`}>
        ${p.holeCards.map((c, i) => cardHTML(c, { cls: (deal ? 'deal' : '') + winCls(c), style: `${deal ? dealStyle(L, i) : ''};--fd:${i * 70}ms`, flip: !up })).join('')}
        ${faceUp || getSettings().peekHintSeen ? '' : `<span class="peek-hint">${open ? 'Throw to fold' : 'Hold to peek · throw to fold'}</span>`}
      </div>`;
    }
    // Everyone else's cards sit behind their nameplate with the top half
    // showing, the way a player holds them against the rail: enough to see
    // them lift when that player looks, never enough to read. Positioned by
    // the plate itself rather than by the felt (see .pod-hand), so a seat
    // pinned to the rail in portrait carries its cards with it.
    if (p.holeCards) {
      return `<div class="hand pod-hand revealed${lost}" data-hand="${p.seat}">
        ${p.holeCards.map((c, i) => cardHTML(c, { cls: (justShowdown ? 'flip-in' : '') + winCls(c), style: `--d:${i * 120}ms` })).join('')}
      </div>`;
    }
    // When they're checking their hand the cards tilt up and settle — you see
    // them looking, never what they hold.
    return `<div class="hand pod-hand${p.peeking ? ' is-peeked' : ''}" data-hand="${p.seat}">
      ${[0, 1].map((i) => cardHTML('', { face: false, cls: deal ? 'deal' : '', style: `${deal ? dealStyle(L, i, L.pod) : ''};--d2:${i * 160}ms` })).join('')}
      ${p.peeking ? `<span class="peek-tell">${icons.eye}</span>` : ''}
    </div>`;
  }

  function drawBoard(t, newHand, winCards) {
    // Only cards that weren't on the felt a moment ago flip in. This counts
    // what's actually drawn rather than comparing against a previous state,
    // because redraws that aren't a step forward (taking back a fold, ending
    // a peek, resizing) come through with no previous state at all.
    const prevLen = newHand ? 0 : Math.min(renderedBoard, t.board.length);
    let html = '';
    for (let i = 0; i < 5; i++) {
      const c = t.board[i];
      if (!c) {
        html += '<div class="slot"></div>';
        continue;
      }
      const fresh = i >= prevLen && !reduceMotion;
      const win = winCards.size ? (winCards.has(c) ? 'is-win' : 'is-dim') : '';
      html += cardHTML(c, { cls: `${fresh ? 'flip-in' : ''} ${win}`, style: `--d:${(i - prevLen) * 140}ms` });
    }
    els.board.innerHTML = html;
    els.phase.textContent = PHASE_LABEL[t.phase] || '';
  }

  function drawPot(t, summary) {
    if (t.phase === 'showdown' && summary) {
      const key = `sd-${t.handNumber}`;
      if (els.pot.dataset.key === key) return; // keep the banner's entrance animation from replaying
      els.pot.dataset.key = key;
      const names = [
        ...new Set(
          summary.winners
            .map((w) => {
              const d = w.hand?.description || w.hand?.name;
              return d && w.kicker ? `${d} · ${w.kicker}` : d;
            })
            .filter(Boolean)
        ),
      ].join(' / ');
      const split = summary.winners.length > 1;
      els.pot.className = 'anchor banner';
      els.pot.innerHTML = `${summary.winners.map((w) => `<div class="banner-line">${esc(w.username)} wins <b>${fmt(w.amount)}</b></div>`).join('')}
        <div class="banner-sub">${summary.uncontested ? 'Everyone else folded' : `${split ? 'Split pot · ' : ''}${esc(names)}`}</div>`;
      return;
    }
    const seats = t.seats.filter(Boolean);
    const total = sum(seats, (p) => p.committed);
    const street = sum(seats, (p) => p.betThisStreet);
    const collected = Math.max(0, total - street);
    els.pot.dataset.key = '';
    els.pot.className = 'anchor pot';
    // Chips in the middle are what's been collected; the headline is the full
    // pot including bets still in front of players.
    els.pot.innerHTML = `<div class="pot-chips">${chipStackSVG(collected, { maxCols: 4, maxPerCol: 6 })}</div>
      <div class="pot-label">Pot</div>
      <div class="pot-amt">${fmt(total)}</div>
      ${t.currentBet > 0 && BETTING.includes(t.phase) ? `<div class="pot-sub">Current bet ${fmt(t.currentBet)}</div>` : ''}`;
  }

  function drawMuck(t) {
    const folded = t.seats.filter((s) => s && s.folded && s.hasCards).length;
    let html = '';
    for (let i = 0; i < Math.min(folded * 2, 8); i++) {
      const r = ((i * 47) % 50) - 25;
      const dx = ((i * 13) % 12) - 6;
      html += `<div class="card" style="transform:translate(${dx}%, ${-i * 2}%) rotate(${r}deg)"><div class="back">${cardBackSVG(getSettings().cardBack)}</div></div>`;
    }
    els.muck.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Betting dock
  // ---------------------------------------------------------------------------
  function dockModel(cur) {
    const t = cur.table;
    const me = t.seats.find((s) => s && s.userId === user.id && !s.left) || null;
    const betting = BETTING.includes(t.phase);
    const myTurn = !!me && betting && t.actingSeat === me.seat;
    const toCall = me ? Math.max(0, t.currentBet - me.betThisStreet) : 0;
    const total = sum(t.seats.filter(Boolean), (p) => p.committed);
    const maxTotal = me ? me.chips + me.betThisStreet : 0;
    const isRaise = t.currentBet > 0;
    const minTotal = Math.min(isRaise ? t.currentBet + t.minRaise : t.bigBlind, maxTotal);
    const canRaise = myTurn && maxTotal > t.currentBet;
    const actor = betting && t.actingSeat >= 0 ? t.seats[t.actingSeat] : null;
    // Throwing a hand away doesn't need the action on you: anyone still
    // holding live cards can fold, and one made out of turn waits for it.
    const canFold = !!me && betting && me.hasCards && !me.folded && !me.allIn && !me.sittingOut;
    return { t, me, betting, myTurn, toCall, total, maxTotal, isRaise, minTotal, canRaise, canFold, actor };
  }

  // The dock is built once and then only updated in place. Every slot has a
  // fixed size, so nothing in the dock (or the table above it) shifts when the
  // turn passes, labels change or the Peek button appears.
  function buildDock() {
    els.dock.innerHTML = `
      <div class="dock-status">
        <div class="status-line" id="st-main"></div>
        <div class="status-row">
          <div class="status-sub" id="st-sub"></div>
          <button class="btn btn-ghost btn-sm peek-btn" data-peek>${icons.eye}Peek<span class="kbd">P</span></button>
        </div>
      </div>
      <div class="dock-sizing">
        <div class="tray" role="group" aria-label="Chips: drag onto the table or tap to add to your bet">
          ${(trayDenoms = chipSet(chipScale(shown?.table))).map((d) => chipButton(d, false)).join('')}
        </div>
        <div class="sizer">
          <div class="quick">
            <button class="quick-btn" data-quick="min">Min</button>
            <button class="quick-btn" data-quick="half">½ Pot</button>
            <button class="quick-btn" data-quick="pot">Pot</button>
            <button class="quick-btn" data-quick="max">Max</button>
          </div>
          <div class="amount-row">
            <input class="range" type="range" id="amt-range" step="1" aria-label="Bet amount">
            <div class="stepper">
              <button type="button" class="step-btn" data-step="-1" aria-label="Decrease bet">${icons.minus}</button>
              <input class="input num" type="number" id="amt-input" step="1" inputmode="numeric" aria-label="Bet amount">
              <button type="button" class="step-btn" data-step="1" aria-label="Increase bet">${icons.plus}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="dock-actions">
        <button class="act act-fold" data-act="fold"><span class="act-label">${icons.fold}Fold<span class="kbd">F</span></span><span class="act-amt"></span></button>
        <button class="act act-call" data-act="check" id="call-btn"><span class="act-label"><span class="ic" id="call-ic">${icons.check}</span><span id="call-label">Check</span><span class="kbd">C</span></span><span class="act-amt" id="call-amt"></span></button>
        <button class="act act-raise" data-act="raise" id="raise-btn"><span class="act-label">${icons.raise}<span id="raise-label">Raise</span><span class="kbd">R</span></span><span class="act-amt" id="raise-amt"></span></button>
        <button class="act act-allin" data-act="allin" id="allin-btn"><span class="act-label">${icons.allin}All-in</span><span class="act-amt" id="allin-amt"></span></button>
      </div>`;
  }

  // Only touch the DOM when content actually changes, so the countdown
  // element and the badge's entrance animation aren't reset on every update.
  function setHTML(el, html) {
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
  }

  function drawDock(cur) {
    model = dockModel(cur);
    const m = model;
    const { t, me } = m;
    const q = (id) => els.dock.querySelector(`#${id}`);

    // A queue only ever belongs to the hand it was made in.
    if (queuedFold !== null && (queuedFold !== t.handNumber || !m.canFold)) queuedFold = null;

    const turnKey = m.myTurn ? `${t.handNumber}:${t.actionCount}` : '';
    if (turnKey !== myTurnKey) {
      if (turnKey) play('turn'); // it just became my turn
      myTurnKey = turnKey;
      pendingTotal = null;
      if (foldArmed) setFoldArmed(false);
      if (allinArmed) setAllinArmed(false);
    }
    els.dock.classList.toggle('not-turn', !m.myTurn);
    // Watching from the rail: there's no hand to size a bet for and nothing
    // to act on, so the tray and the action buttons go rather than sitting
    // there greyed out.
    els.dock.classList.toggle('is-watching', !me);
    // Offered on the felt, in the corner nearest the seats, and only while
    // there's a chair going spare.
    if (els.tableJoin) els.tableJoin.hidden = !!me || (shown?.seatsFree ?? 0) < 1;

    // The turn has come round to a hand already given up on: send it now,
    // rather than making the player sit and wait to press the button again.
    if (m.myTurn && queuedFold === t.handNumber) {
      queuedFold = null;
      later(() => doAction('fold'), 0); // after this draw finishes
    }

    let main;
    let sub = '';
    if (!me) {
      main = 'Spectating';
      // Nothing else: there's no hand of your own to read, and taking a
      // chair is offered on the felt rather than down here.
      sub = '';
    } else if (t.phase === 'showdown') {
      main = 'Hand complete';
      sub = 'Next hand shortly<span class="dots"></span>';
    } else if (m.myTurn) {
      main = `<span class="turn-badge">Your turn<span class="turn-clock" id="turn-clock">${icons.clock}<span id="turn-secs">–</span></span></span>`;
      sub = `${m.toCall > 0
        ? `<span class="stat stat-call">To call <b>${fmt(Math.min(m.toCall, me.chips))}</b></span>`
        : '<span class="stat stat-free">No bet to you</span>'}<span class="stat">Pot <b>${fmt(m.total)}</b></span>`;
    } else {
      const who = m.actor ? `Waiting for <b>${esc(m.actor.username)}</b>` : 'Dealing<span class="dots"></span>';
      // Someone waiting to be dealt in carries folded = true, because they
      // take no part in the hand on the table — but they haven't folded
      // anything, so say what's actually happening to them.
      main = me.sittingOut
        ? me.chips > 0
          ? 'You will join next round'
          : 'You’re out of chips'
        : me.folded
          ? 'You folded'
          : me.allIn
            ? 'You’re all-in'
            : who;
      sub = `${m.actor ? `<span class="stat stat-clock">${icons.clock}<b id="turn-secs">–</b>s</span>` : ''}${
        m.toCall > 0 && !me.folded && !me.allIn ? `<span class="stat stat-call">To call <b>${fmt(Math.min(m.toCall, me.chips))}</b></span>` : ''
      }<span class="stat">Pot <b>${fmt(m.total)}</b></span>`;
    }
    setHTML(q('st-main'), main);
    setHTML(q('st-sub'), sub);

    const canPeek = !!me && me.hasCards && !me.folded && t.phase !== 'showdown' && !autoReveal();
    els.dock.querySelector('[data-peek]').classList.toggle('is-hidden', !canPeek);

    const off = !m.myTurn;
    els.dock.querySelector('[data-act="fold"]').disabled = !m.canFold;
    const call = q('call-btn');
    call.disabled = off;
    call.dataset.act = m.toCall > 0 ? 'call' : 'check';
    setHTML(q('call-ic'), m.toCall > 0 ? icons.call : icons.check);
    q('call-label').textContent = m.toCall > 0 ? 'Call' : 'Check';
    q('call-amt').textContent = m.toCall > 0 ? fmt(Math.min(m.toCall, me.chips)) : '';
    q('allin-btn').disabled = off;
    q('allin-amt').textContent = me ? fmt(me.chips) : '';
    els.dock.querySelectorAll('.quick-btn, .step-btn, #amt-range, #amt-input').forEach((el) => (el.disabled = !m.canRaise));
    drawFoldButton();
    drawAllinButton();
    syncAmount();
  }

  function currentAmount() {
    return pendingTotal ?? model.minTotal;
  }

  function quickValue(kind) {
    const m = model;
    const potAfterCall = m.total + m.toCall;
    const v = { min: m.minTotal, half: m.t.currentBet + Math.round(potAfterCall / 2), pot: m.t.currentBet + potAfterCall, max: m.maxTotal }[kind];
    return clamp(v, m.minTotal, m.maxTotal);
  }

  // Pushes the chosen amount into the slider, number box, raise button and
  // on-table preview. `skip` is the input the user is typing in right now.
  function syncAmount(skip) {
    const m = model;
    if (!m?.me || !m.canRaise) {
      const btn = els.dock.querySelector('#raise-btn');
      btn.disabled = true;
      els.dock.querySelector('#raise-label').textContent = m?.isRaise ? 'Raise' : 'Bet';
      els.dock.querySelector('#raise-amt').textContent = '';
      els.dock.querySelectorAll('[data-quick]').forEach((b) => b.classList.remove('is-selected'));
      updateChips();
      drawPending();
      return;
    }
    const amt = currentAmount();
    const range = els.dock.querySelector('#amt-range');
    const input = els.dock.querySelector('#amt-input');
    if (range) {
      range.min = m.minTotal;
      range.max = m.maxTotal;
      if (skip !== 'amt-range') range.value = clamp(amt, m.minTotal, m.maxTotal);
      const span = m.maxTotal - m.minTotal || 1;
      range.style.setProperty('--pct', `${((clamp(amt, m.minTotal, m.maxTotal) - m.minTotal) / span) * 100}%`);
    }
    if (input && skip !== 'amt-input') {
      input.min = m.minTotal;
      input.max = m.maxTotal;
      input.value = amt;
    }
    const btn = els.dock.querySelector('#raise-btn');
    const label = els.dock.querySelector('#raise-label');
    const amtEl = els.dock.querySelector('#raise-amt');
    if (btn) {
      const allIn = amt >= m.maxTotal;
      const below = amt < m.minTotal;
      btn.disabled = below;
      label.textContent = allIn ? 'All-in' : m.isRaise ? 'Raise' : 'Bet';
      amtEl.textContent = below ? `min ${fmt(m.minTotal)}` : fmt(Math.min(amt, m.maxTotal));
    }
    els.dock.querySelectorAll('[data-quick]').forEach((b) => b.classList.toggle('is-selected', pendingTotal !== null && quickValue(b.dataset.quick) === amt));
    updateChips();
    drawPending();
  }

  // --- The tray ------------------------------------------------------------
  // The biggest figure in play at this table. A player's stack is counted
  // with what they have already put in, so the tray doesn't lose its big
  // chips halfway through a hand as those chips move into the pot.
  function chipScale(t) {
    if (!t?.seats) return 0;
    const seats = t.seats.filter(Boolean);
    if (!seats.length) return 0;
    return Math.max(
      sum(seats, (p) => p.committed || 0),
      ...seats.map((p) => (p.chips || 0) + (p.committed || 0))
    );
  }

  function chipButton(d, dealt) {
    return `<button class="chip-btn${dealt ? ' is-dealt' : ''}" data-chip="${d}" aria-label="Add ${fmt(d)} chip">${chipSVG(d)}</button>`;
  }

  // Brings the tray in line with the money at the table. Chips that have just
  // come into play are appended after the biggest one already there, and slide
  // in; the buttons already in the tray are left alone, so one being dragged
  // isn't pulled out from under the pointer.
  function syncTray() {
    const tray = els.dock?.querySelector('.tray');
    if (!tray) return;
    const want = chipSet(chipScale(shown?.table));
    if (want.length === trayDenoms.length && want.every((d, i) => d === trayDenoms[i])) return;
    const had = new Set(trayDenoms);
    const have = new Map([...tray.querySelectorAll('[data-chip]')].map((b) => [Number(b.dataset.chip), b]));
    for (const d of want) {
      let btn = have.get(d);
      if (btn) {
        have.delete(d);
      } else {
        btn = document.createElement('div');
        btn.innerHTML = chipButton(d, had.size > 0 && !reduceMotion);
        btn = btn.firstElementChild;
        btn.addEventListener('animationend', () => btn.classList.remove('is-dealt'), { once: true });
      }
      tray.append(btn); // already-placed buttons keep their order; new ones land last
    }
    have.forEach((b) => b.remove()); // a denomination the table has outgrown
    trayDenoms = want;
  }

  // Greys out chips worth more than you have left to put in, so you can't
  // reach for a 500 chip holding 80.
  function updateChips() {
    syncTray();
    const m = model;
    const left = m?.canRaise ? m.maxTotal - (pendingTotal ?? m.me.betThisStreet) : 0;
    els.dock.querySelectorAll('[data-chip]').forEach((btn) => {
      const denom = Number(btn.dataset.chip);
      const tooBig = denom > left;
      btn.disabled = !m?.canRaise || tooBig;
      btn.title = tooBig && m?.canRaise ? `You only have ${fmt(left)} left to bet` : `Add ${fmt(denom)} chip`;
    });
  }

  // Chips you've tossed out but not committed yet, shown on the felt with the
  // button that commits them: "Call" when they exactly cover the call,
  // otherwise "Raise"/"Bet".
  // Still holding cards once the hand is over, and they haven't been turned
  // over yet. Winner or not — a pot nobody contested never reaches a
  // showdown, so showing is the only way to prove what you had.
  function canShowCards() {
    const t = shown?.table;
    if (!t || t.phase !== 'showdown' || !t.lastHandSummary) return false;
    const me = t.seats.find((s) => s && s.userId === user.id && !s.left);
    if (!me || me.folded || !me.hasCards) return false;
    return !(t.lastHandSummary.showdownHands || []).some((h) => h.userId === user.id);
  }

  // The async clipboard refuses more often than you'd think — it wants a
  // focused document and a permission the browser may simply withhold, and
  // it throws NotAllowedError either way. The old selection-and-copy route
  // only needs the click that got us here, so it stands behind it.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Denied, or the document isn't focused. Fall through.
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    try {
      ta.select();
      ta.setSelectionRange(0, text.length);
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }

  // The link that gets somebody straight to this table. The token is what
  // carries the host's invitation past a private room's door, so a link is
  // worth more than the code it contains — hand it out accordingly.
  function inviteLink() {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('room', roomCode);
    if (shown?.invite) url.searchParams.set('k', shown.invite);
    return url.toString();
  }

  // Leaving the rail for a chair. Offered from the dock while watching.
  async function takeSeat() {
    try {
      await emitAck('takeSeat');
    } catch (err) {
      showError(err.message);
    }
  }

  async function revealCards() {
    if (!canShowCards()) return;
    try {
      await emitAck('showCards');
    } catch (err) {
      showError(err.message);
    }
  }

  // The same slot the bet confirmation uses, which is free once the betting
  // is over. Nobody is shown automatically: it is asked, and declining is a
  // button of its own rather than a timeout.
  function drawShowAsk(el, L) {
    if (!L || !canShowCards() || showAskDone === shown.table.handNumber) return false;
    el.classList.remove('is-empty');
    el.classList.toggle('is-side', layout.portrait);
    const x = layout.portrait ? clamp(L.cards.x + 16, 12, 66) : clamp(L.cards.x + 12, 12, 86);
    el.style.left = `${x}%`;
    el.style.top = `${clamp(layout.portrait ? L.cards.y : L.cards.y - 1, 8, 92)}%`;
    setHTML(el, `
      <div class="show-ask">Show your hand?<small>Or hold your cards</small></div>
      <div class="pending-actions">
        <button class="pending-btn is-show" data-commit="show">${icons.eye}Show</button>
        <button class="pending-btn is-clear" data-commit="show-no" aria-label="Keep them to myself">${icons.fold}</button>
      </div>`);
    return true;
  }

  function drawPending() {
    const m = model;
    const L = myLayout();
    const el = els.pending;
    if (drawShowAsk(el, L)) return;
    const total = pendingTotal ?? 0;
    const extra = m ? Math.min(total, m.maxTotal) - m.me?.betThisStreet : 0;
    if (!m?.canRaise || pendingTotal === null || !L || extra <= 0) {
      el.classList.add('is-empty');
      setHTML(el, '');
      return;
    }

    const capped = Math.min(total, m.maxTotal);
    const allIn = capped >= m.maxTotal;
    const exactCall = m.toCall > 0 && extra === Math.min(m.toCall, m.me.chips);
    const short = !exactCall && capped < m.minTotal;

    let kind;
    let label;
    if (allIn) [kind, label] = ['allin', 'All-in'];
    else if (exactCall) [kind, label] = ['call', 'Call'];
    else if (short) [kind, label] = [null, `Add ${fmt(m.minTotal - capped)} more`];
    else [kind, label] = ['raise', m.isRaise ? 'Raise' : 'Bet'];

    // Beside my own cards (I'm always the bottom seat), clear of the pot.
    // Sits just below and to the side of my own cards — clear of the board,
    // the other seats and my nameplate.
    el.classList.remove('is-empty');
    // On a phone there isn't room to centre it near the cards without landing
    // on them, so it's hung off their right-hand edge instead: `is-side`
    // anchors the box by its left edge, level with the cards.
    el.classList.toggle('is-side', layout.portrait);
    // 16% clears the full width of my own cards (--card-me is ~13% of the
    // camera across the pair) with a little air left over.
    const x = layout.portrait ? clamp(L.cards.x + 16, 12, 66) : clamp(L.cards.x + 12, 12, 86);
    const y = layout.portrait ? L.cards.y : L.cards.y - 1;
    el.style.left = `${x}%`;
    el.style.top = `${clamp(y, 8, 92)}%`;
    // setHTML keeps the button from being rebuilt (and re-animating) on every
    // unrelated table update.
    setHTML(el, `
      <div class="pending-chips">${chipStackSVG(extra, { maxCols: 2, maxPerCol: 5 })}<span class="pending-amt">+${fmt(extra)}</span></div>
      <div class="pending-actions">
        <button class="pending-btn ${kind ? `is-${kind}` : 'is-short'}" data-commit="${kind || ''}" ${kind ? '' : 'disabled'}>
          ${label}${kind && !exactCall ? `<b>${fmt(capped)}</b>` : ''}
        </button>
        <button class="pending-btn is-clear" data-commit="clear" aria-label="Take the chips back">${icons.fold}</button>
      </div>`);
  }

  // Folding is the one move you can't take back, so it asks first: the
  // button arms on the first click and only acts on the second.
  function setFoldArmed(on) {
    foldArmed = on;
    clearTimeout(foldArmTimer);
    if (on) foldArmTimer = setTimeout(() => setFoldArmed(false), 4000);
    drawFoldButton();
  }

  // A function declaration, not a const: the dock can be drawn before this
  // point in the module has run, and an arrow assigned here isn't ready yet.
  function foldQueued() {
    return queuedFold !== null && queuedFold === shown?.table.handNumber;
  }

  // Fold reads as one of four things: idle, asking, asking out of turn, or
  // waiting for the turn to come round. Only its text changes - the button
  // keeps its size, so the dock never shifts under the player's thumb.
  function drawFoldButton() {
    const btn = els?.dock.querySelector('[data-act="fold"]');
    if (!btn) return;
    const mine = !!model?.myTurn;
    const queued = foldQueued();
    let text = 'Fold';
    let note = '';
    if (foldArmed) {
      text = mine ? 'Sure?' : 'Queue it?';
      note = mine ? 'Tap again' : 'Tap again';
    } else if (queued) {
      text = 'Folding';
      note = 'CANCEL';
    }
    btn.classList.toggle('is-armed', foldArmed);
    btn.classList.toggle('is-queued', queued && !foldArmed);
    btn.title = queued && !foldArmed
      ? 'Your hand folds as soon as the action reaches you — tap to take it back'
      : 'Throw this hand away';
    const label = btn.querySelector('.act-label');
    if (label) label.innerHTML = `${icons.fold}${text}<span class="kbd">F</span>`;
    const amt = btn.querySelector('.act-amt');
    if (amt) amt.textContent = note;
  }

  // Pushing everything in can't be taken back either, so it asks first, the
  // same way Fold does.
  function setAllinArmed(on) {
    allinArmed = on;
    clearTimeout(allinArmTimer);
    if (on) allinArmTimer = setTimeout(() => setAllinArmed(false), 4000);
    drawAllinButton();
  }

  function drawAllinButton() {
    const btn = els?.dock.querySelector('#allin-btn');
    if (!btn) return;
    btn.classList.toggle('is-armed', allinArmed);
    const label = btn.querySelector('.act-label');
    if (label) label.innerHTML = `${icons.allin}${allinArmed ? 'Confirm' : 'All-in'}`;
  }

  function requestAllin() {
    if (!model?.myTurn) return;
    if (!allinArmed) {
      setAllinArmed(true);
      play('click');
      return;
    }
    setAllinArmed(false);
    doAction('allin');
  }

  function requestFold() {
    const m = model;
    if (!m?.canFold) return;
    // Already lined up: pressing again takes it back.
    if (foldQueued() && !foldArmed) {
      queuedFold = null;
      play('click');
      return drawFoldButton();
    }
    if (!foldArmed) {
      setFoldArmed(true);
      play('click');
      return;
    }
    setFoldArmed(false);
    if (m.myTurn) return doAction('fold');
    queueFold();
  }

  // Giving up on a hand before the action gets to you. Nothing is sent yet —
  // the dock fires it the moment the turn arrives — so it can still be taken
  // back right up until then.
  function queueFold() {
    queuedFold = shown?.table.handNumber ?? null;
    play('click');
    showNotice('Fold queued — it goes in the moment the action reaches you.');
    drawFoldButton();
  }

  function onDockClick(e) {
    if (e.target.closest('[data-take-seat]')) return takeSeat();
    const act = e.target.closest('[data-act]');
    if (act && !act.disabled) {
      const kind = act.dataset.act;
      if (kind !== 'fold') setFoldArmed(false); // any other action stands a fold down
      if (kind !== 'allin') setAllinArmed(false);
      if (kind === 'fold') return requestFold();
      if (kind === 'allin') return requestAllin();
      return doAction(kind);
    }
    const q = e.target.closest('[data-quick]');
    if (q && !q.disabled) {
      pendingTotal = quickValue(q.dataset.quick);
      syncAmount();
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step && !step.disabled) return nudgeAmount(Number(step.dataset.step));
    if (e.target.closest('[data-peek]')) peekBriefly();
  }

  // Steps the bet by one big blind, which is how players actually think
  // about sizing, and snaps onto that grid if the amount is off it.
  function nudgeAmount(dir) {
    const m = model;
    if (!m?.canRaise) return;
    const step = Math.max(1, m.t.bigBlind);
    const from = currentAmount();
    const snapped = dir > 0 ? Math.floor(from / step) * step : Math.ceil(from / step) * step;
    pendingTotal = clamp(snapped + dir * step, m.minTotal, m.maxTotal);
    play('chip');
    syncAmount();
  }

  function onDockInput(e) {
    if (e.target.id !== 'amt-range' && e.target.id !== 'amt-input') return;
    const v = Math.floor(Number(e.target.value));
    if (!Number.isFinite(v)) return;
    pendingTotal = clamp(v, 0, model.maxTotal);
    syncAmount(e.target.id);
  }

  async function doAction(kind) {
    const m = model;
    if (!m?.myTurn) return;
    let payload;
    if (kind === 'raise') {
      const amt = currentAmount();
      if (amt >= m.maxTotal) payload = { type: 'allin' };
      else if (amt < m.minTotal) {
        flagInvalid(els.dock.querySelector('#amt-input'));
        return showError(`Minimum is ${fmt(m.minTotal)}.`);
      }
      else payload = m.isRaise ? { type: 'raise', amount: amt - m.t.currentBet } : { type: 'bet', amount: amt };
    } else {
      payload = { type: kind };
    }
    els.dock.querySelectorAll('.act').forEach((b) => (b.disabled = true)); // no double-submits
    try {
      await emitAck('action', payload);
      playForAction(
        { fold: 'fold', check: 'check', call: 'call', allin: 'all-in', raise: 'raise', bet: 'bet' }[payload.type]
      );
      pendingTotal = null;
    } catch (err) {
      showError(err.message);
      drawDock(shown);
    }
  }

  function tryCheck() {
    const m = model;
    if (!m?.myTurn) return;
    if (m.toCall > 0) {
      showError(`There’s ${fmt(m.toCall)} to call — you can’t check.`);
      return;
    }
    const L = myLayout();
    if (L && !reduceMotion) knock(L);
    doAction('check');
  }

  // Chip tray: drag a chip onto the table (or tap it) to add it to the bet.
  // Pointer events + touch-action:none keep this from fighting page scroll.
  function onTrayPointerDown(e) {
    const btn = e.target.closest('[data-chip]');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const denom = Number(btn.dataset.chip);
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null;
    let moved = false;
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      // Capture unsupported for this pointer; listeners still work while over the chip.
    }
    const overTable = (x, y) => {
      const r = els.camera.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) {
        moved = true;
        ghost = document.createElement('div');
        ghost.className = 'chip-ghost';
        ghost.innerHTML = chipSVG(denom);
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        ghost.classList.toggle('over-table', overTable(ev.clientX, ev.clientY));
      }
    };
    const finish = (ev, cancelled) => {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', cancel);
      ghost?.remove();
      if (cancelled) return;
      if (!moved) {
        const r = btn.getBoundingClientRect();
        addChip(denom, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      } else if (overTable(ev.clientX, ev.clientY)) {
        addChip(denom, { x: ev.clientX, y: ev.clientY });
      }
    };
    const up = (ev) => finish(ev, false);
    const cancel = (ev) => finish(ev, true);
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', cancel);
  }

  function addChip(denom, point) {
    const m = model;
    if (!m?.canRaise) return;
    const base = pendingTotal ?? m.me.betThisStreet; // chips already in front of me count
    pendingTotal = Math.min(base + denom, m.maxTotal);
    play('chip');
    const L = myLayout();
    if (L && !reduceMotion) {
      const r = els.camera.getBoundingClientRect();
      const from = { x: ((point.x - r.left) / r.width) * 100, y: ((point.y - r.top) / r.height) * 100 };
      flyChips(from, { x: L.bet.x + (layout.portrait ? 12 : 7), y: L.bet.y }, 0, 0, [denom]);
    }
    syncAmount();
  }

  // Anything that hangs open — a seat's menu, a message's menu, the watchers
  // panel — shuts on the next click that lands outside it. Each used to watch
  // only its own container, so a click anywhere else on the page (the felt,
  // the dock, the top bar) left it open behind whatever you did next.
  function closeMenus(target = null) {
    const outside = (sel) => !target || !target.closest(sel);
    if (seatMenuFor != null && outside('.pod-menu, [data-seat-menu]')) {
      seatMenuFor = null;
      if (shown && mode === 'table') drawTable(null, shown);
    }
    if (chatMenuFor != null && outside('.msg-menu, [data-msg-menu]')) {
      chatMenuFor = null;
      drawChat({ keepUnread: true });
    }
    if (emojiOpen && outside('.emoji-wrap')) setEmojiOpen(false);
    if (specOpen && outside('.spec-panel, [data-spec]')) {
      specOpen = false;
      if (shown) drawSpectators(shown);
    }
  }

  // Hoisted: this is handed to addEventListener while the module is still
  // setting itself up, long before this line is reached.
  function onDocPointerDown(e) {
    closeMenus(e.target);
  }

  function onKey(e) {
    const onField = e.target instanceof Element && e.target.matches('input, textarea, select');
    if (onField || e.metaKey || e.ctrlKey || e.altKey) return;
    // Escape backs out of an open sheet from either screen, before the
    // table-only shortcuts below.
    if (e.key === 'Escape' && closeSheet()) return;
    if (mode !== 'table') return;
    const k = e.key.toLowerCase();
    const press = (kind) => {
      const b = els.dock.querySelector(`[data-act="${kind}"]`);
      if (b && !b.disabled) doAction(kind);
    };
    if (k === 'p') peekBriefly();
    else if (k === 'f') requestFold();
    else if (k === 'escape') { setFoldArmed(false); setAllinArmed(false); closeMenus(); }
    else if (k === 'c') press(model?.toCall > 0 ? 'call' : 'check');
    else if (k === 'r') press('raise');
  }

  function tickClock() {
    if (!turnEndsAt) return;
    const secs = Math.max(0, Math.ceil((turnEndsAt - performance.now()) / 1000));
    const el = root.querySelector('#turn-secs');
    if (el) el.textContent = secs;
    const clock = root.querySelector('#turn-clock');
    clock?.classList.toggle('is-low', secs <= 10);
    // Tick once a second over the last 5, so you notice the clock running out.
    if (clock && secs <= 5 && secs > 0 && secs !== lastTickSec) play('tick');
    lastTickSec = secs;
  }

  // ---------------------------------------------------------------------------
  // Peek: the view leans in while the cards bow up toward you, for as long as
  // you hold them. Releasing lays them back down.
  // ---------------------------------------------------------------------------
  function currentHand() {
    const hand = els?.seats.querySelector('[data-mine]');
    return hand && !hand.classList.contains('shown') ? hand : null;
  }

  // Done with the hint: off the screen, and off the list of things to say.
  function retireHint(el) {
    el?.remove();
    if (!getSettings().peekHintSeen) setSetting('peekHintSeen', true);
  }

  function startPeek(hand = currentHand()) {
    const L = myLayout();
    if (!hand || !L || peeking) return false;
    // They've worked out the gesture without needing to read it to the end —
    // on a touchscreen the hint is covered by the peek before it can finish.
    retireHint(hand.querySelector('.peek-hint'));
    // Once the hand is over there's nothing private left to look at, so the
    // same hold that hides your cards during play shows them afterwards.
    if (canShowCards()) {
      showAskDone = shown.table.handNumber;
      revealCards();
    }
    // Cards are already face up: nothing to lift, nothing to zoom into, and
    // no “they're looking” tell to send the rest of the table.
    if (autoReveal()) return false;
    peeking = true;
    const prefs = getSettings();
    if (!reduceMotion && prefs.peekZoom && prefs.zoomLevel > 1.01) {
      const cam = els.camera;
      const W = cam.offsetWidth;
      const H = cam.offsetHeight;
      // Frame my cards together with the board, so the community cards stay
      // on screen while I'm looking. With no board yet, zoom in on my cards.
      const camRect = cam.getBoundingClientRect();
      const k = W / (camRect.width || W); // screen px -> camera px
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { top: (r.top - camRect.top) * k, bottom: (r.bottom - camRect.top) * k };
      };
      const mine = box(hand);
      const pad = H * 0.05;
      let top = mine.top - pad;
      let bottom = mine.bottom + pad;
      if (shown?.table.board.length) {
        const b = box(els.board);
        top = Math.min(top, b.top - pad);
        bottom = Math.max(bottom, b.bottom + pad);
      }
      // Never zoom past what the player asked for, and never so far that the
      // framed area stops fitting on screen.
      const maxScale = prefs.zoomLevel * (layout.portrait ? 1.07 : 1);
      const scale = clamp(H / Math.max(1, bottom - top), 1.02, maxScale);
      const ox = W / 2;
      const oy = (top + bottom) / 2;
      // The whole transition is written inline, property included, not just
      // its duration. Below 1024px the stylesheet sets `transition: none` on
      // the camera so an on-screen keyboard resizing the viewport can't slide
      // the table — and with no transition-property to animate, a duration on
      // its own did nothing. The zoom ignored the speed setting and snapped.
      clearTimeout(zoomClearTimer);
      cam.style.transition = `transform ${prefs.zoomSpeed}ms cubic-bezier(0.3, 0.7, 0.2, 1)`;
      cam.style.transformOrigin = `${ox}px ${oy}px`;
      cam.style.transform = `translate(0px, ${H / 2 - oy}px) scale(${scale})`;
      // The further in we zoom, the more the surroundings fall away.
      const lean = clamp((scale - 1) / 0.6, 0, 1);
      els.stage.style.setProperty('--vig-dark', (0.68 + lean * 0.24).toFixed(2));
      els.stage.style.setProperty('--vig-clear', `${(46 - lean * 12).toFixed(0)}%`);
      els.stage.style.setProperty('--peek-ms', `${prefs.zoomSpeed}ms`); // fade in step with the zoom
      els.stage.classList.add('is-peeking');
    }
    hand.classList.add('lifted');
    play('flip');
    emitAck('peek', { on: true }).catch(() => {}); // tell the table I'm looking
    return true;
  }

  function endPeek(hand = currentHand()) {
    if (!peeking) return;
    peeking = false;
    if (hand?.classList.contains('lifted')) play('flip');
    hand?.classList.remove('lifted');
    emitAck('peek', { on: false }).catch(() => {});
    const cam = els.camera;
    cam.style.transform = '';
    els.stage.classList.remove('is-peeking');
    // The inline transition stays until the camera has finished travelling
    // back, so coming out is as unhurried as going in. Taking it away now
    // would snap the table to its resting size.
    clearTimeout(zoomClearTimer);
    if (cam.style.transition) {
      zoomClearTimer = setTimeout(() => {
        cam.style.transition = '';
      }, getSettings().zoomSpeed + 60);
    }
  }

  // Keyboard (P) and the Peek button: a timed look, since there's nothing to hold.
  function peekBriefly() {
    if (peeking || mode !== 'table') return;
    const hand = currentHand();
    if (!startPeek(hand)) return;
    later(() => endPeek(hand), 1400);
  }

  // ---------------------------------------------------------------------------
  // My cards: hold to peek, or drag and throw them at the felt to fold.
  // ---------------------------------------------------------------------------
  function onHandPointerDown(e) {
    const hand = e.target.closest('[data-mine]');
    // Left button or touch peeks and drags; right button peeks only.
    if (!hand || holding || dragging || peeking || hand.classList.contains('shown')) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    const L = myLayout();
    if (!L) return;
    e.preventDefault();

    // Held from here until release: this blocks redraws, which previously
    // replaced the cards mid-gesture and made drags fail at random.
    holding = true;
    const rightButton = e.pointerType === 'mouse' && e.button === 2;
    const rect = els.camera.getBoundingClientRect();
    const k = els.camera.offsetWidth / rect.width; // screen px -> camera px
    const H = els.camera.offsetHeight;
    const start = { x: e.clientX, y: e.clientY };
    const throwDist = H * 0.16; // distance toward the middle that counts as a throw
    let moved = false;
    startPeek(hand);
    try {
      hand.setPointerCapture(e.pointerId);
    } catch {
      // Capture unsupported for this pointer; window listeners below still cover it.
    }

    const delta = (ev) => ({ dx: (ev.clientX - start.x) * k, dy: (ev.clientY - start.y) * k });
    const isThrow = (d) => -d.dy > throwDist || Math.hypot(d.dx, d.dy) > throwDist * 1.6;
    // How far the pointer has to travel before a peek becomes a drag, in real
    // screen pixels. A finger resting on the cards drifts several of them a
    // second, and at ten the hold kept turning itself into a toss - so a
    // touch is given the room a finger actually needs, while a mouse, which
    // stays where it's put, keeps the tighter one.
    const slop = e.pointerType === 'mouse' ? 10 : 22;

    const move = (ev) => {
      const d = delta(ev);
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < slop) return;
      if (!moved) {
        if (rightButton) return; // right-hold is peek-only
        moved = true;
        dragging = true;
        endPeek(hand); // put the cards down before sliding them
        hand.classList.add('dragging');
        els.foldZone.classList.add('is-visible');
        els.foldLabel.textContent = model?.myTurn
          ? 'Release to fold'
          : model?.canFold
            ? 'Release to fold on your turn'
            : 'Nothing to fold';
      }
      hand.style.transform = `translate(calc(-50% + ${d.dx}px), calc(-50% + ${d.dy}px)) rotate(${d.dx * 0.08}deg)`;
      els.foldZone.classList.toggle('is-hot', isThrow(d) && !!model?.canFold);
    };
    const finish = (ev, cancelled) => {
      detach();
      holding = false;
      if (!moved) {
        endPeek(hand);
        return;
      }
      els.foldZone.classList.remove('is-visible', 'is-hot');
      hand.classList.remove('dragging');
      const d = delta(ev);
      if (!cancelled && isThrow(d) && model?.canFold) {
        // Throwing asks before mucking, same as the Fold button does. Out of
        // turn it queues instead, so the gesture works whenever you've seen
        // enough of a hand rather than only when the action reaches you.
        confirmThrow(hand, L, d);
        return;
      }
      if (!cancelled && isThrow(d)) showError('There’s no hand of yours to fold.');
      hand.style.transform = ''; // the CSS transition slides the cards back
      later(endDrag, 260);
    };
    const up = (ev) => finish(ev, false);
    const cancel = (ev) => finish(ev, true);
    const detach = () => {
      hand.removeEventListener('pointermove', move);
      hand.removeEventListener('pointerup', up);
      hand.removeEventListener('pointercancel', cancel);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    hand.addEventListener('pointermove', move);
    hand.addEventListener('pointerup', up);
    hand.addEventListener('pointercancel', cancel);
    // Safety net: if the cards are replaced mid-gesture, the window still
    // hears the release so the peek can never get stuck on.
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  // Holds the thrown cards over the felt and asks before they're mucked.
  function confirmThrow(hand, L, d) {
    const mine = !!model?.myTurn;
    hand.style.transform = `translate(calc(-50% + ${d.dx * 0.55}px), calc(-50% + ${d.dy * 0.55}px)) rotate(${d.dx * 0.05}deg)`;
    hand.classList.add('awaiting-fold');
    els.foldZone.classList.add('is-visible', 'is-hot', 'is-confirm');
    els.foldZone.innerHTML = `<div class="fold-confirm">
      <span>${mine ? 'Fold this hand?' : 'Fold when it’s your turn?'}</span>
      <button class="pending-btn is-allin" data-fold-yes>${icons.fold}${mine ? 'Fold' : 'Queue'}</button>
      <button class="pending-btn is-clear" data-fold-no aria-label="Keep my cards">${icons.leave}</button>
    </div>`;
    play('click');

    const done = (fold) => {
      els.foldZone.classList.remove('is-visible', 'is-hot', 'is-confirm');
      els.foldZone.innerHTML = `<span id="fold-zone-label">Release to fold</span>`;
      els.foldLabel = root.querySelector('#fold-zone-label');
      hand.classList.remove('awaiting-fold');
      if (fold && mine) {
        throwHand(hand, L, d);
        return;
      }
      // Out of turn nothing is mucked yet, so the cards go back where they
      // were and the dock carries the decision instead.
      if (fold) queueFold();
      hand.style.transform = '';
      later(endDrag, 260);
    };
    els.foldZone.querySelector('[data-fold-yes]').addEventListener('click', () => done(true));
    els.foldZone.querySelector('[data-fold-no]').addEventListener('click', () => done(false));
    // Don't leave the hand stranded if they walk away from the decision.
    later(() => {
      if (els.foldZone.classList.contains('is-confirm')) done(false);
    }, 6000);
  }

  async function throwHand(hand, L, d) {
    const W = els.camera.offsetWidth;
    const H = els.camera.offsetHeight;
    const tx = ((MUCK.x - L.cards.x) / 100) * W;
    const ty = ((MUCK.y - L.cards.y) / 100) * H;
    selfTossedHand = shown.table.handNumber;
    hand.classList.add('thrown');
    hand.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(${(d.dx >= 0 ? 1 : -1) * (160 + Math.random() * 80)}deg) scale(0.55)`;
    await wait(reduceMotion ? 0 : 450);
    await doAction('fold');
    endDrag();
  }

  // Redraw after a drag: applies any update that arrived meanwhile, or puts
  // my cards back in place if the fold didn't go through.
  function endDrag() {
    dragging = false;
    if (holding || peeking) return;
    draw(); // redraw from the newest state, putting the cards back in place
  }

  // ---------------------------------------------------------------------------
  // Effects: chips flying, cards tossed, action call-outs
  // ---------------------------------------------------------------------------
  function flyChips(from, to, amount, delay = 0, denoms = null) {
    let list = denoms;
    if (!list) {
      list = [];
      for (const part of breakdown(amount)) for (let i = 0; i < Math.min(part.count, 3); i++) list.push(part.denom);
      list = list.slice(0, 6);
    }
    list.forEach((d, i) => {
      const el = document.createElement('div');
      el.className = 'fx-chip';
      el.innerHTML = chipSVG(d);
      const j = () => Math.random() * 2.4 - 1.2;
      el.style.left = `${from.x + j()}%`;
      el.style.top = `${from.y + j()}%`;
      el.style.opacity = '0';
      els.fx.appendChild(el);
      later(() => {
        el.getBoundingClientRect(); // commit the start position so the move transitions
        el.style.opacity = '1';
        el.style.left = `${to.x + j()}%`;
        el.style.top = `${to.y + j()}%`;
      }, delay + i * 45);
      later(() => (el.style.opacity = '0'), delay + i * 45 + 520);
      later(() => el.remove(), delay + i * 45 + 800);
    });
  }

  function tossCards(L) {
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('div');
      el.className = 'fx-card';
      if (L.isMe) el.style.setProperty('--cw', 'var(--card-me)');
      el.innerHTML = cardBackSVG(getSettings().cardBack);
      el.style.left = `${L.cards.x + (i ? 1.5 : -1.5)}%`;
      el.style.top = `${L.cards.y}%`;
      el.style.transform = `translate(-50%, -50%) rotate(${i ? 5 : -5}deg)`;
      els.fx.appendChild(el);
      later(() => {
        el.getBoundingClientRect();
        el.style.left = `${MUCK.x + Math.random() * 4 - 2}%`;
        el.style.top = `${MUCK.y + Math.random() * 4 - 2}%`;
        el.style.transform = `translate(-50%, -50%) rotate(${200 + Math.random() * 160}deg) scale(${L.isMe ? 0.6 : 1})`;
      }, 16 + i * 70);
      later(() => (el.style.opacity = '0'), 650 + i * 70);
      later(() => el.remove(), 1100);
    }
  }

  function actionToast(L, action) {
    const d = describeAction(action);
    if (!d) return;
    const el = document.createElement('div');
    el.className = `fx-toast ${d.cls}`;
    el.textContent = d.text;
    el.style.left = `${L.pod.x}%`;
    el.style.top = `${L.pod.y - (layout.portrait ? 7 : 11)}%`;
    els.fx.appendChild(el);
    later(() => el.remove(), 1200);
  }

  function knock(L) {
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('div');
      el.className = 'fx-knock';
      el.style.left = `${L.cards.x}%`;
      el.style.top = `${L.cards.y}%`;
      el.style.setProperty('--d', `${i * 140}ms`);
      els.fx.appendChild(el);
      later(() => el.remove(), 800);
    }
  }

  // The whole hand, told in sound: cards going out, each action as it's made,
  // each street as it lands, and how the pot was settled. Runs on every
  // update, animations or not, so the table can be followed without watching.
  function playEffects(pt, t) {
    const cur = t.seats.filter(Boolean);

    if (pt.handNumber !== t.handNumber) {
      cur.forEach((_, i) => play('deal', 0.09 * i)); // cards going round the table
      return;
    }

    // Whoever just acted. My own actions are announced by doAction as they're
    // sent, so they aren't played a second time here.
    if (t.actionCount !== pt.actionCount && pt.actingSeat >= 0) {
      const actor = t.seats[pt.actingSeat];
      if (actor && actor.userId !== user.id) playForAction(actor.lastAction);
    }

    const streetChanged = pt.phase !== t.phase;

    // Community cards hitting the felt, then the street's own tag once the
    // last one has landed, so a flop, a turn and a river are told apart.
    if (streetChanged && t.board.length > pt.board.length) {
      const dealt = t.board.length - pt.board.length;
      for (let i = 0; i < dealt; i++) play('deal', 0.12 * i);
      if (STREET_SOUND[t.phase]) play(STREET_SOUND[t.phase], 0.12 * (dealt - 1));
    }

    if (streetChanged && t.phase === 'showdown' && t.lastHandSummary) {
      const summary = t.lastHandSummary;
      if (!summary.uncontested) {
        const others = cur.filter((p) => !p.folded && p.userId !== user.id).length;
        for (let i = 0; i < others; i++) play('flip', 0.12 * i);
      }
      play(summary.winners.some((w) => w.userId === user.id) ? 'win' : 'lose', 0.55);
    }
  }

  function runEffects(pt, t) {
    const prevSeats = new Map(pt.seats.filter(Boolean).map((p) => [p.userId, p]));
    const cur = t.seats.filter(Boolean);

    if (pt.handNumber !== t.handNumber) {
      // New hand: blinds slide from stacks into the betting line.
      for (const p of cur) {
        const L = layout.map.get(p.seat);
        if (p.betThisStreet > 0) flyChips(L.stack, L.bet, p.betThisStreet, 200);
      }
      return;
    }

    const streetChanged = pt.phase !== t.phase;

    // Call-out for whoever just acted (and the "knock" for a check).
    if (t.actionCount !== pt.actionCount && pt.actingSeat >= 0) {
      const actor = t.seats[pt.actingSeat];
      const L = actor && layout.map.get(actor.seat);
      if (L) {
        actionToast(L, actor.lastAction);
        if (actor.lastAction?.startsWith('check') && !L.isMe) knock(L);
      }
    }

    for (const p of cur) {
      const q = prevSeats.get(p.userId);
      const L = layout.map.get(p.seat);
      if (!q || !L) continue;
      // (My own thrown cards already flew to the muck under my finger.)
      if (!q.folded && p.folded && q.hasCards && !(L.isMe && selfTossedHand === t.handNumber)) tossCards(L);
      const added = p.committed - q.committed;
      if (added > 0) {
        // A bet that closes the street goes straight into the pot.
        if (!streetChanged && BETTING.includes(t.phase)) flyChips(L.stack, L.bet, added);
        else flyChips(L.stack, POT, added);
      }
      if (streetChanged && q.betThisStreet > 0) flyChips(L.bet, POT, q.betThisStreet, 120);
    }

    if (streetChanged && t.phase === 'showdown' && t.lastHandSummary) {
      const summary = t.lastHandSummary;
      for (const w of summary.winners) {
        const p = cur.find((s) => s.userId === w.userId);
        const L = p && layout.map.get(p.seat);
        if (L) flyChips(POT, L.stack, w.amount, 900);
      }
    }
  }

  function playForAction(action) {
    if (!action) return;
    if (action.startsWith('check')) play('check');
    else if (action === 'fold' || action === 'timed out' || action === 'left') play('fold');
    else if (action.includes('all-in')) play('allin');
    else if (action.startsWith('raise') || action.startsWith('bet')) play('raise');
    else if (action.startsWith('call')) play('call');
    else if (action.includes('blind')) play('chip');
  }
}
