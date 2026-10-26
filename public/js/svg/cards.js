// Inline SVG playing cards (all 52 faces + one back design). Suits are drawn
// as paths rather than font glyphs so they look identical on every platform
// (iOS would otherwise render the red suits as emoji).
const SUIT_PATH = {
  h: 'M5 9.4C5 9.4 0 6.1 0 3.1 0 1.3 1.3 0 3 0 3.9 0 4.6.5 5 1.3 5.4.5 6.1 0 7 0 8.7 0 10 1.3 10 3.1 10 6.1 5 9.4 5 9.4Z',
  d: 'M5 0 9 5 5 10 1 5Z',
  s: 'M5 0C5 0 0 3.7 0 6.1 0 7.6 1.2 8.6 2.5 8.6 3.4 8.6 4.1 8.1 4.5 7.5 4.4 8.7 4 9.4 3.1 10H6.9C6 9.4 5.6 8.7 5.5 7.5 5.9 8.1 6.6 8.6 7.5 8.6 8.8 8.6 10 7.6 10 6.1 10 3.7 5 0 5 0Z',
  c: 'M5 .2A2.3 2.3 0 1 1 5 4.8 2.3 2.3 0 0 1 5 .2ZM2.6 3.9A2.3 2.3 0 1 1 2.6 8.5 2.3 2.3 0 0 1 2.6 3.9ZM7.4 3.9A2.3 2.3 0 1 1 7.4 8.5 2.3 2.3 0 0 1 7.4 3.9ZM4.4 6H5.6C5.6 7.8 6 9 7 10H3C4 9 4.4 7.8 4.4 6Z',
};
const SUIT_COLOR = { s: '#1b1d22', c: '#1b1d22', h: '#c8302a', d: '#c8302a' };
const RANK_LABEL = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

function suit(s, x, y, size, color) {
  const k = size / 10;
  return `<path d="${SUIT_PATH[s]}" fill="${color}" transform="translate(${x} ${y}) scale(${k})"/>`;
}

const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

// `code` is like "As", "Td", "2c". `simple` draws the plain variant: one
// rank over one suit, with no corner indices and no pip layout. The pair
// sits in the top two thirds of the card rather than across its middle: a
// hand turned over at showdown is tucked behind its nameplate with only
// POD_REVEAL_SHOW of the card above it, and a suit set at the middle was
// covered by the plate. Everything the card says is inside that strip.
// Everyone plays off the same screen, so a card never has to be read from
// the far side of a table, and at small sizes this stays legible where the
// full face turns to mush.
export function cardFaceSVG(code, { simple = false, deck = null } = {}) {
  const r = code[0];
  const s = code[1];
  const color = suitColors(deck)[s];
  const rank = RANK_LABEL[r] || r;
  // The ten is the one rank that is two characters wide. Set in a smaller
  // type to make it fit, it read as a lesser card than the nine beside it;
  // it takes the same size as every other rank now and is squeezed to the
  // width of one instead, so a board reads at one weight. textLength sets
  // the width and lengthAdjust narrows the glyphs with the spacing, rather
  // than only closing the gap between them.
  const ten = rank === '10';
  const fit = (w) => (ten ? ` textLength="${w}" lengthAdjust="spacingAndGlyphs"` : '');
  const corner = `
    <text x="5" y="16.5" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="800" fill="${color}"${fit(13)}>${rank}</text>
    ${suit(s, 4.6, 20, 8, color)}`;

  if (simple) {
    const size = 36;
    return `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" aria-label="${rank} of ${SUIT_NAME[s]}" role="img">
  <rect x=".5" y=".5" width="59" height="83" rx="5.5" fill="#fbf8f1" stroke="#cfc6b4"/>
  <rect x="2" y="2" width="56" height="80" rx="4.5" fill="none" stroke="#fff" stroke-opacity=".7"/>
  <text x="30" y="34" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${size}" font-weight="800" fill="${color}"${fit(40)}>${rank}</text>
  ${suit(s, 19, 38, 22, color)}
</svg>`;
  }

  let center;
  if ('JQK'.includes(r)) {
    center = `
      <rect x="15" y="17" width="30" height="50" rx="3" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="1"/>
      <text x="30" y="47" text-anchor="middle" font-family="'Bodoni Moda', Didot, Georgia, serif" font-size="24" font-weight="700" fill="${color}">${rank}</text>
      ${suit(s, 25.5, 51, 9, color)}`;
  } else if (r === 'A') {
    center = suit(s, 17, 29, 26, color);
  } else {
    center = suit(s, 20, 32, 20, color);
  }

  return `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" aria-label="${rank} of ${SUIT_NAME[s]}" role="img">
  <rect x=".5" y=".5" width="59" height="83" rx="5.5" fill="#fbf8f1" stroke="#cfc6b4"/>
  <rect x="2" y="2" width="56" height="80" rx="4.5" fill="none" stroke="#fff" stroke-opacity=".7"/>
  ${corner}
  <g transform="rotate(180 30 42)">${corner}</g>
  ${center}
</svg>`;
}

let backCache = null;
export function cardBackSVG() {
  if (backCache) return backCache;
  let lattice = '';
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 6; col++) {
      const cx = 10 + col * 8 + (row % 2 ? 4 : 0);
      const cy = 10 + row * 8;
      if (cx > 52 || cy > 76) continue;
      lattice += `M${cx} ${cy - 3}l3 3-3 3-3-3z`;
    }
  }
  backCache = `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" aria-label="Card back" role="img">
  <rect x=".5" y=".5" width="59" height="83" rx="5.5" fill="#6d1a26" stroke="#3d0d14"/>
  <rect x="4" y="4" width="52" height="76" rx="3.5" fill="#7d2030" stroke="#e6b450" stroke-opacity=".75" stroke-width=".9"/>
  <path d="${lattice}" fill="none" stroke="#e6b450" stroke-opacity=".28" stroke-width=".7"/>
  <circle cx="30" cy="42" r="10.5" fill="#6d1a26" stroke="#e6b450" stroke-width="1"/>
  ${suit('s', 25.2, 37, 9.6, '#e6b450')}
</svg>`;
  return backCache;
}
