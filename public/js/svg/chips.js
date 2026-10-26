// Inline SVG poker chips: top-down chips (tray, flying chips) and side-view
// stacks whose columns reflect a real denomination breakdown of an amount.
// The seven chips a table deals out, chosen by its big blind. A room doesn't
// stock one ladder and hand out the bottom of it to everyone: it sets a tray
// for the level being played, starting at the half-blind piece and climbing
// to something that can carry a deep stack in a few pieces. Past 100K those
// pieces are plaques - the flat rectangular ones a real room reaches for once
// a chip would have to carry six figures.
export const CHIP_TIERS = [
  { bb: 20, chips: [10, 20, 50, 100, 250, 500, 1000] },
  { bb: 500, chips: [250, 500, 1000, 5000, 10000, 25000, 50000] },
  { bb: 1000, chips: [500, 1000, 5000, 10000, 50000, 100000, 500000] },
  { bb: 25000, chips: [12500, 25000, 50000, 100000, 250000, 500000, 1000000] },
  { bb: 100000, chips: [50000, 100000, 250000, 500000, 1000000, 2500000, 5000000] },
];
// How many pieces a tray holds - every tier is this wide, so the betting bar
// is the same shape at every level and nothing in it shifts between tables.
export const TRAY_SIZE = 7;
// Every piece that can appear in a stack on the felt: all the trays, plus the
// small change a table playing for pennies still needs. An amount is always
// broken down over the whole ladder, whatever tray is on offer - a pot of two
// and a half million reads as one plaque, not two thousand 1000-chips.
export const ALL_DENOMINATIONS = [...new Set([1, 5, 100, ...CHIP_TIERS.flatMap((t) => t.chips)])]
  .sort((a, b) => a - b);
// Rectangular, not round.
export const PLAQUES = new Set([100000, 250000, 500000, 1000000, 2500000, 5000000]);

// The tray for a table played at `bigBlind`. A blind that isn't one of the
// levels above takes the closest tier by ratio rather than by difference: a
// 2000 blind is twice the 1000 level and a twelfth of the 25000 one, so it
// plays with the 1000 tray. Blinds beyond either end take the end tier.
export function chipSet(bigBlind = 0) {
  const bb = Number(bigBlind) || 0;
  if (!(bb > 0)) return CHIP_TIERS[0].chips.slice();
  const off = (t) => Math.abs(Math.log(bb / t.bb));
  return CHIP_TIERS.reduce((best, t) => (off(t) < off(best) ? t : best)).chips.slice();
}

const STYLE = {
  1: { base: '#ece9e1', edge: '#2f6fb5', text: '#1d2a3a' },
  5: { base: '#c63d36', edge: '#ffffff', text: '#ffffff' },
  10: { base: '#2f6fb5', edge: '#ffffff', text: '#ffffff' },
  20: { base: '#e0c23a', edge: '#4a3a06', text: '#3b2a06' },
  25: { base: '#2c8a57', edge: '#ffffff', text: '#ffffff' },
  50: { base: '#d9742a', edge: '#ffe3c2', text: '#ffffff' },
  100: { base: '#202329', edge: '#e6b450', text: '#f3d27c' },
  250: { base: '#d1559a', edge: '#ffe2f1', text: '#ffffff' },
  500: { base: '#6e46b8', edge: '#ffffff', text: '#ffffff' },
  1000: { base: '#d9a93b', edge: '#3b2a06', text: '#3b2a06' },
  5000: { base: '#a8174e', edge: '#ffd3e2', text: '#ffffff' },
  10000: { base: '#0d7a6f', edge: '#a6f0e5', text: '#eafffb' },
  12500: { base: '#3a5fa8', edge: '#cfe0ff', text: '#eef4ff' },
  25000: { base: '#1f6b45', edge: '#bdf0d4', text: '#eafff3' },
  50000: { base: '#9c5a1b', edge: '#ffdcae', text: '#fff3e2' },
  100000: { base: '#f2ead6', edge: '#9a7b2a', text: '#3b2a06' },
  250000: { base: '#7d1f45', edge: '#f0b9d0', text: '#ffe7f1' },
  500000: { base: '#15171c', edge: '#cfd4dc', text: '#eef1f6' },
  1000000: { base: '#3b1038', edge: '#e7c67a', text: '#f7e3bb' },
  2500000: { base: '#1b1a52', edge: '#9fb0ef', text: '#e4e9ff' },
  5000000: { base: '#4a0f1c', edge: '#e8b08a', text: '#ffd9c4' },
};

// Greedy split into the fewest chips, highest denomination first.
export function breakdown(amount) {
  const out = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of [...ALL_DENOMINATIONS].reverse()) {
    const n = Math.floor(rest / d);
    if (n > 0) {
      out.push({ denom: d, count: n });
      rest -= n * d;
    }
  }
  return out;
}

// What a chip has printed on it: 500, 12.5K, 2.5M. Kept to one decimal, so
// an odd amount never prints a number too long to fit on the face.
export function formatChipLabel(value) {
  const v = Math.abs(Number(value) || 0);
  const round = (n) => String(Math.round(n * 10) / 10);
  if (v >= 1e6) return `${round(v / 1e6)}M`;
  return v >= 1000 ? `${round(v / 1000)}K` : String(v);
}

// A plaque: the same 48x48 box every chip is drawn in, so it drops into the
// tray, the drag ghost and the flying-chip layer without any of them having
// to know it is a different shape.
function plaqueSVG(denom) {
  const s = STYLE[denom] || STYLE[1000];
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <rect x="1.5" y="14.6" width="45" height="21" rx="2.6" fill="rgba(0,0,0,.35)"/>
  <rect x="1.5" y="13" width="45" height="21" rx="2.6" fill="${s.base}"/>
  <rect x="3.6" y="15.1" width="40.8" height="16.8" rx="1.6" fill="none" stroke="${s.edge}" stroke-width="1.1" opacity=".9"/>
  <rect x="1.5" y="13" width="45" height="21" rx="2.6" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1"/>
  <text x="24" y="27.4" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="800" fill="${s.text}">${formatChipLabel(denom)}</text>
</svg>`;
}

// Text on a round face has about 26 units of clear middle to sit in, so a
// long label (12.5K, 2.5M) steps down rather than running over the rim.
function faceSize(text) {
  if (text.length >= 5) return 8.6;
  if (text.length === 4) return 10;
  return text.length === 3 ? 11 : 12.5;
}

export function chipSVG(denom) {
  if (PLAQUES.has(denom)) return plaqueSVG(denom);
  const s = STYLE[denom] || STYLE[1];
  let inserts = '';
  for (let i = 0; i < 8; i++) {
    inserts += `<rect x="21.8" y="2" width="4.4" height="6.5" rx="1" fill="${s.edge}" transform="rotate(${i * 45} 24 24)"/>`;
  }
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <circle cx="24" cy="25.6" r="22" fill="rgba(0,0,0,.35)"/>
  <circle cx="24" cy="24" r="22" fill="${s.base}"/>
  ${inserts}
  <circle cx="24" cy="24" r="15.6" fill="none" stroke="${s.edge}" stroke-width="1.1" stroke-dasharray="2.2 2.2" opacity=".85"/>
  <circle cx="24" cy="24" r="13.2" fill="${s.base}" stroke="rgba(0,0,0,.22)" stroke-width="1"/>
  <circle cx="24" cy="24" r="21.5" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1"/>
  <text x="24" y="28.3" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${faceSize(formatChipLabel(denom))}" font-weight="800" fill="${s.text}">${formatChipLabel(denom)}</text>
</svg>`;
}

// Side-view stack: one column per denomination (largest first), each column
// capped visually at `maxPerCol` chips so big stacks stay compact.
export function chipStackSVG(amount, { maxCols = 3, maxPerCol = 7 } = {}) {
  const cols = breakdown(amount).slice(0, maxCols);
  if (!cols.length) return '';
  const colW = 22;
  const chipH = 3.6;
  const rx = 10;
  const ry = 3.4;
  const width = cols.length * colW + 2;
  const height = maxPerCol * chipH + ry * 2 + 4;
  let body = '';
  cols.forEach((c, ci) => {
    const s = STYLE[c.denom];
    const cx = 1 + ci * colW + colW / 2;
    const n = Math.min(c.count, maxPerCol);
    const slab = PLAQUES.has(c.denom);
    for (let i = 0; i < n; i++) {
      const y = height - ry - 2 - i * chipH; // bottom-front edge of this chip
      if (slab) {
        // Flat front and a flat top face: a plaque lies in the stack as a
        // slab, with none of a chip's rounded rim.
        body += `<rect x="${cx - rx}" y="${y - chipH}" width="${rx * 2}" height="${chipH}" fill="${s.base}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/>`;
        body += `<path d="M${cx - rx + 2} ${y - chipH + chipH / 2}h${rx * 2 - 4}" stroke="${s.edge}" stroke-width=".9" opacity=".75"/>`;
        if (i === n - 1) {
          body += `<rect x="${cx - rx}" y="${y - chipH - ry}" width="${rx * 2}" height="${ry}" fill="${s.base}" stroke="${s.edge}" stroke-width=".7"/>`;
        }
        continue;
      }
      body += `<path d="M${cx - rx} ${y - chipH} v${chipH} a${rx} ${ry} 0 0 0 ${rx * 2} 0 v${-chipH}z" fill="${s.base}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/>`;
      const mid = y - chipH / 2 + ry * 0.9;
      body += `<path d="M${cx - 6.5} ${mid - 1.1}v2.2M${cx} ${mid - 1.1}v2.2M${cx + 6.5} ${mid - 1.1}v2.2" stroke="${s.edge}" stroke-width="1.8" opacity=".9"/>`;
      if (i === n - 1) {
        body += `<ellipse cx="${cx}" cy="${y - chipH}" rx="${rx}" ry="${ry}" fill="${s.base}" stroke="${s.edge}" stroke-width=".9" stroke-dasharray="2 2.3"/>`;
        body += `<ellipse cx="${cx}" cy="${y - chipH}" rx="${rx * 0.55}" ry="${ry * 0.55}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".6"/>`;
      }
    }
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width * 1.6}" height="${height * 1.6}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">${body}</svg>`;
}
