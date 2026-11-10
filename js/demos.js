// Demo songs: each shows some of what the instrument can do.

import { newSong, emptyCols, setCell, INSTRUMENTS, FX_DEFAULTS } from './song.js';

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

export const DEMOS = [
  { name: 'First Light — fingerstyle steel', make: firstLight },
  { name: 'Romance — classical nylon', make: romance },
  { name: 'Campfire — 12-string strumming', make: campfire },
  { name: 'Night Drive — palm mutes, harmonics', make: nightDrive },
];
