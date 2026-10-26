/**
 * The table's design tokens, as Tailwind's scale.
 *
 * These are the same values as the `:root` block at the top of
 * src/assets/css/styles.css, which the hand-written table CSS still reads as
 * custom properties. They are written out as literals here rather than as
 * `var(--bg-1)` so the opacity modifiers work (`bg-felt-1/60` needs a colour
 * Tailwind can take apart, which a var() is not). Change one, change both.
 */
export default {
  content: ['./index.html', './404.html', './src/**/*.{vue,js}'],
  // styles.css brings its own reset - box-sizing, the [hidden] rule, the
  // felt-green scrollbars, the no-select default - and Preflight on top of it
  // would only fight it. Utilities are layered over that stylesheet instead.
  corePlugins: { preflight: false },
  theme: {
    // The stylesheet's own breakpoints, as min-widths.
    //
    // styles.css is written in max-width queries - 560, 720, 1024, 1080,
    // 1400 - and Tailwind's defaults (640/768/1024/1280/1536) line up with
    // almost none of them. Two systems disagreeing by 80px is how a utility
    // ends up applying in the band where the stylesheet has already reflowed
    // the thing underneath it. Each screen below starts exactly one pixel
    // after the matching max-width rule stops.
    screens: {
      xs: '391px', // over the smallest phone layout (max-width: 390px)
      sm: '561px', // over the phone layout (max-width: 560px)
      md: '721px', // over the stacked dock / single-column lobby
      lg: '1025px', // over the tablet table layout
      xl: '1081px', // over the two-row dock
      '2xl': '1401px', // over the shrinking three-column dock
      '3xl': '1920px', // ultra-wide, where the panels get the extra room
    },
    extend: {
      colors: {
        // The felt, from the darkest ground up to the raised panel.
        felt: { 0: '#060b09', 1: '#0a1310', 2: '#0f1c17', 3: '#15261f' },
        ink: { 1: '#f2f4f1', 2: '#b4c2bb', 3: '#7a8d84' },
        gold: { DEFAULT: '#e6b450', hi: '#f7d58a', lo: '#9c7424' },
        chip: { red: '#e0564f', 'red-lo': '#9e2e29', green: '#3cc27f', blue: '#4aa8e8' },
        hair: { DEFAULT: 'rgba(255,255,255,0.07)', 2: 'rgba(255,255,255,0.14)' },
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // A Didone: hairline serifs against heavy stems, the cut good whisky
        // and watch advertising is set in.
        display: ['Bodoni Moda', 'Didot', 'Georgia', 'Times New Roman', 'serif'],
      },
      fontSize: {
        display: ['clamp(30px, 4.6vw, 46px)', { lineHeight: '1.04' }],
        h2: ['19px', { lineHeight: '1.3' }],
        body: ['14px', { lineHeight: '1.55' }],
        small: ['12.5px', { lineHeight: '1.5' }],
        micro: ['10.5px', { lineHeight: '1.4' }],
      },
      borderRadius: { s: '8px', m: '12px', l: '18px' },
      boxShadow: {
        1: '0 2px 8px rgba(0,0,0,0.35)',
        2: '0 14px 36px rgba(0,0,0,0.5)',
      },
      // A long, soft deceleration is most of what makes movement read as
      // expensive: it arrives quickly and then settles.
      transitionTimingFunction: {
        out: 'cubic-bezier(0.2,0.8,0.2,1)',
        spring: 'cubic-bezier(0.3,1.3,0.5,1)',
        'out-expo': 'cubic-bezier(0.16,1,0.3,1)',
        'in-quick': 'cubic-bezier(0.4,0,1,1)',
      },
      transitionDuration: { quick: '180ms', base: '320ms', slow: '620ms', grand: '900ms' },
      spacing: { rise: '16px' },
    },
  },
  plugins: [],
};
