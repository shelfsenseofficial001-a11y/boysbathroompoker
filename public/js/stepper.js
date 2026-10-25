// Number fields: their own − / + buttons, what they'll accept being typed
// into them, and the one rule that ties the two blinds together. The browser's
// native spinners are hidden (they're tiny and ugly), so every number input
// uses these.
import { icons } from './svg/icons.js';
import { flagInvalid, numberBounds, readNumber } from './invalid.js';

export function numberFieldHTML({ id = '', value, min = 1, max = null, step = 1, label, attrs = '', wide = true }) {
  return `<div class="stepper${wide ? ' is-wide' : ''}">
    <button type="button" class="step-btn" data-step="-1" tabindex="-1" aria-label="Decrease ${label}">${icons.minus}</button>
    <input class="input num" type="number" ${id ? `id="${id}"` : ''} value="${value}" min="${min}"${max === null ? '' : ` max="${max}"`} step="${step}" inputmode="numeric" aria-label="${label}" ${attrs}>
    <button type="button" class="step-btn" data-step="1" tabindex="-1" aria-label="Increase ${label}">${icons.plus}</button>
  </div>`;
}

// One delegated listener covers every stepper inside `root`. The betting dock
// has its own poker-aware stepping, so it's left alone here.
export function wireSteppers(root) {
  // Screens re-render on every update, so only ever attach this once —
  // otherwise the listeners stack up and one click steps several times.
  if (root.dataset.steppersWired) return;
  root.dataset.steppersWired = 'yes';

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn || btn.disabled || btn.closest('.dock')) return;
    const input = btn.parentElement.querySelector('input[type="number"]');
    if (!input || input.disabled) return;

    const step = Number(input.step) || 1;
    const min = input.min === '' ? -Infinity : Number(input.min);
    const max = input.max === '' ? Infinity : Number(input.max);
    const dir = Number(btn.dataset.step);
    // A field left in an unreadable state (emptied, or holding something a
    // number input won't give back) steps from its floor rather than from 0,
    // which for a min of 1 would otherwise take a + click to produce nothing.
    const current = readNumber(input) ?? Math.max(0, min === -Infinity ? 0 : min);
    // Snap onto the step grid first, so 37 with a step of 10 goes to 40, not 47.
    const snapped = dir > 0 ? Math.floor(current / step) * step : Math.ceil(current / step) * step;
    const next = Math.min(max, Math.max(min, snapped + dir * step));
    if (next === current) return;

    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// --- Blinds ----------------------------------------------------------------
// The two blinds are one setting in two boxes: a big blind at or under the
// small blind isn't a stake anyone can post, and the server refuses the pair
// outright. Rather than let a player assemble a rejected pair and then read a
// complaint about it, whichever box they didn't just touch follows the one
// they did - big blind twice the small, small blind half the big.
//
// `edited` says which box the player changed, so the correction lands on the
// other one. Returns the pair it settled on.
export function balanceBlinds(sbInput, bbInput, edited = 'sb') {
  const sb = readNumber(sbInput);
  const bb = readNumber(bbInput);
  if (sb === null || bb === null || bb > sb) return { sb, bb };

  const set = (input, value) => {
    input.value = String(value);
    // The waiting room saves these on change, and the lobby reads them when
    // the room is created; an assignment alone fires neither.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  if (edited === 'sb') {
    const next = Math.min(numberBounds(bbInput).max, sb * 2);
    set(bbInput, next);
    return { sb, bb: next };
  }
  // They lowered the big blind under the small one: halve the small blind to
  // match, never below its own floor.
  const next = Math.max(numberBounds(sbInput).min, Math.floor(bb / 2));
  set(sbInput, next);
  return { sb: next, bb };
}

// Keeps a pair of blind fields in step as they're edited. `change` rather than
// `input`, so a figure being typed a digit at a time isn't corrected halfway
// through - 5 on the way to 50 would drag the big blind down with it.
export function wireBlindPair(sbInput, bbInput) {
  if (!sbInput || !bbInput) return;
  let busy = false; // balanceBlinds fires change on the field it corrects
  const on = (edited) => () => {
    if (busy) return;
    busy = true;
    try {
      balanceBlinds(sbInput, bbInput, edited);
    } finally {
      busy = false;
    }
  };
  sbInput.addEventListener('change', on('sb'));
  bbInput.addEventListener('change', on('bb'));
}

// A number field read back for submission: the value, or null having marked
// the field and handed the reason to `onError`.
export function readField(input, name, onError) {
  const value = readNumber(input);
  if (value === null) {
    flagInvalid(input, { focus: true });
    onError?.(`${name} has to be a whole number.`);
    return null;
  }
  const { min, max } = numberBounds(input);
  if (value < min || value > max) {
    flagInvalid(input, { focus: true });
    onError?.(
      value < min
        ? `${name} can’t be below ${min.toLocaleString('en-US')}.`
        : `${name} can’t be above ${max.toLocaleString('en-US')}.`
    );
    return null;
  }
  return value;
}
