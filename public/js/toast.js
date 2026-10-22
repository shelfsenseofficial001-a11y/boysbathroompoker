// Transient messages: something that went wrong, or news worth a glance.
// The host lives on <body> rather than inside a screen, because both screens
// rebuild their own markup on every update and would take a toast that's
// still on display down with them.

function host(atPage) {
  let el = document.getElementById('toast-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-host';
    document.body.appendChild(el);
  }
  // The lobby sits lower than the table, which has to clear the betting dock.
  el.className = `toast-host${atPage ? ' is-page' : ''}`;
  return el;
}

// How many are on screen at once. Hitting a button that fails repeatedly
// (an empty room code, say) used to stack one message per press until they
// filled the page and covered what you were trying to read.
const MAX_TOASTS = 3;

// `schedule` lets a screen that tracks its own timers (the table clears its
// own when you leave) hand in its version of setTimeout.
export function showToast(msg, { info = false, atPage = false, ms = null, schedule = setTimeout } = {}) {
  const el = document.createElement('div');
  el.className = `toast${info ? ' is-info' : ' is-error'}`;
  el.setAttribute('role', info ? 'status' : 'alert');
  el.textContent = msg;
  const box = host(atPage);
  box.appendChild(el);
  // The newest is the one worth reading, so the oldest make way for it.
  // Their own timers still fire later and find nothing to remove.
  while (box.children.length > MAX_TOASTS) box.firstElementChild.remove();
  schedule(() => el.remove(), ms ?? (info ? 4000 : 5000));
}
