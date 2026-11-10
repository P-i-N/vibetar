// What reaches the listener: the engine's bridge-zone channels through the body's responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBodyIR } from '../js/ir.js';
import { MIX_H } from '../js/audio.js';
import { INSTRUMENTS } from '../js/song.js';
import { FS, OPEN, midiHz, fft, db, engine, cachedBody } from './util.mjs';

const NAMES = ['steel', 'nylon', 'twelve'];
const spectra = new Map();
// FFT of every response of an instrument's body (left microphone), for n-point frames
function responses(name, n, modelled) {
  const key = `${name}:${n}:${modelled}`;
  if (!spectra.has(key)) {
    const irs = modelled ? [0, 1, 2, 3, 4, 5].map((c) => cachedBody(name).irs[2 * c]) : [makeBodyIR(FS, name).L];
    spectra.set(key, irs.map((h) => { const re = new Float64Array(n), im = new Float64Array(n); re.set(h.subarray(0, Math.min(n, h.length))); fft(re, im); return { re, im }; }));
  }
  return spectra.get(key);
}
function play(name, modelled, s, fret, secs, cfg = {}) {
  const e = engine({ preset: name, bridge: modelled ? cachedBody(name).bridge : null, coupling: INSTRUMENTS[name].coupling, symp: INSTRUMENTS[name].symp, ...cfg });
  e.post({ type: 'n', t: 0.02, s, f: midiHz(OPEN[s] + fret), v: 0.8, k: '', fr: fret > 0, d: 1 });
  const len = Math.floor((secs * FS) / 128) * 128, ch = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(len));
  for (let i = 0; i < len; i += 128) e.render(ch.map((c) => c.subarray(i, i + 128)), 128, i);
  return ch;
}
// spectrum of what is heard in the n samples from `start` (Hann window)
function heardSpectrum(name, modelled, ch, start, n) {
  const H = responses(name, n, modelled), outR = new Float64Array(n), outI = new Float64Array(n);
  const srcs = modelled ? ch : [ch[0].map((v, i) => v + ch[1][i] + ch[2][i] + MIX_H[name] * (ch[3][i] + ch[4][i] + ch[5][i]))];
  srcs.forEach((x, c) => {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (x[start + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    fft(re, im);
    for (let b = 0; b < n / 2; b++) { outR[b] += re[b] * H[c].re[b] - im[b] * H[c].im[b]; outI[b] += re[b] * H[c].im[b] + im[b] * H[c].re[b]; }
  });
  const mag = new Float64Array(n / 2);
  for (let b = 0; b < n / 2; b++) mag[b] = Math.hypot(outR[b], outI[b]);
  return mag;
}
// Pitch (cents from the note) of the loudest component near the fundamental, 0.05-0.73 s
// after the pluck. A steady partial keeps its frequency through the body, so components are
// located before the body's response and then rated by how loud the body makes them.
function heardCents(name, s, fret, cfg) {
  const n = 32768, f = midiHz(OPEN[s] + fret), b0 = Math.round((f * n) / FS), st = Math.floor(0.05 * FS);
  const ch = play(name, true, s, fret, 0.75, cfg), H = responses(name, n, true);
  const R = new Float64Array(n), I = new Float64Array(n);
  ch.forEach((x, c) => {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (x[st + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    fft(re, im);
    for (let k = 0; k < n / 2; k++) { R[k] += re[k] * H[c].re[b0] - im[k] * H[c].im[b0]; I[k] += re[k] * H[c].im[b0] + im[k] * H[c].re[b0]; }
  });
  const mag = (k) => Math.hypot(R[k], I[k]);
  const gain = (k) => { let g = 0; for (let c = 0; c < 3; c++) g += Math.hypot(H[c].re[k], H[c].im[k]); return g; };
  let bi = -1, best = 0;
  for (let i = Math.floor((f * 0.96 * n) / FS); i <= Math.ceil((f * 1.04 * n) / FS); i++) {
    if (mag(i) > mag(i - 1) && mag(i) >= mag(i + 1) && mag(i) * gain(i) > best) { best = mag(i) * gain(i); bi = i; }
  }
  const a = Math.log(mag(bi - 1)), b = Math.log(mag(bi)), c = Math.log(mag(bi + 1));
  return 1200 * Math.log2((((bi + (0.5 * (a - c)) / (a - 2 * b + c)) * FS) / n) / f);
}

// With the strings tied to the body, a note sitting on the main top resonance while another
// string is free to ring at the same pitch splits into a pulled, short-lived part and a
// lasting one - the wolf note of a real guitar. Everywhere else notes must be dead on.
test('heard through the modelled body, notes are in tune at the default coupling (other strings free)', () => {
  const worstAllowed = { steel: 12, nylon: 12, twelve: 18 }; // the 12-string's courses are detuned by design
  for (const name of NAMES) {
    const off = [];
    for (let s = 0; s < 6; s++) for (let fret = 0; fret <= 15; fret++) off.push([Math.abs(heardCents(name, s, fret)), s, fret]);
    off.sort((x, y) => y[0] - x[0]);
    const worst = off.slice(0, 5).map(([c, s, f]) => `s${s} f${f}: ${c.toFixed(1)}`).join(', ');
    const fine = off.filter(([c]) => c <= (name === 'twelve' ? 8 : 3)).length;
    assert.ok(fine >= 86, `${name}: only ${fine} of 96 notes in tune; worst ${worst}`);
    assert.ok(off[0][0] <= worstAllowed[name], `${name}: worst ${worst}`);
    // and away from the body's main resonances every note is within 3 cents
    const body = cachedBody(name);
    for (const [c, st, fret] of off) {
      const f = midiHz(OPEN[st] + fret);
      const near = [body.info.air, body.info.top].some((r) => Math.abs(Math.log2(f / r)) < 0.25 || Math.abs(Math.log2(f / (r / 2))) < 0.06);
      if (!near && name !== 'twelve') assert.ok(c <= 3, `${name} s${st} f${fret} (${f.toFixed(0)} Hz): ${c.toFixed(1)} cents`);
    }
  }
});

// seconds until the heard level has fallen 20 dB from its level shortly after the attack
function heardDecay(name, modelled, s, fret) {
  const n = 8192, ch = play(name, modelled, s, fret, 6);
  const lv = (t) => { const m = heardSpectrum(name, modelled, ch, Math.floor(t * FS), n); let e = 0; for (let b = 8; b < n / 2; b++) e += m[b] * m[b]; return 10 * Math.log10(e); };
  const ref = lv(0.06);
  for (let t = 0.15; t < 5.8; t += 0.05) if (lv(t) < ref - 20) return t;
  return 5.8;
}

test('heard sustain per string stays within 30 % of the classic body', () => {
  for (const name of NAMES) for (let s = 0; s < 6; s++) {
    const ratio = (heardDecay(name, true, s, 0) + heardDecay(name, true, s, 5)) / (heardDecay(name, false, s, 0) + heardDecay(name, false, s, 5));
    assert.ok(ratio > 0.7 && ratio < 1.3, `${name} string ${s}: ${ratio.toFixed(2)} x the classic sustain`);
  }
});

test('the along-top motion of the strings is heard, not averaged away', () => {
  for (const name of NAMES) {
    const b = cachedBody(name);
    assert.equal(b.irs.length, 12);
    const power = (h) => h.reduce((a, v) => a + v * v, 0);
    for (let z = 0; z < 3; z++) {
      const rel = 10 * Math.log10(power(b.irs[6 + 2 * z]) / power(b.irs[2 * z]));
      // weakest for the middle strings: they sit near the centre line, where the top does not tilt
      assert.ok(rel > -30 && rel < -3, `${name} zone ${z}: rocking response ${rel.toFixed(1)} dB re the vertical one`);
    }
  }
});
