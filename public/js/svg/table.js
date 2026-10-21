// Inline SVG for the felt table, dealer button and turn-countdown ring.
// The table stretches to the camera's aspect ratio (landscape or portrait),
// so strokes use non-scaling-stroke to stay crisp.
export function tableFeltSVG() {
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="bbpRail" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#3a2219"/>
      <stop offset="100%" stop-color="#150b07"/>
    </radialGradient>
    <radialGradient id="bbpFelt" cx="50%" cy="45%" r="58%">
      <stop offset="0%" stop-color="#1c7f5b"/>
      <stop offset="60%" stop-color="#0f5c42"/>
      <stop offset="100%" stop-color="#073624"/>
    </radialGradient>
    <radialGradient id="bbpLight" cx="50%" cy="38%" r="45%">
      <stop offset="0%" stop-color="#fff" stop-opacity=".09"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="50" cy="50.8" rx="49.6" ry="49" fill="#000" opacity=".45"/>
  <ellipse cx="50" cy="50" rx="49.2" ry="48.4" fill="url(#bbpRail)"/>
  <ellipse cx="50" cy="50" rx="48.4" ry="47.4" fill="none" stroke="#5b3a28" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
  <ellipse cx="50" cy="50" rx="45.6" ry="42.6" fill="#03130d"/>
  <ellipse cx="50" cy="50" rx="45" ry="41.8" fill="url(#bbpFelt)"/>
  <ellipse cx="50" cy="50" rx="45" ry="41.8" fill="url(#bbpLight)"/>
  <ellipse cx="50" cy="50" rx="41" ry="37.6" fill="none" stroke="#e6b450" stroke-opacity=".22" stroke-width="1" stroke-dasharray="1 5" vector-effect="non-scaling-stroke"/>
</svg>`;
}

export function dealerButtonSVG() {
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-label="Dealer button" role="img">
  <circle cx="20" cy="21.5" r="18" fill="rgba(0,0,0,.35)"/>
  <circle cx="20" cy="20" r="18" fill="#f6f1e4"/>
  <circle cx="20" cy="20" r="14.5" fill="none" stroke="#b08a3e" stroke-width="1.2"/>
  <text x="20" y="25.5" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="16" font-weight="700" fill="#2a1d08">D</text>
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
