// Small signal-analysis helpers for the offline engine tests.
import { VibetarEngine, midiHz } from '../js/worklet.js';

export const FS = 48000;
export const OPEN = [40, 45, 50, 55, 59, 64];
export { midiHz };

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Hann-windowed magnitude spectrum of n samples starting at `start`
export function spectrum(x, start, n) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[start + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// strongest bin within +-3% of f: { f (interpolated), mag }
export function peakNear(mag, n, f, fs = FS) {
  const lo = Math.max(1, Math.floor((f * 0.97 * n) / fs)), hi = Math.ceil((f * 1.03 * n) / fs);
  let bi = lo;
  for (let i = lo; i <= hi; i++) if (mag[i] > mag[bi]) bi = i;
  const a = Math.log(mag[bi - 1] + 1e-30), b = Math.log(mag[bi] + 1e-30), c = Math.log(mag[bi + 1] + 1e-30);
  return { f: ((bi + (0.5 * (a - c)) / (a - 2 * b + c)) * fs) / n, mag: mag[bi] };
}

export function bandEnergy(mag, n, f0, f1, fs = FS) {
  let s = 0;
  for (let i = Math.floor((f0 * n) / fs); i < Math.ceil((f1 * n) / fs); i++) s += mag[i] * mag[i];
  return s;
}

export const db = (x) => 20 * Math.log10(x + 1e-30);
export function rms(x, t0, t1, fs = FS) {
  let s = 0;
  const a = Math.floor(t0 * fs), b = Math.floor(t1 * fs);
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}
export function peak(x, t0 = 0, t1 = x.length / FS, fs = FS) {
  let p = 0;
  for (let i = Math.floor(t0 * fs); i < Math.floor(t1 * fs); i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

export function engine(cfg = {}, fs = FS) {
  const e = new VibetarEngine(fs);
  e.configure({ preset: 'steel', open: OPEN, symp: 0, ...cfg });
  return e;
}
export function render(e, secs, fs = FS) {
  const n = Math.floor((secs * fs) / 128) * 128, out = new Float32Array(n);
  for (let i = 0; i < n; i += 128) e.render(out.subarray(i, i + 128), 128, i);
  return out;
}
// one note on an otherwise silent instrument
export function note(s, fret, extra = {}, cfg = {}, secs = 2.5) {
  const e = engine(cfg);
  e.post({ type: 'n', t: 0.01, s, f: midiHz(OPEN[s] + fret), v: 0.8, k: '', fr: fret > 0, d: 1, ...extra });
  return render(e, secs);
}

// brightness: magnitude-weighted spectral centroid (Hz) of x between t0 and t1, 60 Hz - 12 kHz
export function centroid(x, t0, t1, fs = FS) {
  let n = 1;
  while (n < (t1 - t0) * fs) n <<= 1;
  const m = spectrum(x, Math.floor(t0 * fs), n);
  let a = 0, b = 0;
  for (let i = Math.ceil((60 * n) / fs); i < (12000 * n) / fs; i++) { a += i * m[i]; b += m[i]; }
  return ((a / b) * fs) / n;
}
