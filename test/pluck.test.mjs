import test from 'node:test';
import assert from 'node:assert/strict';
import { FS, OPEN, midiHz, spectrum, peakNear, db, rms, peak, centroid, engine, render } from './util.mjs';
import { PLUCKERS } from '../js/worklet.js';

const T0 = 0.05; // release time of the test notes
const techs = { pick: 0, flesh: 1, nailS: 2, nailL: 3 };
function playE(pick, s, fret, extra = {}, cfg = {}, secs = 1.5, fs = FS) {
  const e = engine({ pick, ...cfg }, fs);
  const open = cfg.open || OPEN;
  e.post({ type: 'n', t: T0, s, f: midiHz(open[s] + fret), v: 0.8, k: '', fr: fret > 0, d: 1, ...extra });
  return { e, x: render(e, secs, fs) };
}
const play = (...a) => playE(...a).x;
const bright = (x, fs = FS) => centroid(x, T0, T0 + 0.06, fs);
const cents = (x, f, fs = FS) => { const N = 1 << 16; return 1200 * Math.log2(peakNear(spectrum(x, Math.floor(fs * 0.15), N), N, f, fs).f / f); };

test('there is a plucker for pick, flesh, short nails, long nails and thumb', () => {
  assert.equal(PLUCKERS.length, 5);
  assert.ok(PLUCKERS[2].nail && !PLUCKERS[0].nail);
});

test('brightness orders flesh < short nails < long nails < pick', () => {
  for (const [s, fret] of [[1, 3], [3, 2], [5, 0]]) {
    const c = Object.values(techs).map((p) => bright(play(p, s, fret)));
    assert.ok(c[1] < c[2] && c[2] < c[3] && c[3] < c[0], `s${s}: ${c.map(Math.round)}`);
  }
});

test('harder plucks are brighter and louder', () => {
  for (const p of Object.values(techs)) {
    const soft = play(p, 2, 2, { v: 0.4 }), hard = play(p, 2, 2, { v: 1.0 });
    assert.ok(bright(hard) > bright(soft), `technique ${p}: ${bright(soft)} -> ${bright(hard)}`);
    assert.ok(db(rms(hard, T0, T0 + 0.3)) - db(rms(soft, T0, T0 + 0.3)) > 4);
  }
});

test('techniques are level-matched within 3 dB', () => {
  for (const [s, fret] of [[0, 3], [2, 2], [5, 3]]) {
    const lv = Object.values(techs).map((p) => db(rms(play(p, s, fret), T0, T0 + 0.5)));
    assert.ok(Math.max(...lv) - Math.min(...lv) < 3, `s${s}: ${lv.map((v) => v.toFixed(1)).join(' ')}`);
  }
});

test('the contact lasts 1-8 ms and ends at the note time', () => {
  for (const p of Object.values(techs)) for (const s of [0, 3, 5]) {
    const { e } = playE(p, s, 2);
    const v = e.voices[s];
    assert.equal(v.contact, 0);
    const ms = (v.contactFrames / FS) * 1000;
    assert.ok(ms >= 1 && ms <= 8, `technique ${p} string ${s}: ${ms.toFixed(2)} ms`);
    assert.ok(Math.abs(v.releaseFrame / FS - T0) < 0.002, `released at ${v.releaseFrame / FS}`);
  }
});

test('plucked notes stay within 1.5 cents for every technique', () => {
  for (const p of Object.values(techs)) for (const [s, fret] of [[0, 0], [1, 3], [3, 9], [5, 0], [5, 12]]) {
    const f = midiHz(OPEN[s] + fret);
    const c = cents(play(p, s, fret, {}, {}, 2.5), f);
    assert.ok(Math.abs(c) < 1.5, `technique ${p} s${s} f${fret}: ${c.toFixed(2)} cents`);
  }
});

test('hybrid uses the pick on bass strings and nails on trebles', () => {
  const near = (a, b) => Math.abs(a / b - 1) < 0.05;
  assert.ok(near(bright(play(4, 0, 3)), bright(play(0, 0, 3))));
  assert.ok(near(bright(play(4, 5, 3)), bright(play(2, 5, 3))));
});

test('re-plucking a ringing string makes no jump in the waveform', () => {
  for (const p of Object.values(techs)) {
    const e = engine({ pick: p });
    const f = midiHz(OPEN[1] + 3);
    e.post({ type: 'n', t: 0.05, s: 1, f, v: 0.9, k: '', fr: true, d: 1 });
    e.post({ type: 'n', t: 0.35, s: 1, f, v: 0.9, k: '', fr: true, d: 1 });
    const x = render(e, 0.5);
    const step = (a, b) => { let m = 0; for (let i = Math.floor(a) + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
    const start = e.voices[1].strokeFrame;
    assert.ok(start > 0.33 * FS && start < 0.35 * FS);
    // where the plucker lands on the moving string (the first millisecond of contact) the
    // waveform must stay as smooth as the ring just before it
    const before = step(start - 0.02 * FS, start), landing = step(start, start + 0.001 * FS);
    assert.ok(landing < 3 * before, `technique ${p}: landing step ${landing} vs ${before} before`);
    // and the new attack is an attack, not a click: comparable to the first one
    assert.ok(step(0.32 * FS, 0.37 * FS) < 2.5 * step(0.03 * FS, 0.08 * FS), `technique ${p}`);
  }
});

test('rest strokes put more energy towards the top and sound fuller', () => {
  const free = playE(1, 3, 2), rest = playE(1, 3, 2, { rs: true });
  const ratio = ({ e }) => Math.abs(e.voices[3].excV / e.voices[3].excH);
  assert.ok(ratio(rest) > 2 * ratio(free));
  assert.ok(db(rms(rest.x, T0, T0 + 0.5)) > db(rms(free.x, T0, T0 + 0.5)) + 1);
});

test('up and down strokes differ in direction only', () => {
  const dn = play(0, 2, 2, { d: 1 }), up = play(0, 2, 2, { d: -1 });
  assert.ok(Math.abs(db(rms(dn, T0, T0 + 0.5)) - db(rms(up, T0, T0 + 0.5))) < 2);
});

// --- conditions the spec implies but does not spell out -----------------------

test('works at 44.1 kHz and 96 kHz', () => {
  for (const fs of [44100, 96000]) {
    const f = midiHz(OPEN[2] + 2);
    const c = Object.values(techs).map((p) => bright(play(p, 2, 2, {}, {}, 1.5, fs), fs));
    assert.ok(c[1] < c[2] && c[2] < c[3] && c[3] < c[0], `${fs}: ${c.map(Math.round)}`);
    assert.ok(Math.abs(cents(play(0, 2, 2, {}, {}, 2.5, fs), f, fs)) < 2);
  }
});

test('fret 24 on the top string and a low C on the bottom string', () => {
  for (const p of Object.values(techs)) {
    const hi = play(p, 5, 24, {}, {}, 2.5);
    assert.ok(Math.abs(cents(hi, midiHz(88))) < 3, `technique ${p}: fret 24`);
    const open = [36, 43, 48, 55, 59, 64];
    const lo = play(p, 0, 0, {}, { open }, 2.5);
    assert.ok(Math.abs(cents(lo, midiHz(36))) < 3, `technique ${p}: low C`);
    assert.ok(peak(lo) < 2 && peak(hi) < 2 && !lo.some((v) => v !== v));
  }
});

test('notes faster than the hold time all sound and release', () => {
  for (const p of Object.values(techs)) {
    const e = engine({ pick: p });
    for (let i = 0; i < 12; i++) e.post({ type: 'n', t: 0.05 + i * 0.008, s: 2, f: midiHz(OPEN[2] + 2 + (i % 3)), v: 0.8, k: '', fr: true, d: i % 2 ? -1 : 1 });
    const x = render(e, 0.4);
    assert.equal(e.voices[2].contact, 0, `technique ${p}: contact stuck`);
    assert.ok(db(rms(x, 0.14, 0.19)) > -40, `technique ${p}: last note silent`);
    for (let i = 0; i < 12; i++) assert.ok(db(rms(x, 0.05 + i * 0.008, 0.058 + i * 0.008)) > -45, `technique ${p}: note ${i} missing`);
  }
});
