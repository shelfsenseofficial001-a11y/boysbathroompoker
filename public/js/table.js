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

const BETTING = ['preflop', 'flop', 'turn', 'river'];
const PHASE_LABEL = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
// Table landmarks, in % of the camera box. Portrait (phones) stacks the
// board lower so it clears the upper seats' bets.
const CENTER = { x: 50, y: 50 };
const LANDMARKS = {
  landscape: { board: { x: 50, y: 44 }, pot: { x: 50, y: 60 }, muck: { x: 64, y: 60 }, betK: 0.56, myBetK: 0.56, cardsK: 0.3 },
  portrait: { board: { x: 50, y: 50 }, pot: { x: 50, y: 63 }, muck: { x: 73, y: 63 }, betK: 0.45, myBetK: 0.5, cardsK: 0.33 },
};
let BOARD = LANDMARKS.landscape.board;
let POT = LANDMARKS.landscape.pot;
let MUCK = LANDMARKS.landscape.muck;
let DECK = BOARD;

let reduceMotion = motionReduced();
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

function winningCards(summary) {
  const set = new Set();
  if (!summary || summary.uncontested) return set;
  for (const w of summary.winners) for (const c of w.hand?.cards || []) set.add(c);
  return set;
}

export function renderTable(root, { user, roomCode, onLeave }) {
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
  const timers = new Set();

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  socket.on('roomState', onRoomState);
  socket.on('connect', resync);
  const clock = setInterval(tickClock, 200);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
  resync();

  function resync() {
    emitAck('resync')
      .then((res) => {
        if (!res.code) exit();
      })
      .catch(() => {});
  }

  function cleanup() {
    socket.off('roomState', onRoomState);
    socket.off('connect', resync);
    clearInterval(clock);
    timers.forEach(clearTimeout);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
  }

  function exit() {
    cleanup();
    onLeave();
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
    if (peeking || dragging || holding) return; // applied once the gesture ends
    draw();
  }

  function draw() {
    const prev = shown;
    shown = latest;
    if (shown.table.phase === 'waiting') {
      mode = 'waiting';
      els = null;
      drawWaiting(shown);
      return;
    }
    if (mode !== 'table') {
      buildTable();
      mode = 'table';
      drawTable(null, shown);
      return;
    }
    drawTable(prev && prev.table.phase !== 'waiting' ? prev : null, shown);
  }

  function showError(msg) {
    const host = root.querySelector('#toast-host');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast error-text';
    el.setAttribute('role', 'alert');
    el.textContent = msg;
    host.appendChild(el);
    later(() => el.remove(), 2800);
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
        <span class="user-pill">${avatarSVG(user.username)}<span class="user-name">${esc(user.username)}</span></span>
        <button class="btn btn-ghost btn-sm btn-icon${soundMuted() ? ' is-off' : ''}" data-sound aria-pressed="${!soundMuted()}" title="Turn table sounds on or off" aria-label="Sounds">${soundMuted() ? icons.soundOff : icons.soundOn}</button>
        <button class="btn btn-ghost btn-sm${reduceMotion ? ' is-off' : ''}" data-motion aria-pressed="${!reduceMotion}" title="Turn table animations on or off">${icons.sparkle}<span class="hide-md">Animations ${reduceMotion ? 'off' : 'on'}</span></button>
        <button class="btn btn-ghost btn-sm" data-leave aria-label="Leave room">${icons.leave}<span class="hide-sm">Leave</span></button>
      </div>
    </header>`;
  }

  function wireTopbar() {
    root.querySelector('[data-leave]').addEventListener('click', leaveRoom);
    const sound = root.querySelector('[data-sound]');
    sound.addEventListener('click', () => {
      const off = toggleSound();
      sound.classList.toggle('is-off', off);
      sound.setAttribute('aria-pressed', String(!off));
      sound.innerHTML = off ? icons.soundOff : icons.soundOn;
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
          <div class="meta-row"><span>Blinds <b>${fmt(t.smallBlind)} / ${fmt(t.bigBlind)}</b></span><span><b>${n}</b> of ${t.maxSeats || 9} seats taken</span></div>
          <ul class="player-list">
            ${state.lobby.map((p) => `
              <li class="player-row${p.isBot ? ' is-bot' : ''}">
                <span class="avatar-sm">${p.isBot ? icons.robot : avatarSVG(p.username)}</span>
                <span class="pname">${esc(p.username)}${p.isBot ? '<span class="badge bot">Bot</span>' : ''}${p.userId === state.hostUserId ? '<span class="badge">Host</span>' : ''}${p.userId === user.id ? '<span class="badge you">You</span>' : ''}</span>
                <span class="buyin">
                  ${isHost
                    ? `<input class="input num" type="number" min="1" step="1" inputmode="numeric" value="${p.buyIn}" data-buyin="${p.userId}" aria-label="Starting chips for ${esc(p.username)}">`
                    : `<span class="amt">${fmt(p.buyIn)}</span>`}
                  <span class="micro">chips</span>
                  ${isHost && p.userId !== user.id ? `<button class="btn btn-ghost btn-icon" data-remove="${p.userId}" title="Remove ${esc(p.username)}" aria-label="Remove ${esc(p.username)}">${icons.fold}</button>` : '<span class="btn-icon-spacer"></span>'}
                </span>
              </li>`).join('')}
          </ul>
          ${isHost
            ? `<div class="waiting-actions">
                 <button class="btn btn-ghost" data-add-bot ${n >= (t.maxSeats || 9) ? 'disabled' : ''}>${icons.robot}Add bot</button>
                 <button class="btn btn-primary" data-start ${n < 2 ? 'disabled' : ''}>Deal first hand</button>
               </div>
               <p class="help-text">${n < 2 ? 'Add a bot or wait for a friend — you need at least 2 players.' : 'Play money only — chips have no real value.'}</p>`
            : '<p class="help-text">Waiting for the host to start<span class="dots"></span></p>'}
        </section>
      </main>
      <div class="toast-host" id="toast-host"></div>
    </div>`;

    wireTopbar();
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
    root.querySelector('[data-add-bot]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const mine = state.lobby.find((p) => p.userId === user.id);
      try {
        await emitAck('addBot', { buyIn: mine?.buyIn });
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
      <footer class="dock" id="dock"></footer>
      <div class="toast-host" id="toast-host"></div>
    </div>`;
    const $ = (id) => root.querySelector(`#${id}`);
    els = {
      stage: $('stage'), camera: $('camera'), board: $('board'), phase: $('phase'), pot: $('pot'),
      muck: $('muck'), seats: $('seats'), pending: $('pending'), fx: $('fx'), dock: $('dock'),
      handChip: $('hand-chip'), handNo: $('hand-no'), foldZone: $('fold-zone'), foldLabel: $('fold-zone-label'),
    };
    buildDock();
    wireTopbar();

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
    const rx = portrait ? 36 : 44;
    const ry = 43;
    const map = new Map();
    ordered.forEach((p, i) => {
      // Seat 0 (me) at the bottom; others follow clockwise in action order.
      const a = ((90 + (i * 360) / n) * Math.PI) / 180;
      const pod = { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
      const toward = (k) => ({ x: pod.x + (CENTER.x - pod.x) * k, y: pod.y + (CENTER.y - pod.y) * k });
      const isMe = p.userId === user.id;
      const cards = toward(lm.cardsK);
      const bet = toward(isMe ? lm.myBetK : lm.betK);
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
      const dealer = { x: cards.x + px * off, y: cards.y + py * off };
      const stack = { x: pod.x + (portrait ? 9 : 5), y: pod.y };
      map.set(p.seat, { pod, cards, bet, dealer, stack, isMe, index: i });
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
    const newHand = !pt || pt.handNumber !== t.handNumber;
    const summary = t.phase === 'showdown' ? t.lastHandSummary : null;
    const ctx = {
      t,
      newHand,
      summary,
      winners: new Set((summary?.winners || []).map((w) => w.userId)),
      winCards: winningCards(summary),
      justShowdown: t.phase === 'showdown' && (!pt || pt.phase !== 'showdown'),
    };

    els.handChip.hidden = !t.handNumber;
    els.handNo.textContent = `#${t.handNumber}`;
    els.seats.innerHTML = t.seats.filter(Boolean).map((p) => seatHTML(p, layout.map.get(p.seat), ctx)).join('');
    drawBoard(pt, t, newHand, ctx.winCards);
    drawPot(t, summary);
    drawMuck(t);
    drawDock(cur);
    drawPending();
    tickClock();
    if (pt && !reduceMotion) runEffects(pt, t);
  }

  function seatTag(p, { acting, isMe, isWinner, t, summary }) {
    if (isWinner) {
      const w = summary?.winners.find((x) => x.userId === p.userId);
      return { text: w?.hand ? `Winner · ${w.hand.description || w.hand.name}` : 'Winner', cls: 't-win' };
    }
    if (p.left) return { text: 'Left', cls: 't-away' };
    if (p.sittingOut) return { text: 'Out', cls: 't-away' };
    if (acting && isMe) return { text: 'Your turn', cls: 't-turn' };
    if (p.folded) return { text: 'Folded', cls: 't-fold' };
    // At a real showdown the hand they made matters more than how they got there.
    if (summary && !summary.uncontested) {
      const sh = summary.showdownHands.find((h) => h.userId === p.userId);
      if (sh) return { text: sh.evaluation.description || sh.evaluation.name, cls: 't-hand' };
    }
    if (p.allIn) return { text: 'All-in', cls: 't-allin' };
    return describeAction(p.lastAction);
  }

  function seatHTML(p, L, ctx) {
    const { t } = ctx;
    const acting = t.actingSeat === p.seat && BETTING.includes(t.phase);
    const isWinner = ctx.winners.has(p.userId);
    const away = p.left || p.sittingOut;
    const cls = ['anchor', 'pod', L.isMe && 'is-me', acting && 'is-acting', p.folded && !away && 'is-folded', away && 'is-away', isWinner && 'is-winner']
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
      <div class="who"><span class="name">${esc(p.username)}</span><span class="amt">${fmt(p.chips)}</span></div>
      ${stack}
      ${tag ? `<span class="tag ${tag.cls}">${esc(tag.text)}</span>` : ''}
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
  function cardHTML(code, { cls = '', style = '', face = true, flip = false } = {}) {
    if (flip) {
      return `<div class="card ${cls}" style="${style}"><div class="flip">
        <div class="back">${cardBackSVG()}</div>
        <div class="face">${cardFaceSVG(code)}</div>
      </div></div>`;
    }
    const faceLayer = face ? `<div class="face">${cardFaceSVG(code)}</div>` : '';
    return `<div class="card ${cls}" style="${style}">${faceLayer}<div class="back">${cardBackSVG()}</div></div>`;
  }

  function handHTML(p, L, ctx) {
    const { t, newHand, summary, winCards, justShowdown } = ctx;
    if (!p.hasCards || p.folded) return '';
    const pos = `left:${L.cards.x}%;top:${L.cards.y}%`;
    const deal = newHand && !reduceMotion;
    const winCls = (c) => (winCards.size ? (winCards.has(c) ? ' is-win' : '') : '');

    if (L.isMe && p.holeCards) {
      const faceUp = t.phase === 'showdown' && summary && !summary.uncontested;
      return `<div class="anchor hand mine${faceUp ? ' shown' : ''}" style="${pos}" data-mine ${faceUp ? '' : 'role="button" tabindex="0" aria-label="Hold to peek at your cards"'}>
        ${p.holeCards.map((c, i) => cardHTML(c, { cls: (deal ? 'deal' : '') + winCls(c), style: `${deal ? dealStyle(L, i) : ''};--fd:${i * 70}ms`, flip: !faceUp })).join('')}
        ${faceUp ? '' : '<span class="peek-hint">Hold to peek · throw to fold</span>'}
      </div>`;
    }
    if (p.holeCards) {
      return `<div class="anchor hand revealed" style="${pos}">
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

  function drawBoard(pt, t, newHand, winCards) {
    const prevLen = !pt || newHand ? 0 : pt.board.length;
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
      const names = [...new Set(summary.winners.map((w) => w.hand?.description || w.hand?.name).filter(Boolean))].join(' / ');
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
            <input class="input num" type="number" id="amt-input" step="1" inputmode="numeric" aria-label="Bet amount">
          </div>
        </div>
      </div>
      <div class="dock-actions">
        <button class="act act-fold" data-act="fold"><span class="act-label">${icons.fold}Fold<span class="kbd">F</span></span><span class="act-amt"></span></button>
        <button class="act act-call" data-act="check" id="call-btn"><span class="act-label"><span class="ic" id="call-ic">${icons.check}</span><span id="call-label">Check</span><span class="kbd">C</span></span><span class="act-amt" id="call-amt"></span></button>
        <button class="act act-raise" data-act="raise" id="raise-btn"><span class="act-label">${icons.raise}<span id="raise-label">Raise</span><span class="kbd">R</span></span><span class="act-amt" id="raise-amt"></span></button>
        <button class="act act-allin" data-act="allin" id="allin-btn"><span class="act-label">${icons.allin}All-in</span><span class="act-amt" id="allin-amt"></span></button>
      </div>
      <div class="dock-help">Click your cards to peek · Throw them onto the felt to fold · Double-click the felt to check · Drag chips onto the table to bet</div>`;
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
        ? `<span class="to-call">To call <b>${fmt(Math.min(m.toCall, me.chips))}</b></span>`
        : '<span class="to-call is-free">No bet to you</span>'} <span class="sep">·</span> Pot <b>${fmt(m.total)}</b>`;
    } else {
      const who = m.actor ? `Waiting for <b>${esc(m.actor.username)}</b>` : 'Dealing<span class="dots"></span>';
      main = me.folded ? 'You folded' : me.allIn ? 'You’re all-in' : who;
      sub = `${m.actor ? `<span class="clock-inline">${icons.clock}<b id="turn-secs">–</b>s</span> <span class="sep">·</span> ` : ''}${
        m.toCall > 0 && !me.folded && !me.allIn ? `<span class="to-call">To call <b>${fmt(Math.min(m.toCall, me.chips))}</b></span> <span class="sep">·</span> ` : ''
      }Bet <b>${fmt(t.currentBet)}</b> <span class="sep">·</span> Pot <b>${fmt(m.total)}</b>`;
    }
    setHTML(q('st-main'), main);
    setHTML(q('st-sub'), sub);

    const canPeek = !!me && me.hasCards && !me.folded && t.phase !== 'showdown';
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
    els.dock.querySelectorAll('.chip-btn, .quick-btn, #amt-range, #amt-input').forEach((el) => (el.disabled = !m.canRaise));
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
      label.textContent = allIn ? 'All-in' : m.isRaise ? 'Raise to' : 'Bet';
      amtEl.textContent = below ? `min ${fmt(m.minTotal)}` : fmt(Math.min(amt, m.maxTotal));
    }
    els.dock.querySelectorAll('[data-quick]').forEach((b) => b.classList.toggle('is-selected', pendingTotal !== null && quickValue(b.dataset.quick) === amt));
    drawPending();
  }

  // Chips you've tossed out but not committed yet, shown on the felt with the
  // button that commits them: "Confirm call" when they exactly cover the call,
  // otherwise "Raise to"/"Bet".
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
    else if (exactCall) [kind, label] = ['call', 'Confirm call'];
    else if (short) [kind, label] = [null, `Add ${fmt(m.minTotal - capped)} more`];
    else [kind, label] = ['raise', m.isRaise ? 'Raise to' : 'Bet'];

    // Beside my own cards (I'm always the bottom seat), clear of the pot.
    el.classList.remove('is-empty');
    el.style.left = `${L.cards.x + (layout.portrait ? 19 : 12)}%`;
    el.style.top = `${L.cards.y - 1}%`;
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

  function onDockClick(e) {
    const act = e.target.closest('[data-act]');
    if (act && !act.disabled) return doAction(act.dataset.act);
    const q = e.target.closest('[data-quick]');
    if (q && !q.disabled) {
      pendingTotal = quickValue(q.dataset.quick);
      syncAmount();
      return;
    }
    if (e.target.closest('[data-peek]')) peekBriefly();
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
    else if (k === 'f') press('fold');
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
    peeking = true;
    if (!reduceMotion) {
      const cam = els.camera;
      const W = cam.offsetWidth;
      const H = cam.offsetHeight;
      const ox = (L.cards.x / 100) * W;
      const oy = (L.cards.y / 100) * H;
      const scale = layout.portrait ? 1.55 : 1.45;
      cam.style.transformOrigin = `${ox}px ${oy}px`;
      cam.style.transform = `translate(${W / 2 - ox}px, ${H * 0.54 - oy}px) scale(${scale})`;
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
    // Let the cards flip back before redrawing, so they don't snap face-down.
    later(() => {
      if (!peeking && !holding && latest !== shown) draw();
    }, reduceMotion ? 0 : 320);
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
        throwHand(hand, L, d);
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
    if (latest !== shown) draw();
    else drawTable(shown, shown);
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

  function runEffects(pt, t) {
    const prevSeats = new Map(pt.seats.filter(Boolean).map((p) => [p.userId, p]));
    const cur = t.seats.filter(Boolean);

    if (pt.handNumber !== t.handNumber) {
      // New hand: blinds slide from stacks into the betting line.
      for (const p of cur) {
        const L = layout.map.get(p.seat);
        if (p.betThisStreet > 0) flyChips(L.stack, L.bet, p.betThisStreet, 200);
      }
      cur.forEach((_, i) => play('deal', 0.09 * i)); // cards going round the table
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
      if (actor && !L?.isMe) playForAction(actor.lastAction);
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

    // Community cards hitting the felt.
    if (streetChanged && t.board.length > pt.board.length) {
      for (let i = 0; i < t.board.length - pt.board.length; i++) play('deal', 0.12 * i);
    }

    if (streetChanged && t.phase === 'showdown' && t.lastHandSummary) {
      const summary = t.lastHandSummary;
      if (!summary.uncontested) {
        const others = cur.filter((p) => !p.folded && p.userId !== user.id).length;
        for (let i = 0; i < others; i++) play('flip', 0.12 * i);
      }
      const iWon = summary.winners.some((w) => w.userId === user.id);
      play(iWon ? 'win' : 'lose', 0.55);
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
    else if (action.startsWith('raise') || action.startsWith('bet')) play('bet');
    else if (action.startsWith('call') || action.includes('blind')) play('chip');
  }
}
