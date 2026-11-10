// The fretboard view: where the fretting hand is, which finger holds which note, and which
// strings sound. It only draws; the hand's plan comes from hand.js.

const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21];
const RING = 2.5;      // seconds a struck string stays lit
const MIN_FRETS = 12;
const EDGE = 9;       // the board reaches this far beyond the outer strings, in pixels

// createNeck(canvas) -> {
//   setSong(song)            tuning, capo and the highest fret of the song
//   strike(col, plan, now)   a column is played: its cells (per string) and the hand's plan for it
//   show(col, plan)          a column is looked at, not played: nothing else stays on the board
//   resize()                 the canvas changed size
//   draw(now)                paint, if anything changed or a string is still lit
// }
export function createNeck(canvas) {
  const g = canvas.getContext('2d');
  // per string: { kind: 'note' | 'open' | 'harm' | 'dead', fret, finger, barre, t, still }; still: shown, not played
  const marks = [null, null, null, null, null, null];
  let frets = MIN_FRETS, capo = 0, pos = 0, dirty = true, colors = null;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const palette = () => colors || (colors = { board: css('--card2'), fret: css('--string'), nut: css('--dim'), string: css('--dim'), ink: css('--ink'), dim: css('--dim'), accent: css('--accent'), harm: '#ffd9a8', dark: '#2a1a0a' });

  function setSong(song) {
    let hi = 0;
    for (const c of song.cols) if (c) for (const cell of c) if (cell && typeof cell.f === 'number' && cell.f > hi) hi = cell.f;
    capo = song.capo;
    frets = Math.max(MIN_FRETS, Math.min(24, hi + capo + 1));
    marks.fill(null); pos = 0; dirty = true;
  }

  function strike(col, plan, now, still = false) {
    if (!col) return;
    if (plan) {
      for (const s of plan.lifts) marks[s] = null;
      for (const s of plan.mutes) marks[s] = null;
      if (plan.pos) pos = plan.pos;
    }
    col.forEach((c, s) => {
      if (!c) return;
      if (c.f === '.') marks[s] = null;
      else if (c.f === 'x') marks[s] = { kind: 'dead', t: now, still };
      else if ((c.t || '').includes('*') && c.f > 0) marks[s] = { kind: 'harm', fret: c.f, t: now, still };
      else if (c.f === 0) marks[s] = { kind: 'open', t: now, still };
      else marks[s] = { kind: 'note', fret: c.f, finger: plan ? plan.fingers[s] : 0, barre: !!plan && plan.barre.includes(s), t: now, still };
    });
    dirty = true;
  }

  function show(col, plan) {
    marks.fill(null);
    pos = plan && plan.pos ? plan.pos : 0;
    strike(col, plan, -RING, true);
    dirty = true;
  }

  function draw(now) {
    const lit = marks.some((m) => m && now - m.t < RING);
    if (!dirty && !lit) return;
    dirty = false;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) { dirty = true; return; }
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const c = palette();
    const x0 = 30, x1 = w - 8, top = 12, bottom = h - 22, gap = (bottom - top) / 5;
    // frets lie where they do on a real neck: each a twelfth root of two closer to the bridge
    const fx = (f) => x0 + ((x1 - x0) * (1 - Math.pow(2, -f / 12))) / (1 - Math.pow(2, -frets / 12));
    const mid = (f) => (fx(f - 1) + fx(f)) / 2;
    const sy = (s) => top + (5 - s) * gap;
    const glow = (m) => (m ? Math.max(0, 1 - (now - m.t) / RING) : 0);

    g.fillStyle = c.board;
    g.beginPath(); g.roundRect(x0, top - EDGE, x1 - x0, bottom - top + 2 * EDGE, 4); g.fill();
    g.fillStyle = c.fret; g.globalAlpha = 0.5;
    for (const f of INLAYS) {
      if (f > frets) break;
      for (const y of f === 12 ? [sy(4) + gap / 2, sy(2) + gap / 2] : [(top + bottom) / 2]) { g.beginPath(); g.arc(mid(f), y, 3, 0, 7); g.fill(); }
    }
    g.globalAlpha = 1;
    g.strokeStyle = c.fret; g.lineWidth = 1;
    for (let f = 1; f <= frets; f++) { g.beginPath(); g.moveTo(fx(f), top - EDGE); g.lineTo(fx(f), bottom + EDGE); g.stroke(); }
    g.strokeStyle = c.nut; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0, top - EDGE); g.lineTo(x0, bottom + EDGE); g.stroke();
    g.font = '9px ui-monospace, Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = c.dim;
    for (const f of INLAYS) if (f <= frets) g.fillText(String(f), mid(f), h - 3);

    // the four fingers' reach from the hand's position
    if (pos) {
      g.fillStyle = c.accent; g.globalAlpha = 0.16;
      g.fillRect(fx(pos + capo - 1), top - EDGE, fx(Math.min(frets, pos + capo + 3)) - fx(pos + capo - 1), bottom - top + 2 * EDGE);
      g.globalAlpha = 1;
    }
    if (capo > 0) {
      g.fillStyle = c.nut;
      g.beginPath(); g.roundRect(fx(capo) - 7, top - EDGE - 2, 5, bottom - top + 2 * EDGE + 4, 2.5); g.fill();
    }

    for (let s = 0; s < 6; s++) {
      const a = glow(marks[s]), y = sy(s);
      g.strokeStyle = c.string; g.lineWidth = 2.2 - 0.24 * s; g.globalAlpha = 0.75;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      if (a > 0 && marks[s].kind !== 'dead') {
        g.strokeStyle = c.accent; g.globalAlpha = a; g.lineWidth += 0.6;
        const from = marks[s].kind === 'note' ? fx(marks[s].fret + capo) : capo ? fx(capo) : x0;
        g.beginPath(); g.moveTo(from, y); g.lineTo(x1, y); g.stroke();
      }
      g.globalAlpha = 1;
    }

    // a barre: one finger across its strings
    const barred = marks.map((m, s) => (m && m.kind === 'note' && m.barre ? s : -1)).filter((s) => s >= 0);
    if (barred.length > 1) {
      const f = marks[barred[0]].fret + capo;
      g.fillStyle = c.accent; g.globalAlpha = 0.55;
      g.beginPath(); g.roundRect(mid(f) - 5, sy(barred[barred.length - 1]) - 5, 10, sy(barred[0]) - sy(barred[barred.length - 1]) + 10, 5); g.fill();
      g.globalAlpha = 1;
    }
    const r = Math.min(8, gap / 2 - 0.5);
    g.textBaseline = 'middle'; g.font = `700 ${Math.round(r * 1.25)}px ui-monospace, Consolas, monospace`;
    marks.forEach((m, s) => {
      if (!m) return;
      const y = sy(s), a = m.still ? 0.9 : 0.45 + 0.55 * glow(m);
      g.globalAlpha = a;
      if (m.kind === 'note') {
        g.fillStyle = c.accent;
        g.beginPath(); g.arc(mid(m.fret + capo), y, r, 0, 7); g.fill();
        if (m.finger) { g.globalAlpha = 1; g.fillStyle = c.dark; g.fillText(String(m.finger), mid(m.fret + capo), y + 0.5); }
      } else if (m.kind === 'open') {
        g.strokeStyle = c.accent; g.lineWidth = 1.8;
        g.beginPath(); g.arc(x0 - 14, y, r - 2.5, 0, 7); g.stroke();
      } else if (m.kind === 'harm') {
        const x = fx(m.fret + capo);
        g.strokeStyle = c.harm; g.lineWidth = 1.8;
        g.beginPath(); g.moveTo(x - r, y); g.lineTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.closePath(); g.stroke();
      } else {
        g.fillStyle = c.dim; g.fillText('×', x0 - 14, y + 0.5);
      }
      g.globalAlpha = 1;
    });
  }

  return { setSong, strike, show, resize() { dirty = true; }, draw };
}
