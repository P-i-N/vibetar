// vibetar — UI: tab editor, transport, settings, sharing.

import { AudioEngine, renderSong, wavBlob } from './audio.js';
import * as S from './song.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const STORE_KEY = 'vibetar.song';
// small marks next to a note; palm mutes and harmonics are drawn in their own way
const TECH_SYM = { h: 'h', s: '/', b: 'b', v: '~', '>': '>' };

const audio = new AudioEngine();
let song = S.newSong();
let cur = { step: 0, s: 5 };
let anchor = null;
let clip = null;
let colEls = [], cellEls = [], pmEls = [], marked = [];
let perRow = 0;
const undoStack = [], redoStack = [];

// ---- toast -------------------------------------------------------------------

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---- persistence / sharing ---------------------------------------------------

let saveTimer = 0, savePending = false;
function scheduleSave() {
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
}
async function save(push) {
  clearTimeout(saveTimer);
  savePending = false;
  const data = await S.encodeSong(song);
  try { localStorage.setItem(STORE_KEY, data); } catch (e) { /* private mode */ }
  const url = '#' + data;
  if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  document.title = `${song.title || 'Untitled'} — vibetar`;
}

async function share() {
  await save();
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast(url.length > 6000 ? 'Link copied — it is a long one, some apps may shorten it' : 'Link copied to clipboard');
  } catch (e) {
    window.prompt('Copy this link to share your song:', url);
  }
}

async function loadFromHash() {
  const h = location.hash.slice(1);
  if (h.length < 2) return false;
  try {
    setSong(await S.decodeSong(h));
    return true;
  } catch (e) {
    console.warn(e);
    toast('Could not read the song in this link');
    return false;
  }
}

// ---- undo --------------------------------------------------------------------

const snapshot = () => JSON.stringify({ bars: song.bars, spb: song.spb, bpb: song.bpb, cols: song.cols });
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
}
function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  Object.assign(song, JSON.parse(from.pop()));
  clampCursor();
  syncSongControls();
  renderSheet();
  scheduleSave();
}

// ---- sheet rendering ---------------------------------------------------------

function cellWidth() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 22;
}
function calcPerRow() {
  const avail = $('sheetWrap').clientWidth - 28 - 22 - 4;
  return Math.max(1, Math.floor(avail / (S.stepsPerBar(song) * cellWidth() + 2)));
}

function renderSheet() {
  const sheet = $('sheet');
  sheet.textContent = '';
  const n = S.totalSteps(song), bar = S.stepsPerBar(song);
  perRow = calcPerRow();
  // stretch the cells a little so the bars fill the row
  const avail = $('sheetWrap').clientWidth - 28 - 22 - 4;
  const cw = clamp(Math.floor((avail / Math.min(perRow, song.bars) - 2) / bar), cellWidth(), 36);
  sheet.style.setProperty('--cw', cw + 'px');
  colEls = new Array(n); cellEls = new Array(n * 6); pmEls = new Array(n); marked = [];
  playCol = null;
  let sys = null;
  for (let b = 0; b < song.bars; b++) {
    if (b % perRow === 0) {
      sys = el('div', 'system');
      const labels = el('div', 'labels');
      for (let s = 5; s >= 0; s--) labels.append(el('span', '', S.noteName(song.tuning[s] + song.capo)));
      sys.append(labels);
      sheet.append(sys);
    }
    const barEl = el('div', 'bar');
    barEl.append(el('div', 'barnum', b + 1));
    const cols = el('div', 'cols');
    for (let i = 0; i < bar; i++) {
      const step = b * bar + i;
      const c = el('div', i % song.spb === 0 ? 'col beat' : 'col');
      c.dataset.step = step;
      c.append(pmEls[step] = el('div', 'pm'));
      for (let s = 5; s >= 0; s--) {
        const cell = el('div', 'cell');
        cell.dataset.s = s;
        cellEls[step * 6 + s] = cell;
        c.append(cell);
        paintCell(step, s);
      }
      colEls[step] = c;
      cols.append(c);
    }
    barEl.append(cols);
    sys.append(barEl);
  }
  paintPalmMutes();
  paintCursor();
  updateStatus();
}

// P.M. brackets above the staff
function paintPalmMutes() {
  const cls = new Array(pmEls.length).fill('pm');
  for (const [a, b] of S.palmMuteRuns(song)) {
    for (let i = a; i <= b && i < cls.length; i++) cls[i] = 'pm on';
    if (a < cls.length) cls[a] += ' start';
    if (b < cls.length) cls[b] += a === b ? ' only' : ' end';
  }
  pmEls.forEach((e, i) => { if (e.className !== cls[i]) e.className = cls[i]; });
}

function paintCell(step, s) {
  const e = cellEls[step * 6 + s];
  if (!e) return;
  const c = S.getCell(song, step, s);
  e.textContent = '';
  let cls = 'cell';
  if (c) {
    const harm = S.hasFlag(c, '*') && c.f > 0;
    if (c.f === 'x') cls += ' x'; else if (c.f === '.') cls += ' stop'; else if (harm) cls += ' harm';
    e.append(el('b', '', c.f === '.' ? '▪' : harm ? `<${c.f}>` : String(c.f)));
    const marks = [...(c.t || '')].map((f) => TECH_SYM[f] || '').join('');
    if (marks) e.append(el('i', '', marks));
  }
  e.className = cls;
}
function paintSteps(a, b) {
  for (let st = Math.max(0, a); st <= Math.min(b, S.totalSteps(song) - 1); st++) for (let s = 0; s < 6; s++) paintCell(st, s);
  paintPalmMutes();
  paintCursor();
}

function selRange() {
  const a = anchor || cur;
  return {
    a0: Math.min(a.step, cur.step), a1: Math.max(a.step, cur.step),
    s0: Math.min(a.s, cur.s), s1: Math.max(a.s, cur.s),
    multi: !!anchor && (anchor.step !== cur.step || anchor.s !== cur.s),
  };
}

function paintCursor() {
  for (const e of marked) e.classList.remove('cur', 'sel');
  marked = [];
  const r = selRange();
  if (r.multi) {
    for (let st = r.a0; st <= r.a1; st++) for (let s = r.s0; s <= r.s1; s++) {
      const e = cellEls[st * 6 + s];
      if (e) { e.classList.add('sel'); marked.push(e); }
    }
  }
  const e = cellEls[cur.step * 6 + cur.s];
  if (e) { e.classList.add('cur'); marked.push(e); }
}

function clampCursor() {
  cur.step = clamp(cur.step, 0, S.totalSteps(song) - 1);
  cur.s = clamp(cur.s, 0, 5);
  anchor = null;
}

function moveCursor(step, s, extend) {
  if (extend) { if (!anchor) anchor = { ...cur }; } else anchor = null;
  cur.step = clamp(step, 0, S.totalSteps(song) - 1);
  cur.s = clamp(s, 0, 5);
  paintCursor();
  updateStatus();
  const e = cellEls[cur.step * 6 + cur.s];
  if (e) e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateStatus() {
  const bar = S.stepsPerBar(song);
  const b = Math.floor(cur.step / bar), p = cur.step % bar;
  const c = S.getCell(song, cur.step, cur.s);
  let txt = `Bar ${b + 1} · beat ${Math.floor(p / song.spb) + 1}`;
  if (S.hasFlag(c, '*') && c.f > 0) txt += ` · harmonic at fret ${c.f}`;
  else if (c && typeof c.f === 'number') txt += ` · ${S.noteName(song.tuning[cur.s] + song.capo + c.f)}`;
  if (S.hasFlag(c, 'm')) txt += ' · palm muted';
  $('status').textContent = txt;
}

// ---- editing -----------------------------------------------------------------

function changed(a, b) {
  if (a == null) renderSheet(); else paintSteps(a, b);
  updateStatus();
  scheduleSave();
}

let lastDigit = { t: 0, step: -1, s: -1 };
function enterDigit(d) {
  const now = performance.now();
  const c = S.getCell(song, cur.step, cur.s);
  const num = c && typeof c.f === 'number';
  let f = d;
  if (num && c.f > 0 && lastDigit.step === cur.step && lastDigit.s === cur.s && now - lastDigit.t < 900) {
    const two = c.f * 10 + d;
    if (two <= S.MAX_FRET) f = two;
  }
  lastDigit = { t: now, step: cur.step, s: cur.s };
  pushUndo();
  const cell = { f, t: num ? c.t : '' };
  S.setCell(song, cur.step, cur.s, cell);
  anchor = null;
  changed(cur.step, cur.step);
  preview(cur.s, cell);
}

function setSpecial(f) {
  pushUndo();
  const c = S.getCell(song, cur.step, cur.s);
  const cell = c && c.f === f ? null : { f, t: '' };
  S.setCell(song, cur.step, cur.s, cell);
  changed(cur.step, cur.step);
  if (cell && f === 'x') preview(cur.s, cell);
}

function eachSelected(fn) {
  const r = selRange();
  for (let st = r.a0; st <= r.a1; st++) for (let s = r.s0; s <= r.s1; s++) fn(st, s, S.getCell(song, st, s));
  return r;
}

function toggleTech(t) {
  const cells = [];
  eachSelected((st, s, c) => { if (c && typeof c.f === 'number') cells.push(c); });
  if (!cells.length) return;
  pushUndo();
  const all = cells.every((c) => c.t.includes(t));
  for (const c of cells) if (all || !c.t.includes(t)) c.t = S.toggleFlag(c.t, t);
  const r = selRange();
  changed(r.a0, r.a1);
  if (!r.multi && !all) preview(cur.s, S.getCell(song, cur.step, cur.s));
}

function erase() {
  let any = false;
  eachSelected((st, s, c) => { if (c) any = true; });
  if (!any) return;
  pushUndo();
  const r = eachSelected((st, s) => S.setCell(song, st, s, null));
  changed(r.a0, r.a1);
}

function transpose(d) {
  const cells = [];
  eachSelected((st, s, c) => { if (c && typeof c.f === 'number') cells.push(c); });
  if (!cells.length || cells.some((c) => c.f + d < 0 || c.f + d > S.MAX_FRET)) return;
  pushUndo();
  for (const c of cells) c.f += d;
  const r = selRange();
  changed(r.a0, r.a1);
  if (!r.multi) preview(cur.s, S.getCell(song, cur.step, cur.s));
}

function copy(cut) {
  const r = selRange();
  const data = [];
  for (let st = r.a0; st <= r.a1; st++) {
    const row = [];
    for (let s = r.s0; s <= r.s1; s++) { const c = S.getCell(song, st, s); row.push(c ? { ...c } : null); }
    data.push(row);
  }
  clip = { data, s1: r.s1, h: r.s1 - r.s0 + 1 };
  if (cut) erase();
  toast(cut ? 'Cut' : 'Copied', 900);
}

function paste() {
  if (!clip) return;
  pushUndo();
  const r = selRange();
  // top row of the clip lands on the cursor's string (full-height clips keep their strings)
  const top = clip.h === 6 ? 5 : Math.max(clip.h - 1, r.s1);
  const n = S.totalSteps(song);
  clip.data.forEach((row, i) => {
    const st = r.a0 + i;
    if (st >= n) return;
    row.forEach((c, j) => {
      const s = top - (clip.h - 1) + j;
      if (s >= 0 && s < 6) S.setCell(song, st, s, c ? { ...c } : null);
    });
  });
  anchor = null;
  changed(r.a0, r.a0 + clip.data.length);
}

function barOp(op) {
  const bar = S.stepsPerBar(song);
  const b = Math.floor(cur.step / bar);
  if ((op === 'addBar' || op === 'insBar' || op === 'dupBar') && song.bars >= S.MAX_BARS) return toast('That is a lot of bars already');
  if (op === 'delBar' && song.bars <= 1) return;
  pushUndo();
  if (op === 'addBar') song.cols.push(...S.emptyCols(bar));
  else if (op === 'insBar') song.cols.splice(b * bar, 0, ...S.emptyCols(bar));
  else if (op === 'dupBar') {
    const copyCols = song.cols.slice(b * bar, (b + 1) * bar).map((c) => (c ? c.map((x) => (x ? { ...x } : null)) : null));
    song.cols.splice((b + 1) * bar, 0, ...copyCols);
  } else if (op === 'delBar') song.cols.splice(b * bar, bar);
  song.bars = song.cols.length / bar;
  if (op === 'dupBar' || op === 'insBar') cur.step = Math.min(cur.step + bar, song.cols.length - 1);
  clampCursor();
  changed();
}

// ---- audio preview -----------------------------------------------------------

async function preview(s, cell) {
  if (!cell || cell.f === '.' || player.playing) return;
  await audio.init();
  const t = audio.time + 0.02;
  const evs = [S.cellEvent(song, s, { f: cell.f, t: (cell.t || '').replace(/[hs]/g, '') }, t, 0.8, 1)];
  if (song.inst.preset === 'bowed') evs.push({ type: 'o', t: t + 0.7, s });
  audio.send(evs);
}

// ---- transport ---------------------------------------------------------------

const player = { playing: false, step: 0, from: 0, to: 0, nextTime: 0, endTime: 0, timer: 0, queue: [], loop: false, ended: false };
let playCol = null, playSys = null;

function playRange() {
  const r = selRange();
  if (r.multi && r.a1 > r.a0) return [r.a0, r.a1 + 1];
  return [0, S.totalSteps(song)];
}

async function play(fromTop) {
  await audio.init();
  if (player.playing) stop(true);
  const [from, to] = playRange();
  const bar = S.stepsPerBar(song);
  let start = fromTop ? 0 : Math.floor(cur.step / bar) * bar;
  if (start < from || start >= to) start = from;
  Object.assign(player, { playing: true, step: start, from, to, nextTime: audio.time + 0.08, queue: [], ended: false, endTime: Infinity, perf: S.newPerformer() });
  $('play').classList.add('on'); $('playIco').textContent = '■'; $('playLbl').textContent = 'Stop';
  schedule();
  player.timer = setInterval(schedule, 25);
}

function schedule() {
  if (!player.playing || player.ended) return;
  const horizon = audio.time + (document.hidden ? 1.6 : 0.2);
  const events = [];
  while (player.nextTime < horizon) {
    if (player.step >= player.to || player.step >= S.totalSteps(song)) {
      const [from, to] = playRange();
      if (player.loop) { player.from = from; player.to = to; player.step = from; }
      else {
        player.ended = true; player.endTime = player.nextTime;
        if (song.inst.preset === 'bowed') for (let s = 0; s < 6; s++) events.push({ type: 'o', t: player.nextTime, s });
        break;
      }
    }
    for (const ev of S.stepEvents(song, player.step, player.nextTime, Math.random, player.perf)) events.push(ev);
    player.queue.push({ step: player.step, t: player.nextTime });
    player.nextTime += 60 / song.bpm / song.spb;
    player.step++;
  }
  audio.send(events);
}

function stop(silent) {
  if (!player.playing) return;
  clearInterval(player.timer);
  player.playing = false; player.queue = [];
  $('play').classList.remove('on'); $('playIco').textContent = '▶'; $('playLbl').textContent = 'Play';
  setPlayCol(-1);
  if (!silent || song.inst.preset === 'bowed') audio.hush();
  else audio.graph && audio.graph.node.port.postMessage({ type: 'flush' });
}

function setPlayCol(step) {
  const c = step >= 0 ? colEls[step] : null;
  if (c === playCol) return;
  if (playCol) playCol.classList.remove('playing');
  playCol = c;
  if (!c) return;
  c.classList.add('playing');
  const sys = c.closest('.system');
  if (sys !== playSys) {
    playSys = sys;
    const wrap = $('sheetWrap'), r = sys.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const scroller = getComputedStyle(wrap).overflowY === 'visible' ? null : wrap;
    if (scroller) { if (r.top < w.top || r.bottom > w.bottom) scroller.scrollBy({ top: r.top - w.top - 40, behavior: 'smooth' }); }
    else if (r.top < 60 || r.bottom > innerHeight - 60) window.scrollBy({ top: r.top - 90, behavior: 'smooth' });
  }
}

let meterLevel = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!audio.running) return;
  if (player.playing) {
    const now = audio.time - audio.latency;
    let step = -2;
    while (player.queue.length && player.queue[0].t <= now) step = player.queue.shift().step;
    if (step !== -2) setPlayCol(step);
    if (player.ended && audio.time >= player.endTime) {
      // let the last notes ring out
      clearInterval(player.timer);
      player.playing = false;
      $('play').classList.remove('on'); $('playIco').textContent = '▶'; $('playLbl').textContent = 'Play';
      setPlayCol(-1);
    }
  }
  const cv = $('meter');
  if (cv.offsetParent) {
    const lv = audio.level();
    meterLevel = Math.max(lv, meterLevel * 0.92);
    const g = cv.getContext('2d'), w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    const db = 20 * Math.log10(meterLevel + 1e-6);
    const x = clamp((db + 48) / 48, 0, 1) * (w - 8);
    g.fillStyle = db > -1.5 ? '#e2733c' : '#7dd3a8';
    g.fillRect(4, 8, x, 6);
  }
}

// ---- settings UI -------------------------------------------------------------

const pct = (v) => Math.round(v * 100) + '%';
const signed = (v) => (v > 0 ? '+' : '') + Math.round(v * 100);
const sliders = [];

function mkSlider(parent, get, set, label, min, max, step, fmt, showFor) {
  const row = el('label', 'slider');
  const name = el('span', '', label);
  const input = el('input');
  Object.assign(input, { type: 'range', min, max, step });
  const out = el('output');
  row.append(name, input, out);
  parent.append(row);
  const refresh = () => {
    const v = get();
    input.value = v;
    out.textContent = fmt(v);
    input.style.setProperty('--p', ((v - min) / (max - min)) * 100 + '%');
    if (showFor) row.hidden = !showFor(song.inst.preset);
    if (typeof label === 'function') name.textContent = label(song.inst.preset);
  };
  if (typeof label === 'function') name.textContent = label(song.inst.preset);
  input.addEventListener('input', () => { set(parseFloat(input.value)); refresh(); scheduleSave(); });
  sliders.push(refresh);
  return refresh;
}

let fxTimer = 0;
function fxChanged(slow) {
  clearTimeout(fxTimer);
  if (slow) fxTimer = setTimeout(() => audio.syncFx(), 140); else audio.syncFx();
}

function buildSettings() {
  const I = $('instSliders');
  const inst = (k) => [() => song.inst[k], (v) => { song.inst[k] = v; audio.syncInstrument(); }];
  const plucked = (p) => p !== 'bowed';
  mkSlider(I, ...inst('pickPos'), (p) => (p === 'bowed' ? 'Bow position' : 'Pick position'), 0.06, 0.4, 0.005, pct);
  mkSlider(I, ...inst('pickHard'), (p) => (p === 'bowed' ? 'Bow pressure' : 'Attack'), 0, 1, 0.01, pct);
  mkSlider(I, ...inst('bright'), 'Brightness', -1, 1, 0.02, signed, plucked);
  mkSlider(I, ...inst('sustain'), 'Sustain', -1, 1, 0.02, signed, plucked);
  mkSlider(I, ...inst('vibrato'), 'Vibrato', 0, 2, 0.02, pct, (p) => p === 'bowed');
  mkSlider(I, ...inst('body'), 'Body', 0, 1, 0.01, pct);
  mkSlider(I, ...inst('symp'), 'String coupling', 0, 1, 0.01, pct, plucked);
  mkSlider(I, ...inst('fingerNoise'), 'Finger noise', 0, 1, 0.01, pct, plucked);
  mkSlider(I, ...inst('strum'), 'Strum spread', 0, 45, 1, (v) => v + ' ms', plucked);
  mkSlider(I, ...inst('human'), 'Humanize', 0, 1, 0.01, pct);

  const fx = (k, slow) => [() => song.fx[k], (v) => { song.fx[k] = v; fxChanged(slow); }];
  mkSlider($('revSliders'), ...fx('revMix'), 'Mix', 0, 0.8, 0.01, pct);
  mkSlider($('revSliders'), ...fx('revSize', true), 'Decay', 0.3, 8, 0.1, (v) => v.toFixed(1) + ' s');
  mkSlider($('revSliders'), ...fx('revTone', true), 'Tone', 0, 1, 0.02, pct);
  mkSlider($('dlySliders'), ...fx('dlyFb'), 'Feedback', 0, 0.85, 0.01, pct);
  mkSlider($('dlySliders'), ...fx('dlyMix'), 'Mix', 0, 0.8, 0.01, pct);
  mkSlider($('masterSliders'), ...fx('vol'), 'Volume', 0, 1, 0.01, pct);

  for (const id of ['revOn', 'dlyOn']) {
    $(id).addEventListener('change', (e) => { song.fx[id] = e.target.checked; fxChanged(); scheduleSave(); });
    $(id).parentElement.addEventListener('click', (e) => e.stopPropagation());
  }
  $('dlyTime').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    song.fx.dlyTime = b.dataset.v; syncFxControls(); fxChanged(); scheduleSave();
  });
  $('picking').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    song.inst.picking = +b.dataset.v; syncInstControls(); audio.syncInstrument(); scheduleSave();
    preview(cur.s, S.getCell(song, cur.step, cur.s) || { f: 0, t: '' });
  });
  $('bodyModel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    song.inst.bodyModel = +b.dataset.v; syncInstControls(); audio.syncInstrument(); scheduleSave();
  });
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.preset === song.inst.preset) return;
    const wasBowed = song.inst.preset === 'bowed';
    if (player.playing && wasBowed) audio.hush();
    song.inst = { ...S.INSTRUMENTS[b.dataset.preset] };
    syncInstControls(); audio.syncInstrument(); scheduleSave();
  });

  for (const name of Object.keys(S.TUNINGS)) $('tuning').append(new Option(name, name));
  $('tuning').append(new Option('Custom', 'custom'));
  for (let i = 0; i <= 12; i++) $('capo').append(new Option(i === 0 ? 'None' : 'Fret ' + i, i));
  for (let i = 2; i <= 7; i++) $('bpb').append(new Option(i, i));
  $('tuning').addEventListener('change', (e) => {
    const t = S.TUNINGS[e.target.value];
    if (!t) return;
    song.tuning = [...t]; renderSheet(); audio.syncInstrument(); scheduleSave();
  });
  $('capo').addEventListener('change', (e) => { song.capo = +e.target.value; renderSheet(); audio.syncInstrument(); scheduleSave(); });
  const regrid = () => {
    pushUndo();
    S.reshape(song, +$('spb').value, +$('bpb').value);
    clampCursor(); changed();
  };
  $('bpb').addEventListener('change', regrid);
  $('spb').addEventListener('change', regrid);

  $('bpm').addEventListener('change', (e) => {
    song.bpm = clamp(Math.round(+e.target.value) || 90, 30, 300);
    e.target.value = song.bpm; audio.syncFx(); scheduleSave();
  });
  $('title').addEventListener('input', (e) => { song.title = e.target.value; scheduleSave(); });
}

function syncInstControls() {
  for (const b of $('presets').children) b.classList.toggle('on', b.dataset.preset === song.inst.preset);
  $('picking').hidden = song.inst.preset === 'bowed';
  $('bodyModelRow').hidden = song.inst.preset === 'bowed';
  for (const b of $('bodyModel').children) b.classList.toggle('on', +b.dataset.v === (song.inst.bodyModel ? 1 : 0));
  for (const b of $('picking').children) b.classList.toggle('on', +b.dataset.v === (song.inst.picking || 0));
  for (const r of sliders) r();
}
function syncFxControls() {
  $('revOn').checked = song.fx.revOn; $('dlyOn').checked = song.fx.dlyOn;
  for (const b of $('dlyTime').children) b.classList.toggle('on', b.dataset.v === song.fx.dlyTime);
}
function syncSongControls() {
  $('title').value = song.title;
  $('bpm').value = song.bpm;
  const name = Object.keys(S.TUNINGS).find((k) => S.TUNINGS[k].every((m, i) => m === song.tuning[i]));
  $('tuning').value = name || 'custom';
  $('capo').value = song.capo;
  if (![...$('bpb').options].some((o) => +o.value === song.bpb)) $('bpb').append(new Option(song.bpb, song.bpb));
  $('bpb').value = song.bpb;
  if (![...$('spb').options].some((o) => +o.value === song.spb)) $('spb').append(new Option(song.spb + ' per beat', song.spb));
  $('spb').value = song.spb;
}

function setSong(s) {
  stop();
  song = s;
  cur = { step: 0, s: 5 }; anchor = null;
  undoStack.length = 0; redoStack.length = 0;
  syncSongControls(); syncInstControls(); syncFxControls();
  renderSheet();
  audio.setSong(song);
  document.title = `${song.title || 'Untitled'} — vibetar`;
}

// ---- input -------------------------------------------------------------------

function handleKey(key, e) {
  const bar = S.stepsPerBar(song);
  const shift = e && e.shiftKey, mod = e && (e.ctrlKey || e.metaKey);
  if (mod) {
    switch (key.toLowerCase()) {
      case 'z': shift ? restore(redoStack, undoStack) : restore(undoStack, redoStack); return true;
      case 'y': restore(redoStack, undoStack); return true;
      case 'c': copy(false); return true;
      case 'x': copy(true); return true;
      case 'v': paste(); return true;
      case 'a': anchor = { step: 0, s: 0 }; cur = { step: S.totalSteps(song) - 1, s: 5 }; paintCursor(); return true;
      case 'arrowleft': moveCursor((Math.ceil(cur.step / song.spb) - 1) * song.spb, cur.s, shift); return true;
      case 'arrowright': moveCursor((Math.floor(cur.step / song.spb) + 1) * song.spb, cur.s, shift); return true;
    }
    return false;
  }
  if (/^[0-9]$/.test(key)) { enterDigit(+key); return true; }
  switch (key) {
    case 'ArrowLeft': moveCursor(cur.step - 1, cur.s, shift); return true;
    case 'ArrowRight': moveCursor(cur.step + 1, cur.s, shift); return true;
    case 'ArrowUp': moveCursor(cur.step, cur.s + 1, shift); return true;
    case 'ArrowDown': moveCursor(cur.step, cur.s - 1, shift); return true;
    case 'Home': moveCursor(Math.floor(cur.step / bar) * bar, cur.s, shift); return true;
    case 'End': moveCursor(Math.floor(cur.step / bar) * bar + bar - 1, cur.s, shift); return true;
    case 'PageUp': moveCursor((Math.ceil(cur.step / bar) - 1) * bar, cur.s, shift); return true;
    case 'PageDown': moveCursor((Math.floor(cur.step / bar) + 1) * bar, cur.s, shift); return true;
    case 'Backspace': case 'Delete': erase(); return true;
    case ' ': player.playing ? stop() : play(false); return true;
    case 'Enter': play(true); return true;
    case 'Escape': if (anchor) { anchor = null; paintCursor(); } else if (player.playing) stop(); return true;
    case 'undo': restore(undoStack, redoStack); return true;
    case 'redo': restore(redoStack, undoStack); return true;
    case '+': case '=': transpose(1); return true;
    case '-': case '_': transpose(-1); return true;
    case '.': setSpecial('.'); return true;
    case '?': $('help').showModal(); return true;
    case '~': toggleTech('v'); return true;
    case '/': toggleTech('s'); return true;
    case '>': case '*': toggleTech(key); return true;
  }
  switch (key.toLowerCase()) {
    case 'x': setSpecial('x'); return true;
    case 'l': toggleLoop(); return true;
    case 'h': case 'p': toggleTech('h'); return true;
    case 's': case 'b': case 'v': case 'm': toggleTech(key.toLowerCase()); return true;
  }
  return false;
}

function toggleLoop() {
  player.loop = !player.loop;
  $('loop').setAttribute('aria-pressed', player.loop);
}

function bindInput() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if ($('help').open) return;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') {
      if (e.key === 'Escape' || (e.key === 'Enter' && t.type !== 'range')) { t.blur(); $('sheetWrap').focus({ preventScroll: true }); e.preventDefault(); }
      return;
    }
    if (e.altKey) return;
    if (handleKey(e.key, e)) e.preventDefault();
  });

  // pointer: click to place the cursor, drag to select
  const sheet = $('sheet');
  let dragging = false;
  const hit = (e) => {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const cell = t && t.closest ? t.closest('.cell') : null;
    if (!cell || !sheet.contains(cell)) return null;
    return { step: +cell.parentElement.dataset.step, s: +cell.dataset.s };
  };
  sheet.addEventListener('pointerdown', (e) => {
    const h = hit(e);
    if (!h) return;
    $('sheetWrap').focus({ preventScroll: true });
    moveCursor(h.step, h.s, e.shiftKey);
    if (e.pointerType === 'mouse') { dragging = true; e.preventDefault(); }
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const h = hit(e);
    if (h && (h.step !== cur.step || h.s !== cur.s)) moveCursor(h.step, h.s, true);
  });
  window.addEventListener('pointerup', () => { dragging = false; });

  // on-screen pad
  const digits = $('padDigits');
  for (let i = 0; i <= 9; i++) { const b = el('button', '', i); b.dataset.key = i; digits.append(b); }
  $('pad').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) handleKey(b.dataset.key, null);
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) b.blur();
    if (!e.target.closest('.menuwrap')) closeMenu();
  });

  $('play').addEventListener('click', () => (player.playing ? stop() : play(false)));
  $('loop').addEventListener('click', toggleLoop);
  $('share').addEventListener('click', share);
  document.querySelector('.barops').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) barOp(b.dataset.act);
  });

  // menu
  $('menuBtn').addEventListener('click', () => {
    const m = $('menu');
    m.hidden = !m.hidden;
    $('menuBtn').setAttribute('aria-expanded', !m.hidden);
  });
  S.DEMOS.forEach((d, i) => {
    const b = el('button', '', d.name);
    b.dataset.demo = i;
    $('demoList').append(b);
  });
  $('menu').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    if (b.dataset.demo != null) { await save(); setSong(S.DEMOS[+b.dataset.demo].make()); await save(true); }
    else if (b.dataset.act === 'new') { await save(); setSong(S.newSong()); await save(true); toast('New song — the browser Back button brings the old one back'); }
    else if (b.dataset.act === 'help') $('help').showModal();
    else if (b.dataset.act === 'wav') exportWav();
  });

  window.addEventListener('popstate', () => { if (!savePending) loadFromHash(); });
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (calcPerRow() !== perRow) renderSheet(); }, 120);
  });
  document.addEventListener('visibilitychange', () => { if (player.playing) schedule(); });
}

function closeMenu() {
  $('menu').hidden = true;
  $('menuBtn').setAttribute('aria-expanded', 'false');
}

async function exportWav() {
  toast('Rendering audio…', 60000);
  try {
    const buf = await renderSong(song, Math.random);
    const a = el('a');
    a.href = URL.createObjectURL(wavBlob(buf));
    a.download = (song.title || 'vibetar').replace(/[^\w\- ]+/g, '').trim() + '.wav';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast('WAV exported');
  } catch (e) {
    console.error(e);
    toast('Export failed in this browser');
  }
}

// ---- boot ----------------------------------------------------------------------

async function boot() {
  audio.onNotice = (msg) => toast(msg, 5000);
  buildSettings();
  bindInput();
  let ok = await loadFromHash();
  if (!ok) {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) { setSong(await S.decodeSong(saved)); ok = true; }
    } catch (e) { /* ignore */ }
  }
  if (!ok) setSong(S.DEMOS[0].make());
  requestAnimationFrame(frame);
  // debugging / scripting hook
  window.vibetar = { audio, get song() { return song; }, S, player };
}
boot();
