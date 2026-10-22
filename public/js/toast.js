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

// Counts down to its own removal, and notices if the toast was repeated
// while it was waiting: the message's time starts again from the repeat
// rather than from when it first appeared. Written as a chain of timeouts
// because `schedule` hands back no handle to cancel.
function scheduleRemoval(el, schedule) {
  schedule(() => {
    const left = el._expires - Date.now();
    if (left > 20) return scheduleRemoval(el, schedule); // said again since
    el.remove();
  }, Math.max(0, el._expires - Date.now()));
}

// `schedule` lets a screen that tracks its own timers (the table clears its
// own when you leave) hand in its version of setTimeout.
export function showToast(msg, { info = false, atPage = false, ms = null, schedule = setTimeout } = {}) {
  const box = host(atPage);
  const kind = info ? 'info' : 'error';
  const life = ms ?? (info ? 4000 : 5000);

  // The same thing happening twice is one message that happened twice, not
  // two messages. Only the newest is a candidate, so distinct messages
  // arriving in between are never folded together.
  const last = box.lastElementChild;
  if (last && last.dataset.msg === msg && last.dataset.kind === kind) {
    last._n = (last._n || 1) + 1;
    let badge = last.querySelector('.toast-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'toast-count';
      last.appendChild(badge);
    }
    badge.textContent = `×${last._n}`;
    last._expires = Date.now() + life; // its time starts again
    return;
  }

  const el = document.createElement('div');
  el.className = `toast is-${kind}`;
  el.setAttribute('role', info ? 'status' : 'alert');
  el.dataset.msg = msg;
  el.dataset.kind = kind;
  el._n = 1;
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);
  box.appendChild(el);
  // The newest is the one worth reading, so the oldest make way for it.
  // Their own timers still fire later and find nothing to remove.
  while (box.children.length > MAX_TOASTS) box.firstElementChild.remove();
  el._expires = Date.now() + life;
  scheduleRemoval(el, schedule);
}
