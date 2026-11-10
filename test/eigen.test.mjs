import test from 'node:test';
import assert from 'node:assert/strict';
import { choleskyBanded, solveBanded, symEig, lowestModes } from '../js/body/eigen.js';

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
const at = (A, bw, i, j) => (i >= j ? (i - j <= bw ? A[i * (bw + 1) + (i - j)] : 0) : (j - i <= bw ? A[j * (bw + 1) + (j - i)] : 0));

test('symEig reproduces a known spectrum', () => {
  const n = 8, r = rng(1);
  // random symmetric matrix with known eigenvalues: A = Q diag(1..8) Q^T, Q from Gram-Schmidt
  const Q = [];
  for (let k = 0; k < n; k++) {
    const v = Array.from({ length: n }, () => r() - 0.5);
    for (const q of Q) { const d = q.reduce((a, x, i) => a + x * v[i], 0); for (let i = 0; i < n; i++) v[i] -= d * q[i]; }
    const nm = Math.hypot(...v); Q.push(v.map((x) => x / nm));
  }
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) A[i * n + j] += Q[k][i] * (k + 1) * Q[k][j];
  const { values, vectors } = symEig(A.slice(), n);
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(values[k] - (k + 1)) < 1e-9, `value ${k}: ${values[k]}`);
    for (let i = 0; i < n; i++) {
      let av = 0;
      for (let j = 0; j < n; j++) av += A[i * n + j] * vectors[j * n + k];
      assert.ok(Math.abs(av - values[k] * vectors[i * n + k]) < 1e-9);
    }
  }
});

test('banded Cholesky solves a pentadiagonal system', () => {
  const n = 60, bw = 2, r = rng(2);
  const A = new Float64Array(n * (bw + 1));
  for (let i = 0; i < n; i++) { A[i * 3] = 6 + r(); if (i > 0) A[i * 3 + 1] = -2 + 0.3 * r(); if (i > 1) A[i * 3 + 2] = 0.5 * r(); }
  const x0 = Float64Array.from({ length: n }, () => r() - 0.5), b = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let j = Math.max(0, i - bw); j <= Math.min(n - 1, i + bw); j++) b[i] += at(A, bw, i, j) * x0[j];
  const L = choleskyBanded(A, n, bw);
  solveBanded(L, n, bw, b);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(b[i] - x0[i]) < 1e-9);
});

test('Cholesky rejects a matrix that is not positive definite', () => {
  assert.throws(() => choleskyBanded(Float64Array.from([1, 0, -1, 0]), 2, 1));
});

const chain = (n, free) => {
  const K = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { K[i * 2] = free && (i === 0 || i === n - 1) ? 1 : 2; if (i > 0) K[i * 2 + 1] = -1; }
  return K;
};

test('lowestModes finds the lowest modes of a fixed-fixed string', () => {
  const n = 400, count = 40;
  const { w2 } = lowestModes({ K: chain(n, false), M: new Float64Array(n).fill(1), n, bw: 1, count });
  for (let k = 0; k < count; k++) {
    const exact = 4 * Math.sin((Math.PI * (k + 1)) / (2 * (n + 1))) ** 2;
    assert.ok(Math.abs(w2[k] / exact - 1) < 1e-8, `mode ${k}: ${w2[k]} vs ${exact}`);
  }
});

test('lowestModes with a shift handles a singular K', () => {
  const n = 200;
  const { w2 } = lowestModes({ K: chain(n, true), M: new Float64Array(n).fill(1), n, bw: 1, count: 6, shift: 1e-3 });
  assert.ok(Math.abs(w2[0]) < 1e-9, `rigid mode ${w2[0]}`);
  for (let k = 1; k < 6; k++) assert.ok(Math.abs(w2[k] / (4 * Math.sin((Math.PI * k) / (2 * n)) ** 2) - 1) < 1e-8);
});

test('modes are mass-orthonormal and satisfy K phi = w2 M phi', () => {
  const n = 150, count = 12, r = rng(3);
  const M = Float64Array.from({ length: n }, () => 0.5 + r());
  const K = chain(n, false);
  const { w2, phi } = lowestModes({ K, M, n, bw: 1, count });
  for (let a = 0; a < count; a++) {
    for (let b = a; b < count; b++) {
      let d = 0;
      for (let i = 0; i < n; i++) d += phi[a * n + i] * M[i] * phi[b * n + i];
      assert.ok(Math.abs(d - (a === b ? 1 : 0)) < 1e-8, `phi${a}.M.phi${b} = ${d}`);
    }
    for (let i = 1; i < n - 1; i++) {
      const kp = 2 * phi[a * n + i] - phi[a * n + i - 1] - phi[a * n + i + 1];
      assert.ok(Math.abs(kp - w2[a] * M[i] * phi[a * n + i]) < 1e-8);
    }
  }
});
