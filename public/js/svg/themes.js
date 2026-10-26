// The look of the table: what the felt is made of and what's printed on the
// back of the cards. Both are chosen per player in Table settings and kept in
// this browser, so two people at one table can each have the cloth they like.
//
// Everything is drawn rather than loaded: no image requests, and a card back
// is one small SVG that scales from a thumbnail in the picker to a card held
// up to the camera. Patterns are built as a single path wherever they can be
// — a back is on screen a dozen times at once, so one path beats a dozen
// <pattern> definitions.

// Deterministic, so a pattern is identical every time it's drawn. Math.random
// would reshuffle the stars on every redraw of a card back.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// --- Felts -----------------------------------------------------------------
// Plain cloth, ten colours - the rail, the baize, the dark lip the baize is
// let into and the dashed betting line, and nothing printed on top. `edge` is
// that lip: it has to be a shade of the cloth above it, or it reads as a ring
// in some other colour drawn around the felt. `logo` says which way the house mark in the
// middle has to be inked: a pale mark disappears into a white or gold cloth, a
// dark one into a black felt. The ids outlive the names, since they are what
// sits in a player's saved settings.
export const FELTS = [
  { id: 'green', name: 'Emerald', logo: 'light', rail: ['#3a2219', '#150b07'], railLine: '#5b3a28', felt: ['#1c7f5b', '#0f5c42', '#073624'], edge: '#03130d', line: '#e6b450' },
  { id: 'red', name: 'Crimson', logo: 'light', rail: ['#3a1a19', '#160807'], railLine: '#5e3028', felt: ['#a8302e', '#7d1f20', '#44100f'], edge: '#1e0706', line: '#e6b450' },
  { id: 'blue', name: 'Sapphire', logo: 'light', rail: ['#1b2838', '#080d14'], railLine: '#2f4860', felt: ['#1f6aa8', '#154a7a', '#0a2742'], edge: '#040f1b', line: '#cfe0f5' },
  { id: 'gray', name: 'Slate', logo: 'light', rail: ['#2b2e34', '#101214'], railLine: '#484d56', felt: ['#71787f', '#4e545b', '#2b2f34'], edge: '#121417', line: '#dbe0e6' },
  { id: 'polka', name: 'Onyx', logo: 'light', rail: ['#232323', '#0a0a0a'], railLine: '#3d3d3d', felt: ['#1a1a1a', '#101010', '#050505'], edge: '#000000', line: '#ffffff' },
  { id: 'midnight', name: 'Midnight', logo: 'light', rail: ['#1b2141', '#07090f'], railLine: '#333d68', felt: ['#1c2a5e', '#121a3d', '#070a18'], edge: '#03040a', line: '#9db4ff' },
  { id: 'sakura', name: 'Sakura', logo: 'dark', rail: ['#4a2630', '#1d0e13'], railLine: '#71414e', felt: ['#efa8bd', '#dd8098', '#b05570'], edge: '#4a2029', line: '#fff0f4' },
  { id: 'gold', name: 'Bullion', logo: 'dark', rail: ['#3d2c0c', '#160f03'], railLine: '#6b501a', felt: ['#e3c56a', '#b58f2a', '#6d4f12'], edge: '#2e2007', line: '#ffeab0' },
  { id: 'lines', name: 'Ivory', logo: 'dark', rail: ['#2a2a2a', '#0d0d0d'], railLine: '#4a4a4a', felt: ['#f4efe6', '#e5ded0', '#c9c0ae'], edge: '#6f6a5c', line: '#2a2a2a' },
  { id: 'carbon', name: 'Carbon', logo: 'light', rail: ['#232427', '#0a0a0b'], railLine: '#3e4044', felt: ['#1f2023', '#151618', '#0b0b0c'], edge: '#050505', line: '#9aa0a8' },
];

// Every call gets its own id prefix. The table's cloth and the swatch for the
// same cloth are on screen together in the settings sheet, and two elements
// sharing an id means url(#...) resolves to whichever came first - one of the
// two then borrows the other's gradients and clip.
let feltSeq = 0;

// A real poker table is a stadium: a straight run down each side closed off by
// a true semicircle at either end, not an ellipse. An ellipse has no straight
// edge at all, so seats along the sides sat on a curve and the middle of the
// cloth bulged. Portrait is the same table stood on its end.
//
// Drawing one means the SVG has to know the shape of the box it's going into.
// The old felt was ellipses on a square viewBox stretched to fit, which an
// ellipse survives and a semicircle does not - stretched, a round end turns
// back into an elliptical one. So the viewBox is cut to the same aspect as the
// element, and `preserveAspectRatio="none"` then scales both axes equally and
// the ends stay round. `aspect` is width / height; the table is 1.9 across in
// landscape and 0.68 in portrait, and a swatch is its own shape again.
export function feltSVG(id = 'green', aspect = 1.9) {
  const t = FELTS.find((f) => f.id === id) || FELTS[0];
  const u = `ft${t.id}${(feltSeq = (feltSeq + 1) % 1e6)}`;
  // Height is fixed at 100 and width follows the aspect, so the viewBox is cut
  // to the same shape as the element it goes into and nothing is stretched.
  const a = Math.max(0.2, Math.min(5, Number(aspect) || 1.9));
  const W = 100 * a;
  // The table is a stadium in both orientations: a straight run down each long
  // side closed off by a true semicircle at either end. Portrait is the same
  // table stood on its end, so its straight runs are the two sides rather than
  // the top and bottom.
  //
  // The outer edge of the cushion, and how thick the cushion is. Thickness is
  // one figure for all four sides, in viewBox units, because the viewBox is
  // now cut to the element's shape: stated per axis, as it used to be, a tall
  // table came out with side rails less than half the depth of its top.
  const RW = 49.2;
  const RH = 48.4;
  const T = 5.2;
  // A ring of the table, inset from the cushion's outer edge by `t` units on
  // every side. The corner radius is whichever half-dimension is smaller,
  // which is what turns the short ends into semicircles rather than corners.
  const ring = (t, attrs, dy = 0) => {
    const hw = RW * a - t;
    const hh = RH - t;
    const r = Math.min(hw, hh);
    return `<rect x="${(W / 2 - hw).toFixed(2)}" y="${(50 + dy - hh).toFixed(2)}"
      width="${(hw * 2).toFixed(2)}" height="${(hh * 2).toFixed(2)}"
      rx="${r.toFixed(2)}" ry="${r.toFixed(2)}" ${attrs}/>`;
  };
  // Where the straight run of the cushion is, and how long it is: the long
  // side's length less the rounded cap at either end.
  const tall = RH > RW * a;
  // Less the clearance that leaves plain cushion beyond each bracket. A tall
  // table's straight run is the shorter of the two - its ends are capped by a
  // semicircle as wide as the whole table - so the clearance is trimmed to fit
  // rather than swallowing the run whole.
  const straight = Math.max(0, (tall ? RH : RW * a) - Math.min(RW * a, RH));
  const run = straight - Math.min(6, straight * 0.3);

  // Light falls from above and a little in front, the way it does over a real
  // table: the near side of the cushion is lit, the far side is in its own
  // shadow, and the cloth sits below the rail rather than flush with it.
  //
  // The shape is a stadium, not a circle, so none of this can be a
  // radial gradient - a radial drawn on a long table pools in the middle and
  // leaves the ends flat. Everything that has to follow the edge is a stroke
  // on the edge itself: blurred to soften it and clipped to one side, so the
  // half that would spill over the edge is cut away and the half that reads as
  // depth stays.
  // The panel worked into the straight run of the rail, where a player leans:
  // a darker inlay with a bracket at each end and a few studs inside them. The
  // metalwork is the cloth's bright accent, the same colour its betting line
  // is drawn in: in the rail's own brown it was dark on dark and read as a
  // smudge at any size.
  //
  // Built lying down and then turned to suit the table: on a wide one the
  // straight runs are the top and bottom, on a tall one they are the sides.
  const railPanel = () => {
    if (run < 6) return ''; // too short to inlay; it would read as a smudge
    // The studs need a stretch of inlay to sit in. On a short run the brackets
    // alone carry it: squeezed in, the two clusters met in the middle.
    const roomy = run >= 18;
    const half = 1.9; // the inlay's own half-depth, inside a cushion T deep
    const bracket = (x, dir) => `
      <path d="M${(x + dir * 5.2).toFixed(2)} ${-half}
               q${(-dir * 3.6).toFixed(2)} 0 ${(-dir * 4.4).toFixed(2)} ${half}
               q${(dir * 0.8).toFixed(2)} ${half} ${(dir * 4.4).toFixed(2)} ${half}"
            fill="none" stroke="${t.line}" stroke-opacity=".72" stroke-width="0.7"
            stroke-linecap="round"/>`;
    const stud = (x, y, r) =>
      `<path d="M${x.toFixed(2)} ${(y - r * 1.25).toFixed(2)} L${(x + r).toFixed(2)} ${y.toFixed(2)} L${x.toFixed(2)} ${(y + r * 1.25).toFixed(2)} L${(x - r).toFixed(2)} ${y.toFixed(2)}Z" fill="${t.line}" fill-opacity=".62"/>`;
    // Clustered inside each bracket rather than marching the whole way along:
    // spread out they turned the rail into a ruler.
    const studs = (x, dir) => stud(x + dir * 8.4, -1.05, 0.8) + stud(x + dir * 8.4, 1.05, 0.8) + stud(x + dir * 11, 0, 0.8);
    const inlay = `
      <rect x="${(-run).toFixed(2)}" y="${-half}" width="${(run * 2).toFixed(2)}" height="${(half * 2).toFixed(2)}"
        rx="${(half * 0.5).toFixed(2)}" fill="url(#${u}Inlay)" stroke="${t.line}" stroke-opacity=".22"
        stroke-width="1" vector-effect="non-scaling-stroke"/>
      ${bracket(-run, 1)}${bracket(run, -1)}
      ${roomy ? studs(-run, 1) + studs(run, -1) : ''}`;
    // One for each long side, each sitting in the middle of its own cushion.
    const mid = T / 2;
    return tall
      ? `<g transform="translate(${(W / 2 - RW * a + mid).toFixed(2)} 50) rotate(90)">${inlay}</g>
         <g transform="translate(${(W / 2 + RW * a - mid).toFixed(2)} 50) rotate(90)">${inlay}</g>`
      : `<g transform="translate(${(W / 2).toFixed(2)} ${(50 - RH + mid).toFixed(2)})">${inlay}</g>
         <g transform="translate(${(W / 2).toFixed(2)} ${(50 + RH - mid).toFixed(2)})">${inlay}</g>`;
  };

  const soften = (id, px) =>
    `<filter id="${id}" x="-12%" y="-12%" width="124%" height="124%">
      <feGaussianBlur stdDeviation="${px}"/>
    </filter>`;
  return `<svg viewBox="0 0 ${W.toFixed(2)} 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="${u}Rail" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="${t.rail[0]}"/>
      <stop offset="100%" stop-color="${t.rail[1]}"/>
    </radialGradient>
    <radialGradient id="${u}Felt" cx="50%" cy="45%" r="58%">
      <stop offset="0%" stop-color="${t.felt[0]}"/>
      <stop offset="60%" stop-color="${t.felt[1]}"/>
      <stop offset="100%" stop-color="${t.felt[2]}"/>
    </radialGradient>
    <radialGradient id="${u}Light" cx="50%" cy="38%" r="45%">
      <stop offset="0%" stop-color="#fff" stop-opacity=".09"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <!-- The sheen along the top of the padded rail, gone by halfway down. -->
    <linearGradient id="${u}Sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff" stop-opacity=".22"/>
      <stop offset="14%" stop-color="#fff" stop-opacity=".11"/>
      <stop offset="42%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="78%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#fff" stop-opacity=".10"/>
    </linearGradient>
    <!-- The inlay is sunk into the cushion, so it is darkest at its own top
         edge and catches a little light at the bottom. -->
    <linearGradient id="${u}Inlay" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity=".66"/>
      <stop offset="34%" stop-color="#000" stop-opacity=".34"/>
      <stop offset="72%" stop-color="${t.railLine}" stop-opacity=".3"/>
      <stop offset="100%" stop-color="#fff" stop-opacity=".14"/>
    </linearGradient>
    <!-- The cloth is darkest where the rail overhangs it, which is the top. -->
    <linearGradient id="${u}Well" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity=".7"/>
      <stop offset="55%" stop-color="#000" stop-opacity=".46"/>
      <stop offset="100%" stop-color="#000" stop-opacity=".34"/>
    </linearGradient>
    ${soften(`${u}b1`, 1.7)}
    ${soften(`${u}b2`, 0.6)}
    <clipPath id="${u}cFelt">${ring(T, '')}</clipPath>
    <clipPath id="${u}cRail">${ring(0, '')}</clipPath>
  </defs>
  ${ring(-0.4, 'fill="#000" opacity=".45"', 0.8)}
  ${ring(0, `fill="url(#${u}Rail)"`)}
  <!-- Rail, lit: the sheen clipped to the rail's own silhouette so it reads as
       a rounded cushion catching the light rather than an outline drawn on. -->
  <g clip-path="url(#${u}cRail)">
    ${railPanel()}
    ${ring(0, `fill="none" stroke="url(#${u}Sheen)" stroke-width="2.6"`)}
    <!-- The cloth's own colour bouncing up onto the inside of the cushion. The
         felt is painted over its inner half a few lines down, leaving the half
         that lands on the rail. -->
    <g filter="url(#${u}b2)">
      ${ring(T - 1.4, `fill="none" stroke="${t.felt[0]}" stroke-opacity=".5" stroke-width="1.6"`)}
    </g>
  </g>
  <!-- The trim worked into the cushion, a hint rather than an outline: at full
       strength it drew a wire round the whole table and flattened it again. -->
  ${ring(1, `fill="none" stroke="${t.railLine}" stroke-opacity=".45" stroke-width="1.2" vector-effect="non-scaling-stroke"`)}
  ${ring(T - 0.7, `fill="${t.edge}"`)}
  ${ring(T, `fill="url(#${u}Felt)"`)}
  <!-- Cloth, sunk: the shadow the rail casts onto it, hugging the edge all the
       way round and deepest under the overhang at the top. -->
  <g clip-path="url(#${u}cFelt)">
    <g filter="url(#${u}b1)">
      ${ring(T, `fill="none" stroke="url(#${u}Well)" stroke-width="4.2"`)}
    </g>
    <g filter="url(#${u}b2)">
      ${ring(T, `fill="none" stroke="url(#${u}Well)" stroke-width="1.8"`)}
    </g>
  </g>
  ${ring(T, `fill="url(#${u}Light)"`)}
  <!-- The seam pressed into the cloth a little in from the rail, and the
       dashed line the bets are pushed over. -->
  ${ring(T + 2.4, `fill="none" stroke="#fff" stroke-opacity=".05" stroke-width="1" vector-effect="non-scaling-stroke"`)}
  ${ring(T + 4.6, `fill="none" stroke="${t.line}" stroke-opacity=".22" stroke-width="1" stroke-dasharray="1 5" vector-effect="non-scaling-stroke"`)}
</svg>`;
}

export const feltTheme = (id) => FELTS.find((f) => f.id === id) || FELTS[0];

// --- Suit colours ----------------------------------------------------------
// A two-colour deck is what a real one looks like; a four-colour deck is what
// a lot of online players read faster, since a suit can be told from the
// colour alone without looking at the pip. The faces themselves are drawn in
// svg/cards.js, which holds the two palettes.
export const DECKS = [
  { id: 'two', name: 'Two colours' },
  { id: 'four', name: 'Four colours' },
];

// --- Card backs ------------------------------------------------------------
export const BACKS = [
  { id: 'classic', name: 'Classic' },
  { id: 'devil', name: 'Devil' },
  { id: 'serpent', name: 'Serpent' },
  { id: 'summit', name: 'Summit' },
  { id: 'polka', name: 'Polka' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'sakura', name: 'Sakura' },
  { id: 'gold', name: 'Bullion' },
  { id: 'lines', name: 'Atelier' },
  { id: 'carbon', name: 'Carbon' },
];

const SPADE =
  'M5 0C5 0 0 3.7 0 6.1 0 7.6 1.2 8.6 2.5 8.6 3.4 8.6 4.1 8.1 4.5 7.5 4.4 8.7 4 9.4 3.1 10H6.9C6 9.4 5.6 8.7 5.5 7.5 5.9 8.1 6.6 8.6 7.5 8.6 8.8 8.6 10 7.6 10 6.1 10 3.7 5 0 5 0Z';

// The frame every back shares: the card's edge, an inset panel and a rule
// around it. Only what's printed inside changes.
function backFrame(edge, border, panel, rule, inner) {
  return `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" aria-label="Card back" role="img">
  <rect x=".5" y=".5" width="59" height="83" rx="5.5" fill="${edge}" stroke="${border}"/>
  <rect x="4" y="4" width="52" height="76" rx="3.5" fill="${panel}" stroke="${rule}" stroke-opacity=".75" stroke-width=".9"/>
  ${inner}
</svg>`;
}

function latticePath() {
  let d = '';
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 6; col++) {
      const cx = 10 + col * 8 + (row % 2 ? 4 : 0);
      const cy = 10 + row * 8;
      if (cx > 52 || cy > 76) continue;
      d += `M${cx} ${cy - 3}l3 3-3 3-3-3z`;
    }
  }
  return d;
}

// A run of short diagonals in both directions: carbon weave, at card scale.
function weavePaths() {
  let a = '';
  let b = '';
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 14; col++) {
      const x = 4 + col * 4;
      const y = 4 + row * 4;
      if (x > 54 || y > 78) continue;
      if ((row + col) % 2) a += `M${x} ${y + 3}l3 -3`;
      else b += `M${x} ${y}l3 3`;
    }
  }
  return { a, b };
}

const BACK_ART = {
  classic: () =>
    backFrame(
      '#6d1a26',
      '#3d0d14',
      '#7d2030',
      '#e6b450',
      `<path d="${latticePath()}" fill="none" stroke="#e6b450" stroke-opacity=".28" stroke-width=".7"/>
       <circle cx="30" cy="42" r="10.5" fill="#6d1a26" stroke="#e6b450" stroke-width="1"/>
       <path d="${SPADE}" fill="#e6b450" transform="translate(25.2 37) scale(.96)"/>`
    ),

  devil: () =>
    backFrame(
      '#2a0608',
      '#140204',
      '#4a0b10',
      '#ff5a4a',
      `<path d="${latticePath()}" fill="none" stroke="#ff5a4a" stroke-opacity=".18" stroke-width=".7"/>
       <circle cx="30" cy="42" r="12" fill="#1d0406" stroke="#ff5a4a" stroke-width="1"/>
       <!-- Horns over a trident: the devil's own hand. -->
       <path d="M22.5 34.5c-1.6-2.4-1.4-4.6-.4-6.3.8 2.2 2.3 3.4 4.2 4.1zM37.5 34.5c1.6-2.4 1.4-4.6.4-6.3-.8 2.2-2.3 3.4-4.2 4.1z" fill="#ff5a4a"/>
       <path d="M30 35.5v13M24.5 38.5v3.5M35.5 38.5v3.5" stroke="#ff5a4a" stroke-width="1.6" stroke-linecap="round"/>
       <path d="M24.5 42q5.5 5 11 0" fill="none" stroke="#ff5a4a" stroke-width="1.6" stroke-linecap="round"/>
       <path d="M27.6 49.5h4.8l-2.4 3z" fill="#ff5a4a"/>`
    ),

  serpent: () =>
    backFrame(
      '#06281f',
      '#021310',
      '#0b3a2c',
      '#49d49a',
      `<path d="${latticePath()}" fill="none" stroke="#49d49a" stroke-opacity=".16" stroke-width=".7"/>
       <circle cx="30" cy="42" r="12.5" fill="#06281f" stroke="#49d49a" stroke-width="1"/>
       <!-- A coiled snake: body winding up to a head with a forked tongue. -->
       <path d="M23 51c5-1.5 3-5.5-1-6.5s-1-5.5 4-5.5 7-2 6-4.5" fill="none" stroke="#49d49a"
         stroke-width="2.1" stroke-linecap="round"/>
       <path d="M31.4 33.6a2.3 2.3 0 1 1 1.6 4 2.3 2.3 0 0 1-1.6-4z" fill="#49d49a"/>
       <path d="M34.5 35.6l3.4-1.2m-3.4 1.8 3.4 1" stroke="#49d49a" stroke-width=".8" stroke-linecap="round"/>
       <circle cx="32.6" cy="35.2" r=".55" fill="#06281f"/>`
    ),

  summit: () =>
    backFrame(
      '#2b2f35',
      '#121417',
      '#3b4149',
      '#cfd6de',
      `<!-- Ranges stacked back to front, the far ones paler, with a snow line. -->
       <path d="M4 58 18 40l9 11 7-9 18 20v9.5a3.5 3.5 0 0 1-3.5 3.5h-41A3.5 3.5 0 0 1 4 71.5z" fill="#596371"/>
       <path d="M18 40l5.6 6.8-5.6 2.4-4-2z" fill="#eef2f7"/>
       <path d="M34 42l4.4 4.9-4.4 1.9-3.2-1.6z" fill="#eef2f7"/>
       <path d="M4 66 16 54l8 8 10-11 22 20v2.5a3.5 3.5 0 0 1-3.5 3.5h-41A3.5 3.5 0 0 1 4 73.5z" fill="#2f353d"/>
       <circle cx="42" cy="24" r="6" fill="#cfd6de" opacity=".55"/>
       <path d="M8 28h16M8 32h11" stroke="#cfd6de" stroke-opacity=".3" stroke-width="1" stroke-linecap="round"/>`
    ),

  polka: () => {
    let d = '';
    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 8; col++) {
        const cx = 7 + col * 6.4 + (row % 2 ? 3.2 : 0);
        const cy = 8 + row * 6.6;
        if (cx > 53 || cy > 76) continue;
        d += `M${cx} ${cy}a1.7 1.7 0 1 0 .01 0z`;
      }
    }
    return backFrame('#3a3f46', '#17191c', '#4b525a', '#f2f5f8', `<path d="${d}" fill="#fff" fill-opacity=".85"/>`);
  },

  midnight: () => {
    const r = rng(11);
    let stars = '';
    for (let i = 0; i < 40; i++) {
      const x = (5 + r() * 50).toFixed(1);
      const y = (5 + r() * 74).toFixed(1);
      stars += `M${x} ${y}a${(0.4 + r() * 0.5).toFixed(2)} ${(0.4 + r() * 0.5).toFixed(2)} 0 1 0 .01 0z`;
    }
    // Two shooting stars: a tapering trail with a bright head.
    const shoot = (x, y, len) =>
      `<path d="M${x} ${y}l${len} ${len * 0.62}" stroke="#dce6ff" stroke-width="1.3" stroke-linecap="round" opacity=".9"/>
       <path d="M${x + len} ${y + len * 0.62}a1.9 1.9 0 1 0 .01 0z" fill="#fff"/>`;
    return backFrame(
      '#0b1030',
      '#04061a',
      '#141b45',
      '#8ea6ff',
      `<path d="${stars}" fill="#dce6ff" fill-opacity=".8"/>
       ${shoot(13, 20, 13)}${shoot(26, 48, 17)}`
    );
  },

  sakura: () => {
    const r = rng(3);
    let petals = '';
    for (let i = 0; i < 16; i++) {
      const x = (6 + r() * 48).toFixed(1);
      const y = (30 + r() * 48).toFixed(1);
      petals += `<path d="M0 -2.4c1.5.8 2 2 1.5 3.2-.4.8-.9 1.2-1.5 1.5-.6-.3-1.1-.7-1.5-1.5-.5-1.2 0-2.4 1.5-3.2z"
        transform="translate(${x} ${y}) rotate(${(r() * 360).toFixed(0)}) scale(${(0.75 + r() * 0.5).toFixed(2)})"
        fill="#fff" fill-opacity=".9"/>`;
    }
    // A bough across the top with blossom clustered along it.
    let blossom = '';
    for (const [bx, by] of [[14, 22], [21, 17], [29, 14], [37, 17], [44, 23], [25, 25], [40, 31]]) {
      blossom += `<g transform="translate(${bx} ${by})">
        ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-2.5" rx="1.5" ry="2.3" fill="#fff" transform="rotate(${a})"/>`).join('')}
        <circle r=".9" fill="#f6c6d4"/></g>`;
    }
    return backFrame(
      '#5e2436',
      '#2c0f1a',
      '#8f3b55',
      '#ffd9e4',
      `<path d="M4 34q10-6 18-12t16-10" fill="none" stroke="#3a1522" stroke-width="2.2" stroke-linecap="round"/>
       <path d="M20 26q4 4 5 9M34 17q1 5 4 8" fill="none" stroke="#3a1522" stroke-width="1.4" stroke-linecap="round"/>
       ${blossom}${petals}`
    );
  },

  gold: () =>
    `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" aria-label="Card back" role="img">
  <defs>
    <linearGradient id="bkGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8a6512"/>
      <stop offset="38%" stop-color="#e8c766"/>
      <stop offset="52%" stop-color="#fff3cf"/>
      <stop offset="66%" stop-color="#d9b254"/>
      <stop offset="100%" stop-color="#7a5510"/>
    </linearGradient>
  </defs>
  <rect x=".5" y=".5" width="59" height="83" rx="5.5" fill="#2b1f06" stroke="#150f03"/>
  <rect x="4" y="4" width="52" height="76" rx="3.5" fill="url(#bkGold)"/>
  <rect x="6.5" y="6.5" width="47" height="71" rx="2.5" fill="none" stroke="#4a360c" stroke-opacity=".55" stroke-width=".9"/>
  <path d="${latticePath()}" fill="none" stroke="#4a360c" stroke-opacity=".3" stroke-width=".6"/>
  <circle cx="30" cy="42" r="12" fill="#2b1f06" stroke="#f0d78f" stroke-width="1.1"/>
  <circle cx="30" cy="42" r="9.6" fill="none" stroke="#f0d78f" stroke-opacity=".5" stroke-width=".6"/>
  <path d="${SPADE}" fill="#f5e2a7" transform="translate(25.4 37.2) scale(.92)"/>
</svg>`,

  lines: () => {
    const r = rng(9);
    let lines = '';
    for (let i = 0; i < 11; i++) {
      const y = 8 + i * 6.4;
      const amp = (2 + r() * 5).toFixed(1);
      lines += `<path d="M4 ${y.toFixed(1)}Q18 ${(y - amp).toFixed(1)} 30 ${y.toFixed(1)}T56 ${(y + amp / 2).toFixed(1)}"
        fill="none" stroke="#fff" stroke-opacity="${(0.3 + r() * 0.45).toFixed(2)}" stroke-width="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
    }
    return `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" aria-label="Card back" role="img">
  <defs>
    <linearGradient id="bkLines" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="#848c96"/>
      <stop offset="55%" stop-color="#565d66"/>
      <stop offset="100%" stop-color="#2e333a"/>
    </linearGradient>
    <clipPath id="bkLinesClip"><rect x="4" y="4" width="52" height="76" rx="3.5"/></clipPath>
  </defs>
  <rect x=".5" y=".5" width="59" height="83" rx="5.5" fill="#23272c" stroke="#101214"/>
  <rect x="4" y="4" width="52" height="76" rx="3.5" fill="url(#bkLines)" stroke="#e8ecf1" stroke-opacity=".75" stroke-width=".9"/>
  <g clip-path="url(#bkLinesClip)">${lines}</g>
</svg>`;
  },

  carbon: () => {
    const { a, b } = weavePaths();
    return `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" aria-label="Card back" role="img">
  <defs><clipPath id="bkCarbonClip"><rect x="4" y="4" width="52" height="76" rx="3.5"/></clipPath></defs>
  <rect x=".5" y=".5" width="59" height="83" rx="5.5" fill="#0b0b0c" stroke="#f1f3f5"/>
  <rect x="4" y="4" width="52" height="76" rx="3.5" fill="#151618"/>
  <g clip-path="url(#bkCarbonClip)">
    <path d="${a}" stroke="#fff" stroke-opacity=".09" stroke-width="1.4"/>
    <path d="${b}" stroke="#000" stroke-opacity=".45" stroke-width="1.4"/>
  </g>
  <rect x="6.5" y="6.5" width="47" height="71" rx="2.5" fill="none" stroke="#f1f3f5" stroke-opacity=".8" stroke-width="1"/>
  <path d="${SPADE}" fill="none" stroke="#f1f3f5" stroke-width=".9" transform="translate(25.2 37) scale(.96)"/>
</svg>`;
  },
};

// Drawing a back costs real work — the patterns are built a shape at a time —
// and one is on screen a dozen times at once, so each design is built once
// and the string reused.
const backCache = new Map();
let backSeq = 0;

// Three of the backs carry ids - a gradient, a couple of clip paths - and a
// back is on screen a dozen times at once and again in the picker. Duplicate
// ids are invalid and url(#...) then resolves to whichever copy came first in
// the document: pick Bullion and its gold gradient went looking at another
// card's defs, leaving the swatch painted in the dark brown underneath. The
// art is still built once; only the ids are renamed, per copy.
export function cardBackSVG(id = 'classic') {
  const key = BACK_ART[id] ? id : 'classic';
  if (!backCache.has(key)) backCache.set(key, BACK_ART[key]());
  const art = backCache.get(key);
  if (!art.includes('id="bk')) return art; // nothing in it to clash
  const n = (backSeq = (backSeq + 1) % 1e6);
  return art.replace(/bk[A-Za-z]+/g, (m) => m + n);
}
