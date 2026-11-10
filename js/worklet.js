// Vibetar string engine — physically modelled plucked strings.
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
//   * a modal bridge: the strings drive the body's lowest resonances and feel
//     them back -> sympathetic resonance, two-stage decay, wolf notes
//     (without body data the bridge is rigid)
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
    b1: [0.50, 0.55, 0.62, 0.72, 0.80, 0.90],
    b3: [4.6e-7, 4.3e-7, 4.0e-7, 3.8e-7, 2.6e-7, 2.4e-7],
    apN: [4, 4, 3, 2, 0, 0],
    apC: [-0.78, -0.74, -0.68, -0.6, 0, 0],
    gain: [1.0, 1.0, 0.98, 0.94, 0.9, 0.86],
    mixH: 0.6, polCents: 0.9, pickNoise: 0.1, wound: 4,
    // the strings' own loss per string when tied to the modelled bridge, trimmed so that the
    // sustain heard through the body matches the reference in test/heard.test.mjs
    tied: [1, 1, 1, 0.6, 1.2, 1.2],
  },
  nylon: {
    b1: [0.95, 1.0, 1.1, 1.5, 1.65, 1.8],
    b3: [1.0e-6, 0.95e-6, 0.9e-6, 1.3e-6, 1.2e-6, 1.1e-6],
    apN: [1, 1, 1, 0, 0, 0],
    apC: [-0.5, -0.45, -0.4, 0, 0, 0],
    gain: [1.0, 1.0, 1.0, 1.0, 0.97, 0.94],
    mixH: 0.55, polCents: 0.7, pickNoise: 0.04, wound: 3,
  },
  twelve: {
    b1: [0.55, 0.6, 0.68, 0.78, 0.85, 0.95],
    b3: [5.0e-7, 4.6e-7, 4.3e-7, 4.0e-7, 2.8e-7, 2.6e-7],
    apN: [4, 4, 3, 2, 0, 0],
    apC: [-0.78, -0.74, -0.68, -0.6, 0, 0],
    gain: [0.8, 0.8, 0.78, 0.76, 0.7, 0.66],
    mixH: 0.6, polCents: 0.9, pickNoise: 0.1, wound: 4,
    tied: [1, 1, 1, 0.55, 1.6, 1.15],
    // second string of each course: pitch offset in semitones (+ few cents)
    pair: [12.02, 12.03, 12.02, 12.03, 0.05, -0.05],
    pairB1: [0.85, 0.9, 0.95, 1.05, 0.8, 0.9],
    pairB3: [3.6e-7, 3.4e-7, 3.2e-7, 3.0e-7, 3.4e-7, 3.0e-7],
    pairGain: [0.62, 0.62, 0.6, 0.58, 0.7, 0.66],
  },
};

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---- the plucking hand -------------------------------------------------------
// A pluck is a short contact at the plucking point: the plucker travels across
// the string, pushing it aside through a spring (k) and damper (r), until the
// force reaches what it can hold; then its grip decays over relMs.
//   k, r      contact stiffness / damping, in units of twice the string's wave impedance.
//             r >> 1 (flesh) pins the string to the finger; r ~ 1 would absorb it instead
//   widthMm   length of string in contact
//   holdMs    how long the stroke takes to load the string (at medium strength)
//   thetaDeg  stroke direction: 0 = straight towards the top, 90 = along the top
//   pos       plucking point relative to the instrument's "pick position"
//   relMs     how long the string takes to slide off once the plucker lets go
//   nail      a nail behind the flesh catches the string at `at` x the release force
const PLUCKERS = [
  { name: 'pick', k: 0.9, r: 0.3, widthMm: 1, relMs: 0.12, holdMs: 3, thetaDeg: 25, noise: 0.10, pos: 1.0, gain: 1 },
  { name: 'flesh', k: 0.3, r: 6, widthMm: 10, relMs: 0.9, holdMs: 4.5, thetaDeg: 40, noise: 0.02, pos: 1.25, gain: 1 },
  { name: 'short nails', k: 0.3, r: 6, widthMm: 10, relMs: 0.9, holdMs: 4.5, thetaDeg: 45, noise: 0.02, pos: 1.1, gain: 1,
    nail: { at: 0.7, relMs: 0.35, click: 0.04 } },
  { name: 'long nails', k: 0.8, r: 0.4, widthMm: 2, relMs: 0.12, holdMs: 4, thetaDeg: 50, noise: 0.08, pos: 1.0, gain: 1 },
  { name: 'thumb', k: 0.25, r: 6, widthMm: 14, relMs: 0.9, holdMs: 5, thetaDeg: 45, noise: 0.02, pos: 1.4, gain: 1 },
];
const PUSH = 0.1;    // how quickly the hand corrects its speed to have the force ready on time
// share of a string's broadband loss that is its own (the rest went to the bridge) when a modelled bridge is attached
const OWN_LOSS = 0.7;
const SCALE = 0.648; // scale length in metres, for converting contact widths to samples

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
    this.gain = 1; this.mixH = 0.6; this.polDet = 1.0005;
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
    // plucker contact
    this.sIdx = 0; this.zone = 0; this.outH = 0;
    this.bridge = null; this.loopV = 0; this.loopH = 0; this.ownLoss = 0.7; this.tied = 1;
    this.contact = 0; this.contactFrames = 0; this.releaseFrame = 0; this.strokeFrame = 0;
    this.pkA = 1; this.pkB = 2; this.pkW = 1;
    this.pkK = 0; this.pkR = 0; this.pkRel = false;
    this.pkXf = 0; this.pkY = 0; this.pkVf = 0; this.pkAcc = 1; this.pkDmax = 0; this.pkN = 0; this.pkMax = 0;
    this.pkHold = 1; this.pkLast = 0; this.pkPush = 1; this.pkOn = 2; this.pkF0 = 0; this.pkRelAt = 0;
    this.pkUv = 1; this.pkUh = 0; this.pkNoise = 0; this.pkNail = null; this.pkClick = 0; this.pkRelFrames = 1;
  }

  waveSpeed() { return 2 * SCALE * this.openF; }

  // ---- plucking --------------------------------------------------------------

  plucker(ev, P) {
    const id = ev.fg != null ? ev.fg : P.pick === 4 ? (this.sIdx < 3 ? 0 : 2) : P.pick;
    return PLUCKERS[id] || PLUCKERS[0];
  }

  // plucking point as round-trip distance from the bridge, in samples
  pluckPoint(ev, P, f, harm) {
    const N = this.fs / f, pl = this.plucker(ev, P);
    const x = (harm ? 0.6 : pl.pos) * P.pickPos * (this.fs / this.openF) + (2 * (ev.pp || 0) * this.fs) / (1000 * this.waveSpeed());
    return clamp(x, 0.03 * N, 0.5 * N);
  }

  // how long the stroke loads the string before letting go, in frames
  strokeFrames(ev, P) {
    const k = ev.k || '';
    if ((k.indexOf('h') >= 0 || k.indexOf('s') >= 0) && this.sounding) return 0;
    const fs = this.fs, pl = this.plucker(ev, P);
    const f = ev.f * this.ratio * (this.pitchMul || 1);
    let hold = ((pl.holdMs * fs) / 1000) * (1.4 - 0.6 * Math.min(1, ev.v));
    hold = Math.min(Math.max(hold, 1.5 * this.pluckPoint(ev, P, f, k.indexOf('*') >= 0 && ev.hb > 0)), 0.006 * fs);
    if (ev.gap > 0) hold = Math.min(hold, 0.8 * ev.gap * fs);
    return Math.max(8, Math.round(hold));
  }

  startStroke(ev, P, f, harm, pm) {
    const fs = this.fs, rnd = this.rnd, pl = this.plucker(ev, P);
    const N = fs / f, vel = ev.v;
    const hold = this.strokeFrames(ev, P);
    const x = clamp(this.pluckPoint(ev, P, f, harm) * (1 + 0.06 * (rnd() - 0.5)), 0.03 * N, 0.5 * N);
    const beta = x / N;
    const setTaps = (widthMm) => {
      const n0 = this.tV | 0, tau = N - this.tV;
      let a = Math.max(1, Math.round((x - tau) / 2));
      let b = Math.min(a + Math.round(N - x), n0 - 2);
      let W = clamp(Math.round((widthMm * fs) / (1000 * this.waveSpeed())), 1, 9);
      while (W > 1 && b - (W - 1) <= a + (W - 1) + 1) W--;
      if (b <= a) b = a + 1;
      this.pkA = a; this.pkB = b; this.pkW = W;
    };
    setTaps(pl.widthMm);
    const att = Math.pow(4, P.pickHard - 0.5);
    const firm = 0.6 + 0.5 * vel;
    this.pkK = pl.k * att * firm * (pm ? 0.8 : 1);
    this.pkR = pl.r;
    // a release slower than a fraction of the period would not excite the string at all
    const rel = (ms) => clamp(((ms * fs) / 1000 / att) * (1.6 - 0.8 * Math.min(1, vel)), 1.5, 0.2 * N);
    this.pkRelFrames = rel(pl.relMs);
    this.pkNail = pl.nail ? { at: pl.nail.at, rel: rel(pl.nail.relMs), click: pl.nail.click } : null;
    // thinner / shorter strings carry less energy
    this.pkDmax = vel * pl.gain * (harm ? 1.4 : 1) * (ev.rs ? 1.35 : 1) * clamp(Math.pow(f / 260, -0.38), 0.55, 1.4);
    // finger path: accelerate, then travel at vF so the static force reaches dMax at the release time
    const Kst = 1 / (N * beta * (1 - beta));
    this.pkAcc = Math.max(1, 0.4 * hold); this.pkHold = hold; this.pkLast = 0; this.pkPush = 1; this.pkOn = Math.max(2, 0.0003 * fs);
    this.pkVf = this.pkDmax / (1 + Kst * (hold - 0.5 * this.pkAcc));
    this.pkMax = ev.lim > 0 ? Math.min(ev.lim, Math.round(1.5 * hold)) : Math.round(1.5 * hold);
    const th = (((ev.rs ? 8 : pl.thetaDeg) + 10 * (rnd() - 0.5)) * Math.PI) / 180;
    const dir = ev.d < 0 ? -1 : 1;
    this.pkUv = Math.cos(th) * dir; this.pkUh = Math.sin(th) * dir;
    this.excV = Math.abs(this.pkUv); this.excH = Math.abs(this.pkUh);
    this.pkNoise = pl.noise * (this.wound ? 2 : 1);
    this.pkXf = 0; this.pkY = 0; this.pkN = 0; this.pkRel = false; this.pkClick = 0;
    this.contact = 1; this.contactFrames = 0;
  }

  // the fretting hand moving to another fret takes most of the old vibration with it
  quiet(g) {
    const bv = this.bv, bh = this.bh;
    for (let i = 0; i < bv.length; i++) { bv[i] *= g; bh[i] *= g; }
    this.lpV *= g; this.lpH *= g;
    for (let i = 0; i < 4; i++) { this.axV[i] *= g; this.ayV[i] *= g; this.axH[i] *= g; this.ayH[i] *= g; }
  }

  letGo() {
    this.pkRel = true;
    this.pkF0 = this.pkLast; this.pkRelAt = this.pkN;
    this.releaseFrame = this.strokeFrame + this.pkN;
  }

  pluckTick(bv, bh, w, m) {
    const W = this.pkW, uV = this.pkUv, uH = this.pkUh;
    const n = this.pkN++;
    let dU, dP = 0;
    if (this.pkRel) {
      // the string slides off the plucker: its hold fades smoothly over the release time
      const ph = (n - this.pkRelAt + 1) / this.pkRelFrames;
      if (ph >= 1) { this.contact = 0; this.contactFrames = n; return; }
      dU = this.pkF0 * 0.5 * (1 + Math.cos(Math.PI * ph));
    } else {
      let sV = 0, sH = 0;
      for (let j = 0; j < W; j++) {
        const ia = (w - this.pkA - j) & m, ib = (w - this.pkB + j) & m;
        sV += bv[ia] - bv[ib]; sH += bh[ia] - bh[ib];
      }
      sV /= W; sH /= W;
      const vU = sV * uV + sH * uH, vP = sH * uV - sV * uH; // string velocity along / across the stroke
      // contact is made over a fraction of a millisecond, not in one sample
      const g = Math.min(1, (n + 1) / this.pkOn);
      // the hand feels the string: it speeds up or eases off so the force is there on time
      const want = this.pkDmax * Math.min(1, (n + 1) / this.pkHold);
      this.pkPush = clamp(this.pkPush + (PUSH * (want - this.pkLast)) / this.pkDmax, 0.25, 4);
      const vF = this.pkVf * Math.min(1, (n + 1) / this.pkAcc) * this.pkPush;
      this.pkXf += vF;
      const k = this.pkK, r = this.pkR;
      // implicit spring + damper along the stroke; the damper also acts across it
      dU = (g * (k * (this.pkXf - this.pkY - vU) + r * (vF - vU))) / (1 + g * (k + r));
      dP = (-g * r * vP) / (1 + g * r);
      if (dU < 0) { dU = 0; dP = 0; } // the plucker cannot pull
      else if (dU > this.pkDmax) dU = this.pkDmax; // nor hold more than this (a ringing string knocking against it)
      this.pkY += vU + dU;
      this.pkLast = dU;
      const nl = this.pkNail;
      if (nl && dU >= nl.at * this.pkDmax) {
        // the nail catches the string: it will let go faster than flesh, with a faint click
        this.pkRelFrames = nl.rel;
        this.pkClick = nl.click * this.pkDmax;
        this.pkNail = null;
      }
      if ((dU >= this.pkDmax && n >= 0.6 * this.pkHold) || n >= this.pkMax) this.letGo();
      dU = dU * (1 + this.pkNoise * (2 * this.rnd() - 1)) + this.pkClick;
      this.pkClick = 0;
    }
    const fV = (dU * uV - dP * uH) / W, fH = (dU * uH + dP * uV) / W;
    for (let j = 0; j < W; j++) {
      const ia = (w - this.pkA - j) & m, ib = (w - this.pkB + j) & m;
      bv[ia] += fV; bv[ib] -= fV; bh[ia] += fH; bh[ib] -= fH;
    }
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
  // The setting is a loudness control: its square root, so that low settings stay audible.
  squeak(dur, amt, P) {
    const lvl = amt * Math.sqrt(P.fingerNoise);
    if (!(lvl > 0) || !(dur > 0)) return;
    this.sqLen = this.sqN = Math.max(64, Math.round(dur * this.fs));
    this.sqAmp = lvl * (this.wound ? 0.7 : 0.06);
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
    if (this.bridge) {
      // the bridge takes what the body takes; only the string's own losses remain here
      const dv = designDamping(f, b1 * this.ownLoss * this.tied, b3, fs);
      this.aV = dv.a; this.gV = dv.g;
      const dh = designDamping(f * this.polDet, b1 * 0.7 * this.tied, b3 * 0.9, fs);
      this.aH = dh.a; this.gH = dh.g;
      return;
    }
    const dv = designDamping(f, b1 * 1.45, b3, fs);
    this.aV = dv.a; this.gV = dv.g;
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
    // the bridge's give shifts the pitch of what it radiates: tune the fundamental for it
    const br = this.bridge;
    this.tV = Math.max(2.001, fs / f - lpDelay(this.aV, w) - apV - (br ? br.reflectionDelay(this.loopV, f) : 0));
    this.tH = Math.max(2.001, fs / fH - lpDelay(this.aH, wH) - apH - (br ? br.reflectionDelay(this.loopH, fH) : 0));
    if (immediate) { this.dV = this.tV; this.dH = this.tH; this.dVinc = 0; this.dHinc = 0; }
  }

  // the small pulse of a hammer-on, pull-off or slide (the fretting hand, not the plucker)
  tapExc(f, vel, P, tech, dir) {
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
      // a change of fret lets the old note go; on the same fret only the plucker damps it
      if (Math.abs(this.curFreq / f - 1) > 0.01) this.quiet(0.2);
      this.retune(f, true);
      this.excLen = 0;
      this.strokeFrame = Math.round(t * this.fs);
      this.startStroke(ev, P, f, harm, pm);
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
      this.tapExc(f, ev.v * (slide ? 0.1 : 0.4), P, 'soft', ev.d);
      if (slide) this.squeak(this.gDur, clamp(Math.abs(from) / 7, 0.3, 1) * 0.8, P);
      if (pm) {
        this.retune(f, false);
        this.touch(PALM.map((x) => x * f / this.openF), N, PALM_K, 0.004, 0);
      } else if (this.tkT < 1) this.release(0.01);
    }
  }

  // a finger travels along the string; with `lift` it is the finger that held the note
  shift(dur, amt, P, lift) {
    this.squeak(dur, amt, P);
    // no longer pressed down, the string rests against the fingertip and dies away
    if (lift && this.sounding && this.tkT >= 1) this.touch(LIFT, this.fs / this.curFreq, 0.9, 0.015, 0);
  }

  // a hand comes down on the string
  mute(fast) {
    this.sounding = false;
    this.gFrom = 0; this.bendAmt = 0; this.vibDepth = 0;
    this.excLen = 0; this.contact = 0;
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
    this.sqN = 0; this.contact = 0;
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

  tickWrite(vj, vh = 0) {
    let e = 0;
    if (this.excPos < this.excLen) e = this.exc[this.excPos++];
    let dm = 1;
    if (this.dampCount > 0) { dm = this.dampGain; this.dampCount--; }
    let yv = e * this.excV + (this.uV - vj) * dm;
    let yh = e * this.excH + (this.uH - vh) * dm;
    if (yv < 1e-18 && yv > -1e-18) yv = 0;
    if (yh < 1e-18 && yh > -1e-18) yh = 0;
    let sq = 0;
    if (this.sqN > 0) { sq = this.squeakTick(); yv += 0.5 * sq; }
    const bv = this.bv, bh = this.bh, w = this.w, m = this.mask;
    bv[w] = yv; bh[w] = yh;
    if (this.contact) this.pluckTick(bv, bh, w, m);
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
    // towards-top motion (plus finger noise) is returned, along-top motion kept aside:
    // the body hears the two through different paths
    this.outH = yh * this.gain;
    return yv * this.gain + sq;
  }

  clear() {
    this.bv.fill(0); this.bh.fill(0);
    this.axV.fill(0); this.ayV.fill(0); this.axH.fill(0); this.ayH.fill(0);
    this.lpV = 0; this.lpH = 0; this.excLen = 0; this.dampCount = 0;
    this.sqN = 0; this.sqX1 = this.sqX2 = this.sqY1 = this.sqY2 = this.sqLp = 0;
    this.contact = 0;
  }
}

// ---- the bridge ---------------------------------------------------------------
// With a modelled body the strings are not tied to a rigid bridge but to the
// body's lowest resonances. Every string loop (towards-top and along-top
// motion of each string) pushes on the bridge at its own point; the bridge
// moves; that motion goes back into every loop.
//
//   mode k:  velocity per unit modal force  s / (s² + ηω s + ω²)   (bilinear, pre-warped)
//            v_k = b0_k f_k + s1_k
//   c_ik     how much loop i moves with mode k (phi for towards-top, rock for along-top)
//   B = C diag(b0) Cᵀ + G       instantaneous bridge mobility (G: the rest of the body, a plate)
// The string loops carry force waves u (velocity wave x string impedance z), so that
// what the engine sends on to the body adds up like the force on the bridge does:
//   bridge velocity  vb = W (2 B u + C s1),   W = (I + B Z)⁻¹
//   force            F  = 2u − Z vb            reflected wave  u − Z vb
// A motion in which the strings' forces cancel leaves the bridge still - and is not heard.
// Solved exactly each sample, and built from positive residues only, so the
// bridge can absorb energy from the strings but never supply any.

const STANDARD = [40, 45, 50, 55, 59, 64];

class Bridge {
  constructor(fs) { this.fs = fs; this.n = 0; this.K = 0; }

  // data: { K, f, eta, phi[6 x K], rock[6 x K], z[6], gRes }; voices: plucked voices (6 or 12)
  configure(data, voices, coupling, tune) {
    const fs = this.fs, nv = voices.length, n = 2 * nv, K = data.K;
    this.n = n; this.K = K; this.nv = nv;
    this.b0 = new Float64Array(K); this.a1 = new Float64Array(K); this.a2 = new Float64Array(K);
    if (!this.s1 || this.s1.length !== K) { this.s1 = new Float64Array(K); this.s2 = new Float64Array(K); }
    for (let k = 0; k < K; k++) {
      const w = TAU * data.f[k], c0 = w / Math.tan(w / (2 * fs));
      const a0 = c0 * c0 + data.eta[k] * w * c0 + w * w;
      this.b0[k] = c0 / a0; this.a1[k] = (2 * (w * w - c0 * c0)) / a0; this.a2[k] = (c0 * c0 - data.eta[k] * w * c0 + w * w) / a0;
    }
    const C = this.C = new Float64Array(n * K), Z = this.Z = new Float64Array(n), G = this.G = new Float64Array(n);
    let pp = 0, rr = 0;
    for (let i = 0; i < 6 * K; i++) { pp += data.phi[i] ** 2; rr += data.rock[i] ** 2; }
    for (let i = 0; i < nv; i++) {
      const s = i % 6;
      // impedance follows the string's tension; the thin octave strings of a 12-string are lighter
      const z = data.z[s] * coupling * Math.pow(2, ((tune ? tune[s] : STANDARD[s]) - STANDARD[s]) / 12) * (i >= 6 && s < 4 ? 0.55 : 1);
      Z[i] = z; Z[nv + i] = z;
      G[i] = data.gRes; G[nv + i] = (data.gRes * rr) / pp;
      for (let k = 0; k < K; k++) { C[i * K + k] = data.phi[s * K + k]; C[(nv + i) * K + k] = data.rock[s * K + k]; }
    }
    // W = (I + B Z)^-1 by Gauss-Jordan
    const B = new Float64Array(n * n), A = new Float64Array(n * 2 * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let b = i === j ? G[i] : 0;
      for (let k = 0; k < K; k++) b += C[i * K + k] * this.b0[k] * C[j * K + k];
      B[i * n + j] = b;
      A[i * 2 * n + j] = (i === j ? 1 : 0) + b * Z[j];
      A[i * 2 * n + n + j] = i === j ? 1 : 0;
    }
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r * 2 * n + c]) > Math.abs(A[piv * 2 * n + c])) piv = r;
      if (piv !== c) for (let j = 0; j < 2 * n; j++) { const t = A[c * 2 * n + j]; A[c * 2 * n + j] = A[piv * 2 * n + j]; A[piv * 2 * n + j] = t; }
      const d = A[c * 2 * n + c];
      for (let j = 0; j < 2 * n; j++) A[c * 2 * n + j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const m = A[r * 2 * n + c];
        if (m !== 0) for (let j = 0; j < 2 * n; j++) A[r * 2 * n + j] -= m * A[c * 2 * n + j];
      }
    }
    // vb = A1 u + A2 s1
    const A1 = this.A1 = new Float64Array(n * n), A2 = this.A2 = new Float64Array(n * K);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let v = 0;
        for (let m = 0; m < n; m++) v += A[i * 2 * n + n + m] * B[m * n + j];
        A1[i * n + j] = 2 * v;
      }
      for (let k = 0; k < K; k++) {
        let v = 0;
        for (let m = 0; m < n; m++) v += A[i * 2 * n + n + m] * C[m * K + k];
        A2[i * K + k] = v;
      }
    }
    if (!this.u || this.u.length !== n) { this.u = new Float64Array(n); this.vb = new Float64Array(n); }
    if (!this.fk || this.fk.length !== K) this.fk = new Float64Array(K);
  }

  // u: the force waves arriving at the bridge; returns, per loop, what the bridge's motion takes out of its reflection (Z vb)
  step() {
    const n = this.n, K = this.K, u = this.u, vb = this.vb, A1 = this.A1, A2 = this.A2, C = this.C, Z = this.Z, s1 = this.s1, s2 = this.s2, fk = this.fk;
    fk.fill(0);
    for (let i = 0; i < n; i++) {
      let v = 0, o = i * n;
      for (let j = 0; j < n; j++) v += A1[o + j] * u[j];
      o = i * K;
      for (let k = 0; k < K; k++) v += A2[o + k] * s1[k];
      v *= Z[i];
      vb[i] = v;
      const F = 2 * u[i] - v;
      for (let k = 0; k < K; k++) fk[k] += C[o + k] * F;
    }
    for (let k = 0; k < K; k++) {
      const f = fk[k], y = this.b0[k] * f + s1[k];
      let a = s2[k] - this.a1[k] * y, b = -this.b0[k] * f - this.a2[k] * y;
      if (a < 1e-30 && a > -1e-30) a = 0;
      if (b < 1e-30 && b > -1e-30) b = 0;
      s1[k] = a; s2[k] = b;
    }
    return vb;
  }

  // phase delay (samples) of the reflection a single loop sees at frequency f, so notes can be tuned for it
  reflectionDelay(loop, f) {
    const w = (TAU * f) / this.fs, K = this.K, c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
    let yr = this.G[loop], yi = 0;
    for (let k = 0; k < K; k++) {
      const c = this.C[loop * K + k], g = c * c * this.b0[k];
      if (g === 0) continue;
      const nr = 1 - c2, ni = -s2;                                    // 1 - z^-2
      const dr = 1 + this.a1[k] * c1 + this.a2[k] * c2, di = this.a1[k] * s1 + this.a2[k] * s2;
      const den = dr * dr + di * di;
      yr += (g * (nr * dr + ni * di)) / den; yi += (g * (ni * dr - nr * di)) / den;
    }
    const z = this.Z[loop];
    // R = (1 - zY) / (1 + zY)
    const ar = 1 - z * yr, ai = -z * yi, br = 1 + z * yr, bi = z * yi;
    return -(Math.atan2(ai, ar) - Math.atan2(bi, br)) / w;
  }

  clear() { if (this.s1) { this.s1.fill(0); this.s2.fill(0); } }
}

// ---- engine ----------------------------------------------------------------

class VibetarEngine {
  constructor(fs) {
    this.fs = fs;
    this.rnd = mulberry32(0x5eed);
    this.queue = [];
    this.voices = [];
    this.pairs = null;
    this.preset = '';
    this.dcx = new Float64Array(6); this.dcy = new Float64Array(6);
    this.mixH = 0.6; this.acc = new Float64Array(6);
    this.bridge = null; this.bridgeData = null; this.coupling = 1; this.tune = null;
    this.dcR = 1 - (TAU * 18) / fs;
    this.outGain = 0.3;
    this.pairGap = Math.round(0.011 * fs);
    this.P = { pickPos: 0.17, pickHard: 0.72, pickNoise: 0.1, b1Scale: 1, b3Scale: 1, fingerNoise: 0.3, pick: 0 };
    this.configure({ preset: 'steel', open: [40, 45, 50, 55, 59, 64] });
  }

  // c: { preset, open:[midi x6], tune, pickPos, pickHard, bright, sustain, coupling, fingerNoise, pick, bridge }
  configure(c) {
    const pr = PRESETS[c.preset] || PRESETS.steel;
    const fs = this.fs;
    const rebuild = c.preset !== this.preset;
    const P = this.P;
    if (c.pickPos != null) P.pickPos = clamp(c.pickPos, 0.04, 0.45);
    if (c.pickHard != null) P.pickHard = clamp(c.pickHard, 0, 1);
    if (c.sustain != null) P.b1Scale = Math.pow(3, -clamp(c.sustain, -1, 1));
    if (c.bright != null) P.b3Scale = Math.pow(5, -clamp(c.bright, -1, 1));
    if (c.fingerNoise != null) P.fingerNoise = clamp(c.fingerNoise, 0, 1);
    if (c.pick != null) P.pick = clamp(Math.round(c.pick), 0, 4);
    P.pickNoise = pr.pickNoise || 0;
    this.mixH = pr.mixH || 0;
    const nPair = pr.pair ? 6 : 0;
    const hadBridge = !!this.bridge;
    if ('bridge' in c) this.bridgeData = c.bridge || null;
    if (c.tune) this.tune = c.tune;
    if (c.coupling != null) this.coupling = clamp(c.coupling, 0, 1);
    if (rebuild) {
      this.preset = c.preset;
      this.voices = [];
      for (let i = 0; i < 6 + nPair; i++) this.voices.push(new PluckVoice(fs, this.rnd));
      this.pairs = pr.pair ? true : null;
    }
    const open = c.open || this.open || [40, 45, 50, 55, 59, 64];
    const retuned = !this.open || open.some((m, i) => m !== this.open[i]);
    this.open = open;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const s = i % 6, isPair = i >= 6;
      // the open frequency includes the octave or unison offset of a 12-string's second string
      v.pitchMul = isPair ? Math.pow(2, pr.pair[s] / 12) : 1;
      v.openF = midiHz(open[s]) * v.pitchMul;
      v.ratio = 1;
      v.gain = isPair ? pr.pairGain[s] : pr.gain[s];
      v.b1 = isPair ? pr.pairB1[s] : pr.b1[s];
      v.b3 = isPair ? pr.pairB3[s] : pr.b3[s];
      v.apN = isPair ? 0 : pr.apN[s];
      v.apC0 = isPair ? 0 : pr.apC[s];
      v.mixH = pr.mixH;
      const cents = pr.polCents * (0.7 + 0.6 * ((s * 7 + (isPair ? 3 : 0)) % 5) / 4) * (s % 2 ? -1 : 1);
      v.polDet = Math.pow(2, cents / 1200);
      v.wound = !isPair && s < (pr.wound || 0);
      v.sIdx = s; v.zone = s >> 1;
      // longitudinal resonance that colours the finger noise
      const w0 = (TAU * (1500 + 330 * s)) / fs, al = Math.sin(w0) / 5;
      v.sqB0 = al / (1 + al); v.sqA1 = (-2 * Math.cos(w0)) / (1 + al); v.sqA2 = (1 - al) / (1 + al);
    }
    // tie the strings to the modelled body's bridge, if there is one
    const bridged = !!this.bridgeData;
    if (bridged) {
      if (!this.bridge) this.bridge = new Bridge(fs);
      this.bridge.configure(this.bridgeData, this.voices, this.coupling, this.tune);
    } else this.bridge = null;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      v.bridge = this.bridge; v.loopV = i; v.loopH = this.voices.length + i;
      v.tied = pr.tied ? pr.tied[i % 6] : 1;
      // with less coupling the string keeps more of the loss a rigid bridge would have given it
      v.ownLoss = OWN_LOSS + (1 - this.coupling) * (1.45 - OWN_LOSS);
      // Back to the open, freely ringing state only when the instrument or tuning changed, or
      // the bridge came or went under an idle string. A stopped string or a dead note stays
      // as it is: settings change all the time while playing.
      const idle = !v.sounding && v.tkT >= 1 && !v.contact;
      if (rebuild || retuned || (idle && hadBridge !== bridged)) v.rest();
    }
  }

  post(ev) {
    const q = this.queue;
    if (ev.t != null) {
      ev.frame = Math.round(ev.t * this.fs);
      // a note's time is when the string is let go: the stroke starts earlier
      if (ev.type === 'n') ev.frame = Math.max(0, ev.frame - this.voices[ev.s].strokeFrames(ev, this.P));
    } else if (ev.frame == null) ev.frame = 0;
    let i = q.length;
    while (i > 0 && q[i - 1].frame > ev.frame) i--;
    q.splice(i, 0, ev);
  }

  handle(ev, frame) {
    const t = frame / this.fs, vs = this.voices;
    switch (ev.type) {
      case 'n': {
        // the stroke must be over when the string's next stroke begins
        for (const nx of this.queue) if (nx.type === 'n' && nx.s === ev.s && nx.vi == null) { ev.lim = Math.max(4, nx.frame - frame - 2); break; }
        if (this.pairs && ev.vi == null) {
          const first = ev.d < 0 ? ev.s : ev.s + 6;
          const second = ev.d < 0 ? ev.s + 6 : ev.s;
          this.note(vs[first], ev, t);
          this.post({ type: 'n', vi: second, frame: frame + this.pairGap + ((this.rnd() * 90) | 0), s: ev.s, f: ev.f, v: ev.v, k: ev.k, fr: ev.fr, d: ev.d, hb: ev.hb, fg: ev.fg, rs: ev.rs, pp: ev.pp, lim: ev.lim });
        } else {
          this.note(vs[ev.vi != null ? ev.vi : ev.s], ev, t);
        }
        break;
      }
      case 'o':
        vs[ev.s].mute(false);
        if (this.pairs) vs[ev.s + 6].mute(false);
        break;
      case 'q': // a finger travels along string s; nl: it does not hold the note on it
        vs[ev.s].shift(ev.dur, ev.amt, this.P, !ev.nl);
        break;
      case 'O':
        for (const v of vs) v.mute(true);
        break;
      case 'R':
        for (const v of vs) { v.clear(); v.rest(); }
        if (this.bridge) this.bridge.clear();
        break;
    }
  }

  note(v, ev, t) {
    if (v.pitchMul && v.pitchMul !== 1) {
      v.noteOn({ f: ev.f * v.pitchMul, v: ev.v, k: ev.k, fr: ev.fr, d: ev.d, hb: ev.hb, fg: ev.fg, rs: ev.rs, pp: ev.pp, lim: ev.lim }, this.P, t);
    } else v.noteOn(ev, this.P, t);
  }

  flush() { this.queue.length = 0; }

  // Output: six channels - what the bass (two lowest strings), middle and treble part of the
  // bridge receives from the strings' towards-top motion (0-2) and along-top motion (3-5).
  // A single Float32Array instead gets the mono mix  ch0 + ch1 + ch2 + mixH·(ch3 + ch4 + ch5).
  render(out, n, frame0) {
    const vs = this.voices, nv = vs.length, q = this.queue;
    const multi = Array.isArray(out);
    const o0 = multi ? out[0] : out;
    const dx = this.dcx, dy = this.dcy, R = this.dcR, mixH = this.mixH, acc = this.acc;
    const t = frame0 / this.fs;
    for (let k = 0; k < nv; k++) vs[k].updateMod(t, n);
    let i = 0;
    while (i < n) {
      while (q.length && q[0].frame <= frame0 + i) this.handle(q.shift(), frame0 + i);
      let end = n;
      if (q.length) { const e = q[0].frame - frame0; if (e < end) end = e; }
      const g = this.outGain, br = this.bridge;
      for (; i < end; i++) {
        let vb = null;
        if (br) {
          const u = br.u;
          for (let k = 0; k < nv; k++) { u[k] = vs[k].tickRead(); u[nv + k] = vs[k].uH; }
          vb = br.step();
        } else for (let k = 0; k < nv; k++) vs[k].tickRead();
        acc[0] = acc[1] = acc[2] = acc[3] = acc[4] = acc[5] = 0;
        for (let k = 0; k < nv; k++) {
          const v = vs[k], x = vb ? v.tickWrite(vb[k], vb[nv + k]) : v.tickWrite(0);
          acc[v.zone] += x; acc[3 + v.zone] += v.outH;
        }
        let mono = 0;
        for (let c = 0; c < 6; c++) {
          const y = acc[c] - dx[c] + R * dy[c];
          dx[c] = acc[c]; dy[c] = y;
          if (multi) out[c][i] = y * g; else mono += c < 3 ? y : mixH * y;
        }
        if (!multi) o0[i] = mono * g;
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
      if (ch.length >= 6) this.engine.render(ch, ch[0].length, currentFrame);
      else this.engine.render(ch[0], ch[0].length, currentFrame);
      return true;
    }
  });
}

export { VibetarEngine, PRESETS, PLUCKERS, SCALE, designDamping, midiHz };
