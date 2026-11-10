// Demo songs: each shows some of what the instrument can do.

import { newSong, emptyCols, setCell, INSTRUMENTS, FX_DEFAULTS, REVERBS, TUNINGS } from './song.js';

function make(title, bpm, spb, bpb, bars, inst, fx) {
  const s = newSong();
  Object.assign(s, { title, bpm, spb, bpb, bars, cols: emptyCols(bars * spb * bpb) });
  s.inst = { ...INSTRUMENTS[inst.preset || 'steel'], ...inst };
  s.fx = { ...FX_DEFAULTS, ...fx };
  return s;
}
const put = (song, step, s, f, t = '') => setCell(song, step, s, { f, t });

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// MIDI number of a note name such as 'F#3' or 'Bb2'
function midiOf(name) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`bad note name ${name}`);
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
// a note by its pitch on string s; a pitch the string cannot play is a mistake in the demo
function note(song, step, s, name, t = '') {
  const f = midiOf(name) - song.tuning[s] - song.capo;
  if (f < 0 || f > 24) throw new Error(`${song.title}: ${name} is not on string ${s}`);
  put(song, step, s, f, t);
}
// frets per string, low to high (-1: not played)
const shape = (song, step, frets, t = '') => frets.forEach((f, s) => { if (f >= 0) put(song, step, s, f, t); });
// the settings of a reverb space
const space = (key) => { const { name, ...fx } = REVERBS[key]; return fx; };

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

function nightDrive() {
  const song = make('Night Drive', 112, 4, 4, 5, { preset: 'steel', pickHard: 0.8, fingerNoise: 0.45 }, { revMix: 0.2, revSize: 1.6, dlyOn: true, dlyTime: '8d', dlyMix: 0.1, dlyFb: 0.25 });
  const chug = (bar, steps, fret = 0) => { for (const st of steps) put(song, bar * 16 + st, 0, fret, 'm'); };
  const power = (bar, st, fret) => { put(song, bar * 16 + st, 0, fret, '>'); put(song, bar * 16 + st, 1, fret + 2); put(song, bar * 16 + st, 2, fret + 2); };
  chug(0, [0, 2, 4, 6, 8, 10]); power(0, 12, 3); chug(0, [14], 3);
  chug(1, [0, 2, 4, 6]); power(1, 8, 5); chug(1, [10], 5); power(1, 12, 3); chug(1, [14], 3);
  chug(2, [0, 2, 4, 6, 8, 10]); power(2, 12, 3); chug(2, [14], 3);
  chug(3, [0, 2, 4, 6]); power(3, 8, 7); put(song, 3 * 16 + 10, 0, 5, 'm'); put(song, 3 * 16 + 12, 0, 3, 'm'); put(song, 3 * 16 + 14, 0, 2, 'mh');
  [0, 2, 2, 1, 0, 0].forEach((f, s) => put(song, 64, s, f, s === 0 ? '>' : ''));
  put(song, 64 + 8, 3, 12, '*'); put(song, 64 + 10, 4, 12, '*'); put(song, 64 + 12, 5, 12, '*');
  put(song, 64 + 14, 5, 7, '*');
  return song;
}

// Nylon, short nails, 3/4. The melody on the treble strings, the bass on beat 1, a chord
// tone on beat 2; verse and refrain.
function greensleeves() {
  const song = make('Greensleeves (trad.)', 92, 2, 3, 33, { preset: 'nylon', picking: 2 }, space('hall'));
  const STR = { E3: 2, 'F#3': 2, G3: 3, 'G#3': 3, A3: 3, B3: 4, C4: 4, D4: 4, E4: 5, F4: 5, 'F#4': 5, G4: 5 };
  const CHORD = { Am: ['A2', 1, 'E3'], C: ['C3', 1, 'E3'], G: ['G2', 0, 'D3'], Em: ['E2', 0, 'E3'], E: ['E2', 0, 'E3'] };
  const open = [[[0, 'C4'], [4, 'D4']], [[0, 'E4'], [3, 'F4'], [4, 'E4']], [[0, 'D4'], [4, 'B3']], [[0, 'G3'], [3, 'A3'], [4, 'B3']]];
  const refrain = [[[0, 'G4']], [[0, 'G4'], [3, 'F#4'], [4, 'E4']], [[0, 'D4'], [4, 'B3']], [[0, 'G3'], [3, 'A3'], [4, 'B3']]];
  const middle = [[[0, 'C4'], [4, 'A3']], [[0, 'A3'], [3, 'G#3'], [4, 'A3', 'h']], [[0, 'B3'], [4, 'G#3']]];
  const close = [[[0, 'C4'], [3, 'B3'], [4, 'A3']], [[0, 'G#3'], [3, 'F#3'], [4, 'G#3']], [[0, 'A3']]];
  const bars = [...open, ...middle, [[0, 'E3'], [4, 'A3']], ...open, ...close, ...refrain, ...middle, [[0, 'E3']], ...refrain, ...close];
  const chords = ['Am', 'C', 'G', 'Em', 'Am', 'E', 'E', 'Am', 'Am', 'C', 'G', 'Em', 'Am', 'E', 'Am',
    'C', 'G', 'G', 'Em', 'Am', 'E', 'E', 'E', 'C', 'G', 'G', 'Em', 'Am', 'E', 'Am'];
  note(song, 4, 3, 'A3');
  bars.forEach((mel, i) => {
    const o = (i + 1) * 6, [bass, bs, inner] = CHORD[chords[i]];
    note(song, o, bs, bass);
    if (!mel.some(([, n]) => STR[n] === 2)) note(song, o + 2, 2, inner);
    for (const [st, n, t] of mel) note(song, o + st, STR[n], n, t);
  });
  shape(song, 31 * 6, [-1, 0, 2, 2, 1, 0]);
  put(song, 31 * 6, 1, 0, '>');
  put(song, 32 * 6, 0, 12, '*'); put(song, 32 * 6 + 2, 1, 12, '*'); put(song, 32 * 6 + 4, 5, 12, '*');
  return song;
}

// Open G, fingers. The melody on the top string, slid into and sung with vibrato, the high
// D as a harmonic; the bass and a dyad below.
function amazingGrace() {
  const song = make('Amazing Grace (trad.)', 76, 2, 3, 17, { preset: 'steel', picking: 1 }, space('church'));
  song.tuning = [...TUNINGS['Open G']];
  const mel = [
    [[4, 'D4']],
    [[0, 'G4', 'v'], [4, 'B4', 's'], [5, 'G4']], [[0, 'B4', 'v'], [4, 'A4', 's']], [[0, 'G4'], [4, 'E4', 's']], [[0, 'D4'], [4, 'D4']],
    [[0, 'G4', 'v'], [4, 'B4', 's'], [5, 'G4']], [[0, 'B4', 'v'], [4, 'A4', 's']], [[0, 'D5', '*']], [[4, 'B4']],
    [[0, 'D5', 'v'], [4, 'B4', 's'], [5, 'G4']], [[0, 'B4', 'v'], [4, 'A4', 's']], [[0, 'G4'], [4, 'E4', 's']], [[0, 'D4'], [4, 'D4']],
    [[0, 'G4', 'v'], [4, 'B4', 's'], [5, 'G4']], [[0, 'B4', 'v'], [4, 'A4', 's']], [[0, 'G4', 'v']],
  ];
  const CHORD = { G: [1, 'G2', 'D3', 'G3'], C: [1, 'C3', 'G3', 'C4'], D: [0, 'D2', 'A3', 'D4'] };
  const chords = ['G', 'G', 'C', 'G', 'G', 'G', 'D', 'D', 'G', 'G', 'C', 'G', 'G', 'D', 'G'];
  mel.forEach((bar, i) => {
    const o = i * 6;
    for (const [st, n, t] of bar) note(song, o + st, 5, n, t);
    if (!i) return;
    const [bs, bass, lo, hi] = CHORD[chords[i - 1]];
    note(song, o, bs, bass);
    for (const st of bar.length === 1 && bar[0][0] === 0 ? [2, 4] : [2]) { note(song, o + st, 2, lo); note(song, o + st, 3, hi); }
  });
  shape(song, 16 * 6, [12, 12, 12, 12, 12, 12], '*');
  for (const s of [3, 4, 5]) put(song, 16 * 6 + 3, s, 5, '*');
  return song;
}

// A jig in 6/8 (two beats of three eighths), flatpicked: the pick alternates through the runs.
function washerwoman() {
  const song = make('The Irish Washerwoman (trad.)', 112, 3, 2, 18, { preset: 'steel', picking: 0, pickHard: 0.8 }, space('room'));
  const STR = { D3: 2, E3: 2, G3: 3, A3: 3, B3: 4, C4: 4, D4: 4, E4: 5 };
  const A = [
    ['B3', 'G3', 'G3', 'D3', 'G3', 'G3'], ['B3', 'G3', 'B3', 'D4', 'C4', 'B3'],
    ['C4', 'A3', 'A3', 'E3', 'A3', 'A3'], ['C4', 'A3', 'C4', 'E4', 'D4', 'C4'],
    ['B3', 'G3', 'G3', 'D3', 'G3', 'G3'], ['B3', 'G3', 'B3', 'D4', 'C4', 'B3'],
    ['C4', 'D4', 'C4', 'B3', 'C4', 'A3'],
  ];
  const flags = { '6:1': 'h', '6:2': 'h' }; // a hammer-on and pull-off in the seventh bar
  const pickup = (bar) => { note(song, bar * 6 + 4, 4, 'D4'); note(song, bar * 6 + 5, 4, 'C4'); };
  pickup(0);
  for (const start of [1, 9]) {
    A.forEach((bar, i) => bar.forEach((n, k) => note(song, (start + i) * 6 + k, STR[n], n, flags[`${i}:${k}`] || '')));
    note(song, (start + 7) * 6, 3, 'G3');
  }
  pickup(8);
  shape(song, 16 * 6, [3, 2, 0, 0, 0, 3]);
  put(song, 16 * 6, 0, 3, '>');
  for (const [k, s] of [[0, 2], [1, 3], [2, 4]]) put(song, 17 * 6 + k, s, 12, '*');
  return song;
}

// 12-string arpeggios in 6/8: the bass, then up and down the three treble strings.
function risingSun() {
  const song = make('The House of the Rising Sun (trad.)', 76, 3, 2, 33, { preset: 'twelve', picking: 0 }, { ...space('stage'), dlyOn: true, dlyTime: '8', dlyMix: 0.08, dlyFb: 0.25 });
  const SHAPE = { Am: [-1, 0, 2, 2, 1, 0], C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], F: [1, 3, 3, 2, 1, 1], E: [0, 2, 2, 1, 0, 0] };
  const BASS = { Am: 1, C: 1, D: 2, F: 0, E: 0 };
  const verse = ['Am', 'C', 'D', 'F', 'Am', 'C', 'E', 'E', 'Am', 'C', 'D', 'F', 'Am', 'E', 'Am', 'E'];
  [...verse, ...verse].forEach((c, i) => {
    const sh = SHAPE[c];
    [BASS[c], 3, 4, 5, 4, 3].forEach((s, k) => put(song, i * 6 + k, s, sh[s], k === 0 && i % 4 === 0 ? '>' : ''));
  });
  shape(song, 32 * 6, SHAPE.Am);
  return song;
}

// Nylon, long nails, 3/8 in sixteenths: the opening, both endings and the first episode,
// with pull-offs.
function furElise() {
  const song = make('Für Elise (L. v. Beethoven)', 132, 2, 3, 23, { preset: 'nylon', picking: 3 }, space('studio'));
  const m1 = [[0, 5, 'E4'], [1, 4, 'D#4'], [2, 5, 'E4'], [3, 4, 'B3'], [4, 4, 'D4'], [5, 4, 'C4']];
  const m2 = [[0, 3, 'A3'], [0, 1, 'A2'], [1, 2, 'E3'], [3, 1, 'C3'], [4, 2, 'E3'], [5, 3, 'A3']];
  const m3 = [[0, 4, 'B3'], [0, 0, 'E2'], [1, 3, 'G#3'], [3, 2, 'E3'], [4, 3, 'G#3'], [5, 4, 'B3']];
  const m4 = [[0, 4, 'C4'], [0, 1, 'A2'], [1, 2, 'E3'], [3, 2, 'E3'], [4, 5, 'E4'], [5, 4, 'D#4']];
  const m7 = [[0, 4, 'B3'], [0, 0, 'E2'], [1, 3, 'G#3'], [3, 2, 'E3'], [4, 4, 'C4'], [5, 4, 'B3', 'h']];
  const end1 = [[0, 3, 'A3'], [0, 1, 'A2'], [1, 2, 'E3'], [4, 5, 'E4'], [5, 4, 'D#4']];
  const end2 = [[0, 3, 'A3'], [0, 1, 'A2'], [1, 2, 'E3'], [3, 4, 'B3'], [4, 4, 'C4'], [5, 4, 'D4']];
  const m10 = [[0, 5, 'E4'], [0, 1, 'C3'], [1, 3, 'G3'], [2, 4, 'C4'], [3, 3, 'G3'], [4, 5, 'F4'], [5, 5, 'E4', 'h']];
  const m11 = [[0, 4, 'D4'], [0, 0, 'G2'], [1, 2, 'D3'], [2, 3, 'G3'], [3, 2, 'F3'], [4, 5, 'E4'], [5, 4, 'D4']];
  const m12 = [[0, 4, 'C4'], [0, 1, 'A2'], [1, 2, 'E3'], [2, 3, 'A3'], [3, 2, 'E3'], [4, 4, 'D4'], [5, 4, 'C4', 'h']];
  const m13 = [[0, 4, 'B3'], [0, 0, 'E2'], [1, 2, 'E3'], [3, 2, 'E3'], [4, 3, 'G#3'], [5, 4, 'B3']];
  const last = [[0, 1, 'A2'], [1, 2, 'E3'], [2, 3, 'A3'], [3, 4, 'C4'], [4, 5, 'E4']];
  const half = [m1, m2, m3, m4, m1, m2, m7];
  const bars = [[[4, 5, 'E4'], [5, 4, 'D#4']], ...half, end1, ...half, end2, m10, m11, m12, m13, last];
  bars.forEach((bar, i) => { for (const [st, s, n, t] of bar) note(song, i * 6 + st, s, n, t); });
  put(song, 22 * 6, 1, 12, '*'); put(song, 22 * 6 + 2, 5, 12, '*');
  return song;
}

// Capo 2: C-major shapes sound in D. Eight chords of two beats, three times: bass and
// arpeggio; with the falling line; with that line an octave up the top string.
function canon() {
  const song = make('Canon in D (J. Pachelbel)', 66, 2, 4, 13, { preset: 'steel', picking: 1 }, { ...space('cathedral'), dlyOn: true, dlyTime: '4', dlyMix: 0.1, dlyFb: 0.3 });
  song.capo = 2;
  // [bass string, fret], two inner [string, fret], all relative to the capo
  const C = [[1, 3], [2, 2], [3, 0]], G = [[0, 3], [2, 0], [3, 0]], Am = [[1, 0], [2, 2], [3, 2]];
  const Em = [[0, 0], [2, 2], [3, 0]], F = [[0, 1], [2, 3], [3, 2]];
  const chords = [C, G, Am, Em, F, C, F, G];
  const low = [[5, 0], [4, 3], [4, 1], [4, 0], [3, 2], [3, 0], [3, 2], [4, 0]];
  const high = [[5, 12, '*'], [5, 10, 'v'], [5, 8, 's'], [5, 7, 's'], [5, 5, 'v'], [5, 3, 's'], [5, 5, 'h'], [5, 7, 's']];
  for (let pass = 0; pass < 3; pass++) chords.forEach(([bass, a, b], c) => {
    const o = pass * 32 + c * 4, mel = pass === 1 ? low[c] : pass === 2 ? high[c] : null;
    put(song, o, ...bass);
    if (mel) put(song, o, mel[0], mel[1], mel[2] || '');
    put(song, o + 1, ...a);
    if (!mel || mel[0] !== b[0]) put(song, o + 2, ...b);
    put(song, o + 3, ...a);
  });
  shape(song, 96, [-1, 3, 2, 0, 1, 0]);
  put(song, 96, 1, 3, '>');
  put(song, 100, 5, 12, '*');
  return song;
}

// Hybrid picking: the pick takes the bass, the fingers the melody; dead-note chops on beats
// 2 and 4, and a walking bass in swung eighths (triplet grid).
function saints() {
  const song = make('When the Saints Go Marching In (trad.)', 120, 3, 4, 16, { preset: 'steel', picking: 4 }, space('studio'));
  const STR = { C4: 4, D4: 4, E4: 5, F4: 5, G4: 5 };
  // [beat, note, flags] per bar
  const mel = [
    [[1, 'C4'], [2, 'E4'], [3, 'F4']], [[0, 'G4', '>']], [[1, 'C4'], [2, 'E4'], [3, 'F4']], [[0, 'G4', '>']],
    [[1, 'C4'], [2, 'E4'], [3, 'F4']], [[0, 'G4'], [2, 'E4']], [[0, 'C4'], [2, 'E4']], [[0, 'D4', 'v']],
    [[1, 'E4'], [2, 'E4'], [3, 'D4']], [[0, 'C4'], [3, 'C4']], [[0, 'E4'], [2, 'G4'], [3, 'G4']], [[0, 'F4', 'v'], [2, 'E4'], [3, 'F4']],
    [[0, 'G4'], [2, 'E4']], [[0, 'C4'], [2, 'D4']], [[0, 'C4', 'v']],
  ];
  const BASS = { C: [[1, 'C3'], [0, 'G2']], G: [[0, 'G2'], [2, 'D3']], F: [[0, 'F2'], [1, 'C3']] };
  const chords = ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'G', 'G', 'C', 'C', 'F', 'C', 'G', 'C'];
  // walks into the next chord: [bar, step, string, note]
  const walks = [[6, 6, 0, 'E2'], [6, 9, 0, 'F#2'], [8, 9, 1, 'A2'], [8, 11, 1, 'B2'], [10, 9, 0, 'E2'], [13, 9, 0, 'A2'], [13, 11, 0, 'B2']];
  mel.forEach((bar, i) => {
    const o = i * 12, [root, fifth] = BASS[chords[i]];
    note(song, o, root[0], root[1]);
    note(song, o + 6, fifth[0], fifth[1]);
    for (const st of [3, 9]) { put(song, o + st, 2, 'x'); put(song, o + st, 3, 'x'); }
    for (const [beat, n, t] of bar) note(song, o + beat * 3, STR[n], n, t);
  });
  for (const [bar, st, s, n] of walks) note(song, bar * 12 + st, s, n);
  shape(song, 15 * 12, [-1, 3, 2, 0, 1, 0]);
  put(song, 15 * 12, 1, 3, '>');
  put(song, 15 * 12 + 6, 5, 12, '*');
  return song;
}

// A 12-bar shuffle, tuned half a step down: palm-muted boogie bass in swung triplets, licks
// with bends, hammer-ons and vibrato, one of them up at the 12th fret.
function deltaShuffle() {
  const song = make('Delta Shuffle', 88, 3, 4, 13, { preset: 'steel', picking: 0, pickHard: 0.8, fingerNoise: 0.45 }, space('room'));
  song.tuning = [...TUNINGS['Half step down']];
  // root [string, fret], then the fret of the next string up on beats 1, 3 and on beats 2, 4
  const BOOGIE = { E: [0, 0, 2, 4], A: [1, 0, 2, 4], B: [1, 2, 4, 6] };
  const boogie = (bar, c, beats) => {
    const [s, f, lo, hi] = BOOGIE[c];
    for (const b of beats) for (const st of [b * 3, b * 3 + 2]) { put(song, bar * 12 + st, s, f, 'm'); put(song, bar * 12 + st, s + 1, b % 2 ? hi : lo, 'm'); }
  };
  const chords = ['E', 'E', 'E', 'E', 'A', 'A', 'E', 'E', 'B', 'A', 'E', 'E'];
  chords.forEach((c, bar) => boogie(bar, c, bar === 3 || bar === 7 ? [0, 1] : bar === 11 ? [0, 1] : [0, 1, 2, 3]));
  // [step, string, fret, flags]
  const licks = {
    3: [[6, 4, 3, 'b'], [8, 4, 0], [9, 3, 0], [10, 3, 2, 'h'], [11, 2, 2]],
    7: [[6, 4, 15, 'b'], [8, 5, 12], [9, 4, 12], [11, 3, 14, 'v']],
    11: [[6, 1, 2, '>'], [6, 2, 1], [6, 3, 2], [6, 4, 0], [6, 5, 2]],
  };
  for (const [bar, notes] of Object.entries(licks)) for (const [st, s, f, t] of notes) put(song, +bar * 12 + st, s, f, t || '');
  shape(song, 12 * 12, [0, 2, 0, 1, 3, 0]);
  put(song, 12 * 12, 0, 0, '>');
  put(song, 12 * 12 + 6, 5, 12, '*');
  return song;
}

// Drop D: one-finger power chords, palm-muted sixteenth chugs, dead-note scratches and
// sliding chords; harmonics through the delay, no reverb.
function dropD() {
  const song = make('Drop D Thunder', 100, 4, 4, 12, { preset: 'steel', picking: 0, pickHard: 0.85, fingerNoise: 0.45 }, { ...space('none'), dlyOn: true, dlyTime: '8d', dlyMix: 0.12, dlyFb: 0.3 });
  song.tuning = [...TUNINGS['Drop D']];
  const pow = (bar, st, f, t = '') => { for (const s of [0, 1, 2]) put(song, bar * 16 + st, s, f, s === 0 && t === '>' ? '>' : t === '>' ? '' : t); };
  const chug = (bar, st) => put(song, bar * 16 + st, 0, 0, 'm');
  const dead = (bar, st) => { for (const s of [0, 1, 2]) put(song, bar * 16 + st, s, 'x'); };
  const A = (bar, scratch) => {
    pow(bar, 0, 0, '>'); chug(bar, 2); chug(bar, 3); dead(bar, 4); chug(bar, 5);
    pow(bar, 6, 3, '>'); chug(bar, 8); chug(bar, 9); pow(bar, 10, 5);
    if (scratch) for (const st of [12, 13, 14, 15]) dead(bar, st);
    else { chug(bar, 12); dead(bar, 13); pow(bar, 14, 3); }
  };
  const B = (bar) => {
    pow(bar, 0, 0, '>'); chug(bar, 2); chug(bar, 3); pow(bar, 4, 5, '>'); pow(bar, 6, 7, 's');
    pow(bar, 8, 10, 's'); pow(bar, 12, 8, 's'); pow(bar, 14, 7, 's');
    for (const s of [0, 1, 2]) put(song, bar * 16 + 15, s, '.');
  };
  [[0, 0, 12], [4, 1, 12], [8, 2, 12], [12, 3, 12]].forEach(([st, s, f]) => put(song, st, s, f, '*'));
  [[0, 0, 7], [4, 1, 7], [8, 2, 7], [12, 0, 5]].forEach(([st, s, f]) => put(song, 16 + st, s, f, '*'));
  A(2); A(3, true); B(4); A(5); A(6); A(7, true); B(8); A(9); B(10);
  pow(11, 0, 0, '>');
  for (const s of [0, 1, 2]) put(song, 11 * 16 + 8, s, 12, '*');
  return song;
}

// DADGAD, long nails: natural harmonics at the 12th, 7th and 5th frets ring like bells
// through a long delay and a cathedral; between them, hammer-ons and slides over open drones.
function bellTower() {
  const song = make('Bell Tower', 78, 2, 3, 13, { preset: 'steel', picking: 3 }, { ...space('cathedral'), dlyOn: true, dlyTime: '8d', dlyMix: 0.16, dlyFb: 0.4, vol: 1 });
  song.tuning = [...TUNINGS.DADGAD];
  // [step, string, fret] per bar, all harmonics
  const bells = [
    [[0, 5, 12], [2, 4, 12], [4, 3, 12]], [[0, 5, 7], [2, 4, 7], [4, 2, 12]],
    [[0, 3, 7], [2, 5, 5], [4, 4, 5]], [[0, 0, 12], [1, 1, 12], [2, 2, 7], [4, 3, 5]],
  ];
  const bells2 = [
    [[0, 5, 5], [2, 3, 5], [4, 4, 7]], [[0, 5, 12], [2, 4, 12], [4, 3, 12]],
    [[0, 2, 7], [2, 1, 12], [4, 0, 12]], [[0, 1, 7], [2, 0, 7], [4, 0, 5]],
  ];
  const ring = (bars, at) => bars.forEach((bar, i) => { for (const [st, s, f] of bar) put(song, (at + i) * 6 + st, s, f, '*'); });
  ring(bells, 0);
  // [step, string, fret, flags]
  const tune = [
    [[0, 0, 0, '>'], [0, 1, 0], [0, 2, 0], [0, 3, 0], [0, 4, 0], [0, 5, 0], [2, 5, 2, 'h'], [3, 5, 4, 'h'], [4, 5, 2, 'h'], [5, 5, 0, 'h']],
    [[0, 0, 0], [0, 4, 2], [0, 5, 5], [2, 5, 7, 's'], [4, 5, 5, 's']],
    [[0, 0, 0], [0, 3, 0], [0, 4, 0], [2, 4, 2], [4, 4, 4, 'h'], [5, 4, 5, 'h']],
    [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 5, 7, 'v']],
  ];
  tune.forEach((bar, i) => { for (const [st, s, f, t] of bar) put(song, (4 + i) * 6 + st, s, f, t || ''); });
  ring(bells2, 8);
  shape(song, 12 * 6, [12, 12, 12, 12, 12, 12], '*');
  return song;
}

// Travis picking with a capo: the thumb alternates between two palm-muted bass strings, the
// fingers play between its beats. The second half moves up the neck in barre shapes.
function porchSwing() {
  const song = make('Porch Swing', 104, 2, 4, 14, { preset: 'steel', picking: 1 }, { ...space('stage'), vol: 1 });
  song.capo = 3;
  // root, alternate bass, two inner fingers and the top: [string, fret]
  const C = [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]], Am = [[1, 0], [2, 2], [3, 2], [4, 1], [5, 0]];
  const F = [[0, 1], [2, 3], [3, 2], [4, 1], [5, 1]], G = [[0, 3], [2, 0], [3, 0], [4, 0], [5, 3]];
  const E7 = [[0, 0], [2, 2], [3, 1], [4, 3], [5, 0]];
  const C8 = [[0, 8], [2, 10], [3, 9], [4, 8], [5, 8]], Am5 = [[0, 5], [2, 7], [3, 5], [4, 5], [5, 5]];
  const G3 = [[0, 3], [2, 5], [3, 4], [4, 3], [5, 3]];
  const bars = [C, Am, F, G, C, E7, F, G, C8, Am5, F, G3];
  bars.forEach(([r, a, f1, f2, top], i) => {
    const o = i * 8, sync = i >= 4 && i < 8;
    put(song, o, r[0], r[1], 'm'); put(song, o, top[0], top[1], i % 4 === 0 ? '>' : '');
    put(song, o + 1, ...f2);
    put(song, o + 2, a[0], a[1], 'm');
    put(song, o + 3, ...f1);
    put(song, o + 4, r[0], r[1], 'm');
    if (sync) put(song, o + 5, ...top); else put(song, o + 5, ...f2);
    put(song, o + 6, a[0], a[1], 'm');
    put(song, o + 7, ...f1);
  });
  shape(song, 12 * 8, [-1, 3, 2, 0, 1, 0]);
  put(song, 12 * 8, 1, 3, '>');
  for (const [k, s] of [[0, 3], [2, 4], [4, 5]]) put(song, 13 * 8 + k, s, 12, '*');
  return song;
}

export const DEMOS = [
  { name: 'First Light — fingerstyle steel', make: firstLight },
  { name: 'Romance — classical nylon', make: romance },
  { name: 'Campfire — 12-string strumming', make: campfire },
  { name: 'Night Drive — palm mutes, harmonics', make: nightDrive },
  { name: 'Greensleeves — nylon, short nails, concert hall', make: greensleeves },
  { name: 'Amazing Grace — open G, slides, vibrato', make: amazingGrace },
  { name: 'The Irish Washerwoman — 6/8 jig, flatpicking', make: washerwoman },
  { name: 'The House of the Rising Sun — 12-string arpeggios', make: risingSun },
  { name: 'Für Elise — long nails, pull-offs', make: furElise },
  { name: 'Canon in D — capo, cathedral, delay', make: canon },
  { name: 'When the Saints — hybrid picking, dead notes, swing', make: saints },
  { name: 'Delta Shuffle — bends, boogie, half step down', make: deltaShuffle },
  { name: 'Drop D Thunder — chugs, sliding power chords', make: dropD },
  { name: 'Bell Tower — DADGAD harmonics', make: bellTower },
  { name: 'Porch Swing — Travis picking, capo, shifts', make: porchSwing },
];
