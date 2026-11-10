import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, outlineGrid } from '../js/body/instruments.js';
import { assemblePlate } from '../js/body/plate.js';
import { cavityModes } from '../js/body/cavity.js';
import { coupleBody } from '../js/body/couple.js';

const memo = new Map();
const body = (name) => { if (!memo.has(name)) memo.set(name, coupleBody(INSTRUMENTS[name])); return memo.get(name); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
// how strongly mode k moves the bridge (mean over the six saddle points)
const bridge = (b, k) => { let s = 0; for (let i = 0; i < 6; i++) s += Math.abs(b.phi[i * b.K + k]); return s / 6; };
function strongestBridgeMode(b, lo, hi) {
  let best = -1;
  for (let k = 0; k < b.K; k++) if (b.f[k] >= lo && b.f[k] <= hi && (best < 0 || bridge(b, k) > bridge(b, best))) best = k;
  return best;
}
const countBelow = (b, f) => [...b.f].filter((x) => x < f).length;
// net volume the top displaces in mode k
const topVolume = (b, k) => { let v = 0; const n = b.grid.nx * b.grid.ny; for (let i = 0; i < n; i++) v += b.shapeTop[k * n + i]; return v * b.grid.h ** 2; };

test('instrument geometry is plausible', () => {
  const inst = INSTRUMENTS.steel;
  const g = outlineGrid(inst, 0.008, true);
  const area = [...g.type].filter((t) => t > 0).length * g.h ** 2;
  assert.ok(area > 0.125 && area < 0.160, `top area ${area}`);
  const mass = sum(assemblePlate(g, inst.top).M);
  assert.ok(mass > 0.22 && mass < 0.40, `top mass ${mass}`);
  const vol = area * inst.depth;
  assert.ok(vol > 0.012 && vol < 0.018, `cavity volume ${vol}`);
});

test('the cavity has a uniform mode and a first standing wave along the body', () => {
  const inst = INSTRUMENTS.steel;
  const air = cavityModes(outlineGrid(inst, 0.008, false), inst.depth, 6);
  assert.ok(air.f[0] < 1);
  assert.ok(air.f[1] > 320 && air.f[1] < 450, `first air mode ${air.f[1]}`);
  const n = air.psi.length / 6;
  let ms = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (air.mask[i]) { ms += air.psi[n + i] ** 2; cnt++; }
  assert.ok(Math.abs(ms / cnt - 1) < 1e-6, 'modes are normalised to mean square 1');
});

test('steel-string resonances land where real guitars have them', () => {
  const b = body('steel');
  const air = b.f[0], top = b.f[strongestBridgeMode(b, 150, 260)];
  assert.ok(air >= 90 && air <= 110, `air resonance ${air}`);
  assert.ok(top >= 170 && top <= 215, `main top resonance ${top}`);
  assert.ok(countBelow(b, 3500) >= 150, `${countBelow(b, 3500)} modes below 3.5 kHz`);
});

test('the classical guitar sits lower than the steel-string', () => {
  const n = body('nylon'), s = body('steel');
  const top = (b) => b.f[strongestBridgeMode(b, 140, 260)];
  assert.ok(n.f[0] >= 85 && n.f[0] <= 105, `air resonance ${n.f[0]}`);
  assert.ok(top(n) >= 160 && top(n) <= 205, `main top resonance ${top(n)}`);
  assert.ok(top(n) < top(s));
});

test('the 12-string body builds and has a low air resonance', () => {
  const b = body('twelve');
  assert.ok(b.f[0] >= 80 && b.f[0] <= 110, `air resonance ${b.f[0]}`);
});

test('at the air resonance hole and top move against each other, at the top resonance together', () => {
  const b = body('steel');
  const t = strongestBridgeMode(b, 150, 260);
  assert.ok(b.hole[0] * topVolume(b, 0) < 0, 'air resonance: opposite');
  assert.ok(b.hole[t] * topVolume(b, t) > 0, 'top resonance: together');
});

test('loss factors give Q between 12 and 80 for every mode below 1 kHz', () => {
  for (const name of ['steel', 'nylon']) {
    const b = body(name);
    for (let k = 0; k < b.K && b.f[k] < 1000; k++) assert.ok(1 / b.eta[k] >= 12 && 1 / b.eta[k] <= 80, `${name} mode ${k} at ${b.f[k].toFixed(0)} Hz: Q ${1 / b.eta[k]}`);
  }
});

test('string impedances follow the string gauges', () => {
  const b = body('steel');
  assert.ok(Math.abs(b.z[0] - 2 * 0.648 * 82.41 * 6.8e-3) < 0.01);
  assert.ok(b.z[0] > b.z[5] * 3);
});

test('the bridge moves most in the main top resonance and the bass side differs from the treble side higher up', () => {
  const b = body('steel');
  const t = strongestBridgeMode(b, 150, 260);
  assert.ok(bridge(b, t) > 2 * bridge(b, 0));
  let differs = 0;
  for (let k = 0; k < b.K; k++) if (b.f[k] > 400 && b.f[k] < 1500 && Math.abs(b.phi[k]) > 1e-9 && Math.abs(b.phi[5 * b.K + k] / b.phi[k] - 1) > 0.3) differs++;
  assert.ok(differs > 5);
});

test('building twice gives identical numbers', () => {
  const a = body('steel'), b = coupleBody(INSTRUMENTS.steel);
  assert.deepEqual([...a.f], [...b.f]);
  assert.deepEqual([...a.phi], [...b.phi]);
});

test('the coupled body builds within its share of the time budget', () => {
  const t0 = performance.now();
  coupleBody(INSTRUMENTS.nylon);
  assert.ok(performance.now() - t0 < 6000);
});

// ---- the bridge as the strings see it ------------------------------------------
import { bridgeAdmittance, plateConductance } from '../js/body/couple.js';

const logFreqs = (lo, hi, n) => Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / (n - 1)));

test('the bridge never supplies energy', () => {
  for (const name of ['steel', 'nylon', 'twelve']) {
    const b = body(name);
    for (const f of logFreqs(40, 5000, 400)) for (let i = 0; i < 6; i++) {
      assert.ok(bridgeAdmittance(b, i, i, f).re >= 0, `${name} string ${i} at ${f.toFixed(0)} Hz`);
      assert.ok(bridgeAdmittance(b, i, i, f, { rockI: true, rockJ: true }).re >= 0);
    }
  }
});

test('reciprocity: string A moves B as much as B moves A', () => {
  const b = body('steel');
  for (const f of [82, 196, 440, 1234, 3000]) {
    const ab = bridgeAdmittance(b, 0, 5, f), ba = bridgeAdmittance(b, 5, 0, f);
    assert.ok(Math.abs(ab.re - ba.re) <= 1e-12 * Math.abs(ab.re) + 1e-18 && Math.abs(ab.im - ba.im) <= 1e-12 * Math.abs(ab.im) + 1e-18);
    const vr = bridgeAdmittance(b, 1, 4, f, { rockJ: true }), rv = bridgeAdmittance(b, 4, 1, f, { rockI: true });
    assert.ok(Math.abs(vr.re - rv.re) <= 1e-12 * Math.abs(vr.re) + 1e-18);
  }
});

test('admittance magnitudes are guitar-like', () => {
  const b = body('steel');
  const mag = (i, f, o) => { const y = bridgeAdmittance(b, i, i, f, o); return Math.hypot(y.re, y.im); };
  const top = b.f[strongestBridgeMode(b, 150, 260)];
  assert.ok(mag(2, top) > 0.02 && mag(2, top) < 0.3, `|Y| at the top resonance ${mag(2, top)} s/kg`);
  const fs = logFreqs(300, 3000, 120);
  const mean = (o) => Math.exp(fs.reduce((a, f) => a + Math.log(mag(2, f, o)), 0) / fs.length);
  assert.ok(mean() > 0.003 && mean() < 0.03, `mean |Y| 300 Hz - 3 kHz ${mean()} s/kg`);
  assert.ok(20 * Math.log10(mean() / mean({ rockI: true, rockJ: true })) > 6, 'rocking is at least 6 dB weaker than vertical motion');
});

test('above the modelled modes the bridge looks like a plate of the top\'s stiffness', () => {
  const g = plateConductance(INSTRUMENTS.steel);
  assert.ok(g > 0.002 && g < 0.03, `conductance ${g} s/kg`);
  assert.ok(plateConductance(INSTRUMENTS.nylon) > g, 'the lighter classical top moves more');
});

// ---- what the microphones hear ---------------------------------------------------
import { makeBodyIR } from '../js/ir.js';
import { MODEL_VERSION } from '../js/body/model.js';
import { FS, OPEN, midiHz, db, engine, render, cachedBody, convolve, rawSpectrum, aLevel } from './util.mjs';

const ZONE = [0, 0, 1, 1, 2, 2]; // bridge zone of each string
// correlation of two responses within a frequency band
function bandCorr(a, b, lo, hi, fs = FS) {
  const n = 65536, A = rawSpectrum(a, n), B = rawSpectrum(b, n);
  let ab = 0, aa = 0, bb = 0;
  for (let i = Math.ceil((lo * n) / fs); i < (hi * n) / fs; i++) {
    ab += A.re[i] * B.re[i] + A.im[i] * B.im[i]; aa += A.re[i] ** 2 + A.im[i] ** 2; bb += B.re[i] ** 2 + B.im[i] ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}
// mean power (dB) of a response per third-octave band
function thirdOctaves(h, lo, hi, fs = FS) {
  const n = 65536, S = rawSpectrum(h, n), out = [];
  for (let fc = lo; fc <= hi; fc *= 2 ** (1 / 3)) {
    let s = 0, c = 0;
    for (let i = Math.floor((fc / 2 ** (1 / 6)) * n / fs); i < Math.ceil(fc * 2 ** (1 / 6) * n / fs); i++) { s += S.re[i] ** 2 + S.im[i] ** 2; c++; }
    out.push([fc, 10 * Math.log10(s / c)]);
  }
  return out;
}

test('the classic body is unchanged', () => {
  const ir = makeBodyIR(48000, 'steel');
  let s = 0;
  for (let i = 0; i < ir.L.length; i++) s += Math.abs(ir.L[i]);
  assert.equal(ir.L.length, 20160);
  assert.ok(Math.abs(s - 10.9627521629) < 1e-8, `checksum ${s}`);
  assert.equal(ir.L[100], -0.004665404558181763);
  assert.equal(ir.R[1000], 0.0007459166226908565);
});

test('the body builds within the time budget and reports its resonances', () => {
  const b = cachedBody('steel');
  assert.ok(b.info.ms < 8000, `built in ${b.info.ms} ms`);
  assert.equal(b.version, MODEL_VERSION);
  assert.ok(b.info.air > 90 && b.info.air < 110 && b.info.top > 170 && b.info.top < 215);
  assert.equal(b.irs.length, 12);
  assert.equal(b.bridge.K, 24);
  assert.equal(b.bridge.phi.length, 6 * 24);
  assert.ok(b.bridge.gRes > 0 && b.bridge.z.length === 6);
});

test('impulse responses are finite, decay, and carry no DC', () => {
  const b = cachedBody('steel');
  for (const h of b.irs) {
    assert.equal(h.length, Math.floor(0.42 * FS));
    let pk = 0, at = 0, sum = 0, abs = 0;
    for (let i = 0; i < h.length; i++) { assert.ok(Number.isFinite(h[i])); if (Math.abs(h[i]) > pk) { pk = Math.abs(h[i]); at = i; } sum += h[i]; abs += Math.abs(h[i]); }
    assert.ok(at < 0.005 * FS, `peak at ${(at / FS * 1000).toFixed(2)} ms`);
    let tail = 0;
    for (let i = h.length - Math.floor(0.03 * FS); i < h.length; i++) tail = Math.max(tail, Math.abs(h[i]));
    assert.ok(db(tail / pk) < -60, `tail ${db(tail / pk).toFixed(1)} dB`);
    assert.ok(Math.abs(sum) < 1e-3 * abs, `DC ${sum / abs}`);
  }
});

test('stereo: the microphones agree in the bass and differ above', () => {
  for (const name of ['steel', 'nylon']) {
    const b = cachedBody(name);
    assert.ok(bandCorr(b.irs[2], b.irs[3], 60, 150) > 0.9, `${name} bass correlation ${bandCorr(b.irs[2], b.irs[3], 60, 150)}`);
    assert.ok(Math.abs(bandCorr(b.irs[2], b.irs[3], 800, 3000)) < 0.6, `${name} mid correlation ${bandCorr(b.irs[2], b.irs[3], 800, 3000)}`);
  }
});

test('the three bridge zones differ above 1 kHz but not below 300 Hz', () => {
  const b = cachedBody('steel');
  assert.ok(bandCorr(b.irs[0], b.irs[4], 60, 300) > 0.95, `low ${bandCorr(b.irs[0], b.irs[4], 60, 300)}`);
  assert.ok(Math.abs(bandCorr(b.irs[0], b.irs[4], 1000, 3000)) < 0.8, `high ${bandCorr(b.irs[0], b.irs[4], 1000, 3000)}`);
});

test('the response has no holes and no seam where the modelled range ends', () => {
  for (const name of ['steel', 'nylon', 'twelve']) {
    const b = cachedBody(name);
    for (const ch of [2, 3]) {
      const bands = thirdOctaves(b.irs[ch], 100, 8000);
      const ref = bands.filter(([f]) => f >= 150 && f <= 2000);
      // against the typical (dB-mean) level: the main top resonance stands well above it, as on a real guitar
      const mean = ref.reduce((a, [, d]) => a + d, 0) / ref.length;
      for (const [f, d] of bands) assert.ok(d - mean < 16 && d - mean > -20, `${name} ch${ch} ${f.toFixed(0)} Hz: ${(d - mean).toFixed(1)} dB`);
      for (let i = 1; i < bands.length; i++) if (bands[i][0] > 3000 && bands[i][0] < 5500) assert.ok(Math.abs(bands[i][1] - bands[i - 1][1]) < 6, `${name} seam at ${bands[i][0].toFixed(0)} Hz: ${(bands[i][1] - bands[i - 1][1]).toFixed(1)} dB`);
    }
  }
});

test('the zones together have unity gain over 150 Hz - 2 kHz', () => {
  const b = cachedBody('steel');
  let s = 0, c = 0;
  for (let z = 0; z < 6; z++) for (const [, d] of thirdOctaves(b.irs[z], 150, 2000)) { s += 10 ** (d / 10); c++; }
  assert.ok(Math.abs(10 * Math.log10(s / c)) < 1.5, `${10 * Math.log10(s / c)} dB`);
});

// Without the strings feeling the bridge, a partial sitting on a body resonance keeps feeding
// it, which exaggerates those notes; the tighter check comes with the coupled bridge.
test('note loudness across the range stays within bounds', () => {
  const b = cachedBody('steel');
  const lv = [];
  for (let m = 40; m <= 84; m++) {
    let s = 5;
    while (s > 0 && OPEN[s] > m) s--;
    if (m - OPEN[s] > 4 && s < 5 && m >= OPEN[s + 1]) s++;
    const e = engine();
    e.post({ type: 'n', t: 0.02, s, f: midiHz(m), v: 0.8, k: '', fr: m > OPEN[s], d: 1 });
    lv.push(aLevel(convolve(render(e, 1), b.irs[ZONE[s] * 2]), 0, 16384));
  }
  const mean = lv.reduce((a, c) => a + c) / lv.length;
  const sd = Math.sqrt(lv.reduce((a, c) => a + (c - mean) ** 2, 0) / lv.length);
  assert.ok(sd <= 5.0, `standard deviation ${sd.toFixed(2)} dB: ${lv.map((v) => (v - mean).toFixed(0)).join(' ')}`);
});

test('44.1 kHz and 96 kHz bodies have the same resonances', () => {
  const ref = cachedBody('steel');
  for (const fs of [44100, 96000]) {
    const b = cachedBody('steel', fs);
    assert.ok(Math.abs(b.info.air / ref.info.air - 1) < 0.005 && Math.abs(b.info.top / ref.info.top - 1) < 0.005);
    assert.equal(b.irs[0].length, Math.floor(0.42 * fs));
    assert.ok(bandCorr(b.irs[2], b.irs[3], 60, 150, fs) > 0.9);
  }
});

test('building the body twice gives identical responses', async () => {
  const { buildBody } = await import('../js/body/model.js');
  const a = cachedBody('nylon'), b = buildBody('nylon', FS);
  for (let c = 0; c < 12; c++) assert.deepEqual(a.irs[c], b.irs[c]);
  assert.deepEqual([...a.bridge.phi], [...b.bridge.phi]);
});

// ---- cache ------------------------------------------------------------------------
import { validBody, cacheKey } from '../js/audio.js';

test('a cached body is only used if it matches version, instrument and sample rate', () => {
  const good = cachedBody('steel');
  assert.ok(validBody(good, 'steel', FS));
  assert.ok(!validBody(good, 'nylon', FS));
  assert.ok(!validBody(good, 'steel', 44100));
  assert.ok(!validBody({ ...good, version: MODEL_VERSION - 1 }, 'steel', FS));
  assert.ok(!validBody({ ...good, irs: good.irs.slice(0, 11) }, 'steel', FS));
  assert.ok(!validBody({ ...good, irs: good.irs.map((h, i) => (i === 3 ? h.subarray(0, 100) : h)) }, 'steel', FS));
  const bad = good.irs.map((h) => h.slice());
  bad[5].fill(NaN, 1000, 20000);
  assert.ok(!validBody({ ...good, irs: bad }, 'steel', FS));
  assert.ok(!validBody({ ...good, bridge: null }, 'steel', FS));
  // a record whose bridge data is incomplete would break the string engine: never usable
  for (const key of ['f', 'eta', 'phi', 'rock', 'z', 'gRes']) assert.ok(!validBody({ ...good, bridge: { ...good.bridge, [key]: undefined } }, 'steel', FS), `bridge.${key} missing`);
  assert.ok(!validBody({ ...good, bridge: { ...good.bridge, eta: good.bridge.eta.slice(0, 5) } }, 'steel', FS));
  assert.ok(!validBody(null, 'steel', FS) && !validBody('junk', 'steel', FS) && !validBody({}, 'steel', FS));
  assert.notEqual(cacheKey('steel', 48000), cacheKey('steel', 44100));
  assert.ok(cacheKey('steel', 48000).includes(String(MODEL_VERSION)));
});
