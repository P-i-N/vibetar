// Standard MIDI file import: parse the file, then lay its notes out as a tab.

import { MAX_BARS, MAX_FRET, emptyCols, newSong, setCell, INSTRUMENTS } from './song.js';
import { handPath } from './hand.js';

// ---- parsing -------------------------------------------------------------------

// parseMidi(bytes) -> { ppq, tempo (µs per quarter), timeSig: [num, den], name,
//   tracks: [{ name, program, notes: [{ tick, dur, key, vel, ch }] }] }
// Throws on anything that is not a type 0 or type 1 file with ticks per quarter note.
export function parseMidi(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  const need = (n) => { if (p + n > b.length) throw new Error('the MIDI file is cut short'); };
  const u32 = () => { need(4); const v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { need(2); const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  const tag = () => { need(4); const s = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); p += 4; return s; };
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) { need(1); const c = b[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) return v; }
    throw new Error('bad variable-length number in the MIDI file');
  };
  const text = (n) => { need(n); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); p += n; return s.trim(); };

  if (tag() !== 'MThd') throw new Error('not a MIDI file');
  const hlen = u32(), hdr = p;
  const format = u16(), ntrk = u16(), div = u16();
  p = hdr + hlen;
  if (format > 1) throw new Error('MIDI type 2 files are not supported');
  if (div & 0x8000) throw new Error('MIDI files with SMPTE timing are not supported');
  const out = { ppq: div || 480, tempo: 500000, timeSig: [4, 4], name: '', tracks: [] };
  let tempoSet = false, sigSet = false;

  for (let t = 0; t < ntrk && p < b.length; t++) {
    const id = tag(), len = u32(), end = p + len;
    if (id !== 'MTrk') { p = end; continue; }
    const track = { name: '', program: -1, notes: [] };
    const open = new Map(); // ch*128+key -> stack of started notes
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      need(1);
      let st = b[p];
      if (st & 0x80) p++; else if (!status) throw new Error('bad MIDI event'); else st = status; // running status
      if (st === 0xff) {
        need(1);
        const type = b[p++], n = vlq();
        if (type === 0x51 && n === 3 && !tempoSet) { need(3); out.tempo = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; tempoSet = true; }
        else if (type === 0x58 && n >= 2 && !sigSet) { need(2); out.timeSig = [b[p], 1 << b[p + 1]]; sigSet = true; }
        else if (type === 0x03 && !track.name) { track.name = text(n); continue; }
        p += n;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { p += vlq(); continue; }
      status = st;
      const kind = st & 0xf0, ch = st & 0x0f;
      const data = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      need(data);
      const d1 = b[p], d2 = data === 2 ? b[p + 1] : 0;
      p += data;
      if (kind === 0xc0) { if (track.program < 0) track.program = d1; continue; }
      if (kind !== 0x90 && kind !== 0x80) continue;
      const k = ch * 128 + d1;
      if (kind === 0x90 && d2 > 0) {
        const note = { tick, dur: 0, key: d1, vel: d2, ch };
        track.notes.push(note);
        if (!open.has(k)) open.set(k, []);
        open.get(k).push(note);
      } else {
        const started = open.get(k);
        const note = started && started.shift();
        if (note) note.dur = tick - note.tick;
      }
    }
    p = end;
    for (const list of open.values()) for (const n of list) n.dur = Math.max(0, tick - n.tick);
    out.tracks.push(track);
  }
  out.name = (out.tracks.find((t) => t.name) || {}).name || '';
  return out;
}

// ---- laying out the notes as a tab --------------------------------------------

const GRIDS = [2, 4, 3, 6];            // steps per beat to choose from
const MAX_SPAN = 4;                    // frets a hand covers without moving
const COMFORT_FRET = 15;

// grid with the smallest timing error, finer grids paying a little for their extra steps
function chooseGrid(notes, ppq) {
  let best = 4, bestScore = Infinity;
  for (const spb of GRIDS) {
    let err = 0;
    for (const n of notes) { const beats = n.tick / ppq; err += Math.abs(beats - Math.round(beats * spb) / spb); }
    const score = err / Math.max(1, notes.length) + 0.004 * spb;
    if (score < bestScore - 1e-9) { bestScore = score; best = spb; }
  }
  return best;
}

// octave shift that brings the most notes onto the neck (the smallest shift on a tie)
function octaveShift(keys, lo, hi) {
  let best = 0, bestIn = -1;
  for (const sh of [0, -12, 12, -24, 24, -36, 36]) {
    const n = keys.filter((k) => k + sh >= lo && k + sh <= hi).length;
    if (n > bestIn) { bestIn = n; best = sh; }
  }
  return best;
}

// All ways to put the notes of one step (high to low) on distinct strings, with their cost.
function fingerings(keys, open) {
  const out = [];
  const used = [false, false, false, false, false, false], frets = new Array(keys.length);
  const strings = new Array(keys.length);
  const walk = (i) => {
    if (i === keys.length) {
      let lo = 99, hi = 0, sum = 0, n = 0;
      for (const f of frets) if (f > 0) { lo = Math.min(lo, f); hi = Math.max(hi, f); sum += f; n++; }
      const span = n ? hi - lo : 0;
      if (span > MAX_SPAN + 1) return;
      let cost = (span > MAX_SPAN ? 6 : 0) + 0.3 * span + (n ? 0.08 * (sum / n) : 0);
      for (const f of frets) if (f > COMFORT_FRET) cost += 0.6 * (f - COMFORT_FRET);
      // the higher note on the higher string reads and plays naturally
      for (let j = 1; j < keys.length; j++) if (strings[j] > strings[j - 1]) cost += 0.5;
      out.push({ strings: strings.slice(), frets: frets.slice(), lo: n ? lo : 0, hi, cost });
      return;
    }
    for (let s = 5; s >= 0; s--) {
      const f = keys[i] - open[s];
      if (used[s] || f < 0 || f > MAX_FRET) continue;
      used[s] = true; strings[i] = s; frets[i] = f;
      walk(i + 1);
      used[s] = false;
    }
  };
  walk(0);
  out.sort((a, b) => a.cost - b.cost);
  return out.slice(0, 24);
}

// the notes one step can hold: at most six, distinct, keeping the top and the bass first
function playable(keys, open) {
  keys = [...new Set(keys)].sort((a, b) => b - a);
  while (keys.length > 6) keys.splice(keys.length - 2, 1);
  for (;;) {
    const fs = fingerings(keys, open);
    if (fs.length || keys.length <= 1) return { keys, options: fs };
    keys.splice(keys.length > 2 ? keys.length - 2 : keys.length - 1, 1);
  }
}

// midiToSong(midi, { title }) -> { song, dropped, truncated }
// Every track except the drums (channel 10) is played. Tempo and time signature are the
// file's first ones; onsets are quantised to the grid that fits them best.
export function midiToSong(midi, opts = {}) {
  const tracks = midi.tracks.filter((t) => t.notes.some((n) => n.ch !== 9));
  const notes = tracks.flatMap((t) => t.notes.filter((n) => n.ch !== 9));
  if (!notes.length) throw new Error('the MIDI file has no notes to play');
  const song = newSong();
  const program = (tracks.find((t) => t.program >= 0) || { program: -1 }).program;
  song.inst = { ...INSTRUMENTS[program === 24 ? 'nylon' : 'steel'] };
  song.title = String(opts.title || midi.name || 'Imported').slice(0, 80);
  song.bpm = Math.round(Math.min(300, Math.max(30, 60e6 / midi.tempo)));
  const [num, den] = midi.timeSig;
  song.bpb = Math.round(Math.min(12, Math.max(1, (num * 4) / den)));
  song.spb = chooseGrid(notes, midi.ppq);
  const open = song.tuning.map((m) => m + song.capo);
  const ticksPerStep = midi.ppq / song.spb, stepsPerBar = song.spb * song.bpb;
  const shift = octaveShift(notes.map((n) => n.key), open[0], open[5] + COMFORT_FRET);

  // group onsets by step; keys outside the neck are folded in by octaves
  const byStep = new Map();
  let last = 0;
  for (const n of notes) {
    const step = Math.round(n.tick / ticksPerStep);
    let key = n.key + shift;
    while (key < open[0]) key += 12;
    while (key > open[5] + MAX_FRET) key -= 12;
    const end = Math.max(step + 1, Math.round((n.tick + n.dur) / ticksPerStep));
    if (!byStep.has(step)) byStep.set(step, []);
    byStep.get(step).push({ key, vel: n.vel, end });
    last = Math.max(last, end);
  }
  const maxSteps = MAX_BARS * stepsPerBar;
  const steps = [...byStep.keys()].filter((s) => s < maxSteps).sort((a, b) => a - b);
  const truncated = steps.length < byStep.size;
  song.bars = Math.max(1, Math.min(MAX_BARS, Math.ceil((Math.min(last, maxSteps - 1) + 1) / stepsPerBar)));
  song.cols = emptyCols(song.bars * stepsPerBar);

  // choose a fingering per step: cheap shapes, and as little hand travel as possible
  let dropped = 0;
  const layers = steps.map((step) => {
    const all = byStep.get(step);
    const { keys, options } = playable(all.map((n) => n.key), open);
    dropped += new Set(all.map((n) => n.key)).size - (options.length ? keys.length : 0);
    return { step, keys, options, notes: all };
  }).filter((l) => l.options.length);
  // the fingering of each step along the cheapest path of the fretting hand
  const pick = handPath(layers, 60 / song.bpm / song.spb).map((st) => st.j);

  // write the notes; loud notes are accents
  const vels = notes.map((n) => n.vel).sort((a, b) => a - b), median = vels[vels.length >> 1];
  const loud = Math.max(100, median + 20);
  const placed = []; // [step, string, end]
  layers.forEach((l, i) => {
    const o = l.options[pick[i]];
    o.strings.forEach((s, j) => {
      const src = l.notes.filter((n) => n.key === l.keys[j]);
      const vel = Math.max(...src.map((n) => n.vel)), end = Math.max(...src.map((n) => n.end));
      setCell(song, l.step, s, { f: o.frets[j], t: vel >= loud ? '>' : '' });
      placed.push([l.step, s, end]);
    });
  });
  // A note is stopped where the music rests for a beat or more after it. Elsewhere it rings
  // until its string is played again, as on a guitar (MIDI note lengths often say otherwise);
  // after the last onset everything rings out.
  const total = song.cols.length, onsets = new Set(layers.map((l) => l.step));
  const lastOnset = layers.length ? layers[layers.length - 1].step : 0;
  const rests = (a, b) => { for (let k = a; k < b; k++) if (onsets.has(k)) return false; return true; };
  for (const [step, s, end] of placed) {
    if (end >= lastOnset || !rests(end, end + song.spb)) continue;
    let next = total;
    for (let k = step + 1; k < total; k++) if (song.cols[k] && song.cols[k][s]) { next = k; break; }
    if (next > end) setCell(song, end, s, { f: '.', t: '' });
  }
  return { song, dropped, truncated };
}
