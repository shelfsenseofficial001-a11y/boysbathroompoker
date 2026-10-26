// The two rows of swatches that dress the table: one for the cloth, one for
// the back of the cards. The same control serves the lobby and the settings
// sheet at the table, so the two can't drift apart.
import { FELTS, BACKS, DECKS, feltSVG, cardBackSVG } from './svg/themes.js';
import { deckSwatchHTML } from './svg/cards.js';
import { getSettings, setSetting } from './settings.js';
import { icons } from './svg/icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// `kind` is the settings key: 'felt', 'cardBack' or 'deck'.
const LISTS = { felt: FELTS, cardBack: BACKS, deck: DECKS };
const ROW_LABEL = { felt: 'Table felt', cardBack: 'Card back', deck: 'Suit colours' };
// A swatch is its own shape, wider than it is tall but not as wide as the
// table, so the cloth is cut to the swatch rather than to the table (see
// .swatch-felt .swatch-art, which sets the same ratio).
const SWATCH_ASPECT = 76 / 50;
const DRAW = {
  felt: (id) => feltSVG(id, SWATCH_ASPECT),
  cardBack: (id) => cardBackSVG(id),
  deck: (id) => deckSwatchHTML(id),
};

// The grid is taller than the space it gets, so it scrolls. On a phone that
// scroll is easy to miss and awkward to reach - the gesture belongs to the
// page or the sheet around it - so the grid carries its own pair of arrows,
// shown only while there is something that way to scroll to.
export function themeRowHTML(kind, selected) {
  const list = LISTS[kind];
  const arrow = (dir, label) =>
    `<button type="button" class="swatch-more swatch-more-${dir}" data-scroll="${dir}"
      aria-label="${label}" tabindex="-1">${icons.chevronDown}</button>`;
  return `<div class="swatch-scroll">${arrow('up', 'Show the ones above')}${arrow('down', 'Show the ones below')}
    <div class="swatch-row" role="radiogroup" aria-label="${ROW_LABEL[kind]}" data-theme-row="${kind}">
    ${list
      .map(
        (t) => `<button type="button" class="swatch swatch-${kind}${t.id === selected ? ' is-on' : ''}"
          role="radio" aria-checked="${t.id === selected}" data-theme="${kind}" data-theme-id="${t.id}"
          title="${esc(t.name)}">
          <span class="swatch-art" aria-hidden="true">${DRAW[kind](t.id)}</span>
          <span class="swatch-name">${esc(t.name)}</span>
        </button>`
      )
      .join('')}
    </div>
  </div>`;
}

// Both rows, with their headings — what goes in a settings panel.
export function themePickerHTML(s = getSettings()) {
  return `<div class="set-field">
      <label>Table felt</label>
      ${themeRowHTML('felt', s.felt)}
    </div>
    <div class="set-field">
      <label>Card backs</label>
      ${themeRowHTML('cardBack', s.cardBack)}
    </div>
    <div class="set-field">
      <label>Suit colours</label>
      ${themeRowHTML('deck', s.deck)}
    </div>`;
}

// Nudge a half-seen swatch fully into view. Deliberately not scrollIntoView:
// `block: 'nearest'` walks every scrolling ancestor, so in the settings sheet
// - where the grid sits low in a tall panel - tapping a swatch scrolled the
// whole sheet and the swatches vanished from under the finger. This scrolls
// the grid itself and nothing above it.
// Measured from rects, not offsetTop: the grid isn't a positioned element, so
// offsets are relative to some ancestor further up and scrolling by them moved
// the wrong amount.
function keepInRow(btn) {
  const row = btn.parentElement;
  const pad = 8;
  const b = btn.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  if (b.top - pad < box.top) row.scrollTop -= box.top - b.top + pad;
  else if (b.bottom + pad > box.bottom) row.scrollTop += b.bottom - box.bottom + pad;
  if (b.left - pad < box.left) row.scrollLeft -= box.left - b.left + pad;
  else if (b.right + pad > box.right) row.scrollLeft += b.right - box.right + pad;
}

// How far there is left to scroll each way, as classes on the wrapper, so the
// arrows are only there while they'd do something. Called on scroll, on a
// pick, and whenever a picker is drawn or the space it has changes.
function syncArrows(row) {
  const wrap = row.parentElement;
  if (!wrap?.classList.contains('swatch-scroll')) return;
  const slack = row.scrollHeight - row.clientHeight;
  // A grid that fits shows neither arrow. The 2px is for the rounding a
  // fractional device pixel ratio leaves behind, which would otherwise read
  // as a permanent scrap of scroll at the bottom.
  wrap.classList.toggle('can-up', slack > 2 && row.scrollTop > 2);
  wrap.classList.toggle('can-down', slack > 2 && row.scrollTop < slack - 2);
}

// Every picker inside `root`, now and after a resize reflows the grid.
export function syncThemeArrows(root) {
  root.querySelectorAll('[data-theme-row]').forEach(syncArrows);
}

// Click anything in a row and it becomes the choice. `onPick` is told which
// key changed so the caller can redress whatever it has on screen.
export function wireThemePicker(root, onPick) {
  // Scrolling the grid is what moves the arrows, and a grid can be drawn long
  // after this runs, so both are delegated from `root`. Scroll doesn't bubble,
  // hence the capture phase.
  root.addEventListener(
    'scroll',
    (e) => {
      if (e.target.matches?.('[data-theme-row]')) syncArrows(e.target);
    },
    true
  );
  window.addEventListener('resize', () => syncThemeArrows(root));

  root.addEventListener('click', (e) => {
    const arrow = e.target.closest('[data-scroll]');
    if (arrow) {
      const row = arrow.parentElement.querySelector('[data-theme-row]');
      // One row of swatches at a time, read off a real one rather than
      // assumed, since felt and card backs are different heights.
      const one = row.firstElementChild?.offsetHeight || 64;
      const gap = parseFloat(getComputedStyle(row).rowGap) || 10;
      row.scrollBy({ top: (one + gap) * (arrow.dataset.scroll === 'up' ? -1 : 1), behavior: 'smooth' });
      return;
    }
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    const kind = btn.dataset.theme;
    const id = btn.dataset.themeId;
    if (getSettings()[kind] === id) return;
    setSetting(kind, id);
    // Only the row that changed is touched: redrawing both would rebuild
    // twenty swatches to move one ring.
    btn.parentElement.querySelectorAll('[data-theme]').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    keepInRow(btn);
    syncArrows(btn.parentElement);
    onPick?.(kind, id);
  });
}
