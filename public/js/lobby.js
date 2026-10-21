// Lobby: host a new room (blinds + your starting chips; the host sets every
// player's chips in the waiting room) or join one by code.
import { emitAck, getSocket } from './socket.js';
import { avatarSVG } from './svg/avatars.js';
import { icons } from './svg/icons.js';
import { userPillHTML, wireNameEditor } from './name.js';
import { getSettings, setSetting, resetSettings, ZOOM } from './settings.js';
import { numberFieldHTML, wireSteppers } from './stepper.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function renderLobby(root, { user, guest, onLogout, onEnterRoom, notice }) {
  const s = getSettings();
  root.innerHTML = `<div class="screen">
    <header class="topbar">
      <div class="brand">${icons.logo}<span>Boysbathroom <em>Poker</em></span></div>
      <div class="topbar-user">
        ${userPillHTML(user)}
        <button class="btn btn-ghost btn-sm" id="logout">${guest ? 'New guest' : 'Log out'}</button>
      </div>
    </header>
    <main class="page">
      <section class="hero">
        <div class="eyebrow">Play-money Texas Hold’em</div>
        <h1 class="display">Pull up a chair.</h1>
        <p class="lead">Host a private table or join friends with a room code. Chips are fake — strictly for bragging rights.</p>
      </section>
      <div class="lobby-grid">
        <section class="panel">
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
            <span>Private room — only people with the code can find it</span>
          </label>
          <button class="btn btn-primary btn-lg" id="create-room">Create room</button>
        </section>
        <section class="panel">
          <h2 class="h2">Join a game</h2>
          <p class="help-text">Enter the 5-letter code your host shared. They set everyone's chips.</p>
          <div class="field-row">
            <div class="field"><label for="join-code">Room code</label><input id="join-code" type="text" maxlength="5" autocomplete="off" placeholder="ABCDE" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700"></div>
          </div>
          <button class="btn btn-lg" id="join-room">Join room</button>
          <div class="micro" style="margin-top:22px">Open tables</div>
          <div class="room-list" id="room-list"><div class="empty">Looking for tables…</div></div>
        </section>
      </div>
      <section class="panel" style="margin-top:20px">
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
  const fail = (err) => (errEl.textContent = err.message);

  $('#logout').addEventListener('click', onLogout);
  wireNameEditor(root, user);
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

  async function join(code) {
    errEl.textContent = '';
    if (!code) return fail(new Error('Enter a room code.'));
    try {
      // No buy-in is sent: the host sets every player's stack, in the waiting
      // room or - for someone arriving mid-game - from their late-join figure.
      const res = await emitAck('joinRoom', { code });
      // Walking into a game already running: the host's stake applies, so say
      // so rather than letting the chips field silently mean nothing.
      onEnterRoom(res.code, res.waiting ? `Joining with ${Number(res.chips).toLocaleString('en-US')} chips — you'll be dealt in next hand.` : null);
    } catch (err) {
      fail(err);
    }
  }

  $('#join-room').addEventListener('click', () => join($('#join-code').value.trim().toUpperCase()));
  $('#join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join(e.target.value.trim().toUpperCase());
  });

  // The open-tables list refreshes itself, so somebody waiting for a friend
  // to host doesn't have to keep reloading the page to see it appear.
  let lastRoomsJSON = null;
  function refreshRooms() {
    emitAck('listRooms')
      .then(({ rooms }) => {
        const list = $('#room-list');
        if (!list) return;
        const json = JSON.stringify(rooms);
        if (json === lastRoomsJSON) return; // nothing moved; leave the DOM alone
        lastRoomsJSON = json;
        list.innerHTML = rooms.length
          ? rooms
              .map(
                (r) => `
            <div class="room-row">
              <div><div class="code">${esc(r.code)}</div><div class="sub">${esc(r.host)} · ${r.players} waiting · blinds ${fmt(r.smallBlind)}/${fmt(r.bigBlind)}</div></div>
              <button class="btn btn-sm btn-ghost" data-code="${esc(r.code)}">Join</button>
            </div>`
              )
              .join('')
          : '<div class="empty">No open tables right now — host one!</div>';
        list.querySelectorAll('[data-code]').forEach((b) =>
          b.addEventListener('click', () => join(b.dataset.code))
        );
      })
      .catch(() => {});
  }

  refreshRooms();
  // The server says when the list has actually changed, so a room going
  // private (or filling up, or closing) drops off straight away. The timer
  // stays as a backstop in case an event is missed.
  const socket = getSocket();
  socket.on('roomsChanged', refreshRooms);
  const roomsTimer = setInterval(refreshRooms, 4000);
  // The lobby is torn down by replacing root's contents, so the poll has to
  // stop itself once its list is gone or it would run for the whole session.
  const stopWhenGone = setInterval(() => {
    if (root.querySelector('#room-list')) return;
    clearInterval(roomsTimer);
    clearInterval(stopWhenGone);
    socket.off('roomsChanged', refreshRooms);
  }, 4000);
}
