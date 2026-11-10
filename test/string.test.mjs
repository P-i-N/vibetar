// The stiff, stretching string: inharmonicity, tension modulation, longitudinal vibration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../js/worklet.js';
import { FS, OPEN, midiHz, fft, db, engine, render } from './util.mjs';

// frequency of the strongest component within +-width of f, in a Hann window of `secs`
// starting at t, zero-padded for a fine estimate
function freqNear(x, f, t, secs = 0.1, width = 0.015) {
  const n = 1 << 18, len = Math.floor(secs * FS), st = Math.floor(t * FS);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < len; i++) re[i] = (x[st + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
  fft(re, im);
  const mag = (i) => Math.hypot(re[i], im[i]);
  let bi = Math.floor((f * (1 - width) * n) / FS);
  for (let i = bi; i <= Math.ceil((f * (1 + width) * n) / FS); i++) if (mag(i) > mag(bi)) bi = i;
  const a = Math.log(mag(bi - 1)), b = Math.log(mag(bi)), c = Math.log(mag(bi + 1));
  return { f: ((bi + (0.5 * (a - c)) / (a - 2 * b + c)) * FS) / n, mag: mag(bi) };
}
function pluck(cfg, s, fret, v = 0.8, secs = 3) {
  const e = engine({ fingerNoise: 0, ...cfg });
  e.post({ type: 'n', t: 0.01, s, f: midiHz(OPEN[s] + fret), v, k: '', fr: fret > 0, d: 1 });
  return render(e, secs);
}
// run with a steel preset field set to `off` for every string (to hear the string without one effect)
function without(field, fn, off = 0) {
  const keep = PRESETS.steel[field];
  PRESETS.steel[field] = keep.map(() => off);
  try { return fn(); } finally { PRESETS.steel[field] = keep; }
}
// B from partials 8..16: f_k = k f1 sqrt((1 + B k^2) / (1 + B)). Lower partials are stretched
// less than the two polarisations of the string are apart: they cannot tell B. Measured early,
// while the high partials of a nylon string still sound.
function inharmonicity(x, f0) {
  const f1 = freqNear(x, f0, 0.05, 0.5).f, Bs = [];
  for (let k = 8; k <= 16; k++) {
    if (k * f0 > 6000) break;
    const r = freqNear(x, k * f0 * (1 + 5e-5 * k * k), 0.05, 0.5).f / (k * f1);
    Bs.push((r * r - 1) / (k * k - r * r));
  }
  return Bs.reduce((a, c) => a + c) / Bs.length;
}

test('every string is as stiff as its preset says, fretted notes stiffer', () => {
  for (const preset of ['steel', 'nylon']) for (let s = 0; s < 6; s++) {
    for (const fret of [0, 7]) {
      // stiffness grows with the square of the frequency on the shorter string
      const target = PRESETS[preset].B[s] * 2 ** (fret / 6);
      const B = without('tm', () => inharmonicity(pluck({ preset }, s, fret, 0.5), midiHz(OPEN[s] + fret)));
      // the soft nylon bass strings are barely stiff: there the measurement's own spread decides
      assert.ok(Math.abs(B - target) < 0.3 * target + 5e-6, `${preset} string ${s} fret ${fret}: B ${B.toExponential(2)}, target ${target.toExponential(2)}`);
    }
  }
});

// pitch (cents) of partial 6 of a pluck at t, with tension modulation against without it
function glide(s, v, t = 0.03, secs = 0.08) {
  const f = 6 * midiHz(OPEN[s]);
  const on = freqNear(pluck({}, s, 0, v, t + secs + 0.05), f, t, secs).f;
  const off = without('tm', () => freqNear(pluck({}, s, 0, v, t + secs + 0.05), f, t, secs).f);
  return 1200 * Math.log2(on / off);
}

test('a hard pluck starts sharp and settles: more on the bass strings, more the harder', () => {
  for (let s = 0; s < 6; s++) {
    const mf = glide(s, 0.8), want = PRESETS.steel.tm[s];
    assert.ok(mf > 0.6 * want && mf < 1.4 * want, `string ${s}: ${mf.toFixed(2)} cents at mf, designed ${want}`);
  }
  const want = PRESETS.steel.tm[0];
  const soft = glide(0, 0.3), hard = glide(0, 1.1), late = glide(0, 0.8, 2.5, 0.3);
  assert.ok(soft < 0.3 * want && hard > 1.5 * want, `low E: ${soft.toFixed(2)} cents soft, ${hard.toFixed(2)} cents hard`);
  assert.ok(late < 0.35 * want, `low E after 2.5 s: ${late.toFixed(2)} cents`);
});

// the six channels of a pluck
function channels(s, v, secs) {
  const e = engine({ fingerNoise: 0 });
  e.post({ type: 'n', t: 0.01, s, f: midiHz(OPEN[s]), v, k: '', fr: false, d: 1 });
  const n = Math.floor((secs * FS) / 128) * 128, ch = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(n));
  for (let i = 0; i < n; i += 128) e.render(ch.map((c) => c.subarray(i, i + 128)), 128, i);
  return ch;
}
const partialOfE = (k) => { const f0 = midiHz(OPEN[0]), B = PRESETS.steel.B[0]; return k * f0 * Math.sqrt((1 + B * k * k) / (1 + B)); };

test('the stretching string pulls on the bridge: phantom partials at sums of partials', () => {
  // low E: f8 + f8 lies below f16 on a stiff string; only the longitudinal pull puts energy there
  const ch = channels(0, 0.9, 1.2);
  const phantom = 2 * partialOfE(8), partial = partialOfE(16);
  assert.ok(partial - phantom > 6, `phantom ${phantom.toFixed(1)} Hz, partial ${partial.toFixed(1)} Hz`);
  const level = (x, f) => db(freqNear(x, f, 0.1, 1, 0.0025).mag);
  const rocking = level(ch[3], phantom) - level(ch[3], partial), towards = level(ch[0], phantom) - level(ch[0], partial);
  assert.ok(rocking > towards + 10, `at f8 + f8: ${rocking.toFixed(1)} dB re f16 in the rocking channel, ${towards.toFixed(1)} dB towards the top`);
});

test('phantom partials grow with the square of the partials that make them', () => {
  // f8 + f8 goes with the square of partial 8: twice its growth in dB
  const run = (v) => { const ch = channels(0, v, 1.2); return { ph: db(freqNear(ch[3], 2 * partialOfE(8), 0.1, 1, 0.0025).mag), p8: db(freqNear(ch[0], partialOfE(8), 0.1, 1, 0.0025).mag) }; };
  const a = run(0.4), b = run(0.8);
  const d = (b.ph - a.ph) - 2 * (b.p8 - a.p8);
  assert.ok(Math.abs(d) < 3, `phantom grew ${(b.ph - a.ph).toFixed(1)} dB, partial 8 ${(b.p8 - a.p8).toFixed(1)} dB`);
});

test('the longitudinal pull stays well below the note, as designed per string', () => {
  for (let s = 0; s < 6; s++) {
    const on = channels(s, 0.8, 1), off = without('phantom', () => channels(s, 0.8, 1), -Infinity);
    const z = s >> 1, pow = (a) => a.reduce((p, v) => p + v * v, 0);
    const rel = 10 * Math.log10(pow(on[3 + z].map((v, i) => v - off[3 + z][i])) / pow(on[z]));
    const want = PRESETS.steel.phantom[s];
    assert.ok(Math.abs(rel - want) < 3, `string ${s}: longitudinal ${rel.toFixed(1)} dB re the towards-top output, designed ${want}`);
  }
});
