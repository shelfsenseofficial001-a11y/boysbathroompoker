// The display name in the top bar, and the menu it opens. Change your name,
// type a new one, press Enter. The server validates and tells everyone at
// your table.
import { emitAck } from './socket.js';
import { avatarSVG } from './svg/avatars.js';
import { icons } from './svg/icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// The bare pill: clicking it goes straight to the name editor. Used where
// there is nothing else to offer.
export function userPillHTML(user) {
  return `<button class="user-pill" data-edit-name title="Change your name">
    ${avatarSVG(user.username)}<span class="user-name">${esc(user.username)}</span>${icons.pencil}
  </button>`;
}

// The same pill, but it opens a menu. `groups` is a list of lists: each inner
// list is a block of items with a rule drawn between blocks, so related
// things sit together. An item is { id, icon, label, danger? }.
export function userMenuHTML(user, groups = []) {
  return `<div class="user-menu">${menuInnerHTML(user, groups)}</div>`;
}

function menuInnerHTML(user, groups) {
  // An item with an `href` is drawn as a real link, which is the only way
  // middle-click, long-press and "open in new tab" work on it. The table's
  // own menu uses that for the profile page: a player in the middle of a
  // hand should be able to look at a profile without their seat going with
  // them, and a link to a new tab is how that is said.
  const item = (it) =>
    it.href
      ? `<a role="menuitem" class="umenu-item" href="${esc(it.href)}" target="_blank" rel="noopener noreferrer">
          ${it.icon || ''}<span>${esc(it.label)}</span>
        </a>`
      : `<button type="button" role="menuitem" class="umenu-item${it.danger ? ' is-danger' : ''}" data-user-item="${esc(it.id)}">
          ${it.icon || ''}<span>${esc(it.label)}</span>
        </button>`;
  const blocks = [[{ id: 'rename', icon: icons.pencil, label: 'Change name' }], ...groups];
  return `<button class="user-pill" data-user-menu aria-haspopup="menu" aria-expanded="false" title="Your account">
      ${avatarSVG(user.username)}<span class="user-name">${esc(user.username)}</span>${icons.chevronDown}
    </button>
    <div class="umenu" role="menu" hidden>
      ${blocks.map((g) => `<div class="umenu-group">${g.map(item).join('')}</div>`).join('')}
    </div>`;
}

// `onPick(id)` is called for every item but 'rename', which is handled here.
// `groups` has to match what the markup was built with, so the menu can be
// put back after a rename.
export function wireUserMenu(root, user, { groups = [], onPick, onRenamed } = {}) {
  const wrap = root.querySelector('.user-menu');
  if (!wrap) return;
  const pill = wrap.querySelector('[data-user-menu]');
  const menu = wrap.querySelector('.umenu');
  const close = () => {
    menu.hidden = true;
    pill.setAttribute('aria-expanded', 'false');
  };

  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) {
      menu.hidden = false;
      pill.setAttribute('aria-expanded', 'true');
    } else close();
  });

  menu.addEventListener('click', (e) => {
    // A link item navigates by being a link. Nothing to dispatch; just put
    // the menu away behind it.
    if (e.target.closest('a.umenu-item')) return close();
    const btn = e.target.closest('[data-user-item]');
    if (!btn) return;
    close();
    const id = btn.dataset.userItem;
    if (id !== 'rename') return onPick?.(id);
    // Put the whole menu back once the name is settled, rather than trying to
    // patch the one label: the avatar is drawn from the name too.
    editName(wrap, pill, user, (name) => {
      wrap.innerHTML = menuInnerHTML(user, groups);
      wireUserMenu(root, user, { groups, onPick, onRenamed });
      if (name) onRenamed?.(name);
    });
  });

  // Anywhere else, or Escape, puts it away.
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      pill.focus();
    }
  });
}

// `onRenamed(newName)` lets the caller refresh anything showing the old one.
export function wireNameEditor(root, user, onRenamed) {
  const pill = root.querySelector('[data-edit-name]');
  if (!pill) return;
  pill.addEventListener('click', () => {
    editName(root, pill, user, (name) => {
      const box = root.querySelector('.name-edit');
      if (box) box.outerHTML = userPillHTML(user);
      wireNameEditor(root, user, onRenamed);
      if (name) onRenamed?.(name);
    });
  });
}

// Swaps `pill` for a text box inside `host`, then calls `done(newName|null)`.
function editName(host, pill, user, done) {
  if (host.querySelector('.name-edit')) return;
  const box = document.createElement('span');
  box.className = 'name-edit';
  box.innerHTML = `<input class="input input-sm" maxlength="20" aria-label="Your name" value="${esc(user.username)}">`;
  pill.replaceWith(box);
  const input = box.querySelector('input');
  input.focus();
  input.select();

  const save = async () => {
    const value = input.value.trim();
    if (!value || value === user.username) return done(null);
    input.disabled = true;
    try {
      const res = await emitAck('setName', { name: value });
      user.username = res.name;
      done(res.name);
    } catch (err) {
      input.disabled = false;
      input.focus();
      box.dataset.error = err.message;
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    else if (e.key === 'Escape') done(null);
  });
  input.addEventListener('blur', save);
}
