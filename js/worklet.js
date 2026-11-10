// Vibetar string engine — physically modelled plucked strings.
//
// Plucked strings are digital waveguides (extended Karplus-Strong) with:
//   * two transverse polarisations per string (slightly detuned, different
//     decay rates) -> beating and the two-stage decay of a real string
//   * frequency dependent damping fitted to a physical loss model
//     sigma(f) = b1 + b3 f^2 / (1 + (f / flat)^2) for every note
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

// The loss filter: a first-order shelf  H(z) = (1-m) + m (1-a) / (1 - a z^-1).
// m = 1 is a one-pole lowpass; a smaller m stops the loss from growing above the corner.
function shelf(a, m, w) {
  const c = Math.cos(w), d = 1 - 2 * a * c + a * a;
  return { re: 1 - m + (m * (1 - a) * (1 - a * c)) / d, im: (-m * (1 - a) * a * Math.sin(w)) / d };
}
function lpMag(a, m, w) { const h = shelf(a, m, w); return Math.hypot(h.re, h.im); }
function lpDelay(a, m, w) { const h = shelf(a, m, w); return -Math.atan2(h.im, h.re) / w; } // phase delay in samples
// first-order allpass  H(z) = (c + z^-1) / (1 + c z^-1), phase delay in samples
function apDelay(c, w) {
  const s = Math.sin(w), co = Math.cos(w);
  return -(Math.atan2(-s, c + co) - Math.atan2(-c * s, 1 + c * co)) / w;
}

const HOLD = 0.002;

// Weights of a fifth-order Lagrange interpolator for a point x (2 <= x < 3) between six samples.
function lagrange(h, x) {
  const x1 = x - 1, x2 = x - 2, x3 = x - 3, x4 = x - 4, x5 = x - 5;
  const p01 = x * x1, p23 = x2 * x3, p45 = x4 * x5;
  h[0] = (-x1 * p23 * p45) / 120; h[1] = (x * p23 * p45) / 24;
  h[2] = (-p01 * x3 * p45) / 12; h[3] = (p01 * x2 * p45) / 12;
  h[4] = (-p01 * p23 * x5) / 24; h[5] = (p01 * p23 * x4) / 120;
}

// Fit the loss filter (pole a, depth m) and the loop gain g so that a string at f0 decays
// with rate sigma(f) = b1 + b3 f^2 / (1 + (f / flat)^2)  (amplitude ~ exp(-sigma t)).
// flat = 0: the loss grows with the square of the frequency throughout (a one-pole lowpass).
// Otherwise the pole sits at `flat` and the depth sets the loss. A loss too large for that
// (a muted string) gets the lowpass.
function designDamping(f0, b1, b3, fs, flat = 0) {
  const w0 = (TAU * f0) / fs;
  const fh = Math.min(0.42 * fs, Math.max(5 * f0, 3500));
  const wh = (TAU * fh) / fs;
  const sigma = (f) => b1 + (b3 * f * f) / (flat ? 1 + (f / flat) ** 2 : 1);
  const s0 = sigma(f0), sh = sigma(fh);
  const G0 = Math.exp(-s0 / f0);
  const ratio = Math.exp(-(sh - s0) / f0);
  const drop = (a, m) => lpMag(a, m, wh) / lpMag(a, m, w0);
  let a = flat ? Math.exp((-TAU * flat) / fs) : 0, m = 1;
  if (flat && drop(a, 1) < ratio) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      m = 0.5 * (lo + hi);
      if (drop(a, m) > ratio) lo = m; else hi = m;
    }
  } else {
    let lo = 0, hi = 0.995;
    for (let i = 0; i < 30; i++) {
      a = 0.5 * (lo + hi);
      if (drop(a, 1) > ratio) lo = a; else hi = a;
    }
  }
  return { a, m, g: Math.min(0.99999, G0 / lpMag(a, m, w0)) };
}

// Stiffness: M equal first-order allpass sections in the loop, together with the loss
// filter (pole a, depth m), delay the low partials more than the high ones. Returns
// the section coefficient c that puts partials 2..K (up to 5 kHz) closest to
// f_k = k f sqrt((1 + B k²) / (1 + B)), the fundamental being tuned exactly by the delay line.
// The loop's phase delay at f_k must be k fs / f_k; each partial's stretch counts relative to
// what it should be, so every partial's inharmonicity weighs alike; low partials weigh more.
const MAX_SECTIONS = 6;
const LONG_Q = 6;     // of the longitudinal resonance
function sectionsFor(f, B, fs) {
  const N = fs / f, K = Math.max(2, Math.min(30, Math.floor(5000 / f)));
  // first-order sections stretch the high partials too little on the stiffest strings: one more there
  return clamp(Math.ceil((N * (1 - 1 / Math.sqrt(1 + B * K * K))) / 3), B >= 4e-5 ? 2 : 1, MAX_SECTIONS);
}
function designDispersion(f, B, M, a, m, fs) {
  const N = fs / f, K = Math.max(2, Math.min(30, Math.floor(5000 / f)));
  const w1 = (TAU * f) / fs;
  const err = (c) => {
    const at1 = lpDelay(a, m, w1) + M * apDelay(c, w1);
    let e = 0;
    for (let k = 2; k <= K; k++) {
      const fk = k * f * Math.sqrt((1 + B * k * k) / (1 + B)), w = (TAU * fk) / fs;
      if (w > 0.9 * Math.PI) break;
      const need = N - (k * fs) / fk, r = (N + lpDelay(a, m, w) + M * apDelay(c, w) - at1 - (k * fs) / fk) / need;
      e += (r * r) / k;
    }
    return e;
  };
  // golden-section search; stiffness only ever needs a negative coefficient
  let lo = -0.97, hi = 0;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), e1 = err(x1), e2 = err(x2);
  for (let i = 0; i < 40; i++) {
    if (e1 < e2) { hi = x2; x2 = x1; e2 = e1; x1 = hi - g * (hi - lo); e1 = err(x1); }
    else { lo = x1; x1 = x2; e1 = e2; x2 = lo + g * (hi - lo); e2 = err(x2); }
  }
  const c = 0.5 * (lo + hi);
  return err(c) < err(0) ? c : 0;
}

// ---- instrument definitions ----------------------------------------------
// index 0 = lowest string. b1 [1/s] broadband loss, b3 [s] high-frequency loss.
//   flat     frequency (Hz) above which the loss stops growing with the square of the frequency
//            (0: never). A plain steel string loses its energy to the air and to heat flowing
//            across the bending wire: both grow more slowly than the friction inside nylon.
//            Fitted from 2 to 10 kHz to
//            sigma = (R0 + R1 sqrt(f)) / (2 mu) + pi f (2.0e-4 + 4 pi² mu E I d f² / T²)
//            (air, thermoelastic and viscoelastic loss of a 0.3 mm steel wire). The winding of
//            a new bronze-wound string takes about the same share of the energy in every
//            cycle, not a share that keeps growing: a Q near 3000 from 4 kHz up (an estimate).
//   B        inharmonicity of the open string: partials at k f sqrt((1 + B k²) / (1 + B)).
//            B = π³ E d⁴ / (64 T L²) with the diameter d of the string, of the core for a wound one
//   tm       how far (cents) an mf pluck of the open string starts sharp: the plucked string is
//            stretched, so its tension rises with its energy (tension modulation)
//   fL       first longitudinal resonance, as a multiple of the open string's pitch
//   phantom  level (dB) of the longitudinal pull on the bridge against the towards-top force, at mf
//   dia      outer diameter in millimetres: a thick string takes longer to roll off a pick or nail
// Steel: a 12-53 phosphor bronze set on a 648 mm scale (E 200 GPa, tensions 104-142 N, core
// diameters 0.28-0.46 mm). The pitch rise is the mean extra tension E A ΔL / L of a pluck
// 0.8 (top) to 2 mm (bass) wide; the longitudinal force on the bridge goes as (E A / 2 T) times
// the string's slope there. Nylon: E about 3 GPa; its bass strings have a soft multifilament core.
// tmE and phCal convert the engine's units: the loop energy of an mf pluck, and the gain that
// gives the longitudinal pull its level.

const PRESETS = {
  steel: {
    b1: [0.50, 0.55, 0.62, 0.72, 0.80, 0.90],
    b3: [3.7e-7, 3.4e-7, 3.2e-7, 3.0e-7, 2.2e-7, 2.0e-7],
    B: [8.3e-5, 4.6e-5, 2.7e-5, 1.1e-5, 6.0e-5, 1.9e-5],
    tm: [4.1, 2.0, 1.1, 0.5, 0.95, 0.34],
    fL: [16.4, 13.6, 12.0, 9.6, 15.8, 11.8],
    phantom: [-24, -29, -32, -38, -31, -38],
    dia: [1.35, 1.07, 0.81, 0.61, 0.41, 0.30],
    tmE: [70.9, 73.1, 45.3, 26.5, 17.4, 9.87],
    phCal: [12.4, 9.88, 9.04, 12, 23.8, 15.4],
    flat: [6000, 6000, 6000, 6000, 8000, 8000],
    gain: [1.0, 1.0, 0.98, 0.94, 0.9, 0.86],
    mixH: 0.6, polCents: 0.9, pickNoise: 0.1, wound: 4,
    // the strings' own loss per string when tied to the modelled bridge, trimmed so that the
    // sustain heard through the body matches the reference in test/heard.test.mjs
    tied: [1, 1, 1, 0.6, 1.2, 1.2],
  },
  nylon: {
    b1: [0.95, 1.0, 1.1, 1.5, 1.65, 1.8],
    b3: [1.0e-6, 0.95e-6, 0.9e-6, 1.3e-6, 1.2e-6, 1.1e-6],
    B: [5e-6, 5e-6, 5e-6, 7.2e-5, 2.7e-5, 1.3e-5],
    tm: [0.9, 0.8, 0.7, 0.3, 0.3, 0.25],
    fL: [5.2, 5.0, 5.0, 6.4, 5.05, 3.8],
    phantom: [-41, -42, -43, -46, -47, -48],
    dia: [1.09, 0.89, 0.74, 1.02, 0.82, 0.71],
    tmE: [75, 65.5, 44.2, 22.9, 14.7, 9.53],
    phCal: [5.03, 5.08, 6.39, 8.43, 7.55, 6.86],
    gain: [1.0, 1.0, 1.0, 1.0, 0.97, 0.94],
    mixH: 0.55, polCents: 0.7, pickNoise: 0.04, wound: 3,
  },
  twelve: {
    b1: [0.55, 0.6, 0.68, 0.78, 0.85, 0.95],
    b3: [5.0e-7, 4.6e-7, 4.3e-7, 4.0e-7, 2.8e-7, 2.6e-7],
    B: [8.3e-5, 4.6e-5, 2.7e-5, 1.1e-5, 6.0e-5, 1.9e-5],
    tm: [3.3, 1.6, 0.9, 0.4, 0.8, 0.3],
    fL: [16.4, 13.6, 12.0, 9.6, 15.8, 11.8],
    phantom: [-25, -30, -33, -39, -32, -39],
    dia: [1.19, 0.91, 0.66, 0.58, 0.36, 0.25],
    tmE: [55.6, 66, 37.7, 31.1, 17.9, 11],
    phCal: [12.6, 12.5, 10.8, 13, 21.4, 18.7],
    flat: [6000, 6000, 6000, 6000, 8000, 8000],
    gain: [0.8, 0.8, 0.78, 0.76, 0.7, 0.66],
    mixH: 0.6, polCents: 0.9, pickNoise: 0.1, wound: 4,
    tied: [1, 1, 1, 0.55, 1.6, 1.15],
    // second string of each course: pitch offset in semitones (+ few cents)
    pair: [12.02, 12.03, 12.02, 12.03, 0.05, -0.05],
    pairB1: [0.85, 0.9, 0.95, 1.05, 0.8, 0.9],
    pairB3: [3.6e-7, 3.4e-7, 3.2e-7, 3.0e-7, 3.4e-7, 3.0e-7],
    pairFlat: [8000, 8000, 8000, 8000, 8000, 8000],
    pairGain: [0.62, 0.62, 0.6, 0.58, 0.7, 0.66],
    // the thin plain octave strings, and the unison strings like their partners
    pairB: [2e-5, 2e-5, 2e-5, 2e-5, 6.0e-5, 1.9e-5],
    pairTm: [0.3, 0.3, 0.3, 0.3, 0.8, 0.3],
    pairFL: [23.6, 17.7, 13.3, 9.9, 15.8, 11.8],
    pairPhantom: [-36, -36, -37, -39, -32, -39],
    pairDia: [0.69, 0.46, 0.30, 0.20, 0.36, 0.25],
    pairTmE: [36.3, 21.9, 12.5, 6.73, 17.1, 9.98],
    pairPhCal: [12.6, 12.5, 10.8, 13, 21.4, 18.7],
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
//   relMs     how long the string takes to slide off once the plucker lets go, at mf (for a
//             plucker with an edge: a string of no thickness)
//   edge      a hard plucker (pick, nail): the string rolls off its edge over its own
//             thickness, which takes 1 + (string diameter / edge, in mm) times as long, and a
//             faster stroke is past the string sooner (see RELEASE). Flesh lets go in its own
//             time, a little sooner when the stroke is firm.
//   noise     roughness of the contact, as a share of the force. Kept small: more of it covers
//             the difference between a soft and a hard stroke with the same hiss.
//   nail      a nail behind the flesh catches the string at `at` x the release force
const PLUCKERS = [
  { name: 'pick', k: 0.9, r: 0.3, widthMm: 1, relMs: 0.13, edge: 1.5, holdMs: 3, thetaDeg: 25, noise: 0.015, pos: 1.0, gain: 1 },
  { name: 'flesh', k: 0.3, r: 6, widthMm: 10, relMs: 0.9, holdMs: 4.5, thetaDeg: 40, noise: 0.02, pos: 1.25, gain: 1 },
  { name: 'short nails', k: 0.3, r: 6, widthMm: 10, relMs: 0.9, holdMs: 4.5, thetaDeg: 45, noise: 0.02, pos: 1.1, gain: 1,
    nail: { at: 0.7, relMs: 0.35, click: 0.04 } },
  { name: 'long nails', k: 0.8, r: 0.4, widthMm: 2, relMs: 0.18, edge: 2.5, holdMs: 4, thetaDeg: 50, noise: 0.012, pos: 1.0, gain: 1 },
  { name: 'thumb', k: 0.25, r: 6, widthMm: 14, relMs: 0.9, holdMs: 5, thetaDeg: 45, noise: 0.02, pos: 1.4, gain: 1 },
];
const HAMMER = 1.12;   // strength of a hammer-on blow, against a pluck at the same velocity
const PULL_OFF = 0.94; // and of the flick of a pull-off
const PUSH = 0.1;    // how quickly the hand corrects its speed to have the force ready on time
const RELEASE = 0.75; // an edge lets go in a time that goes with (0.8 / strength) to this power: 1 if only the stroke's speed set it
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
    this.aV = 0.1; this.mV = 1; this.gV = 0.99; this.lpV = 0;
    this.aH = 0.1; this.mH = 1; this.gH = 0.99; this.lpH = 0;
    this.apN = 0; this.apC = 0; this.apCache = new Map(); this.B = 0;
    this.axV = new Float64Array(MAX_SECTIONS); this.ayV = new Float64Array(MAX_SECTIONS);
    this.axH = new Float64Array(MAX_SECTIONS); this.ayH = new Float64Array(MAX_SECTIONS);
    // tension modulation, and the longitudinal pull: gain, resonator coefficients and state
    this.tmK = 0; this.tmAge = 0; this.tmRise = 0; this.fL = 12; this.phG = 0;
    this.phN = new Float64Array(3); this.phS = new Float64Array(4);
    this.dV = 100; this.dH = 100; this.dVinc = 0; this.dHinc = 0;
    // interpolator weights, and the loop lengths they belong to
    this.hV = new Float64Array(6); this.hH = new Float64Array(6); this.hVd = 0; this.hHd = 0;
    this.hVn = -1; this.hHn = -1;
    this.tV = 100; this.tH = 100;
    this.dampGain = 1; this.dampCount = 0;
    this.uV = 0; this.uH = 0;
    // material / config
    this.openF = 110; this.ratio = 1; this.b1 = 0.6; this.b3 = 6e-7; this.flat = 0; this.dia = 0;
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
    const pace = pl.edge ? Math.pow(0.8 / clamp(vel, 0.3, 1.2), RELEASE) : 1.6 - 0.8 * Math.min(1, vel);
    const rel = (ms) => clamp(((ms * fs) / 1000 / att) * pace, 1.5, 0.2 * N);
    this.pkRelFrames = rel(pl.relMs * (pl.edge ? 1 + this.dia / pl.edge : 1));
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
    for (let i = 0; i < MAX_SECTIONS; i++) { this.axV[i] *= g; this.ayV[i] *= g; this.axH[i] *= g; this.ayH[i] *= g; }
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
    // tau: delay of the loop filters, lumped at the bridge. On a stiff wound string it can reach
    // past points near the bridge (the palm): then all points move away from it together, just
    // far enough, keeping their spacing.
    const n0 = D | 0, tau = N - D;
    let shift = 0;
    for (let i = 0; i < this.tn; i++) shift = Math.max(shift, 1 - Math.round((this.tx[i] - tau) / 2));
    for (let i = 0; i < this.tn; i++) {
      const x = this.tx[i];
      let a = Math.round((x - tau) / 2) + shift;
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
    const fs = this.fs, flat = this.flat;
    // the bridge takes what the body takes; only the string's own losses remain here
    const own = this.bridge ? this.ownLoss * this.tied : 1.45, along = this.bridge ? 0.7 * this.tied : 0.7;
    const dv = designDamping(f, b1 * own, b3, fs, flat);
    this.aV = dv.a; this.mV = dv.m; this.gV = dv.g;
    const dh = designDamping(f * this.polDet, b1 * along, b3 * 0.9, fs, flat);
    this.aH = dh.a; this.mH = dh.m; this.gH = dh.g;
  }

  // Stiffness and longitudinal resonance of the string stopped for a note at f: both follow
  // the vibrating length. Stiffness grows with the square of the frequency. After setDamping.
  setStiffness(f) {
    const key = (Math.round(f * 64) * 100000 + Math.round(this.aV * 1e5)) * 4096 + Math.round(this.mV * 4095);
    let c = this.apCache.get(key);
    if (c == null) {
      c = this.apN ? designDispersion(f, this.B * (f / this.openF) ** 2, this.apN, this.aV, this.mV, this.fs) : 0;
      if (this.apCache.size > 512) this.apCache.clear();
      this.apCache.set(key, c);
    }
    this.apC = c;
    // the longitudinal pull rings at the string's longitudinal resonance (a bandpass)
    const w = Math.min(0.9 * Math.PI, (TAU * this.fL * f) / this.fs);
    const al = Math.sin(w) / (2 * LONG_Q), a0 = 1 + al, b = this.phN;
    b[0] = al / a0; b[1] = (-2 * Math.cos(w)) / a0; b[2] = (1 - al) / a0;
  }

  // Stretching the string raises its tension with the energy it carries: the pitch rises
  // by tmK x (loop energy) relative to the note, falling back as the note dies away.
  // The energy is summed every fourth block (about 11 ms): it changes slowly.
  tension() {
    if (!this.tmK) return 0;
    if (this.tmAge-- > 0) return this.tmRise;
    this.tmAge = 3;
    const bv = this.bv, bh = this.bh, m = this.mask, n = this.dV | 0;
    let e = 0;
    for (let i = 1; i <= n; i++) { const j = (this.w - i) & m; e += bv[j] * bv[j] + bh[j] * bh[j]; }
    return (this.tmRise = this.tmK * e);
  }

  retune(f, immediate) {
    const fs = this.fs;
    f = clamp(f, 30, fs * 0.2);
    this.curFreq = f;
    const w = (TAU * f) / fs;
    const fH = f * this.polDet;
    const wH = (TAU * fH) / fs;
    let apV = 0, apH = 0;
    if (this.apN) { apV = this.apN * apDelay(this.apC, w); apH = this.apN * apDelay(this.apC, wH); }
    // the bridge's give shifts the pitch of what it radiates: tune the fundamental for it
    const br = this.bridge;
    this.tV = Math.max(3.001, fs / f - lpDelay(this.aV, this.mV, w) - apV - (br ? br.reflectionDelay(this.loopV, f) : 0));
    this.tH = Math.max(3.001, fs / fH - lpDelay(this.aH, this.mH, wH) - apH - (br ? br.reflectionDelay(this.loopH, fH) : 0));
    this.baseF = f; this.baseV = this.tV; this.baseH = this.tH;
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

  // The fretting finger sets the string going (fromF: the pitch before, up: a hammer-on).
  // Hammer-on: the fingertip strikes the string onto the new fret. The blow pushes the string
  // down next to that fret, about a fingertip from the new end: a displacement so close to an
  // end gives the upper partials relatively more than the fundamental. Soft flesh makes the
  // contact last about a millisecond; the motion is towards the top.
  // Pull-off: the finger leaves the higher fret with a sideways flick and so plucks the longer
  // string where it held it, 1 - f/fromF of the new length from its end. Flesh: round, and
  // mostly along the top.
  fretTap(f, fromF, vel, up, dir) {
    const fs = this.fs, rnd = this.rnd, exc = this.exc;
    // a soft contact of fixed length smooths the shorter periods of higher notes more
    const N = fs / f, g = clamp(Math.pow(f / 260, 0.12), 0.8, 1.25) * (dir < 0 ? -1 : 1);
    let L, wd, amp, th;
    if (up) {
      L = Math.max(1.5, (2 * 0.012 * fs) / this.waveSpeed());
      wd = fs * 0.0008 * (1.3 - 0.6 * Math.min(1, vel));
      amp = vel * HAMMER * g * Math.sqrt((0.15 * N) / L);
      th = 0.25;
    } else {
      L = clamp(1 - f / fromF, 0.03, 0.5) * N;
      wd = fs * (0.0012 + 0.001 * (1 - Math.min(1, vel)));
      amp = vel * PULL_OFF * g;
      th = 1.15;
    }
    th += 0.2 * (rnd() - 0.5);
    wd *= 1 + 0.2 * (rnd() - 0.5);
    const len = Math.min(Math.ceil(L + wd) + 1, exc.length);
    for (let n = 0; n < len; n++) {
      const a = n / wd;
      const s1 = a >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * a);
      const b = (n - L) / wd;
      const s2 = b <= 0 ? 0 : b >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * b);
      exc[n] = amp * (s1 - s2);
    }
    this.excPos = 0; this.excLen = len;
    this.excV = Math.cos(th); this.excH = Math.sin(th);
  }

  // ev.k: technique flags - m palm mute, h hammer-on/pull-off, s slide,
  // b bend, v vibrato, * natural harmonic (ev.hb = touch point, as the
  // fraction of the string between finger and bridge), x dead note; ev.br: stopped by a barre
  noteOn(ev, P, t) {
    const k = ev.k || '';
    const f = ev.f * this.ratio;
    const dead = k === 'x', pm = k.indexOf('m') >= 0, harm = k.indexOf('*') >= 0 && ev.hb > 0;
    const slide = k.indexOf('s') >= 0;
    const legato = (slide || k.indexOf('h') >= 0) && this.sounding && !harm;
    let b1 = this.b1 * P.b1Scale, b3 = this.b3 * P.b3Scale;
    if (ev.fr) { b1 *= 1.35; b3 *= 1.2; }
    if (ev.br) { b1 *= 1.25; b3 *= 1.9; } // the flat side of a finger presses softer than a fingertip
    if (pm) b3 *= 1.6;
    else if (dead) { b1 = b1 * 2 + 6; b3 *= 3; }
    this.setDamping(f, b1, b3);
    this.setStiffness(f);
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
      const fromF = this.curFreq, from = 12 * Math.log2(fromF / f);
      this.bendAmt = 0; this.vibDepth = 0;
      this.freq = f;
      if (slide) {
        // the finger glides along the string to the new fret
        this.gFrom = from; this.gT0 = t; this.gStep = true;
        this.gDur = clamp(0.035 * Math.abs(from), 0.07, 0.3);
        this.tapExc(f, ev.v * 0.1, P, 'soft', ev.d);
        this.squeak(this.gDur, clamp(Math.abs(from) / 7, 0.3, 1) * 0.8, P);
      } else {
        // a finger lands on or leaves a fret: the string is that length at once
        this.gFrom = 0;
        this.retune(f, true);
        this.fretTap(f, fromF, ev.v, f > fromF, ev.d);
      }
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
    this.setStiffness(this.freq);
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
    const rise = this.tension() > 6e-6 ? this.tmRise : 0;
    if (!active && !rise && !this.modPrev) { this.dVinc = 0; this.dHinc = 0; return; }
    this.modPrev = active || rise > 0;
    if (active) this.retune(this.freq * Math.pow(2, semis / 12 + 1.4427 * rise), false); // log2(1 + rise)
    else {
      // a rise of a few cents only shortens the loop: no need to tune it afresh
      if (this.baseF !== this.freq) this.retune(this.freq, false);
      this.tV = this.baseV - (this.fs / this.freq) * rise;
      this.tH = this.baseH - (this.fs / (this.freq * this.polDet)) * rise;
    }
    this.dVinc = (this.tV - this.dV) / n;
    this.dHinc = (this.tH - this.dH) / n;
  }

  // The loop is read between samples with a fifth-order Lagrange interpolator. A shorter one
  // takes more from the highs than the string itself does, by an amount that changes from
  // note to note with the fraction of a sample the loop ends on. The weights are kept until
  // the loop length has changed by HOLD samples: a gliding pitch moves in steps that small.
  tickRead() {
    const m = this.mask, apN = this.apN, c = this.apC;
    // vertical polarisation
    let d = (this.dV += this.dVinc);
    let n0 = d | 0;
    let i = this.w - n0 + 2;
    let b = this.bv, h = this.hV;
    let e = d - this.hVd;
    if (n0 !== this.hVn || e > HOLD || e < -HOLD) { lagrange(h, d - n0 + 2); this.hVd = d; this.hVn = n0; }
    let r = h[0] * b[i & m] + h[1] * b[(i - 1) & m] + h[2] * b[(i - 2) & m] + h[3] * b[(i - 3) & m] + h[4] * b[(i - 4) & m] + h[5] * b[(i - 5) & m];
    let lp = this.lpV = (1 - this.aV) * r + this.aV * this.lpV;
    r = (r + this.mV * (lp - r)) * this.gV;
    for (let k = 0; k < apN; k++) {
      const y = c * r + this.axV[k] - c * this.ayV[k];
      this.axV[k] = r; this.ayV[k] = y; r = y;
    }
    this.uV = r;
    // horizontal polarisation
    d = (this.dH += this.dHinc);
    n0 = d | 0;
    i = this.w - n0 + 2;
    b = this.bh; h = this.hH;
    e = d - this.hHd;
    if (n0 !== this.hHn || e > HOLD || e < -HOLD) { lagrange(h, d - n0 + 2); this.hHd = d; this.hHn = n0; }
    let q = h[0] * b[i & m] + h[1] * b[(i - 1) & m] + h[2] * b[(i - 2) & m] + h[3] * b[(i - 3) & m] + h[4] * b[(i - 4) & m] + h[5] * b[(i - 5) & m];
    lp = this.lpH = (1 - this.aH) * q + this.aH * this.lpH;
    q = (q + this.mH * (lp - q)) * this.gH;
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
    // the stretching string pulls on the bridge along itself, with the square of its slope
    // there: sums of partials, ringing at the longitudinal resonance. The pull rocks the bridge.
    let ph = 0;
    if (this.phG) {
      const x = yv * yv + yh * yh, N = this.phN, s = this.phS;
      let y = N[0] * (x - s[1]) - N[1] * s[2] - N[2] * s[3];
      if (y < 1e-20 && y > -1e-20) y = 0;
      s[3] = s[2]; s[2] = y; s[1] = s[0]; s[0] = x;
      ph = this.phG * y;
    }
    this.outH = yh * this.gain + ph;
    return yv * this.gain + sq;
  }

  clear() {
    this.bv.fill(0); this.bh.fill(0);
    this.axV.fill(0); this.ayV.fill(0); this.axH.fill(0); this.ayH.fill(0); this.phS.fill(0);
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
      v.flat = ((isPair ? pr.pairFlat : pr.flat) || [])[s] || 0;
      const pick = (main, pair) => (isPair ? pr[pair][s] : pr[main][s]);
      v.B = pick('B', 'pairB');
      v.dia = pick('dia', 'pairDia');
      v.apN = sectionsFor(v.openF, v.B, fs);
      v.apCache.clear();
      v.tmK = pick('tm', 'pairTm') / 1731.2 / pick('tmE', 'pairTmE');
      v.fL = pick('fL', 'pairFL');
      v.phG = Math.pow(10, pick('phantom', 'pairPhantom') / 20) * pick('phCal', 'pairPhCal');
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
          this.post({ type: 'n', vi: second, frame: frame + this.pairGap + ((this.rnd() * 90) | 0), s: ev.s, f: ev.f, v: ev.v, k: ev.k, fr: ev.fr, br: ev.br, d: ev.d, hb: ev.hb, fg: ev.fg, rs: ev.rs, pp: ev.pp, lim: ev.lim });
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
      v.noteOn({ f: ev.f * v.pitchMul, v: ev.v, k: ev.k, fr: ev.fr, br: ev.br, d: ev.d, hb: ev.hb, fg: ev.fg, rs: ev.rs, pp: ev.pp, lim: ev.lim }, this.P, t);
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
