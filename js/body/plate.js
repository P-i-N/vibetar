// Stiffness and mass of a thin, braced, orthotropic plate on a grid.
//
// Assembled from the bending energy, so K is symmetric and non-negative by
// construction:
//   U = h²/2 Σ_nodes [κx κy]·[[Dx, D1],[D1, Dy]]·[κx κy]ᵀ + h²/2 Σ_cells 4 Dk κxy²
//       + ½ Σ_brace samples EI · ds · κθ²
// with second differences for the curvatures. Outside nodes are held at zero
// (a hinged edge); terms that would reach into a hole are left out (a free edge).

import { lowestModes } from './eigen.js';
import { nodeAt } from './grid.js';

// bending stiffnesses of a layer; the grain runs along y
export function stiffness(wood, t) {
  const nuRL = (wood.nuLR * wood.ER) / wood.EL;
  const den = 12 * (1 - wood.nuLR * nuRL);
  const Dy = (wood.EL * t ** 3) / den, Dx = (wood.ER * t ** 3) / den;
  return { Dx, Dy, D1: nuRL * Dy, Dk: (wood.GLR * t ** 3) / 12 };
}

export function assemblePlate(grid, { wood, thickness, braces = [], patches = [], clamp = 0 }) {
  const { nx, ny, h, type, dof, n } = grid;
  const h2 = h * h;
  const M = new Float64Array(n);
  const rows = [], cols = [], vals = [];
  const tp = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : type[j * nx + i]);
  // w * a bᵀ, lower triangle only; a, b are lists of [i, j, coefficient]
  const outer = (a, b, w) => {
    for (const [ia, ja, ca] of a) {
      const da = tp(ia, ja) === 1 ? dof[ja * nx + ia] : -1;
      if (da < 0) continue;
      for (const [ib, jb, cb] of b) {
        const db = tp(ib, jb) === 1 ? dof[jb * nx + ib] : -1;
        if (db < 0 || db > da) continue;
        rows.push(da); cols.push(db); vals.push(w * ca * cb);
      }
    }
  };
  const free = (st) => st.every(([i, j]) => tp(i, j) !== 2);
  const sx = (i, j) => [[i - 1, j, 1 / h2], [i, j, -2 / h2], [i + 1, j, 1 / h2]];
  const sy = (i, j) => [[i, j - 1, 1 / h2], [i, j, -2 / h2], [i, j + 1, 1 / h2]];

  const base = stiffness(wood, thickness);
  const layers = patches.map((p) => ({ ...p, D: stiffness(p.wood, p.thickness), count: 0 }));
  const within = (p, x, y) => x >= p.x0 - 1e-9 && x <= p.x1 + 1e-9 && y >= p.y0 - 1e-9 && y <= p.y1 + 1e-9;
  const Dat = (x, y) => {
    const D = { ...base };
    for (const p of layers) if (within(p, x, y)) { D.Dx += p.D.Dx; D.Dy += p.D.Dy; D.D1 += p.D.D1; D.Dk += p.D.Dk; }
    return D;
  };

  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const t = tp(i, j);
    let wgt = 0;
    if (t === 1) wgt = 1;
    else if (t === 0 && clamp > 0 && (tp(i - 1, j) === 1 || tp(i + 1, j) === 1 || tp(i, j - 1) === 1 || tp(i, j + 1) === 1)) wgt = clamp;
    if (wgt > 0) {
      const D = Dat(grid.x(i), grid.y(j));
      const cx = sx(i, j), cy = sy(i, j);
      const okx = free(cx), oky = free(cy);
      if (okx) outer(cx, cx, wgt * h2 * D.Dx);
      if (oky) outer(cy, cy, wgt * h2 * D.Dy);
      if (okx && oky) { outer(cx, cy, wgt * h2 * D.D1); outer(cy, cx, wgt * h2 * D.D1); }
    }
    // twist of the cell (i, j)-(i+1, j+1)
    const cell = [[i, j, 1 / h2], [i + 1, j, -1 / h2], [i, j + 1, -1 / h2], [i + 1, j + 1, 1 / h2]];
    if (free(cell) && cell.some(([a, b]) => tp(a, b) === 1)) {
      outer(cell, cell, h2 * 4 * Dat(grid.x(i) + h / 2, grid.y(j) + h / 2).Dk);
    }
    if (t === 1) {
      const d = dof[j * nx + i];
      M[d] += wood.rho * thickness * h2;
      for (const p of layers) if (within(p, grid.x(i), grid.y(j))) { M[d] += p.wood.rho * p.thickness * h2; p.count++; }
    }
  }
  // concentrated patch masses, spread over the patch
  for (const p of layers) {
    if (!p.mass || !p.count) continue;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (tp(i, j) === 1 && within(p, grid.x(i), grid.y(j))) M[dof[j * nx + i]] += p.mass / p.count;
    }
  }
  // braces: beams glued to one face. Each is a beam along its own line: its
  // curvature is the second difference of the plate's deflection sampled on
  // that line (bilinear between nodes), so it cannot be dodged by wrinkling
  // the plate between nodes.
  const gx = (x) => x / h + (nx - 1) / 2, gy = (y) => (y - grid.y(0)) / h;
  const at = (x, y, coef) => {
    const fx = gx(x), fy = gy(y), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    return [[i, j, coef * (1 - u) * (1 - v)], [i + 1, j, coef * u * (1 - v)], [i, j + 1, coef * (1 - u) * v], [i + 1, j + 1, coef * u * v]];
  };
  for (const br of braces) {
    const len = Math.hypot(br.x1 - br.x0, br.y1 - br.y0);
    const steps = Math.max(1, Math.round(len / (h / 2)));
    const ds = len / steps;
    const c = (br.x1 - br.x0) / len, s = (br.y1 - br.y0) / len;
    const EI = (br.wood.EL * br.b * br.hgt ** 3) / 3;
    for (let k = 0; k < steps; k++) {
      const u = (k + 0.5) / steps;
      const px = br.x0 + u * (br.x1 - br.x0), py = br.y0 + u * (br.y1 - br.y0);
      const { i, j } = nodeAt(grid, px, py);
      if (tp(i, j) !== 1) continue;
      M[dof[j * nx + i]] += br.wood.rho * br.b * br.hgt * ds;
      const st = [...at(px - h * c, py - h * s, 1 / h2), ...at(px, py, -2 / h2), ...at(px + h * c, py + h * s, 1 / h2)].filter(([, , v]) => v !== 0);
      // A feathered brace fades out before the edge: it only counts where it lies fully on
      // the plate. A tucked brace runs into the lining and is held there (built-in end).
      if (br.tucked ? free(st) : st.every(([a, b]) => tp(a, b) === 1)) outer(st, st, EI * ds);
    }
  }
  let bw = 0;
  for (let k = 0; k < rows.length; k++) if (rows[k] - cols[k] > bw) bw = rows[k] - cols[k];
  const K = new Float64Array(n * (bw + 1));
  for (let k = 0; k < rows.length; k++) K[rows[k] * (bw + 1) + (rows[k] - cols[k])] += vals[k];
  return { K, M, n, bw };
}

// lowest `count` modes: frequencies in Hz, shapes mass-normalised (phi[k * n + dof])
export function plateModes(grid, spec, count) {
  const { K, M, n, bw } = assemblePlate(grid, spec);
  const { w2, phi } = lowestModes({ K, M, n, bw, count });
  const f = new Float64Array(w2.length);
  for (let k = 0; k < w2.length; k++) f[k] = Math.sqrt(Math.max(0, w2[k])) / (2 * Math.PI);
  return { f, w2, phi, n, M };
}
