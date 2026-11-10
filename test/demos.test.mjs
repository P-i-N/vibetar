import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/song.js';
import { DEMOS } from '../js/demos.js';

const songs = DEMOS.map((d) => d.make());
const cells = (song) => song.cols.flatMap((c, step) => (c ? c.map((cell, s) => cell && { step, s, ...cell }).filter(Boolean) : []));

test('every demo is a valid song that survives the link round trip', async () => {
  for (const song of songs) {
    assert.equal(song.cols.length, S.totalSteps(song), song.title);
    for (const c of cells(song)) {
      assert.ok(c.f === 'x' || c.f === '.' || (Number.isInteger(c.f) && c.f >= 0 && c.f <= S.MAX_FRET), `${song.title}: fret ${c.f}`);
      assert.equal(c.t, S.normFlags(c.t), `${song.title}: flags ${c.t}`);
    }
    // the last bar is not empty: no silence at the end
    const bar = S.stepsPerBar(song);
    assert.ok(song.cols.slice(-bar).some(Boolean), `${song.title}: empty last bar`);
    const back = await S.decodeSong(await S.encodeSong(song));
    assert.deepEqual(back.cols, song.cols, song.title);
    assert.deepEqual(back.fx, song.fx, song.title);
  }
});

test('the demos show every instrument, picking, technique, tuning, grid and reverb space', () => {
  const seen = (f) => new Set(songs.map(f).flat());
  assert.deepEqual([...seen((s) => s.inst.preset)].sort(), Object.keys(S.INSTRUMENTS).sort());
  assert.deepEqual([...seen((s) => s.inst.picking)].sort(), [0, 1, 2, 3, 4]);
  const flags = seen((s) => cells(s).flatMap((c) => [...c.t]));
  for (const f of S.FLAGS) assert.ok(flags.has(f), `no demo uses ${f}`);
  const specials = seen((s) => cells(s).map((c) => c.f));
  assert.ok(specials.has('x') && specials.has('.'), 'dead notes and stops');
  const tunings = seen((s) => Object.keys(S.TUNINGS).find((k) => S.TUNINGS[k].every((m, i) => m === s.tuning[i])));
  for (const t of ['Standard (EADGBE)', 'Drop D', 'DADGAD', 'Open G', 'Half step down']) assert.ok(tunings.has(t), `no demo in ${t}`);
  assert.ok(songs.some((s) => s.capo > 0), 'a capo');
  assert.deepEqual([...seen((s) => s.spb)].sort(), [2, 3, 4]);
  assert.ok(seen((s) => s.bpb).has(3) && seen((s) => s.bpb).has(2) && seen((s) => s.bpb).has(4));
  const spaces = seen((s) => S.reverbSpace(s.fx));
  for (const k of Object.keys(S.REVERBS)) assert.ok(spaces.has(k), `no demo in the ${k} space`);
  assert.ok(songs.some((s) => s.fx.dlyOn), 'the delay');
});

test('finger noise comes with hand moves, section starts and pauses, not in running passages', () => {
  let total = 0, placed = 0, demos = 0;
  for (const song of songs) {
    const bar = S.stepsPerBar(song), stepDur = 60 / song.bpm / song.spb;
    let n = 0;
    for (let r = 0; r < 20; r++) {
      const perf = S.newPerformer(r);
      for (let i = 0; i < S.totalSteps(song); i++) for (const e of S.stepEvents(song, i, i * stepDur, perf.rnd, perf)) {
        if (e.type !== 'q' || !(e.amt > 0)) continue;
        n++;
        if (i % bar < song.spb || perf.hand[i].gap >= song.spb * stepDur) placed++;
      }
    }
    total += n;
    if (n) demos++;
  }
  assert.ok(demos >= 10, `finger noise in ${demos} demos`);
  assert.ok(placed / total >= 0.6, `${placed} of ${total} squeaks at a bar start or after a pause`);
});
