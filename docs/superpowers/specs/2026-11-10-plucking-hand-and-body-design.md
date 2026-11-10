# Plucking hand and modelled body — design

Date: 2026-11-10
Status: implemented (deviations are listed in the implementation report)

## Goal

Make vibetar's plucked instruments sound beautiful and human by replacing the
two most schematic parts of the synthesizer:

1. **The plucking hand.** Today a pluck is an ideal, pre-shaped pulse. It
   becomes a short physical contact between the string and a pick, fingertip
   or nail, with five selectable techniques.
2. **The body.** Today the body is a set of hand-placed low resonances plus a
   randomised field of higher ones, applied as one stereo filter. It becomes a
   model of the actual instrument — braced top, back, air cavity, sound hole —
   whose resonances are computed, which the strings couple to in both
   directions, and which is heard through two virtual microphones.

Success is judged by ear, by the owner of the project. The author of the code
cannot listen, so every part below has numeric acceptance tests and the old
body stays selectable for comparison until the new one is confirmed better.

## Non-goals

- Real-time simulation of the wood and air on the GPU. A guitar body is
  linear, so its computed resonances reproduce it exactly; stepping the field
  live would add delay and cost but no sound. WebGL is only a fallback for the
  one-time computation if the CPU proves too slow (see Risks).
- Recorded body responses or samples of any kind.
- The bowed instrument. It keeps its current body and excitation.
- Per-note picking technique, fingering marks in the tab, movable
  microphones. Technique is one setting per song.
- Nonlinear string effects (tension modulation, fret buzz).

## Part 1 — the plucking hand

### What is modelled

A pluck is a contact at the plucking point on the string, simulated sample by
sample for the few milliseconds it lasts:

- The plucker (pick tip, fingertip flesh, nail) is a spring and damper with a
  contact width. It moves across the string on a prescribed path at a speed
  set by the note's velocity.
- While in contact it pushes the string aside and also damps whatever the
  string was already doing. This replaces the current "damp for one period"
  shortcut, and is why re-plucking a ringing string sounds different from
  plucking a silent one.
- The string lets go when the contact force exceeds what the plucker can
  hold, or the plucker has travelled past the string. How abruptly it lets go
  depends on the material.
- The release angle decides how the energy is split between the string's two
  polarisations (towards the top / along the top).

The contact force is solved implicitly each sample, so a stiff pick is as
stable as soft flesh.

### Techniques

| Technique | Contact | Release | Extra |
|---|---|---|---|
| Pick | stiff, narrow (≈1 mm), little damping | fast slip off the tip | slip click; scrape on wound strings; up and down strokes differ |
| Fingers (flesh) | soft, wide (≈10 mm), heavily damped | string rolls off over 2–5 ms | plucked a little further from the bridge |
| Short nails | flesh first, then the nail catches | from the nail, fairly fast | faint click at the flesh-to-nail hand-over |
| Long nails | nail almost from the start | string slides along the nail ramp, then releases cleanly | faint scrape on wound strings |
| Hybrid | pick on the three bass strings, short-nail fingers on the trebles | as above | — |

Contact width is physical: it is converted to samples from each string's wave
speed, so the same fingertip dulls a bass string more than a treble string,
as on a real guitar.

In finger techniques the thumb takes the three bass strings (fleshier,
further from the bridge, moving along the top) and index, middle and ring
alternate on the trebles (moving up and away from the top). Accented notes
use a rest-stroke angle: more energy towards the top, fuller and louder.

### Human variation

Variation comes from the mechanics first — the contact reacts to the string's
current motion — and is then shaped by:

- per-finger character: each finger has a slightly different strength, nail
  and timing; the ring finger is weakest; fast repeats with one finger tire;
- alternate picking in runs: down on the beat, up off the beat, up-strokes a
  little thinner;
- drift instead of jitter: timing and loudness wander slowly (a random walk)
  rather than each note being randomised independently;
- the plucking point wandering by a few millimetres.

All of it scales with the existing Humanize slider; at 0 the performance is
deterministic.

### Controls and song format

- New **Picking** selector in the Instrument panel: Pick, Fingers, Short
  nails, Long nails, Hybrid. Defaults: steel and 12-string → Pick, nylon →
  Short nails.
- "Pick hardness" becomes **Attack** (soft ↔ firm): it scales contact
  stiffness and release speed within the chosen technique.
- "Pick position" is unchanged.
- The technique is stored in the share link as one more number at the end of
  the instrument settings. Old links load with the instrument's default.

### Where it lives

`js/worklet.js`, in the plucked-string voice: a `Plucker` replaces
`buildExc`. It reuses the two-tap string access already built for the
finger-contact points. The scheduler in `js/song.js` assigns finger / stroke
direction and passes them with each note.

## Part 2 — the body

### Pipeline (runs once per instrument, then cached)

```
geometry ──► top plate modes ─┐
          ├► back plate modes ─┼─► coupled modes ─┬─► bridge model (in the string engine)
          └► air cavity modes ─┘   (+ sound hole)  └─► radiation to 2 mics ─► impulse responses
```

1. **Geometry.** Each instrument has an outline, plate thicknesses, wood
   constants, a bracing layout and a bridge, laid on an 8 mm grid:
   - steel: dreadnought outline, X-bracing with tone bars and finger braces;
   - nylon: classical outline, seven-strut fan bracing with harmonic bars;
   - 12-string: jumbo outline, heavier X-bracing.
2. **Plates.** Top and back are thin orthotropic plates (stiff along the
   grain, soft across). Braces add stiffness along their direction and mass;
   the bridge adds mass and stiffness; the sound hole is cut out. The lowest
   ~150 top and ~80 back resonances are found with a sparse eigen-solver.
3. **Air.** The cavity is a layer of air between the plates: its uniform
   "breathing" motion through the sound hole (the Helmholtz resonance) plus
   its ~30 lowest standing waves.
4. **Coupling.** Top, back, air and the plug of air in the sound hole are
   joined into one system and solved again, giving ~250 resonances of the
   whole instrument. Each knows how much it moves at the bridge, how it
   tilts the bridge, and how every patch of the top, the back and the sound
   hole moves.
5. **Damping.** Each resonance loses energy according to how much of it is
   wood, air or sound-hole motion, plus what it radiates.
6. **Radiation.** Two virtual microphones stand about 40 cm in front of the
   guitar, one towards the neck joint and one towards the lower bout. The
   sound reaching each is summed over the moving surface of the top and the
   sound hole, with the back contributing at low frequencies. This gives
   real stereo: level and arrival-time differences that depend on frequency.
7. **Above the modelled range** (~3.5 kHz, where the grid stops being
   accurate) the response is continued with a calibrated statistical field,
   as today, crossfaded in.

The result: stereo impulse responses for three bridge zones (bass, middle,
treble strings) and one for bridge rocking, plus the bridge model below.

### Strings and body coupled both ways

Today strings lose energy to "the bridge" through a fixed formula and feed
each other through one coupling number. In the new model the ~24 lowest body
resonances run inside the string engine as the thing the strings are tied to:

- each string, in each polarisation, pushes on the bridge at its own saddle
  position; the bridge moves; that motion reflects back into every string;
- partials near a body resonance therefore decay faster and sound louder at
  the start, notes get the uneven, instrument-specific decay real guitars
  have, and strings ring in sympathy through the actual body;
- motion towards the top couples strongly, motion along the top only by
  rocking the bridge — which is what produces a real string's two-stage
  decay. The current fixed 1.45 / 0.7 loss factors go away.

The junction is solved exactly each sample (no one-sample delay) and built
from the body's own resonances, so it can only remove energy from the
strings. The fundamental of each note is re-tuned for the small pitch shift
the bridge causes; upper partials keep their natural shifts.

The sound itself is still produced by convolution: the engine outputs the
force each bridge zone receives, and each goes through its impulse response.

### Runtime

- The computation runs in a Web Worker. Estimated 3–6 s per instrument on a
  laptop (to be measured); results are cached in IndexedDB by instrument,
  sample rate and model version.
- Until a body is ready, the current body plays, then the new one is
  crossfaded in. WAV export waits for the model.
- If the worker or IndexedDB is unavailable, or the computation fails, the
  current body stays in use and a one-line notice says so.
- Four stereo convolutions replace one. On a slow device this can be reduced
  to one zone.

### Controls and song format

- **Body model** switch: Modelled / Classic. Temporary, for comparison.
- "Sympathetic" becomes **String coupling**: 100 % is the physical value.
- "Body" (body versus direct string sound) is unchanged.
- Both new settings are appended to the instrument settings in the link.

### Where it lives

New, each file with one job, all plain JavaScript usable in the worker and in
Node tests:

| File | Job |
|---|---|
| `js/body/instruments.js` | outlines, woods, bracing layouts, bridge and mic positions |
| `js/body/grid.js` | rasterise an outline and braces onto the grid |
| `js/body/plate.js` | stiffness and mass of a braced orthotropic plate |
| `js/body/eigen.js` | banded Cholesky, Lanczos, dense symmetric eigen-solver |
| `js/body/cavity.js` | air-cavity modes and the sound-hole plug |
| `js/body/couple.js` | coupled system, damping |
| `js/body/radiate.js` | microphone responses, impulse responses, high-frequency extension |
| `js/body/model.js` | runs the pipeline: `buildBody(instrument, sampleRate)` |
| `js/body/worker.js` | worker wrapper and cache |

Changed: `js/worklet.js` (bridge model, four output channels),
`js/audio.js` (worker, four convolvers, crossfade), `js/ir.js` (keeps the
classic body and reverb), `js/song.js`, `js/app.js`, `index.html`.

## Calibration

The new parts change loudness and sustain, so they are re-balanced against
what the current tests measure:

- average sustain per string stays within ±30 % of today's;
- loudness of the five picking techniques at equal velocity within ±3 dB;
- overall level and tonal balance of the demo songs within a few dB of
  today's, apart from the intended differences.

## Tests

Offline, in `test/`, run with `node --test test/`:

- **Solver**: a plain rectangular plate matches the textbook frequencies
  within 2 %; the eigen-solvers agree with each other on small cases.
- **Instrument**: air resonance 90–110 Hz and main top resonance
  170–215 Hz for the steel-string (the nylon lower); at least 150
  resonances below 3.5 kHz; building twice gives identical results.
- **Bridge**: the bridge can never supply energy at any frequency; it
  responds the same from string A to B as from B to A.
- **Coupled strings**: notes within 3 cents; no growth in the event-storm
  test; a note sitting on the main top resonance decays faster than its
  neighbours; an open string a fifth or octave away picks up energy.
- **Microphones**: left and right differ above 500 Hz and agree below 150 Hz.
- **Plucking**: brightness at equal velocity orders as flesh < short nails
  < long nails < pick; harder plucks are brighter; contact lasts 1–8 ms;
  hybrid matches pick on the bass strings and fingers on the trebles;
  re-plucking a ringing string produces no jump in the waveform.
- **Format**: old links load; new settings round-trip.
- All 22 existing tests keep passing (thresholds adjusted only where this
  spec says the behaviour changes).

In the browser: the body builds, caches and crossfades in; a failed build
falls back; playback, export and links work on each instrument.

## Delivery order

1. Plucking hand (audible on its own with the current body).
2. Body pipeline, microphones and impulse responses, behind the Body model
   switch.
3. Two-way bridge coupling.
4. Calibration, defaults, documentation.

Each step ends with the tests passing and something you can listen to.

## Risks and open assumptions

- **Nobody has listened yet.** Numbers can be right and the sound still
  wrong. Mitigation: the Classic switch, and listening after each step.
- **Build time is an estimate.** If it exceeds ~8 s the grid is coarsened to
  10 mm, and if that is not enough the plate solve moves to WebGL.
- **Bracing and wood data are typical values**, not a specific guitar. They
  are adjusted, within what luthiers actually do, so the main resonances
  land in the ranges above.
- **CPU.** The bridge model adds work on the audio thread, most for the
  12-string. If it is too much, the number of in-engine resonances drops.
- **`js/worklet.js` grows** past 1000 lines. Splitting it needs module
  imports inside audio worklets, which not all browsers handled reliably;
  it stays one file, in clearly separated sections.
- **The deployed site includes `docs/` and `test/`.** Harmless, but they are
  publicly served.
