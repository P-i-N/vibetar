import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, midiToSong } from '../js/midi.js';
import * as S from '../js/song.js';

// ---- a small standard MIDI file writer ---------------------------------------------
const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; };
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
// events: [tick, ...bytes] in any order; running status is used where it can be
function track(events, running = true) {
  const sorted = events.slice().sort((a, b) => a[0] - b[0]);
  const data = [];
  let t = 0, status = 0;
  for (const [tick, ...bytes] of sorted) {
    data.push(...vlq(tick - t)); t = tick;
    if (running && bytes[0] < 0xf0 && bytes[0] === status) data.push(...bytes.slice(1));
    else { data.push(...bytes); status = bytes[0] < 0xf0 ? bytes[0] : 0; }
  }
  data.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(data.length), ...data];
}
function smf(tracks, ppq = 480, format = tracks.length > 1 ? 1 : 0) {
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, format, 0, tracks.length, ppq >> 8, ppq & 255, ...tracks.flat()]);
}
const tempo = (bpm) => { const us = Math.round(60e6 / bpm); return [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]; };
const name = (s) => [0, 0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];
const note = (tick, key, dur, vel = 80, ch = 0) => [[tick, 0x90 | ch, key, vel], [tick + dur, 0x80 | ch, key, 0]];

const cellsOf = (song) => {
  const out = [];
  song.cols.forEach((c, step) => c && c.forEach((cell, s) => cell && out.push({ step, s, ...cell })));
  return out;
};
const pitch = (song, n) => song.tuning[n.s] + song.capo + n.f;

test('a type 0 file with running status, tempo, time signature and a name is read', () => {
  const ev = [tempo(100), [0, 0xff, 0x58, 4, 3, 2, 24, 8], name('Waltz'), ...note(0, 52, 400), ...note(480, 55, 400), ...note(960, 59, 400, 120)];
  const m = parseMidi(smf([track(ev)]));
  assert.equal(m.ppq, 480);
  assert.equal(Math.round(60e6 / m.tempo), 100);
  assert.deepEqual(m.timeSig, [3, 4]);
  assert.equal(m.name, 'Waltz');
  assert.deepEqual(m.tracks[0].notes.map((n) => [n.tick, n.key, n.dur, n.vel]), [[0, 52, 400, 80], [480, 55, 400, 80], [960, 59, 400, 120]]);
  // a note-on with velocity 0 ends a note, like a note-off
  const z = parseMidi(smf([track([[0, 0x90, 60, 90], [240, 0x90, 60, 0]])]));
  assert.equal(z.tracks[0].notes[0].dur, 240);
});

test('files that are not MIDI, or not supported, are refused', () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5])), /not a MIDI file/);
  assert.throws(() => parseMidi(smf([track([])]).subarray(0, 20)), /cut short/);
  const smpte = smf([track([])]);
  smpte[12] = 0xe7; smpte[13] = 40;
  assert.throws(() => parseMidi(smpte), /SMPTE/);
});

test('an imported melody keeps its pitches, timing and tempo', () => {
  const keys = [64, 66, 67, 69, 71, 72, 74, 76];
  const ev = [tempo(120), name('Scale')];
  keys.forEach((k, i) => ev.push(...note(i * 240, k, 220)));
  const { song, dropped } = midiToSong(parseMidi(smf([track(ev)])));
  assert.equal(dropped, 0);
  assert.equal(song.bpm, 120);
  assert.equal(song.spb, 2);
  assert.equal(song.title, 'Scale');
  const cells = cellsOf(song).filter((c) => typeof c.f === 'number');
  assert.deepEqual(cells.map((c) => c.step), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(cells.map((c) => pitch(song, c)), keys);
  // a scale is played in one position, not up and down the neck
  const frets = cells.map((c) => c.f).filter((f) => f > 0);
  assert.ok(Math.max(...frets) - Math.min(...frets) <= 5, `frets ${frets} on strings ${cells.map((c) => c.s)}`);
});

test('chords go on distinct strings in a playable shape; the drums are left out', () => {
  // C major (C3 E3 G3 C4 E4) on beats 1 and 3, a hi-hat on channel 10 throughout
  const chord = [48, 52, 55, 60, 64];
  const ev = [tempo(90)];
  for (const t of [0, 960]) for (const k of chord) ev.push(...note(t, k, 900));
  const drums = [];
  for (let t = 0; t < 1920; t += 240) drums.push(...note(t, 42, 60, 70, 9));
  const { song } = midiToSong(parseMidi(smf([track(ev), track(drums)])));
  for (const step of [0, 2 * song.spb]) {
    const col = song.cols[step];
    const notes = col.map((c, s) => (c && typeof c.f === 'number' ? { s, f: c.f } : null)).filter(Boolean);
    assert.deepEqual(notes.map((n) => song.tuning[n.s] + n.f).sort((a, b) => a - b), chord);
    const fretted = notes.map((n) => n.f).filter((f) => f > 0);
    assert.ok(Math.max(...fretted) - Math.min(...fretted) <= 4);
  }
  assert.ok(!cellsOf(song).some((c) => typeof c.f === 'number' && song.tuning[c.s] + c.f === 42));
});

test('the grid follows the rhythm: sixteenths, triplets', () => {
  const run = (div) => {
    const ev = [tempo(100)];
    for (let i = 0; i < 12; i++) ev.push(...note(Math.round((i * 480) / div), 60 + (i % 3), 50));
    return midiToSong(parseMidi(smf([track(ev)]))).song.spb;
  };
  assert.equal(run(4), 4);
  assert.equal(run(3), 3);
  assert.equal(run(2), 2);
});

test('too low or too high melodies are moved by octaves onto the neck; more than six notes are thinned', () => {
  const ev = [tempo(100)];
  [28, 30, 31, 33].forEach((k, i) => ev.push(...note(i * 480, k, 400)));
  const low = midiToSong(parseMidi(smf([track(ev)]))).song;
  assert.deepEqual(cellsOf(low).filter((c) => c.f !== ".").map((c) => pitch(low, c)), [40, 42, 43, 45]);
  const big = [];
  for (const k of [40, 45, 50, 55, 59, 64, 67, 72]) big.push(...note(0, k, 400));
  const r = midiToSong(parseMidi(smf([track(big)])));
  const notes = cellsOf(r.song);
  assert.equal(notes.length, 6);
  assert.equal(r.dropped, 2);
  // the top and the bass are kept
  assert.ok(notes.some((c) => pitch(r.song, c) === 72) && notes.some((c) => pitch(r.song, c) === 40));
});

test('a note that ends long before its string is played again is stopped; loud notes are accents', () => {
  const ev = [tempo(100), ...note(0, 64, 200, 70), ...note(1920, 64, 200, 70), ...note(2400, 67, 400, 127)];
  const { song } = midiToSong(parseMidi(smf([track(ev)])));
  const cells = cellsOf(song);
  const stops = cells.filter((c) => c.f === '.');
  assert.ok(stops.length >= 1 && stops[0].step === 1, JSON.stringify(stops));
  assert.ok(cells.find((c) => typeof c.f === 'number' && pitch(song, c) === 67).t.includes('>'));
});

test('an imported song plays and survives the link round trip', async () => {
  const ev = [tempo(140), name('Round trip')];
  for (let i = 0; i < 64; i++) ev.push(...note(i * 120, [40, 47, 52, 55, 59, 64][i % 6], 110));
  const { song } = midiToSong(parseMidi(smf([track(ev, false)])));
  const back = await S.decodeSong(await S.encodeSong(song));
  assert.deepEqual(back.cols, song.cols);
  const evs = S.songEvents(song, 0, S.totalSteps(song), 0, Math.random);
  assert.equal(evs.filter((e) => e.type === 'n').length, 64);
});
