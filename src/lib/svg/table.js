// Inline SVG for the felt table, dealer button and turn-countdown ring.
// The table stretches to the camera's aspect ratio (landscape or portrait),
// so strokes use non-scaling-stroke to stay crisp.
// The house mark printed in the middle of the felt, in the manner of a team
// crest: a heavy slanted wordmark with a varsity double outline, stars over
// it and a banner under. It's its own SVG with its own proportions - the felt
// above stretches to fit the table, and this would stretch with it.
export function feltLogoSVG(ink = 'light') {
  // Pale on a dark cloth, dark on a white or gold one: the same mark printed
  // in whichever colour the felt can actually show.
  const c = ink === 'dark'
    ? { fill: '#2e2616', edge: '#8a6a20', rule: '#8a6a20', star: '#8a6a20', banner: '#8a6a20', bannerFold: '#5d4612', bannerInk: '#fdf6e2' }
    : { fill: '#fbf3dc', edge: '#e6b450', rule: '#e6b450', star: '#f7d58a', banner: '#e6b450', bannerFold: '#9c7424', bannerInk: '#05140d' };
  // Paint order puts each stroke behind its own fill, which is what gives
  // lettering the cut-out, stitched-on look of a jersey.
  const word = (dy, fill, stroke, width) =>
    `<text x="200" y="${108 + dy}" text-anchor="middle" font-family="Inter, system-ui, sans-serif"
      font-weight="800" font-size="62" letter-spacing="3" fill="${fill}" stroke="${stroke}"
      stroke-width="${width}" stroke-linejoin="round" paint-order="stroke">CCPOKER</text>`;
  const star = (x, y, r) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      pts.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${c.star}"/>`;
  };
  return `<svg viewBox="0 0 400 190" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  ${star(150, 30, 9)}${star(200, 22, 12)}${star(250, 30, 9)}
  <g transform="skewX(-11) translate(19 0)">
    ${word(0, 'none', ink === 'dark' ? '#fdf6e2' : '#05140d', 15)}
    ${word(0, c.fill, c.edge, 6)}
  </g>
  <path d="M84 120 L316 120" stroke="${c.rule}" stroke-width="3" stroke-linecap="round"/>
  <path d="M100 130 L300 130" stroke="${c.rule}" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>
  <g>
    <path d="M118 140 H282 L292 154 L282 168 H118 L108 154 Z" fill="${c.banner}"/>
    <path d="M108 154 L96 146 V162 Z M292 154 L304 146 V162 Z" fill="${c.bannerFold}"/>
    <text x="200" y="159" text-anchor="middle" font-family="Inter, system-ui, sans-serif"
      font-weight="800" font-size="13" letter-spacing="4.5" fill="${c.bannerInk}">TEXAS HOLD'EM</text>
  </g>
</svg>`;
}

export function dealerButtonSVG() {
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-label="Dealer button" role="img">
  <circle cx="20" cy="21.5" r="18" fill="rgba(0,0,0,.35)"/>
  <circle cx="20" cy="20" r="18" fill="#f6f1e4"/>
  <circle cx="20" cy="20" r="14.5" fill="none" stroke="#b08a3e" stroke-width="1.2"/>
  <text x="20" y="25.5" text-anchor="middle" font-family="'Bodoni Moda', Didot, Georgia, serif" font-size="16" font-weight="700" fill="#2a1d08">D</text>
</svg>`;
}

// Countdown ring drawn around the acting player's avatar: full at the start
// of their turn, empty when it runs out. The unwind is a CSS animation, and
// a negative delay starts it partway through for anyone who arrives late.
export function turnRingSVG(totalMs, elapsedMs) {
  return `<svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
  <circle class="ring-track" cx="20" cy="20" r="18.5" pathLength="100"/>
  <circle class="ring-bar" cx="20" cy="20" r="18.5" pathLength="100" style="--ring-ms:${totalMs}ms;animation-duration:${totalMs}ms;animation-delay:-${Math.max(0, elapsedMs)}ms"/>
</svg>`;
}
