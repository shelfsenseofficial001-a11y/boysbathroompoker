// Lobby: host a new room (blinds + your starting chips; the host sets every
// player's chips in the waiting room) or join one by code.
import { emitAck } from './socket.js';
import { avatarSVG } from './svg/avatars.js';
import { icons } from './svg/icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function renderLobby(root, { user, guest, onLogout, onEnterRoom }) {
  root.innerHTML = `<div class="screen">
    <header class="topbar">
      <div class="brand">${icons.logo}<span>Boysbathroom <em>Poker</em></span></div>
      <div class="topbar-user">
        <span class="user-pill">${avatarSVG(user.username)}<span class="user-name">${esc(user.username)}</span></span>
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
            <div class="field"><label for="sb">Small blind</label><input id="sb" type="number" min="1" step="1" inputmode="numeric" value="5"></div>
            <div class="field"><label for="bb">Big blind</label><input id="bb" type="number" min="2" step="1" inputmode="numeric" value="10"></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="buyin-host">Your starting chips</label><input id="buyin-host" type="number" min="1" step="1" inputmode="numeric" value="1000"></div>
          </div>
          <button class="btn btn-primary btn-lg" id="create-room">Create room</button>
        </section>
        <section class="panel">
          <h2 class="h2">Join a game</h2>
          <p class="help-text">Enter the 5-letter code your host shared.</p>
          <div class="field-row">
            <div class="field"><label for="join-code">Room code</label><input id="join-code" type="text" maxlength="5" autocomplete="off" placeholder="ABCDE" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700"></div>
            <div class="field"><label for="buyin-join">Starting chips</label><input id="buyin-join" type="number" min="1" step="1" inputmode="numeric" value="1000"></div>
          </div>
          <button class="btn btn-lg" id="join-room">Join room</button>
          <div class="micro" style="margin-top:22px">Open tables</div>
          <div class="room-list" id="room-list"><div class="empty">Looking for tables…</div></div>
        </section>
      </div>
      <p class="error-text" id="lobby-error" role="alert"></p>
    </main>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const errEl = $('#lobby-error');
  const fail = (err) => (errEl.textContent = err.message);

  $('#logout').addEventListener('click', onLogout);

  $('#create-room').addEventListener('click', async (e) => {
    errEl.textContent = '';
    e.currentTarget.disabled = true;
    try {
      const res = await emitAck('createRoom', {
        smallBlind: Number($('#sb').value),
        bigBlind: Number($('#bb').value),
        buyIn: Number($('#buyin-host').value),
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
      const res = await emitAck('joinRoom', { code, buyIn: Number($('#buyin-join').value) });
      onEnterRoom(res.code);
    } catch (err) {
      fail(err);
    }
  }

  $('#join-room').addEventListener('click', () => join($('#join-code').value.trim().toUpperCase()));
  $('#join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join(e.target.value.trim().toUpperCase());
  });

  emitAck('listRooms')
    .then(({ rooms }) => {
      const list = $('#room-list');
      if (!list) return;
      list.innerHTML = rooms.length
        ? rooms.map((r) => `
            <div class="room-row">
              <div><div class="code">${esc(r.code)}</div><div class="sub">${esc(r.host)} · ${r.players} waiting · blinds ${fmt(r.smallBlind)}/${fmt(r.bigBlind)}</div></div>
              <button class="btn btn-sm btn-ghost" data-code="${esc(r.code)}">Join</button>
            </div>`).join('')
        : '<div class="empty">No open tables right now — host one!</div>';
      list.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => join(b.dataset.code)));
    })
    .catch(() => {});
}
