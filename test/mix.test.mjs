import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/song.js';
import { fft } from '../js/ir.js';
import { FS, db, renderMix } from './util.mjs';

function stats(x) {
  let pk = 0, s = 0;
  for (const v of x) { pk = Math.max(pk, Math.abs(v)); s += v * v; }
  const N = 32768, acc = new Float64Array(6);
  let frames = 0;
  for (let st = 0; st + N < x.length; st += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[st + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    let k = 0;
    for (let fc = 125; fc <= 4000; fc *= 2, k++) for (let i = Math.floor((fc / Math.SQRT2) * N / FS); i < Math.floor(fc * Math.SQRT2 * N / FS); i++) acc[k] += re[i] ** 2 + im[i] ** 2;
    frames++;
  }
  return { peak: pk, rms: db(Math.sqrt(s / x.length)), bands: Array.from(acc, (v) => 10 * Math.log10(v / frames)) };
}

test('demo songs keep their level and balance on the modelled body', () => {
  for (const d of S.DEMOS) {
    const song = d.make();
    if (song.inst.preset === 'bowed') continue;
    const c = stats(renderMix(song, false)), m = stats(renderMix(song, true));
    assert.ok(Math.abs(m.rms - c.rms) < 3, `${song.title}: level ${(m.rms - c.rms).toFixed(1)} dB from classic`);
    // at the default master volume (0.8) the mix stays below full scale before the soft clipper
    assert.ok(m.peak * 0.8 <= 1.0, `${song.title}: peak ${m.peak.toFixed(2)}`);
    m.bands.forEach((v, i) => assert.ok(Math.abs(v - c.bands[i]) < 6, `${song.title}: ${125 * 2 ** i} Hz band ${(v - c.bands[i]).toFixed(1)} dB from classic`));
  }
});

test('new songs start on the modelled body with physical string coupling', () => {
  for (const name of ['steel', 'nylon', 'twelve']) {
    assert.equal(S.INSTRUMENTS[name].bodyModel, 1);
    assert.equal(S.INSTRUMENTS[name].symp, 1);
  }
});
