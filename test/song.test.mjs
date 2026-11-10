import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/song.js';

const blank = () => { const s = S.newSong(); s.inst.human = 0; return s; };

test('technique flags combine and exclude each other sensibly', () => {
  assert.equal(S.toggleFlag('', 'm'), 'm');
  assert.equal(S.toggleFlag('m', 'm'), '');
  assert.equal(S.toggleFlag('m', 'h'), 'mh');
  assert.equal(S.toggleFlag('mh', 's'), 'ms');
  assert.equal(S.toggleFlag('mb', 'v'), 'mv');
  assert.equal(S.toggleFlag('h', '>'), 'h>');
  assert.equal(S.toggleFlag('mh>', '*'), '>*');
  assert.equal(S.toggleFlag('>*', 'm'), 'm>');
  assert.equal(S.toggleFlag('v', 'm'), 'mv');
});

test('songs with combined techniques survive the link round trip', async () => {
  const song = blank();
  S.setCell(song, 0, 0, { f: 3, t: 'm>' });
  S.setCell(song, 1, 0, { f: 5, t: 'mh' });
  S.setCell(song, 2, 3, { f: 12, t: '*' });
  S.setCell(song, 3, 2, { f: 'x', t: '' });
  song.inst.fingerNoise = 0.55;
  const back = await S.decodeSong(await S.encodeSong(song));
  assert.deepEqual(back.cols.slice(0, 4), song.cols.slice(0, 4));
  assert.equal(back.inst.fingerNoise, 0.55);
});

test('links made before combined techniques still load', () => {
  const song = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3hB2,,C12*F0>,Ax,E.', i: ['steel', 0.17, 0.72, 0, 0, 0.85, 0.3, 14, 0.35, 1], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.deepEqual(song.cols[0], [{ f: 3, t: 'h' }, { f: 2, t: '' }, null, null, null, null]);
  assert.deepEqual(song.cols[2][2], { f: 12, t: '*' });
  assert.deepEqual(song.cols[2][5], { f: 0, t: '>' });
  assert.equal(song.cols[3][0].f, 'x');
  assert.equal(song.cols[4][4].f, '.');
  assert.equal(song.inst.fingerNoise, S.INSTRUMENTS.steel.fingerNoise);
});

test('a harmonic is an open string touched at the marked fret', () => {
  const song = blank();
  const ev = S.cellEvent(song, 3, { f: 12, t: '*' }, 1, 0.8, 1);
  assert.equal(ev.k, '*');
  assert.ok(Math.abs(ev.f - S.midiHz(55)) < 1e-9);
  assert.ok(Math.abs(ev.hb - 0.5) < 1e-9);
  assert.equal(ev.fr, false);
  song.capo = 2;
  assert.ok(Math.abs(S.cellEvent(song, 3, { f: 7, t: '*' }, 1, 0.8, 1).f - S.midiHz(57)) < 1e-9);
});

test('palm mute and other flags reach the engine together', () => {
  const song = blank();
  assert.equal(S.cellEvent(song, 0, { f: 3, t: 'mh>' }, 0, 0.8, 1).k, 'mh');
});

test('a position shift lifts the finger just before the note and often squeaks', () => {
  const song = blank();
  song.inst.fingerNoise = 1;
  S.setCell(song, 0, 1, { f: 3, t: '' });
  S.setCell(song, 4, 1, { f: 8, t: '' });
  let squeaks = 0;
  for (let i = 0; i < 200; i++) {
    const evs = S.stepEvents(song, 4, 10, Math.random);
    const q = evs.find((e) => e.type === 'q'), n = evs.find((e) => e.type === 'n');
    assert.ok(q, 'the finger always has to travel');
    assert.equal(q.s, 1);
    assert.ok(q.t < n.t && q.t + q.dur <= n.t + 1e-9 && q.t > n.t - 0.4);
    assert.ok(q.amt >= 0 && q.amt <= 1);
    if (q.amt > 0) squeaks++;
  }
  assert.ok(squeaks > 60 && squeaks < 200, `${squeaks} squeaks in 200 plays`);
  song.inst.fingerNoise = 0;
  for (let i = 0; i < 50; i++) assert.equal(S.stepEvents(song, 4, 10, Math.random).find((e) => e.type === 'q').amt, 0);
});

test('a chord shape moving along the neck takes every finger with it', () => {
  const song = blank();
  for (const [st, f] of [[0, 3], [4, 5]]) { S.setCell(song, st, 0, { f, t: '' }); S.setCell(song, st, 1, { f: f + 2, t: '' }); S.setCell(song, st, 2, { f: f + 2, t: '' }); }
  const q = S.stepEvents(song, 4, 10, Math.random).filter((e) => e.type === 'q');
  assert.deepEqual(q.map((e) => e.s).sort(), [0, 1, 2]);
});

test('fast passages are not cut short by the travelling finger', () => {
  const song = blank();
  song.bpm = 160;
  S.setCell(song, 0, 1, { f: 3, t: '' });
  S.setCell(song, 1, 1, { f: 10, t: '' });
  const q = S.stepEvents(song, 1, 10, Math.random).find((e) => e.type === 'q');
  assert.ok(q.dur <= 0.4 * (60 / 160 / 4) + 1e-9);
});

test('no finger travel without a real shift', () => {
  const song = blank();
  song.inst.fingerNoise = 1;
  const none = (setup) => {
    const s = structuredClone(song);
    setup(s);
    for (let i = 0; i < 100; i++) assert.ok(!S.stepEvents(s, 4, 10, Math.random).some((e) => e.type === 'q'));
  };
  none((s) => { S.setCell(s, 0, 1, { f: 3, t: '' }); S.setCell(s, 4, 1, { f: 3, t: '' }); });   // same fret
  none((s) => { S.setCell(s, 0, 1, { f: 0, t: '' }); S.setCell(s, 4, 1, { f: 7, t: '' }); });   // from open
  none((s) => { S.setCell(s, 0, 5, { f: 5, t: '' }); S.setCell(s, 4, 5, { f: 7, t: '' }); });   // another finger reaches it
  none((s) => { S.setCell(s, 0, 1, { f: 3, t: '' }); S.setCell(s, 4, 1, { f: 8, t: 'h' }); });  // hammer-on
  none((s) => { S.setCell(s, 4, 1, { f: 8, t: '' }); });                                          // nothing before
  none((s) => { s.inst.preset = 'bowed'; S.setCell(s, 0, 1, { f: 3, t: '' }); S.setCell(s, 4, 1, { f: 8, t: '' }); });
});

test('palm mute runs are found for the P.M. brackets', () => {
  const song = blank();
  S.setCell(song, 0, 0, { f: 0, t: 'm' });
  S.setCell(song, 2, 0, { f: 0, t: 'm' });
  S.setCell(song, 4, 0, { f: 3, t: 'm>' });
  S.setCell(song, 6, 0, { f: 5, t: '' });
  S.setCell(song, 8, 1, { f: 5, t: 'm' });
  S.setCell(song, 8, 0, { f: 3, t: '' });
  assert.deepEqual(S.palmMuteRuns(song), [[0, 4], [8, 8]]);
});

test('the body model setting defaults to modelled and survives the link', async () => {
  assert.equal(S.INSTRUMENTS.steel.bodyModel, 1);
  assert.equal(S.INSTRUMENTS.nylon.bodyModel, 1);
  assert.equal(S.INSTRUMENTS.bowed.bodyModel, 0);
  const song = S.newSong();
  song.inst.bodyModel = 0;
  assert.equal((await S.decodeSong(await S.encodeSong(song))).inst.bodyModel, 0);
  const old = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3', i: ['steel', 0.17, 0.72, 0, 0, 0.85, 0.3, 14, 0.35, 1], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.equal(old.inst.bodyModel, 1);
});

test('string coupling is its own setting; the classic junction keeps its own', async () => {
  const song = S.newSong();
  assert.equal(song.inst.symp, 0.3);
  song.inst.coupling = 0.75; song.inst.symp = 0.1;
  const back = await S.decodeSong(await S.encodeSong(song));
  assert.equal(back.inst.coupling, 0.75);
  assert.equal(back.inst.symp, 0.1);
  // a link from before the setting existed gets the instrument's default, and keeps its old sympathetic value
  const old = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3', i: ['nylon', 0.2, 0.5, 0, 0, 0.9, 0.3, 18, 0.35, 1], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.equal(old.inst.coupling, S.INSTRUMENTS.nylon.coupling);
  assert.equal(old.inst.symp, 0.3);
});
