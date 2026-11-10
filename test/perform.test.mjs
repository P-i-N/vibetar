import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/song.js';

const song = (preset, picking, human = 0) => {
  const s = S.newSong();
  s.inst = { ...S.INSTRUMENTS[preset], human, fingerNoise: 0 };
  if (picking != null) s.inst.picking = picking;
  return s;
};
const notes = (s, from, to, perf) => S.songEvents(s, from, to, 0, perf.rnd, perf).filter((e) => e.type === 'n');

test('instruments have a default picking technique', () => {
  assert.deepEqual(S.PICKING, ['pick', 'flesh', 'nailS', 'nailL', 'hybrid']);
  assert.equal(S.INSTRUMENTS.steel.picking, 0);
  assert.equal(S.INSTRUMENTS.twelve.picking, 0);
  assert.equal(S.INSTRUMENTS.nylon.picking, 2);
});

test('thumb takes the bass strings, fingers alternate on the trebles', () => {
  const s = song('nylon', 2);
  for (let i = 0; i < 4; i++) { S.setCell(s, i * 2, 5, { f: 3 + i, t: '' }); S.setCell(s, i * 2 + 1, 1, { f: 2, t: '' }); }
  const ev = notes(s, 0, 8, S.newPerformer(1));
  const bass = ev.filter((e) => e.s === 1), treble = ev.filter((e) => e.s === 5);
  assert.ok(bass.every((e) => e.fg === 4 && e.fi === 0), 'bass notes are thumb strokes');
  assert.ok(treble.every((e) => e.fg === 2 && e.fi >= 1 && e.fi <= 3), 'treble notes use the nails');
  for (let i = 1; i < treble.length; i++) assert.notEqual(treble[i].fi, treble[i - 1].fi, 'same finger twice in a row');
});

test('a chord gets one finger per string', () => {
  const s = song('nylon', 1);
  [[0, 0], [3, 0], [4, 1], [5, 0]].forEach(([st, f]) => S.setCell(s, 0, st, { f, t: '' }));
  const ev = notes(s, 0, 1, S.newPerformer(1));
  assert.equal(new Set(ev.map((e) => e.fi)).size, 4);
  assert.equal(ev.find((e) => e.s === 0).fi, 0);
});

test('pick alternates in runs and plays down on the beat', () => {
  const s = song('steel', 0);
  for (let i = 0; i < 8; i++) S.setCell(s, i, 4, { f: 3, t: '' });
  const ev = notes(s, 0, 8, S.newPerformer(1));
  assert.deepEqual(ev.map((e) => e.d), [1, -1, 1, -1, 1, -1, 1, -1]);
  assert.ok(ev.every((e) => e.fg === 0));
  assert.ok(ev[1].v < ev[2].v, 'up-strokes are a little weaker');
});

test('slow single notes are all down-strokes', () => {
  const s = song('steel', 0);
  s.bpm = 60;
  for (let i = 0; i < 4; i++) S.setCell(s, i * 2 + 1, 4, { f: 3, t: '' });
  assert.deepEqual(notes(s, 0, 8, S.newPerformer(1)).map((e) => e.d), [1, 1, 1, 1]);
});

test('hybrid: pick below, nails above', () => {
  const s = song('steel', 4);
  for (let st = 0; st < 6; st++) S.setCell(s, st * 2, st, { f: 2, t: '' });
  const ev = notes(s, 0, 12, S.newPerformer(1));
  assert.deepEqual(ev.map((e) => e.fg), [0, 0, 0, 2, 2, 2]);
});

test('accents are rest strokes', () => {
  const s = song('nylon', 2);
  S.setCell(s, 0, 5, { f: 3, t: '>' }); S.setCell(s, 2, 5, { f: 3, t: '' });
  const ev = notes(s, 0, 4, S.newPerformer(1));
  assert.equal(ev[0].rs, true);
  assert.ok(!ev[1].rs);
});

test('humanize 0 is deterministic', () => {
  const s = song('nylon', 2, 0);
  for (let i = 0; i < 32; i++) S.setCell(s, i, 3 + (i % 3), { f: i % 5, t: '' });
  const a = notes(s, 0, 32, S.newPerformer(5)), b = notes(s, 0, 32, S.newPerformer(99));
  assert.deepEqual(a, b);
  assert.ok(a.every((e) => !e.pp));
  const stepDur = 60 / s.bpm / s.spb;
  a.forEach((e, i) => assert.ok(Math.abs(e.t - i * stepDur) < 1e-9));
});

test('with humanize, timing and loudness drift slowly inside their limits', () => {
  const s = song('steel', 0, 1);
  s.bars = 25; s.cols = S.emptyCols(S.totalSteps(s));
  for (let i = 0; i < 400; i++) S.setCell(s, i, 4, { f: 3, t: '' });
  const ev = notes(s, 0, 400, S.newPerformer(3));
  const stepDur = 60 / s.bpm / s.spb;
  const off = ev.map((e, i) => e.t - i * stepDur);
  assert.ok(off.every((o) => Math.abs(o) <= 0.008), `max offset ${Math.max(...off.map(Math.abs))}`);
  assert.ok(off.some((o) => Math.abs(o) > 0.001), 'no drift at all');
  const mean = off.reduce((a, b) => a + b) / off.length;
  let num = 0, den = 0;
  for (let i = 0; i < off.length; i++) { den += (off[i] - mean) ** 2; if (i) num += (off[i] - mean) * (off[i - 1] - mean); }
  assert.ok(num / den > 0.5, `lag-1 autocorrelation ${num / den}`);
  // same position in the bar, same stroke direction: only the performer's drift differs
  const down = ev.filter((e, i) => i % 16 === 4).map((e) => e.v);
  assert.ok(Math.max(...down) / Math.min(...down) < 1.5 && Math.max(...down) / Math.min(...down) > 1.02);
  assert.ok(ev.every((e) => Math.abs(e.pp || 0) <= 4));
  assert.ok(ev.some((e) => Math.abs(e.pp || 0) > 0.5));
});

test('old links get the instrument default; picking round-trips', async () => {
  const old = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3', i: ['nylon', 0.2, 0.5, 0, 0, 0.9, 0.3, 18, 0.35, 1], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.equal(old.inst.picking, 2);
  const s = song('steel', 3);
  assert.equal((await S.decodeSong(await S.encodeSong(s))).inst.picking, 3);
});

test('a note right after another on its string tells the engine how little time the stroke has', () => {
  const s = song('steel', 0);
  s.bpm = 300; s.spb = 6; s.cols = S.emptyCols(S.totalSteps(s));   // 33 ms per step
  S.setCell(s, 0, 4, { f: 3, t: '' }); S.setCell(s, 1, 4, { f: 5, t: '' }); S.setCell(s, 20, 4, { f: 5, t: '' });
  const ev = notes(s, 0, 24, S.newPerformer(1));
  assert.ok(Math.abs(ev[1].gap - 60 / 300 / 6) < 1e-6);
  assert.ok(!ev[0].gap && !ev[2].gap);
});
