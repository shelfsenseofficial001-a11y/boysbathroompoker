// Number fields with their own − / + buttons. The browser's native spinners
// are hidden (they're tiny and ugly), so every number input uses these.
import { icons } from './svg/icons.js';

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
    const current = Number(input.value) || 0;
    // Snap onto the step grid first, so 37 with a step of 10 goes to 40, not 47.
    const snapped = dir > 0 ? Math.floor(current / step) * step : Math.ceil(current / step) * step;
    const next = Math.min(max, Math.max(min, snapped + dir * step));
    if (next === current) return;

    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
