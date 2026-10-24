// Poker table screen: waiting room, live table, betting dock and all table
// animations. The table skeleton is built once; each server update redraws
// only the parts that change so inputs, hover states and animations survive.
import { getSocket, emitAck } from './socket.js';
import { cardFaceSVG, cardBackSVG } from './svg/cards.js';
import { chipSVG, chipStackSVG, breakdown, CHIP_DENOMINATIONS } from './svg/chips.js';
import { tableFeltSVG, dealerButtonSVG, turnRingSVG } from './svg/table.js';
import { avatarSVG } from './svg/avatars.js';
import { icons } from './svg/icons.js';
import { motionReduced, toggleMotion } from './motion.js';
import { play, soundMuted, toggleSound } from './sound.js';
import { userPillHTML, wireNameEditor } from './name.js';
import { getSettings, setSetting, ZOOM } from './settings.js';
import { showToast } from './toast.js';
import { numberFieldHTML, wireSteppers } from './stepper.js';

const BETTING = ['preflop', 'flop', 'turn', 'river'];
const PHASE_LABEL = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
// The tag played as each street lands ('turn' is already the it's-your-turn
// chime, so the turn card gets its own name).
const STREET_SOUND = { flop: 'flop', turn: 'turnCard', river: 'river' };
// Table landmarks, in % of the camera box. Portrait (phones) stacks the
// board lower so it clears the upper seats' bets.
const CENTER = { x: 50, y: 50 };
const LANDMARKS = {
  // boardHalf is the space the community cards occupy, as a half-width and
  // half-height in % of the camera; nothing else is allowed to sit inside it.
  // cardPad widens the board's keep-out box by roughly half a pair of cards,
  // because clearOfBoard only knows where a hand's centre point is: without it
  // a seat whose cards sit diagonally off the board still ends up touching it.
  landscape: { board: { x: 50, y: 44 }, pot: { x: 50, y: 60 }, muck: { x: 64, y: 60 }, betK: 0.56, myBetK: 0.56, cardsK: 0.4, boardHalf: { w: 21, h: 12 }, cardPad: { w: 7, h: 11 } },
  portrait: { board: { x: 50, y: 50 }, pot: { x: 50, y: 63 }, muck: { x: 73, y: 63 }, betK: 0.45, myBetK: 0.5, cardsK: 0.37, boardHalf: { w: 27, h: 10 }, cardPad: { w: 10, h: 7 } },
};

// Nudges a point out of the board's footprint, straight away from its centre,
// so bets and other players' cards never land on the community cards.
function clearOfBoard(p, half, margin = 1.2) {
  const dx = p.x - BOARD.x;
  const dy = p.y - BOARD.y;
  const spread = Math.hypot(dx / half.w, dy / half.h);
  if (spread >= margin) return p;
  if (spread < 0.001) return { x: p.x, y: BOARD.y + half.h * margin }; // dead centre
  const k = margin / spread;
  return { x: BOARD.x + dx * k, y: BOARD.y + dy * k };
}
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
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

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
  if (a === 'small blind') return { text: 'SB', cls: '' };
  if (a === 'big blind') return { text: 'BB', cls: '' };
  if (a.startsWith('raise') || a.startsWith('bet')) return { text: a.replace(' (all-in)', ''), cls: a.includes('all-in') ? 't-allin' : 't-raise' };
  if (a === 'all-in' || a.includes('all-in')) return { text: 'All-in', cls: 't-allin' };
  if (a === 'fold' || a === 'timed out') return { text: a === 'fold' ? 'Fold' : 'Timed out', cls: 't-fold' };
  if (a.startsWith('check')) return { text: 'Check', cls: '' };
  if (a === 'call') return { text: 'Call', cls: '' };
  if (a === 'left') return { text: 'Left', cls: 't-fold' };
  return { text: a, cls: '' };
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
  let pendingTotal = null; // chosen bet/raise-to total, null = use minimum
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
  let chatUnread = 0; // messages that arrived while the panel was shut
  let chatReplyTo = null; // id of the message being replied to
  let chatEditing = null; // id of my message being edited
  let chatMenuFor = null; // id whose actions menu is open
  let chatMissed = []; // messages that landed while reading back, newest last
  let openVotes = []; // vote-kicks currently running at this table
  let seatMenuFor = null; // userId whose seat menu is open
  let dismissedGameOver = null; // key of a result the player has closed
  let askingLeave = false; // the leave confirmation is up
  let showAskDone = 0; // hand whose "show your cards?" prompt has been answered
  // Seat number -> the spot its cards were last nudged to, so a redraw during
  // a peek can restore it without measuring anything. Declared up here with
  // the rest of the state: the first draw can land before the body of this
  // function has finished running, and a `const` further down isn't ready yet.
  const cardNudges = new Map();
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
    socket.off('connect', resync);
    clearInterval(clock);
    timers.forEach(clearTimeout);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onDocPointerDown);
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
    // Somebody else talking while the panel is shut is worth a nudge; your
    // own message never is.
    if (!chatShowing() && entry.userId !== user.id) chatUnread += 1;
    if (entry.userId !== user.id) play('click');
    // Reading back when it landed: hold on to it for the jump button, so the
    // way down also says what is waiting at the bottom.
    const mine = entry.userId === user.id;
    if (!mine && chatShowing() && !chatAtBottom()) {
      chatMissed.push({ name: entry.system ? 'Table' : entry.name, text: entry.text });
      if (chatMissed.length > 99) chatMissed.shift();
    }
    drawChat({ keepUnread: true });
    if (mine) scrollChatToEnd(); // your own message always brings you down
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

  function drawChat({ keepUnread = false } = {}) {
    if (!els?.chatLog) return;
    if (!keepUnread) chatUnread = 0;
    drawUnread();
    drawComposer();
    if (!chatLog.length) {
      setHTML(els.chatLog, '<li class="chat-empty">Nobody has said anything yet.</li>');
      drawJump();
      return;
    }
    // Stick to the newest message unless the reader has scrolled up to read
    // back, in which case leave their place alone.
    const log = els.chatLog;
    const atBottom = chatAtBottom();
    setHTML(log, chatLog.map(bubbleHTML).join(''));
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

  function bubbleHTML(m, i) {
    // The room talking: centred, plain, and nobody's to reply to.
    if (m.system) return `<li class="chat-system">${esc(m.text)}</li>`;
    const mine = m.userId === user.id;
    // Messages from one person in a row are grouped: only the first shows a
    // name and face, and the corner radii round off the outside of the run
    // so it reads as one block rather than a stack of separate boxes.
    const prev = chatLog[i - 1];
    const next = chatLog[i + 1];
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
    return `<aside class="${waiting ? 'waiting-chat' : 'chat'}" id="chat" aria-label="Table chat">
      <div class="chat-head"><span>Table chat</span>
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

    if (e.target.closest('[data-chat-close]')) return setChatOpen(false);
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
    els.spectators.hidden = list.length === 0;
    if (!list.length) {
      specOpen = false;
      els.specPanel.hidden = true;
      return;
    }
    els.specCount.textContent = compact(list.length);
    const btn = els.spectators.querySelector('[data-spec]');
    btn.setAttribute('aria-expanded', String(specOpen));
    btn.classList.toggle('is-open', specOpen);
    btn.title = `${fmt(list.length)} watching`;
    els.specPanel.hidden = !specOpen;
    if (!specOpen) return;
    const isHost = cur.hostUserId === user.id;
    setHTML(
      els.specPanel,
      `<div class="spec-head">${icons.eye}Watching<b>${compact(list.length)}</b></div>
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
      root.appendChild(el);
    } else if (el !== root.lastElementChild) {
      root.appendChild(el); // a screen rebuild put it out of order
    }
    return el;
  }

  function drawOverlay(cur) {
    const el = overlayHost();
    // An open settings sheet keeps itself up to date in place. Rebuilding it
    // replaces the node under the switch being pressed, which replays its
    // entrance animation — every toggle made the panel blink out and back.
    if (askingSettings && el.querySelector('.sheet-settings')) return syncSettingsSheet();
    const html = overlayHTML(cur);
    el.classList.toggle('is-empty', !html);
    setHTML(el, html);
  }

  function overlayHTML(cur) {
    if (askingLeave) return leaveConfirmHTML(cur);
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

  function celebrationHTML(over) {
    const w = over.winner;
    const iWon = w?.userId === user.id;
    return `<div class="sheet sheet-win" role="dialog" aria-modal="true" aria-label="Game over">
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

  // The same visual settings the lobby offers, reachable without leaving the
  // table. Everything here is per-browser and takes effect on the next draw.
  function settingsHTML() {
    const s = getSettings();
    const zoomOff = s.autoReveal || !s.peekZoom;
    return `<div class="sheet sheet-settings" role="dialog" aria-modal="true" aria-label="Table settings">
      <h2 class="sheet-title">Table settings</h2>
      <div class="set-list">
        <section class="set-group">
          <h3 class="set-head">${icons.eye}Your cards</h3>
          <label class="switch-row">
            <input type="checkbox" data-set="autoReveal" ${s.autoReveal ? 'checked' : ''}>
            <span>Turn my cards face up as soon as they're dealt<small>Nothing left to peek at, and the table can't see you looking</small></span>
          </label>
          <label class="switch-row">
            <input type="checkbox" data-set="peekZoom" ${s.peekZoom ? 'checked' : ''} ${s.autoReveal ? 'disabled' : ''}>
            <span>Zoom in on my cards when peeking</span>
          </label>
          <div class="set-field" ${zoomOff ? 'hidden' : ''}>
            <label for="set-zoom-level">Zoom strength <b>${s.zoomLevel.toFixed(2)}×</b></label>
            <input class="range" type="range" id="set-zoom-level" data-set="zoomLevel"
              min="${ZOOM.level.min}" max="${ZOOM.level.max}" step="${ZOOM.level.step}" value="${s.zoomLevel}">
          </div>
          <div class="set-field" ${zoomOff ? 'hidden' : ''}>
            <label for="set-zoom-speed">Zoom speed <b>${s.zoomSpeed} ms</b></label>
            <input class="range" type="range" id="set-zoom-speed" data-set="zoomSpeed"
              min="${ZOOM.speed.min}" max="${ZOOM.speed.max}" step="${ZOOM.speed.step}" value="${s.zoomSpeed}">
          </div>
        </section>
        <section class="set-group">
          <h3 class="set-head">${icons.sparkle}Table</h3>
          <label class="switch-row">
            <input type="checkbox" data-set="motion" ${reduceMotion ? '' : 'checked'}>
            <span>Animations<small>Cards dealing, chips moving, the countdown ring</small></span>
          </label>
          <label class="switch-row">
            <input type="checkbox" data-set="sound" ${soundMuted() ? '' : 'checked'}>
            <span>Sounds</span>
          </label>
        </section>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-lg" data-ov="settings-close">Done</button>
      </div>
    </div>`;
  }

  function bustedHTML(cur) {
    const live = cur.table.seats.filter((s) => s && !s.left && s.chips > 0).length;
    return `<div class="sheet sheet-bust" role="dialog" aria-modal="true" aria-label="Out of chips">
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
  function syncSettingsSheet() {
    const sheet = root.querySelector('.sheet-settings');
    if (!sheet) return;
    const s = getSettings();
    const zoom = sheet.querySelector('[data-set="peekZoom"]');
    if (zoom) zoom.disabled = s.autoReveal;
    const off = s.autoReveal || !s.peekZoom;
    sheet.querySelectorAll('.set-field').forEach((f) => (f.hidden = off));
  }

  // Backs out of whichever sheet is up, if it's one you're allowed to
  // decline. The end of a game and busting out both need a real answer, so
  // they aren't listed here.
  function closeSheet() {
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
    const btn = e.target.closest('[data-ov]');
    if (!btn) return;
    const kind = btn.dataset.ov;
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
      mode = 'waiting';
      drawWaiting(shown); // keeps the chat panel, drops the table's elements
    } else if (mode !== 'table') {
      buildTable();
      mode = 'table';
      renderedHand = 0; // fresh table: let the first hand deal in
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
  function topbarHTML(t) {
    return `<header class="topbar">
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
        ${userPillHTML(user)}
        <!-- Sounds, face-up cards and animations all live in the settings
             sheet now: one button on the bar, one place to look. -->
        <button class="btn btn-ghost btn-sm btn-icon" data-settings title="Table settings" aria-label="Table settings">${icons.gear}</button>
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
    wireNameEditor(root, user);
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
    root.querySelector('[data-settings]')?.addEventListener('click', () => {
      askingSettings = true;
      drawOverlay(shown);
    });
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
      ${topbarHTML(t)}
      <main class="page waiting-page">
        <section class="panel waiting-panel">
          <div class="eyebrow">Waiting room</div>
          <h1 class="display">Gather your players</h1>
          <p class="lead">${isHost ? 'Share the code, set everyone’s starting chips, then deal the first hand.' : 'The host sets everyone’s starting chips and deals the first hand.'}</p>
          <div class="code-block">
            <div><div class="micro">Room code</div><div class="room-code selectable">${esc(roomCode)}</div></div>
            <span class="code-acts">
              <button class="btn btn-ghost btn-sm" data-copy="link" title="Copy a link that drops them straight into this room">${icons.copy}<span>Copy link</span></button>
              <button class="btn btn-ghost btn-sm" data-copy="code" title="Copy just the five-letter code">${icons.copy}<span>Copy code</span></button>
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
      try {
        await emitAck('setStartingChips', { chips: Number(e.target.value) });
      } catch (err) {
        draw(); // put the old figure back before the message, which it would wipe
        showError(err.message);
      }
    });
    root.querySelectorAll('[data-blind]').forEach((input) => {
      input.addEventListener('change', async () => {
        const read = (k) => Number(root.querySelector(`[data-blind="${k}"]`)?.value);
        try {
          await emitAck('setBlinds', { smallBlind: read('sb'), bigBlind: read('bb') });
        } catch (err) {
          draw(); // put the old figures back first: it rebuilds the screen,
          showError(err.message); // and would wipe the message if it followed
        }
      });
    });
    root.querySelector('[data-join-chips]')?.addEventListener('change', async (e) => {
      try {
        await emitAck('setJoinChips', { chips: Number(e.target.value) });
      } catch (err) {
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
          <div class="felt">${tableFeltSVG()}</div>
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
      history: $('history'), historyList: $('history-list'),
      hhQ: $('hh-q'), hhWinner: $('hh-winner'), hhType: $('hh-type'), hhNo: $('hh-no'),
      hhClear: $('hh-clear'), hhX: $('hh-x'),
      spectators: $('spectators'), specCount: root.querySelector('.spec-count'), specPanel: $('spec-panel'),
      tableJoin: $('table-join'),
      chat: $('chat'), chatLog: $('chat-log'), chatForm: $('chat-form'), chatInput: $('chat-input'),
      chatJump: $('chat-jump'),
    };
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

    els.spectators.addEventListener('click', async (e) => {
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
    place(els.board.parentElement, BOARD);
    place(els.pot, POT);
    place(els.muck, MUCK);
    place(els.foldZone, BOARD);
    // Someone who has left (or been voted out) mid-hand still holds a seat on
    // the server until the hand ends — their chips are in the pot — but
    // they're gone from the table, so the remaining seats close up around
    // the gap straight away rather than leaving a “Left” plate behind.
    const list = table.seats.filter((p) => p && !p.left);
    let start = list.findIndex((s) => s.userId === user.id);
    if (start < 0) start = 0;
    const ordered = [...list.slice(start), ...list.slice(0, start)];
    const n = ordered.length;
    const cardKeepOut = { w: lm.boardHalf.w + lm.cardPad.w, h: lm.boardHalf.h + lm.cardPad.h };
    // How far a seat's chips must sit from its cards to stay visible: half a
    // pair of cards plus the chip and its label. --card-o in the stylesheet
    // is clamp(26px, 7.4cqmin, 54px).
    const camW = els.camera.clientWidth || 1;
    const camH = els.camera.clientHeight || 1;
    const cardW = Math.min(54, Math.max(26, 0.074 * Math.min(camW, camH)));
    const minBetGap = cardW * 0.9 + 24;
    // My own hand is drawn much larger than anyone else's (--card-me against
    // --card-o), and my chips sit on the same line from my seat to the middle,
    // so they landed on top of my cards. They move aside by a measured amount
    // rather than a nudge: half a pair is a whole card wide, plus the chip
    // stack and a margin. Sideways, not upwards — in portrait the pot sits
    // directly above the hand and there's no room between the two.
    const myCardW = Math.min(96, Math.max(46, 0.125 * Math.min(camW, camH)));
    const myBetSide = ((myCardW + 38) / camW) * 100;
    const rx = portrait ? 36 : 44;
    const ry = 43;
    const map = new Map();
    ordered.forEach((p, i) => {
      // Seat 0 (me) at the bottom; others follow clockwise in action order.
      const a = ((90 + (i * 360) / n) * Math.PI) / 180;
      const pod = { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
      const isMe = p.userId === user.id;
      // My own cards, my “Your turn” tag and my nameplate stack up in the same
      // narrow strip at the bottom. The plate drops a little and cardsK lifts
      // my hand (there's only a few pixels between the plate and the edge of
      // the table, so the room has to come from above) to leave the tag
      // between them readable as the cards grow with the screen.
      if (isMe) pod.y += portrait ? 2.5 : 1.5;
      const toward = (k) => ({ x: pod.x + (CENTER.x - pod.x) * k, y: pod.y + (CENTER.y - pod.y) * k });
      // Cards sit on the felt in front of each seat — far enough in to be
      // clearly visible rather than hiding behind the nameplate.
      // In front of the seat, but kept off the community cards by the board's
      // keep-out box widened by the cards' own size. Overlapping the nameplate
      // is fine - the cards are drawn on top of it, so you can still see them
      // tilt when that player peeks.
      const cards = isMe
        ? toward(lm.cardsK)
        : clearOfBoard(toward(portrait ? 0.3 : 0.32), cardKeepOut, 1.12);
      const vx = CENTER.x - pod.x;
      const vy = CENTER.y - pod.y;
      const len = Math.hypot(vx, vy) || 1;
      // Dealer button sits beside the cards, on the side facing the table's
      // edge so it never lands on the board.
      const off = isMe ? (portrait ? 16 : 10) : portrait ? 11 : 7;
      let px = -vy / len;
      let py = vx / len;
      if (Math.abs(cards.x - px * off - 50) > Math.abs(cards.x + px * off - 50) + 0.01) {
        px = -px;
        py = -py;
      }
      let bet = isMe ? toward(lm.myBetK) : clearOfBoard(toward(lm.betK), lm.boardHalf);
      // Cards and bet both sit on the line from the seat to the middle, so for
      // seats near the board they can land on top of each other and hide the
      // chips. Measured in real pixels — an x percentage is of the camera's
      // width and a y percentage of its height, so the two can't be compared
      // directly — and the bet slides sideways, away from the dealer button,
      // until it clears the cards.
      // Mine sit beside my hand, on the opposite side from the dealer button.
      if (isMe) bet = { x: clamp(cards.x - px * myBetSide, 7, 93), y: bet.y };
      const apart = Math.hypot(((cards.x - bet.x) / 100) * camW, ((cards.y - bet.y) / 100) * camH);
      if (!isMe && apart < minBetGap) {
        const push = ((minBetGap - apart) / camW) * 100;
        bet = clearOfBoard({ x: bet.x - px * push, y: bet.y - py * push }, lm.boardHalf);
      }
      const dealer = { x: cards.x + px * off, y: cards.y + py * off };
      // Portrait is tight: pull side seats out to the rail and keep them clear
      // of the band across the middle where the board sits.
      let side = null;
      if (portrait && !isMe) {
        if (Math.abs(pod.y - 50) < 15) pod.y = 50 + (pod.y >= 50 ? 15 : -15);
        if (Math.abs(pod.x - 50) > 12) {
          side = pod.x < 50 ? 'left' : 'right';
          pod.x = side === 'left' ? 2 : 98;
        }
      }
      const stack = { x: pod.x + (portrait ? 9 : 5), y: pod.y };
      map.set(p.seat, { pod, cards, bet, dealer, stack, isMe, side, index: i });
    });
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
    clearCardsOfPods();
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
      board: summary.uncontested ? [] : summary.board || [],
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
    // Only hands that were actually shown down have cards to look at — plus
    // my own, which I can always look back at.
    const cards = h.winners.some((w) => w.cards?.length) || !!h.yourCards?.length || !!h.showed?.length;
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
      // needs to carry the hand itself — keeps the pill small.
      const w = summary?.winners.find((x) => x.userId === p.userId);
      return { text: w?.hand ? w.hand.description || w.hand.name : 'Winner', cls: 't-win', icon: icons.crown, kicker: w?.kicker };
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
    const cls = ['anchor', 'pod', L.isMe && 'is-me', acting && 'is-acting', p.folded && !away && 'is-folded', away && 'is-away', isWinner && 'is-winner', isLoser && 'is-loser', menuOpen && 'has-menu', L.pod.y > 62 && 'is-low', L.side && `side-${L.side}`, p.isBot && levelClass(p.botLevel)]
      .filter(Boolean)
      .join(' ');
    const tag = seatTag(p, { acting, isMe: L.isMe, isWinner, t, summary: ctx.summary });
    let ring = '';
    if (acting && turnEndsAt) {
      const remaining = Math.max(0, turnEndsAt - performance.now());
      ring = turnRingSVG(turnTotal, turnTotal - remaining);
    }
    const stack = p.chips > 0 ? `<div class="stack">${chipStackSVG(p.chips, { maxCols: 3, maxPerCol: 6 })}</div>` : '';

    let html = `<div class="${cls}" style="left:${L.pod.x}%;top:${L.pod.y}%" data-seat="${p.seat}">
      <div class="avatar">${avatarSVG(p.username)}${p.isBot ? `<span class="bot-mark">${icons.robot}</span>` : ''}${ring}</div>
      <div class="who"><span class="name-row"><span class="name">${esc(p.username)}</span>${marksHTML(p, ctx)}</span><span class="amt">${fmt(p.chips)}</span></div>
      ${stack}
      ${p.isBot ? `<span class="bot-level ${levelClass(p.botLevel)}">${esc(levelLabel(p.botLevel))}</span>` : ''}
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
    </div>`;
    html += handHTML(p, L, ctx);
    if (BETTING.includes(t.phase) && p.betThisStreet > 0) {
      html += `<div class="anchor bet" style="left:${L.bet.x}%;top:${L.bet.y}%">${chipStackSVG(p.betThisStreet, { maxCols: 2, maxPerCol: 5 })}<span class="bet-amt">${fmt(p.betThisStreet)}</span></div>`;
    }
    if (t.dealerSeat === p.seat) {
      html += `<div class="anchor dealer" style="left:${L.dealer.x}%;top:${L.dealer.y}%">${dealerButtonSVG()}</div>`;
    }
    return html;
  }

  // The seat positions are worked out from percentages before anything is on
  // screen, so they can't know how wide a nameplate turned out with this
  // player's name at this font size. This measures both afterwards and, where
  // they overlap, looks for the nearest spot that clears the nameplate while
  // staying off the community cards and inside the table.

  function applyNudges() {
    for (const hand of els.seats.querySelectorAll('[data-hand]')) {
      const at = cardNudges.get(Number(hand.dataset.hand));
      if (!at) continue;
      hand.style.left = at.left;
      hand.style.top = at.top;
    }
  }

  function clearCardsOfPods() {
    if (!layout || !els?.seats) return;
    // Where a hand ends up is decided by measuring what's actually on screen,
    // so the answer depends on the camera it's measured through. A peek zooms
    // that camera, and every redraw while it's held — any bet, any fold —
    // re-ran this and could settle on a different spot, so other players'
    // cards twitched around the felt while you were reading your own. The
    // seats are rebuilt from markup each time, so the last placements are
    // put back rather than worked out afresh.
    if (peeking || dragging) return applyNudges();
    const W = els.camera.offsetWidth;
    const H = els.camera.offsetHeight;
    if (!W || !H) return;
    const rect = els.camera.getBoundingClientRect();
    const k = W / (rect.width || W); // screen px -> camera px
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        l: (r.left - rect.left) * k,
        r: (r.right - rect.left) * k,
        t: (r.top - rect.top) * k,
        b: (r.bottom - rect.top) * k,
      };
    };
    const hits = (a, b, pad = 2) =>
      Math.min(a.r, b.r) - Math.max(a.l, b.l) > -pad && Math.min(a.b, b.b) - Math.max(a.t, b.t) > -pad;
    const half = boardHalfOf();
    const bx = (BOARD.x / 100) * W;
    const by = (BOARD.y / 100) * H;
    const hw = (half.w / 100) * W;
    const hh = (half.h / 100) * H;

    // Straight out from the middle first, then sideways, then back in: the
    // rail usually has the room the board doesn't.
    const dirs = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      dirs.push([Math.cos(a), Math.sin(a)]);
    }

    // Chips in front of a seat are as much worth seeing as the nameplate.
    const betBoxes = [...els.seats.querySelectorAll('.bet')].map(box);

    for (const hand of els.seats.querySelectorAll('[data-hand]')) {
      const seat = Number(hand.dataset.hand);
      const L = layout.map.get(seat);
      if (!L || L.isMe) continue; // my own hand is draggable; leave it be
      const pod = els.seats.querySelector(`.pod[data-seat="${seat}"]`);
      if (!pod) continue;
      const podBox = box(pod);
      const handBox = box(hand);
      const blocked = (b) => hits(podBox, b, 0) || betBoxes.some((x) => hits(x, b, 0));
      if (!blocked(handBox)) {
        cardNudges.delete(seat); // sits fine where the layout put it
        continue;
      }

      const w = handBox.r - handBox.l;
      const h = handBox.b - handBox.t;
      const cx = (L.cards.x / 100) * W;
      const cy = (L.cards.y / 100) * H;
      let placed = null;
      for (let step = 8; step <= 120 && !placed; step += 8) {
        for (const [ux, uy] of dirs) {
          const nx = cx + ux * step;
          const ny = cy + uy * step;
          const b = { l: nx - w / 2, r: nx + w / 2, t: ny - h / 2, b: ny + h / 2 };
          if (blocked(b)) continue; // still on the nameplate or someone's chips
          if (Math.hypot((nx - bx) / hw, (ny - by) / hh) < 1) continue; // on the board
          if (b.l < 4 || b.r > W - 4 || b.t < 4 || b.b > H - 4) continue; // off the table
          placed = { nx, ny };
          break;
        }
      }
      if (!placed) continue; // nowhere better; leave it where it was
      const at = { left: `${(placed.nx / W) * 100}%`, top: `${(placed.ny / H) * 100}%` };
      cardNudges.set(seat, at);
      hand.style.left = at.left;
      hand.style.top = at.top;
    }
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

  // The board's keep-out, inflated by the cards' own size, in percent.
  function boardHalfOf() {
    const lm = layout?.portrait ? LANDMARKS.portrait : LANDMARKS.landscape;
    return { w: lm.boardHalf.w + lm.cardPad.w, h: lm.boardHalf.h + lm.cardPad.h };
  }

  // Deal animation offset: each card flies in from the deck, round-robin.
  function dealStyle(L, cardIdx) {
    const W = els.camera.clientWidth;
    const H = els.camera.clientHeight;
    const dx = ((DECK.x - L.cards.x) / 100) * W;
    const dy = ((DECK.y - L.cards.y) / 100) * H;
    return `--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--d:${(cardIdx * layout.n + L.index) * 90}ms`;
  }

  // `flip: true` builds a two-sided card that turns over in 3D (used for my
  // own hole cards, which flip face-up while I peek).
  function cardHTML(code, { cls = '', style = '', face = true, flip = false, simple = false } = {}) {
    if (flip) {
      return `<div class="card ${cls}" style="${style}"><div class="flip">
        <div class="back">${cardBackSVG()}</div>
        <div class="face">${cardFaceSVG(code, { simple })}</div>
      </div></div>`;
    }
    const faceLayer = face ? `<div class="face">${cardFaceSVG(code, { simple })}</div>` : '';
    return `<div class="card ${cls}" style="${style}">${faceLayer}<div class="back">${cardBackSVG()}</div></div>`;
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
    if (p.holeCards) {
      return `<div class="anchor hand revealed${lost}" style="${pos}" data-hand="${p.seat}">
        ${p.holeCards.map((c, i) => cardHTML(c, { cls: (justShowdown ? 'flip-in' : '') + winCls(c), style: `--d:${i * 120}ms` })).join('')}
      </div>`;
    }
    // Someone else's face-down cards. When they're checking their hand the
    // cards tilt up and settle — you see them looking, never what they hold.
    return `<div class="anchor hand${p.peeking ? ' is-peeked' : ''}" style="${pos}" data-hand="${p.seat}">
      ${[0, 1].map((i) => cardHTML('', { face: false, cls: deal ? 'deal' : '', style: `${deal ? dealStyle(L, i) : ''};--d2:${i * 160}ms` })).join('')}
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
      html += `<div class="card" style="transform:translate(${dx}%, ${-i * 2}%) rotate(${r}deg)"><div class="back">${cardBackSVG()}</div></div>`;
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
          ${CHIP_DENOMINATIONS.map((d) => `<button class="chip-btn" data-chip="${d}" aria-label="Add ${d} chip">${chipSVG(d)}</button>`).join('')}
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
    const join = q('join-btn');
    if (join) {
      const free = shown?.seatsFree ?? 0;
      join.disabled = free < 1;
      setHTML(q('join-label'), `${icons.chevron}${free > 0 ? 'Take a seat' : 'Every seat is taken'}`);
      join.title = free > 0 ? 'You’ll be dealt in on the next hand' : 'Every seat is taken right now';
    }
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

  // Greys out chips worth more than you have left to put in, so you can't
  // reach for a 500 chip holding 80.
  function updateChips() {
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
      else if (amt < m.minTotal) return showError(`Minimum is ${fmt(m.minTotal)}.`);
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
      cam.style.transitionDuration = `${prefs.zoomSpeed}ms`;
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
    els.camera.style.transform = '';
    els.stage.classList.remove('is-peeking');
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
      el.innerHTML = cardBackSVG();
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
