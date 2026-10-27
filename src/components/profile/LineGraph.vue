<script setup>
// A line graph, drawn by hand.
//
// No chart library, on purpose: three graphs with one shape between them is
// less code than a dependency's configuration object, and a hand-drawn SVG
// is the only way the axes, the focus readout and the hidden data table all
// behave the way the rest of this app does.
//
// Three rules it keeps that a default chart would not:
//
//   Colour never carries meaning on its own. Every series is labelled at the
//   end of its own line, so a two-line graph reads without telling the
//   colours apart.
//
//   The readout answers hover, tap and keyboard focus alike. A graph only a
//   mouse can interrogate is a graph half the people reading it cannot.
//
//   There is a real table underneath, visually hidden. The alternative to a
//   picture of numbers is the numbers.
import { computed, ref } from 'vue';

const props = defineProps({
  // [{ name, points: [{ game, ended_at, value }], color }]. One or two.
  series: { type: Array, required: true },
  title: { type: String, required: true },
  // What the y axis counts, for the ticks and the readout: 'chips' or 'rate'.
  unit: { type: String, default: 'chips' },
  // Net chips crosses zero and the crossing is the point, so that graph
  // pins zero into the scale and rules a line across it. A win rate runs
  // 0-1 and has no such line to draw.
  zeroBaseline: { type: Boolean, default: false },
});

// A viewBox rather than pixels: the graph is laid out once, at this size,
// and the browser scales the whole thing to whatever width the card is. It
// is the one way a hand-drawn SVG stays legible at 320px without a second
// set of measurements for phones.
const W = 520;
const H = 220;
const PAD = { top: 14, right: 54, bottom: 30, left: 52 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const focused = ref(-1); // which game the readout is showing, -1 for none

const points = computed(() => props.series[0]?.points || []);
const count = computed(() => points.value.length);

// Every value across every series, which is what the scale has to hold.
const values = computed(() => props.series.flatMap((s) => s.points.map((p) => p.value)));

const bounds = computed(() => {
  const all = values.value;
  if (!all.length) return { min: 0, max: 1 };
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (props.zeroBaseline) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (props.unit === 'rate') return { min: 0, max: 1 };
  // A flat line needs a scale with height, or it is drawn on the axis and
  // reads as missing rather than as steady.
  if (min === max) {
    const pad = Math.abs(min) * 0.2 || 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
});

const x = (i) => {
  if (count.value <= 1) return PAD.left + plotW / 2;
  return PAD.left + (i / (count.value - 1)) * plotW;
};
const y = (value) => {
  const { min, max } = bounds.value;
  const span = max - min || 1;
  return PAD.top + plotH - ((value - min) / span) * plotH;
};

const pathFor = (series) =>
  series.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

// Five across the range, rounded to something a person would say out loud.
const yTicks = computed(() => {
  const { min, max } = bounds.value;
  if (props.unit === 'rate') return [0, 0.25, 0.5, 0.75, 1];
  const step = (max - min) / 4;
  return [0, 1, 2, 3, 4].map((i) => min + step * i);
});

// Only ever a handful of labels along the bottom, whatever the record. The
// first and last are always among them: they are the two a reader looks for.
const xTicks = computed(() => {
  const n = count.value;
  if (n <= 1) return n ? [0] : [];
  const wanted = Math.min(6, n);
  const out = new Set([0, n - 1]);
  for (let i = 1; i < wanted - 1; i++) out.add(Math.round((i / (wanted - 1)) * (n - 1)));
  return [...out].sort((a, b) => a - b);
});

const fmtValue = (value) => {
  if (props.unit === 'rate') return `${Math.round(value * 100)}%`;
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('en-US')}`;
};
const fmtTick = (value) =>
  props.unit === 'rate' ? `${Math.round(value * 100)}%` : Math.round(value).toLocaleString('en-US');

const zeroY = computed(() => (props.zeroBaseline ? y(0) : null));

// Which game the pointer is nearest. Nearest rather than "inside a band",
// so the whole width of the graph answers rather than only the columns.
function onMove(event) {
  const svg = event.currentTarget;
  const box = svg.getBoundingClientRect();
  const px = ((event.clientX - box.left) / box.width) * W;
  if (count.value <= 1) return (focused.value = count.value ? 0 : -1);
  const ratio = (px - PAD.left) / plotW;
  focused.value = Math.max(0, Math.min(count.value - 1, Math.round(ratio * (count.value - 1))));
}

function onKey(event) {
  if (!count.value) return;
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -count.value, End: count.value }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const from = focused.value === -1 ? 0 : focused.value;
  focused.value = Math.max(0, Math.min(count.value - 1, from + step));
}

const readout = computed(() => {
  if (focused.value < 0 || !count.value) return null;
  const i = Math.min(focused.value, count.value - 1);
  const first = points.value[i];
  return {
    i,
    game: first?.game ?? i + 1,
    when: first?.ended_at ? new Date(first.ended_at).toLocaleDateString() : '',
    parts: props.series.map((s) => ({ name: s.name, value: fmtValue(s.points[i]?.value ?? 0) })),
  };
});

// Where the readout sits, kept inside the box: a label on the last point
// would otherwise hang off the right-hand edge.
const readoutX = computed(() => {
  if (!readout.value) return 0;
  return Math.min(Math.max(x(readout.value.i), PAD.left + 46), W - PAD.right - 6);
});
</script>

<template>
  <figure class="graph">
    <figcaption class="graph-title">{{ title }}</figcaption>

    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="graph-svg"
      role="img"
      tabindex="0"
      :aria-label="`${title}. ${count} game${count === 1 ? '' : 's'}. Use the arrow keys to read each one.`"
      @mousemove="onMove"
      @mouseleave="focused = -1"
      @touchstart.passive="onMove($event.touches[0])"
      @touchmove.passive="onMove($event.touches[0])"
      @keydown="onKey"
      @focus="focused = count ? count - 1 : -1"
      @blur="focused = -1"
    >
      <!-- Gridlines and the figures beside them. Drawn first so every line
           and dot sits over them rather than under. -->
      <g class="graph-grid">
        <template v-for="(tick, i) in yTicks" :key="`y${i}`">
          <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(tick)" :y2="y(tick)" />
          <text class="graph-tick" :x="PAD.left - 8" :y="y(tick) + 3.5" text-anchor="end">
            {{ fmtTick(tick) }}
          </text>
        </template>
      </g>

      <!-- Zero, where crossing it is the thing being shown. -->
      <line
        v-if="zeroY !== null"
        class="graph-zero"
        :x1="PAD.left"
        :x2="W - PAD.right"
        :y1="zeroY"
        :y2="zeroY"
      />

      <g class="graph-axis">
        <line :x1="PAD.left" :x2="W - PAD.right" :y1="H - PAD.bottom" :y2="H - PAD.bottom" />
        <text
          v-for="i in xTicks"
          :key="`x${i}`"
          class="graph-tick"
          :x="x(i)"
          :y="H - PAD.bottom + 16"
          text-anchor="middle"
        >
          {{ points[i]?.game ?? i + 1 }}
        </text>
        <text class="graph-axis-label" :x="PAD.left + plotW / 2" :y="H - 2" text-anchor="middle">
          Game
        </text>
      </g>

      <!-- The lines, and their names at the end of them. A legend keyed by
           colour would be the one thing here that cannot be read without
           telling the colours apart. -->
      <g v-for="(s, si) in series" :key="s.name" :class="`graph-series s${si}`">
        <path :d="pathFor(s)" class="graph-line" fill="none" />
        <circle
          v-if="s.points.length === 1"
          :cx="x(0)"
          :cy="y(s.points[0].value)"
          r="4"
          class="graph-dot"
        />
        <text
          v-if="s.points.length"
          class="graph-name"
          :x="W - PAD.right + 6"
          :y="y(s.points[s.points.length - 1].value) + 3.5"
        >
          {{ s.name }}
        </text>
      </g>

      <!-- The readout: a rule down the graph, a dot on each line, and the
           figures. Follows hover, tap and the arrow keys alike. -->
      <g v-if="readout" class="graph-readout">
        <line :x1="x(readout.i)" :x2="x(readout.i)" :y1="PAD.top" :y2="H - PAD.bottom" />
        <circle
          v-for="(s, si) in series"
          :key="`d${si}`"
          :class="`graph-dot s${si}`"
          :cx="x(readout.i)"
          :cy="y(s.points[readout.i]?.value ?? 0)"
          r="4"
        />
        <text class="graph-readout-text" :x="readoutX" :y="PAD.top + 2" text-anchor="middle">
          <tspan class="graph-readout-game">Game {{ readout.game }}</tspan>
          <tspan
            v-for="part in readout.parts"
            :key="part.name"
            :x="readoutX"
            dy="14"
          >{{ part.name }} {{ part.value }}</tspan>
        </text>
      </g>
    </svg>

    <!-- The numbers themselves, for anyone not reading the picture. -->
    <table class="sr-only">
      <caption>{{ title }}</caption>
      <thead>
        <tr>
          <th scope="col">Game</th>
          <th v-for="s in series" :key="s.name" scope="col">{{ s.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in points" :key="i">
          <th scope="row">{{ p.game }}</th>
          <td v-for="s in series" :key="s.name">{{ fmtValue(s.points[i]?.value ?? 0) }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>
