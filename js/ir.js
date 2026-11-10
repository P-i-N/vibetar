// Impulse response synthesis: instrument bodies (modal) and reverb (diffuse).
// Pure functions returning Float32Arrays so they can be used with any
// (Offline)AudioContext and tested outside of the browser.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rnd) {
  let u = 0;
  while (u < 1e-12) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

function fft(re, im) {
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

// Body definitions.
//   modes:  the strong low resonances [frequency Hz, Q, peak gain dB]
//           (air/Helmholtz, top plate, back, cross dipoles ...)
//   target: third-octave smoothed level [Hz, dB] that the dense field of
//           higher modes is calibrated to
const BODIES = {
  // dreadnought-style steel string
  steel: {
    seed: 11,
    modes: [
      [101, 15, 1.5], [196, 18, 2.5], [243, 24, -3], [287, 24, 0], [372, 26, 0],
      [431, 28, 1], [498, 30, -2], [556, 30, -1], [634, 32, -2], [712, 34, -2],
    ],
    target: [[230, -2.5], [900, -2], [1500, -1.5], [2500, -1], [4000, -2], [6000, -4], [8000, -7], [12000, -12], [16000, -18], [22000, -28]],
    direct: -20,
  },
  // classical guitar: lower, rounder, darker
  nylon: {
    seed: 23,
    modes: [
      [96, 13, 3], [188, 16, 5], [226, 22, -2], [272, 22, 1], [348, 24, 0],
      [402, 26, 0], [466, 28, -2], [538, 30, -2], [602, 32, -3], [690, 34, -3],
    ],
    target: [[230, -3], [900, -4], [1500, -4.5], [2500, -6], [4000, -9], [6000, -13], [8000, -18], [12000, -26], [16000, -33], [22000, -42]],
    direct: -28,
  },
  // jumbo 12-string: big low end, extra shimmer
  twelve: {
    seed: 37,
    modes: [
      [94, 15, 2], [182, 18, 4], [232, 24, -3], [276, 24, -1], [356, 26, -1],
      [418, 28, 0], [486, 30, -2], [548, 30, -1], [622, 32, -2], [704, 34, -3],
    ],
    target: [[230, -4], [900, -4], [1500, -4], [2500, -4], [4000, -5.5], [6000, -8], [8000, -11], [12000, -17], [16000, -24], [22000, -32]],
    direct: -21,
  },
  // bowed instrument body (viol / cello-like, with a "bridge hill")
  bowed: {
    seed: 51,
    modes: [
      [98, 12, 0], [172, 16, 3], [196, 18, 3], [284, 20, 1], [392, 24, 0],
      [448, 24, 2], [520, 26, -1], [610, 28, 0], [700, 30, -2],
    ],
    target: [[230, -4], [900, -5], [1500, -5], [2500, -3], [3200, -4], [4500, -12], [6000, -20], [8000, -27], [12000, -36], [22000, -50]],
    direct: -34,
  },
};

function interpTarget(tg, f) {
  if (f <= tg[0][0]) return tg[0][1];
  for (let i = 1; i < tg.length; i++) {
    if (f <= tg[i][0]) {
      const u = Math.log(f / tg[i - 1][0]) / Math.log(tg[i][0] / tg[i - 1][0]);
      return tg[i - 1][1] + u * (tg[i][1] - tg[i - 1][1]);
    }
  }
  return tg[tg.length - 1][1];
}

function renderModes(list, len, fs, ch) {
  const out = new Float64Array(len);
  for (const m of list) {
    const tau = m.q / (Math.PI * m.f);
    const A = (Math.pow(10, m.db / 20) * 2) / (tau * fs) * m.sign * (ch ? m.gr * m.sr : m.gl);
    const ph = ch ? m.pr : m.pl;
    const w = (2 * Math.PI * m.f) / fs, r = Math.exp(-1 / (tau * fs));
    const cw = Math.cos(w) * r, sw = Math.sin(w) * r;
    const n = Math.min(len, Math.ceil(tau * fs * 11));
    let x = Math.cos(ph) * A, y = Math.sin(ph) * A;
    for (let i = 0; i < n; i++) {
      out[i] += x;
      const t = x * cw - y * sw; y = x * sw + y * cw; x = t;
    }
  }
  return out;
}

// power spectrum (N/2 bins) of a real signal
function powerSpec(x, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(x.length > N ? x.subarray(0, N) : x);
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}
function bandDb(p, N, fs, f, oct) {
  const k = Math.pow(2, oct / 2);
  const lo = Math.max(1, Math.floor((f / k) * N / fs)), hi = Math.min(N / 2 - 1, Math.ceil((f * k) * N / fs));
  let s = 0;
  for (let i = lo; i <= hi; i++) s += p[i];
  return 10 * Math.log10(s / (hi - lo + 1) + 1e-30);
}

export function makeBodyIR(fs, type) {
  const def = BODIES[type] || BODIES.steel;
  const len = Math.floor(fs * 0.42);
  const rnd = mulberry32(def.seed * 7919);
  const N = 1 << Math.ceil(Math.log2(len));
  const list = [];
  let alt = 1;
  const add = (f, q, db, fixed) => {
    // neighbouring modes mostly alternate in sign -> no deep anti-resonances
    alt = -alt;
    // stereo: decorrelate the upper modes, keep the low end mono
    const wide = Math.max(0, Math.min(1, (f - 220) / 600));
    list.push({
      f, q, db, fixed, sign: rnd() < 0.07 ? -alt : alt,
      gl: Math.pow(10, (wide * (rnd() * 7 - 3.5)) / 20), gr: Math.pow(10, (wide * (rnd() * 7 - 3.5)) / 20),
      pl: wide * (rnd() - 0.5) * 2.6, pr: wide * (rnd() - 0.5) * 2.6,
      sr: 1,
    });
  };
  for (const [f, q, db] of def.modes) add(f, q, db, true);
  // dense field of weaker modes
  let f = 232;
  const top = Math.min(fs * 0.46, 21000);
  while (f < top) {
    add(f, 18 + rnd() * 16 + Math.min(26, f / 160), interpTarget(def.target, f) - 8 + (rnd() * 4 - 2), false);
    f += 11 + rnd() * 20 + f * 0.004;
  }
  // calibrate the dense field so the smoothed response follows the target
  for (let pass = 0; pass < 3; pass++) {
    const pL = powerSpec(renderModes(list, len, fs, 0), N), pR = powerSpec(renderModes(list, len, fs, 1), N);
    for (let i = 0; i < pL.length; i++) pL[i] = 0.5 * (pL[i] + pR[i]);
    for (const m of list) {
      if (m.fixed) continue;
      const err = interpTarget(def.target, m.f) - bandDb(pL, N, fs, m.f, 0.5);
      m.db += Math.max(-12, Math.min(12, err)) * 0.85;
    }
  }
  const L = renderModes(list, len, fs, 0), R = renderModes(list, len, fs, 1);
  // direct (string) radiation: broadband, without lows
  const direct = Math.pow(10, def.direct / 20);
  const hp = Math.exp((-2 * Math.PI * 400) / fs);
  let lp = 1 - hp; // impulse response of the removed lowpass part
  L[0] += direct * hp; R[0] += direct * hp;
  for (let i = 1; i < 400; i++) { lp *= hp; L[i] -= direct * lp; R[i] -= direct * lp; }
  const fade = Math.floor(fs * 0.03);
  const outL = new Float32Array(len), outR = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const k = i > len - fade ? (len - i) / fade : 1;
    outL[i] = L[i] * k; outR[i] = R[i] * k;
  }
  return { L: outL, R: outR };
}

// Diffuse reverb: early reflections + band-split exponentially decaying noise.
// decay: RT60 (s) at mid frequencies, tone: 0 dark .. 1 bright
export function makeReverbIR(fs, decay, tone) {
  decay = Math.max(0.2, Math.min(12, decay));
  tone = Math.max(0, Math.min(1, tone));
  const len = Math.floor(fs * Math.min(14, decay * 1.3 + 0.25));
  const pre = 0.006 + 0.012 * Math.min(1, decay / 4);
  const out = [];
  const rts = [decay * 1.12, decay, decay * (0.42 + 0.4 * tone), decay * (0.14 + 0.36 * tone)];
  const k = rts.map((rt) => Math.exp(-6.908 / (rt * fs)));
  const cf = [260, 1300, 5200].map((fc) => Math.exp((-2 * Math.PI * fc) / fs));
  const gh = 0.35 + 0.65 * tone;
  const hp = Math.exp((-2 * Math.PI * 140) / fs);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(1000 + ch * 77);
    const b = new Float32Array(len);
    const n0 = Math.floor(pre * fs);
    let l1 = 0, l2 = 0, l2b = 0, l3 = 0, e0 = 1, e1 = 1, e2 = 1, e3 = 1, energy = 0;
    const build = 1 / (fs * (0.008 + 0.02 * Math.min(1, decay / 3)));
    for (let i = n0; i < len; i++) {
      const x = gaussian(rnd);
      l1 += (1 - cf[0]) * (x - l1);
      l2 += (1 - cf[1]) * (x - l2);
      l2b += (1 - cf[1]) * (l2 - l2b);
      l3 += (1 - cf[2]) * (x - l3);
      const lo = l1 * e0, lm = (l2b - l1) * e1, hm = (l3 - l2b) * e2, hi = (x - l3) * e3 * gh;
      const on = 1 - Math.exp(-(i - n0) * build);
      const mid = (lo * 1.1 + lm + hm) * on;
      energy += mid * mid;
      b[i] = mid + hi * on;
      e0 *= k[0]; e1 *= k[1]; e2 *= k[2]; e3 *= k[3];
    }
    const norm = 0.5 / Math.sqrt(energy);
    for (let i = 0; i < len; i++) b[i] *= norm;
    // early reflections
    const span = 0.02 + 0.07 * Math.min(1, decay / 3);
    const nEarly = 9;
    for (let j = 0; j < nEarly; j++) {
      const tt = pre + span * Math.pow((j + rnd()) / nEarly, 1.4);
      const idx = Math.floor(tt * fs);
      const g = 0.11 * Math.pow(0.82, j) * (rnd() < 0.5 ? -1 : 1) * (0.7 + 0.6 * rnd());
      if (idx + 2 < len) { b[idx] += g * 0.6; b[idx + 1] += g * 0.3; b[idx + 2] += g * 0.1; }
    }
    // remove rumble, fade the very end
    let s = 0, px = 0;
    for (let i = 0; i < len; i++) { const x = b[i]; s = hp * (s + x - px); px = x; b[i] = s; }
    const fade = Math.floor(fs * 0.05);
    for (let i = 0; i < fade; i++) b[len - 1 - i] *= i / fade;
    out.push(b);
  }
  return { L: out[0], R: out[1] };
}
