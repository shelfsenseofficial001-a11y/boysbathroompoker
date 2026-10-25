// Small inline SVG UI icons. They use currentColor so they follow button text.
const svg = (body, vb = '0 0 24 24') =>
  `<svg class="icon" viewBox="${vb}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  fold: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="M4 12.5 9 17.5 20 6.5"/>'),
  call: svg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
  raise: svg('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>'),
  allin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>',
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  // Room owner. A key rather than a crown, because the crown already means
  // "won this hand" on the seat tags and the two would read as one thing.
  key: svg('<circle cx="8" cy="9" r="4.2"/><path d="M11.2 11.8 20 20.5"/><path d="m17 17.5 2-2"/>'),
  // Biggest stack at the table right now.
  trophy: svg('<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.2a3 3 0 0 0 2.9 3"/><path d="M16 5.5h2.8a3 3 0 0 1-2.9 3"/><path d="M12 13.5V17"/><path d="M9 20h6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7.1 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10.1 3v-.1a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>'),
  chat: svg('<path d="M20.5 11.5a7.5 7.5 0 0 1-10.8 6.7L4 19.5l1.4-5A7.5 7.5 0 1 1 20.5 11.5z"/>'),
  send: svg('<path d="M4.5 11.8 20 4.5l-7.3 15.5-2-6.2z"/>'),
  history: svg('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  leave: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>'),
  robot: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7.5" width="17" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="13.5" r="1.8" fill="currentColor"/><circle cx="15" cy="13.5" r="1.8" fill="currentColor"/><path d="M12 7.5V4M9.5 17h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="3" r="1.4" fill="currentColor"/></svg>',
  crown: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5l4 3.5 5-6.5 5 6.5 4-3.5-1.8 11H4.8z" fill="currentColor"/></svg>',
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  // The same cross as `fold`, under the name the dismiss buttons use.
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  pencil: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M14 6l4 4"/>'),
  soundOn: svg('<path d="M4 9.5h3L12 5v14l-5-4.5H4z" fill="currentColor" stroke-linejoin="round"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5h3L12 5v14l-5-4.5H4z" fill="currentColor" stroke-linejoin="round"/><path d="M17 10l4 4M21 10l-4 4"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>'),
  sliders: svg('<path d="M5 20v-6M5 10V4M12 20v-9M12 7V4M19 20v-4M19 12V4"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="19" cy="14" r="2"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  chevron: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-7 9z" fill="currentColor"/></svg>',
  // A thin one that points down, for anything that opens a menu beneath it.
  chevronDown:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowLeft:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m0 0 6-6m-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logo: `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
    <rect x="3" y="3" width="26" height="26" rx="7" fill="#0f5c42" stroke="#e6b450" stroke-width="1.5"/>
    <path d="M16 8s-6 4.4-6 7.3c0 1.8 1.4 3 3 3 1.1 0 1.9-.6 2.4-1.3-.1 1.4-.6 2.3-1.6 3h4.4c-1-.7-1.5-1.6-1.6-3 .5.7 1.3 1.3 2.4 1.3 1.6 0 3-1.2 3-3C22 12.4 16 8 16 8z" fill="#e6b450"/>
  </svg>`,
};
