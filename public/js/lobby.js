// Lobby: host a new room (blinds + your starting chips; the host sets every
// player's chips in the waiting room) or join one by code.
import { emitAck, getSocket } from './socket.js';
import { avatarSVG } from './svg/avatars.js';
import { icons } from './svg/icons.js';
import { userPillHTML, wireNameEditor } from './name.js';
import { getSettings, setSetting, resetSettings, ZOOM } from './settings.js';
import { numberFieldHTML, wireSteppers } from './stepper.js';
import { showToast } from './toast.js';
import { playEntrance } from './motion.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function renderLobby(root, { user, guest, onLogout, onEnterRoom, notice }) {
  const s = getSettings();
  root.innerHTML = `<div class="screen">
    <header class="topbar">
      <div class="brand">${icons.logo}<span>CC<em>Poker</em></span></div>
      <div class="topbar-user">
        ${userPillHTML(user)}
        <button class="btn btn-ghost btn-sm" id="logout">${guest ? 'New guest' : 'Log out'}</button>
      </div>
    </header>
    <main class="page">
      <section class="hero" data-enter>
        <div class="eyebrow">Play-money Texas Hold’em</div>
        <h1 class="display">Pull up a chair.</h1>
        <p class="lead">Host a private table or join friends with a room code. Chips are fake — strictly for bragging rights.</p>
      </section>
      <div class="lobby-grid">
        <section class="panel" data-enter>
          <h2 class="h2">Host a game</h2>
          <p class="help-text">You’ll set every player’s starting chips in the waiting room.</p>
          <div class="field-row">
            <div class="field"><label for="sb">Small blind</label>${numberFieldHTML({ id: 'sb', value: 5, min: 1, step: 1, label: 'small blind' })}</div>
            <div class="field"><label for="bb">Big blind</label>${numberFieldHTML({ id: 'bb', value: 10, min: 2, step: 2, label: 'big blind' })}</div>
          </div>
          <div class="field-row">
            <div class="field"><label for="buyin-host">Your starting chips</label>${numberFieldHTML({ id: 'buyin-host', value: 1000, min: 1, step: 100, label: 'your starting chips' })}</div>
          </div>
          <label class="switch-row">
            <input type="checkbox" id="room-private">
            <span>Private room — hidden from open tables, and you let each player in</span>
          </label>
          <button class="btn btn-primary btn-lg" id="create-room">Create room</button>
        </section>
        <section class="panel" data-enter>
          <h2 class="h2">Join a game</h2>
          <p class="help-text">Enter the 5-letter code your host shared. They set everyone's chips.</p>
          <div class="field-row">
            <div class="field"><label for="join-code">Room code</label><input id="join-code" type="text" maxlength="5" autocomplete="off" placeholder="ABCDE" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700"></div>
          </div>
          <button class="btn btn-lg" id="join-room">Join room</button>
          <div class="knock-wait" id="knock-wait" hidden>
            <span>Waiting for the host to let you in<span class="dots"></span></span>
            <button class="btn btn-ghost btn-sm" id="knock-cancel">Cancel</button>
          </div>
        </section>
      </div>
      <section class="panel" id="room-list" style="margin-top:20px" data-enter>
        <h2 class="h2">Open tables</h2>
        <p class="help-text">Every public game running right now — the stakes, the stack you'd sit down with, and how far along they are.</p>
        <div class="rooms-wrap">
          <table class="rooms">
            <thead>
              <tr>
                <th scope="col">Room</th>
                <th scope="col" class="num">Players</th>
                <th scope="col" class="num">Blinds</th>
                <th scope="col" class="num">Sit-in chips</th>
                <th scope="col">Hand</th>
                <th scope="col" class="num">Watching</th>
                <th scope="col" aria-label="Join or watch"></th>
              </tr>
            </thead>
            <tbody id="room-rows">
              <tr class="rooms-empty"><td colspan="7">Looking for tables…</td></tr>
            </tbody>
          </table>
        </div>
        <div class="rooms-pager" id="rooms-pager" hidden>
          <button class="btn btn-sm btn-ghost" id="rooms-prev">Previous</button>
          <span class="micro" id="rooms-page"></span>
          <button class="btn btn-sm btn-ghost" id="rooms-next">Next</button>
        </div>
      </section>
      <section class="panel" style="margin-top:20px" data-enter>
        <h2 class="h2">Table settings</h2>
        <p class="help-text">How your own cards behave at the table.</p>
        <label class="switch-row">
          <input type="checkbox" id="auto-reveal" ${s.autoReveal ? 'checked' : ''}>
          <span>Turn my cards face up as soon as they're dealt</span>
        </label>
        <p class="help-text" id="auto-reveal-note" ${s.autoReveal ? '' : 'hidden'}>
          Your cards stay open all hand, so there's nothing to peek at and the
          zoom below is switched off. You can still throw them to fold, and the
          table never sees you looking.
        </p>
        <label class="switch-row">
          <input type="checkbox" id="peek-zoom" ${s.peekZoom ? 'checked' : ''} ${s.autoReveal ? 'disabled' : ''}>
          <span>Zoom in on my cards when peeking</span>
        </label>
        <div class="slider-row" id="zoom-rows" ${s.peekZoom && !s.autoReveal ? '' : 'hidden'}>
          <div class="field">
            <label for="zoom-level">Zoom strength <b id="zoom-level-val">${s.zoomLevel.toFixed(2)}×</b></label>
            <input class="range" type="range" id="zoom-level" min="${ZOOM.level.min}" max="${ZOOM.level.max}" step="${ZOOM.level.step}" value="${s.zoomLevel}">
          </div>
          <div class="field">
            <label for="zoom-speed">Zoom speed <b id="zoom-speed-val">${s.zoomSpeed} ms</b></label>
            <input class="range" type="range" id="zoom-speed" min="${ZOOM.speed.min}" max="${ZOOM.speed.max}" step="${ZOOM.speed.step}" value="${s.zoomSpeed}">
          </div>
          <button class="btn btn-ghost btn-sm" id="zoom-reset">Reset</button>
        </div>
        <div class="zoom-preview" id="zoom-preview" ${s.peekZoom && !s.autoReveal ? '' : 'hidden'}>
          <div class="pv-felt">
            <div class="pv-stage" id="pv-stage">
              <div class="pv-board"><span></span><span></span><span></span></div>
              <div class="pv-hand"><span></span><span></span></div>
            </div>
          </div>
          <div class="pv-timing">
            <span class="pv-bar"><i id="pv-bar-fill"></i></span>
            <span class="micro" id="pv-caption"></span>
          </div>
        </div>
      </section>
      <p class="error-text" id="lobby-error" role="alert"></p>
    </main>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const errEl = $('#lobby-error');
  // Why we're back here, when the room ended rather than the player leaving.
  if (notice) errEl.textContent = notice;
  // Being turned away from a room happens over by the Join button, which is
  // nowhere near the line of red text at the foot of the page — so it's said
  // in a toast, where it can't be missed.
  const fail = (err) => showToast(err.message, { atPage: true });

  $('#logout').addEventListener('click', onLogout);
  wireNameEditor(root, user);
  playEntrance(root.querySelector('.screen'));
  wireSteppers(root);

  // --- Table settings ---
  const paint = (range) => {
    const pct = ((range.value - range.min) / (range.max - range.min)) * 100;
    range.style.setProperty('--pct', `${pct}%`);
  };
  const level = $('#zoom-level');
  const speed = $('#zoom-speed');
  [level, speed].forEach(paint);

  // Live preview: replays the zoom at the chosen strength and speed, so you
  // can see what the settings feel like without starting a hand.
  const HOLD = 650;
  const REST = 450;
  function playPreview() {
    const { peekZoom, zoomLevel, zoomSpeed, autoReveal } = getSettings();
    const stage = $('#pv-stage');
    const bar = $('#pv-bar-fill');
    [stage, bar].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    // Face-up cards are never peeked at, so there's no zoom to preview.
    const zooms = peekZoom && !autoReveal;
    $('#zoom-preview').hidden = !zooms;
    $('#pv-caption').textContent = `Zooms to ${zoomLevel.toFixed(2)}× in ${zoomSpeed} ms`;
    if (!zooms) return;

    const total = zoomSpeed * 2 + HOLD + REST;
    const inAt = zoomSpeed / total;
    const outStart = (zoomSpeed + HOLD) / total;
    const outAt = (zoomSpeed * 2 + HOLD) / total;
    const timing = { duration: total, iterations: Infinity, easing: 'cubic-bezier(.2,.8,.2,1)' };
    stage.animate(
      [
        { transform: 'scale(1)', offset: 0 },
        { transform: `scale(${zoomLevel})`, offset: inAt },
        { transform: `scale(${zoomLevel})`, offset: outStart },
        { transform: 'scale(1)', offset: outAt },
        { transform: 'scale(1)', offset: 1 },
      ],
      timing
    );
    // The bar fills over exactly the zoom-in time, so speed is visible too.
    bar.animate(
      [
        { transform: 'scaleX(0)', offset: 0 },
        { transform: 'scaleX(1)', offset: inAt },
        { transform: 'scaleX(1)', offset: outStart },
        { transform: 'scaleX(0)', offset: outAt },
        { transform: 'scaleX(0)', offset: 1 },
      ],
      { ...timing, easing: 'linear' }
    );
  }

  // Turning the cards face up takes the whole peek-zoom section out of play.
  const syncZoomSection = () => {
    const { peekZoom, autoReveal } = getSettings();
    $('#auto-reveal-note').hidden = !autoReveal;
    $('#peek-zoom').disabled = autoReveal;
    $('#zoom-rows').hidden = !peekZoom || autoReveal;
    playPreview();
  };

  $('#auto-reveal').addEventListener('change', (e) => {
    setSetting('autoReveal', e.target.checked);
    syncZoomSection();
  });
  $('#peek-zoom').addEventListener('change', (e) => {
    setSetting('peekZoom', e.target.checked);
    syncZoomSection();
  });
  level.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('#zoom-level-val').textContent = `${v.toFixed(2)}×`;
    paint(e.target);
    setSetting('zoomLevel', v);
    playPreview();
  });
  speed.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('#zoom-speed-val').textContent = `${v} ms`;
    paint(e.target);
    setSetting('zoomSpeed', v);
    playPreview();
  });
  $('#zoom-reset').addEventListener('click', () => {
    const d = resetSettings();
    $('#auto-reveal').checked = d.autoReveal;
    $('#peek-zoom').checked = d.peekZoom;
    level.value = d.zoomLevel;
    speed.value = d.zoomSpeed;
    $('#zoom-level-val').textContent = `${d.zoomLevel.toFixed(2)}×`;
    $('#zoom-speed-val').textContent = `${d.zoomSpeed} ms`;
    [level, speed].forEach(paint);
    syncZoomSection();
  });

  playPreview();

  $('#create-room').addEventListener('click', async (e) => {
    errEl.textContent = '';
    e.currentTarget.disabled = true;
    try {
      const res = await emitAck('createRoom', {
        smallBlind: Number($('#sb').value),
        bigBlind: Number($('#bb').value),
        buyIn: Number($('#buyin-host').value),
        isPrivate: $('#room-private').checked,
      });
      onEnterRoom(res.code);
    } catch (err) {
      fail(err);
      e.currentTarget.disabled = false;
    }
  });

  // Walking into a game already running: the host's stake applies, so say so
  // rather than letting the chips field silently mean nothing.
  const enter = (res) =>
    onEnterRoom(
      res.code,
      res.waiting ? `Joining with ${Number(res.chips).toLocaleString('en-US')} chips — you'll be dealt in next hand.` : null
    );

  const waitEl = $('#knock-wait');
  const setKnocking = (on) => {
    waitEl.hidden = !on;
    $('#join-room').disabled = on;
  };

  async function join(code, fromList = false) {
    errEl.textContent = '';
    if (!code) return fail(new Error('Enter a room code.'));
    try {
      // No buy-in is sent: the host sets every player's stack, in the waiting
      // room or - for someone arriving mid-game - from their late-join figure.
      // Saying where the code came from lets the server turn away a click on
      // a list entry that went private after the list was drawn.
      const res = await emitAck('joinRoom', { code, fromList });
      // A private room's code only gets you to the door; the host answers it.
      if (res.knocking) return setKnocking(true);
      enter(res);
    } catch (err) {
      fail(err);
    }
  }

  async function watch(code) {
    errEl.textContent = '';
    try {
      const res = await emitAck('spectateRoom', { code });
      onEnterRoom(res.code, 'Watching this game.');
    } catch (err) {
      fail(err);
    }
  }

  // The host has answered: either we're in, or we're not.
  function onKnockAnswered(res) {
    setKnocking(false);
    if (res?.ok) enter(res);
    else fail(new Error(res?.error || 'The host didn’t let you in.'));
  }

  $('#knock-cancel').addEventListener('click', () => {
    setKnocking(false);
    emitAck('cancelKnock').catch(() => {});
  });

  $('#join-room').addEventListener('click', () => join($('#join-code').value.trim().toUpperCase()));
  $('#join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join(e.target.value.trim().toUpperCase());
  });

  // The open-tables list refreshes itself, so somebody waiting for a friend
  // to host doesn't have to keep reloading the page to see it appear.
  let lastRoomsJSON = null;
  // Ten to a page: enough to scan without the lobby turning into a list that
  // has to be scrolled past to reach the settings below it.
  const PER_PAGE = 10;
  let roomsPage = 0;
  function refreshRooms() {
    emitAck('listRooms')
      .then(({ rooms }) => {
        const list = $('#room-rows');
        if (!list) return;
        // Tables close while you're looking at them, so the page you were on
        // may no longer exist; fall back to the last one that does.
        const pages = Math.max(1, Math.ceil(rooms.length / PER_PAGE));
        roomsPage = Math.min(roomsPage, pages - 1);
        const json = JSON.stringify([roomsPage, rooms]);
        if (json === lastRoomsJSON) return; // nothing moved; leave the DOM alone
        lastRoomsJSON = json;
        const pager = $('#rooms-pager');
        pager.hidden = rooms.length <= PER_PAGE;
        $('#rooms-page').textContent = `Page ${roomsPage + 1} of ${pages} · ${rooms.length} ${rooms.length === 1 ? 'table' : 'tables'}`;
        $('#rooms-prev').disabled = roomsPage === 0;
        $('#rooms-next').disabled = roomsPage >= pages - 1;
        list.innerHTML = rooms.length
          ? rooms
              .slice(roomsPage * PER_PAGE, roomsPage * PER_PAGE + PER_PAGE)
              .map(
                (r) => `
            <tr>
              <td>
                <span class="code">${esc(r.code)}</span>
                ${r.full ? '<span class="room-full">Full</span>' : ''}
                <span class="sub">${esc(r.host)}</span>
              </td>
              <td class="num"><b>${r.players}</b><span class="of">/${r.seats}</span></td>
              <td class="num">${fmt(r.smallBlind)}<span class="of">/</span>${fmt(r.bigBlind)}</td>
              <td class="num">${r.full ? '<span class="of">—</span>' : fmt(r.chips)}</td>
              <td>${r.inPlay ? `<span class="room-live">Hand #${r.hand}</span>` : '<span class="of">Waiting to start</span>'}</td>
              <td class="num">${r.allowSpectators ? `<b>${r.watching}</b>` : '<span class="of">Not allowed</span>'}</td>
              <td class="room-acts">
                ${r.inPlay && r.allowSpectators ? `<button class="btn btn-sm btn-ghost" data-watch="${esc(r.code)}">Spectate</button>` : ''}
                ${r.full ? '' : `<button class="btn btn-sm btn-ghost" data-code="${esc(r.code)}">Join</button>`}
              </td>
            </tr>`
              )
              .join('')
          : '<tr class="rooms-empty"><td colspan="7">No open tables right now — host one!</td></tr>';
        list.querySelectorAll('[data-code]').forEach((b) =>
          b.addEventListener('click', () => {
            join(b.dataset.code, true);
            refreshRooms(); // whatever happens, redraw the list from the truth
          })
        );
        list.querySelectorAll('[data-watch]').forEach((b) =>
          b.addEventListener('click', () => {
            watch(b.dataset.watch);
            refreshRooms();
          })
        );
      })
      .catch(() => {});
  }

  // Turning a page is only ever a redraw of the list we already have, so it
  // goes through the same path as a refresh.
  const turnPage = (by) => {
    roomsPage = Math.max(0, roomsPage + by);
    lastRoomsJSON = null; // the rooms haven't changed, but the page has
    refreshRooms();
  };
  $('#rooms-prev').addEventListener('click', () => turnPage(-1));
  $('#rooms-next').addEventListener('click', () => turnPage(1));

  refreshRooms();
  // The server says when the list has actually changed, so a room going
  // private (or filling up, or closing) drops off straight away. The timer
  // stays as a backstop in case an event is missed.
  const socket = getSocket();
  socket.on('roomsChanged', refreshRooms);
  socket.on('knockAnswered', onKnockAnswered);
  const roomsTimer = setInterval(refreshRooms, 4000);
  // The lobby is torn down by replacing root's contents, so the poll has to
  // stop itself once its list is gone or it would run for the whole session.
  const stopWhenGone = setInterval(() => {
    if (root.querySelector('#room-list')) return;
    clearInterval(roomsTimer);
    clearInterval(stopWhenGone);
    socket.off('roomsChanged', refreshRooms);
    socket.off('knockAnswered', onKnockAnswered);
  }, 4000);
}
