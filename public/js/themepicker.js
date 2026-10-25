// The two rows of swatches that dress the table: one for the cloth, one for
// the back of the cards. The same control serves the lobby and the settings
// sheet at the table, so the two can't drift apart.
import { FELTS, BACKS, feltSVG, cardBackSVG } from './svg/themes.js';
import { getSettings, setSetting } from './settings.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// `kind` is the settings key: 'felt' or 'cardBack'.
const LISTS = { felt: FELTS, cardBack: BACKS };
const DRAW = { felt: (id) => feltSVG(id), cardBack: (id) => cardBackSVG(id) };

export function themeRowHTML(kind, selected) {
  const list = LISTS[kind];
  return `<div class="swatch-row" role="radiogroup" aria-label="${kind === 'felt' ? 'Table felt' : 'Card back'}" data-theme-row="${kind}">
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

// Click anything in a row and it becomes the choice. `onPick` is told which
// key changed so the caller can redress whatever it has on screen.
export function wireThemePicker(root, onPick) {
  root.addEventListener('click', (e) => {
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
    onPick?.(kind, id);
  });
}
