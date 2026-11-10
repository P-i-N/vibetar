// Builds an instrument body off the main thread.
// in:  { name, fs }        out: { ok: true, body } | { ok: false, error }

import { buildBody } from './model.js';

self.onmessage = (e) => {
  const { name, fs } = e.data;
  try {
    const body = buildBody(name, fs);
    const b = body.bridge;
    self.postMessage({ ok: true, body }, [...body.irs.map((a) => a.buffer), b.f.buffer, b.eta.buffer, b.phi.buffer, b.rock.buffer, b.z.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
