// Vibetar string engine — physically modelled plucked & bowed strings.
//
// Plucked strings are digital waveguides (extended Karplus-Strong) with:
//   * two transverse polarisations per string (slightly detuned, different
//     decay rates) -> beating and the two-stage decay of a real string
//   * frequency dependent damping fitted to a physical loss model
//     sigma(f) = b1 + b3 f^2 for every note
//   * stiffness dispersion (allpass cascade) on the wound strings
//   * an ideal-pluck excitation: a band-limited rectangular velocity pulse
//     whose length is set by the picking position and whose edges are set by
//     pick hardness / pluck strength
//   * a passive bridge junction that couples all strings -> sympathetic
//     resonance
//   * finger / palm contact points: lossy scattering junctions on the string
//     that produce natural harmonics, palm muting, dead notes and string stops
//   * friction noise of fingers travelling along the (wound) strings
// The body of the instrument is applied outside of the worklet (convolution).
//
// This file is loaded both as an AudioWorklet module and (for offline tests)
// as a plain ES module.

const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- filter helpers -------------------------------------------------------

// one-pole lowpass  H(z) = (1-a) / (1 - a z^-1)
function lpMag(a, w) { return (1 - a) / Math.sqrt(1 - 2 * a * Math.cos(w) + a * a); }
function lpDelay(a, w) { return Math.atan2(a * Math.sin(w), 1 - a * Math.cos(w)) / w; }
// first-order allpass  H(z) = (c + z^-1) / (1 + c z^-1), phase delay in samples
function apDelay(c, w) {
  const s = Math.sin(w), co = Math.cos(w);
  return -(Math.atan2(-s, c + co) - Math.atan2(-c * s, 1 + c * co)) / w;
}

// Fit loop gain g and one-pole coefficient a so that a string at f0 decays
// with rate sigma(f) = b1 + b3 f^2  (amplitude ~ exp(-sigma t)).
function designDamping(f0, b1, b3, fs) {
  const w0 = (TAU * f0) / fs;
  const fh = Math.min(0.42 * fs, Math.max(5 * f0, 3500));
  const wh = (TAU * fh) / fs;
  const s0 = b1 + b3 * f0 * f0;
  const sh = b1 + b3 * fh * fh;
  const G0 = Math.exp(-s0 / f0);
  const ratio = Math.exp(-(sh - s0) / f0);
  let lo = 0, hi = 0.995;
  for (let i = 0; i < 30; i++) {
    const mid = 0.5 * (lo + hi);
    if (lpMag(mid, wh) / lpMag(mid, w0) > ratio) lo = mid; else hi = mid;
  }
  const a = 0.5 * (lo + hi);
  return { a, g: Math.min(0.99999, G0 / lpMag(a, w0)) };
}

// ---- instrument definitions ----------------------------------------------
// index 0 = lowest string. b1 [1/s] broadband loss, b3 [s] high-frequency loss.

const PRESETS = {
  steel: {
    mode: 'pluck',
    b1: [0.50, 0.55, 0.62, 0.72, 0.80, 0.90],
    b3: [4.6e-7, 4.3e-7, 4.0e-7, 3.8e-7, 2.6e-7, 2.4e-7],
    apN: [4, 4, 3, 2, 0, 0],
    apC: [-0.78, -0.74, -0.68, -0.6, 0, 0],
    gain: [1.0, 1.0, 0.98, 0.94, 0.9, 0.86],
    mixH: 0.6, polCents: 0.9, pickNoise: 0.1, wound: 4,
  },
  nylon: {
    mode: 'pluck',
    b1: [0.95, 1.0, 1.1, 1.5, 1.65, 1.8],
    b3: [1.0e-6, 0.95e-6, 0.9e-6, 1.3e-6, 1.2e-6, 1.1e-6],
    apN: [1, 1, 1, 0, 0, 0],
    apC: [-0.5, -0.45, -0.4, 0, 0, 0],
    gain: [1.0, 1.0, 1.0, 1.0, 0.97, 0.94],
    mixH: 0.55, polCents: 0.7, pickNoise: 0.04, wound: 3,
  },
  twelve: {
    mode: 'pluck',
    b1: [0.55, 0.6, 0.68, 0.78, 0.85, 0.95],
    b3: [5.0e-7, 4.6e-7, 4.3e-7, 4.0e-7, 2.8e-7, 2.6e-7],
    apN: [4, 4, 3, 2, 0, 0],
    apC: [-0.78, -0.74, -0.68, -0.6, 0, 0],
    gain: [0.8, 0.8, 0.78, 0.76, 0.7, 0.66],
    mixH: 0.6, polCents: 0.9, pickNoise: 0.1, wound: 4,
    // second string of each course: pitch offset in semitones (+ few cents)
    pair: [12.02, 12.03, 12.02, 12.03, 0.05, -0.05],
    pairB1: [0.85, 0.9, 0.95, 1.05, 0.8, 0.9],
    pairB3: [3.6e-7, 3.4e-7, 3.2e-7, 3.0e-7, 3.4e-7, 3.0e-7],
    pairGain: [0.62, 0.62, 0.6, 0.58, 0.7, 0.66],
  },
  bowed: { mode: 'bow', gain: [1.0, 1.0, 0.95, 0.9, 0.85, 0.8] },
};

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Contact positions, as distance from the bridge in fractions of the string.
const PALM = [0.04, 0.065, 0.09]; // of the open string: the palm does not move with the fretting hand
const PALM_K = 0.93;                 // light: absorbs without shortening the string
const DEAD = [0.62, 0.71];          // of the sounding length
const STOP = [0.13, 0.31];
const LIFT = [0.37, 0.43];          // a fingertip is wide enough to leave no partial untouched

// ---- plucked string voice -------------------------------------------------

class PluckVoice {
  constructor(fs, rnd) {
    this.fs = fs;
    this.rnd = rnd;
    const size = 1 << Math.ceil(Math.log2(fs / 28 + 16));
    this.mask = size - 1;
    this.bv = new Float64Array(size);
    this.bh = new Float64Array(size);
    this.w = 0;
    this.exc = new Float64Array(size);
    this.excLen = 0; this.excPos = 0; this.excV = 0.8; this.excH = 0.6;
    this.aV = 0.1; this.gV = 0.99; this.lpV = 0;
    this.aH = 0.1; this.gH = 0.99; this.lpH = 0;
    this.apN = 0; this.apC0 = 0; this.apC = 0;
    this.axV = new Float64Array(4); this.ayV = new Float64Array(4);
    this.axH = new Float64Array(4); this.ayH = new Float64Array(4);
    this.dV = 100; this.dH = 100; this.dVinc = 0; this.dHinc = 0;
    this.tV = 100; this.tH = 100;
    this.dampGain = 1; this.dampCount = 0;
    this.uV = 0; this.uH = 0;
    // material / config
    this.openF = 110; this.ratio = 1; this.b1 = 0.6; this.b3 = 6e-7;
    this.gain = 1; this.mixH = 0.6; this.polDet = 1.0005; this.alpha = 0;
    // note state
    this.freq = 110; this.curFreq = 110; this.sounding = false;
    this.gFrom = 0; this.gT0 = 0; this.gDur = 0.1; this.gStep = false;
    this.bendAmt = 0; this.bendT0 = 0; this.bendRise = 0.2;
    this.vibDepth = 0; this.vibT0 = 0;
    this.modPrev = false;
    // contact points (finger / palm resting on the string)
    this.tn = 0;
    this.tx = new Float64Array(3);            // bridge-side round trip of each point, in samples
    this.ta = new Int32Array(3); this.tb = new Int32Array(3);
    this.tk = 1; this.tkT = 1; this.tkStep = 0; // transmission 1 = no contact .. 0 = rigid stop
    this.tHold = 0;
    // finger travel noise
    this.wound = false;
    this.sqN = 0; this.sqLen = 1; this.sqPh = 0; this.sqRate = 0; this.sqPulse = 0; this.sqAmp = 0;
    this.sqB0 = 0; this.sqA1 = 0; this.sqA2 = 0;
    this.sqX1 = 0; this.sqX2 = 0; this.sqY1 = 0; this.sqY2 = 0; this.sqLp = 0;
  }

  // ---- contact points --------------------------------------------------------
  // A point where something soft rests on the string is a lossy two-port:
  // with transmission k, the wave passing outwards (a) and the wave coming
  // back (b) exchange  d = (1 - k)(a - b).  It only ever removes energy.
  // Partials that have a node at the point (a == b) pass untouched, which is
  // exactly how a lightly touching finger isolates a natural harmonic.

  // xs: positions as distance from the bridge, in fractions of the round trip N
  touch(xs, N, k, ramp, hold) {
    const n = Math.min(3, xs.length);
    this.tn = n;
    for (let i = 0; i < n; i++) this.tx[i] = xs[i] * N;
    this.placeTouch(N, this.tV);
    this.tkT = k;
    this.tkStep = 1 / Math.max(1, ramp * this.fs);
    if (ramp <= 0) this.tk = k;
    this.tHold = hold > 0 ? Math.round(hold * this.fs) : 0;
  }

  placeTouch(N, D) {
    const n0 = D | 0, tau = N - D; // tau: delay of the loop filters, lumped at the bridge
    for (let i = 0; i < this.tn; i++) {
      const x = this.tx[i];
      let a = Math.max(1, Math.round((x - tau) / 2));
      let b = a + Math.round(N - x);
      if (b > n0 - 2) b = n0 - 2;
      if (a >= b) a = b; // degenerate: no effect
      this.ta[i] = a; this.tb[i] = b;
    }
  }

  release(ramp) {
    this.tkT = 1; this.tHold = 0;
    this.tkStep = 1 / Math.max(1, ramp * this.fs);
    if (ramp <= 0) { this.tk = 1; this.tn = 0; }
  }

  // ---- finger travel noise ---------------------------------------------------
  // Sliding along a wound string hits one winding after the other: a pulse
  // train whose rate follows the finger speed, coloured by the string's
  // longitudinal resonance. Plain strings only hiss.
  squeak(dur, amt, P) {
    const lvl = amt * P.fingerNoise;
    if (!(lvl > 0) || !(dur > 0)) return;
    this.sqLen = this.sqN = Math.max(64, Math.round(dur * this.fs));
    this.sqAmp = lvl * (this.wound ? 0.5 : 0.06);
    this.sqRate = this.wound ? (900 + 2600 * this.rnd()) * (0.55 + 0.45 * amt) / this.fs : 0;
    this.sqPh = this.rnd(); this.sqPulse = 0;
  }

  squeakTick() {
    const rnd = this.rnd;
    const s = Math.sin(Math.PI * (1 - this.sqN / this.sqLen));
    this.sqN--;
    const speed = s * s; // bell-shaped finger speed
    const nz = 2 * rnd() - 1;
    let src;
    if (this.sqRate > 0) {
      this.sqPh += this.sqRate * (0.2 + 0.8 * speed);
      if (this.sqPh >= 1) { this.sqPh -= 1; this.sqPulse = 0.45 + 0.55 * rnd(); }
      src = this.sqPulse * (0.75 + 0.25 * nz) + 0.1 * nz;
      this.sqPulse *= 0.8;
    } else src = nz;
    const x = src * speed * this.sqAmp;
    const y = this.sqB0 * (x - this.sqX2) - this.sqA1 * this.sqY1 - this.sqA2 * this.sqY2;
    this.sqX2 = this.sqX1; this.sqX1 = x; this.sqY2 = this.sqY1; this.sqY1 = y;
    this.sqLp += 0.07 * (x - this.sqLp);
    return y + 0.35 * (x - this.sqLp);
  }

  setDamping(f, b1, b3) {
    const fs = this.fs;
    const dv = designDamping(f, b1 * 1.45, b3, fs);
    this.aV = dv.a;
    this.gV = Math.min(0.99999, dv.g / (1 - this.alpha));
    const dh = designDamping(f * this.polDet, b1 * 0.7, b3 * 0.9, fs);
    this.aH = dh.a; this.gH = dh.g;
  }

  retune(f, immediate) {
    const fs = this.fs;
    f = clamp(f, 30, fs * 0.2);
    this.curFreq = f;
    const w = (TAU * f) / fs;
    const fH = f * this.polDet;
    const wH = (TAU * fH) / fs;
    let apV = 0, apH = 0;
    if (this.apN) {
      // dispersion scales with the vibrating length
      const tauOpen = (1 - this.apC0) / (1 + this.apC0);
      const tau = 1 + (tauOpen - 1) * Math.min(1, this.openF / f);
      const c = (1 - tau) / (1 + tau);
      this.apC = c;
      apV = this.apN * apDelay(c, w);
      apH = this.apN * apDelay(c, wH);
    }
    this.tV = Math.max(2.001, fs / f - lpDelay(this.aV, w) - apV);
    this.tH = Math.max(2.001, fs / fH - lpDelay(this.aH, wH) - apH);
    if (immediate) { this.dV = this.tV; this.dH = this.tH; this.dVinc = 0; this.dHinc = 0; }
  }

  buildExc(f, vel, P, tech, dir) {
    const fs = this.fs, rnd = this.rnd, exc = this.exc;
    const N = fs / f;
    let beta = P.pickPos * (f / this.openF);
    if (tech === '*') beta = 0.6 * P.pickPos; // harmonics are plucked close to the bridge
    beta = clamp(beta * (1 + 0.14 * (rnd() - 0.5)), 0.03, 0.5);
    const L = beta * N;
    let h = clamp(P.pickHard + 0.35 * (vel - 0.7), 0, 1);
    if (tech === 'soft') h *= 0.45;
    else if (tech === 'm') h *= 0.8;
    let wd = fs * (0.00003 + 0.001 * (1 - h) * (1 - h));
    wd = Math.max(1.5, wd * (1 + 0.2 * (rnd() - 0.5)));
    const len = Math.min(Math.ceil(L + wd) + 1, exc.length);
    // thinner / shorter strings carry less energy
    const amp = vel * (tech === '*' ? 1.7 : 1) * clamp(Math.pow(f / 260, -0.38), 0.55, 1.4) * (dir < 0 ? -1 : 1);
    const nz = tech === 'soft' ? 0 : P.pickNoise * (0.4 + h);
    for (let n = 0; n < len; n++) {
      const a = n / wd;
      const s1 = a >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * a);
      const b = (n - L) / wd;
      const s2 = b <= 0 ? 0 : b >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * b);
      exc[n] = amp * (s1 - s2) * (1 + nz * (2 * rnd() - 1));
    }
    this.excPos = 0; this.excLen = len;
    const th = 0.6 + 0.4 * (rnd() - 0.5);
    this.excV = Math.cos(th); this.excH = Math.sin(th);
  }

  // ev.k: technique flags - m palm mute, h hammer-on/pull-off, s slide,
  // b bend, v vibrato, * natural harmonic (ev.hb = touch point, as the
  // fraction of the string between finger and bridge), x dead note
  noteOn(ev, P, t) {
    const k = ev.k || '';
    const f = ev.f * this.ratio;
    const dead = k === 'x', pm = k.indexOf('m') >= 0, harm = k.indexOf('*') >= 0 && ev.hb > 0;
    const slide = k.indexOf('s') >= 0;
    const legato = (slide || k.indexOf('h') >= 0) && this.sounding && !harm;
    let b1 = this.b1 * P.b1Scale, b3 = this.b3 * P.b3Scale;
    if (ev.fr) { b1 *= 1.35; b3 *= 1.2; }
    if (pm) b3 *= 1.6;
    else if (dead) { b1 = b1 * 2 + 6; b3 *= 3; }
    this.setDamping(f, b1, b3);
    const N = this.fs / f;
    if (!legato) {
      this.gFrom = 0; this.bendAmt = 0; this.vibDepth = 0;
      this.freq = f;
      this.retune(f, true);
      this.dampCount = Math.round(N); this.dampGain = 0.1;
      this.buildExc(f, ev.v, P, harm ? '*' : pm ? 'm' : '', ev.d);
      if (k.indexOf('b') >= 0) { this.bendAmt = 2; this.bendT0 = t + 0.05; this.bendRise = 0.22; }
      else if (k.indexOf('v') >= 0) { this.vibDepth = 0.42; this.vibT0 = t + 0.16; }
      this.sounding = !dead;
      // what is resting on the string while it is plucked
      if (harm) this.touch([ev.hb], N, 0.5, 0, clamp(10 * N / this.fs, 0.025, 0.085)); // fingertip on the node, then lifted
      else if (pm) this.touch(PALM.map((x) => x * f / this.openF), N, PALM_K, 0, 0); // edge of the palm at the bridge
      else if (dead) this.touch(DEAD, N, 0.5, 0, 0);                  // fretting hand lying on the string
      else this.release(0);
    } else {
      const from = 12 * Math.log2(this.curFreq / f);
      this.bendAmt = 0; this.vibDepth = 0;
      this.freq = f;
      this.gFrom = from; this.gT0 = t; this.gStep = slide;
      this.gDur = slide ? clamp(0.035 * Math.abs(from), 0.07, 0.3) : 0.008;
      this.buildExc(f, ev.v * (slide ? 0.1 : 0.4), P, 'soft', ev.d);
      if (slide) this.squeak(this.gDur, clamp(Math.abs(from) / 7, 0.3, 1) * 0.8, P);
      if (pm) {
        this.retune(f, false);
        this.touch(PALM.map((x) => x * f / this.openF), N, PALM_K, 0.004, 0);
      } else if (this.tkT < 1) this.release(0.01);
    }
  }

  // the fretting finger lets go and travels to its next position
  shift(dur, amt, P) {
    this.squeak(dur, amt, P);
    // no longer pressed down, the string rests against the fingertip and dies away
    if (this.sounding && this.tkT >= 1) this.touch(LIFT, this.fs / this.curFreq, 0.9, 0.015, 0);
  }

  // a hand comes down on the string
  mute(fast) {
    this.sounding = false;
    this.gFrom = 0; this.bendAmt = 0; this.vibDepth = 0;
    this.excLen = 0;
    this.retune(this.curFreq, false);
    this.touch(STOP, this.fs / this.curFreq, 0.5, fast ? 0.004 : 0.012, 0);
    this.modPrev = true;
  }

  // sympathetic "open string" state
  rest() {
    this.sounding = false;
    this.gFrom = 0; this.bendAmt = 0; this.vibDepth = 0;
    this.freq = this.openF * this.ratio;
    this.setDamping(this.freq, this.b1, this.b3);
    this.retune(this.freq, true);
    this.release(0);
    this.sqN = 0;
  }

  updateMod(t, n) {
    let semis = 0, active = false;
    if (this.gFrom !== 0) {
      const p = (t - this.gT0) / this.gDur;
      if (p >= 1) this.gFrom = 0;
      else {
        let o = this.gFrom * (1 - Math.max(0, p));
        if (this.gStep) o = Math.round(o);
        semis += o;
      }
      active = true;
    }
    if (this.bendAmt !== 0) {
      const p = clamp((t - this.bendT0) / this.bendRise, 0, 1);
      semis += this.bendAmt * p * p * (3 - 2 * p);
      active = true;
    }
    if (this.vibDepth !== 0) {
      const tt = t - this.vibT0;
      if (tt > 0) semis += this.vibDepth * Math.min(1, tt / 0.3) * 0.5 * (1 - Math.cos(TAU * 5.3 * tt));
      active = true;
    }
    if (!active && !this.modPrev) { this.dVinc = 0; this.dHinc = 0; return; }
    this.modPrev = active;
    this.retune(this.freq * Math.pow(2, semis / 12), false);
    this.dVinc = (this.tV - this.dV) / n;
    this.dHinc = (this.tH - this.dH) / n;
  }

  tickRead() {
    const m = this.mask, apN = this.apN, c = this.apC;
    // vertical polarisation
    let d = (this.dV += this.dVinc);
    let n0 = d | 0;
    let x = d - n0 + 1;
    let i = this.w - n0 + 1;
    let b = this.bv;
    let r = (-(x - 1) * (x - 2) * (x - 3) / 6) * b[i & m]
      + (x * (x - 2) * (x - 3) / 2) * b[(i - 1) & m]
      - (x * (x - 1) * (x - 3) / 2) * b[(i - 2) & m]
      + (x * (x - 1) * (x - 2) / 6) * b[(i - 3) & m];
    r = this.lpV = (1 - this.aV) * r + this.aV * this.lpV;
    r *= this.gV;
    for (let k = 0; k < apN; k++) {
      const y = c * r + this.axV[k] - c * this.ayV[k];
      this.axV[k] = r; this.ayV[k] = y; r = y;
    }
    this.uV = r;
    // horizontal polarisation
    d = (this.dH += this.dHinc);
    n0 = d | 0;
    x = d - n0 + 1;
    i = this.w - n0 + 1;
    b = this.bh;
    let q = (-(x - 1) * (x - 2) * (x - 3) / 6) * b[i & m]
      + (x * (x - 2) * (x - 3) / 2) * b[(i - 1) & m]
      - (x * (x - 1) * (x - 3) / 2) * b[(i - 2) & m]
      + (x * (x - 1) * (x - 2) / 6) * b[(i - 3) & m];
    q = this.lpH = (1 - this.aH) * q + this.aH * this.lpH;
    q *= this.gH;
    for (let k = 0; k < apN; k++) {
      const y = c * q + this.axH[k] - c * this.ayH[k];
      this.axH[k] = q; this.ayH[k] = y; q = y;
    }
    this.uH = q;
    return r;
  }

  tickWrite(vj) {
    let e = 0;
    if (this.excPos < this.excLen) e = this.exc[this.excPos++];
    let dm = 1;
    if (this.dampCount > 0) { dm = this.dampGain; this.dampCount--; }
    let yv = e * this.excV + (this.uV - vj) * dm;
    let yh = e * this.excH + this.uH * dm;
    if (yv < 1e-18 && yv > -1e-18) yv = 0;
    if (yh < 1e-18 && yh > -1e-18) yh = 0;
    let sq = 0;
    if (this.sqN > 0) { sq = this.squeakTick(); yv += 0.5 * sq; }
    const bv = this.bv, bh = this.bh, w = this.w, m = this.mask;
    bv[w] = yv; bh[w] = yh;
    if (this.tn > 0) {
      if (this.tk !== this.tkT) {
        if (this.tk < this.tkT) { this.tk += this.tkStep; if (this.tk > this.tkT) this.tk = this.tkT; }
        else { this.tk -= this.tkStep; if (this.tk < this.tkT) this.tk = this.tkT; }
      }
      if (this.tHold > 0 && --this.tHold === 0) { this.tkT = 1; this.tkStep = 1 / (0.014 * this.fs); }
      const g = 1 - this.tk;
      if (g > 0) {
        for (let i = 0; i < this.tn; i++) {
          const ia = (w - this.ta[i]) & m, ib = (w - this.tb[i]) & m;
          let d = g * (bv[ia] - bv[ib]);
          bv[ia] -= d; bv[ib] += d;
          d = g * (bh[ia] - bh[ib]);
          bh[ia] -= d; bh[ib] += d;
        }
      } else if (this.tkT >= 1) this.tn = 0;
    }
    this.w = (w + 1) & m;
    return (yv + yh * this.mixH) * this.gain + sq;
  }

  clear() {
    this.bv.fill(0); this.bh.fill(0);
    this.axV.fill(0); this.ayV.fill(0); this.axH.fill(0); this.ayH.fill(0);
    this.lpV = 0; this.lpH = 0; this.excLen = 0; this.dampCount = 0;
    this.sqN = 0; this.sqX1 = this.sqX2 = this.sqY1 = this.sqY2 = this.sqLp = 0;
  }
}

// ---- bowed string voice (stick-slip friction waveguide) -------------------

class BowVoice {
  constructor(fs, rnd) {
    this.fs = fs; this.rnd = rnd;
    const size = 1 << Math.ceil(Math.log2(fs / 28 + 16));
    this.mask = size - 1;
    this.nb = new Float64Array(size); this.bb = new Float64Array(size);
    this.w = 0;
    this.nOut = 0; this.bOut = 0;
    this.lp = 0;
    this.pole = 0.75 - (0.2 * 22050) / fs;
    this.env = 0; this.envT = 0; this.atk = 1 / (0.07 * fs); this.rel = 1 / (0.22 * fs);
    this.maxVel = 0.1; this.slope = 3; this.beta = 0.127;
    this.nD = 100; this.bD = 29; this.nDinc = 0; this.bDinc = 0;
    this.openF = 110; this.ratio = 1; this.gain = 1;
    this.freq = 110; this.curFreq = 110; this.sounding = false;
    this.gFrom = 0; this.gT0 = 0; this.gDur = 0.1; this.gStep = false;
    this.bendAmt = 0; this.bendT0 = 0; this.bendRise = 0.25;
    this.vibDepth = 0; this.vibT0 = 0; this.vibRate = 5.6;
    this.noise = 0; this.tune = 3.7;
  }

  targets(f) {
    f = clamp(f, 30, this.fs * 0.2);
    this.curFreq = f;
    const base = Math.max(6, this.fs / f - this.tune + 0.12 * Math.min(1, f / 900));
    return base;
  }

  retune(f, immediate, n) {
    const base = this.targets(f);
    const b = Math.max(1.5, base * this.beta), nk = Math.max(1.5, base - b);
    if (immediate) { this.bD = b; this.nD = nk; this.bDinc = 0; this.nDinc = 0; }
    else { this.bDinc = (b - this.bD) / n; this.nDinc = (nk - this.nD) / n; }
  }

  noteOn(ev, P, t) {
    const k = ev.k || '';
    const has = (c) => k.indexOf(c) >= 0;
    const tech = k === 'x' ? 'x' : has('s') ? 's' : has('h') ? 'h' : has('b') ? 'b' : has('v') ? 'v' : '';
    const pm = has('m');
    let f = ev.f * this.ratio;
    // flageolet: the nearest partial with a node under the finger
    if (has('*') && ev.hb > 0) f *= Math.max(1, Math.round(1 / Math.min(ev.hb, 1 - ev.hb)));
    this.slope = 5 - 4 * clamp(0.35 + 0.5 * P.pickHard, 0, 1);
    this.beta = clamp(0.05 + P.pickPos * 0.55, 0.06, 0.3);
    const legato = this.sounding && this.env > 0.2;
    this.bendAmt = 0; this.vibDepth = 0; this.gFrom = 0;
    if (legato) {
      const from = 12 * Math.log2(this.curFreq / f);
      this.gFrom = from; this.gT0 = t; this.gStep = false;
      this.gDur = tech === 's' ? clamp(0.04 * Math.abs(from), 0.08, 0.35) : 0.025;
      this.freq = f;
      if (tech !== 'h' && tech !== 's') this.env *= 0.55; // re-articulate
    } else {
      this.freq = f;
      this.retune(f, true, 1);
    }
    let vel = ev.v;
    if (pm || tech === 'x') vel *= 0.6;
    this.maxVel = 0.03 + 0.12 * vel;
    // empirical compensation of loop filter + friction-junction delay
    this.tune = 3.8 - 0.08 / Math.max(0.3, vel);
    this.envT = 1;
    this.atk = 1 / ((tech === 'x' ? 0.015 : 0.09 - 0.05 * vel) * this.fs);
    if (tech === 'b') { this.bendAmt = 2; this.bendT0 = t + 0.05; }
    this.vibDepth = (tech === 'v' ? 0.5 : 0.22) * P.bowVib;
    this.vibT0 = t + (tech === 'v' ? 0.12 : 0.28);
    this.vibRate = 5.2 + 0.8 * this.rnd();
    this.sounding = true;
    if (tech === 'x') { this.envT = 0; this.env = 0.9; this.sounding = false; }
  }

  mute(fast) {
    this.sounding = false; this.envT = 0;
    this.rel = 1 / ((fast ? 0.08 : 0.2) * this.fs);
  }

  rest() { this.sounding = false; this.envT = 0; this.env = 0; }

  updateMod(t, n) {
    let semis = 0;
    if (this.gFrom !== 0) {
      const p = (t - this.gT0) / this.gDur;
      if (p >= 1) this.gFrom = 0; else semis += this.gFrom * (1 - Math.max(0, p));
    }
    if (this.bendAmt !== 0) {
      const p = clamp((t - this.bendT0) / this.bendRise, 0, 1);
      semis += this.bendAmt * p * p * (3 - 2 * p);
    }
    if (this.vibDepth !== 0) {
      const tt = t - this.vibT0;
      if (tt > 0) semis += this.vibDepth * Math.min(1, tt / 0.4) * Math.sin(TAU * this.vibRate * tt);
    }
    this.retune(this.freq * Math.pow(2, semis / 12), false, n);
  }

  tick() {
    const m = this.mask;
    if (this.env < this.envT) { this.env += this.atk; if (this.env > this.envT) this.env = this.envT; }
    else if (this.env > this.envT) { this.env -= this.rel; if (this.env < this.envT) this.env = this.envT; }
    this.noise = 0.9 * this.noise + 0.1 * (2 * this.rnd() - 1);
    const bowVel = this.maxVel * this.env * (1 + 0.5 * this.noise);
    this.lp = (1 - this.pole) * 0.95 * this.bOut + this.pole * this.lp;
    const bridgeRefl = -this.lp;
    const nutRefl = -this.nOut;
    const dv = bowVel - (bridgeRefl + nutRefl);
    let o = Math.abs((dv + 0.001) * this.slope) + 0.75;
    o = 1 / (o * o * o * o);
    if (o > 0.98) o = 0.98; else if (o < 0.01) o = 0.01;
    const nv = dv * o;
    let a = bridgeRefl + nv, b = nutRefl + nv;
    if (a < 1e-18 && a > -1e-18) a = 0;
    if (b < 1e-18 && b > -1e-18) b = 0;
    this.nb[this.w] = a; this.bb[this.w] = b;
    // linear-interpolated reads
    let d = (this.nD += this.nDinc), n0 = d | 0, fr = d - n0, i = this.w - n0;
    this.nOut = this.nb[i & m] * (1 - fr) + this.nb[(i - 1) & m] * fr;
    d = (this.bD += this.bDinc); n0 = d | 0; fr = d - n0; i = this.w - n0;
    this.bOut = this.bb[i & m] * (1 - fr) + this.bb[(i - 1) & m] * fr;
    this.w = (this.w + 1) & m;
    return this.bOut * this.gain;
  }

  clear() { this.nb.fill(0); this.bb.fill(0); this.lp = 0; this.nOut = 0; this.bOut = 0; this.env = 0; this.envT = 0; }
}

// ---- engine ----------------------------------------------------------------

class VibetarEngine {
  constructor(fs) {
    this.fs = fs;
    this.rnd = mulberry32(0x5eed);
    this.queue = [];
    this.voices = [];
    this.pairs = null;
    this.mode = 'pluck';
    this.preset = '';
    this.alpha = 0;
    this.dcx = 0; this.dcy = 0;
    this.dcR = 1 - (TAU * 18) / fs;
    this.outGain = 0.3;
    this.pairGap = Math.round(0.011 * fs);
    this.P = { pickPos: 0.17, pickHard: 0.72, pickNoise: 0.1, b1Scale: 1, b3Scale: 1, bowVib: 1, fingerNoise: 0.3 };
    this.configure({ preset: 'steel', open: [40, 45, 50, 55, 59, 64] });
  }

  // c: { preset, open:[midi x6], pickPos, pickHard, bright, sustain, symp }
  configure(c) {
    const pr = PRESETS[c.preset] || PRESETS.steel;
    const fs = this.fs;
    const rebuild = c.preset !== this.preset;
    const P = this.P;
    if (c.pickPos != null) P.pickPos = clamp(c.pickPos, 0.04, 0.45);
    if (c.pickHard != null) P.pickHard = clamp(c.pickHard, 0, 1);
    if (c.sustain != null) P.b1Scale = Math.pow(3, -clamp(c.sustain, -1, 1));
    if (c.bright != null) P.b3Scale = Math.pow(5, -clamp(c.bright, -1, 1));
    if (c.vibrato != null) P.bowVib = clamp(c.vibrato, 0, 2);
    if (c.fingerNoise != null) P.fingerNoise = clamp(c.fingerNoise, 0, 1);
    P.pickNoise = pr.pickNoise || 0;
    this.mode = pr.mode;
    const nPair = pr.pair ? 6 : 0;
    this.alpha = this.mode === 'pluck' ? clamp(c.symp != null ? c.symp : 0.3, 0, 1) * 0.0035 : 0;
    if (rebuild) {
      this.preset = c.preset;
      this.voices = [];
      for (let i = 0; i < 6 + nPair; i++) {
        this.voices.push(this.mode === 'bow' ? new BowVoice(fs, this.rnd) : new PluckVoice(fs, this.rnd));
      }
      this.pairs = pr.pair ? true : null;
    }
    const open = c.open || this.open || [40, 45, 50, 55, 59, 64];
    this.open = open;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const s = i % 6, isPair = i >= 6;
      v.openF = midiHz(open[s]);
      v.ratio = isPair ? Math.pow(2, pr.pair[s] / 12) : 1;
      v.gain = isPair ? pr.pairGain[s] : pr.gain[s];
      if (this.mode === 'pluck') {
        v.openF *= v.ratio;
        v.ratio = 1; // open frequency already includes the offset
        v.pitchMul = isPair ? Math.pow(2, pr.pair[s] / 12) : 1;
        v.b1 = isPair ? pr.pairB1[s] : pr.b1[s];
        v.b3 = isPair ? pr.pairB3[s] : pr.b3[s];
        v.apN = isPair ? 0 : pr.apN[s];
        v.apC0 = isPair ? 0 : pr.apC[s];
        v.mixH = pr.mixH;
        const cents = pr.polCents * (0.7 + 0.6 * ((s * 7 + (isPair ? 3 : 0)) % 5) / 4) * (s % 2 ? -1 : 1);
        v.polDet = Math.pow(2, cents / 1200);
        v.alpha = this.alpha;
        v.wound = !isPair && s < (pr.wound || 0);
        // longitudinal resonance that colours the finger noise
        const w0 = (TAU * (1500 + 330 * s)) / fs, al = Math.sin(w0) / 5;
        v.sqB0 = al / (1 + al); v.sqA1 = (-2 * Math.cos(w0)) / (1 + al); v.sqA2 = (1 - al) / (1 + al);
        if (rebuild || !v.sounding) v.rest();
      }
    }
  }

  post(ev) {
    const q = this.queue;
    if (ev.t != null) ev.frame = Math.round(ev.t * this.fs);
    else if (ev.frame == null) ev.frame = 0;
    let i = q.length;
    while (i > 0 && q[i - 1].frame > ev.frame) i--;
    q.splice(i, 0, ev);
  }

  handle(ev, frame) {
    const t = frame / this.fs, vs = this.voices;
    switch (ev.type) {
      case 'n': {
        if (this.pairs && ev.vi == null) {
          const first = ev.d < 0 ? ev.s : ev.s + 6;
          const second = ev.d < 0 ? ev.s + 6 : ev.s;
          this.note(vs[first], ev, t);
          this.post({ type: 'n', vi: second, frame: frame + this.pairGap + ((this.rnd() * 90) | 0), s: ev.s, f: ev.f, v: ev.v, k: ev.k, fr: ev.fr, d: ev.d, hb: ev.hb });
        } else {
          this.note(vs[ev.vi != null ? ev.vi : ev.s], ev, t);
        }
        break;
      }
      case 'o':
        vs[ev.s].mute(false);
        if (this.pairs) vs[ev.s + 6].mute(false);
        break;
      case 'q': // a finger travels along string s
        if (this.mode === 'pluck') vs[ev.s].shift(ev.dur, ev.amt, this.P);
        break;
      case 'O':
        for (const v of vs) v.mute(true);
        break;
      case 'R':
        for (const v of vs) { v.clear(); v.rest(); }
        break;
    }
  }

  note(v, ev, t) {
    if (v.pitchMul && v.pitchMul !== 1) {
      v.noteOn({ f: ev.f * v.pitchMul, v: ev.v, k: ev.k, fr: ev.fr, d: ev.d, hb: ev.hb }, this.P, t);
    } else v.noteOn(ev, this.P, t);
  }

  flush() { this.queue.length = 0; }

  render(out, n, frame0) {
    const vs = this.voices, nv = vs.length, q = this.queue;
    const t = frame0 / this.fs;
    for (let k = 0; k < nv; k++) vs[k].updateMod(t, n);
    let i = 0;
    while (i < n) {
      while (q.length && q[0].frame <= frame0 + i) this.handle(q.shift(), frame0 + i);
      let end = n;
      if (q.length) { const e = q[0].frame - frame0; if (e < end) end = e; }
      if (this.mode === 'bow') {
        for (; i < end; i++) {
          let o = 0;
          for (let k = 0; k < nv; k++) o += vs[k].tick();
          const y = o - this.dcx + this.dcR * this.dcy;
          this.dcx = o; this.dcy = y;
          out[i] = y * 0.5;
        }
      } else {
        const alpha = this.alpha, g = this.outGain;
        for (; i < end; i++) {
          let sum = 0;
          for (let k = 0; k < nv; k++) sum += vs[k].tickRead();
          const vj = sum * alpha;
          let o = 0;
          for (let k = 0; k < nv; k++) o += vs[k].tickWrite(vj);
          const y = o - this.dcx + this.dcR * this.dcy;
          this.dcx = o; this.dcy = y;
          out[i] = y * g;
        }
      }
    }
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('vibetar-strings', class extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.engine = new VibetarEngine(sampleRate);
      const po = (options && options.processorOptions) || {};
      if (po.cfg) this.engine.configure(po.cfg);
      if (po.events) for (const ev of po.events) this.engine.post(ev);
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'cfg') this.engine.configure(m);
        else if (m.type === 'flush') this.engine.flush();
        else if (m.type === 'batch') for (const ev of m.events) this.engine.post(ev);
        else this.engine.post(m);
      };
    }
    process(inputs, outputs) {
      const ch = outputs[0];
      this.engine.render(ch[0], ch[0].length, currentFrame);
      for (let c = 1; c < ch.length; c++) ch[c].set(ch[0]);
      return true;
    }
  });
}

export { VibetarEngine, PRESETS, designDamping, midiHz };
