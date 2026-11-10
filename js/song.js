// Song model, link (de)serialisation, playback compilation and demo songs.

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
export const TECHS = ['h', 's', 'b', 'v', 'm', '>', '*'];

export const INSTRUMENTS = {
  steel: { preset: 'steel', pickPos: 0.17, pickHard: 0.72, bright: 0, sustain: 0, body: 0.85, symp: 0.3, strum: 14, human: 0.35, vibrato: 1 },
  nylon: { preset: 'nylon', pickPos: 0.2, pickHard: 0.5, bright: 0, sustain: 0, body: 0.9, symp: 0.3, strum: 18, human: 0.35, vibrato: 1 },
  twelve: { preset: 'twelve', pickPos: 0.16, pickHard: 0.75, bright: 0, sustain: 0, body: 0.85, symp: 0.3, strum: 16, human: 0.35, vibrato: 1 },
  bowed: { preset: 'bowed', pickPos: 0.15, pickHard: 0.5, bright: 0, sustain: 0, body: 0.9, symp: 0.3, strum: 0, human: 0.2, vibrato: 1 },
};
const INST_KEYS = ['pickPos', 'pickHard', 'bright', 'sustain', 'body', 'symp', 'strum', 'human', 'vibrato'];

export const FX_DEFAULTS = {
  revOn: true, revMix: 0.26, revSize: 2.2, revTone: 0.5,
  dlyOn: false, dlyTime: '8d', dlyFb: 0.35, dlyMix: 0.22, vol: 0.8,
};
const FX_KEYS = ['revOn', 'revMix', 'revSize', 'revTone', 'dlyOn', 'dlyTime', 'dlyFb', 'dlyMix', 'vol'];
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
  const re = /([A-F])(x|\.|\d{1,2})([hsbvm>*]?)/g;
  str.split(',').forEach((tok, i) => {
    if (!tok || i >= n) return;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(tok))) {
      const s = 'ABCDEF'.indexOf(m[1]);
      const f = m[2] === 'x' || m[2] === '.' ? m[2] : Math.min(MAX_FRET, parseInt(m[2], 10));
      if (!cols[i]) cols[i] = [null, null, null, null, null, null];
      cols[i][s] = { f, t: typeof f === 'number' ? m[3] : '' };
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
    i: [song.inst.preset, ...INST_KEYS.map((k) => r3(song.inst[k]))],
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
    INST_KEYS.forEach((k, j) => { song.inst[k] = num(p.i[j + 1], -1, 60, base[k]); });
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

// natural harmonics: fret -> frequency ratio of the open string
const HARMONICS = { 12: 2, 7: 3, 19: 3, 5: 4, 24: 4, 4: 5, 9: 5, 16: 5, 3: 6 };

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
  const tech = cell.t || '';
  if (cell.f === 'x') return { type: 'n', t, s, f: midiHz(open + 5), v: vel, k: 'x', fr: true, d };
  if (tech === '*' && HARMONICS[cell.f]) return { type: 'n', t, s, f: midiHz(open) * HARMONICS[cell.f], v: vel * 0.85, k: '*', fr: false, d };
  return { type: 'n', t, s, f: midiHz(open + cell.f), v: vel, k: tech === '*' || tech === '>' ? '' : tech, fr: cell.f > 0, d };
}

// Events (for the string engine) produced by one grid step starting at time t.
export function stepEvents(song, step, t, rnd) {
  const col = song.cols[step];
  if (!col) return [];
  const strings = [];
  for (let s = 0; s < 6; s++) if (col[s]) strings.push(s);
  if (!strings.length) return [];
  const { spb, inst } = song;
  const bar = spb * song.bpb;
  const stepDur = 60 / song.bpm / spb;
  const pos = step % bar, inBeat = pos % spb;
  const chord = chordAt(song, step);
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
  const h = inst.human;
  let spread = strings.length > 1 ? inst.strum / 1000 : 0;
  if (spread * (strings.length - 1) > 0.7 * stepDur) spread = (0.7 * stepDur) / (strings.length - 1);
  if (!down) { strings.reverse(); spread *= 0.8; }
  const jitter = (rnd() - 0.5) * 0.008 * h;
  const out = [];
  strings.forEach((s, k) => {
    const cell = col[s];
    const tt = Math.max(0, t + jitter + k * spread * (1 + (rnd() - 0.5) * 0.5 * h) + (rnd() - 0.5) * 0.006 * h);
    if (cell.f === '.') { out.push({ type: 'o', t: tt, s }); return; }
    let vel = base * (1 + (rnd() - 0.5) * 0.3 * h);
    if (chord) vel *= (down ? 0.9 : 0.8) * (1 - 0.025 * k);
    let tech = cell.t || '';
    if (tech === '>') { vel = Math.min(1.15, vel * 1.3 + 0.08); tech = ''; }
    out.push(cellEvent(song, s, { f: cell.f, t: tech }, tt, vel, down ? 1 : -1));
  });
  return out;
}

export function songEvents(song, from, to, t0, rnd) {
  const stepDur = 60 / song.bpm / song.spb;
  const out = [];
  for (let i = from; i < to; i++) for (const ev of stepEvents(song, i, t0 + (i - from) * stepDur, rnd)) out.push(ev);
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ---- demo songs --------------------------------------------------------------

function make(title, bpm, spb, bpb, bars, inst, fx) {
  const s = newSong();
  Object.assign(s, { title, bpm, spb, bpb, bars, cols: emptyCols(bars * spb * bpb) });
  s.inst = { ...INSTRUMENTS[inst.preset || 'steel'], ...inst };
  s.fx = { ...FX_DEFAULTS, ...fx };
  return s;
}
const put = (song, step, s, f, t = '') => setCell(song, step, s, { f, t });

function firstLight() {
  const song = make('First Light', 74, 4, 4, 9, { preset: 'steel' }, { revMix: 0.3, revSize: 2.6, dlyOn: true, dlyMix: 0.12, dlyFb: 0.3, dlyTime: '8d' });
  const C = { sh: [-1, 3, 2, 0, 3, 3], b: 1, a: 2 };
  const G = { sh: [3, 2, 0, 0, 3, 3], b: 0, a: 2 };
  const Em = { sh: [0, 2, 2, 0, 3, 3], b: 0, a: 2 };
  const Ds = { sh: [-1, 0, 0, 2, 3, 3], b: 2, a: 1 };
  const D = { sh: [-1, 0, 0, 2, 3, 2], b: 2, a: 1 };
  const As = { sh: [-1, 0, 2, 0, 3, 3], b: 1, a: 2 };
  const h1 = [[0, 'b', 4], [2, 3], [3, 5], [4, 'a'], [6, 4], [7, 3]];
  const h2 = [[0, 'b'], [2, 5], [3, 4], [4, 'a'], [6, 3], [7, 4]];
  const half = (bar, hi, ch, pat) => {
    for (const [st, ...rs] of pat) for (const r of rs) {
      const s = r === 'b' ? ch.b : r === 'a' ? ch.a : r;
      put(song, bar * 16 + hi * 8 + st, s, ch.sh[s]);
    }
  };
  const seq = [[C, C], [G, G], [Em, Em], [Ds, D], [C, C], [G, G], [As, Ds], [C, D]];
  seq.forEach(([a, b], bar) => { half(bar, 0, a, h1); half(bar, 1, b, h2); });
  // a few ornaments
  put(song, 0, 1, 3, '>');
  put(song, 16 + 4, 2, 0); put(song, 16 + 5, 2, 2, 'h');
  put(song, 32 + 12, 2, 0); put(song, 32 + 13, 2, 2, 'h');
  put(song, 48 + 10, 5, 3); put(song, 48 + 11, 5, 2, 'h');
  put(song, 80 + 4, 2, 0); put(song, 80 + 5, 2, 2, 'h');
  put(song, 96 + 3, 5, 3, 'v');
  put(song, 112 + 15, 5, 2, 'v');
  // ending: slow G strum and 12th-fret harmonics
  [3, 2, 0, 0, 3, 3].forEach((f, s) => put(song, 128, s, f, s === 0 ? '>' : ''));
  put(song, 128 + 6, 3, 12, '*'); put(song, 128 + 8, 4, 12, '*'); put(song, 128 + 10, 5, 12, '*');
  return song;
}

function campfire() {
  const song = make('Campfire', 96, 4, 4, 8, { preset: 'twelve', strum: 17 }, { revMix: 0.22, revSize: 1.8 });
  const chords = [[0, 2, 2, 0, 0, 0], [-1, 3, 2, 0, 1, 0], [3, 2, 0, 0, 0, 3], [-1, -1, 0, 2, 3, 2]];
  for (let bar = 0; bar < 8; bar++) {
    const sh = chords[bar % 4], o = bar * 16;
    const strum = (st, from, t) => { for (let s = from; s < 6; s++) if (sh[s] >= 0) put(song, o + st, s, sh[s], t && s === sh.findIndex((f) => f >= 0) ? t : ''); };
    if (bar === 7) { strum(0, 0, '>'); continue; }
    strum(0, 0, '>'); strum(4, 0); strum(6, 2); strum(10, 2); strum(12, 0); strum(14, 3);
    for (let s = 1; s < 4; s++) put(song, o + 8, s, 'x');
  }
  return song;
}

function romance() {
  const song = make('Romance (trad.)', 84, 3, 3, 16, { preset: 'nylon', human: 0.3 }, { revMix: 0.34, revSize: 3.2, revTone: 0.42 });
  // [melody frets on the high e], B-string fret, G-string fret, [bass string, fret]
  const bars = [
    [[7, 7, 7], 0, 0, [0, 0]], [[7, 5, 3], 0, 0, [0, 0]], [[3, 2, 0], 0, 0, [0, 0]], [[0, 3, 7], 0, 0, [0, 0]],
    [[12, 12, 12], 0, 0, [0, 0]], [[12, 10, 8], 0, 0, [0, 0]], [[8, 7, 5], 5, 5, [1, 0]], [[5, 7, 8], 5, 5, [1, 0]],
    [[7, 8, 7], 7, 8, [0, 7]], [[11, 8, 7], 7, 8, [0, 7]], [[7, 5, 3], 0, 0, [0, 0]], [[3, 2, 0], 0, 0, [0, 0]],
    [[2, 2, 2], 0, 2, [1, 2]], [[2, 3, 2], 0, 2, [1, 2]], [[0, 0, 0], 0, 0, [0, 0]],
  ];
  bars.forEach(([mel, b, g, bass], bar) => {
    const o = bar * 9;
    put(song, o, bass[0], bass[1]);
    mel.forEach((f, beat) => {
      put(song, o + beat * 3, 5, f, beat === 0 && bar % 4 === 0 ? '>' : '');
      put(song, o + beat * 3 + 1, 4, b);
      put(song, o + beat * 3 + 2, 3, g);
    });
  });
  const o = 15 * 9;
  put(song, o, 0, 0); put(song, o, 2, 2); put(song, o, 3, 0); put(song, o, 4, 0); put(song, o, 5, 0);
  return song;
}

function aria() {
  const song = make('Slow Air (bowed)', 60, 2, 4, 8, { preset: 'bowed' }, { revMix: 0.4, revSize: 3.6, revTone: 0.45 });
  const n = (bar, st, s, f, t) => put(song, bar * 8 + st, s, f, t);
  n(0, 0, 2, 0); n(0, 0, 4, 3); n(0, 4, 4, 5, 'h'); n(0, 6, 4, 6, 'h');
  n(1, 0, 1, 0); n(1, 0, 4, '.'); n(1, 0, 5, 5, 'v'); n(1, 4, 5, 3, 'h'); n(1, 6, 5, 1, 'h');
  n(2, 0, 1, 1); n(2, 0, 5, '.'); n(2, 0, 4, 6); n(2, 4, 4, 5, 'h'); n(2, 6, 4, 3, 'h');
  n(3, 0, 1, 0); n(3, 0, 4, 2, 'v'); n(3, 6, 4, '.');
  n(4, 0, 2, 0); n(4, 0, 5, 5); n(4, 2, 5, 6, 'h'); n(4, 4, 5, 5, 'h'); n(4, 6, 5, 3, 'h');
  n(5, 0, 0, 3); n(5, 0, 2, '.'); n(5, 0, 5, 1); n(5, 4, 5, 3, 'h'); n(5, 6, 5, 5, 's');
  n(6, 0, 1, 0); n(6, 0, 0, '.'); n(6, 0, 5, 1); n(6, 4, 5, 0, 'h'); n(6, 6, 5, '.'); n(6, 6, 4, 2);
  n(7, 0, 2, 0); n(7, 0, 1, '.'); n(7, 0, 4, 3, 'v');
  return song;
}

export const DEMOS = [
  { name: 'First Light — fingerstyle steel', make: firstLight },
  { name: 'Romance — classical nylon', make: romance },
  { name: 'Campfire — 12-string strumming', make: campfire },
  { name: 'Slow Air — bowed strings', make: aria },
];
