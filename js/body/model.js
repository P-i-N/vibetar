// The body model, start to finish: geometry -> resonances -> what the
// microphones hear and what the strings feel.

import { INSTRUMENTS } from './instruments.js';
import { coupleBody, plateConductance } from './couple.js';
import { micTransfer } from './radiate.js';
import { fft, denseField, bodyTarget } from '../ir.js';

export const MODEL_VERSION = 4;
export const BRIDGE_MODES = 24;      // resonances that also run inside the string engine
const LENGTH = 0.42;                 // seconds of impulse response
const XFADE = [3000, 5000];          // modelled range fades out, statistical field fades in
const MATCH = [2000, 3500];          // where the statistical field takes its level from the model

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// buildBody(name, fs) -> {
//   version, name, fs,
//   irs: 12 Float32Arrays, left and right microphone for each of: force towards the top on the
//        bass / middle / treble part of the bridge, then force along the top (which rocks the
//        bridge) on the same three parts,
//   bridge: { K, f, eta, phi[6 x K], rock[6 x K], z[6], gRes },
//   info: { air, top, modes, ms } }
export function buildBody(name, fs) {
  const t0 = now();
  const inst = INSTRUMENTS[name];
  if (!inst) throw new Error(`no modelled body for "${name}"`);
  const body = coupleBody(inst);
  const K = body.K;
  const len = Math.floor(LENGTH * fs);
  let nfft = 1;
  while (nfft < 2 * len) nfft <<= 1;
  const half = nfft / 2;

  // how a force on each bridge zone, and a rocking force, excites the resonances
  const drives = [[0, 1], [2, 3], [4, 5]].map((pair) => {
    const d = new Float64Array(K);
    for (let k = 0; k < K; k++) d[k] = 0.5 * (body.phi[pair[0] * K + k] + body.phi[pair[1] * K + k]);
    return d;
  });
  // rocking, per part of the bridge: the two sides tilt it in opposite senses for the
  // main (symmetric) resonances, so one average over all strings would cancel them
  for (const pair of [[0, 1], [2, 3], [4, 5]]) {
    const d = new Float64Array(K);
    for (let k = 0; k < K; k++) d[k] = 0.5 * (body.rock[pair[0] * K + k] + body.rock[pair[1] * K + k]);
    drives.push(d);
  }
  const spectra = micTransfer(body, inst, drives, fs, nfft); // [mic][drive]

  const bin = (f) => Math.round((f * nfft) / fs);
  const power = (s, lo, hi) => { let p = 0; for (let b = bin(lo); b < bin(hi); b++) p += s.re[b] ** 2 + s.im[b] ** 2; return p / (bin(hi) - bin(lo)); };

  // above the modelled range: a statistical field at the level the model ends on
  const wM = new Float64Array(half + 1), wD = new Float64Array(half + 1);
  for (let b = 0; b <= half; b++) {
    const f = (b * fs) / nfft;
    const u = f <= XFADE[0] ? 0 : f >= XFADE[1] ? 1 : Math.log(f / XFADE[0]) / Math.log(XFADE[1] / XFADE[0]);
    wM[b] = Math.cos((Math.PI / 2) * u); wD[b] = Math.sin((Math.PI / 2) * u);
  }
  const target = bodyTarget(name);
  const fields = [];
  for (let d = 0; d < drives.length; d++) {
    const field = denseField(fs, len, target, 7919 * (d + 1) + name.length, 2000);
    for (let m = 0; m < 2; m++) {
      const re = new Float64Array(nfft), im = new Float64Array(nfft);
      const shift = Math.round(spectra[m][d].delay * fs), src = m ? field.R : field.L;
      for (let i = 0; i + shift < len; i++) re[i + shift] = src[i];
      fft(re, im);
      fields.push({ re, im });
    }
  }
  // Up there the top answers a force alike wherever on the bridge it acts: one level for the
  // three parts of the bridge and both microphones, another for rocking. Matching each
  // response on its own would copy the few resonances near the top of the modelled range.
  const level = (ds) => {
    let pm = 0, pd = 0;
    for (const d of ds) for (let m = 0; m < 2; m++) { pm += power(spectra[m][d], MATCH[0], MATCH[1]); pd += power(fields[2 * d + m], MATCH[0], MATCH[1]); }
    return Math.sqrt(pm / pd);
  };
  const gains = [level([0, 1, 2]), level([3, 4, 5])];
  const irs = [];
  for (let d = 0; d < drives.length; d++) {
    for (let m = 0; m < 2; m++) {
      const spec = spectra[m][d], dense = fields[2 * d + m], { re, im } = dense;
      const gain = gains[d < 3 ? 0 : 1];
      for (let b = 0; b <= half; b++) {
        re[b] = spec.re[b] * wM[b] + gain * wD[b] * dense.re[b];
        im[b] = spec.im[b] * wM[b] + gain * wD[b] * dense.im[b];
      }
      re[0] = 0; im[0] = 0;
      for (let b = 1; b < half; b++) { re[nfft - b] = re[b]; im[nfft - b] = -im[b]; }
      // inverse FFT of a Hermitian spectrum: conjugate, forward transform, scale
      for (let b = 0; b < nfft; b++) im[b] = -im[b];
      fft(re, im);
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = re[i] / nfft;
      irs.push(out);
    }
  }
  // one gain for all responses: over 150 Hz - 2 kHz the bridge zones have unity power gain,
  // averaged over third-octave bands (so every part of the range counts the same)
  let p = 0, bands = 0;
  for (let c = 0; c < 6; c++) {
    const re = new Float64Array(nfft), im = new Float64Array(nfft);
    re.set(irs[c]); fft(re, im);
    for (let fc = 150; fc <= 2000; fc *= Math.pow(2, 1 / 3)) { p += power({ re, im }, fc / Math.pow(2, 1 / 6), fc * Math.pow(2, 1 / 6)); bands++; }
  }
  const norm = 1 / Math.sqrt(p / bands), fade = Math.floor(0.03 * fs);
  for (const h of irs) for (let i = 0; i < len; i++) h[i] *= norm * (i > len - fade ? (len - i) / fade : 1);

  const KB = Math.min(BRIDGE_MODES, K);
  const bridge = { K: KB, f: body.f.slice(0, KB), eta: body.eta.slice(0, KB), phi: new Float64Array(6 * KB), rock: new Float64Array(6 * KB), z: body.z.slice(), gRes: plateConductance(inst) };
  for (let s = 0; s < 6; s++) for (let k = 0; k < KB; k++) { bridge.phi[s * KB + k] = body.phi[s * K + k]; bridge.rock[s * KB + k] = body.rock[s * K + k]; }

  let top = 0, best = 0;
  for (let k = 0; k < K; k++) {
    if (body.f[k] < 150 || body.f[k] > 260) continue;
    let s = 0;
    for (let i = 0; i < 6; i++) s += Math.abs(body.phi[i * K + k]);
    if (s > best) { best = s; top = body.f[k]; }
  }
  return { version: MODEL_VERSION, name, fs, irs, bridge, info: { air: body.f[0], top, modes: K, ms: Math.round(now() - t0) } };
}
