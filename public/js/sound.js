// Table sounds, synthesised with the Web Audio API — no audio files, so the
// game still works offline and the download stays small. Everything is built
// from short oscillator blips and filtered noise bursts.
const KEY = 'bbp-sound';

let ctx = null;
let master = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

export function soundMuted() {
  return muted;
}

export function toggleSound() {
  muted = !muted;
  try {
    localStorage.setItem(KEY, muted ? 'off' : 'on');
  } catch {
    // Not persisted; still applies for this session.
  }
  if (!muted) play('click');
  return muted;
}

// Browsers only allow audio after a user gesture, so the context is created
// lazily on the first sound and resumed if it was suspended.
function audio() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// A short pitched blip.
function tone(at, { freq, to = freq, dur = 0.12, type = 'sine', gain = 0.2, attack = 0.005 }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

// A burst of filtered noise — the basis of card and chip sounds.
function noise(at, { dur = 0.12, gain = 0.2, freq = 2000, q = 1, type = 'bandpass', sweepTo = null }) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Fade the noise out so it sounds like a brush rather than a click.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, at);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(env).connect(master);
  src.start(at);
  src.stop(at + dur + 0.02);
}

const SOUNDS = {
  // Card sliding across felt.
  deal: (t) => noise(t, { dur: 0.16, gain: 0.3, freq: 1200, sweepTo: 4000, q: 0.7 }),
  // Card turning over.
  flip: (t) => noise(t, { dur: 0.1, gain: 0.22, freq: 2600, sweepTo: 900, q: 0.8 }),
  // Cards tossed into the muck.
  fold: (t) => {
    noise(t, { dur: 0.2, gain: 0.28, freq: 900, sweepTo: 300, q: 0.6 });
    noise(t + 0.07, { dur: 0.16, gain: 0.2, freq: 700, sweepTo: 260, q: 0.6 });
  },
  // Knuckles on the table.
  check: (t) => {
    tone(t, { freq: 180, to: 90, dur: 0.07, type: 'triangle', gain: 0.25 });
    noise(t, { dur: 0.05, gain: 0.18, freq: 400, q: 1.5, type: 'lowpass' });
  },
  // Chips landing on chips.
  chip: (t) => {
    noise(t, { dur: 0.05, gain: 0.22, freq: 5200, q: 2.5 });
    tone(t, { freq: 2400, to: 1500, dur: 0.05, type: 'square', gain: 0.045 });
  },
  // A bigger pile of chips pushed in.
  bet: (t) => {
    for (let i = 0; i < 3; i++) SOUNDS.chip(t + i * 0.045);
  },
  allin: (t) => {
    for (let i = 0; i < 6; i++) SOUNDS.chip(t + i * 0.04);
    tone(t + 0.05, { freq: 300, to: 600, dur: 0.3, type: 'sawtooth', gain: 0.06 });
  },
  // It's on you.
  turn: (t) => {
    tone(t, { freq: 760, dur: 0.1, type: 'sine', gain: 0.16 });
    tone(t + 0.1, { freq: 1140, dur: 0.16, type: 'sine', gain: 0.14 });
  },
  // Clock running down.
  tick: (t) => tone(t, { freq: 1500, to: 1100, dur: 0.04, type: 'sine', gain: 0.1 }),
  // You won the pot.
  win: (t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(t + i * 0.09, { freq: f, dur: 0.34, type: 'triangle', gain: 0.16 })
    );
    for (let i = 0; i < 5; i++) SOUNDS.chip(t + 0.22 + i * 0.05);
  },
  // Someone else took it.
  lose: (t) => {
    tone(t, { freq: 320, to: 180, dur: 0.34, type: 'sine', gain: 0.12 });
  },
  click: (t) => tone(t, { freq: 900, to: 1400, dur: 0.05, type: 'sine', gain: 0.1 }),
};

export function play(name, delay = 0) {
  const c = audio();
  if (!c || !SOUNDS[name]) return;
  try {
    SOUNDS[name](c.currentTime + delay);
  } catch {
    // An audio glitch must never interrupt the game.
  }
}
