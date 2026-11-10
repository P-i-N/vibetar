// The air inside the body, as a layer between top and back: its uniform
// "breathing" mode plus its lowest standing waves (rigid walls).

import { lowestModes } from './eigen.js';
import { AIR } from './instruments.js';

// grid: the air layer's plan (every node with type > 0 holds air).
// Returns f (Hz, f[0] = 0), psi[a * nodes + node] with mean square 1 over the
// air (psi[0] = 1 everywhere), mask (1 where there is air), area, volume.
export function cavityModes(grid, depth, count) {
  const { nx, ny, h, type } = grid;
  const nodes = nx * ny;
  const dof = new Int32Array(nodes).fill(-1), mask = new Uint8Array(nodes);
  let n = 0;
  for (let i = 0; i < nodes; i++) if (type[i] > 0) { dof[i] = n++; mask[i] = 1; }
  // ∫|∇ψ|² dA  ->  Σ over neighbouring air nodes (ψa − ψb)²
  const bw = nx;
  const K = new Float64Array(n * (bw + 1)), M = new Float64Array(n).fill(h * h);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = dof[j * nx + i];
    if (a < 0) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      if (i + di >= nx || j + dj >= ny) continue;
      const b = dof[(j + dj) * nx + i + di];
      if (b < 0) continue;
      K[a * (bw + 1)] += 1; K[b * (bw + 1)] += 1; K[b * (bw + 1) + (b - a)] -= 1;
    }
  }
  const { w2, phi } = lowestModes({ K, M, n, bw, count, shift: 1 });
  const area = n * h * h;
  const f = new Float64Array(count), psi = new Float64Array(count * nodes);
  for (let a = 0; a < count; a++) {
    f[a] = (AIR.c * Math.sqrt(Math.max(0, w2[a]))) / (2 * Math.PI);
    // mass-normalised (Σ ψ² h² = 1) -> mean square 1; fix the sign so results are reproducible
    let big = 0;
    for (let i = 0; i < n; i++) if (Math.abs(phi[a * n + i]) > Math.abs(big)) big = phi[a * n + i];
    const s = Math.sqrt(area) * (big < 0 ? -1 : 1);
    for (let i = 0; i < nodes; i++) if (dof[i] >= 0) psi[a * nodes + i] = a === 0 ? 1 : phi[a * n + dof[i]] * s;
  }
  f[0] = 0;
  return { f, psi, mask, area, volume: area * depth };
}
