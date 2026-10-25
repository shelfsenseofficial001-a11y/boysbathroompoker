// Cards dealt out as an illustration: the 404's big figures, and the loose
// pile the room-not-found screen shows. Both are built from the game's own
// card faces and styled by css/spread.css, so the two screens are the same
// object in two moods rather than two drawings that have to be kept in step.
import { cardFaceSVG } from './cards.js';

// Deterministic scatter: the same page always lands the same way, so it never
// looks like it reshuffled itself on a reload.
const wobble = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5; // -0.5 .. 0.5
};

// A card, placed in card widths from its group's top-left.
function pip(face, x, y, rotate, delay) {
  const el = document.createElement('div');
  el.className = 'pip';
  el.style.setProperty('--x', `calc(var(--cw) * ${x.toFixed(3)})`);
  el.style.setProperty('--y', `calc(var(--cw) * ${y.toFixed(3)})`);
  el.style.setProperty('--r', `${rotate.toFixed(2)}deg`);
  el.style.setProperty('--d', `${delay}ms`);
  el.innerHTML = cardFaceSVG(face, { simple: true });
  return el;
}

function group(el, w, h) {
  const g = document.createElement('div');
  g.className = 'glyph';
  g.style.setProperty('--gw', String(w));
  g.style.setProperty('--gh', String(h));
  el.append(g);
  return g;
}

// --- Figures dealt out of cards ---------------------------------------------
// A digit is laid out as a little grid of cards, three across and five down,
// with every row overlapping the one above it - which is what a stack of cards
// actually looks like, and leaves each card showing its top corner, where the
// rank and suit are. Drawn as strokes of a seven-segment display first, with
// cards turned on their side for the bars, the strokes came out at different
// weights and the figures ran together into a muddle.
//
// Only the digits the 404 needs: three across can't tell a B from an 8 or an S
// from a 5, so this is no use for spelling anything that has to be read.
const GRID = {
  4: ['# #', '# #', '###', '  #', '  #'],
  0: ['###', '# #', '# #', '# #', '###'],
};

// In card widths. A card is 1 wide and 1.4 tall, so a row step of 0.812 leaves
// the top 58% of each card showing.
const COL_STEP = 0.92;
const ROW_STEP = 0.812;

// Which cards get dealt. The fours are built out of fours and the zero out of
// tens, because a hand that spells the number it makes is the kind of joke a
// card room would make.
const FACES = { 4: ['4s', '4h', '4d', '4c'], 0: ['Td', 'Ts', 'Th', 'Tc'] };

export function dealFigures(el, text) {
  let seq = 0;
  [...text].forEach((ch, index) => {
    const rows = GRID[ch];
    if (!rows) return;
    const g = group(el, 2.84, 4.65);
    const faces = FACES[ch];
    let face = 0;
    // Top row first, left to right, the order a dealer would put them down -
    // and the order that leaves each row overlapping the one above, since a
    // later card paints over an earlier one.
    rows.forEach((row, r) => {
      [...row].forEach((cell, c) => {
        if (cell !== '#') return;
        g.append(
          pip(
            faces[face++ % faces.length],
            0.5 + c * COL_STEP + wobble(seq) * 0.05,
            0.7 + r * ROW_STEP + wobble(seq + 99) * 0.05,
            wobble(seq + 7) * 7,
            60 + seq * 26
          )
        );
        seq++;
      });
    });
    // The middle figure sits a touch lower, the way a spread sags in the
    // middle when it is pushed across a table.
    if (index === 1) g.style.transform = 'translateY(3%)';
  });
}

// --- Depth ------------------------------------------------------------------
// The spread follows the pointer a little, so the cards read as lying on a
// surface with depth rather than printed on the page. Pointer only: there is
// nothing to steer it with on a touchscreen, and a page that lurches when
// scrolled is worse than a flat one.
export function followPointer(el) {
  if (!window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return;
  const onMove = (e) => {
    if (!el.isConnected) return window.removeEventListener('pointermove', onMove);
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    el.style.setProperty('--tilt-y', `${(x * 13).toFixed(2)}deg`);
    el.style.setProperty('--tilt-x', `${(-y * 9).toFixed(2)}deg`);
  };
  window.addEventListener('pointermove', onMove);
}
