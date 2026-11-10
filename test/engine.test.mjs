import test from 'node:test';
import assert from 'node:assert/strict';
import { FS, OPEN, midiHz, spectrum, peakNear, bandEnergy, db, rms, peak, engine, render, note, cachedBody } from './util.mjs';

const N = 1 << 16;

test('plucked notes are in tune', () => {
  for (const preset of ['steel', 'nylon']) {
    for (const [s, fret] of [[0, 0], [1, 3], [3, 9], [5, 0], [5, 12]]) {
      const f = midiHz(OPEN[s] + fret);
      const x = note(s, fret, {}, { preset });
      const p = peakNear(spectrum(x, 4800, N), N, f);
      assert.ok(Math.abs(1200 * Math.log2(p.f / f)) < 1.5, `${preset} s${s} f${fret}: ${p.f} vs ${f}`);
    }
  }
});

test('natural harmonics ring at the node partial and kill the fundamental', () => {
  for (const [s, fret, n] of [[0, 12, 2], [0, 7, 3], [0, 5, 4], [3, 12, 2], [5, 12, 2], [5, 7, 3], [2, 19, 3]]) {
    const f0 = midiHz(OPEN[s]);
    const x = note(s, 0, { k: '*', hb: Math.pow(2, -fret / 12) });
    const m = spectrum(x, FS * 0.5, N);
    const fund = peakNear(m, N, f0).mag, harm = peakNear(m, N, f0 * n).mag;
    assert.ok(db(harm) - db(fund) > 28, `s${s} fret ${fret}: partial ${n} only ${(db(harm) - db(fund)).toFixed(1)} dB above fundamental`);
    // it should still ring, not just thud
    const normal = note(s, 0);
    assert.ok(db(rms(x, 1.0, 1.2)) > db(rms(normal, 1.0, 1.2)) - 22, `s${s} fret ${fret}: harmonic too quiet`);
  }
});

test('a harmonic away from any node is mostly muted', () => {
  const x = note(0, 0, { k: '*', hb: Math.pow(2, -6 / 12) });
  const normal = note(0, 0);
  assert.ok(db(rms(x, 0.6, 0.8)) < db(rms(normal, 0.6, 0.8)) - 20);
});

test('palm mute keeps the attack but shortens and darkens the note', () => {
  for (const [s, fret] of [[0, 0], [0, 3], [1, 2], [2, 2], [4, 1]]) {
    const pm = note(s, fret, { k: 'm' }), normal = note(s, fret);
    assert.ok(db(rms(pm, 0.01, 0.05)) > db(rms(normal, 0.01, 0.05)) - 9, `s${s} f${fret}: attack lost`);
    const drop = db(rms(normal, 0.5, 0.6)) - db(rms(pm, 0.5, 0.6));
    assert.ok(drop > 15 && drop < 70, `s${s} f${fret}: level drop at 0.5 s is ${drop.toFixed(1)} dB`);
    // highs die faster than lows compared with the open note
    const a = spectrum(pm, FS * 0.08, 8192), b = spectrum(normal, FS * 0.08, 8192);
    const tilt = (m) => db(Math.sqrt(bandEnergy(m, 8192, 1500, 6000))) - db(Math.sqrt(bandEnergy(m, 8192, 60, 500)));
    assert.ok(tilt(a) < tilt(b) - 6, `s${s} f${fret}: not darker (${tilt(a).toFixed(1)} vs ${tilt(b).toFixed(1)})`);
  }
});

test('palm-muted notes stay in tune', () => {
  const f = midiHz(OPEN[1] + 2);
  const x = note(1, 2, { k: 'm' });
  const p = peakNear(spectrum(x, 2400, 16384), 16384, f);
  assert.ok(Math.abs(1200 * Math.log2(p.f / f)) < 12, `${p.f} vs ${f}`);
});

test('dead notes are a short thud', () => {
  const x = note(1, 5, { k: 'x' });
  assert.ok(peak(x, 0, 0.05) > 0.02);
  assert.ok(db(rms(x, 0.25, 0.35)) < db(rms(x, 0.01, 0.04)) - 40);
});

test('stopping a string silences it quickly', () => {
  const e = engine();
  e.post({ type: 'n', t: 0.01, s: 1, f: midiHz(45), v: 0.9, k: '', fr: false, d: 1 });
  e.post({ type: 'o', t: 0.5, s: 1 });
  const x = render(e, 1.2);
  assert.ok(db(rms(x, 0.85, 0.95)) < db(rms(x, 0.4, 0.5)) - 40);
});

test('a touched string can be played normally again', () => {
  const e = engine();
  const f = midiHz(OPEN[0] + 3);
  e.post({ type: 'n', t: 0.01, s: 0, f, v: 0.8, k: 'm', fr: true, d: 1 });
  e.post({ type: 'n', t: 0.4, s: 0, f, v: 0.8, k: '', fr: true, d: 1 });
  const x = render(e, 2);
  const ref = note(0, 3, {}, {}, 2);
  assert.ok(Math.abs(db(rms(x, 1.4, 1.6)) - db(rms(ref, 1.01, 1.21))) < 4);
});

test('finger travel makes a quiet band-limited squeak on wound strings', () => {
  const run = (fingerNoise, s) => {
    const e = engine({ fingerNoise });
    e.post({ type: 'q', t: 0.05, s, dur: 0.14, amt: 1 });
    return render(e, 0.5);
  };
  const ref = peak(note(1, 3));
  const sq = run(1, 1);
  const lv = db(peak(sq)) - db(ref);
  assert.ok(lv > -40 && lv < -8, `squeak peak ${lv.toFixed(1)} dB re note`);
  const m = spectrum(sq, FS * 0.05, 8192);
  const mid = bandEnergy(m, 8192, 700, 8000), all = bandEnergy(m, 8192, 20, 20000);
  assert.ok(mid / all > 0.7, `only ${(100 * mid / all).toFixed(0)}% of the energy in 0.7-8 kHz`);
  assert.equal(peak(run(0, 1)), 0);
  // plain strings only hiss
  assert.ok(peak(run(1, 5)) < peak(sq) * 0.5);
});

test('a travelling finger lets the old note die', () => {
  const run = (shift) => {
    const e = engine({ fingerNoise: 0 });
    e.post({ type: 'n', t: 0.01, s: 1, f: midiHz(OPEN[1] + 3), v: 0.8, k: '', fr: true, d: 1 });
    if (shift) e.post({ type: 'q', t: 0.3, s: 1, dur: 0.12, amt: 0 });
    return render(e, 0.6);
  };
  const a = run(true), b = run(false);
  assert.ok(db(rms(a, 0.2, 0.28)) > db(rms(b, 0.2, 0.28)) - 0.5);
  assert.ok(db(rms(a, 0.38, 0.42)) < db(rms(b, 0.38, 0.42)) - 15);
});

test('slides add friction noise while the finger moves', () => {
  const run = (fingerNoise) => {
    const e = engine({ fingerNoise });
    e.post({ type: 'n', t: 0.01, s: 1, f: midiHz(OPEN[1] + 3), v: 0.8, k: '', fr: true, d: 1 });
    e.post({ type: 'n', t: 0.4, s: 1, f: midiHz(OPEN[1] + 8), v: 0.8, k: 's', fr: true, d: 1 });
    const x = render(e, 1);
    const m = spectrum(x, FS * 0.4, 8192);
    return bandEnergy(m, 8192, 5000, 9000);
  };
  assert.ok(run(1) > run(0) * 4);
});

test('combined techniques and a storm of events stay bounded', () => {
  for (const preset of ['steel', 'nylon', 'twelve']) {
    const e = engine({ preset, fingerNoise: 1 });
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const techs = ['', 'm', 'mh', 'ms', 'x', '*', 'v', 'b', 'h', 's', 'mv', 'mb'];
    for (let t = 0.02; t < 8; t += 0.03 + rnd() * 0.08) {
      const s = (rnd() * 6) | 0, fret = (rnd() * 20) | 0, k = techs[(rnd() * techs.length) | 0];
      const r = rnd();
      if (r < 0.08) e.post({ type: 'o', t, s });
      else if (r < 0.2) e.post({ type: 'q', t, s, dur: 0.05 + rnd() * 0.2, amt: rnd() });
      else e.post({ type: 'n', t, s, f: midiHz(OPEN[s] + (k === '*' ? 0 : fret)), v: 0.4 + rnd() * 0.7, k, fr: fret > 0 && k !== '*', d: rnd() < 0.5 ? 1 : -1, hb: k === '*' ? Math.pow(2, -fret / 12) : undefined });
    }
    e.post({ type: 'O', t: 8.5 });
    const x = render(e, 10);
    const p = peak(x);
    assert.ok(Number.isFinite(p) && p < 4, `${preset}: peak ${p}`);
    assert.ok(!x.some((v) => v !== v), `${preset}: NaN`);
    assert.ok(db(rms(x, 9.6, 9.9)) < -50, `${preset}: does not die away (${db(rms(x, 9.6, 9.9)).toFixed(1)} dB)`);
  }
});

test('the engine renders six channels that add up to the mono output', () => {
  const play = (e) => {
    [[0, 3], [2, 2], [3, 0], [5, 3]].forEach(([s, fret], i) => e.post({ type: 'n', t: 0.02 + i * 0.01, s, f: midiHz(OPEN[s] + fret), v: 0.8, k: '', fr: fret > 0, d: 1 }));
  };
  const a = engine(), b = engine();
  play(a); play(b);
  const mono = render(a, 0.5);
  const n = mono.length, ch = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(n));
  for (let i = 0; i < n; i += 128) b.render(ch.map((c) => c.subarray(i, i + 128)), 128, i);
  const mixH = 0.6; // steel
  for (let i = 0; i < n; i += 97) assert.ok(Math.abs(mono[i] - (ch[0][i] + ch[1][i] + ch[2][i] + mixH * (ch[3][i] + ch[4][i] + ch[5][i]))) < 1e-5, `sample ${i}`);
  // strings from every part of the bridge were played: all six channels carry signal
  for (const c of [0, 1, 2, 3, 4, 5]) assert.ok(peak(ch[c]) > 0.01, `channel ${c} is silent`);
  // only string 2-3 notes land in the middle zone
  const e = engine();
  e.post({ type: 'n', t: 0.02, s: 0, f: midiHz(43), v: 0.8, k: '', fr: true, d: 1 });
  const one = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(4096));
  for (let i = 0; i < 4096; i += 128) e.render(one.map((c) => c.subarray(i, i + 128)), 128, i);
  assert.ok(peak(one[0]) > 0.05 && peak(one[1]) < 1e-3 && peak(one[2]) < 1e-3);
  assert.ok(peak(one[3]) > 0.01 && peak(one[4]) < 1e-3 && peak(one[5]) < 1e-3);
});

test('changing a setting while playing does not let stopped strings and dead notes ring again', () => {
  for (const bridged of [false, true]) {
    const run = (cfgAt) => {
      const e = engine(bridged ? { bridge: cachedBody('steel').bridge, coupling: 0.4 } : {});
      e.post({ type: 'n', t: 0.01, s: 1, f: midiHz(45), v: 0.9, k: '', fr: false, d: 1 });
      e.post({ type: 'o', t: 0.3, s: 1 });
      e.post({ type: 'n', t: 0.31, s: 3, f: midiHz(60), v: 0.9, k: 'x', fr: true, d: 1 });
      const out = new Float32Array(Math.floor((0.9 * FS) / 128) * 128);
      for (let i = 0; i < out.length; i += 128) {
        // what the app sends on every slider move
        if (cfgAt != null && i === Math.floor((cfgAt * FS) / 128) * 128) e.configure({ preset: 'steel', open: OPEN, sustain: 0.1, bright: 0.1, ...(bridged ? { bridge: cachedBody('steel').bridge, coupling: 0.4 } : {}) });
        e.render(out.subarray(i, i + 128), 128, i);
      }
      return db(rms(out, 0.5, 0.8));
    };
    assert.ok(run(0.32) < run(null) + 3, `${bridged ? 'modelled' : 'rigid'}: ${run(0.32).toFixed(1)} dB after a setting change vs ${run(null).toFixed(1)} dB without`);
  }
});
