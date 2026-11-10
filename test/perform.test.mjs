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
  assert.equal(S.INSTRUMENTS.nylon.picking, 3);
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
  // looped: without the slowing at the end
  const ev = notes(s, 0, 400, Object.assign(S.newPerformer(3), { loop: true }));
  const stepDur = 60 / s.bpm / s.spb;
  const off = ev.map((e, i) => e.t - i * stepDur);
  // drift 25 ms, note scatter 4 ms, and a four-bar phrase up to 0.4 % of its length ahead
  const limit = 0.025 + 0.004 + 0.004 * 64 * stepDur;
  assert.ok(off.every((o) => Math.abs(o) <= limit), `max offset ${Math.max(...off.map(Math.abs))}`);
  assert.ok(off.some((o) => Math.abs(o) > 0.005), 'no drift at all');
  const mean = off.reduce((a, b) => a + b) / off.length;
  let num = 0, den = 0;
  for (let i = 0; i < off.length; i++) { den += (off[i] - mean) ** 2; if (i) num += (off[i] - mean) * (off[i - 1] - mean); }
  assert.ok(num / den > 0.5, `lag-1 autocorrelation ${num / den}`);
  // same position in the bar, same stroke direction: only the performer's drift differs
  const down = ev.filter((e, i) => i % 16 === 4).map((e) => e.v);
  assert.ok(Math.max(...down) / Math.min(...down) < 2.3 && Math.max(...down) / Math.min(...down) > 1.1);
  assert.ok(ev.every((e) => Math.abs(e.pp || 0) <= 4));
  assert.ok(ev.some((e) => Math.abs(e.pp || 0) > 0.5));
});

test('old links get the instrument default; picking round-trips', async () => {
  const old = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3', i: ['nylon', 0.2, 0.5, 0, 0, 0.9, 0.3, 18, 0.35, 1], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.equal(old.inst.picking, 3);
  // flesh and short nails are no longer in the panel; a link that has them keeps them
  for (const picking of [1, 2, 3, 4]) assert.equal((await S.decodeSong(await S.encodeSong(song('steel', picking)))).inst.picking, picking);
});

test('a note right after another on its string tells the engine how little time the stroke has', () => {
  const s = song('steel', 0);
  s.bpm = 300; s.spb = 6; s.cols = S.emptyCols(S.totalSteps(s));   // 33 ms per step
  S.setCell(s, 0, 4, { f: 3, t: '' }); S.setCell(s, 1, 4, { f: 5, t: '' }); S.setCell(s, 20, 4, { f: 5, t: '' });
  const ev = notes(s, 0, 24, S.newPerformer(1));
  assert.ok(Math.abs(ev[1].gap - 60 / 300 / 6) < 1e-6);
  assert.ok(!ev[0].gap && !ev[2].gap);
});

test('the Humanize switch plays the song as written, and keeps the amount', async () => {
  const s = song('steel', 0, 1);
  for (let i = 0; i < 32; i++) S.setCell(s, i, 3 + (i % 3), { f: i % 5, t: '' });
  s.inst.humanOn = 0;
  const off = notes(s, 0, 32, S.newPerformer(5));
  s.inst.human = 0; s.inst.humanOn = 1;
  assert.deepEqual(off, notes(s, 0, 32, S.newPerformer(99)));
  s.inst.human = 0.7; s.inst.humanOn = 0;
  const back = await S.decodeSong(await S.encodeSong(s));
  assert.equal(back.inst.humanOn, 0);
  assert.equal(back.inst.human, 0.7);
  assert.equal(S.humanOf(back.inst), 0);
  // a link from before the switch has it on
  const old = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3', i: ['steel', 0.17, 0.72, 0, 0, 0.85, 0.3, 14, 0.4, 1, 0.5, 3, 0, 0.6], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.equal(S.humanOf(old.inst), 0.4);
});

test('the song slows into its last note, but not when it is looped', () => {
  const s = song('steel', 0, 0.5);
  for (let i = 0; i < 8 * 16; i += 4) S.setCell(s, i, 4, { f: 3, t: '' });
  const stepDur = 60 / s.bpm / s.spb, lastStep = 8 * 16 - 4;
  const late = (perf) => notes(s, 0, 8 * 16, perf).at(-1).t - lastStep * stepDur;
  const lates = [1, 2, 3, 4, 5, 6].map((seed) => late(S.newPerformer(seed)));
  const mean = lates.reduce((a, b) => a + b) / lates.length;
  assert.ok(mean > 0.04 && mean < 0.13, `the last note is ${mean.toFixed(3)} s late`);
  const looped = [1, 2, 3, 4, 5, 6].map((seed) => late(Object.assign(S.newPerformer(seed), { loop: true })));
  assert.ok(Math.abs(looped.reduce((a, b) => a + b) / looped.length) < 0.02);
});

test('of two notes plucked together the upper one is brought out', () => {
  const s = song('steel', 0, 1);
  for (let i = 0; i < 128; i += 2) { S.setCell(s, i, 1, { f: 3, t: '' }); S.setCell(s, i, 4, { f: 1, t: '' }); }
  const ev = notes(s, 0, 128, Object.assign(S.newPerformer(2), { loop: true }));
  const mean = (str) => { const v = ev.filter((e) => e.s === str).map((e) => e.v); return v.reduce((a, b) => a + b) / v.length; };
  assert.ok(mean(4) / mean(1) > 1.08, `upper / lower loudness ${(mean(4) / mean(1)).toFixed(3)}`);
});

test('in an arpeggio every treble string has its finger; along one string index and middle alternate', () => {
  const s = song('nylon', 2);
  // bass, then G B e B G: p i m a m i
  [[0, 1], [1, 3], [2, 4], [3, 5], [4, 4], [5, 3]].forEach(([st, str]) => S.setCell(s, st, str, { f: 0, t: '' }));
  assert.deepEqual(notes(s, 0, 8, S.newPerformer(1)).map((e) => e.fi), [0, 1, 2, 3, 2, 1]);
  const run = song('nylon', 2);
  for (let i = 0; i < 6; i++) S.setCell(run, i, 5, { f: i, t: '' });
  assert.deepEqual(notes(run, 0, 8, S.newPerformer(1)).map((e) => e.fi), [3, 1, 2, 1, 2, 1]);
  // a line that changes string never uses one finger twice in a row
  const line = song('nylon', 2);
  [3, 3, 4, 4, 5, 4, 3, 5, 5, 4].forEach((str, i) => S.setCell(line, i, str, { f: 2, t: '' }));
  const fi = notes(line, 0, 16, S.newPerformer(1)).map((e) => e.fi);
  for (let i = 1; i < fi.length; i++) assert.notEqual(fi[i], fi[i - 1], `fingers ${fi}`);
});

test('the thumb brushing over the bass strings of a chord is one stroke', () => {
  const s = song('nylon', 1);
  [[0, 0], [1, 2], [2, 2], [3, 1]].forEach(([str, f]) => S.setCell(s, 0, str, { f, t: '' }));
  const ev = notes(s, 0, 1, S.newPerformer(1));
  const v = (str) => ev.find((e) => e.s === str).v;
  // only the fall-off of the strum from string to string is left
  assert.ok(Math.abs(v(1) / v(0) - 0.975) < 1e-9 && Math.abs(v(2) / v(0) - 0.95) < 1e-9, `${v(1) / v(0)}, ${v(2) / v(0)}`);
});

test('a hammer-on is as strong as its finger; a pull-off as the finger that leaves', () => {
  const line = (frets, flags) => {
    const s = song('steel', 0);
    frets.forEach((f, i) => S.setCell(s, 2 * i, 4, { f, t: i ? flags : '' }));
    return notes(s, 0, 2 * frets.length, S.newPerformer(1));
  };
  // from the index finger at fret 5: the little finger hammers fret 8, the middle finger fret 6
  const little = line([5, 8], 'h')[1], middle = line([5, 6], 'h')[1];
  assert.equal(little.ff, 4);
  assert.equal(middle.ff, 2);
  assert.ok(Math.abs(little.v / middle.v - 0.85) < 1e-9);
  // the pull-off back to fret 5 is played by the little finger that leaves fret 8
  const legato = line([5, 8, 5], 'h'), plucked = line([5, 8, 5], '');
  assert.equal(legato[2].ff, 1);
  assert.ok(Math.abs(legato[2].v / plucked[2].v - 0.85) < 1e-9, `pull-off ${legato[2].v}, plucked ${plucked[2].v}`);
});

test('with humanize no string is exactly in tune and fretted notes are a little sharp', () => {
  const s = song('steel', 0, 1);
  for (let i = 0; i < 64; i++) S.setCell(s, i, i % 6, { f: i % 2 ? 3 : 0, t: '' });
  const ev = notes(s, 0, 64, Object.assign(S.newPerformer(4), { loop: true }));
  const cents = ev.map((e) => 1200 * Math.log2(e.f / S.midiHz(s.tuning[e.s] + (e.fr ? 3 : 0))));
  assert.ok(cents.every((c) => Math.abs(c) < 4.5), `largest ${Math.max(...cents.map(Math.abs)).toFixed(2)} cents`);
  const open = ev.map((e, i) => (e.fr ? null : cents[i])).filter((c) => c != null);
  assert.ok(new Set(open.map((c) => c.toFixed(6))).size <= 6, 'an open string keeps its pitch through the song');
  const meanOf = (a) => a.reduce((x, y) => x + y) / a.length;
  assert.ok(meanOf(cents.filter((c, i) => ev[i].fr)) > meanOf(open) + 0.6);
});
