// Demo songs: twelve pieces that between them use every instrument, picking technique,
// technique mark, tuning and grid. All of them are played in the same room.

import { newSong, emptyCols, setCell, INSTRUMENTS, FX_DEFAULTS, REVERBS, TUNINGS } from './song.js';

function make(title, bpm, spb, bpb, bars, inst, fx) {
  const s = newSong();
  Object.assign(s, { title, bpm, spb, bpb, bars, cols: emptyCols(bars * spb * bpb) });
  s.inst = { ...INSTRUMENTS[inst.preset || 'steel'], ...inst };
  s.fx = { ...FX_DEFAULTS, ...fx };
  return s;
}
const put = (song, step, s, f, t = '') => setCell(song, step, s, { f, t });
// notes of bar n: [step in the bar, string, fret, flags]
const bar = (song, n, notes) => { for (const [st, s, f, t] of notes) put(song, n * song.spb * song.bpb + st, s, f, t || ''); };
// frets per string, low to high (-1: not played), from string `from` up
const shape = (song, step, frets, t = '', from = 0) => frets.forEach((f, s) => { if (f >= 0 && s >= from) put(song, step, s, f, t); });
// the room every demo is played in
const ROOM = (({ name, ...fx }) => fx)(REVERBS.room);
const lowest = (frets) => frets.findIndex((f) => f >= 0);

// Steel string, fingers. A falling bass line under a sixteenth-note arpeggio; the second
// time round the top string sings: hammer-ons, slides and a pull-off. Ends on the chime of
// three harmonics that make the home chord.
function daybreak() {
  const song = make('Daybreak', 76, 4, 4, 17, { preset: 'steel', picking: 3 }, { ...ROOM, dlyOn: true, dlyTime: '8d', dlyMix: 0.1, dlyFb: 0.3, vol: 0.95 });
  const D = [-1, -1, 0, 2, 3, 2], AC = [-1, 4, 2, 2, 2, 0], Bm = [-1, 2, 0, 2, 0, 2], GM = [3, -1, 0, 0, 0, 2], G = [3, -1, 0, 0, 3, 3];
  const DF = [2, -1, 0, 2, 3, 2], Em = [0, 2, 2, 0, 3, 0], As = [-1, 0, 2, 0, 3, 0], A = [-1, 0, 2, 2, 2, 0];
  // one bar: the bass with the top string, the inner strings, the other bass, and again
  const arpeggio = (n, first, second = first, accent = false) => {
    const b = lowest(first), b2 = lowest(second);
    const steps = [[0, b], [0, 5], [2, 3], [3, 4], [4, 5], [6, 3], [7, 4], [8, b2 < 2 ? 2 : b2], [10, 3], [11, 4], [12, 5], [14, 4], [15, 3]];
    bar(song, n, steps.map(([st, s], k) => [st, s, (st < 8 ? first : second)[s], accent && !k ? '>' : '']));
  };
  [D, AC, Bm, GM, DF, Em, As, A].forEach((c, i) => arpeggio(i, c, c, i === 0));
  [D, AC, Bm, G, DF, GM].forEach((c, i) => arpeggio(8 + i, c, c, i === 0));
  arpeggio(14, As);
  arpeggio(15, As, A);
  // the melody on the top string
  bar(song, 8, [[4, 5, 3, 'h'], [12, 5, 5, 's']]);
  bar(song, 10, [[12, 5, 5, 'sv']]);
  bar(song, 11, [[12, 5, 2, 'h']]);
  bar(song, 12, [[13, 5, 3, 'h'], [14, 5, 2, 'h']]);
  bar(song, 13, [[4, 5, 3, 'h'], [12, 5, 2, 'h']]);
  bar(song, 15, [[11, 4, 2, 'h']]);
  shape(song, 16 * 16, [-1, 0, 0, 2, 3, 2]);
  put(song, 16 * 16, 1, 0, '>');
  bar(song, 16, [[8, 2, 7, '*'], [10, 3, 7, '*'], [12, 4, 7, '*']]);
  return song;
}

// Nylon, fingers, in three: the Andalusian cadence. Strummed chords; then the thumb plays
// the tune on the bass strings while two open strings keep ringing above it; then the top
// strings run in hammer-ons and pull-offs.
function andaluza() {
  const song = make('Andaluza', 92, 3, 3, 21, { preset: 'nylon', picking: 3, strum: 22 }, { ...ROOM, vol: 0.7 });
  const Am = [-1, 0, 2, 2, 1, 0], G = [3, 2, 0, 0, 0, 3], F = [1, 3, 3, 2, 0, 0], E = [0, 2, 2, 1, 0, 0];
  // the bass and four strings on the first beat, three strings after it
  const strummed = (n, c) => {
    const o = n * 9;
    shape(song, o, c, '', 2);
    put(song, o, lowest(c), c[lowest(c)], n % 16 === 0 ? '>' : '');
    for (const st of [3, 5, 6, 7, 8]) shape(song, o + st, c, '', 3);
  };
  [Am, G, F, E].forEach((c, i) => { strummed(i, c); strummed(16 + i, c); });
  // the thumb's tune, three notes a bar: [string, fret]
  const tune = [
    [[1, 0], [1, 3], [2, 2]], [[3, 2], [2, 2], [1, 3]], [[0, 3], [1, 2], [2, 0]], [[3, 0], [2, 0], [1, 2]],
    [[0, 1], [1, 0], [1, 3]], [[2, 3], [1, 3], [1, 0]], [[0, 0], [0, 4], [1, 2]], [[2, 2], [2, 0], [1, 2]],
  ];
  tune.forEach((notes, i) => notes.forEach(([s, f], beat) => {
    const o = (4 + i) * 9 + beat * 3;
    put(song, o, s, f, beat === 0 && i === 0 ? '>' : '');
    put(song, o + 1, 5, 0);
    put(song, o + 2, 4, 0);
  }));
  bar(song, 12, [[0, 1, 0], [0, 5, 0], [1, 5, 1, 'h'], [2, 5, 3, 'h'], [3, 5, 5, 'h'], [4, 5, 3, 'h'], [5, 5, 1, 'h'], [6, 5, 0, 'h'], [7, 4, 1], [8, 4, 0, 'h']]);
  bar(song, 13, [[0, 0, 3], [0, 4, 3], [1, 5, 0], [2, 5, 1, 'h'], [3, 5, 3, 'h'], [4, 5, 1, 'h'], [5, 5, 0, 'h'], [6, 4, 3], [8, 4, 0]]);
  bar(song, 14, [[0, 0, 1], [0, 4, 1], [1, 4, 3, 'h'], [2, 5, 0], [3, 5, 1, 'h'], [4, 5, 0, 'h'], [5, 4, 3], [6, 4, 1, 'h'], [8, 3, 2]]);
  bar(song, 15, [[0, 0, 0], [0, 3, 1], [1, 3, 2, 'h'], [2, 4, 0], [3, 4, 1, 'h'], [4, 4, 0, 'h'], [5, 3, 2], [6, 3, 1, 'h'], [8, 2, 2, 'v']]);
  shape(song, 20 * 9, E);
  bar(song, 20, [[6, 0, 12, '*'], [7, 4, 12, '*'], [8, 5, 12, '*']]);
  return song;
}

// Drop D, a pick, two in a bar: the shanty over palm-muted bass notes, then with one-finger
// power chords, dead-note scratches and a galloping bass. A short echo.
function drunkenSailor() {
  const song = make('Drunken Sailor (trad.)', 104, 4, 2, 36, { preset: 'steel', picking: 0, pickHard: 0.85 }, { ...ROOM, dlyOn: true, dlyTime: '16', dlyMix: 0.1, dlyFb: 0.15 });
  song.tuning = [...TUNINGS['Drop D']];
  // the tune: [string, fret] of B3, E3, G3, A3, D3, F#3, C#4, D4, E4
  const B = [4, 0], E = [2, 2], G = [3, 0], A = [3, 2], D = [2, 0], Fs = [2, 4], Cs = [4, 2], D4 = [4, 3], E4 = [5, 0];
  const run = (n) => [0, 2, 3, 4, 6, 7].map((st) => [st, n]), four = (...ns) => ns.map((n, k) => [2 * k, n]);
  const verse = [run(B), four(B, E, G, B), run(A), four(A, D, Fs, A), run(B), four(B, Cs, D4, E4), four(D4, B, A, Fs), [[0, E], [4, E]]];
  const shout = (n) => [[0, n], [4, n], [7, n]];
  const chorus = [shout(B), four(B, E, G, B), shout(A), four(A, D, Fs, A), shout(B), four(B, Cs, D4, E4), four(D4, B, A, Fs), [[0, E], [4, E]]];
  const roots = [2, 2, 0, 0, 2, 2, 0, 2]; // fret of the power chord of each bar: E or D
  const power = (step, f, t = '') => { for (const s of [0, 1, 2]) put(song, step, s, f, s === 0 ? t : ''); };
  const scratch = (step) => { for (const s of [0, 1, 2]) put(song, step, s, 'x'); };
  const tune = (at, bars) => bars.forEach((notes, i) => { for (const [st, [s, f]] of notes) put(song, (at + i) * 8 + st, s, f); });
  // intro: the riff alone
  for (const n of [0, 1]) {
    power(n * 8, 2, '>');
    for (const st of [2, 3, 4, 7]) put(song, n * 8 + st, 0, 2, 'm');
    scratch(n * 8 + 6);
  }
  // first verse: a palm-muted root on every beat; second verse: a galloping one
  tune(2, verse);
  tune(18, verse);
  roots.forEach((f, i) => {
    if (i === 7) { for (const at of [2, 18]) for (const st of [0, 4]) power((at + i) * 8 + st, f, st ? '' : '>'); return; }
    for (const st of [0, 4]) put(song, (2 + i) * 8 + st, 0, f, 'm');
    for (const st of [0, 2, 3, 4, 6, 7]) put(song, (18 + i) * 8 + st, 0, f, 'm');
  });
  // the chorus, twice: power chords under the tune
  for (const at of [10, 26]) {
    tune(at, chorus);
    roots.forEach((f, i) => {
      const o = (at + i) * 8;
      power(o, f, '>');
      if (i % 2 === 0 || i === 7) power(o + 4, f);
      if (i % 2 === 0 && i < 6) scratch(o + 6);
    });
  }
  // ending: up the neck and back
  power(34 * 8, 2, '>');
  for (const s of [0, 1, 2]) put(song, 34 * 8 + 4, s, 14, 's');
  power(35 * 8, 2, '>');
  for (const s of [0, 1, 2]) put(song, 35 * 8 + 6, s, '.');
  return song;
}

// Half a step down, fingers close to the bridge, like a koto. The tune first low over
// open bass strings, then an octave up in fifth position with slides, a bend and vibrato.
function sakura() {
  const song = make('Sakura (trad.)', 66, 2, 4, 16, { preset: 'steel', picking: 3, pickPos: 0.1 }, { ...ROOM, dlyOn: true, dlyTime: '4', dlyMix: 0.12, dlyFb: 0.3, vol: 1 });
  song.tuning = [...TUNINGS['Half step down']];
  bar(song, 0, [[0, 1, 12, '*'], [2, 5, 12, '*'], [4, 1, 7, '*'], [6, 5, 7, '*']]);
  const low = [
    [[0, 1, 0, '>'], [0, 3, 2], [2, 3, 2], [4, 4, 0]],
    [[0, 1, 0], [0, 3, 2], [2, 3, 2], [4, 4, 0]],
    [[0, 1, 0], [0, 3, 2], [2, 4, 0], [4, 4, 1], [6, 4, 0]],
    [[0, 1, 0], [0, 3, 2], [2, 4, 0], [3, 3, 2], [4, 2, 3, 'v']],
    [[0, 0, 0], [0, 2, 2], [2, 1, 3], [4, 2, 2], [6, 2, 3]],
    [[0, 0, 0], [0, 2, 2], [2, 2, 2], [3, 1, 3], [4, 1, 2, 'v']],
  ];
  const high = [
    [[0, 1, 0, '>'], [0, 5, 5], [2, 5, 7, 's'], [4, 5, 8], [6, 5, 7]],
    [[0, 1, 0], [0, 5, 5], [2, 5, 7], [3, 5, 5, 'h'], [4, 4, 6, 'v']],
    [[0, 0, 0], [0, 4, 5], [2, 3, 5], [4, 4, 5], [6, 4, 6]],
    [[0, 0, 0], [0, 4, 5], [2, 4, 5], [3, 3, 5], [4, 3, 4, 'v']],
    [[0, 1, 0], [0, 5, 5], [2, 5, 5], [4, 5, 5, 'b']],
    [[0, 1, 0], [0, 5, 5], [2, 5, 5], [4, 5, 7, 'sv']],
    [[0, 0, 0], [0, 4, 5], [2, 4, 6], [4, 5, 7], [5, 5, 5, 'h'], [6, 4, 6]],
    [[0, 0, 0, '>'], [0, 4, 5, 'v']],
  ];
  low.forEach((notes, i) => bar(song, 1 + i, notes));
  high.forEach((notes, i) => bar(song, 7 + i, notes));
  bar(song, 15, [[0, 1, 12, '*'], [2, 4, 12, '*'], [4, 5, 12, '*'], [6, 5, 7, '*']]);
  return song;
}

// 12-string with a capo, a pick, two beats of three: broken chords with a suspended note
// that resolves in the middle of the bar. The last time round every bar starts with a strum.
function glassHarbour() {
  const song = make('Glass Harbour', 72, 3, 2, 25, { preset: 'twelve', picking: 0 }, { ...ROOM, dlyOn: true, dlyTime: '8', dlyMix: 0.1, dlyFb: 0.25, vol: 0.9 });
  song.capo = 2;
  const D = [-1, -1, 0, 2, 3, 2], Ds4 = [-1, -1, 0, 2, 3, 3], Ds2 = [-1, -1, 0, 2, 3, 0], C9 = [-1, 3, 2, 0, 3, 0], GB = [-1, 2, 0, 0, 3, 3];
  const G = [3, 2, 0, 0, 3, 3], Em = [0, 2, 2, 0, 3, 3], As = [-1, 0, 2, 0, 3, 3], A = [-1, 0, 2, 2, 2, 0];
  const first = [[D], [Ds4, D], [C9], [GB], [D], [Ds2, D], [C9], [G]];
  const second = [[Em], [G], [D], [As, A], [Em], [G], [As], [A]];
  const broken = (n, [a, b = a], strum) => {
    const o = n * 6;
    if (strum) shape(song, o, a);
    put(song, o, lowest(a), a[lowest(a)], n % 4 === 0 ? '>' : '');
    [[1, 4, a], [2, 5, a], [3, 3, b], [4, 5, b], [5, 4, b]].forEach(([st, s, c]) => put(song, o + st, s, c[s]));
  };
  first.forEach((c, i) => { broken(i, c, false); broken(16 + i, c, true); });
  second.forEach((c, i) => broken(8 + i, c, i === 0));
  shape(song, 24 * 6, [-1, 0, 0, 2, 3, 2]);
  put(song, 24 * 6, 1, 0, '>');
  bar(song, 24, [[3, 2, 7, '*'], [4, 3, 7, '*'], [5, 4, 7, '*']]);
  return song;
}

// Open G, hybrid picking, a slow twelve bars in swung triplets. The pick keeps a palm-muted
// bass going; the fingers slide three strings into the chords at the 12th, 5th and 7th fret
// like a bottleneck, bend, shake and chop.
function lowlandBlues() {
  const song = make('Lowland Blues', 72, 3, 4, 13, { preset: 'steel', picking: 4, pickHard: 0.7 }, { ...ROOM, vol: 1 });
  song.tuning = [...TUNINGS['Open G']];
  // the bass of each bar: [string, fret]
  const Gb = [1, 0], Cb = [1, 5], Db = [0, 0];
  [Gb, Gb, Gb, Gb, Cb, Cb, Gb, Gb, Db, Cb, Gb].forEach(([s, f], i) => { for (const st of [0, 3, 6, 9]) put(song, i * 12 + st, s, f, 'm'); });
  const slideIn = (f) => [3, 4, 5].map((s) => [0, s, f, 's']);
  const licks = [
    [[2, 3, 3], [3, 3, 4, 'h'], [5, 5, 0], [6, 5, 3, 'v'], [9, 4, 0], [11, 4, 10], [11, 5, 10]],
    [[0, 4, 12, 's'], [0, 5, 12, 's'], [6, 4, 12], [6, 5, 12, 'v'], [9, 5, 10], [11, 5, 12, 'h']],
    [[0, 5, 12, '>'], [2, 5, 10, 'h'], [3, 4, 12], [5, 3, 12], [6, 3, 10, 'v'], [9, 3, 12], [11, 4, 12]],
    [[0, 5, 12, '>'], [2, 5, 10], [3, 5, 8, 'h'], [5, 5, 5, 's'], [6, 5, 3, 'v'], [9, 5, 0], [11, 3, 3], [11, 4, 3], [11, 5, 3]],
    [...slideIn(5), [6, 4, 5], [6, 5, 5], [8, 5, 8], [9, 5, 5, 'h']],
    [[0, 5, 8, 'b'], [6, 5, 5], [8, 4, 5], [9, 3, 5], [11, 3, 3]],
    [[0, 3, 4, 'h'], [2, 4, 0], [3, 5, 0], [5, 5, 3], [6, 5, 5, 'v']],
    [[0, 5, 3], [2, 5, 0, 'h'], [3, 4, 3], [5, 4, 0, 'h'], [6, 3, 0], [9, 3, 'x'], [9, 4, 'x'], [11, 3, 5], [11, 4, 5], [11, 5, 5]],
    [...slideIn(7), [6, 4, 7], [6, 5, 7], [9, 5, 10, 'v']],
    [...slideIn(5), [6, 5, 8], [8, 5, 5, 'h'], [9, 4, 5], [11, 3, 3]],
    [[0, 3, 4, 'h'], [3, 3, 0], [3, 5, 3], [6, 3, 0], [6, 5, 2], [9, 3, 0], [9, 5, 1]],
    [[0, 1, 0, 'm'], [0, 3, 0], [0, 5, 0], [3, 1, 0, 'm'], [6, 0, 0, '>'], [6, 2, 0], [6, 3, 2], [6, 4, 1], [6, 5, 4], [9, 3, 'x'], [9, 4, 'x'], [11, 2, '.'], [11, 3, '.'], [11, 4, '.'], [11, 5, '.']],
  ];
  licks.forEach((notes, i) => bar(song, i, notes));
  shape(song, 12 * 12, [0, 0, 0, 0, 0, 0]);
  put(song, 12 * 12, 0, 0, '>');
  bar(song, 12, [[6, 3, 12, '*'], [7, 4, 12, '*'], [8, 5, 12, '*']]);
  return song;
}

// DADGAD, fingers: a slow air on the top two strings in hammer-ons, pull-offs and
// slides over open bass strings; between its two rounds, harmonics at the 12th and 7th fret.
function standingStones() {
  const song = make('Standing Stones', 84, 2, 4, 19, { preset: 'steel', picking: 3 }, { ...ROOM, dlyOn: true, dlyTime: '8d', dlyMix: 0.14, dlyFb: 0.35, vol: 1 });
  song.tuning = [...TUNINGS.DADGAD];
  const air = [
    [[0, 5, 0], [2, 5, 2, 'h'], [3, 5, 4, 'h'], [4, 5, 7, 's'], [6, 5, 4], [7, 5, 2, 'h']],
    [[0, 5, 0, 'h'], [2, 4, 2], [3, 4, 0, 'h'], [5, 4, 2, 'h'], [6, 5, 0]],
    [[0, 5, 2], [2, 5, 4, 'h'], [3, 5, 7, 's'], [5, 5, 9, 'h'], [6, 5, 7, 'h']],
    [[0, 5, 4, 's'], [2, 5, 2, 'h'], [3, 5, 0, 'h'], [6, 3, 12, '*']],
    [[0, 5, 7], [2, 5, 9, 'h'], [3, 5, 12, 'sv'], [5, 5, 9], [6, 5, 7, 'h']],
    [[0, 5, 4], [2, 5, 7, 's'], [3, 5, 4, 's'], [4, 5, 2, 'h'], [6, 5, 0, 'h']],
    [[0, 4, 2], [2, 5, 0], [3, 5, 2, 'h'], [5, 5, 4, 'h'], [6, 5, 2, 'h']],
  ];
  const round = (at) => {
    air.forEach((notes, i) => {
      bar(song, at + i, notes);
      // the open bass strings: A under the fifth bar, D under the others
      put(song, (at + i) * 8, i === 4 ? 1 : 0, 0, i === 0 ? '>' : '');
      put(song, (at + i) * 8 + 4, 2, 0);
    });
    shape(song, (at + 7) * 8, [0, 0, 0, 0, 0, 0]);
    put(song, (at + 7) * 8, 0, 0, '>');
    bar(song, at + 7, [[4, 3, 12, '*'], [5, 4, 12, '*'], [6, 5, 12, '*']]);
  };
  round(0);
  bar(song, 8, [2, 3, 4, 5].map((s, k) => [2 * k, s, 12, '*']));
  bar(song, 9, [2, 3, 4, 5].map((s, k) => [2 * k, s, 7, '*']));
  round(10);
  shape(song, 18 * 8, [12, 12, 12, 12, 12, 12], '*');
  put(song, 18 * 8 + 4, 5, 7, '*');
  return song;
}

// Nylon, fingers: the tune on the top three strings, a bass on the
// first and third beat and a chord note between them; two slides into the long notes.
function auldLangSyne() {
  const song = make('Auld Lang Syne (trad.)', 80, 2, 4, 18, { preset: 'nylon' }, ROOM);
  // [string, fret] of the tune's notes and, per chord, of the bass, the chord note and the other bass
  const N = { G3: [3, 0], A3: [3, 2], C4: [4, 1], D4: [4, 3], E4: [5, 0], G4: [5, 3], A4: [5, 5] };
  const CHORD = { C: [[1, 3], [2, 2], [0, 3]], G: [[0, 3], [2, 0], [1, 2]], F: [[0, 1], [2, 3], [1, 3]] };
  // dotted quarter, eighth, quarter, quarter
  const line = (a, b, c, d) => [[0, a], [3, b], [4, c], [6, d]];
  const held = (a, pickup) => [[0, a, 'sv'], ...(pickup ? [[6, pickup]] : [])];
  const verse = [line('C4', 'C4', 'C4', 'E4'), line('D4', 'C4', 'D4', 'E4'), line('C4', 'C4', 'E4', 'G4'), held('A4', 'A4'),
    line('G4', 'E4', 'E4', 'C4'), line('D4', 'C4', 'D4', 'E4'), line('C4', 'A3', 'A3', 'G3'), [[0, 'C4'], [6, 'A4']]];
  const chorus = [line('G4', 'E4', 'E4', 'C4'), line('D4', 'C4', 'D4', 'A4'), line('G4', 'E4', 'E4', 'G4'), held('A4', 'A4'),
    line('G4', 'E4', 'E4', 'C4'), line('D4', 'C4', 'D4', 'E4'), line('C4', 'A3', 'A3', 'G3'), [[0, 'C4']]];
  const chords = ['C', 'G', 'C', 'F', 'C', 'G', 'F', 'C'];
  put(song, 6, ...N.G3);
  [...verse, ...chorus].forEach((notes, i) => {
    const o = (1 + i) * 8, [bass, inner, other] = CHORD[chords[i % 8]];
    for (const [st, n, t] of notes) put(song, o + st, ...N[n], t || '');
    put(song, o, ...bass, i % 8 === 0 ? '>' : '');
    put(song, o + 2, ...inner);
    // the seventh bar goes to G on its last beat
    put(song, o + 4, ...(i % 8 === 6 ? CHORD.G[0] : other));
  });
  shape(song, 16 * 8, [-1, 3, 2, 0, 1, 0]);
  bar(song, 17, [[0, 3, 12, '*'], [2, 4, 12, '*'], [4, 5, 12, '*']]);
  return song;
}

// Nylon, fingers, in three: two voices, the tune with a pull-off and a hammer-on here
// and there.
function minuet() {
  const song = make('Minuet in G (C. Petzold)', 108, 2, 3, 17, { preset: 'nylon' }, { ...ROOM, vol: 0.65 });
  const N = { 'F#3': [2, 4], G3: [3, 0], A3: [3, 2], B3: [4, 0], C4: [4, 1], D4: [4, 3], E4: [5, 0], 'F#4': [5, 2], G4: [5, 3] };
  const B = { 'F#2': [0, 2], G2: [0, 3], A2: [1, 0], B2: [1, 2], C3: [1, 3], D3: [2, 0], d3: [1, 5] }; // d3: D on the A string
  // a quarter and four eighths; three quarters
  const run = (a, b, c, d, e) => [[0, a], [2, b], [3, c], [4, d], [5, e]], three = (a, b, c) => [[0, a], [2, b], [4, c]];
  const first = [run('D4', 'G3', 'A3', 'B3', 'C4'), three('D4', 'G3', 'G3'), run('E4', 'C4', 'D4', 'E4', 'F#4'), three('G4', 'G3', 'G3'),
    run('C4', 'D4', 'C4', 'B3', 'A3'), run('B3', 'C4', 'B3', 'A3', 'G3')];
  const tune = [...first, run('F#3', 'G3', 'A3', 'B3', 'G3'), [[0, 'A3']], ...first, run('A3', 'B3', 'A3', 'G3', 'F#3'), [[0, 'G3']]];
  const bass = [
    [[0, 'G2'], [4, 'A2']], [[0, 'B2']], [[0, 'C3']], [[0, 'B2']], [[0, 'A2']], [[0, 'G2']], [[0, 'd3'], [2, 'B2'], [4, 'G2']], [[0, 'D3'], [2, 'A2'], [4, 'D3']],
    [[0, 'B2'], [4, 'A2']], [[0, 'G2'], [2, 'B2'], [4, 'G2']], [[0, 'C3']], [[0, 'B2'], [2, 'C3'], [3, 'B2'], [4, 'A2'], [5, 'G2']],
    [[0, 'A2'], [4, 'F#2']], [[0, 'G2'], [4, 'B2']], [[0, 'C3'], [2, 'D3'], [4, 'd3']], [[0, 'G2']],
  ];
  // ornaments: [bar, step, flags]
  const marks = { '0:0': '>', '2:5': 'h', '4:3': 'h', '8:0': '>', '10:5': 'h', '12:3': 'h' };
  tune.forEach((notes, i) => { for (const [st, n] of notes) put(song, i * 6 + st, ...N[n], marks[`${i}:${st}`] || ''); });
  bass.forEach((notes, i) => { for (const [st, n] of notes) put(song, i * 6 + st, ...B[n]); });
  bar(song, 15, [[0, 2, 0], [0, 4, 0]]);
  bar(song, 16, [[0, 2, 12, '*'], [2, 3, 12, '*'], [4, 4, 12, '*']]);
  return song;
}

// Steel with a capo, fingers: the thumb keeps two palm-muted bass strings going, the fingers
// play between its beats. A ragtime round of chords, twice.
function backPorchRag() {
  const song = make('Back Porch Rag', 138, 2, 4, 31, { preset: 'steel', picking: 3 }, { ...ROOM, vol: 1 });
  song.capo = 2;
  // frets, the thumb's two strings, and the fingers' notes [string, fret] in each half of the bar
  const C = [[-1, 3, 2, 0, 1, 0], 1, 2, [5, 0], [4, 1], [5, 3], [3, 0]], E7 = [[0, 2, 0, 1, 0, 0], 0, 1, [5, 0], [3, 1], [4, 3], [4, 0]];
  const A7 = [[-1, 0, 2, 0, 2, 0], 1, 2, [5, 0], [4, 2], [5, 3], [3, 0]], D7 = [[-1, -1, 0, 2, 1, 2], 2, 3, [5, 2], [4, 1], [5, 2], [4, 1]];
  const G7 = [[3, 2, 0, 0, 0, 1], 0, 2, [5, 1], [4, 0], [5, 1], [3, 0]], C7 = [[-1, 3, 2, 3, 1, 0], 1, 2, [5, 0], [3, 3], [4, 1], [3, 3]];
  const F = [[1, 3, 3, 2, 1, 1], 0, 2, [5, 1], [4, 1], [5, 1], [3, 2]], Fm = [[1, 3, 3, 1, 1, 1], 0, 2, [5, 1], [4, 1], [5, 1], [3, 1]];
  // half a bar: the thumb on the beats; a pinch and a note after the second beat, or two notes off the beat
  const half = (o, [sh, b, a, t1, m1, t2, m2], second, accent) => {
    put(song, o, b, sh[b], accent ? 'm>' : 'm');
    put(song, o + 2, a, sh[a], 'm');
    put(song, o + (second ? 1 : 0), ...(second ? t2 : t1));
    put(song, o + 3, ...(second ? m2 : m1));
  };
  const round = [[C], [C], [E7], [E7], [A7], [A7], [D7], [G7], [C], [C7], [F], [Fm], [C, A7], [D7, G7], [C]];
  for (const at of [0, 15]) round.forEach(([a, b], i) => { half((at + i) * 8, a, false, i === 0); half((at + i) * 8 + 4, b || a, !b, false); });
  shape(song, 30 * 8, [-1, 3, 2, 0, 1, 0]);
  put(song, 30 * 8, 1, 3, '>');
  bar(song, 30, [[4, 3, 12, '*'], [5, 4, 12, '*'], [6, 5, 12, '*']]);
  return song;
}

// Steel, a pick. The tune on the bass strings with a brush over the top strings after every
// long note; then once more an octave up, in alternate picking.
function ohSusanna() {
  const song = make('Oh! Susanna (S. Foster)', 184, 2, 4, 27, { preset: 'steel', picking: 0 }, ROOM);
  const LOW = { C: [1, 3], D: [2, 0], E: [2, 2], F: [2, 3], G: [3, 0], A: [3, 2] }, HIGH = { C: [4, 1], D: [4, 3], E: [5, 0], F: [5, 1], G: [5, 3], A: [5, 5] };
  const BRUSH = { C: [0, 1, 0], F: [2, 1, 1], G: [0, 0, 3] }; // the three top strings
  // [step, note] per bar
  const a1 = [[0, 'E'], [2, 'G'], [4, 'G'], [7, 'A']], a2 = [[0, 'G'], [2, 'E'], [4, 'C'], [7, 'D']];
  const verse = [a1, a2, [[0, 'E'], [2, 'E'], [4, 'D'], [6, 'C']], [[0, 'D'], [6, 'C'], [7, 'D']], a1, a2, [[0, 'E'], [2, 'E'], [4, 'D'], [6, 'D']], [[0, 'C']]];
  const chorus = [[[0, 'F'], [4, 'F']], [[0, 'A'], [2, 'A'], [6, 'A']], [[0, 'G'], [2, 'G'], [4, 'E'], [6, 'C']], [[0, 'D'], [6, 'C'], [7, 'D']], ...verse.slice(4)];
  const chords = { verse: ['C', 'C', 'C', 'G', 'C', 'C', 'C', 'C'], chorus: ['F', 'F', 'C', 'G', 'C', 'C', 'C', 'C'] };
  const play = (at, bars, where, harmony) => bars.forEach((notes, i) => {
    const o = (at + i) * 8, taken = new Set(notes.map(([st]) => st));
    for (const [st, n] of notes) put(song, o + st, ...where[n]);
    // a brush on every off-beat that the tune leaves free
    if (harmony) for (const st of [1, 3, 5, 7]) if (!taken.has(st)) BRUSH[harmony[i]].forEach((f, k) => put(song, o + st, 3 + k, f));
  });
  bar(song, 0, [[6, ...LOW.C], [7, ...LOW.D]]);
  play(1, verse, LOW, chords.verse);
  play(9, chorus, LOW, chords.chorus);
  // the two notes that lead into the tune an octave up, in place of the last brush
  for (const s of [3, 4, 5]) setCell(song, 16 * 8 + 7, s, null);
  bar(song, 16, [[6, ...HIGH.C], [7, ...HIGH.D]]);
  play(17, verse, HIGH, null);
  // the first note of the tune is hammered on from the note before it
  for (const at of [1, 5, 13]) put(song, at * 8, 2, 2, 'h');
  bar(song, 0, [[6, 1, 3, '>']]);
  shape(song, 25 * 8, [-1, 3, 2, 0, 1, 0]);
  put(song, 25 * 8, 1, 3, '>');
  shape(song, 25 * 8 + 4, [-1, 3, 2, 0, 1, 0]);
  shape(song, 26 * 8, [-1, 3, 2, 0, 1, 0]);
  put(song, 26 * 8, 1, 3, '>');
  return song;
}

// Steel, a pick, sixteenths: a bass note, then strums down and up with a dead-note chop on
// the third beat; the top two strings ring through all four chords.
function openRoad() {
  const song = make('Open Road', 96, 4, 4, 17, { preset: 'steel', picking: 0, strum: 12 }, ROOM);
  const G = [3, 2, 0, 0, 3, 3], D = [-1, -1, 0, 2, 3, 2], Em = [0, 2, 2, 0, 3, 3], C9 = [-1, 3, 2, 0, 3, 3], Ds = [-1, -1, 0, 2, 3, 3];
  const strummed = (n, c, { lift, last } = {}) => {
    const o = n * 16, b = lowest(c);
    put(song, o, b, c[b], n % 4 === 0 ? '>' : '');
    shape(song, o + 4, c, '', b + 1);
    shape(song, o + 6, c, '', 3);
    for (const s of [1, 2, 3, 4]) put(song, o + 8, s, 'x');
    shape(song, o + 10, lift || c, '', 3);
    shape(song, o + 12, c, '', b + 1);
    if (!last) shape(song, o + 14, c, '', 3);
  };
  const verse = [G, D, Em, C9];
  for (const at of [0, 4, 12]) verse.forEach((c, i) => strummed(at + i, c, { lift: c === D ? Ds : null }));
  [C9, D, Em, D].forEach((c, i) => strummed(8 + i, c, { lift: c === D ? Ds : null, last: i === 3 }));
  // into the last verse: the top strings stop, the bass walks up
  bar(song, 11, [[13, 2, '.'], [13, 3, '.'], [13, 4, '.'], [13, 5, '.'], [14, 0, 0], [15, 0, 2]]);
  shape(song, 16 * 16, G);
  put(song, 16 * 16, 0, 3, '>');
  bar(song, 16, [[8, 3, 12, '*'], [10, 4, 12, '*'], [12, 5, 12, '*']]);
  return song;
}

// name, what it shows (for the menu), and the song
export const DEMOS = [
  { name: 'Daybreak', about: 'Steel-string fingerstyle: hammer-ons, slides, harmonics', make: daybreak },
  { name: 'Andaluza', about: 'Nylon: strums, thumb melody, runs', make: andaluza },
  { name: 'Drunken Sailor', about: 'Drop D: palm mutes, power chords, scratches', make: drunkenSailor },
  { name: 'Back Porch Rag', about: 'Travis picking with a capo: thumb and fingers', make: backPorchRag },
  { name: 'Sakura', about: 'Like a koto: bends, vibrato, half a step down', make: sakura },
  { name: 'Glass Harbour', about: '12-string with a capo: broken chords in 6/8', make: glassHarbour },
  { name: 'Oh! Susanna', about: 'Flatpicking: a tune on the bass strings, brushes above', make: ohSusanna },
  { name: 'Lowland Blues', about: 'Open G, pick and fingers: slides, bends, swing', make: lowlandBlues },
  { name: 'Minuet in G', about: 'Nylon in two voices', make: minuet },
  { name: 'Open Road', about: 'Strumming in sixteenths: chops and ringing strings', make: openRoad },
  { name: 'Auld Lang Syne', about: 'Nylon: tune, bass and chord notes', make: auldLangSyne },
  { name: 'Standing Stones', about: 'DADGAD: an air and its harmonics', make: standingStones },
];
