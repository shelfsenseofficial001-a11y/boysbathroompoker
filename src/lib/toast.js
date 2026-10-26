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
// How many times the same message will be echoed back before we stop
// answering at all, and for how long. Someone jabbing a button that can't
// work is told the same thing over and over; past a point repeating it
// isn't information, it's noise.
const MAX_REPEATS = 10;
const COOLDOWN_MS = 5000;
const COOLDOWN_TEXT = 'Slow down a moment — that isn’t going to work yet.';
// A message nothing can ever be folded into, so the pause itself is never
// counted as a repeat.
const COOLDOWN_KEY = '__cooldown__';
let quietUntil = 0;

// Counts down to its own removal, and notices if the toast was repeated
// while it was waiting: the message's time starts again from the repeat
// rather than from when it first appeared. A chain of timeouts, so a repeat
// needs nothing cancelled.
//
// Deliberately plain setTimeout. The table used to lend its own scheduler so
// its timers died with the screen, but the host hangs off <body> and outlives
// any screen: a toast shown as the room closed had its removal cancelled
// along with the table's other timers and then sat there for good. "Someone
// left the game" arrives at exactly that moment, which is why it was the one
// that stuck.
function scheduleRemoval(el) {
  setTimeout(() => {
    const left = el._expires - Date.now();
    if (left > 20) return scheduleRemoval(el); // said again since
    leave(el);
  }, Math.max(0, el._expires - Date.now()));
}

// Fades the toast out before taking it away, rather than blinking it off.
// Under reduced motion there's nothing to wait for. A fallback timer covers
// a tab in the background, where animationend may never be delivered.
function leave(el) {
  if (!el.isConnected) return;
  if (document.documentElement.classList.contains('reduce-motion')) return el.remove();
  el.classList.add('is-leaving');
  const done = () => el.remove();
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
}

export function showToast(msg, { info = false, atPage = false, ms = null } = {}) {
  const box = host(atPage);
  const kind = info ? 'info' : 'error';
  const life = ms ?? (info ? 4000 : 5000);

  // The same thing happening twice is one message that happened twice, not
  // two messages. Only the newest is a candidate, so distinct messages
  // arriving in between are never folded together.
  // Still inside the pause a burst earned: nothing further is said until it
  // runs out, whatever the message.
  if (Date.now() < quietUntil) return;

  const last = box.lastElementChild;
  // Never into one already fading out: the count would bump and then vanish.
  if (last && !last.classList.contains('is-leaving') && last.dataset.msg === msg && last.dataset.kind === kind) {
    last._n = (last._n || 1) + 1;
    // Past the cap the count stops being worth reading. The pile is replaced
    // by one line asking them to stop, and nothing else lands until it ends.
    if (last._n > MAX_REPEATS) {
      quietUntil = Date.now() + COOLDOWN_MS;
      last.remove();
      addToast(box, {
        msg: COOLDOWN_TEXT,
        key: COOLDOWN_KEY,
        kind: 'error',
        role: 'alert',
        life: COOLDOWN_MS,
      });
      return;
    }
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

  addToast(box, { msg, key: msg, kind, role: info ? 'status' : 'alert', life });
}

function addToast(box, { msg, key, kind, role, life }) {
  const el = document.createElement('div');
  el.className = `toast is-${kind}`;
  el.setAttribute('role', role);
  el.dataset.msg = key;
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
  scheduleRemoval(el);
  return el;
}
