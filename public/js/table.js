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
import { getSettings, setSetting } from './settings.js';
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
  let spectating = false; // chose to watch on after busting out
  let dismissedGameOver = null; // key of a result the player has closed
  let askingLeave = false; // the leave confirmation is up

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
  socket.on('connect', resync);
  const clock = setInterval(tickClock, 200);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
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
    socket.off('connect', resync);
    clearInterval(clock);
    timers.forEach(clearTimeout);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
  }

  function exit(notice) {
    cleanup();
    onLeave(notice);
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
    exit(payload?.reason || 'That room was closed.');
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
      root.appendChild(el);
    } else if (el !== root.lastElementChild) {
      root.appendChild(el); // a screen rebuild put it out of order
    }
    return el;
  }

  function drawOverlay(cur) {
    const el = overlayHost();
    const html = overlayHTML(cur);
    el.classList.toggle('is-empty', !html);
    setHTML(el, html);
  }

  function overlayHTML(cur) {
    if (askingLeave) return leaveConfirmHTML(cur);
    const over = cur.gameOver;
    if (over && dismissedGameOver !== gameOverKey(over)) return celebrationHTML(over);
    const me = cur.table.seats.find((s) => s && s.userId === user.id);
    // Back in with chips (the host restarted, or a rebuy): forget that they
    // ever chose to spectate, so busting again asks them afresh.
    if (me && me.chips > 0) spectating = false;
    // Busting is only final once the next hand has started without them:
    // until then they're still watching the showdown they just lost.
    if (!over && me && me.sittingOut && !me.left && me.chips <= 0 && !spectating) {
      return bustedHTML(cur);
    }
    return '';
  }

  const gameOverKey = (o) => `${o.hands}:${o.winner?.userId ?? 'none'}`;

  function celebrationHTML(over) {
    const w = over.winner;
    const iWon = w?.userId === user.id;
    const others = over.standings.filter((p) => p.userId !== w?.userId);
    return `<div class="sheet sheet-win" role="dialog" aria-modal="true" aria-label="Game over">
      <div class="confetti" aria-hidden="true">${confettiHTML()}</div>
      <div class="sheet-kicker">${over.hands} hand${over.hands === 1 ? '' : 's'} played</div>
      <div class="sheet-crown">${icons.crown}</div>
      <h2 class="sheet-title">${iWon ? 'You win!' : `${esc(w?.username || 'Nobody')} wins!`}</h2>
      <p class="sheet-sub">${iWon ? 'Every chip on the table is yours.' : 'They finished with every chip on the table.'}</p>
      <div class="sheet-stack">${chipStackSVG(w?.chips || 0, { maxCols: 6, maxPerCol: 6 })}</div>
      <div class="sheet-amt">${fmt(w?.chips || 0)}</div>
      ${others.length
        ? `<ol class="sheet-rank">${others
            .map((p, i) => `<li><span class="rank-no">${i + 2}</span>
              <span class="rank-name${p.userId === user.id ? ' is-me' : ''}">${esc(p.username)}</span>
              <span class="rank-chips">${fmt(p.chips)}</span></li>`)
            .join('')}</ol>`
        : ''}
      <div class="sheet-actions">
        <button class="btn btn-primary btn-lg" data-ov="close">Back to the waiting room</button>
        <button class="btn btn-ghost" data-ov="leave">Leave room</button>
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

  function bustedHTML(cur) {
    const live = cur.table.seats.filter((s) => s && !s.left && s.chips > 0).length;
    return `<div class="sheet sheet-bust" role="dialog" aria-modal="true" aria-label="Out of chips">
      <div class="sheet-crown is-bust">${icons.allin}</div>
      <h2 class="sheet-title">You're out of chips</h2>
      <p class="sheet-sub">You'll sit out the rest of the game. ${live} player${live === 1 ? ' is' : 's are'} still in — stay and watch how it ends, or head back to the lobby.</p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-lg" data-ov="spectate">${icons.eye}Spectate</button>
        <button class="btn btn-ghost" data-ov="leave">${icons.leave}Leave room</button>
      </div>
      <p class="sheet-note">The host can deal you back in with a fresh stack from the waiting room.</p>
    </div>`;
  }

  // Cheap paper confetti: a fixed set of coloured strips the CSS animates.
  function confettiHTML() {
    if (reduceMotion) return '';
    let out = '';
    for (let i = 0; i < 48; i++) {
      const left = (i * 97) % 100;
      const delay = ((i * 137) % 220) / 100;
      const dur = 2.4 + ((i * 53) % 160) / 100;
      const spin = ((i * 71) % 7) - 3;
      out += `<i class="c${i % 5}" style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;--spin:${spin}turn"></i>`;
    }
    return out;
  }

  function onOverlayClick(e) {
    const btn = e.target.closest('[data-ov]');
    if (!btn) return;
    const kind = btn.dataset.ov;
    if (kind === 'leave') { askingLeave = true; return drawOverlay(shown); }
    if (kind === 'leave-yes') return leaveRoom();
    if (kind === 'leave-no') askingLeave = false;
    if (kind === 'spectate') {
      spectating = true; // for this game only; a rebuy clears it
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
      els = null;
      drawWaiting(shown);
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
  }

  function showError(msg) {
    toast(msg, { info: false });
  }

  // Table news rather than a problem: who joined, who left.
  function showNotice(msg) {
    toast(msg, { info: true });
  }

  function toast(msg, { info }) {
    const host = root.querySelector('#toast-host');
    if (!host) return;
    const el = document.createElement('div');
    el.className = info ? 'toast is-info' : 'toast error-text';
    el.setAttribute('role', info ? 'status' : 'alert');
    el.textContent = msg;
    host.appendChild(el);
    later(() => el.remove(), info ? 3600 : 2800);
  }

  // ---------------------------------------------------------------------------
  // Shared top bar
  // ---------------------------------------------------------------------------
  function topbarHTML(t) {
    return `<header class="topbar">
      <div class="brand">${icons.logo}<span>Boysbathroom <em>Poker</em></span></div>
      <div class="topbar-meta">
        <span class="meta-chip">Room <b class="code selectable">${esc(roomCode)}</b></span>
        <span class="meta-chip hide-sm">Blinds <b>${fmt(t.smallBlind)}/${fmt(t.bigBlind)}</b></span>
        <span class="meta-chip hide-sm" id="hand-chip" ${t.handNumber ? '' : 'hidden'}>Hand <b id="hand-no">#${t.handNumber}</b></span>
      </div>
      <div class="topbar-user">
        ${userPillHTML(user)}
        <button class="btn btn-ghost btn-sm btn-icon${soundMuted() ? ' is-off' : ''}" data-sound aria-pressed="${!soundMuted()}" title="Turn table sounds on or off" aria-label="Sounds">${soundMuted() ? icons.soundOff : icons.soundOn}</button>
        <button class="btn btn-ghost btn-sm${autoReveal() ? '' : ' is-off'}" data-reveal aria-pressed="${autoReveal()}" title="Keep my cards face up, or hold them to peek instead">${icons.eye}<span class="hide-md">Cards ${autoReveal() ? 'up' : 'hidden'}</span></button>
        <button class="btn btn-ghost btn-sm${reduceMotion ? ' is-off' : ''}" data-motion aria-pressed="${!reduceMotion}" title="Turn table animations on or off">${icons.sparkle}<span class="hide-md">Animations ${reduceMotion ? 'off' : 'on'}</span></button>
        <button class="btn btn-ghost btn-sm" data-leave aria-label="Leave room">${icons.leave}<span class="hide-sm">Leave</span></button>
      </div>
    </header>`;
  }

  function wireTopbar() {
    root.querySelector('[data-leave]').addEventListener('click', () => {
      askingLeave = true;
      drawOverlay(shown);
    });
    wireNameEditor(root, user);
    const sound = root.querySelector('[data-sound]');
    sound.addEventListener('click', () => {
      const off = toggleSound();
      sound.classList.toggle('is-off', off);
      sound.setAttribute('aria-pressed', String(!off));
      sound.innerHTML = off ? icons.soundOff : icons.soundOn;
    });
    const hist = root.querySelector('[data-history]');
    hist?.addEventListener('click', () => {
      historyOpen = !historyOpen;
      setSetting('showHistory', historyOpen);
      applyHistoryOpen();
      play('click');
    });
    const reveal = root.querySelector('[data-reveal]');
    reveal.addEventListener('click', () => {
      const on = !autoReveal();
      setSetting('autoReveal', on);
      reveal.classList.toggle('is-off', !on);
      reveal.setAttribute('aria-pressed', String(on));
      const label = reveal.querySelector('span');
      if (label) label.textContent = `Cards ${on ? 'up' : 'hidden'}`;
      if (peeking) endPeek(); // a peek in progress has just become pointless
      play('flip');
      draw(); // turn the cards over straight away rather than next update
    });
    const btn = root.querySelector('[data-motion]');
    btn.addEventListener('click', () => {
      toggleMotion();
      reduceMotion = motionReduced();
      btn.classList.toggle('is-off', reduceMotion);
      btn.setAttribute('aria-pressed', String(!reduceMotion));
      const label = btn.querySelector('span');
      if (label) label.textContent = `Animations ${reduceMotion ? 'off' : 'on'}`;
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
    root.innerHTML = `<div class="screen">
      ${topbarHTML(t)}
      <main class="page">
        <section class="panel waiting-panel">
          <div class="eyebrow">Waiting room</div>
          <h1 class="display">Gather your players</h1>
          <p class="lead">${isHost ? 'Share the code, set everyone’s starting chips, then deal the first hand.' : 'The host sets everyone’s starting chips and deals the first hand.'}</p>
          <div class="code-block">
            <div><div class="micro">Room code</div><div class="room-code selectable">${esc(roomCode)}</div></div>
            <button class="btn btn-ghost btn-sm" data-copy>${icons.copy}<span>Copy</span></button>
          </div>
          <div class="meta-row">
            <span>Blinds <b>${fmt(t.smallBlind)} / ${fmt(t.bigBlind)}</b></span>
            <span><b>${n}</b> of ${t.maxSeats || 9} seats taken</span>
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
                  ${isHost
                    ? numberFieldHTML({ value: p.buyIn, min: 1, step: 100, label: `starting chips for ${esc(p.username)}`, attrs: `data-buyin="${p.userId}"`, wide: false })
                    : `<span class="amt">${fmt(p.buyIn)}</span>`}
                  <span class="micro">chips</span>
                  ${isHost && p.userId !== user.id ? `<button class="btn btn-ghost btn-icon" data-remove="${p.userId}" title="Remove ${esc(p.username)}" aria-label="Remove ${esc(p.username)}">${icons.fold}</button>` : '<span class="btn-icon-spacer"></span>'}
                </span>
              </li>`).join('')}
          </ul>
          ${isHost
            ? `<div class="late-join">
                <label for="join-chips">Chips for anyone who joins once we've started</label>
                ${numberFieldHTML({ id: 'join-chips', value: state.joinChips ?? 1000, min: 1, step: 100, label: 'chips for late joiners', attrs: 'data-join-chips', wide: false })}
                <p class="micro">They'll sit out the hand in play and be dealt in on the next one.</p>
              </div>`
            : ''}
          ${isHost
            ? `<button class="btn btn-primary btn-lg" data-start ${n < 2 ? 'disabled' : ''}>Deal first hand</button>
               <p class="help-text">${n < 2 ? 'Add a bot or wait for a friend — you need at least 2 players.' : 'Play money only — chips have no real value.'}</p>`
            : '<p class="help-text">Waiting for the host to start<span class="dots"></span></p>'}
        </section>
      </main>
      <div class="toast-host" id="toast-host"></div>
    </div>`;

    wireTopbar();
    wireSteppers(root);
    const copyBtn = root.querySelector('[data-copy]');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(roomCode);
        copyBtn.querySelector('span').textContent = 'Copied';
      } catch {
        showError('Copy failed — select the code instead.');
      }
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
    root.querySelectorAll('[data-buyin]').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          await emitAck('setBuyIn', { userId: Number(input.dataset.buyin), buyIn: Number(input.value) });
        } catch (err) {
          showError(err.message);
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
        <div class="history-head">Hand history</div>
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
      </div>
      <footer class="dock" id="dock"></footer>
      <div class="toast-host" id="toast-host"></div>
    </div>`;
    const $ = (id) => root.querySelector(`#${id}`);
    els = {
      stage: $('stage'), camera: $('camera'), board: $('board'), phase: $('phase'), pot: $('pot'),
      muck: $('muck'), seats: $('seats'), pending: $('pending'), fx: $('fx'), dock: $('dock'),
      handChip: $('hand-chip'), handNo: $('hand-no'), foldZone: $('fold-zone'), foldLabel: $('fold-zone-label'),
      history: $('history'), historyList: $('history-list'),
    };
    buildDock();
    wireTopbar();
    applyHistoryOpen();
    drawHistory();
    // Tapping anywhere off the panel closes it. On a phone it covers the
    // felt, so dismissing it has to be as easy as opening it; pointerdown
    // rather than click so it goes before whatever was tapped underneath.
    root.addEventListener('pointerdown', (e) => {
      if (!historyOpen) return;
      if (e.target.closest('#history') || e.target.closest('[data-history]')) return;
      historyOpen = false;
      setSetting('showHistory', false);
      applyHistoryOpen();
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
      doAction(kind === 'raise' ? 'raise' : kind);
    });

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
    const list = table.seats.filter(Boolean);
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
      const apart = Math.hypot(((cards.x - bet.x) / 100) * camW, ((cards.y - bet.y) / 100) * camH);
      if (apart < minBetGap) {
        const push = ((minBetGap - apart) / camW) * 100;
        const slid = { x: bet.x - px * push, y: bet.y - py * push };
        bet = isMe ? slid : clearOfBoard(slid, lm.boardHalf);
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
    const me = shown?.table.seats.find((s) => s && s.userId === user.id);
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
    const keptHand = gesture && !newHand ? els.seats.querySelector('[data-mine]') : null;
    if (gesture && newHand) endPeek();

    els.seats.innerHTML = t.seats.filter(Boolean).map((p) => seatHTML(p, layout.map.get(p.seat), ctx)).join('');

    if (keptHand) {
      const fresh = els.seats.querySelector('[data-mine]');
      if (fresh) fresh.replaceWith(keptHand);
      else keptHand.remove(); // I folded mid-gesture; let the cards go
    }
    drawBoard(t, newHand, ctx.winCards);
    drawPot(t, summary);
    drawMuck(t);
    drawDock(cur);
    drawPending();
    tickClock();
    renderedHand = t.handNumber;
    renderedBoard = t.board.length;
    if (ctx.justShowdown) {
      renderedShowdown = t.handNumber;
      recordHand(t.lastHandSummary);
    }
    // Sound is deliberately not tied to the animation pass: the table is
    // meant to be followable by ear alone, so it still plays with animations
    // turned off (and when the player isn't looking at the screen at all).
    if (pt) playEffects(pt, t);
    if (pt && !reduceMotion) runEffects(pt, t);
  }

  // ---------------------------------------------------------------------------
  // Hand history sidebar
  // ---------------------------------------------------------------------------
  // Called once per hand, the first time its showdown is drawn.
  function recordHand(summary) {
    if (!summary || !summary.winners?.length) return;
    if (history[0]?.hand === summary.handNumber) return; // already logged
    const shown = new Map((summary.showdownHands || []).map((h) => [h.userId, h]));
    history.unshift({
      hand: summary.handNumber,
      uncontested: !!summary.uncontested,
      split: summary.winners.length > 1,
      board: summary.uncontested ? [] : summary.board || [],
      winners: summary.winners.map((w) => ({
        name: w.username,
        amount: w.amount,
        mine: w.userId === user.id,
        // An uncontested pot was never shown down, so there's no hand to name
        // and no cards to show - nobody at the table got to see them either.
        desc: summary.uncontested ? '' : w.hand?.description || w.hand?.name || '',
        kicker: summary.uncontested ? '' : w.kicker || '',
        cards: summary.uncontested ? [] : shown.get(w.userId)?.holeCards || [],
      })),
    });
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    saveHistory();
    prependEntry(history[0]);
  }

  function drawHistory() {
    if (!els?.historyList) return;
    if (!history.length) {
      setHTML(els.historyList, '<li class="history-empty">Finished hands show up here.</li>');
      return;
    }
    setHTML(els.historyList, history.map(entryHTML).join(''));
  }

  // A finished hand is added on its own rather than by rebuilding the list:
  // replacing the markup threw away whatever the player was reading. The new
  // entry goes on top, so anyone scrolled into the older hands is nudged down
  // by its height to keep the same hands under their eyes.
  function prependEntry(h) {
    const list = els?.historyList;
    if (!list) return;
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

  function entryHTML(h) {
    // Only hands that were actually shown down have cards to look at.
    const cards = h.winners.some((w) => w.cards?.length);
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
          <span class="hh-who">${esc(w.name)}</span>
          <span class="hh-amt">+${fmt(w.amount)}</span>
          ${i === 0 && cards ? eye : ''}
        </div>
        ${w.desc ? `<div class="hh-hand">${esc(w.desc)}${w.kicker ? `<span class="hh-kick">${esc(w.kicker)}</span>` : ''}</div>` : ''}
        ${open && w.cards?.length ? `<div class="hh-cards">${w.cards.map((c) => cardHTML(c, { simple: true })).join('')}</div>` : ''}`
      )
      .join('');
    return `<li class="hh">
      <div class="hh-no">Hand #${h.hand}</div>
      ${wins}
      ${note ? `<div class="hh-note">${note}</div>` : ''}
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
    const cls = ['anchor', 'pod', L.isMe && 'is-me', acting && 'is-acting', p.folded && !away && 'is-folded', away && 'is-away', isWinner && 'is-winner', isLoser && 'is-loser', L.side && `side-${L.side}`, p.isBot && levelClass(p.botLevel)]
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
        ${faceUp ? '' : `<span class="peek-hint">${open ? 'Throw to fold' : 'Hold to peek · throw to fold'}</span>`}
      </div>`;
    }
    if (p.holeCards) {
      return `<div class="anchor hand revealed${lost}" style="${pos}">
        ${p.holeCards.map((c, i) => cardHTML(c, { cls: (justShowdown ? 'flip-in' : '') + winCls(c), style: `--d:${i * 120}ms` })).join('')}
      </div>`;
    }
    // Someone else's face-down cards. When they're checking their hand the
    // cards tilt up and settle — you see them looking, never what they hold.
    return `<div class="anchor hand${p.peeking ? ' is-peeked' : ''}" style="${pos}">
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
    const me = t.seats.find((s) => s && s.userId === user.id) || null;
    const betting = BETTING.includes(t.phase);
    const myTurn = !!me && betting && t.actingSeat === me.seat;
    const toCall = me ? Math.max(0, t.currentBet - me.betThisStreet) : 0;
    const total = sum(t.seats.filter(Boolean), (p) => p.committed);
    const maxTotal = me ? me.chips + me.betThisStreet : 0;
    const isRaise = t.currentBet > 0;
    const minTotal = Math.min(isRaise ? t.currentBet + t.minRaise : t.bigBlind, maxTotal);
    const canRaise = myTurn && maxTotal > t.currentBet;
    const actor = betting && t.actingSeat >= 0 ? t.seats[t.actingSeat] : null;
    return { t, me, betting, myTurn, toCall, total, maxTotal, isRaise, minTotal, canRaise, actor };
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

    const turnKey = m.myTurn ? `${t.handNumber}:${t.actionCount}` : '';
    if (turnKey !== myTurnKey) {
      if (turnKey) play('turn'); // it just became my turn
      myTurnKey = turnKey;
      pendingTotal = null;
      if (foldArmed) setFoldArmed(false);
    }
    els.dock.classList.toggle('not-turn', !m.myTurn);

    let main;
    let sub = '';
    if (!me) {
      main = 'Spectating';
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
    els.dock.querySelector('[data-act="fold"]').disabled = off;
    const call = q('call-btn');
    call.disabled = off;
    call.dataset.act = m.toCall > 0 ? 'call' : 'check';
    setHTML(q('call-ic'), m.toCall > 0 ? icons.call : icons.check);
    q('call-label').textContent = m.toCall > 0 ? 'Call' : 'Check';
    q('call-amt').textContent = m.toCall > 0 ? fmt(Math.min(m.toCall, me.chips)) : '';
    q('allin-btn').disabled = off;
    q('allin-amt').textContent = me ? fmt(me.chips) : '';
    els.dock.querySelectorAll('.quick-btn, .step-btn, #amt-range, #amt-input').forEach((el) => (el.disabled = !m.canRaise));
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
  function drawPending() {
    const m = model;
    const L = myLayout();
    const el = els.pending;
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
  // button arms on the first click and only folds on the second.
  function setFoldArmed(on) {
    foldArmed = on;
    const btn = els?.dock.querySelector('[data-act="fold"]');
    if (!btn) return;
    btn.classList.toggle('is-armed', on);
    const label = btn.querySelector('.act-label');
    if (label) label.innerHTML = on ? `${icons.fold}Sure?<span class="kbd">F</span>` : `${icons.fold}Fold<span class="kbd">F</span>`;
    const amt = btn.querySelector('.act-amt');
    if (amt) amt.textContent = on ? 'Tap again' : '';
    clearTimeout(foldArmTimer);
    if (on) foldArmTimer = setTimeout(() => setFoldArmed(false), 4000);
  }

  function requestFold() {
    if (!model?.myTurn) return;
    if (!foldArmed) {
      setFoldArmed(true);
      play('click');
      return;
    }
    setFoldArmed(false);
    doAction('fold');
  }

  function onDockClick(e) {
    const act = e.target.closest('[data-act]');
    if (act && !act.disabled) {
      if (act.dataset.act === 'fold') return requestFold();
      setFoldArmed(false); // any other action cancels a pending fold
      return doAction(act.dataset.act);
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

  function onKey(e) {
    if (mode !== 'table' || e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const press = (kind) => {
      const b = els.dock.querySelector(`[data-act="${kind}"]`);
      if (b && !b.disabled) doAction(kind);
    };
    if (k === 'p') peekBriefly();
    else if (k === 'f') requestFold();
    else if (k === 'escape') setFoldArmed(false);
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

  function startPeek(hand = currentHand()) {
    const L = myLayout();
    if (!hand || !L || peeking) return false;
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

    const move = (ev) => {
      const d = delta(ev);
      if (!moved && Math.hypot(d.dx, d.dy) < 10) return;
      if (!moved) {
        if (rightButton) return; // right-hold is peek-only
        moved = true;
        dragging = true;
        endPeek(hand); // put the cards down before sliding them
        hand.classList.add('dragging');
        els.foldZone.classList.add('is-visible');
        els.foldLabel.textContent = model?.myTurn ? 'Release to fold' : 'Wait for your turn to fold';
      }
      hand.style.transform = `translate(calc(-50% + ${d.dx}px), calc(-50% + ${d.dy}px)) rotate(${d.dx * 0.08}deg)`;
      els.foldZone.classList.toggle('is-hot', isThrow(d) && !!model?.myTurn);
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
      if (!cancelled && isThrow(d) && model?.myTurn) {
        // Throwing asks before mucking, same as the Fold button does.
        confirmThrow(hand, L, d);
        return;
      }
      if (!cancelled && isThrow(d)) showError('You can only fold on your turn.');
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
    hand.style.transform = `translate(calc(-50% + ${d.dx * 0.55}px), calc(-50% + ${d.dy * 0.55}px)) rotate(${d.dx * 0.05}deg)`;
    hand.classList.add('awaiting-fold');
    els.foldZone.classList.add('is-visible', 'is-hot', 'is-confirm');
    els.foldZone.innerHTML = `<div class="fold-confirm">
      <span>Fold this hand?</span>
      <button class="pending-btn is-allin" data-fold-yes>${icons.fold}Fold</button>
      <button class="pending-btn is-clear" data-fold-no aria-label="Keep my cards">${icons.leave}</button>
    </div>`;
    play('click');

    const done = (fold) => {
      els.foldZone.classList.remove('is-visible', 'is-hot', 'is-confirm');
      els.foldZone.innerHTML = `<span id="fold-zone-label">Release to fold</span>`;
      els.foldLabel = root.querySelector('#fold-zone-label');
      hand.classList.remove('awaiting-fold');
      if (fold) {
        throwHand(hand, L, d);
      } else {
        hand.style.transform = '';
        later(endDrag, 260);
      }
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
