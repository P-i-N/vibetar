import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/song.js';
import { DEMOS } from '../js/demos.js';
import { SONGS } from './songs.mjs';
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

// Level (dB) and octave bands 125 Hz - 4 kHz of these demos as the earlier, hand-tuned body
// played them: the reference the body model was calibrated to.
const REFERENCE = {
  'First Light': { rms: -18.3, bands: [54.7, 62.9, 56.3, 53.9, 45.2, 39.7] },
  'Romance (trad.)': { rms: -18.1, bands: [57.1, 61.9, 57.6, 52, 42.8, 21.5] },
  'Campfire': { rms: -18.4, bands: [57.3, 59.9, 58.7, 57.3, 51.2, 42.5] },
  'Night Drive': { rms: -19.2, bands: [55.3, 62.2, 53, 51.5, 43.6, 39] },
};

test('demo songs keep their level and balance', () => {
  for (const d of [...SONGS, ...DEMOS]) {
    const song = d.make(), m = stats(renderMix(song)), c = REFERENCE[song.title];
    // the song's master volume: 0.8 (the default) for a setting of 0.8
    const vol = song.fx.vol ** 2 * 1.25;
    // only the tips of the loudest attacks reach into the soft clipper's knee (it is linear to
    // 0.62 and rounds off towards 0.98)
    assert.ok(m.peak * vol <= 1.1, `${song.title}: peak ${m.peak.toFixed(2)} at volume ${vol.toFixed(2)}`);
    const level = m.rms + 20 * Math.log10(vol / 0.8);
    if (!c) { assert.ok(level > -30 && level < -14, `${song.title}: level ${level.toFixed(1)} dB`); continue; }
    assert.ok(Math.abs(m.rms - c.rms) < 3, `${song.title}: level ${(m.rms - c.rms).toFixed(1)} dB from the reference`);
    m.bands.forEach((v, i) => assert.ok(Math.abs(v - c.bands[i]) < 6, `${song.title}: ${125 * 2 ** i} Hz band ${(v - c.bands[i]).toFixed(1)} dB from the reference`));
  }
});

test('instruments start with a string coupling below the computed value', () => {
  for (const name of ['steel', 'nylon', 'twelve']) assert.ok(S.INSTRUMENTS[name].coupling > 0 && S.INSTRUMENTS[name].coupling <= 1);
});
