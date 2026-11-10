// The instrument as one system: top plate, back plate, the air between them
// and the plug of air in the sound hole, coupled and solved for the
// resonances of the whole body.
//
// The air's standing waves each get a displacement-like coordinate η, which
// keeps the coupled problem symmetric:
//   coordinates  z = [top modes, back modes, hole plug x, η_1 … ]
//   mass         diag(1 …, 1 …, ρ S ℓ, κ/ω_a² …)            κ = ρc²/V
//   stiffness    diag(ω_top² …, ω_back² …, 0, 0 …) + κ Σ_a c_a c_aᵀ
//   c_a          how much each coordinate squeezes air mode a

import { symEig } from './eigen.js';
import { plateModes, stiffness } from './plate.js';
import { cavityModes } from './cavity.js';
import { outlineGrid, AIR } from './instruments.js';
import { nodeAt } from './grid.js';

const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

// value of a nodal field at a point (bilinear)
function sample(grid, field, off, px, py) {
  const gx = px / grid.h + (grid.nx - 1) / 2, gy = py / grid.h + (nodeAt(grid, 0, 0).j);
  const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j;
  const at = (a, b) => field[off + b * grid.nx + a];
  return (1 - u) * (1 - v) * at(i, j) + u * (1 - v) * at(i + 1, j) + (1 - u) * v * at(i, j + 1) + u * v * at(i + 1, j + 1);
}

export function coupleBody(inst, { h = 0.008, nTop = 150, nBack = 80, nAir = 30, fMax = 5000 } = {}) {
  const gridTop = outlineGrid(inst, h, true), gridBack = outlineGrid(inst, h, false);
  const nodes = gridTop.nx * gridTop.ny, h2 = h * h;
  const top = plateModes(gridTop, inst.top, nTop);
  const back = plateModes(gridBack, inst.back, nBack);
  const air = cavityModes(gridBack, inst.depth, nAir);
  nTop = top.f.length; nBack = back.f.length; nAir = air.f.length;

  const S = Math.PI * inst.hole.r ** 2;
  const neck = inst.top.thickness + 1.7 * inst.hole.r; // plug length with both end corrections
  const kappa = (AIR.rho * AIR.c ** 2) / air.volume;
  const iHole = nTop + nBack, nc = iHole + nAir;      // η_a sits at iHole + a for a >= 1
  const M = new Float64Array(nc).fill(1);
  M[iHole] = AIR.rho * S * neck;
  for (let a = 1; a < nAir; a++) M[iHole + a] = kappa / (2 * Math.PI * air.f[a]) ** 2;

  // hole nodes of the top grid
  const holeNodes = [];
  for (let i = 0; i < nodes; i++) if (gridTop.type[i] === 2) holeNodes.push(i);

  const Kc = new Float64Array(nc * nc);
  for (let m = 0; m < nTop; m++) Kc[m * nc + m] = top.w2[m];
  for (let m = 0; m < nBack; m++) Kc[(nTop + m) * nc + nTop + m] = back.w2[m];
  const c = new Float64Array(nc);
  for (let a = 0; a < nAir; a++) {
    c.fill(0);
    const psi = air.psi.subarray(a * nodes, (a + 1) * nodes);
    for (let i = 0; i < nodes; i++) {
      const dt = gridTop.dof[i], db = gridBack.dof[i];
      if (dt >= 0) for (let m = 0; m < nTop; m++) c[m] += psi[i] * top.phi[m * top.n + dt] * h2;
      if (db >= 0) for (let m = 0; m < nBack; m++) c[nTop + m] += psi[i] * back.phi[m * back.n + db] * h2;
    }
    let ph = 0;
    for (const i of holeNodes) ph += psi[i];
    c[iHole] = (holeNodes.length ? ph / holeNodes.length : 1) * S;
    if (a > 0) c[iHole + a] = 1;
    for (let p = 0; p < nc; p++) {
      if (c[p] === 0) continue;
      for (let q = 0; q < nc; q++) Kc[p * nc + q] += kappa * c[p] * c[q];
    }
  }
  // scale to a standard symmetric problem and solve
  const rm = new Float64Array(nc);
  for (let p = 0; p < nc; p++) rm[p] = 1 / Math.sqrt(M[p]);
  for (let p = 0; p < nc; p++) for (let q = 0; q < nc; q++) Kc[p * nc + q] *= rm[p] * rm[q];
  const { values, vectors } = symEig(Kc, nc);

  const keep = [];
  for (let k = 0; k < nc; k++) {
    const f = Math.sqrt(Math.max(0, values[k])) / (2 * Math.PI);
    if (f > 20 && f < fMax) keep.push([k, f]);
  }
  const K = keep.length;
  const body = {
    name: inst.name, grid: gridTop, gridBack, K, holeArea: S,
    f: new Float64Array(K), eta: new Float64Array(K),
    shapeTop: new Float64Array(K * nodes), shapeBack: new Float64Array(K * nodes), hole: new Float64Array(K),
    phi: new Float64Array(6 * K), rock: new Float64Array(6 * K), z: new Float64Array(6),
  };
  const z = new Float64Array(nc);
  keep.forEach(([src, f], k) => {
    for (let p = 0; p < nc; p++) z[p] = vectors[p * nc + src] * rm[p]; // mass-normalised coordinates
    // reproducible sign: the top moves outwards at the bridge
    const st = body.shapeTop.subarray(k * nodes, (k + 1) * nodes), sb = body.shapeBack.subarray(k * nodes, (k + 1) * nodes);
    for (let i = 0; i < nodes; i++) {
      const dt = gridTop.dof[i], db = gridBack.dof[i];
      if (dt >= 0) { let v = 0; for (let m = 0; m < nTop; m++) v += z[m] * top.phi[m * top.n + dt]; st[i] = v; }
      if (db >= 0) { let v = 0; for (let m = 0; m < nBack; m++) v += z[nTop + m] * back.phi[m * back.n + db]; sb[i] = v; }
    }
    let sign = sample(gridTop, body.shapeTop, k * nodes, 0, inst.saddle.y) < 0 ? -1 : 1;
    if (sign < 0) { for (let i = 0; i < nodes; i++) { st[i] = -st[i]; sb[i] = -sb[i]; } }
    body.hole[k] = sign * z[iHole];
    body.f[k] = f;
    for (let s = 0; s < 6; s++) {
      const x = inst.saddle.xs[s], y = inst.saddle.y;
      body.phi[s * K + k] = sample(gridTop, body.shapeTop, k * nodes, x, y);
      body.rock[s * K + k] = (inst.saddle.height * (sample(gridTop, body.shapeTop, k * nodes, x + h, y) - sample(gridTop, body.shapeTop, k * nodes, x - h, y))) / (2 * h);
    }
    // losses: by where the mode's energy sits, plus what it radiates
    let eTop = 0, eBack = 0, eAir = 0, vol = 0;
    for (let m = 0; m < nTop; m++) eTop += z[m] * z[m];
    for (let m = 0; m < nBack; m++) eBack += z[nTop + m] * z[nTop + m];
    for (let a = 1; a < nAir; a++) eAir += z[iHole + a] * z[iHole + a] * M[iHole + a];
    const eHole = z[iHole] * z[iHole] * M[iHole];
    for (let i = 0; i < nodes; i++) vol += (st[i] + sb[i]) * h2;
    vol += body.hole[k] * S;
    const w = 2 * Math.PI * f;
    const etaHole = 0.01 + (w * inst.hole.r ** 2) / (2 * AIR.c * neck);
    const etaRad = (AIR.rho * w * vol * vol) / (4 * Math.PI * AIR.c);
    // wood loses less per cycle higher up (the low resonances also work the glue lines, linings and finish)
    const etaWood = inst.eta.woodHigh + (inst.eta.wood - inst.eta.woodHigh) / (1 + (f / 600) ** 2);
    body.eta[k] = (eTop + eBack) * etaWood + eAir * inst.eta.air + eHole * etaHole + etaRad;
  });
  for (let s = 0; s < 6; s++) body.z[s] = 2 * inst.strings.scale * 440 * Math.pow(2, (OPEN_MIDI[s] - 69) / 12) * inst.strings.mu[s];
  body.parts = { nTop, nBack, nAir, topF: top.f, backF: back.f, airF: air.f };
  return body;
}

// Velocity at string i's saddle point per unit force at string j's, at
// frequency f (Hz):  Σ_k c_ik c_jk · jω / (ω_k²(1 + jη_k) − ω²).
// rockI / rockJ select the bridge-rocking coupling (force along the top).
export function bridgeAdmittance(body, i, j, f, { rockI = false, rockJ = false } = {}) {
  const w = 2 * Math.PI * f, K = body.K;
  const ci = rockI ? body.rock : body.phi, cj = rockJ ? body.rock : body.phi;
  let re = 0, im = 0;
  for (let k = 0; k < K; k++) {
    const wk2 = (2 * Math.PI * body.f[k]) ** 2;
    const dr = wk2 - w * w, di = body.eta[k] * wk2;
    const g = (ci[i * K + k] * cj[j * K + k] * w) / (dr * dr + di * di);
    re += g * di; im += g * dr;
  }
  return { re, im };
}

// What the bridge looks like to a string above the modelled resonances: the
// point conductance of an endless plate with the top's stiffness and weight at
// the bridge,  1 / (8 √(D m)).
export function plateConductance(inst) {
  const D = stiffness(inst.top.wood, inst.top.thickness);
  let m = inst.top.wood.rho * inst.top.thickness;
  for (const p of inst.top.patches || []) {
    if (0 < p.x0 || 0 > p.x1 || inst.saddle.y < p.y0 || inst.saddle.y > p.y1) continue;
    const d = stiffness(p.wood, p.thickness);
    D.Dx += d.Dx; D.Dy += d.Dy;
    m += p.wood.rho * p.thickness;
  }
  return 1 / (8 * Math.sqrt(Math.sqrt(D.Dx * D.Dy) * m));
}
