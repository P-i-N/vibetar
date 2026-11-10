# Plucking Hand and Modelled Body Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace vibetar's pre-shaped pluck with a simulated pick / finger / nail contact, and its hand-tuned body filter with a computed model of the instrument that the strings couple to in both directions.

**Architecture:** The pluck becomes a per-sample spring-damper contact at the plucking point of the existing waveguide strings. The body becomes a one-time finite-difference modal analysis (braced top, back, air cavity, sound hole) run in a Web Worker; it yields stereo impulse responses for the existing convolution path and a small modal bridge model that runs inside the string engine.

**Tech Stack:** Plain ES modules, no dependencies, no build step. AudioWorklet (`js/worklet.js`), Web Worker, IndexedDB, Web Audio ConvolverNode. Tests: `node --test test/` (Node ≥ 22).

**Spec:** `docs/superpowers/specs/2026-11-10-plucking-hand-and-body-design.md`

## Global Constraints

- No packages, no build step; every new module must import in both the browser and Node.
- `js/worklet.js` stays a single file (no imports inside the audio worklet).
- Share links made before this change must load; new settings are appended numbers at the end of the instrument array (`INST_KEYS` in `js/song.js`).
- The bowed instrument's sound and code path do not change.
- The 22 existing tests keep passing; a threshold may change only where a task below says so.
- Until Task 11, "Classic" body + the old bridge junction must remain selectable and sound as today.
- Sustain per string within ±30 % of today's; loudness across picking techniques within ±3 dB.
- Build time target per instrument: ≤ 8 s in Node on the development machine.
- Commit after each task on branch `vibetar-app`. Do not push and do not deploy; publishing is the owner's call.

## Review Focus

1. **Play pressed before the body is ready, or instrument switched mid-song** — playback must continue on the classic body and crossfade to the modelled one without a click or a gap. (Task 9)
2. **Sample rates other than 48 kHz (44.1 k, 96 k)** — tuning, contact widths and impulse-response length must still hold. (Tasks 1, 8, 10)
3. **Low tunings, capo and the 24th fret** — contact taps, plucking taps and bridge impedances must stay valid when a string's delay line is as short as ~36 samples or as long as ~780. (Tasks 1, 10)
4. **A stale or corrupt cached body** (older model version, other sample rate, truncated record) — must be rebuilt, never used. (Task 9)
5. **Passages faster than the stroke's hold time** — the stroke is shortened; no contact may stay stuck on the string and every note still sounds. (Tasks 1, 2)

## File Structure

| File | Responsibility |
|---|---|
| `js/worklet.js` (modify) | string engine: add `Plucker` contact, `Bridge` modal termination, 4 output channels |
| `js/song.js` (modify) | picking setting, finger / stroke assignment, performance drift, link format |
| `js/body/eigen.js` (create) | banded Cholesky, Lanczos, dense symmetric eigen-solver |
| `js/body/grid.js` (create) | rasterise outline, hole and braces onto a regular grid |
| `js/body/plate.js` (create) | stiffness and mass of a braced orthotropic plate |
| `js/body/instruments.js` (create) | geometry, woods, bracing, strings, microphones per instrument |
| `js/body/cavity.js` (create) | air-cavity modes, sound-hole plug |
| `js/body/couple.js` (create) | coupled modal system, damping, bridge coefficients |
| `js/body/radiate.js` (create) | microphone responses, impulse responses, HF extension |
| `js/body/model.js` (create) | `buildBody(name, fs)` pipeline |
| `js/body/worker.js` (create) | worker entry point |
| `js/audio.js` (modify) | worker + cache, four convolvers, crossfade, engine config |
| `js/ir.js` (modify) | export the dense-field generator for the HF extension |
| `js/app.js`, `index.html`, `README.md` (modify) | controls, help, documentation |
| `test/pluck.test.mjs`, `test/perform.test.mjs`, `test/eigen.test.mjs`, `test/plate.test.mjs`, `test/body.test.mjs`, `test/bridge.test.mjs` (create) | one test file per unit |
| `test/util.mjs` (modify) | shared helpers: `centroid`, `cachedBody` |

---

# Phase 1 — the plucking hand

### Task 1: Contact-based plucker in the string engine

**Files:**
- Modify: `js/worklet.js` (`PluckVoice`: replace `buildExc` use for plucked notes; keep it, renamed `tapExc`, for hammer-on / slide taps)
- Modify: `test/util.mjs` (add `centroid`)
- Test: `test/pluck.test.mjs`

**Interfaces:**
- Consumes: existing `PluckVoice` buffers `bv`, `bh`, write index `w`, `mask`, `placeTouch`-style tap placement, `P.pickPos`, `P.pickHard` (now "attack").
- Produces:
  - `export const PLUCKERS` — array indexed by technique id `0 pick, 1 flesh, 2 short nails, 3 long nails, 4 thumb`; each `{ k, r, rIso, widthMm, relMs, holdMs, thetaDeg, noise, pos, nail?: { at, k, r, relMs, widthMm, click } }`.
  - Engine config field `pick` (0–4: pick, flesh, short nails, long nails, hybrid) stored as `P.pick`.
  - Note event fields: `fg` (plucker id 0–4 as in `PLUCKERS`; default from `P.pick`, hybrid → 0 on strings 0–2, 2 on 3–5), `rs` (rest stroke, boolean), existing `d` (+1 down / −1 up), existing `t` = **release** time.
  - `PluckVoice.strokeFrames(ev, P) → integer` — hold time in frames; `VibetarEngine.post` schedules note events at `frame − strokeFrames`, never earlier than the current frame.
  - `export const SCALE = 0.648` (m) and `PluckVoice.waveSpeed()` = `2 * SCALE * openF` (m/s).

Starting values (tune only within the tests below):

| id | k | r | rIso | widthMm | relMs | holdMs | thetaDeg | noise | pos |
|---|---|---|---|---|---|---|---|---|---|
| 0 pick | 0.9 | 0.08 | 0.02 | 1 | 0.12 | 6 | 25 | 0.10 | 1.0 |
| 1 flesh | 0.10 | 0.9 | 0.5 | 10 | 2.8 | 16 | 40 | 0.02 | 1.25 |
| 2 short nails | 0.10 | 0.9 | 0.5 | 10 | 2.8 | 14 | 45 | 0.02 | 1.1 |
| 3 long nails | 0.5 | 0.15 | 0.05 | 2 | 0.35 | 12 | 50 | 0.04 | 1.0 |
| 4 thumb | 0.08 | 0.9 | 0.5 | 14 | 3.2 | 16 | 10 | 0.02 | 1.4 |

Short nails add `nail: { at: 0.55, k: 0.5, r: 0.2, relMs: 0.5, widthMm: 2.5, click: 0.05 }`. Attack `a = P.pickHard` scales `k` by `4^(a − 0.5)` and `relMs` by `4^(0.5 − a)`. Rest stroke sets `thetaDeg` to 8.

- [ ] **Step 1: Write the failing tests** in `test/pluck.test.mjs`

```js
const techs = { pick: 0, flesh: 1, nailS: 2, nailL: 3 };
const play = (pick, s, fret, extra = {}, cfg = {}) => note(s, fret, extra, { pick, ...cfg });

test('brightness orders flesh < short nails < long nails < pick', () => {
  for (const [s, fret] of [[1, 3], [3, 2], [5, 0]]) {
    const c = Object.values(techs).map((p) => centroid(play(p, s, fret), 0.0, 0.06));
    assert.ok(c[1] < c[2] && c[2] < c[3] && c[3] < c[0], `s${s}: ${c.map(Math.round)}`);
  }
});
test('harder plucks are brighter and louder', () => {
  for (const p of Object.values(techs)) {
    const soft = play(p, 2, 2, { v: 0.4 }), hard = play(p, 2, 2, { v: 1.0 });
    assert.ok(centroid(hard, 0, 0.06) > centroid(soft, 0, 0.06));
    assert.ok(db(rms(hard, 0, 0.3)) - db(rms(soft, 0, 0.3)) > 4);
  }
});
test('techniques are level-matched within 3 dB', () => {
  const lv = Object.values(techs).map((p) => db(rms(play(p, 2, 2), 0, 0.5)));
  assert.ok(Math.max(...lv) - Math.min(...lv) < 3, lv.map((v) => v.toFixed(1)).join(' '));
});
test('contact lasts 1-8 ms after the release point is reached', () => { /* engine.voices[s].contactFrames exposed after the note: 1 ms ≤ frames/FS ≤ 8 ms + hold */ });
test('plucked notes stay within 1.5 cents for every technique', () => { /* as the existing tuning test, looped over techs */ });
test('hybrid uses the pick on bass strings and nails on trebles', () => {
  assert.ok(Math.abs(centroid(play(4, 0, 3), 0, 0.06) / centroid(play(0, 0, 3), 0, 0.06) - 1) < 0.05);
  assert.ok(Math.abs(centroid(play(4, 5, 3), 0, 0.06) / centroid(play(2, 5, 3), 0, 0.06) - 1) < 0.05);
});
test('re-plucking a ringing string makes no jump in the waveform', () => {
  // two notes 0.3 s apart on one string; max |x[n]-x[n-1]| around the second
  // stroke start must not exceed 3x the max step during the free ring before it
});
test('rest strokes put more energy towards the top', () => { /* voice.excV/excH ratio, and louder by > 1 dB */ });
// Review Focus 2, 3, 5:
test('works at 44.1 kHz and 96 kHz', () => { /* tuning < 2 cents, brightness ordering holds */ });
test('fret 24 on the top string and a low C on the bottom string', () => { /* open [36,…]: sounds, finite, in tune < 3 cents */ });
test('notes faster than the hold time all sound and release', () => {
  // 12 notes 8 ms apart on one string, flesh: after the last, voice.contact === 0 and rms(last 50 ms) > -40 dB
});
```

`centroid(x, t0, t1)` in `test/util.mjs`: spectral centroid in Hz of the Hann-windowed segment, 60 Hz–12 kHz.

- [ ] **Step 2: Run** `node --test test/pluck.test.mjs` — expected: all fail (unknown config `pick`, `centroid` missing).

- [ ] **Step 3: Implement the contact** in `PluckVoice`.

Per stroke: taps `pa`, `pb` are placed like a contact point at round-trip distance `x = pos · P.pickPos · N_open` from the bridge (clamped to 0.03–0.5 of the sounding period `N`); width `W = clamp(round(widthMm·1e-3 / (waveSpeed/fs)), 1, 9)` adjacent tap pairs, equal weights. Units are the loop's own: `d` is the velocity added to each travelling wave.

```
u      = (cos θ, sin θ) · dir                    // stroke direction in the (towards-top, along-top) plane
dMax   = amp(vel, f)                             // existing amplitude law (vel × pitch tilt)
Kst    = 1 / (N · β · (1 − β))                   // static stiffness of the string at the point
vF     = dMax / (Kst · holdFrames)               // finger speed that reaches dMax at the release time
each sample while in contact (grip g = 1 until release, then decays to 0 over relMs):
  vIn  = Σ_w ((aV − bV)·u.V + (aH − bH)·u.H) / W
  xF  += vF   (frozen once released)
  d    = g · (k·(xF − y − vIn) + r·(vF − vIn)) / (1 + g·(k + r))     // implicit, always stable
  if d·1 < 0: d = 0                              // the plucker cannot pull
  y   += vIn + d
  a += d·u, b −= d·u on every tap pair (÷W); plus isotropic damping dIso = −g·rIso·(a − b)/(1 + g·rIso) per polarisation
  release starts when d ≥ dMax or frames ≥ 1.5·holdFrames
short nails: when d ≥ nail.at·dMax switch to the nail's k, r, relMs, width, keep the force continuous (re-base xF), add click·dMax once
noise: d *= 1 + noise·(2·rnd − 1)·(wound ? 2 : 1) while g > 0
```

`holdFrames = clamp(holdMs·fs/1000 · (1.4 − 0.6·vel), 0.5·N, timeToNextNote)`; the engine passes the gap to the string's next queued note as the upper limit. The old `dampCount / dampGain` shortcut is removed for plucked notes. Expose `voice.contact` (0/1) and `voice.contactFrames` for tests.

- [ ] **Step 4: Run** `node --test test/` — expected: all pass, including the 22 existing tests. If an existing loudness or palm-mute threshold moves by more than 3 dB, re-tune `dMax`, not the threshold.

- [ ] **Step 5: Commit** — `git commit -m "Simulate the pluck as a pick, flesh or nail contact"`

### Task 2: Fingers, strokes and performance drift

**Files:**
- Modify: `js/song.js`
- Test: `test/perform.test.mjs`

**Interfaces:**
- Consumes: Task 1 event fields `fg`, `rs`, `d`.
- Produces:
  - `export const PICKING = ['pick', 'flesh', 'nailS', 'nailL', 'hybrid']`; `inst.picking` (index into `PICKING` — not the same numbering as the engine's plucker ids, where 4 is the thumb); `'picking'` appended to `INST_KEYS`; defaults steel 0, twelve 0, nylon 2, bowed 0.
  - `export function newPerformer(seed?) → { rnd, drift: { t, v }, last: {} }`.
  - `stepEvents(song, step, t, rnd, perf?)` and `songEvents(song, from, to, t0, rnd, perf?)` — `perf` optional; without it a fresh one is used per call.
  - `engineCfg` (in `js/audio.js`) passes `pick: inst.picking`.

Rules: finger techniques (1–3) → strings 0–2 use `fg: 4` (thumb), strings 3–5 alternate index/middle/ring, never the same finger twice in a row within 0.25 s; per-finger strength `[thumb 1.0, i 1.0, m 0.97, a 0.9]`; a finger reused within 0.12 s plays at 0.9×. Pick (0): single notes within 0.35 s of the previous note alternate `d`, down on the beat. Hybrid: strings 0–2 `fg 0`, strings 3–5 `fg 2`. Up-strokes play at 0.93× velocity. Accent flag `>` sets `rs: true`. Each note also carries `pp`, a plucking-point offset in millimetres that wanders within ±4 mm (same random walk as the drift; 0 when Humanize is 0); the engine adds it to the plucking position. Drift: timing offset and velocity factor follow a mean-reverting random walk (step σ 1.2 ms / 2 %, pull 0.08 per note, limits ±8 ms / ±12 %), all scaled by `inst.human`.

- [ ] **Step 1: Write the failing tests**

```js
test('thumb takes the bass strings, fingers alternate on the trebles', () => {
  // nylon song, picking 2: notes on string 1 → fg 4; four notes on string 5 → fg sequence never repeats
});
test('pick alternates in runs and plays down on the beat', () => { /* 16ths on one string: d = 1,-1,1,-1 */ });
test('hybrid: pick below, nails above', () => { /* fg 0 on strings 0-2, fg 2 on 3-5 */ });
test('accents are rest strokes', () => { /* cell t '>' → ev.rs === true */ });
test('humanize 0 is deterministic; drift stays inside its limits', () => {
  // human 0: two runs deepEqual. human 1: 400 notes, |t − grid| ≤ 0.008 + strum, 0.8 ≤ v/base ≤ 1.2,
  // and consecutive offsets are correlated (lag-1 autocorrelation > 0.5)
});
test('old links get the instrument default; picking round-trips', async () => { /* unpackSong without the field → 0 / 2; encode→decode keeps 3 */ });
test('a note 10 ms after the previous one on its string limits the hold', () => { /* Review Focus 5: event carries gap; engine test in Task 1 consumes it */ });
```

- [ ] **Step 2: Run** `node --test test/perform.test.mjs` — expected: fail (`newPerformer` undefined).
- [ ] **Step 3: Implement** the rules above in `js/song.js`; `js/app.js` player creates one performer per `play()`; `renderSong` one per export.
- [ ] **Step 4: Run** `node --test test/` — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "Assign fingers and strokes; let timing and dynamics drift"`

### Task 3: Picking controls

**Files:**
- Modify: `index.html`, `js/app.js`, `README.md`

**Interfaces:**
- Consumes: `S.PICKING`, `inst.picking`, `inst.pickHard`.
- Produces: a segmented control `#picking` (buttons `data-v="0…4"`, labels Pick, Fingers, Short nails, Long nails, Hybrid), hidden for the bowed instrument; the slider label "Pick hardness" / "Nail attack" becomes "Attack" for plucked instruments.

- [ ] **Step 1:** Add the control and label change; switching instrument preset resets `picking` to that preset's default.
- [ ] **Step 2: Verify in the browser** (`.claude/launch.json` server `vibetar`): each technique previews a note with a non-zero output level and no console errors; the choice survives reload through the link; the bowed preset hides the control.
- [ ] **Step 3:** Update the help dialog and README (features, "How the sound is made": plucking paragraph).
- [ ] **Step 4: Commit** — `git commit -m "Add picking technique control"`

---

# Phase 2 — the body

### Task 4: Eigen-solvers

**Files:**
- Create: `js/body/eigen.js`
- Test: `test/eigen.test.mjs`

**Interfaces:**
- Produces:
  - Banded symmetric storage: `Float64Array(n * (bw + 1))`, entry `(i, j)` with `0 ≤ i − j ≤ bw` at `i * (bw + 1) + (i − j)`.
  - `choleskyBanded(A, n, bw) → Float64Array` (factor, same layout; throws if not positive definite).
  - `solveBanded(L, n, bw, b: Float64Array) → void` (in place).
  - `symEig(A: Float64Array(n*n), n) → { values: Float64Array(n) ascending, vectors: Float64Array(n*n) }` (column `k` at `vectors[i*n + k]`; Householder tridiagonalisation + implicit QL).
  - `lowestModes({ K, M, n, bw, count, shift = 0 }) → { w2: Float64Array(count) ascending, phi: Float64Array(count * n) }` — solves `K φ = ω² M φ` with diagonal `M`; modes mass-normalised (`φᵀMφ = 1`), mode `k` at `phi[k*n + i]`. Method: Lanczos on `(K + shift·M)⁻¹M` with full re-orthogonalisation, `m = min(n, 2·count + 30)` steps, then `symEig` of the tridiagonal.

- [ ] **Step 1: Write the failing tests**

```js
test('symEig reproduces a known spectrum', () => { /* A = Q diag(1..8) Qᵀ from a fixed rotation; values within 1e-9; A v = λ v */ });
test('banded Cholesky solves a pentadiagonal system', () => { /* residual < 1e-9 */ });
test('lowestModes finds the lowest modes of a fixed-fixed string', () => {
  // K = tridiag(-1,2,-1), M = I, n = 400: w2[k] = 4 sin²(π(k+1)/(2(n+1))) for k < 40, rel. error < 1e-8
});
test('lowestModes with a shift handles a singular K', () => { /* free-free chain: first value ≈ 0 (< 1e-9), second matches */ });
test('modes are mass-orthonormal', () => { /* |φᵢᵀMφⱼ − δᵢⱼ| < 1e-8 with a random positive diagonal M */ });
```

- [ ] **Step 2: Run** `node --test test/eigen.test.mjs` — expected: fail (module missing).
- [ ] **Step 3: Implement** `js/body/eigen.js`.
- [ ] **Step 4: Run** the tests — expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "Add banded and dense symmetric eigen-solvers"`

### Task 5: Grid and braced orthotropic plate

**Files:**
- Create: `js/body/grid.js`, `js/body/plate.js`
- Test: `test/plate.test.mjs`

**Interfaces:**
- Consumes: `lowestModes` (Task 4).
- Produces:
  - `makeGrid({ width, length, h, inside(x, y) → 0 outside | 1 plate | 2 hole }) → { nx, ny, h, type: Uint8Array(nx*ny), dof: Int32Array(nx*ny) (−1 if none), n, x(i), y(j) }` — `x` across the strings (0 at the centre line), `y` along the body from the neck end; node `(i, j)` at index `j*nx + i`.
  - `assemblePlate(grid, { wood, thickness, braces, patches, clamp = 0 }) → { K, M: Float64Array(n), n, bw }` where `wood = { EL, ER, GLR, nuLR, rho }` (grain along `y`), `braces = [{ x0, y0, x1, y1, b, hgt, wood }]`, `patches = [{ x0, y0, x1, y1, thickness, wood, mass }]`.
  - `plateModes(grid, plateSpec, count) → { f: Float64Array (Hz), phi, n }`.

Assembly is by energy so `K` is symmetric positive semi-definite by construction:

```
U = h²/2 · Σ_plate nodes [κx κy]·[[Dx, D1],[D1, Dy]]·[κx κy]ᵀ  +  h²/2 · Σ_cells 4·Dk·κxy²  +  ½ Σ_brace samples (EI/h)·ℓ·κθ²
κx = (w[i+1] − 2w[i] + w[i−1]) / h²     κy likewise     κxy = (w[i+1,j+1] − w[i+1,j] − w[i,j+1] + w[i,j]) / h²
κθ = c²κx + s²κy + 2cs·κxy              EI = E·b·hgt³/3   (brace glued to one face)
Dy = EL t³/(12(1 − νLR νRL)), Dx = ER t³/(12(1 − νLR νRL)), D1 = νRL·Dy, Dk = GLR t³/12, νRL = νLR·ER/EL
```

Outside nodes are fixed at 0 (hinged edge); `clamp` (0–1) weights the curvature terms centred on the first ring of outside nodes. Any term whose stencil touches a hole node is dropped (free edge). Mass per node: `ρ t h²` plus brace and patch mass.

- [ ] **Step 1: Write the failing tests**

```js
test('isotropic simply supported plate matches the textbook', () => {
  // 0.5 x 0.4 m, t 3 mm, E 10e9, nu 0.3, rho 500, h 10 mm:
  // f_mn = (π/2)·sqrt(D/(ρt))·((m/a)² + (n/b)²); first 10 within 2 %
});
test('orthotropic plate matches the textbook', () => {
  // f_mn = (π/2)/sqrt(ρt)·sqrt(Dx(m/a)⁴ + 2(D1 + 2Dk)(m/a)²(n/b)² + Dy(n/b)⁴); first 8 within 3 %
});
test('a brace along x raises the modes that bend along x', () => { /* mode (2,1) rises > 15 %, mode (1,2) < 5 % */ });
test('a hole lowers the stiffness; K stays symmetric and non-negative', () => { /* fundamental drops; all w2 ≥ 0 */ });
test('clamping the edge raises the fundamental towards the clamped value', () => { /* clamp 1 → ratio 1.6–1.95 of hinged for a square plate */ });
```

- [ ] **Step 2: Run** `node --test test/plate.test.mjs` — expected: fail.
- [ ] **Step 3: Implement** `grid.js`, `plate.js`.
- [ ] **Step 4: Run** — expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "Add grid and braced orthotropic plate model"`

### Task 6: Instruments, air cavity and the coupled body

**Files:**
- Create: `js/body/instruments.js`, `js/body/cavity.js`, `js/body/couple.js`
- Test: `test/body.test.mjs` (first half)

**Interfaces:**
- Consumes: `makeGrid`, `plateModes`, `lowestModes`, `symEig`.
- Produces:
  - `INSTRUMENTS[name]` for `steel`, `nylon`, `twelve`: `{ outline: { length, upper, waist, lower, yUpper, yWaist, yLower }, depth, hole: { y, r }, top: plateSpec, back: plateSpec, saddle: { y, xs: [6 string x positions], height }, strings: { mu: [6 kg/m], scale }, mics: [{ x, y, z }, { x, y, z }], eta: { wood, air } }`.
  - `cavityModes(grid, depth, count) → { f, psi (count × grid nodes, mean-square 1), area, volume }` — rigid-wall modes of the air layer; mode 0 is uniform.
  - `coupleBody(inst, { h = 0.008, nTop = 150, nBack = 80, nAir = 30 }) → body` with
    `body = { name, grid, K: count, f: Float64Array, eta: Float64Array, shapeTop: Float64Array(K × grid nodes), shapeBack: same, hole: Float64Array(K) (plug displacement), phi: Float64Array(6 × K) (vertical displacement at each saddle point), rock: Float64Array(6 × K) (saddle.height × ∂w/∂x there), z: Float64Array(6) (string impedance 2·scale·f_open·mu for standard tuning) }`, all for unit modal mass.

Geometry (metres; grain along the body). Thickness and brace height may be tuned within the stated range to meet the tests:

| | steel | nylon | twelve |
|---|---|---|---|
| length / upper / waist / lower | 0.505 / 0.292 / 0.273 / 0.396 | 0.485 / 0.275 / 0.235 / 0.365 | 0.520 / 0.300 / 0.260 / 0.430 |
| depth | 0.110 | 0.095 | 0.115 |
| hole centre y / radius | 0.145 / 0.050 | 0.135 / 0.043 | 0.150 / 0.050 |
| saddle y / height | 0.287 / 0.012 | 0.325 / 0.010 | 0.290 / 0.012 |
| top wood, thickness (range) | spruce, 2.8 mm (2.5–3.2) | cedar, 2.3 mm (2.0–2.6) | spruce, 3.0 mm (2.7–3.3) |
| top bracing | X-brace 8×14 mm crossing at y 0.215, ±49°; 2 tone bars 6×10; 4 finger braces 5×6; upper bar 12×16 at y 0.085 | 7 fan struts 4×5 from y 0.20 to 0.44; harmonic bars 7×14 at y 0.085 and 0.195 | as steel, 9×16 X-brace |
| bridge | 0.150×0.030, 30 g, plate 0.16×0.045 maple 2.5 mm | 0.190×0.028, 20 g | 0.160×0.032, 36 g |
| back | mahogany 2.6 mm, 4 cross braces 7×15 | rosewood 2.5 mm, 3 cross braces 6×14 | mahogany 2.8 mm, 4 cross braces 8×16 |
| string mu (g/m), low→high | 6.8, 3.9, 2.2, 1.25, 0.62, 0.40 | 5.4, 3.4, 1.9, 0.95, 0.55, 0.38 | as steel |

Woods `{EL, ER, GLR, nuLR, rho}` (Pa, kg/m³): spruce `11e9, 0.8e9, 0.7e9, 0.37, 420`; cedar `8e9, 0.75e9, 0.6e9, 0.37, 370`; mahogany `10e9, 1.1e9, 0.8e9, 0.35, 560`; rosewood `13e9, 1.9e9, 1.0e9, 0.36, 800`; maple `12e9, 1.3e9, 1.0e9, 0.4, 650`. Loss factors: wood 0.022, air 0.025. Brace height range ±25 %. Saddle x positions: `±0.0275, ±0.0165, ±0.0055` (bass at negative x). Air: `ρ = 1.2`, `c = 343`.

Coupling is kept symmetric by giving each standing air wave its own displacement coordinate `η_a`:

```
coordinates  z = [top modal q (nTop), back modal q (nBack), hole plug x, η_1 … η_nAir−1]
mass         diag(1 …, 1 …, ρ·S·(t_top + 1.7·r), κ/ω_a² …)        κ = ρc²/V,  S = π r²
stiffness    diag(ω_top² …, ω_back² …, 0, 0 …) + κ · Σ_a c_a c_aᵀ
c_a          = [ ∫ψ_a φ_top dS …,  ∫ψ_a φ_back dS …,  ψ_a(hole)·S,  δ_a (1 at η_a; no η for the uniform mode a = 0) ]
```

Scale by `M^(−1/2)`, solve with `symEig`, keep modes with `f < 5 kHz`. Loss factor of a coupled mode = Σ (its energy fraction in wood, air, plug) × (0.022, 0.025, plug radiation `ρ ω S /(2π c · (t + 1.7 r))`…) + monopole radiation `ρ ω V_k² /(4π c)` with `V_k` its net volume displacement.

- [ ] **Step 1: Write the failing tests**

```js
test('instrument geometry is plausible', () => {
  // steel: top area 0.125–0.150 m², top mass incl. braces and bridge 0.22–0.40 kg, cavity volume 0.012–0.016 m³
});
test('the cavity has a uniform mode and a first standing wave near 350-450 Hz', () => {});
test('steel-string resonances land where real guitars have them', () => {
  const b = body('steel');
  const air = b.f[0], top = strongestBridgeMode(b, 150, 260);
  assert.ok(air >= 90 && air <= 110, `air ${air}`);
  assert.ok(top >= 170 && top <= 215, `top ${top}`);
  assert.ok(countBelow(b, 3500) >= 150);
});
test('the classical guitar sits lower than the steel-string', () => { /* nylon air 85–105, top 160–205, top < steel top */ });
test('below the air resonance the hole and the top move in opposite directions; between air and top resonance together', () => { /* sign of hole[k]·net top volume for k = 0 vs the main top mode */ });
test('loss factors give Q between 12 and 80 for every mode below 1 kHz', () => {});
test('building twice gives identical numbers', () => {});
```

- [ ] **Step 2: Run** `node --test test/body.test.mjs` — expected: fail.
- [ ] **Step 3: Implement** the three modules. If a resonance is out of range, adjust top thickness, then brace height, within the stated ranges; record the final values in `instruments.js`.
- [ ] **Step 4: Run** — expected: pass, and `coupleBody` for each instrument takes < 6 s.
- [ ] **Step 5: Commit** — `git commit -m "Model the guitar body: braced plates, air cavity, coupled modes"`

### Task 7: Bridge response checks

**Files:**
- Modify: `js/body/couple.js`
- Test: `test/body.test.mjs` (second half)

**Interfaces:**
- Produces: `bridgeAdmittance(body, i, j, f, { rockI = false, rockJ = false }) → { re, im }` — velocity at string `i`'s saddle point per unit force at `j`'s, `Σ_k c_ik c_jk · jω / (ω_k²(1 + jη_k) − ω²)`; and `plateConductance(inst) → number` — the infinite-plate point conductance `1 / (8·sqrt(D_eff·m_eff))` at the bridge, used for the range above the in-engine modes.

- [ ] **Step 1: Write the failing tests**

```js
test('the bridge never supplies energy', () => { /* Re Y_ii ≥ 0 for 400 log-spaced f in 40 Hz–5 kHz, all 6 strings, vertical and rocking */ });
test('reciprocity', () => { /* Y_ij === Y_ji within 1e-12 relative */ });
test('admittance magnitudes are guitar-like', () => {
  // |Y| at the main top resonance 0.02–0.3 s/kg; mean level 300 Hz–3 kHz 0.003–0.03 s/kg;
  // rocking at least 6 dB below vertical on average
});
```

- [ ] **Step 2: Run** — expected: fail (functions missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: pass. If magnitudes are out of range the modal masses are wrong: check mass normalisation before touching geometry.
- [ ] **Step 5: Commit** — `git commit -m "Add bridge admittance of the modelled body"`

### Task 8: Microphones and impulse responses

**Files:**
- Create: `js/body/radiate.js`, `js/body/model.js`
- Modify: `js/ir.js` (export `denseField(fs, len, target, seed, fromHz)` extracted from `makeBodyIR`, behaviour of `makeBodyIR` unchanged)
- Modify: `test/util.mjs` (add `cachedBody(name, fs = FS)`, memoised per process)
- Test: `test/body.test.mjs` (third part)

**Interfaces:**
- Consumes: `body` (Task 6), `plateConductance` (Task 7), `denseField`.
- Produces:
  - `micTransfer(body, inst, drive: Float64Array(K) (modal force per unit input), fs, nfft) → [Float64Array re/im pairs for L, R]`.
  - `export const MODEL_VERSION = 1`.
  - `buildBody(name, fs) → { version, name, fs, irs: Float32Array[8] (zone bass L,R; middle L,R; treble L,R; rock L,R), bridge: { K: 24, f, eta, phi: Float64Array(6×24), rock: Float64Array(6×24), z: Float64Array(6), gRes: number }, info: { air, top, modes, ms } }`.

Radiation: pressure at microphone `m`, frequency `ω`, for mode `k`:

```
R_k(ω) = Σ_top nodes φ_k·h²·e^(−jωr/c)/r  +  hole_k·S·e^(−jωr_h/c)/r_h  +  B(ω)·V_back,k·e^(−jωr_0/c)/r_0
H(ω)   = −ω²·ρ/(2π) · Σ_k R_k(ω) · drive_k / (ω_k²(1 + jη_k) − ω²)
```

`B(ω) = 1/(1 + (f/400)²)` (the back only contributes where the body is small compared with the wavelength). Evaluate the per-node factors on a 50 Hz grid from 50 Hz to 5 kHz, remove the bulk delay `r_0/c` before interpolating to FFT bins, and restore it afterwards. Microphones (m, origin at the top's centre line, neck end, z out of the top): steel/twelve `(−0.02, 0.06, 0.40)` and `(0.07, 0.36, 0.42)`; nylon `(−0.02, 0.05, 0.38)` and `(0.06, 0.35, 0.40)`.

Zones drive at saddle points averaged pairwise (strings 0–1, 2–3, 4–5); the rock response drives with the mean of `rock`. Impulse length 0.42 s at `fs`, `nfft` the next power of two ≥ 2× that. Above 3.5 kHz crossfade (one octave, equal power) into `denseField` calibrated to continue the modelled level at 2.5–3.5 kHz with the classic body's slope. One common gain for all eight responses so the mean power gain of the three zones over 150 Hz–2 kHz is 1 (as the classic body); 30 ms fade-out.

- [ ] **Step 1: Write the failing tests**

```js
test('the body builds within the time budget', () => { assert.ok(cachedBody('steel').info.ms < 8000); });
test('impulse responses are finite, decay, and carry no DC', () => { /* peak in first 5 ms; last 30 ms < −60 dB re peak; |sum| < 1e-3·Σ|x| */ });
test('stereo: channels agree in the bass and differ above', () => {
  // band-limited correlation of zone-middle L vs R: > 0.9 in 60–150 Hz, < 0.6 in 800 Hz–3 kHz
});
test('the three zones differ above 1 kHz but not below 300 Hz', () => {});
test('third-octave response has no holes', () => { /* 100 Hz–8 kHz: every band within +12/−18 dB of the 150 Hz–2 kHz mean; no seam at 3.5 kHz (adjacent bands within 6 dB) */ });
test('note loudness across the range is at least as even as the classic body', () => {
  // A-weighted attack level for MIDI 40–84 through zone IRs: standard deviation ≤ 3.0 dB
});
test('44.1 kHz and 96 kHz bodies have the same resonances', () => { /* Review Focus 2: info.air, info.top equal within 0.5 %; IR length 0.42 s */ });
```

- [ ] **Step 2: Run** — expected: fail.
- [ ] **Step 3: Implement** `radiate.js`, `model.js`, the `denseField` extraction.
- [ ] **Step 4: Run** `node --test test/` — expected: all pass. If the build exceeds 8 s, change the default grid step `h` to 0.010 and re-run; if it still exceeds 8 s, stop and report — moving the plate solve to WebGL is the owner's decision.
- [ ] **Step 5: Commit** — `git commit -m "Radiate the modelled body to two microphones"`

### Task 9: Worker, cache and audio path

**Files:**
- Create: `js/body/worker.js`
- Modify: `js/worklet.js` (four output channels), `js/audio.js`, `js/song.js` (`bodyModel` setting), `js/app.js`, `index.html`
- Test: `test/body.test.mjs` (cache part), `test/song.test.mjs`

**Interfaces:**
- Consumes: `buildBody`, `MODEL_VERSION`.
- Produces:
  - Engine output: 4 channels — `0,1,2` = vertical-polarisation signal of strings `0–1, 2–3, 4–5`; `3` = along-top polarisation of all strings. `VibetarEngine.render(outs: Float32Array[4], n, frame0)`; a single `Float32Array` is still accepted and receives `ch0 + ch1 + ch2 + mixH·ch3` (keeps existing tests valid).
  - `inst.bodyModel` (1 modelled, 0 classic; default 1), appended to `INST_KEYS`.
  - `js/body/worker.js`: on message `{ name, fs }` → posts `{ ok: true, body }` (typed arrays transferred) or `{ ok: false, error }`.
  - In `js/audio.js`: `cacheKey(name, fs) = \`body:${MODEL_VERSION}:${name}:${fs}\``; `validBody(rec, name, fs) → boolean` (exported; checks version, name, fs, 8 responses of equal non-zero length, finite samples at 16 probe points); `getBody(name, fs) → Promise<body>` (IndexedDB database `vibetar`, store `bodies`; invalid records are deleted and rebuilt).
  - Graph: classic path unchanged (fed with the mixed four channels); modelled path = four `ConvolverNode`s; a `bodyMix` crossfade (0.25 s) between the paths.

- [ ] **Step 1: Write the failing tests**

```js
test('a cached body is only used if it matches version, instrument and sample rate', () => {
  // validBody(good) true; wrong version / name / fs / missing response / NaN sample → false   (Review Focus 4)
});
test('bodyModel defaults to modelled and round-trips; old links get the default', async () => {});
test('the engine renders four channels that sum to the mono output', () => {});
```

- [ ] **Step 2: Run** — expected: fail.
- [ ] **Step 3: Implement.** The graph starts on the classic path; when `getBody` resolves and `inst.bodyModel` is 1 it loads the four responses and crossfades. Instrument change repeats this. Worker or IndexedDB failure, or `ok: false`: stay on classic and show one toast, "Using the classic body (the modelled one could not be built)". `renderSong` awaits `getBody` first. Add the **Body model** switch (Modelled / Classic) to the Instrument panel.
- [ ] **Step 4: Run** `node --test test/` — expected: pass.
- [ ] **Step 5: Verify in the browser:** first load shows the classic body playing immediately, then (console timing) the modelled body arriving and the level meter staying continuous through the crossfade — press Play within 1 s of load (Review Focus 1); switching instrument mid-song keeps sound going; second load takes the body from the cache (< 200 ms); with `indexedDB` deleted from the page (`delete window.indexedDB` before load in DevTools) playback still works; WAV export contains the modelled body (differs from a classic export).
- [ ] **Step 6: Commit** — `git commit -m "Build the body in a worker, cache it, and play through four zone responses"`

---

# Phase 3 — strings and body coupled both ways

### Task 10: Modal bridge inside the string engine

**Files:**
- Modify: `js/worklet.js` (new `Bridge` class; `VibetarEngine.render`, `configure`; `PluckVoice.setDamping`, `retune`), `js/audio.js` (send `bridge` with the config), `js/song.js` + `js/app.js` (rename the `symp` label to "String coupling")
- Test: `test/bridge.test.mjs`

**Interfaces:**
- Consumes: `body.bridge` from `buildBody` (Task 8), `cachedBody` (test helper).
- Produces:
  - Engine config field `bridge` (the object above, or `null` → old junction, i.e. the Classic path) and existing `symp` reinterpreted as coupling scale (`1` = physical; default stays the instrument's stored value, new default 1).
  - `class Bridge { constructor(fs); configure(bridge, voices, coupling); step(u: Float64Array(2·nv)) → Float64Array(2·nv) (bridge velocity seen by each loop: vertical loops first, then along-top); reflectionDelay(loop, f) → samples }`.

Each in-engine mode is the bilinear transform (pre-warped at its own frequency) of `s/(s² + η ω s + ω²)`; with `b0_k` its instantaneous gain and `s_k` its state output:

```
c_ik   = phi[string i][k]  (vertical loops)   |   rock[string i][k]  (along-top loops)
B      = C·diag(b0)·Cᵀ + gRes·I                         Z = diag(z_i · coupling)
W      = (I + B·Z)⁻¹                                     (computed once per configure)
per sample:   vb = W·(2·B·Z·u + C·s)      F = Z·(2u − vb)      modal force f_k = Σ_i c_ik F_i     then update states
loop i continues with  u_i − vb_i           (replaces  uV − vj)
```

For the 12-string each course's two strings share the course's coefficients. With a bridge configured: both polarisations use the string's intrinsic loss only (`b1 × 0.7`, the old along-top value; no `1/(1 − alpha)` compensation), and `retune` subtracts `reflectionDelay(loop, f)` — the phase delay of `(1 − z·Y(f))/(1 + z·Y(f))` at the note's fundamental — from the delay-line length.

- [ ] **Step 1: Write the failing tests**

```js
const coupled = (cfg = {}) => engine({ bridge: cachedBody('steel').bridge, symp: 1, ...cfg });

test('notes stay within 3 cents with the bridge', () => { /* E2, C3, G3 (on the top resonance), E4, E5 */ });
test('the bridge only removes energy', () => {
  // the event-storm from engine.test.mjs on steel, nylon, twelve with the bridge: peak < 4, no NaN, dies away
});
test('a note on the main top resonance decays faster than its neighbours', () => {
  // info.top → nearest fretted note on string 3; T(−20 dB) at least 20 % shorter than the mean of the notes ±3 semitones away
});
test('sympathetic strings ring through the body', () => {
  // pluck E4 on string 5 with string 0 (E2) open and untouched: energy in string 0's delay line > −45 dB re string 5 after 1 s;
  // with coupling 0: < −90 dB
});
test('two-stage decay: towards-top motion dies faster than along-top motion', () => { /* decay rate of voice.bv energy > 1.5× that of voice.bh */ });
test('sustain per string stays within 30 % of the classic engine', () => {
  // open strings 0–5 and fret 5: T(−30 dB) coupled vs engine({ bridge: null })
});
test('works at 44.1 kHz and with drop-D / capo 7', () => { /* Review Focus 2, 3: finite, in tune < 3 cents */ });
```

- [ ] **Step 2: Run** `node --test test/bridge.test.mjs` — expected: fail (config ignored: sympathetic and decay tests fail).
- [ ] **Step 3: Implement** `Bridge` and the engine changes. If sustain is outside ±30 %, scale the intrinsic `b1` factor (not the body) and record it next to `PRESETS`.
- [ ] **Step 4: Run** `node --test test/` — expected: all pass.
- [ ] **Step 5: Measure cost:** render 10 s of the 12-string storm in Node and print the time; it must stay under 1.5 s (real-time factor > 6). If not, lower `bridge.K` from 24 to 16 in `buildBody`.
- [ ] **Step 6: Commit** — `git commit -m "Couple strings and body both ways through a modal bridge"`

### Task 11: Calibration, defaults and documentation

**Files:**
- Modify: `js/audio.js` (`LEVELS`), `js/song.js` (defaults, demos), `README.md`, `index.html` (help), spec status line
- Test: `test/mix.test.mjs` (create)

**Interfaces:**
- Consumes: everything above.
- Produces: final defaults — `bodyModel 1`, `symp 1`, picking per instrument; demo songs unchanged in notes.

- [ ] **Step 1: Write the failing test**

```js
test('demo songs keep their level and balance on the modelled body', () => {
  // render each plucked demo through engine + zone IRs (helper in util.mjs) for both body models:
  // overall RMS within 3 dB of classic; peak ≤ 1.0 before the soft clipper;
  // octave-band balance (125 Hz–4 kHz) within 6 dB of classic per band
});
```

- [ ] **Step 2: Run** — expected: fail or pass; adjust `LEVELS` per instrument until it passes.
- [ ] **Step 3: Verify in the browser** on all three plucked instruments and the bowed one: playback, preview notes, link reload, WAV export, Classic ↔ Modelled switch, no console errors, audio-thread load acceptable (no dropouts in the level meter trace while the 12-string demo plays).
- [ ] **Step 4:** Update README ("How the sound is made": plucking, body, bridge; Development: build time and cache), the help dialog, and set the spec's status to "implemented".
- [ ] **Step 5: Commit** — `git commit -m "Calibrate levels and document the modelled body"`

---

## After the last task

Report what was measured (resonances, build time, CPU), what could not be judged without listening, and ask the owner whether to publish.
