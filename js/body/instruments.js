// Geometry and materials of the modelled instruments. Metres, kilograms,
// pascals. x runs across the strings (bass side negative), y along the body
// from the neck end. Typical values for the type of instrument; the plates are
// glued to the linings all round (a clamped edge). With these the air and
// main top resonances come out where real instruments have them, untuned.

import { makeGrid } from './grid.js';

// { EL along the grain, ER across it, GLR shear, nuLR, rho }
export const WOODS = {
  spruce: { EL: 11e9, ER: 0.8e9, GLR: 0.7e9, nuLR: 0.37, rho: 420 },
  cedar: { EL: 8e9, ER: 0.75e9, GLR: 0.6e9, nuLR: 0.37, rho: 370 },
  mahogany: { EL: 10e9, ER: 1.1e9, GLR: 0.8e9, nuLR: 0.35, rho: 560 },
  rosewood: { EL: 13e9, ER: 1.9e9, GLR: 1.0e9, nuLR: 0.36, rho: 800 },
  maple: { EL: 12e9, ER: 1.3e9, GLR: 1.0e9, nuLR: 0.4, rho: 650 },
};
const W = WOODS;

export const AIR = { rho: 1.2, c: 343 };

const brace = (x0, y0, x1, y1, b, hgt, wood = W.spruce) => ({ x0, y0, x1, y1, b, hgt, wood });
// main braces run into the lining and are held there; the small ones are feathered out before the edge
const tucked = (br) => ({ ...br, tucked: true });
// a brace through (cx, cy) at `deg` degrees from the centre line, reaching `up` towards the neck and `down` towards the tail
const slanted = (cx, cy, deg, up, down, b, hgt) => {
  const s = Math.sin((deg * Math.PI) / 180), c = Math.cos((deg * Math.PI) / 180);
  return brace(cx - up * s, cy - up * c, cx + down * s, cy + down * c, b, hgt);
};
const mirror = (br) => ({ ...br, x0: -br.x0, x1: -br.x1 });
const SADDLE_X = [-0.0275, -0.0165, -0.0055, 0.0055, 0.0165, 0.0275];

function xBraced({ cross, bw, bh, bridgeY, bridge }) {
  const leg = tucked(slanted(0, cross, 49, 0.16, 0.25, bw, bh));
  const finger = [brace(0.10, cross + 0.055, 0.18, cross + 0.025, 0.005, 0.006), brace(0.125, cross + 0.10, 0.195, cross + 0.075, 0.005, 0.006)];
  return {
    braces: [
      leg, mirror(leg),
      brace(-0.03, cross + 0.085, 0.13, cross + 0.205, 0.006, 0.010),   // tone bars, as on the real thing not symmetric
      brace(-0.10, cross + 0.115, 0.06, cross + 0.235, 0.006, 0.010),
      ...finger, ...finger.map(mirror),
      tucked(brace(-0.15, 0.085, 0.15, 0.085, 0.012, 0.016)),            // upper transverse bar
    ],
    patches: [
      { x0: -bridge.w / 2, y0: bridgeY - 0.012, x1: bridge.w / 2, y1: bridgeY + bridge.d - 0.012, thickness: bridge.t, wood: W.rosewood, mass: 0 },
      { x0: -0.08, y0: bridgeY - 0.02, x1: 0.08, y1: bridgeY + 0.025, thickness: 0.0025, wood: W.maple, mass: 0 }, // bridge plate
    ],
  };
}

function fanBraced({ bridgeY, bridge }) {
  const fans = [];
  for (let k = -3; k <= 3; k++) fans.push(brace(k * 0.02, 0.20, k * 0.05, 0.44, 0.004, 0.005));
  return {
    braces: [...fans, tucked(brace(-0.14, 0.085, 0.14, 0.085, 0.007, 0.014)), tucked(brace(-0.12, 0.195, 0.12, 0.195, 0.007, 0.014))],
    patches: [{ x0: -bridge.w / 2, y0: bridgeY - 0.010, x1: bridge.w / 2, y1: bridgeY + bridge.d - 0.010, thickness: bridge.t, wood: W.rosewood, mass: 0 }],
  };
}

const ladder = (ys, half, b, hgt) => ys.map((y) => tucked(brace(-half, y, half, y, b, hgt)));

export const INSTRUMENTS = {
  // dreadnought, X-braced spruce top
  steel: {
    name: 'steel',
    outline: { length: 0.505, upper: 0.292, waist: 0.273, lower: 0.396, yUpper: 0.10, yWaist: 0.19, yLower: 0.36 },
    depth: 0.110,
    hole: { y: 0.145, r: 0.050 },
    top: { wood: W.spruce, thickness: 0.0028, clamp: 1, ...xBraced({ cross: 0.230, bw: 0.008, bh: 0.014, bridgeY: 0.287, bridge: { w: 0.150, d: 0.030, t: 0.008 } }) },
    back: { wood: W.mahogany, thickness: 0.0026, clamp: 1, braces: ladder([0.10, 0.20, 0.30, 0.40], 0.2, 0.007, 0.015), patches: [] },
    saddle: { y: 0.287, xs: SADDLE_X, height: 0.012 },
    strings: { mu: [6.8e-3, 3.9e-3, 2.2e-3, 1.25e-3, 0.62e-3, 0.40e-3], scale: 0.648 },
    mics: [{ x: -0.02, y: 0.06, z: 0.40 }, { x: 0.07, y: 0.36, z: 0.42 }],
    eta: { wood: 0.022, air: 0.025 },
  },
  // classical, fan-braced cedar top
  nylon: {
    name: 'nylon',
    outline: { length: 0.485, upper: 0.275, waist: 0.235, lower: 0.365, yUpper: 0.095, yWaist: 0.185, yLower: 0.35 },
    depth: 0.095,
    hole: { y: 0.135, r: 0.043 },
    top: { wood: W.cedar, thickness: 0.0023, clamp: 1, ...fanBraced({ bridgeY: 0.325, bridge: { w: 0.190, d: 0.028, t: 0.005 } }) },
    back: { wood: W.rosewood, thickness: 0.0025, clamp: 1, braces: ladder([0.11, 0.24, 0.37], 0.19, 0.006, 0.014), patches: [] },
    saddle: { y: 0.325, xs: SADDLE_X.map((x) => x * 1.08), height: 0.010 },
    strings: { mu: [5.4e-3, 3.4e-3, 1.9e-3, 0.95e-3, 0.55e-3, 0.38e-3], scale: 0.650 },
    mics: [{ x: -0.02, y: 0.05, z: 0.38 }, { x: 0.06, y: 0.35, z: 0.40 }],
    eta: { wood: 0.022, air: 0.025 },
  },
  // jumbo 12-string, heavier X-bracing
  twelve: {
    name: 'twelve',
    outline: { length: 0.520, upper: 0.300, waist: 0.260, lower: 0.430, yUpper: 0.105, yWaist: 0.20, yLower: 0.375 },
    depth: 0.115,
    hole: { y: 0.150, r: 0.050 },
    top: { wood: W.spruce, thickness: 0.0030, clamp: 1, ...xBraced({ cross: 0.235, bw: 0.009, bh: 0.016, bridgeY: 0.290, bridge: { w: 0.160, d: 0.032, t: 0.009 } }) },
    back: { wood: W.mahogany, thickness: 0.0028, clamp: 1, braces: ladder([0.10, 0.20, 0.31, 0.42], 0.215, 0.008, 0.016), patches: [] },
    saddle: { y: 0.290, xs: SADDLE_X, height: 0.012 },
    strings: { mu: [6.8e-3, 3.9e-3, 2.2e-3, 1.25e-3, 0.62e-3, 0.40e-3], scale: 0.648 },
    mics: [{ x: -0.02, y: 0.06, z: 0.40 }, { x: 0.07, y: 0.36, z: 0.42 }],
    eta: { wood: 0.022, air: 0.025 },
  },
};

// half width of the body at y: round shoulders, a waist, a round lower bout
export function halfWidth(o, y) {
  if (y <= 0 || y >= o.length) return 0;
  const cap = (u, p) => Math.pow(Math.max(0, 1 - Math.pow(u, p)), 1 / p);
  const ease = (a, b, u) => a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * u));
  if (y < o.yUpper) return (o.upper / 2) * cap((o.yUpper - y) / o.yUpper, 2.3);
  if (y < o.yWaist) return ease(o.upper / 2, o.waist / 2, (y - o.yUpper) / (o.yWaist - o.yUpper));
  if (y < o.yLower) return ease(o.waist / 2, o.lower / 2, (y - o.yWaist) / (o.yLower - o.yWaist));
  return (o.lower / 2) * cap((y - o.yLower) / (o.length - o.yLower), 2.1);
}

// the grid of an instrument's top (with the sound hole cut out) or back / air layer (without)
export function outlineGrid(inst, h, withHole) {
  const o = inst.outline;
  return makeGrid({
    width: Math.max(o.upper, o.lower), length: o.length, h,
    inside: (x, y) => {
      if (Math.abs(x) >= halfWidth(o, y) - 1e-9) return 0;
      return withHole && Math.hypot(x, y - inst.hole.y) < inst.hole.r ? 2 : 1;
    },
  });
}
