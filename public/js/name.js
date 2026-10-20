// The display-name editor in the top bar. Click your name, type a new one,
// press Enter. The server validates and tells everyone at your table.
import { emitAck } from './socket.js';
import { avatarSVG } from './svg/avatars.js';
import { icons } from './svg/icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function userPillHTML(user) {
  return `<button class="user-pill" data-edit-name title="Change your name">
    ${avatarSVG(user.username)}<span class="user-name">${esc(user.username)}</span>${icons.pencil}
  </button>`;
}

// `onRenamed(newName)` lets the caller refresh anything showing the old one.
export function wireNameEditor(root, user, onRenamed) {
  const pill = root.querySelector('[data-edit-name]');
  if (!pill) return;

  pill.addEventListener('click', () => {
    if (root.querySelector('.name-edit')) return;
    const box = document.createElement('span');
    box.className = 'name-edit';
    box.innerHTML = `<input class="input input-sm" maxlength="20" aria-label="Your name" value="${esc(user.username)}">`;
    pill.replaceWith(box);
    const input = box.querySelector('input');
    input.focus();
    input.select();

    const restore = (name) => {
      user.username = name;
      box.outerHTML = userPillHTML(user);
      wireNameEditor(root, user, onRenamed);
    };

    const save = async () => {
      const value = input.value.trim();
      if (!value || value === user.username) return restore(user.username);
      input.disabled = true;
      try {
        const res = await emitAck('setName', { name: value });
        restore(res.name);
        onRenamed?.(res.name);
      } catch (err) {
        input.disabled = false;
        input.focus();
        box.dataset.error = err.message;
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      else if (e.key === 'Escape') restore(user.username);
    });
    input.addEventListener('blur', save);
  });
}
