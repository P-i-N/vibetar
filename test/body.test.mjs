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
