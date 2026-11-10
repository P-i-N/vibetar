// Linear algebra for the body model: banded Cholesky, a dense symmetric
// eigen-solver, and the lowest modes of K φ = ω² M φ by shift-invert Lanczos.
//
// Banded symmetric storage: Float64Array(n * (bw + 1)); entry (i, j) with
// 0 <= i - j <= bw lives at i * (bw + 1) + (i - j).

export function choleskyBanded(A, n, bw) {
  const w = bw + 1;
  const L = new Float64Array(n * w);
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let s = A[i * w + (i - j)];
      for (let k = Math.max(j0, j - bw); k < j; k++) s -= L[i * w + (i - k)] * L[j * w + (j - k)];
      if (j < i) L[i * w + (i - j)] = s / L[j * w];
      else {
        if (!(s > 0)) throw new Error(`matrix is not positive definite (row ${i})`);
        L[i * w] = Math.sqrt(s);
      }
    }
  }
  return L;
}

// solve L Lᵀ x = b in place
export function solveBanded(L, n, bw, b) {
  const w = bw + 1;
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = Math.max(0, i - bw); k < i; k++) s -= L[i * w + (i - k)] * b[k];
    b[i] = s / L[i * w];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    const hi = Math.min(n - 1, i + bw);
    for (let k = i + 1; k <= hi; k++) s -= L[k * w + (k - i)] * b[k];
    b[i] = s / L[i * w];
  }
}

// All eigenvalues (ascending) and eigenvectors of a dense symmetric matrix.
// A is row-major n x n and is overwritten; eigenvector k is column k:
// vectors[i * n + k]. Householder tridiagonalisation + implicit QL.
export function symEig(A, n) {
  const V = A, d = new Float64Array(n), e = new Float64Array(n);
  for (let j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) { d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0; V[j * n + i] = 0; }
    } else {
      for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1], g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j]; V[j * n + i] = f; g = e[j] + V[j * n + j] * f;
        for (let k = j + 1; k < i; k++) { g += V[k * n + j] * d[k]; e[k] += V[k * n + j] * f; }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (let k = j; k < i; k++) V[k * n + j] -= f * e[k] + g * d[k];
        d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = V[i * n + i]; V[i * n + i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j];
        for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0;
  }
  for (let j = 0; j < n; j++) { d[j] = V[(n - 1) * n + j]; V[(n - 1) * n + j] = 0; }
  V[(n - 1) * n + n - 1] = 1; e[0] = 0;

  // implicit QL on the tridiagonal (d, e)
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = Math.pow(2, -52);
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n - 1 && Math.abs(e[m]) > eps * tst1) m++;
    if (m > l) {
      let iter = 0;
      do {
        if (++iter > 200) throw new Error('eigen-solver did not converge');
        let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = 1, c3 = 1, s = 0, s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s;
          g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
          e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) {
            h = V[k * n + i + 1];
            V[k * n + i + 1] = s * V[k * n + i] + c * h;
            V[k * n + i] = c * V[k * n + i] - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1; e[l] = s * p; d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f; e[l] = 0;
  }
  // sort ascending
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[a] - d[b]);
  const values = new Float64Array(n), vectors = new Float64Array(n * n);
  order.forEach((src, k) => {
    values[k] = d[src];
    for (let i = 0; i < n; i++) vectors[i * n + k] = V[i * n + src];
  });
  return { values, vectors };
}

// Lowest `count` modes of K φ = ω² M φ, K banded symmetric positive
// (semi-)definite, M a positive diagonal. `shift` > 0 is needed when K is
// singular. Returns ω² ascending and mass-normalised modes: phi[k * n + i].
export function lowestModes({ K, M, n, bw, count, shift = 0 }) {
  count = Math.min(count, n);
  const w = bw + 1;
  const Ks = K.slice();
  if (shift) for (let i = 0; i < n; i++) Ks[i * w] += shift * M[i];
  const L = choleskyBanded(Ks, n, bw);
  const rootM = new Float64Array(n);
  for (let i = 0; i < n; i++) rootM[i] = Math.sqrt(M[i]);
  // Lanczos on the symmetric operator  M^½ (K + shift·M)⁻¹ M^½
  const m = Math.min(n, 2 * count + 30);
  const Q = new Float64Array(m * n), alpha = new Float64Array(m), beta = new Float64Array(m);
  let seed = 12345;
  let nrm = 0;
  for (let i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; Q[i] = seed / 4294967296 - 0.5; nrm += Q[i] * Q[i]; }
  nrm = Math.sqrt(nrm);
  for (let i = 0; i < n; i++) Q[i] /= nrm;
  const r = new Float64Array(n);
  let steps = m;
  for (let j = 0; j < m; j++) {
    const q = Q.subarray(j * n, (j + 1) * n);
    for (let i = 0; i < n; i++) r[i] = rootM[i] * q[i];
    solveBanded(L, n, bw, r);
    for (let i = 0; i < n; i++) r[i] *= rootM[i];
    let a = 0;
    for (let i = 0; i < n; i++) a += r[i] * q[i];
    alpha[j] = a;
    // full re-orthogonalisation, twice
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k <= j; k++) {
        const qk = Q.subarray(k * n, (k + 1) * n);
        let d = 0;
        for (let i = 0; i < n; i++) d += r[i] * qk[i];
        for (let i = 0; i < n; i++) r[i] -= d * qk[i];
      }
    }
    let b = 0;
    for (let i = 0; i < n; i++) b += r[i] * r[i];
    b = Math.sqrt(b);
    if (j + 1 === m) break;
    if (b < 1e-12 * Math.abs(alpha[0])) { steps = j + 1; break; }
    beta[j + 1] = b;
    const nx = Q.subarray((j + 1) * n, (j + 2) * n);
    for (let i = 0; i < n; i++) nx[i] = r[i] / b;
  }
  const T = new Float64Array(steps * steps);
  for (let j = 0; j < steps; j++) {
    T[j * steps + j] = alpha[j];
    if (j + 1 < steps) { T[j * steps + j + 1] = beta[j + 1]; T[(j + 1) * steps + j] = beta[j + 1]; }
  }
  const { values, vectors } = symEig(T, steps);
  count = Math.min(count, steps);
  const w2 = new Float64Array(count), phi = new Float64Array(count * n);
  for (let k = 0; k < count; k++) {
    const src = steps - 1 - k; // largest θ = 1/(ω² + shift) first
    w2[k] = 1 / values[src] - shift;
    const out = phi.subarray(k * n, (k + 1) * n);
    for (let j = 0; j < steps; j++) {
      const c = vectors[j * steps + src];
      if (c === 0) continue;
      const q = Q.subarray(j * n, (j + 1) * n);
      for (let i = 0; i < n; i++) out[i] += c * q[i];
    }
    let s = 0;
    for (let i = 0; i < n; i++) { out[i] /= rootM[i]; s += out[i] * out[i] * M[i]; }
    s = 1 / Math.sqrt(s);
    for (let i = 0; i < n; i++) out[i] *= s;
  }
  return { w2, phi };
}
