// The fretting hand: where it sits on the neck, which notes its fingers hold down, when it
// moves, which strings a barre covers, and where a single-note line mutes the string
// played before. Pure functions over the tab's columns; no knowledge of the instrument.

const REACH = 3;   // frets p..p+3 lie under the four fingers at position p
const STRETCH = 4; // one more with a stretch

// handPath(layers, stepSecs) -> [{ j, p }] per layer
// The cheapest path of the hand through steps that each offer fingerings
// (layers: [{ step, options: [{ lo, hi, cost }] }], lo/hi the lowest and highest fretted
// fret, lo 0 when nothing is fretted). The hand sits at a position p (index finger at fret
// p); moving it costs, the more the further, less after a long rest. Open strings leave it
// where it is. j is the chosen option, p the position.
export function handPath(layers, stepSecs) {
  const states = [], cost = [], from = [];
  layers.forEach((l, i) => {
    const st = [];
    l.options.forEach((o, j) => {
      if (!o.lo) {
        const ps = i ? [...new Set(states[i - 1].map((s) => s.p))] : [0];
        for (const p of ps) st.push({ j, p, c: o.cost });
        return;
      }
      const first = Math.max(1, o.hi - STRETCH);
      if (first > o.lo) { st.push({ j, p: o.lo, c: o.cost + 3 }); return; } // wider than a hand: played anyway
      for (let p = first; p <= o.lo; p++) st.push({ j, p, c: o.cost + 0.02 * p + (o.hi - p > REACH ? 2 : 0) });
    });
    states.push(st);
    if (!i) { cost.push(st.map((s) => s.c)); from.push(st.map(() => -1)); return; }
    const prev = states[i - 1], pc = cost[i - 1];
    const weight = (l.step - layers[i - 1].step) * stepSecs > 2 ? 0.3 : 1;
    const c = [], f = [];
    for (const s of st) {
      let best = Infinity, arg = -1;
      prev.forEach((q, k) => {
        const d = s.p && q.p ? Math.abs(s.p - q.p) : 0;
        const v = pc[k] + (d ? weight * (0.8 + 0.5 * d) : 0);
        if (v < best) { best = v; arg = k; }
      });
      c.push(s.c + best); f.push(arg);
    }
    cost.push(c); from.push(f);
  });
  const out = new Array(layers.length);
  if (!layers.length) return out;
  let k = cost[layers.length - 1].indexOf(Math.min(...cost[layers.length - 1]));
  for (let i = layers.length - 1; i >= 0; i--) { out[i] = { j: states[i][k].j, p: states[i][k].p }; k = from[i][k]; }
  return out;
}

// ---- the plan ------------------------------------------------------------------

const isNote = (c) => !!c && c.f !== '.';
const fretted = (c) => !!c && typeof c.f === 'number' && c.f > 0 && !(c.t || '').includes('*');
const legato = (c) => /[hs]/.test(c.t || '');

// The barre in a set of held notes ([string, fret]), or null: the index finger flat across
// the strings at the lowest fret, when four fingers could not hold the shape otherwise, three
// neighbouring strings share that fret, or three strings share it around a higher note. A string ringing open between its ends (`open`)
// rules it out: the flat finger would stop it.
export function barreOf(notes, open = []) {
  if (notes.length < 2) return null;
  const f = Math.min(...notes.map(([, x]) => x));
  const at = notes.filter(([, x]) => x === f).map(([s]) => s);
  const lo = Math.min(...at), hi = Math.max(...at);
  const run3 = at.some((s) => at.includes(s + 1) && at.includes(s + 2));
  const around = at.length >= 3 && notes.some(([s, x]) => x > f && s > lo && s < hi);
  if (at.length < 2 || !(run3 || around || notes.length > 4)) return null;
  if (open.some((s) => s > lo && s < hi)) return null;
  return { f, lo, hi };
}

// can one hand at position p hold all these notes ([string, fret]) at once?
function holdable(notes, p, open) {
  if (notes.some(([, f]) => f < p || f > p + STRETCH)) return false;
  const b = barreOf(notes, open);
  const fingers = b ? notes.length - notes.filter(([, f]) => f === b.f).length + 1 : notes.length;
  return fingers <= 4;
}

// Single-note lines: runs of at least six columns with one sounding note each (no chord,
// harmonic or long rest in between) that move by step or repeat notes often enough to be a
// melody rather than a broken chord. Returns the set of steps in such runs.
function soloSteps(cols, steps, open, beat) {
  const out = new Set();
  let run = [];
  const close = () => {
    if (run.length >= 6) {
      const d = [];
      for (let k = 1; k < run.length; k++) d.push(Math.abs(run[k].m - run[k - 1].m));
      const steps = d.filter((x) => x <= 2).length, median = d.sort((a, b) => a - b)[d.length >> 1];
      // a bass alternating with a melody leaps; a line mostly does not
      if (steps / d.length >= 0.3 && median <= 5) for (const n of run) out.add(n.i);
    }
    run = [];
  };
  for (const i of steps) {
    const notes = cols[i].map((c, s) => (isNote(c) ? { s, c } : null)).filter(Boolean);
    if (!notes.length) continue; // stops only
    const n = notes[0];
    if (notes.length > 1 || n.c.f === 'x' || (n.c.t || '').includes('*') || (run.length && i - run[run.length - 1].i > 2 * beat)) close();
    if (notes.length === 1 && typeof n.c.f === 'number' && !(n.c.t || '').includes('*')) run.push({ i, s: n.s, m: open[n.s] + n.c.f });
  }
  close();
  return out;
}

// planHand(cols, { stepSecs, spb, bar, open }) -> per step (null where nothing is played) {
//   pos       hand position for this column (0: nothing fretted)
//   lifts     strings whose fretted notes stop just before this column: the fingers leave them
//   move      { dist, travel, held, kept, next, barre } when the hand moves to this column:
//             frets moved, frets a finger slides along a string, strings held before, those
//             of them fretted again after, strings fretted after, whether a barre moved
//   regrip    strings newly fretted after a long pause or at a section start (no move)
//   mutes     strings a single-note line silences as this note is played
//   barre     strings of this column's notes that the index finger holds as a barre
//   gap       seconds since the previous column with notes
//   phrase    the column starts a section: after a long pause, or on every eighth bar
// }
export function planHand(cols, { stepSecs, spb, bar, open }) {
  const steps = [];
  for (let i = 0; i < cols.length; i++) if (cols[i] && cols[i].some(Boolean)) steps.push(i);
  const layers = [];
  for (const i of steps) {
    const fs = cols[i].filter(fretted).map((c) => c.f);
    if (fs.length) layers.push({ step: i, options: [{ lo: Math.min(...fs), hi: Math.max(...fs), cost: 0 }] });
  }
  const posAt = new Map(handPath(layers, stepSecs).map((st, k) => [layers[k].step, st.p]));
  const solo = soloSteps(cols, steps, open, spb);

  const plan = new Array(cols.length).fill(null);
  const held = new Map();       // string -> { f, step }
  const ringOpen = new Set();   // strings last played open and still sounding
  let pos = 0, last = -1, barre = null;
  let line = new Set();         // strings sounding from the current single-note line
  for (const i of steps) {
    const col = cols[i];
    const gap = last < 0 ? Infinity : (i - last) * stepSecs;
    const e = { pos: 0, lifts: [], move: null, regrip: null, mutes: [], barre: [], gap, phrase: false };
    e.phrase = (last >= 0 && i - last >= 2 * spb) || (i % bar === 0 && (i / bar) % 8 === 0 && i > 0);
    plan[i] = e;
    const notes = [];
    col.forEach((c, s) => { if (c) notes.push({ s, c }); });
    for (const n of notes) if (typeof n.c.f !== 'number') { held.delete(n.s); line.delete(n.s); ringOpen.delete(n.s); } // stops and dead notes
    const sounding = notes.filter((n) => isNote(n.c));
    const fr = sounding.filter((n) => fretted(n.c));
    const played = new Set(sounding.map((n) => n.s));
    if (fr.length) {
      const p = posAt.get(i);
      if (pos && p !== pos && !fr.every((n) => legato(n.c))) {
        // the hand moves: every finger leaves its string
        const before = [...held.keys()], after = fr.map((n) => n.s);
        let travel = Math.abs(p - pos);
        for (const n of fr) if (held.has(n.s)) travel = Math.max(travel, Math.abs(n.c.f - held.get(n.s).f));
        e.move = { dist: Math.abs(p - pos), travel, held: before, kept: before.filter((s) => after.includes(s)), next: after, barre: !!barre };
        e.lifts = before;
        held.clear();
      } else {
        // a held note stays while the hand can keep it together with the new ones; the oldest go first
        const keep = [...held].filter(([s]) => !played.has(s)).sort((a, b) => a[1].step - b[1].step);
        const want = fr.map((n) => [n.s, n.c.f]);
        const opens = [...ringOpen].filter((s) => !played.has(s)).concat(sounding.filter((n) => n.c.f === 0).map((n) => n.s));
        while (keep.length && !holdable([...keep.map(([s, h]) => [s, h.f]), ...want], p, opens)) {
          const [s] = keep.shift();
          e.lifts.push(s); held.delete(s);
        }
        const pause = gap >= Math.max(1, 2 * spb * stepSecs) || e.phrase;
        const fresh = fr.filter((n) => !held.has(n.s) || held.get(n.s).f !== n.c.f).map((n) => n.s);
        if (pause && fresh.length && last >= 0) e.regrip = fresh;
      }
      pos = p; e.pos = p;
    }
    for (const n of sounding) {
      if (fretted(n.c)) { held.set(n.s, { f: n.c.f, step: i }); ringOpen.delete(n.s); } else { held.delete(n.s); if (n.c.f === 0) ringOpen.add(n.s); }
    }
    for (const s of e.lifts) ringOpen.delete(s);
    // the barre of the shape held now (notes plucked within the last bar); notes struck
    // earlier under it were barred too
    barre = barreOf([...held].filter(([, h]) => h.step > i - bar).map(([s, h]) => [s, h.f]), [...ringOpen]);
    if (barre) for (const [s, h] of held) if (h.step > i - bar && h.f === barre.f && s >= barre.lo && s <= barre.hi && !plan[h.step].barre.includes(s)) plan[h.step].barre.push(s);
    // a single-note line keeps one string sounding
    if (solo.has(i)) {
      const s = sounding[0].s;
      e.mutes = [...line].filter((x) => x !== s);
      for (const x of e.mutes) { held.delete(x); ringOpen.delete(x); }
      line = new Set([s]);
    } else line = new Set();
    if (sounding.length) last = i;
  }
  return plan;
}
