// What two microphones in front of the instrument hear.
//
// Each resonance radiates from every patch of the moving top, from the plug of
// air in the sound hole and - where the body is small against the wavelength -
// from the back. For a force on the bridge described by `drive` (how strongly
// it excites each resonance):
//   R_k(ω) = Σ_top φ_k h² e^(−jωr/c)/r + hole_k S e^(−jωr_h/c)/r_h + B(ω) V_back,k e^(−jωr_b/c)/r_b
//   H(ω)   = −ω² ρ/(2π) Σ_k R_k(ω) drive_k / (ω_k²(1 + jη_k) − ω²)

import { AIR } from './instruments.js';

export const F_STEP = 50, F_TOP = 5000; // grid on which the radiation factors are evaluated

// Returns, per microphone, the half spectrum { re, im } (nfft/2 + 1 bins) for
// each of the drives (array of Float64Array(K)).
export function micTransfer(body, inst, drives, fs, nfft) {
  const { grid, K } = body;
  const nodes = grid.nx * grid.ny, h2 = grid.h * grid.h;
  const idx = [];
  for (let i = 0; i < nodes; i++) if (grid.dof[i] >= 0) idx.push(i);
  const nN = idx.length, nF = Math.round(F_TOP / F_STEP), half = nfft / 2;
  const vBack = new Float64Array(K);
  for (let k = 0; k < K; k++) { let v = 0; for (let i = 0; i < nodes; i++) v += body.shapeBack[k * nodes + i]; vBack[k] = v * h2; }
  const wk2 = Array.from(body.f, (f) => (2 * Math.PI * f) ** 2);

  return inst.mics.map((mic) => {
    const dist = (x, y, z) => Math.hypot(mic.x - x, mic.y - y, mic.z - z);
    const r0 = dist(0, inst.saddle.y, 0);                            // bulk delay, taken out while interpolating
    const rH = dist(0, inst.hole.y, 0), rB = dist(0, inst.outline.length / 2, -inst.depth);
    const rN = new Float64Array(nN);
    idx.forEach((node, n) => { rN[n] = dist(grid.x(node % grid.nx), grid.y(Math.floor(node / grid.nx)), 0); });
    // radiation factor of every resonance on the frequency grid
    const Rre = new Float64Array(K * nF), Rim = new Float64Array(K * nF);
    const gr = new Float64Array(nN), gi = new Float64Array(nN);
    for (let fi = 0; fi < nF; fi++) {
      const f = (fi + 1) * F_STEP, kw = (2 * Math.PI * f) / AIR.c;
      for (let n = 0; n < nN; n++) { const ph = -kw * (rN[n] - r0); gr[n] = (Math.cos(ph) / rN[n]) * h2; gi[n] = (Math.sin(ph) / rN[n]) * h2; }
      const pH = -kw * (rH - r0), pB = -kw * (rB - r0), back = 1 / (1 + (f / 400) ** 2);
      for (let k = 0; k < K; k++) {
        let re = 0, im = 0;
        const off = k * nodes;
        for (let n = 0; n < nN; n++) { const s = body.shapeTop[off + idx[n]]; re += s * gr[n]; im += s * gi[n]; }
        const hs = (body.hole[k] * body.holeArea) / rH, bs = (back * vBack[k]) / rB;
        Rre[k * nF + fi] = re + hs * Math.cos(pH) + bs * Math.cos(pB);
        Rim[k * nF + fi] = im + hs * Math.sin(pH) + bs * Math.sin(pB);
      }
    }
    // the response per drive on the FFT bins
    return drives.map((drive) => {
      const re = new Float64Array(half + 1), im = new Float64Array(half + 1);
      for (let b = 1; b < half; b++) {
        const f = (b * fs) / nfft;
        if (f > F_TOP) break;
        const w = 2 * Math.PI * f, w2 = w * w;
        const u = Math.min(nF - 1, Math.max(0, f / F_STEP - 1)), i0 = Math.min(nF - 2, Math.floor(u)), t = u - i0;
        let sr = 0, si = 0;
        for (let k = 0; k < K; k++) {
          if (drive[k] === 0) continue;
          const o = k * nF + i0;
          const rr = Rre[o] + t * (Rre[o + 1] - Rre[o]), ri = Rim[o] + t * (Rim[o + 1] - Rim[o]);
          const dr = wk2[k] - w2, di = body.eta[k] * wk2[k], g = drive[k] / (dr * dr + di * di);
          sr += (rr * dr + ri * di) * g; si += (ri * dr - rr * di) * g;
        }
        const scale = (-w2 * AIR.rho) / (2 * Math.PI), ph = (-w * r0) / AIR.c, c = Math.cos(ph), s = Math.sin(ph);
        re[b] = scale * (sr * c - si * s); im[b] = scale * (sr * s + si * c);
      }
      return { re, im };
    }).map((spec) => Object.assign(spec, { delay: r0 / AIR.c }));
  });
}
