// Song model, link (de)serialisation and playback compilation.

import { planHand } from './hand.js';

export const TUNINGS = {
  'Standard (EADGBE)': [40, 45, 50, 55, 59, 64],
  'Drop D': [38, 45, 50, 55, 59, 64],
  'DADGAD': [38, 45, 50, 55, 57, 62],
  'Open G': [38, 43, 50, 55, 59, 62],
  'Open D': [38, 45, 50, 54, 57, 62],
  'Half step down': [39, 44, 49, 54, 58, 63],
  'Whole step down': [38, 43, 48, 53, 57, 62],
};
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12];
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const MAX_FRET = 24;
export const MAX_BARS = 200;

// Technique flags of a note, kept in this order:
//   m palm mute · h hammer-on / pull-off · s slide · b bend · v vibrato
//   > accent · * natural harmonic (the fret is where the finger touches)
export const FLAGS = 'mhsbv>*';
const CONFLICTS = { h: 's', s: 'h', b: 'v', v: 'b', '*': 'mhsbv', m: '*' };
export const normFlags = (t) => [...FLAGS].filter((c) => (t || '').includes(c)).join('');
export const hasFlag = (cell, f) => !!cell && typeof cell.f === 'number' && (cell.t || '').includes(f);
// add or remove one flag, dropping whatever cannot be combined with it
export function toggleFlag(t, flag) {
  t = t || '';
  if (t.includes(flag)) return normFlags(t.replace(flag, ''));
  let out = t + flag;
  for (const c of CONFLICTS[flag] || '') out = out.replace(c, '');
  if (flag !== '*' && flag !== '>' && flag !== 'm') out = out.replace('*', '');
  return normFlags(out);
}

export const INSTRUMENTS = {
  steel: { preset: 'steel', pickPos: 0.17, pickHard: 0.72, bright: 0, sustain: 0, body: 0.85, strum: 14, human: 0.5, fingerNoise: 0.3, picking: 0, coupling: 0.4, humanOn: 1 },
  nylon: { preset: 'nylon', pickPos: 0.2, pickHard: 0.5, bright: 0, sustain: 0, body: 0.9, strum: 18, human: 0.5, fingerNoise: 0.25, picking: 2, coupling: 0.3, humanOn: 1 },
  twelve: { preset: 'twelve', pickPos: 0.16, pickHard: 0.75, bright: 0, sustain: 0, body: 0.85, strum: 16, human: 0.5, fingerNoise: 0.3, picking: 0, coupling: 0.3, humanOn: 1 },
};
// Order of the settings in a link. A retired setting keeps its place (null), so old links still load.
const INST_KEYS = ['pickPos', 'pickHard', 'bright', 'sustain', 'body', null, 'strum', 'human', null, 'fingerNoise', 'picking', null, 'coupling', 'humanOn'];
// How much of the performer's feel is played: `human` is the amount, `humanOn` (1 or 0) the
// switch next to the tempo. Switched off, the song is played exactly as written.
export const humanOf = (inst) => (inst.humanOn === 0 ? 0 : inst.human);
// picking techniques, by inst.picking
export const PICKING = ['pick', 'flesh', 'nailS', 'nailL', 'hybrid'];
// number of wound strings, counted from the lowest
const WOUND = { steel: 4, nylon: 3, twelve: 4 };

export const FX_DEFAULTS = {
  revOn: true, revMix: 0.26, revSize: 2.2, revTone: 0.5,
  dlyOn: false, dlyTime: '8d', dlyFb: 0.35, dlyMix: 0.22, vol: 0.8,
};
const FX_KEYS = ['revOn', 'revMix', 'revSize', 'revTone', 'dlyOn', 'dlyTime', 'dlyFb', 'dlyMix', 'vol'];
// Reverb spaces: mix, decay (RT60 in seconds) and tone. "Stage" is the default.
export const REVERBS = {
  none: { name: 'None', revOn: false },
  room: { name: 'Room', revOn: true, revMix: 0.16, revSize: 0.6, revTone: 0.45 },
  studio: { name: 'Studio', revOn: true, revMix: 0.2, revSize: 1.2, revTone: 0.6 },
  stage: { name: 'Stage', revOn: true, revMix: 0.26, revSize: 2.2, revTone: 0.5 },
  hall: { name: 'Concert hall', revOn: true, revMix: 0.32, revSize: 3.2, revTone: 0.48 },
  church: { name: 'Church', revOn: true, revMix: 0.38, revSize: 4.8, revTone: 0.4 },
  cathedral: { name: 'Cathedral', revOn: true, revMix: 0.44, revSize: 7.5, revTone: 0.34 },
};
// the reverb space these settings are, or '' when they have been changed by hand
export function reverbSpace(fx) {
  if (!fx.revOn) return 'none';
  const near = (a, b) => Math.abs(a - b) < 1e-3;
  return Object.keys(REVERBS).find((k) => {
    const r = REVERBS[k];
    return r.revOn && near(r.revMix, fx.revMix) && near(r.revSize, fx.revSize) && near(r.revTone, fx.revTone);
  }) || '';
}
// set the reverb to a space; "none" only turns it off, so the last settings come back
export function setReverbSpace(fx, key) {
  const r = REVERBS[key];
  if (!r) return;
  fx.revOn = r.revOn;
  if (r.revOn) Object.assign(fx, { revMix: r.revMix, revSize: r.revSize, revTone: r.revTone });
}

export const DELAY_TIMES = { '4': 1, '4d': 1.5, '8': 0.5, '8d': 0.75, '8t': 1 / 3, '16': 0.25 };

export function emptyCols(n) {
  const cols = new Array(n);
  for (let i = 0; i < n; i++) cols[i] = null;
  return cols;
}

export function newSong() {
  return {
    title: 'Untitled', bpm: 90, spb: 4, bpb: 4, bars: 8,
    tuning: [40, 45, 50, 55, 59, 64], capo: 0,
    cols: emptyCols(8 * 16),
    inst: { ...INSTRUMENTS.steel },
    fx: { ...FX_DEFAULTS },
  };
}

export const stepsPerBar = (song) => song.spb * song.bpb;
export const totalSteps = (song) => song.bars * song.spb * song.bpb;

export function getCell(song, step, s) {
  const c = song.cols[step];
  return c ? c[s] : null;
}
export function setCell(song, step, s, cell) {
  if (step < 0 || step >= song.cols.length) return;
  let c = song.cols[step];
  if (!c) { if (!cell) return; c = song.cols[step] = [null, null, null, null, null, null]; }
  c[s] = cell;
  if (!cell && !c.some(Boolean)) song.cols[step] = null;
}

// Change grid resolution / bar length, keeping notes where they still fit.
export function reshape(song, spb, bpb) {
  const oldSpb = song.spb, oldBar = song.spb * song.bpb, newBar = spb * bpb;
  const cols = emptyCols(song.bars * newBar);
  song.cols.forEach((c, step) => {
    if (!c) return;
    const bar = Math.floor(step / oldBar), pos = step % oldBar;
    const np = (pos * spb) / oldSpb;
    if (!Number.isInteger(np) || np >= newBar) return;
    const idx = bar * newBar + np;
    if (!cols[idx]) cols[idx] = c;
  });
  song.spb = spb; song.bpb = bpb; song.cols = cols;
}

// ---- link encoding -----------------------------------------------------------

function notesToString(song) {
  const out = [];
  let last = -1;
  for (let i = 0; i < song.cols.length; i++) {
    const c = song.cols[i];
    let tok = '';
    if (c) for (let s = 0; s < 6; s++) if (c[s]) tok += 'ABCDEF'[s] + c[s].f + (c[s].t || '');
    out.push(tok);
    if (tok) last = i;
  }
  return out.slice(0, last + 1).join(',');
}

function notesFromString(str, n) {
  const cols = emptyCols(n);
  if (!str) return cols;
  const re = /([A-F])(x|\.|\d{1,2})([hsbvm>*]*)/g;
  str.split(',').forEach((tok, i) => {
    if (!tok || i >= n) return;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(tok))) {
      const s = 'ABCDEF'.indexOf(m[1]);
      const f = m[2] === 'x' || m[2] === '.' ? m[2] : Math.min(MAX_FRET, parseInt(m[2], 10));
      if (!cols[i]) cols[i] = [null, null, null, null, null, null];
      cols[i][s] = { f, t: typeof f === 'number' ? normFlags(m[3]) : '' };
    }
  });
  return cols;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const num = (x, lo, hi, d) => (typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);

export function packSong(song) {
  return {
    v: 1, t: song.title, b: song.bpm, g: [song.spb, song.bpb, song.bars],
    u: song.tuning, c: song.capo, n: notesToString(song),
    i: [song.inst.preset, ...INST_KEYS.map((k) => (k ? r3(song.inst[k]) : 0))],
    x: FX_KEYS.map((k) => (typeof song.fx[k] === 'number' ? r3(song.fx[k]) : typeof song.fx[k] === 'boolean' ? +song.fx[k] : song.fx[k])),
  };
}

export function unpackSong(p) {
  const song = newSong();
  if (!p || typeof p !== 'object') throw new Error('bad song data');
  song.title = String(p.t ?? 'Untitled').slice(0, 80);
  song.bpm = num(p.b, 30, 300, 90);
  const g = Array.isArray(p.g) ? p.g : [];
  song.spb = [1, 2, 3, 4, 6].includes(g[0]) ? g[0] : 4;
  song.bpb = Math.round(num(g[1], 1, 12, 4));
  song.bars = Math.round(num(g[2], 1, MAX_BARS, 8));
  if (Array.isArray(p.u) && p.u.length === 6) song.tuning = p.u.map((m, i) => Math.round(num(m, 24, 76, song.tuning[i])));
  song.capo = Math.round(num(p.c, 0, 12, 0));
  song.cols = notesFromString(typeof p.n === 'string' ? p.n : '', totalSteps(song));
  if (Array.isArray(p.i)) {
    const base = INSTRUMENTS[p.i[0]] || INSTRUMENTS.steel;
    song.inst = { ...base };
    INST_KEYS.forEach((k, j) => { if (k) song.inst[k] = num(p.i[j + 1], -1, 60, base[k]); });
  }
  if (Array.isArray(p.x)) {
    FX_KEYS.forEach((k, j) => {
      const d = FX_DEFAULTS[k], v = p.x[j];
      if (typeof d === 'boolean') song.fx[k] = v == null ? d : !!v;
      else if (typeof d === 'number') song.fx[k] = num(v, 0, 12, d);
      else song.fx[k] = DELAY_TIMES[v] ? v : d;
    });
  }
  return song;
}

const b64u = {
  enc(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

// "z…" = deflate-raw + base64url, "j…" = plain JSON + base64url
export async function encodeSong(song) {
  const bytes = new TextEncoder().encode(JSON.stringify(packSong(song)));
  if (typeof CompressionStream === 'function') {
    try { return 'z' + b64u.enc(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch (e) { /* fall through */ }
  }
  return 'j' + b64u.enc(bytes);
}

export async function decodeSong(str) {
  const kind = str[0];
  let bytes = b64u.dec(str.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('unknown link format');
  return unpackSong(JSON.parse(new TextDecoder().decode(bytes)));
}

// ---- playback compilation ----------------------------------------------------

const chordAt = (song, step) => {
  const c = song.cols[step];
  if (!c) return false;
  let n = 0;
  for (let s = 0; s < 6; s++) if (c[s] && c[s].f !== '.') n++;
  return n >= 3;
};

// One note event for the string engine.
export function cellEvent(song, s, cell, t, vel, d) {
  const open = song.tuning[s] + song.capo;
  if (cell.f === 'x') return { type: 'n', t, s, f: midiHz(open + 5), v: vel, k: 'x', fr: true, d };
  const k = (cell.t || '').replace('>', '');
  // natural harmonic: the open string, with a fingertip resting on it above the fret
  if (k.includes('*') && cell.f > 0) return { type: 'n', t, s, f: midiHz(open), v: vel, k: '*', fr: false, d, hb: Math.pow(2, -cell.f / 12) };
  return { type: 'n', t, s, f: midiHz(open + cell.f), v: vel, k: k.replace('*', ''), fr: cell.f > 0, d };
}

// ---- the fretting hand ---------------------------------------------------------
// What the fretting hand does around a column, from its plan (hand.js): fingers leave
// strings (their notes stop); the hand moves to a new position, or re-grips after a pause or
// at a section start, sometimes with a squeak on a wound string; a single-note line mutes
// the string played before, with the palm or a spare finger, not always exactly in time.

// the hand's plan for the song, made once per performance
function handPlan(song, perf) {
  if (!perf.hand) perf.hand = planHand(song.cols, { stepSecs: 60 / song.bpm / song.spb, spb: song.spb, bar: stepsPerBar(song), open: song.tuning.map((m) => m + song.capo) });
  return perf.hand;
}

// the fretting hand's plan for the whole song, for showing it
export const planSong = (song) => handPlan(song, { hand: null });

// events for plan entry e; tNote: when the column's first note sounds; h: humanize
function handEvents(song, e, tNote, rnd, h) {
  const out = [];
  const wound = WOUND[song.inst.preset] || 0, amount = song.inst.fingerNoise || 0;
  const likely = Math.min(1, 0.4 + amount);
  const room = 0.4 * e.gap; // a finger does not leave before the note it held has been heard
  // a finger travels along string s for dur seconds; nl: it did not hold the note on it
  const travel = (s, dur, amt, nl) => {
    dur = Math.min(dur, room);
    const t = Math.max(0, tNote - dur - 0.012);
    const ev = { type: 'q', t, s, dur: Math.min(dur, Math.max(0.01, tNote - t)), amt };
    if (nl) ev.nl = true;
    out.push(ev);
  };
  if (e.move) {
    const m = e.move, d = m.travel;
    // the finger in contact: one that stays on its string, else one that leaves, else one that arrives
    const woundIn = (list) => list.find((s) => s < wound);
    let s = woundIn(m.kept) ?? woundIn(m.held) ?? woundIn(m.next);
    const plain = s == null;
    if (plain) s = m.kept[0] ?? m.held[0] ?? m.next[0];
    // fast passages move lightly; long gaps and section starts give the hand time to drag
    let chance = d <= 2 ? 0.12 : Math.min(0.85, 0.3 + 0.08 * d);
    if (e.gap < 0.2) chance *= 0.3; else if (e.gap >= 0.5) chance *= 1.4;
    if (e.phrase) chance *= 1.4;
    chance = Math.min(0.9, chance) * likely * (plain ? 0.35 : 1);
    const dur = Math.min(Math.max(0.07, 0.045 + 0.022 * d), 0.22);
    const amt = amount > 0 && rnd() < chance ? Math.min(1, (0.35 + 0.1 * d) * (m.barre ? 1.3 : 1)) * (0.6 + 0.4 * rnd()) : 0;
    for (const x of e.lifts) travel(x, dur, x === s ? amt : 0, false);
    if (amt > 0 && !e.lifts.includes(s)) travel(s, dur, amt, true);
  } else {
    for (const x of e.lifts) travel(x, 0.03, 0, false);
    const s = e.regrip && e.regrip.find((x) => x < wound);
    if (s != null && amount > 0 && rnd() < (e.phrase ? 0.4 : 0.3) * likely) travel(s, 0.04 + 0.03 * rnd(), 0.3 + 0.2 * rnd(), true);
  }
  for (const x of e.mutes) if (rnd() >= 0.08 * h) out.push({ type: 'o', t: Math.max(0, tNote + (0.004 + 0.025 * rnd()) * (0.5 + h)), s: x });
  return out;
}

// ---- the performer -----------------------------------------------------------
// What a player carries from note to note: which finger or pick direction came
// last, and a slow drift in timing, loudness and plucking point. Unlike
// independent jitter, drift keeps neighbouring notes together.
// On top of the drift the performer shapes the music (all of it scaled by Humanize):
//   * a phrase of four bars breathes: it moves on a little towards its middle and eases
//     off towards its end, and is loudest past its middle
//   * the song slows down and softens into its last note, unless it is looped
//   * of notes plucked together the top one, the melody, is brought out
//   * a note that needs a long, quick shift of the fretting hand comes a little late
//   * no string is exactly in tune, and a fretting finger pulls its note a little sharp

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clampTo = (x, lim) => Math.max(-lim, Math.min(lim, x));

export function newPerformer(seed) {
  const rnd = seed == null ? Math.random : mulberry32(seed);
  return {
    rnd,
    drift: { t: 0, v: 0, p: 0 },                       // seconds, relative loudness, millimetres
    // the last finger on a treble string and that string; when and in which column each finger last played
    last: { finger: 0, string: -1, fingerT: [-9, -9, -9, -9, -9], fingerStep: [-1, -1, -1, -1, -1], pickT: -9, pickD: 1 },
    tune: [0, 0, 0, 0, 0, 0].map(() => 2 * rnd() - 1), // how far each string is from its pitch, -1 .. 1
    hand: null,                                        // the fretting hand's plan (hand.js), made on first use
    end: null,                                         // the last column with notes, found on first use
    loop: false,                                       // the song is played round and round: no slowing at its end
  };
}

const FINGER_STRENGTH = [1.0, 1.0, 0.97, 0.93, 1.0]; // thumb, index, middle, ring, pick
// a hammer-on or pull-off is as strong as the fretting finger that plays it: none, index .. little finger
const FRET_STRENGTH = [1, 1, 1, 0.94, 0.85];
const PULL_T = 0.05, PULL = 0.08;                     // how strongly the drift returns: timing; loudness and plucking point
const TIMING = 0.011, LOUDNESS = 0.1;                 // spread (standard deviation) of the drift at Humanize 100 %
const JITTER_T = 0.008, JITTER_V = 0.2;               // note-to-note scatter (full width) in seconds and relative loudness
const PHRASE_BARS = 4;
const BREATH = 0.004;                                 // a phrase runs ahead of the beat by up to this share of its length
const ARC = 0.12;                                     // and swells by this much
const RITARD = 0.07, SOFTEN = 0.15;                   // the last bar is late by up to this share of a bar, and softer
const DETUNE = 1.5;                                   // cents a string may be off
const TOP_VOICE = 0.08, INNER_VOICE = 0.05;

function driftStep(perf, rnd) {
  const g = () => (rnd() + rnd() + rnd() - 1.5) * 2; // roughly standard normal
  const d = perf.drift, spread = (sd, pull) => sd * Math.sqrt(1 - (1 - pull) ** 2);
  d.t = clampTo(d.t * (1 - PULL_T) + spread(TIMING, PULL_T) * g(), 0.025);
  d.v = clampTo(d.v * (1 - PULL) + spread(LOUDNESS, PULL) * g(), 0.22);
  d.p = clampTo(d.p * (1 - PULL) + 0.6 * g(), 4);
}

// the last column with anything in it, found once per performance
function songEnd(song, perf) {
  if (perf.end == null) {
    perf.end = -1;
    for (let i = song.cols.length - 1; i >= 0; i--) if (song.cols[i]) { perf.end = i; break; }
  }
  return perf.end;
}

// The finger of the plucking hand for a single treble note (1 index, 2 middle, 3 ring). Each
// string has its own, as in an arpeggio: index on G, middle on B, ring on the top string. No
// finger plays twice in a row in a quick line: along one string index and middle alternate.
function trebleFinger(s, t, last) {
  const home = s - 2;
  if (!last.finger || t - last.fingerT[last.finger] > 0.4) return home;
  if (last.string === s) return last.finger === 1 ? 2 : 1;
  if (home !== last.finger) return home;
  return s > last.string ? (home < 3 ? home + 1 : 2) : (home > 1 ? home - 1 : 2);
}

// the fret of the note before `step` on string s and the column it is in, or null
function noteBefore(song, step, s) {
  for (let i = step - 1; i >= 0; i--) {
    const c = getCell(song, i, s);
    if (c) return typeof c.f === 'number' && !(c.t || '').includes('*') ? { f: c.f, step: i } : null;
  }
  return null;
}

// what plucks the string (the engine's plucker): the finger, and the picking technique
const pluckerOf = (finger, technique) => (finger === 4 ? 0 : finger === 0 && technique !== 4 ? 4 : technique === 4 ? 2 : technique);
// does this string get a finger (true) or the pick?
const fingered = (technique, s) => (technique >= 1 && technique <= 3) || (technique === 4 && s >= 3);

// One note on its own, as the editor plays it when it is entered.
export function previewEvent(song, s, cell, t) {
  const ev = cellEvent(song, s, cell, t, 0.8, 1);
  const technique = song.inst.picking || 0;
  ev.fi = !fingered(technique, s) ? 4 : s < 3 ? 0 : s - 2;
  ev.fg = pluckerOf(ev.fi, technique);
  return ev;
}

// seconds since the previous note on string s, if it is close enough to matter to the stroke
function gapBefore(song, step, s, stepDur) {
  for (let i = 1; i <= step && i * stepDur < 0.05; i++) {
    const c = getCell(song, step - i, s);
    if (c && c.f !== '.') return i * stepDur;
  }
  return 0;
}

// A slide starts from the note sounding on its string. When that note was plucked more than
// RESTART seconds ago it has faded, so the player plucks it again and slides from there.
// Returns that note's fret, or null (a recent note, or nothing to slide from).
const RESTART = 0.5;
function slideRestart(song, step, s, stepDur) {
  for (let i = 1; i <= step; i++) {
    const c = getCell(song, step - i, s);
    if (!c) continue;
    if (typeof c.f !== 'number' || (c.t || '').includes('*')) return null;
    return i * stepDur > RESTART ? c.f : null;
  }
  return null;
}
const GRACE = 0.04; // from the new pluck to the start of the slide

// Events (for the string engine) produced by one grid step starting at time t.
// A note's time is the moment the string is let go.
export function stepEvents(song, step, t, rnd, perf) {
  const col = song.cols[step];
  if (!col) return [];
  const strings = [];
  for (let s = 0; s < 6; s++) if (col[s]) strings.push(s);
  if (!strings.length) return [];
  if (!perf) perf = newPerformer();
  const hand = handPlan(song, perf), plan = hand[step];
  const { spb, inst } = song;
  const bar = spb * song.bpb;
  const stepDur = 60 / song.bpm / spb;
  const pos = step % bar, inBeat = pos % spb;
  const chord = chordAt(song, step);
  const technique = inst.picking || 0;
  const last = perf.last;
  // strum direction: down on the beat, up on the off-beats
  let down = true;
  if (chord && inBeat !== 0) {
    down = false;
    if (spb === 4 && inBeat === 2) {
      const beat0 = step - inBeat;
      down = chordAt(song, beat0 + 1) || chordAt(song, beat0 + 3);
    }
  }
  const base = pos === 0 ? 0.92 : inBeat === 0 ? 0.82 : 0.72;
  const h = humanOf(inst);
  driftStep(perf, rnd);
  let spread = strings.length > 1 ? (inst.strum / 1000) * (1 + 0.4 * h * (rnd() - 0.5)) : 0;
  if (spread * (strings.length - 1) > 0.7 * stepDur) spread = (0.7 * stepDur) / (strings.length - 1);
  if (!down) { strings.reverse(); spread *= 0.8; }
  const sounding = strings.filter((s) => col[s].f !== '.');
  const top = Math.max(...sounding);
  // where the column is in its phrase (0 .. 1) and in the last bar before the end (0 .. 1)
  const phrase = PHRASE_BARS * bar, u = (step % phrase) / phrase;
  const end = songEnd(song, perf), last1 = perf.loop || end < 2 * bar ? 0 : Math.min(1, Math.max(0, (step - end + bar) / bar));
  let lag = perf.drift.t - BREATH * phrase * stepDur * Math.sin(Math.PI * u) + RITARD * bar * stepDur * last1 * last1;
  // the fretting hand needs its time for a long shift
  const shift = plan && plan.move && plan.gap < 0.35 ? plan.move.dist : 0;
  if (shift >= 3) lag += Math.min(0.012, 0.0015 * shift) * (0.5 + rnd());
  const swell = perf.drift.v + ARC * (Math.sin(Math.PI * u) - 2 / Math.PI) - SOFTEN * last1 - (shift >= 3 ? 0.04 : 0);
  // a pick playing single notes in a run alternates; on the beat it comes down
  if (technique === 0 && sounding.length === 1 && !chord) {
    down = inBeat === 0 || t - last.pickT > 0.35 ? true : last.pickD < 0;
    last.pickT = t; last.pickD = down ? 1 : -1;
  }
  const jitter = h * lag;
  const out = [];
  strings.forEach((s, k) => {
    const cell = col[s];
    const tt = Math.max(0, t + jitter + h * (rnd() - 0.5) * JITTER_T + k * spread * (1 + (rnd() - 0.5) * 0.5 * h));
    if (cell.f === '.') { out.push({ type: 'o', t: tt, s }); return; }
    let vel = base * (1 + h * (swell + (rnd() - 0.5) * JITTER_V));
    if (chord) vel *= (down ? 0.9 : 0.8) * (1 - 0.025 * k);
    else if (!down) vel *= 0.93;
    if (sounding.length > 1) vel *= s === top ? 1 + TOP_VOICE * h : chord ? 1 : 1 - INNER_VOICE * h;
    const accent = (cell.t || '').includes('>');
    if (accent) vel = Math.min(1.15, vel * 1.3 + 0.08);
    const ev = cellEvent(song, s, cell, tt, vel, down ? 1 : -1);
    if (plan && plan.barre.includes(s)) ev.br = true; // stopped by the flat index finger
    // who plays it: 0 thumb, 1 index, 2 middle, 3 ring, 4 the pick
    let finger = 4;
    if (fingered(technique, s)) {
      if (s < 3) finger = 0;
      else if (sounding.filter((x) => x >= 3).length > 1) finger = s - 2;       // one finger per string
      else finger = trebleFinger(s, tt, last);
      if (finger) { last.finger = finger; last.string = s; }
    }
    ev.fi = finger;
    ev.fg = pluckerOf(finger, technique);
    // a finger that has just played is weaker; the thumb brushing over several strings is one stroke
    const again = finger !== 4 && last.fingerStep[finger] !== step && tt - last.fingerT[finger] < 0.12;
    ev.v *= FINGER_STRENGTH[finger] * (again ? 0.9 : 1);
    last.fingerT[finger] = tt; last.fingerStep[finger] = step;
    // the fretting finger: it also plays the hammer-on (its own note) or the pull-off (the note it leaves)
    const ff = plan ? plan.fingers[s] : 0;
    if (ff) ev.ff = ff;
    if (ev.k.includes('h')) {
      const before = noteBefore(song, step, s);
      const pull = before && before.f > cell.f && hand[before.step];
      ev.v *= FRET_STRENGTH[pull ? pull.fingers[s] : ff];
    }
    if (accent) ev.rs = true;
    if (h > 0) ev.pp = Math.round(h * perf.drift.p * 100) / 100;
    // no string is exactly in tune; a finger pressing a string down stretches it a little
    let cents = 0;
    if (h > 0 && ev.k !== 'x') cents = h * (DETUNE * perf.tune[s] + (ev.fr ? 0.6 + 1.2 * rnd() + (accent ? 0.8 : 0) : 0));
    const sharp = Math.pow(2, cents / 1200);
    ev.f *= sharp;
    const gap = gapBefore(song, step, s, stepDur);
    if (gap) ev.gap = gap;
    const from = ev.k.includes('s') ? slideRestart(song, step, s, stepDur) : null;
    if (from != null && from !== cell.f) {
      // pluck the old note, then slide so that the new one arrives on time (as long as the engine's glide)
      const glide = Math.min(0.3, Math.max(0.07, 0.035 * Math.abs(cell.f - from)));
      const pre = { ...ev, t: Math.max(0, ev.t - glide - GRACE), f: midiHz(song.tuning[s] + song.capo + from) * sharp, k: ev.k.replace(/[sbv]/g, ''), fr: from > 0 };
      delete pre.gap;
      ev.t = pre.t + GRACE;
      out.push(pre);
    }
    out.push(ev);
  });
  const first = out.reduce((m, e) => (e.type === 'n' && e.t < m ? e.t : m), Infinity);
  if (first < Infinity) for (const ev of handEvents(song, plan, first, rnd, h)) out.push(ev);
  return out;
}

// Steps [first, last] of each palm-muted passage, for the P.M. brackets.
// Empty columns and string stops inside a passage do not interrupt it.
export function palmMuteRuns(song) {
  const runs = [];
  let start = -1, last = -1;
  song.cols.forEach((c, i) => {
    if (!c) return;
    let notes = 0, pm = 0;
    for (const cell of c) if (cell && cell.f !== '.') { notes++; if (hasFlag(cell, 'm')) pm++; }
    if (!notes) return;
    if (pm) { if (start < 0) start = i; last = i; }
    else if (start >= 0) { runs.push([start, last]); start = -1; }
  });
  if (start >= 0) runs.push([start, last]);
  return runs;
}

export function songEvents(song, from, to, t0, rnd, perf = newPerformer()) {
  const stepDur = 60 / song.bpm / song.spb;
  const out = [];
  for (let i = from; i < to; i++) for (const ev of stepEvents(song, i, t0 + (i - from) * stepDur, rnd, perf)) out.push(ev);
  out.sort((a, b) => a.t - b.t);
  return out;
}
