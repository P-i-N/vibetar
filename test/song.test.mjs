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

// share of plays of a step that make a finger squeak, and the squeak events
function squeaks(song, step, plays = 300) {
  let n = 0;
  const evs = [];
  for (let i = 0; i < plays; i++) {
    const q = S.stepEvents(song, step, 10, Math.random).filter((e) => e.type === 'q' && e.amt > 0);
    if (q.length) { n++; evs.push(...q); }
  }
  return { share: n / plays, evs };
}

test('the hand moving to another string lifts the note it held and may squeak on that string', () => {
  const song = blank();
  song.inst.fingerNoise = 1;
  S.setCell(song, 0, 1, { f: 3, t: '' });   // A string, 3rd fret
  S.setCell(song, 4, 4, { f: 10, t: '' });  // then up the neck on the B string
  const { share, evs } = squeaks(song, 4);
  assert.ok(share > 0.5, `${(100 * share).toFixed(0)} % of plays squeak`);
  assert.ok(evs.every((e) => e.s === 1 && !e.nl), 'the finger slides along the A string, which stops sounding');
  const n = S.stepEvents(song, 4, 10, Math.random).find((e) => e.type === 'n');
  assert.ok(evs.every((e) => e.t + e.dur <= n.t + 1e-9 && e.t > n.t - 0.4));
});

test('changing chords in one position is quiet in a running passage, may squeak after a long chord', () => {
  const song = blank();
  song.inst.fingerNoise = 1;
  const C = [-1, 3, 2, 0, 1, 0], G = [3, 2, 0, 0, 0, 3];
  const chord = (st, sh) => sh.forEach((f, s) => f >= 0 && S.setCell(song, st, s, { f, t: '' }));
  chord(0, C); chord(2, G); chord(4, C); chord(6, G);   // eighth-note changes
  for (const st of [2, 4, 6]) assert.equal(squeaks(song, st).share, 0, `step ${st}`);
  chord(16, C); chord(32, G);                           // a C held for a bar
  const { share, evs } = squeaks(song, 32);
  assert.ok(share > 0.1 && share < 0.6, `${(100 * share).toFixed(0)} % squeak after a long chord`);
  assert.ok(evs.every((e) => e.nl && e.dur <= 0.08 && e.amt <= 0.5 && e.s < 4), JSON.stringify(evs[0]));
});

test('a melody over a bass in one position never squeaks', () => {
  const song = blank();
  song.inst.fingerNoise = 1;
  // bass on beat 1, melody on the trebles, all in first position
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * 16;
    S.setCell(song, o, 1, { f: 3, t: '' });
    [[0, 5, 1], [4, 4, 3], [8, 4, 1], [12, 3, 2]].forEach(([st, s, f]) => S.setCell(song, o + st, s, { f, t: '' }));
  }
  for (let st = 1; st < 64; st++) if (song.cols[st]) assert.equal(squeaks(song, st, 100).share, 0, `step ${st}`);
});

test('the notes of a barre chord are stopped by the flat finger', () => {
  const song = blank();
  [1, 3, 3, 2, 1, 1].forEach((f, s) => S.setCell(song, 0, s, { f, t: '' })); // F
  [-1, 3, 2, 0, 1, 0].forEach((f, s) => f >= 0 && S.setCell(song, 8, s, { f, t: '' })); // C
  const br = (st) => S.stepEvents(song, st, 10, Math.random).filter((e) => e.type === 'n' && e.br).map((e) => e.s).sort();
  assert.deepEqual(br(0), [0, 4, 5]);
  assert.deepEqual(br(8), []);
});

test('in a single-note line each note mutes the string sounding before it, just after it', () => {
  const song = blank();
  const line = [[3, 0], [3, 2], [4, 0], [4, 1], [4, 3], [5, 0], [4, 3], [4, 1], [4, 0], [3, 2]];
  line.forEach(([s, f], i) => S.setCell(song, i * 2, s, { f, t: '' }));
  const evs = S.songEvents(song, 0, 20, 0, Math.random);
  const mutes = evs.filter((e) => e.type === 'o');
  // a mute for every change of string
  assert.equal(mutes.length, 4);
  for (const m of mutes) {
    const n = evs.find((e) => e.type === 'n' && e.t <= m.t + 1e-9 && m.t - e.t < 0.05 && e.s !== m.s);
    assert.ok(n, `mute of string ${m.s} at ${m.t.toFixed(3)} s follows a note on another string`);
  }
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
});

test('reverb spaces: the default is the stage; a changed setting is no space', () => {
  const fx = { ...S.FX_DEFAULTS };
  assert.equal(S.reverbSpace(fx), 'stage');
  for (const k of Object.keys(S.REVERBS)) { S.setReverbSpace(fx, k); assert.equal(S.reverbSpace(fx), k); }
  S.setReverbSpace(fx, 'room');
  fx.revSize += 0.1;
  assert.equal(S.reverbSpace(fx), '');
  // "none" only turns the reverb off
  S.setReverbSpace(fx, 'none');
  assert.equal(fx.revOn, false);
  assert.ok(Math.abs(fx.revSize - 0.7) < 1e-9);
  // the spaces grow in decay and mix
  const spaces = Object.values(S.REVERBS).filter((r) => r.revOn);
  for (let i = 1; i < spaces.length; i++) assert.ok(spaces[i].revSize > spaces[i - 1].revSize && spaces[i].revMix > spaces[i - 1].revMix);
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

test('links with retired settings (sympathetic, bow vibrato, body model) still load', () => {
  const old = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3', i: ['steel', 0.17, 0.72, 0, 0, 0.85, 0.3, 14, 0.4, 1, 0.5, 3, 0, 0.6], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.equal(old.inst.human, 0.4);
  assert.equal(old.inst.fingerNoise, 0.5);
  assert.equal(old.inst.picking, 3);
  assert.equal(old.inst.coupling, 0.6);
  for (const k of ['symp', 'vibrato', 'bodyModel']) assert.ok(!(k in old.inst), k);
  // a bowed song comes back as steel-string
  assert.equal(S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], c: 0, n: '', i: ['bowed', 0.15] }).inst.preset, 'steel');
});

test('string coupling survives the link; old links get the instrument default', async () => {
  const song = S.newSong();
  song.inst.coupling = 0.75;
  assert.equal((await S.decodeSong(await S.encodeSong(song))).inst.coupling, 0.75);
  const old = S.unpackSong({ v: 1, t: 'old', b: 100, g: [4, 4, 1], u: [40, 45, 50, 55, 59, 64], c: 0, n: 'A3', i: ['nylon', 0.2, 0.5, 0, 0, 0.9, 0.3, 18, 0.35, 1], x: [1, 0.26, 2.2, 0.5, 0, '8d', 0.35, 0.22, 0.8] });
  assert.equal(old.inst.coupling, S.INSTRUMENTS.nylon.coupling);
});

test('new songs and every instrument humanize at 50 %', () => {
  assert.equal(S.newSong().inst.human, 0.5);
  for (const inst of Object.values(S.INSTRUMENTS)) assert.equal(inst.human, 0.5);
});
