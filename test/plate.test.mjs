import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid } from '../js/body/grid.js';
import { assemblePlate, plateModes } from '../js/body/plate.js';

const A = 0.4, B = 0.5, H = 0.01; // plate: A across (x), B along (y)
const rect = (hole) => makeGrid({
  width: A, length: B, h: H,
  inside: (x, y) => (Math.abs(x) < A / 2 - 1e-9 && y > 1e-9 && y < B - 1e-9 ? (hole && Math.hypot(x, y - 0.25) < 0.05 ? 2 : 1) : 0),
});
const iso = { EL: 10e9, ER: 10e9, GLR: 10e9 / 2.6, nuLR: 0.3, rho: 500 };
const spruce = { EL: 11e9, ER: 0.8e9, GLR: 0.7e9, nuLR: 0.37, rho: 420 };
const T = 0.003;

// index of the computed mode that looks most like sin(m pi x/A) sin(n pi y/B)
function find(grid, modes, m, n) {
  let best = -1, bestC = 0;
  for (let k = 0; k < modes.f.length; k++) {
    let c = 0;
    for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
      const d = grid.dof[j * grid.nx + i];
      if (d >= 0) c += modes.phi[k * modes.n + d] * Math.sin((m * Math.PI * (grid.x(i) + A / 2)) / A) * Math.sin((n * Math.PI * grid.y(j)) / B);
    }
    if (Math.abs(c) > bestC) { bestC = Math.abs(c); best = k; }
  }
  return best;
}

test('the grid marks plate, outside and hole nodes', () => {
  const g = rect(true);
  assert.equal(g.n, 39 * 49 - [...g.type].filter((t) => t === 2).length);
  assert.ok([...g.type].filter((t) => t === 2).length > 60);
  assert.ok(Math.abs(g.x(0) + g.x(g.nx - 1)) < 1e-12, 'x is centred');
});

test('isotropic simply supported plate matches the textbook', () => {
  const g = rect(false);
  const modes = plateModes(g, { wood: iso, thickness: T }, 10);
  const D = (iso.EL * T ** 3) / (12 * (1 - 0.09));
  const exact = [];
  for (let m = 1; m <= 5; m++) for (let n = 1; n <= 5; n++) exact.push((Math.PI / 2) * Math.sqrt(D / (iso.rho * T)) * ((m / A) ** 2 + (n / B) ** 2));
  exact.sort((a, b) => a - b);
  for (let k = 0; k < 10; k++) assert.ok(Math.abs(modes.f[k] / exact[k] - 1) < 0.02, `mode ${k}: ${modes.f[k].toFixed(1)} vs ${exact[k].toFixed(1)}`);
});

test('orthotropic plate matches the textbook', () => {
  const g = rect(false);
  const modes = plateModes(g, { wood: spruce, thickness: T }, 8);
  const nuRL = (spruce.nuLR * spruce.ER) / spruce.EL, den = 12 * (1 - spruce.nuLR * nuRL);
  const Dy = (spruce.EL * T ** 3) / den, Dx = (spruce.ER * T ** 3) / den, D1 = nuRL * Dy, Dk = (spruce.GLR * T ** 3) / 12;
  const exact = [];
  for (let m = 1; m <= 8; m++) for (let n = 1; n <= 4; n++) exact.push((Math.PI / 2 / Math.sqrt(spruce.rho * T)) * Math.sqrt(Dx * (m / A) ** 4 + 2 * (D1 + 2 * Dk) * (m / A) ** 2 * (n / B) ** 2 + Dy * (n / B) ** 4));
  exact.sort((a, b) => a - b);
  for (let k = 0; k < 8; k++) assert.ok(Math.abs(modes.f[k] / exact[k] - 1) < 0.03, `mode ${k}: ${modes.f[k].toFixed(1)} vs ${exact[k].toFixed(1)}`);
});

test('a brace along x raises the modes that bend along x', () => {
  const g = rect(false);
  const plain = plateModes(g, { wood: iso, thickness: T }, 12);
  const braced = plateModes(g, { wood: iso, thickness: T, braces: [{ x0: -A / 2, y0: B / 2, x1: A / 2, y1: B / 2, b: 0.008, hgt: 0.012, wood: spruce }] }, 12);
  const rise = (m, n) => braced.f[find(g, braced, m, n)] / plain.f[find(g, plain, m, n)] - 1;
  assert.ok(rise(2, 1) > 0.15, `mode (2,1) rose ${rise(2, 1)}`);     // bends along x where the brace is
  assert.ok(Math.abs(rise(1, 2)) < 0.05, `mode (1,2) moved ${rise(1, 2)}`); // the brace lies on its nodal line
});

test('a brace adds its mass', () => {
  const g = rect(false);
  const sum = (spec) => assemblePlate(g, spec).M.reduce((a, b) => a + b, 0);
  const extra = sum({ wood: iso, thickness: T, braces: [{ x0: -0.1, y0: 0.1, x1: 0.1, y1: 0.3, b: 0.008, hgt: 0.012, wood: spruce }] }) - sum({ wood: iso, thickness: T });
  const want = spruce.rho * 0.008 * 0.012 * Math.hypot(0.2, 0.2);
  assert.ok(Math.abs(extra / want - 1) < 0.05, `${extra} vs ${want}`);
});

test('a hole lowers the stiffness; all modes stay non-negative', () => {
  const full = plateModes(rect(false), { wood: iso, thickness: T }, 6);
  const holed = plateModes(rect(true), { wood: iso, thickness: T }, 6);
  assert.ok(holed.f[0] < full.f[0] && holed.f[0] > 0.7 * full.f[0], `${holed.f[0]} vs ${full.f[0]}`);
  assert.ok(holed.f.every((f) => f > 0));
});

test('clamping the edge raises the fundamental towards the clamped value', () => {
  const g = makeGrid({ width: 0.4, length: 0.4, h: H, inside: (x, y) => (Math.abs(x) < 0.2 - 1e-9 && y > 1e-9 && y < 0.4 - 1e-9 ? 1 : 0) });
  const hinged = plateModes(g, { wood: iso, thickness: T }, 2).f[0];
  const clamped = plateModes(g, { wood: iso, thickness: T, clamp: 1 }, 2).f[0];
  assert.ok(clamped / hinged > 1.6 && clamped / hinged < 1.95, `ratio ${clamped / hinged}`);
});

test('a patch adds stiffness and its own mass', () => {
  const g = rect(false);
  const base = assemblePlate(g, { wood: iso, thickness: T });
  const patched = assemblePlate(g, { wood: iso, thickness: T, patches: [{ x0: -0.075, y0: 0.2, x1: 0.075, y1: 0.23, thickness: 0.008, wood: iso, mass: 0.03 }] });
  const dm = patched.M.reduce((a, b) => a + b, 0) - base.M.reduce((a, b) => a + b, 0);
  assert.ok(dm > 0.03 && dm < 0.03 + 2 * iso.rho * 0.008 * 0.15 * 0.03);
  assert.ok(plateModes(g, { wood: iso, thickness: T, patches: [{ x0: -0.075, y0: 0.2, x1: 0.075, y1: 0.23, thickness: 0.008, wood: iso, mass: 0 }] }, 1).f[0] > plateModes(g, { wood: iso, thickness: T }, 1).f[0]);
});
