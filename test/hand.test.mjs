import test from 'node:test';
import assert from 'node:assert/strict';
import { barreOf, planHand, handPath } from '../js/hand.js';
import { DEMOS } from '../js/demos.js';
import * as S from '../js/song.js';

const OPEN = [40, 45, 50, 55, 59, 64];
// columns from [step, string, fret, flags] notes
function cols(n, notes) {
  const c = S.emptyCols(n);
  for (const [st, s, f, t] of notes) { if (!c[st]) c[st] = [null, null, null, null, null, null]; c[st][s] = { f, t: t || '' }; }
  return c;
}
const plan = (c, spb = 2) => planHand(c, { stepSecs: 60 / 90 / spb, spb, bar: spb * 4, open: OPEN });
const shapeNotes = (frets) => frets.map((f, s) => [s, f]).filter(([, f]) => f > 0);
const demo = (name) => DEMOS.find((d) => d.name.startsWith(name)).make();
const demoPlan = (song) => planHand(song.cols, { stepSecs: 60 / song.bpm / song.spb, spb: song.spb, bar: S.stepsPerBar(song), open: song.tuning.map((m) => m + song.capo) });

test('a barre is the index finger flat across the lowest fret of a shape that needs it', () => {
  assert.deepEqual(barreOf(shapeNotes([1, 3, 3, 2, 1, 1])), { f: 1, lo: 0, hi: 5 });   // F
  assert.deepEqual(barreOf(shapeNotes([-1, 2, 4, 4, 3, 2])), { f: 2, lo: 1, hi: 5 });  // Bm
  assert.deepEqual(barreOf(shapeNotes([5, 5, 5, -1, -1, -1])), { f: 5, lo: 0, hi: 2 }); // one-finger power chord
  assert.equal(barreOf(shapeNotes([-1, 3, 2, 0, 1, 0])), null);                         // open C
  assert.equal(barreOf(shapeNotes([3, 2, 0, 0, 0, 3])), null);                          // open G
  assert.equal(barreOf(shapeNotes([3, -1, -1, -1, 3, -1])), null);                      // two notes: two fingers
});

test('an arpeggiated barre chord is recognised, its first note too', () => {
  const p = plan(cols(8, [[0, 0, 1], [1, 3, 2], [2, 4, 1], [3, 5, 1], [4, 4, 1], [5, 3, 2]]));
  assert.deepEqual(p[0].barre, [0]);
  assert.deepEqual(p[2].barre, [4]);
  assert.deepEqual(p[3].barre, [5]);
  assert.deepEqual(p[1].barre, []);
});

test('fingers stay down while the hand can hold the notes; a shift lifts them all', () => {
  // a bass held under a melody in first position, then a jump up the neck
  const p = plan(cols(16, [[0, 1, 3], [0, 5, 1], [2, 4, 3], [4, 5, 0], [10, 4, 8], [12, 4, 10]]));
  for (const st of [2, 4]) { assert.deepEqual(p[st].lifts, []); assert.equal(p[st].move, null); }
  assert.ok(p[10].move, 'the hand moves for the 8th fret');
  assert.deepEqual(p[10].lifts.sort(), [1, 4]);
  assert.ok(p[10].move.travel >= 5, 'a finger slides at least five frets along the B string');
  assert.deepEqual(p[10].move.kept, [4]);
  assert.equal(p[12].move, null, 'the 10th fret is within reach');
});

test('a finger needed elsewhere lets its note go; legato notes do not move the hand', () => {
  // C chord held, then a G chord in the same position: the C notes not replayed are released
  const c = cols(8, [[0, 1, 3], [0, 2, 2], [0, 4, 1], [4, 0, 3], [4, 1, 2], [4, 5, 3], [4, 3, 0]]);
  const p = plan(c);
  assert.equal(p[4].move, null);
  assert.ok(p[4].lifts.length >= 1 && p[4].lifts.every((s) => s === 2 || s === 4), JSON.stringify(p[4].lifts));
  const h = plan(cols(8, [[0, 1, 3], [2, 1, 8, 'h']]));
  assert.equal(h[2].move, null);
  assert.deepEqual(h[2].lifts, []);
});

test('Greensleeves never moves the hand and only re-grips at section starts or after long notes', () => {
  const song = demo('Greensleeves'), p = demoPlan(song);
  const entries = p.map((e, i) => e && { ...e, i }).filter(Boolean);
  assert.equal(entries.filter((e) => e.move).length, 0);
  const regrips = entries.filter((e) => e.regrip);
  assert.ok(regrips.length > 0 && regrips.length <= 8, `${regrips.length} re-grips`);
  for (const e of regrips) assert.ok(e.phrase || e.gap >= 1, `step ${e.i}: gap ${e.gap.toFixed(2)} s`);
  assert.ok(entries.every((e) => !e.mutes.length), 'a melody over a bass is not a single-note line');
});

test('a jig is a single-note line: each note silences the string before; broken chords ring', () => {
  const jig = demoPlan(demo('The Irish Washerwoman')).filter(Boolean);
  const muting = jig.filter((e) => e.mutes.length).length;
  assert.ok(muting / jig.length > 0.4, `${muting} of ${jig.length} columns mute`);
  for (const name of ['The House of the Rising Sun', 'Canon in D', 'Bell Tower', 'Porch Swing', 'First Light']) {
    assert.equal(demoPlan(demo(name)).filter((e) => e && e.mutes.length).length, 0, name);
  }
});

test('the hand path keeps one position through a scale and moves for a jump', () => {
  const layers = [[3, 3], [5, 5], [2, 2], [3, 3], [10, 10], [12, 12]].map(([lo, hi], k) => ({ step: k * 2, options: [{ lo, hi, cost: 0 }] }));
  const ps = handPath(layers, 0.2).map((s) => s.p);
  assert.equal(new Set(ps.slice(0, 4)).size, 1, `positions ${ps}`);
  assert.ok(ps[4] >= 6 && ps[5] >= 8);
  // a shape wider than a hand still gets a position
  assert.equal(handPath([{ step: 0, options: [{ lo: 1, hi: 9, cost: 0 }] }], 0.2)[0].p, 1);
});
