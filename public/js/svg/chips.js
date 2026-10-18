// Inline SVG poker chips: top-down chips (tray, flying chips) and side-view
// stacks whose columns reflect a real denomination breakdown of an amount.
export const CHIP_DENOMINATIONS = [1, 5, 10, 25, 100, 500, 1000];

const STYLE = {
  1: { base: '#ece9e1', edge: '#2f6fb5', text: '#1d2a3a' },
  5: { base: '#c63d36', edge: '#ffffff', text: '#ffffff' },
  10: { base: '#2f6fb5', edge: '#ffffff', text: '#ffffff' },
  25: { base: '#2c8a57', edge: '#ffffff', text: '#ffffff' },
  100: { base: '#202329', edge: '#e6b450', text: '#f3d27c' },
  500: { base: '#6e46b8', edge: '#ffffff', text: '#ffffff' },
  1000: { base: '#d9a93b', edge: '#3b2a06', text: '#3b2a06' },
};

// Greedy split into the fewest chips, highest denomination first.
export function breakdown(amount) {
  const out = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of [...CHIP_DENOMINATIONS].reverse()) {
    const n = Math.floor(rest / d);
    if (n > 0) {
      out.push({ denom: d, count: n });
      rest -= n * d;
    }
  }
  return out;
}

function label(d) {
  return d >= 1000 ? `${d / 1000}K` : String(d);
}

export function chipSVG(denom) {
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
    for (let i = 0; i < n; i++) {
      const y = height - ry - 2 - i * chipH; // bottom-front edge of this chip
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
