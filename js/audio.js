// Audio graph: string engine worklet -> body resonance -> delay / reverb -> master.

import { makeBodyIR, makeReverbIR } from './ir.js';
import { DELAY_TIMES, songEvents, totalSteps } from './song.js';

const WORKLET_URL = new URL('./worklet.js', import.meta.url).href;
const irCache = new Map();
const LEVELS = { steel: 1.35, nylon: 2.0, twelve: 1.7, bowed: 1.25 };

function toBuffer(ctx, ir) {
  const buf = ctx.createBuffer(2, ir.L.length, ctx.sampleRate);
  buf.copyToChannel(ir.L, 0); buf.copyToChannel(ir.R, 1);
  return buf;
}
function bodyBuffer(ctx, preset) {
  const key = `body:${preset}:${ctx.sampleRate}`;
  if (!irCache.has(key)) irCache.set(key, makeBodyIR(ctx.sampleRate, preset));
  return toBuffer(ctx, irCache.get(key));
}
function reverbBuffer(ctx, size, tone) {
  const key = `rev:${size.toFixed(2)}:${tone.toFixed(2)}:${ctx.sampleRate}`;
  if (!irCache.has(key)) {
    for (const k of irCache.keys()) if (k.startsWith('rev:')) irCache.delete(k);
    irCache.set(key, makeReverbIR(ctx.sampleRate, size, tone));
  }
  return toBuffer(ctx, irCache.get(key));
}

const engineCfg = (inst, song) => ({
  type: 'cfg', preset: inst.preset, open: song.tuning.map((m) => m + song.capo),
  pickPos: inst.pickPos, pickHard: inst.pickHard, bright: inst.bright, sustain: inst.sustain,
  symp: inst.symp, vibrato: inst.vibrato,
});

class Graph {
  constructor(ctx, node) {
    const c = ctx;
    this.ctx = c; this.node = node;
    const gain = (v) => { const g = c.createGain(); g.gain.value = v; return g; };
    this.body = c.createConvolver(); this.body.normalize = false;
    this.bodyGain = gain(0.85); this.directGain = gain(0.1);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 58; hp.Q.value = 0.7;
    this.inst = gain(1);
    node.connect(this.body); this.body.connect(this.bodyGain); this.bodyGain.connect(hp);
    node.connect(this.directGain); this.directGain.connect(hp);
    hp.connect(this.inst);
    this.master = gain(1);
    this.inst.connect(this.master);

    // ping-pong delay
    this.dlySend = gain(0); this.dlySend.channelCount = 1; this.dlySend.channelCountMode = 'explicit';
    this.dL = c.createDelay(3); this.dR = c.createDelay(3);
    this.fbA = gain(0.35); this.fbB = gain(0.35);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600; lp.Q.value = 0.5;
    const hp2 = c.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 220; hp2.Q.value = 0.5;
    const merge = c.createChannelMerger(2);
    this.dlyOut = gain(1);
    this.inst.connect(this.dlySend); this.dlySend.connect(lp); lp.connect(hp2); hp2.connect(this.dL);
    this.dL.connect(this.fbA); this.fbA.connect(this.dR);
    this.dR.connect(this.fbB); this.fbB.connect(lp);
    this.dL.connect(merge, 0, 0); this.dR.connect(merge, 0, 1);
    merge.connect(this.dlyOut); this.dlyOut.connect(this.master);

    // convolution reverb (two slots for click-free impulse swaps)
    this.revSend = gain(0);
    this.inst.connect(this.revSend);
    const dlyToRev = gain(0.6); this.dlyOut.connect(dlyToRev); dlyToRev.connect(this.revSend);
    this.revSlots = [0, 1].map(() => {
      const conv = c.createConvolver(); conv.normalize = false;
      const g = gain(0);
      this.revSend.connect(conv); conv.connect(g); g.connect(this.master);
      return { conv, g };
    });
    this.revSlot = 0; this.revKey = '';

    // master: volume, then a transparent soft clipper as a safety net
    // (linear below -4 dBFS, smoothly saturating above)
    this.vol = gain(0.8);
    const pre = gain(0.5);
    const clip = c.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const x = ((i / 4096) * 2 - 1) * 2, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a < 0.62 ? a : 0.62 + 0.36 * Math.tanh((a - 0.62) / 0.36));
    }
    clip.curve = curve; clip.oversample = '2x';
    this.out = clip;
    this.master.connect(this.vol); this.vol.connect(pre); pre.connect(clip); clip.connect(c.destination);
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048;
    clip.connect(this.analyser);
    this.preset = '';
  }

  setInstrument(inst, song, now) {
    if (inst.preset !== this.preset) {
      this.preset = inst.preset;
      this.body.buffer = bodyBuffer(this.ctx, inst.preset);
    }
    const t = now ? this.ctx.currentTime : 0;
    const set = (p, v) => (now ? p.setTargetAtTime(v, t, 0.03) : p.setValueAtTime(v, 0));
    const b = Math.max(0, Math.min(1, inst.body));
    const lv = LEVELS[inst.preset] || 1.5;
    set(this.bodyGain.gain, (0.35 + 0.65 * b) * lv);
    set(this.directGain.gain, 0.55 * (1 - b) * lv);
    this.node.port.postMessage(engineCfg(inst, song));
  }

  setFx(fx, bpm, now) {
    const t = now ? this.ctx.currentTime : 0;
    const set = (p, v, tc = 0.03) => (now ? p.setTargetAtTime(v, t, tc) : p.setValueAtTime(v, 0));
    set(this.vol.gain, fx.vol * fx.vol * 1.25);
    set(this.dlySend.gain, fx.dlyOn ? fx.dlyMix * 1.4 : 0);
    const fb = Math.min(0.9, fx.dlyFb);
    set(this.fbA.gain, fb); set(this.fbB.gain, fb);
    const dt = Math.min(2.9, (60 / bpm) * (DELAY_TIMES[fx.dlyTime] || 0.75));
    set(this.dL.delayTime, dt, 0.08); set(this.dR.delayTime, dt, 0.08);
    set(this.revSend.gain, fx.revOn ? fx.revMix * 1.15 : 0);
    const key = `${fx.revSize.toFixed(2)}:${fx.revTone.toFixed(2)}`;
    if (key !== this.revKey) {
      this.revKey = key;
      const buf = reverbBuffer(this.ctx, fx.revSize, fx.revTone);
      if (!now) {
        this.revSlots[0].conv.buffer = buf; this.revSlots[0].g.gain.setValueAtTime(1, 0);
      } else {
        const old = this.revSlots[this.revSlot];
        this.revSlot ^= 1;
        const cur = this.revSlots[this.revSlot];
        cur.conv.buffer = buf;
        cur.g.gain.cancelScheduledValues(t); cur.g.gain.setTargetAtTime(1, t, 0.06);
        old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, 0.06);
      }
    }
  }
}

export class AudioEngine {
  constructor() { this.ctx = null; this.graph = null; this.ready = null; this.song = null; }

  // must first be called from a user gesture
  init() {
    if (!this.ready) {
      this.ready = (async () => {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx({ latencyHint: 'interactive' });
        await this.ctx.audioWorklet.addModule(WORKLET_URL);
        const node = new AudioWorkletNode(this.ctx, 'vibetar-strings', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        this.graph = new Graph(this.ctx, node);
        if (this.song) { this.graph.setInstrument(this.song.inst, this.song, false); this.graph.setFx(this.song.fx, this.song.bpm, false); }
      })();
      this.ready.catch(() => { this.ready = null; });
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ready;
  }

  get running() { return !!this.graph; }
  get time() { return this.ctx ? this.ctx.currentTime : 0; }
  get latency() { return this.ctx ? (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0; }

  setSong(song) { this.song = song; this.syncInstrument(); this.syncFx(); }
  syncInstrument() { if (this.graph && this.song) this.graph.setInstrument(this.song.inst, this.song, true); }
  syncFx() { if (this.graph && this.song) this.graph.setFx(this.song.fx, this.song.bpm, true); }

  send(events) { if (this.graph && events.length) this.graph.node.port.postMessage({ type: 'batch', events }); }
  // silence: drop everything scheduled and damp the strings
  hush() {
    if (!this.graph) return;
    this.graph.node.port.postMessage({ type: 'flush' });
    this.graph.node.port.postMessage({ type: 'O' });
  }

  level() {
    if (!this.graph) return 0;
    const a = this.graph.analyser;
    if (!this.buf) this.buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(this.buf);
    let p = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = Math.abs(this.buf[i]); if (v > p) p = v; }
    return p;
  }
}

// Render the whole song to an AudioBuffer (for WAV export).
export async function renderSong(song, rnd, sampleRate = 48000) {
  const stepDur = 60 / song.bpm / song.spb;
  const n = totalSteps(song);
  const lead = 0.05;
  const tail = Math.min(12, (song.fx.revOn ? song.fx.revSize : 0) + 4);
  const dur = lead + n * stepDur + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const events = songEvents(song, 0, n, lead, rnd);
  if (song.inst.preset === 'bowed') for (let s = 0; s < 6; s++) events.push({ type: 'o', t: lead + n * stepDur, s });
  const node = new AudioWorkletNode(ctx, 'vibetar-strings', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: { cfg: engineCfg(song.inst, song), events },
  });
  const graph = new Graph(ctx, node);
  graph.setInstrument(song.inst, song, false);
  graph.setFx(song.fx, song.bpm, false);
  // fade the ring-out at the very end
  const v = graph.vol.gain.value;
  graph.vol.gain.setValueAtTime(v, dur - 2);
  graph.vol.gain.linearRampToValueAtTime(0, dur);
  return ctx.startRendering();
}

export function wavBlob(buffer) {
  const nc = buffer.numberOfChannels, n = buffer.length, fs = buffer.sampleRate;
  const chans = [];
  let peak = 0;
  for (let c = 0; c < nc; c++) {
    const d = buffer.getChannelData(c); chans.push(d);
    for (let i = 0; i < n; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  const g = peak > 0.98 ? 0.98 / peak : 1;
  const view = new DataView(new ArrayBuffer(44 + n * nc * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + n * nc * 2, true); str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, nc, true);
  view.setUint32(24, fs, true); view.setUint32(28, fs * nc * 2, true);
  view.setUint16(32, nc * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    view.setInt16(o, Math.round(Math.max(-1, Math.min(1, chans[c][i] * g)) * 32767), true); o += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}
