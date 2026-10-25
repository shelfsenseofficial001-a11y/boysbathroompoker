// Inline SVG poker chips: top-down chips (tray, flying chips) and side-view
// stacks whose columns reflect a real denomination breakdown of an amount.
// The chips a table keeps in its tray. Small stakes need nothing above a
// 1000; a game played in millions cannot be stacked out of them. So bigger
// money brings bigger pieces in, and past 100K they are plaques - the flat
// rectangular pieces a real room reaches for once a chip would have to carry
// six figures.
export const CHIP_DENOMINATIONS = [1, 5, 10, 25, 100, 500, 1000];
// Added as the money at the table grows. `over` is read against the largest
// figure in play - the deepest stack, the pot, the biggest bet - so a table
// gains its big chips when someone could actually put one in.
const CHIP_TIERS = [
  { over: 10e3, inclusive: false, add: [5000, 10000] },
  { over: 100e3, inclusive: false, add: [50000, 100000] },
  { over: 1e6, inclusive: true, add: [500000] },
];
// Every denomination that exists, biggest last. An amount is always broken
// down over the whole ladder, whatever the tray is currently offering: a pot
// of two million reads as four plaques, not two thousand 1000-chips.
export const ALL_DENOMINATIONS = [...CHIP_DENOMINATIONS, ...CHIP_TIERS.flatMap((t) => t.add)];
// Rectangular, not round.
export const PLAQUES = new Set([100000, 500000]);

// The tray for a table whose largest figure in play is `scale`.
export function chipSet(scale = 0) {
  const v = Number(scale) || 0;
  const out = [...CHIP_DENOMINATIONS];
  for (const t of CHIP_TIERS) {
    if (t.inclusive ? v >= t.over : v > t.over) out.push(...t.add);
  }
  return out;
}

const STYLE = {
  1: { base: '#ece9e1', edge: '#2f6fb5', text: '#1d2a3a' },
  5: { base: '#c63d36', edge: '#ffffff', text: '#ffffff' },
  10: { base: '#2f6fb5', edge: '#ffffff', text: '#ffffff' },
  25: { base: '#2c8a57', edge: '#ffffff', text: '#ffffff' },
  100: { base: '#202329', edge: '#e6b450', text: '#f3d27c' },
  500: { base: '#6e46b8', edge: '#ffffff', text: '#ffffff' },
  1000: { base: '#d9a93b', edge: '#3b2a06', text: '#3b2a06' },
  5000: { base: '#a8174e', edge: '#ffd3e2', text: '#ffffff' },
  10000: { base: '#0d7a6f', edge: '#a6f0e5', text: '#eafffb' },
  50000: { base: '#9c5a1b', edge: '#ffdcae', text: '#fff3e2' },
  100000: { base: '#f2ead6', edge: '#9a7b2a', text: '#3b2a06' },
  500000: { base: '#15171c', edge: '#cfd4dc', text: '#eef1f6' },
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

function label(d) {
  if (d >= 1e6) return `${d / 1e6}M`;
  return d >= 1000 ? `${d / 1000}K` : String(d);
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
  <text x="24" y="27.4" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="800" fill="${s.text}">${label(denom)}</text>
</svg>`;
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
  <text x="24" y="28.3" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${denom >= 100 ? 11 : 12.5}" font-weight="800" fill="${s.text}">${label(denom)}</text>
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
