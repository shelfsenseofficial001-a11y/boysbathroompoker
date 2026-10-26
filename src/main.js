import { createApp } from 'vue';
import App from './App.vue';

// Order matters. The hand-written stylesheets carry the table's own reset,
// so Tailwind's Preflight is off (see tailwind.config.mjs) and its utilities
// are loaded last, where they can win against a class from styles.css.
import './assets/css/fonts.css';
import './assets/css/spread.css';
import './assets/css/styles.css';
import './assets/css/responsive.css';
import './assets/css/tailwind.css';

import { applyMotionClass, applyLiteClass } from './lib/motion.js';
import { initTooltips } from './lib/tooltip.js';
import { guardNumberFields } from './lib/invalid.js';

applyMotionClass();
applyLiteClass();
// Every icon-only control in the game, on every screen, says what it is on
// hover and on focus. One listener on the document, so it covers whatever a
// component draws later as well.
initTooltips();
// Whole-number fields take digits and nothing else, and wear their grouping
// as they are typed. Delegated from the body, so it covers every field any
// component mounts - see src/lib/invalid.js.
guardNumberFields(document.body);

// Belt-and-braces with the CSS user-select rules: block text selection (and
// double-click word selection) everywhere except inputs, error messages and
// the room code, so dragging chips or tapping the felt never highlights text.
const SELECTABLE = 'input, textarea, .selectable, .error-text';
document.addEventListener('selectstart', (e) => {
  const el = e.target instanceof Element ? e.target : e.target.parentElement;
  if (!el?.closest(SELECTABLE)) e.preventDefault();
});
document.addEventListener('mousedown', (e) => {
  if (e.detail > 1 && !e.target.closest(SELECTABLE)) e.preventDefault();
});

createApp(App).mount('#app');
