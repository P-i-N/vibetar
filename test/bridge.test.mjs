import test from 'node:test';
import assert from 'node:assert/strict';
import { FS, OPEN, midiHz, spectrum, peakNear, db, rms, peak, engine, render, cachedBody, convolve, aLevel } from './util.mjs';

const coupled = (cfg = {}, fs = FS, name = 'steel') => engine({ preset: name, bridge: cachedBody(name, fs).bridge, coupling: 1, ...cfg }, fs);
const classic = (cfg = {}) => engine({ bridge: null, ...cfg });
const pluck = (e, s, fret, t = 0.02, open = OPEN) => e.post({ type: 'n', t, s, f: midiHz(open[s] + fret), v: 0.8, k: '', fr: fret > 0, d: 1 });
const energy = (v) => { let e = 0; for (let i = 0; i < v.bv.length; i++) e += v.bv[i] ** 2 + v.bh[i] ** 2; return e; };
// seconds until the level has fallen by `drop` dB from its value shortly after the attack
function decayTime(x, drop, fs = FS) {
  const ref = db(rms(x, 0.05, 0.10, fs));
  for (let t = 0.1; t + 0.05 < x.length / fs; t += 0.02) if (db(rms(x, t, t + 0.05, fs)) < ref - drop) return t;
  return x.length / fs;
}

test('notes stay within 3 cents with the bridge', () => {
  const top = cachedBody('steel').info.top;
  const N = 1 << 16;
  for (const [s, fret] of [[0, 0], [1, 3], [3, 0], [3, 12], [5, 0], [5, 12]]) {
    const e = coupled(), f = midiHz(OPEN[s] + fret);
    pluck(e, s, fret);
    const x = render(e, 2.5);
    const c = 1200 * Math.log2(peakNear(spectrum(x, 4800, N), N, f).f / f);
    assert.ok(Math.abs(c) < 3, `s${s} f${fret} (${f.toFixed(0)} Hz, top resonance ${top.toFixed(0)}): ${c.toFixed(2)} cents`);
  }
});

test('the bridge only removes energy', () => {
  for (const preset of ['steel', 'nylon', 'twelve']) {
    const e = coupled({ fingerNoise: 1 }, FS, preset);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const techs = ['', 'm', 'mh', 'ms', 'x', '*', 'v', 'b', 'h', 's'];
    for (let t = 0.02; t < 8; t += 0.03 + rnd() * 0.08) {
      const s = (rnd() * 6) | 0, fret = (rnd() * 20) | 0, k = techs[(rnd() * techs.length) | 0];
      if (rnd() < 0.08) e.post({ type: 'o', t, s });
      else e.post({ type: 'n', t, s, f: midiHz(OPEN[s] + (k === '*' ? 0 : fret)), v: 0.4 + rnd() * 0.7, k, fr: fret > 0 && k !== '*', d: rnd() < 0.5 ? 1 : -1, hb: k === '*' ? Math.pow(2, -fret / 12) : undefined });
    }
    e.post({ type: 'O', t: 8.5 });
    const x = render(e, 10);
    assert.ok(Number.isFinite(peak(x)) && peak(x) < 4, `${preset}: peak ${peak(x)}`);
    assert.ok(!x.some((v) => v !== v), `${preset}: NaN`);
    assert.ok(db(rms(x, 9.6, 9.9)) < -50, `${preset}: does not die away (${db(rms(x, 9.6, 9.9)).toFixed(1)} dB)`);
  }
});

test('with nothing played and no losses added, a ringing string never gains energy', () => {
  const e = coupled();
  pluck(e, 3, 0);
  render(e, 0.3);
  let last = e.voices.reduce((a, v) => a + energy(v), 0);
  for (let i = 0; i < 20; i++) {
    const out = new Float32Array(4096);
    for (let j = 0; j < 4096; j += 128) e.render(out.subarray(j, j + 128), 128, 14400 + i * 4096 + j);
    const now = e.voices.reduce((a, v) => a + energy(v), 0);
    assert.ok(now <= last * 1.02, `string energy grew: ${last} -> ${now}`);
    last = now;
  }
});

// seconds until the note's fundamental has fallen by `drop` dB (the other partials keep ringing)
function partialDecay(x, f, drop) {
  const n = 4096, lv = (t) => db(peakNear(spectrum(x, Math.floor(t * FS), n), n, f).mag);
  const ref = lv(0.03);
  for (let t = 0.05; t + n / FS < x.length / FS; t += 0.01) if (lv(t) < ref - drop) return t;
  return x.length / FS;
}

test('a note on the main top resonance loses its fundamental faster than its neighbours', () => {
  const top = cachedBody('steel').info.top;
  const m0 = Math.round(69 + 12 * Math.log2(top / 440));  // nearest note, played on the D string
  const t = (m) => { const e = coupled(); e.post({ type: 'n', t: 0.02, s: 2, f: midiHz(m), v: 0.8, k: '', fr: true, d: 1 }); return partialDecay(render(e, 4), midiHz(m), 6); };
  // the first 6 dB: the towards-top motion is drained at once; the along-top motion rings on
  const on = t(m0), near = (t(m0 - 3) + t(m0 + 3)) / 2;
  assert.ok(on < 0.5 * near, `on the resonance ${on.toFixed(2)} s, neighbours ${near.toFixed(2)} s`);
  // and without the bridge there is no such difference
  const u = (m) => { const e = classic(); e.post({ type: 'n', t: 0.02, s: 2, f: midiHz(m), v: 0.8, k: '', fr: true, d: 1 }); return partialDecay(render(e, 4), midiHz(m), 6); };
  assert.ok(u(m0) > 0.8 * (u(m0 - 3) + u(m0 + 3)) / 2);
});

test('sympathetic strings ring through the body', () => {
  const run = (coupling) => {
    const e = coupled({ coupling });
    pluck(e, 5, 0); // E4; the open low E (two octaves below) is left untouched
    render(e, 1);
    return db(Math.sqrt(energy(e.voices[0]) / energy(e.voices[5])));
  };
  assert.ok(run(1) > -45, `coupled: ${run(1).toFixed(1)} dB`);
  assert.ok(run(0) < -90, `uncoupled: ${run(0).toFixed(1)} dB`);
});

test('two-stage decay: towards-top motion dies faster than along-top motion', () => {
  const e = coupled();
  pluck(e, 2, 2);
  render(e, 0.3);
  const en = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return s; };
  const v = e.voices[2], v0 = en(v.bv), h0 = en(v.bh);
  const out = new Float32Array(128);
  for (let i = 0; i < FS; i += 128) e.render(out, 128, 14400 + i);
  const rateV = Math.log(v0 / en(v.bv)), rateH = Math.log(h0 / en(v.bh));
  assert.ok(rateV > 1.5 * rateH, `towards-top ${rateV.toFixed(2)}, along-top ${rateH.toFixed(2)} (nepers of energy per second)`);
});

// (sustain against the classic body is checked on the heard signal, in heard.test.mjs)

test('works at 44.1 kHz, in drop D and with a capo', () => {
  const N = 1 << 16;
  {
    const fs = 44100, e = coupled({}, fs), f = midiHz(OPEN[3] + 2);
    e.post({ type: 'n', t: 0.02, s: 3, f, v: 0.8, k: '', fr: true, d: 1 });
    const x = render(e, 2.5, fs);
    assert.ok(Math.abs(1200 * Math.log2(peakNear(spectrum(x, 4410, N), N, f, fs).f / f)) < 3);
  }
  {
    const tune = [38, 45, 50, 55, 59, 64], open = tune.map((m) => m + 7); // drop D, capo at fret 7
    const e = coupled({ open, tune }), f = midiHz(open[0] + 2);
    e.post({ type: 'n', t: 0.02, s: 0, f, v: 0.9, k: '', fr: true, d: 1 });
    const x = render(e, 2.5);
    assert.ok(peak(x) < 2 && !x.some((v) => v !== v));
    assert.ok(Math.abs(1200 * Math.log2(peakNear(spectrum(x, 4800, N), N, f).f / f)) < 3);
  }
});

test('note loudness across the range is more even once the strings feel the bridge', () => {
  const b = cachedBody('steel');
  const spread = (make) => {
    const lv = [];
    for (let m = 40; m <= 84; m++) {
      let s = 5;
      while (s > 0 && OPEN[s] > m) s--;
      if (m - OPEN[s] > 4 && s < 5 && m >= OPEN[s + 1]) s++;
      const e = make();
      e.post({ type: 'n', t: 0.02, s, f: midiHz(m), v: 0.8, k: '', fr: m > OPEN[s], d: 1 });
      const n = FS, ch = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(n - (n % 128)));
      for (let i = 0; i + 128 <= n; i += 128) e.render(ch.map((c) => c.subarray(i, i + 128)), 128, i);
      const z = s >> 1;
      const y = convolve(ch[z], b.irs[2 * z]), r = convolve(ch[3 + z], b.irs[6 + 2 * z]);
      for (let i = 0; i < y.length; i++) y[i] += r[i];
      lv.push(aLevel(y, 0, 16384));
    }
    const mean = lv.reduce((a, c) => a + c) / lv.length;
    return Math.sqrt(lv.reduce((a, c) => a + (c - mean) ** 2, 0) / lv.length);
  };
  const withBridge = spread(() => coupled()), without = spread(() => classic());
  assert.ok(withBridge < without, `coupled ${withBridge.toFixed(2)} dB, uncoupled ${without.toFixed(2)} dB`);
  assert.ok(withBridge <= 4.0, `standard deviation ${withBridge.toFixed(2)} dB`);
});

test('the coupled 12-string renders comfortably faster than real time', () => {
  const e = coupled({}, FS, 'twelve');
  for (let t = 0.02; t < 10; t += 0.05) pluck(e, Math.floor((t * 20) % 6), 3, t);
  const t0 = performance.now();
  render(e, 10);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `10 s rendered in ${ms.toFixed(0)} ms`);
});
