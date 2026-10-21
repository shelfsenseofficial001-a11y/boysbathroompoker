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

// `schedule` lets a screen that tracks its own timers (the table clears its
// own when you leave) hand in its version of setTimeout.
export function showToast(msg, { info = false, atPage = false, schedule = setTimeout } = {}) {
  const el = document.createElement('div');
  el.className = `toast${info ? ' is-info' : ' is-error'}`;
  el.setAttribute('role', info ? 'status' : 'alert');
  el.textContent = msg;
  host(atPage).appendChild(el);
  schedule(() => el.remove(), info ? 4000 : 5000);
}
