// One tooltip for the whole app. Every icon-only control in the game says
// what it is in a `title` or an `aria-label` already, for screen readers and
// for anyone who waits out the browser's own tooltip; this draws that same
// word in the game's own bubble, straight away and in the right place.
//
// Nothing is tagged for it. A control qualifies by being a control with a
// label and no visible text of its own - which is exactly what an icon
// button is - so a button drawn long after this runs is covered too, and
// none of the 70-odd call sites had to be touched.

const CONTROLS = 'button, a[href], summary, [role="button"], [role="radio"], [role="tab"]';
const HOVER_DELAY = 340; // long enough that a pointer crossing the dock stays quiet
const EDGE = 8; // keeps the bubble off the very edge of the window
const GAP = 8; // between the bubble and the control it belongs to

let tip = null;
let showing = null; // the element the bubble currently belongs to
let timer = 0;
let stashed = null; // { el, title } while the browser's own tooltip is off

// `data-tip` says so outright. Otherwise the label is whatever the control
// already tells assistive tech, and the control has to be icon-only: one
// that spells itself out in text needs no bubble repeating it.
function labelFor(el) {
  if (!el || el.matches('input, textarea, select')) return null;
  if (el.dataset.tip) return el.dataset.tip;
  if (el.textContent.trim()) return null;
  return el.getAttribute('title') || el.getAttribute('aria-label') || null;
}

function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

// Above the control, centred on it, and below instead when there isn't room
// above - the dock along the foot of the table is the usual case. The tail
// stays over the control's middle however far the bubble is nudged back in
// from the edge of the window.
function place(el) {
  const box = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const below = box.top - h - GAP < EDGE;
  const top = below ? box.bottom + GAP : box.top - h - GAP;
  const wanted = box.left + box.width / 2 - w / 2;
  const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - w - EDGE));
  tip.classList.toggle('is-below', below);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.setProperty('--tail', `${Math.round(box.left + box.width / 2 - left)}px`);
}

function show(el, text) {
  ensureTip();
  showing = el;
  tip.textContent = text;
  tip.hidden = false;
  // Measured before it is placed, so the first frame lands where the last
  // one would - a bubble that jumps into position reads as a glitch.
  place(el);
  tip.classList.add('is-on');
  // The browser's own tooltip would otherwise arrive a second later and sit
  // under this one. It goes back the moment the pointer leaves, so nothing
  // reading the page off the DOM loses it for longer than a hover.
  const title = el.getAttribute('title');
  if (title) {
    stashed = { el, title };
    el.removeAttribute('title');
  }
}

function hide() {
  clearTimeout(timer);
  timer = 0;
  showing = null;
  if (stashed) {
    stashed.el.setAttribute('title', stashed.title);
    stashed = null;
  }
  if (!tip) return;
  tip.classList.remove('is-on');
  tip.hidden = true;
}

function open(el, delay) {
  const text = labelFor(el);
  if (!text || el === showing) return;
  hide();
  if (!delay) return show(el, text);
  timer = setTimeout(() => showing !== el && show(el, text), delay);
}

export function initTooltips(doc = document) {
  doc.addEventListener('pointerover', (e) => {
    // Touch raises a pointerover of its own on a tap, and a bubble that
    // appears under a finger that is already pressing is only in the way.
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.(CONTROLS);
    if (el !== showing) hide();
    if (el) open(el, HOVER_DELAY);
  });
  // pointerout also fires on the way into a control's own icon, so what
  // matters is where the pointer has gone, not that it left something: a
  // move inside the control it is already naming changes nothing.
  doc.addEventListener('pointerout', (e) => {
    if (!showing && !timer) return;
    const to = e.relatedTarget;
    if (to && (to === showing || showing?.contains(to))) return;
    hide();
  });
  // Tabbing to a control says the keyboard is being used to find it, so the
  // label is wanted now rather than after a wait.
  doc.addEventListener('focusin', (e) => {
    const el = e.target.closest?.(CONTROLS);
    if (el?.matches(':focus-visible')) open(el, 0);
    else hide();
  });
  doc.addEventListener('focusout', hide);
  // A press has answered whatever the bubble was there to tell them, and a
  // page that moves under a fixed bubble leaves it pointing at nothing.
  doc.addEventListener('pointerdown', hide);
  doc.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
}
