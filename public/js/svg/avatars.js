// Inline SVG seat avatars. Colour is derived from the username so every
// player keeps a stable, distinct look.
const PALETTE = [
  ['#e6b450', '#8a5d12'],
  ['#4aa8e8', '#1b4f7a'],
  ['#e0564f', '#7a1f1b'],
  ['#3cc27f', '#145a37'],
  ['#a07be0', '#4a2d82'],
  ['#ef8f3c', '#7a3d0c'],
  ['#2bb5a8', '#0f5650'],
  ['#e46fa3', '#7a2350'],
];

function hash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name) {
  const core = (name || '?').replace(/^guest_/, '');
  return core.slice(0, 2).toUpperCase();
}

export function avatarSVG(username) {
  const [hi, lo] = PALETTE[hash(username || '') % PALETTE.length];
  const text = initials(username).replace(/[^A-Z0-9]/g, '');
  return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="30" cy="30" r="29" fill="${lo}"/>
  <circle cx="30" cy="27" r="26" fill="${hi}"/>
  <circle cx="30" cy="30" r="28.5" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
  <text x="30" y="37" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${text.length > 1 ? 21 : 25}" font-weight="800" fill="#fff" letter-spacing="-.5">${text}</text>
</svg>`;
}
