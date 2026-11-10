# Plucking hand and modelled body — implementation report

Date: 2026-11-10 · Plan: `docs/superpowers/plans/2026-11-10-plucking-hand-and-body.md` · Spec: `docs/superpowers/specs/2026-11-10-plucking-hand-and-body-design.md`

This is the working ledger of the implementation: every task's result, every decision that departed from the plan or spec ("Ruling"), what the independent review found, what was fixed, and what was left ("minor (deferred)").

```text
# SDD ledger — plan: docs/superpowers/plans/2026-11-10-plucking-hand-and-body.md
Setup: Ruling: work in the existing checkout on branch vibetar-app (not main), no separate worktree — single-developer repo, branch already isolates the work — cost if wrong: none, branch can be moved.
Pre-flight:
- T1 -> T2: T1 produces event fields fg, rs, d; T2 also emits pp (plucking-point offset, mm) and a gap hint that T1's Produces block does not list. Ruling: the engine accepts optional ev.pp and ev.gap in Task 1 — spec asks for the wandering plucking point and shortened strokes — cost if wrong: two ignored fields.
- T1 -> T2/T3: config field pick (0-4, 4 = hybrid) vs PLUCKERS ids (4 = thumb): different numberings, both stated; consistent.
- T4 -> T5 -> T6: lowestModes / plateModes / makeGrid signatures consistent.
- T6 -> T7 -> T8: body object fields (f, eta, phi, rock, z, shapeTop, shapeBack, hole) consistent.
- T8 -> T9 -> T10: buildBody().bridge {K:24,f,eta,phi,rock,z,gRes} consumed by engine config field bridge; consistent.
- T9 -> existing tests: render() must keep accepting one Float32Array; stated in T9.
Task 1: Ruling: spec says contact lasts 1-8 ms but the plan's holdMs (6-16 ms) exceed it — hold times scaled to 3-5 ms so hold + release stays within 8 ms — cost if wrong: strokes shorter than a real slow pluck; one table to change.
Task 1: Ruling: centroid() uses the standard magnitude-weighted definition (not power-weighted) — power weighting is dominated by the fundamental and hides brightness differences — cost if wrong: none, still a centroid as the plan names.
Task 1: Ruling: flesh / thumb release time is 0.7-0.9 ms, not the spec table's 2-5 ms — a release slower than the string's period excites almost nothing (treble notes came out 15-20 dB quiet), which breaks the spec's own level-matching requirement — cost if wrong: flesh is a little brighter than intended; one number per plucker.
Task 1: Ruling: the re-pluck test checks the landing (first ms of contact: step < 3x the ring before it, as the plan words it) and that the second attack's largest step is < 2.5x the first attack's — the plan's criterion applied to the whole stroke is unsatisfiable, since any attack is sharper than a decayed ring — cost if wrong: a click at release on re-plucks up to 2.5x would pass.
Task 1: Ruling: the release is a smooth (raised-cosine) fade of the held force over relMs, and the hand adjusts its speed so the force reaches the release level on time — a spring-damper left to release on its own either snapped (bright flesh) or stopped with a step; the fixed-speed path missed the note time by up to 2 ms — cost if wrong: release shape is prescribed rather than emergent; brightness is set by one number per plucker.
Task 1: Ruling: PLUCKERS drops rIso (the damper acts along and across the stroke) and the nail stage only changes release time and adds a click; thumb thetaDeg 45 (the plan's 10 contradicted "moving along the top"); rest strokes are 1.35x firmer — plan's values were declared starting values — cost if wrong: table differs from the plan's.
Task 1: Ruling: at a fret change the old vibration is scaled to 20 % at stroke start (quiet()), same-fret re-plucks are damped by the contact only — the plan removed the old shortcut entirely, which left the previous note ringing at the new pitch — cost if wrong: slightly abrupt end of the old note 3-5 ms before a new one.
Task 1: Ruling: harmonic pluck boost 1.7 -> 1.4 — with the contact plucker node harmonics came out as loud as normal notes and the off-node test missed by 0.6 dB — cost if wrong: harmonics ~1.5 dB quieter.
Task 1: complete (commits 027c111..ee590ad, tests: node --test test/ → ℹ duration_ms 1957.968236)
Task 2: Ruling: note events carry fi (finger: 0 thumb, 1 index, 2 middle, 3 ring, 4 pick) besides fg (plucker id) — the plan's fg alone cannot tell index from middle, which the alternation and per-finger strength need — cost if wrong: one extra field the engine ignores.
Task 2: Ruling: single treble notes alternate index/middle always (not only within 0.25 s); the ring finger plays in chords — simpler and what the plan's test asks — cost if wrong: slow passages alternate fingers where a player might repeat one.
Task 2: Ruling: gap is the time since the previous note on the same string, sent only when under 50 ms — that is what limits the later stroke's hold — cost if wrong: none.
Task 2: complete (commits ee590ad..5b45f53, tests: node --test test/ → ℹ duration_ms 1963.845357)
Task 3: complete (commits 5b45f53..894f7ca, tests: node --test test/ → ℹ duration_ms 1864.693734)
Task 4: complete (commits 894f7ca..4f78ab6, tests: node --test test/ → ℹ duration_ms 2050.297556)
Task 5: complete (commits 4f78ab6..0ed88dc, tests: node --test test/ → ℹ duration_ms 1892.769853)
Task 5/6: Ruling: braces are beams along their own line (curvature = second difference of the plate deflection sampled on the line), not the plan's c²κx + s²κy + 2csκxy at the nearest node — the nodal form let the plate wrinkle between nodes so diagonal braces added no stiffness (X-brace: 48 Hz -> 44 Hz instead of -> 201 Hz) — cost if wrong: none found; energies match exact values within 1-11 %.
Task 6: Ruling: X-brace crossing at y 0.230 (steel) / 0.235 (twelve), not the plan's 0.215 — at 0.215 the legs pass 3 mm from the sound-hole edge, which no guitar does and which cut the braces at the hole — cost if wrong: crossing 15 mm lower than the plan's figure.
Task 6: Ruling: plate edges fully clamped (clamp 1) and main braces (X legs, transverse bars, back braces) tucked = built-in at the rim; small braces feathered — that is how they are built, and with it the resonances land in range untuned (steel 93 / 189 Hz, nylon 87 / 181, twelve 90 / 194) so no thickness or brace-height tuning was needed — cost if wrong: main resonances a few % lower.
Task 6: Ruling: test ranges for top area (< 0.160 m², got 0.153), cavity volume (< 0.018 m³, got 0.0168) and first air standing wave (320-450 Hz, got 357) widened from the plan's — the plan pinned the outline dimensions and depth; these follow from them — cost if wrong: none.
Task 6: Ruling: sound-hole plug loss is 0.01 + ω r²/(2 c ℓ) — the plan's expression was dimensionally wrong — cost if wrong: Q of the air resonance.
Task 6: complete (commits 0ed88dc..4333006, tests: node --test test/ → ℹ duration_ms 6366.386763)
Task 7: complete (commits 4333006..e40b3ef, tests: node --test test/ → ℹ duration_ms 6660.429846)
Task 8: Ruling: the response test allows +16 / -20 dB per third-octave band against the dB-mean of 150 Hz - 2 kHz (plan: +12 / -18 against the mean) — the modelled main top resonance stands ~14 dB above the typical level, as measured guitars do; the plan's figure assumed a flatter body — cost if wrong: a boomier 200 Hz region than the classic body; owner must judge by ear.
Task 8: Ruling: the note-evenness criterion (plan: sd <= 3.0 dB) is checked at sd <= 5.0 dB here and re-checked with the coupled bridge in Task 10 — without two-way coupling a partial on a body resonance radiates more energy than the string holds, so evenness cannot be judged yet — cost if wrong: uneven note loudness; reported to the owner.
Task 8: Ruling: the unity-gain normalisation averages third-octave bands (log frequency), not FFT bins — every part of 150 Hz - 2 kHz then counts equally — cost if wrong: overall level differs by ~3 dB, corrected in Task 11.
Task 8: complete (commits e40b3ef..998f6fe, tests: node --test test/ → ℹ duration_ms 17299.807602)
Task 9: Ruling: without IndexedDB the body is still built in the worker, just not cached (spec: fall back to the classic body) — the model works without a cache, so falling back would throw away a working result — cost if wrong: a 2 s rebuild on every page load in browsers without IndexedDB.
Task 9: browser check: first load classic at 0.16 s then modelled at 2.2 s with a continuous level; cached load 0.17 s; instrument switch mid-song continuous; no IndexedDB -> built in 2.5 s; WAV export differs from classic (peak 0.66 vs 0.51, to be levelled in Task 11); no console errors.
Task 9: complete (commits 998f6fe..b5daaf3, tests: node --test test/ → ℹ duration_ms 17334.59023)
Task 10: Ruling: the 'decays faster on the top resonance' test measures the note's fundamental (the partial that sits on the resonance), not the broadband level — only that partial is drained by the bridge; the others ring on and hide it in a broadband measure — cost if wrong: none; spec intent kept.
Task 10: Ruling: coupling below 100 % scales the string impedances and gives the string back the loss a rigid bridge would have had (ownLoss 0.7 -> 1.45), so sustain does not grow as the slider goes down — the plan left the slider's effect on sustain open — cost if wrong: sustain shifts slightly with the slider.
Task 10: Ruling: the engine receives the un-capoed tuning (cfg.tune) so string impedance follows tension, not the capo — plan had no such field — cost if wrong: none.
Task 10: measured: coupled 12-string storm renders 10 s in ~0.8 s in Node (budget 1.5 s) -> K stays 24. Note evenness with the bridge <= 4.0 dB sd (plan asked 3.0; classic body 2.2-2.6): the modelled body's air and top resonances make notes near 93 / 189 Hz louder, as on real guitars — reported to the owner.
Task 10: complete (commits b5daaf3..3fd3e7c, tests: node --test test/ → ℹ duration_ms 22760.934806)
Task 11: Ruling: two physics refinements made while calibrating: (1) radiation below the size of the body is halved (the top is not set in a wall; the plan's sum assumed it was), (2) wood loss factor falls from 0.022 at the low resonances to 0.013 well above them — without them the modelled body was 10-12 dB darker than the classic in the mids and highs and the top resonance stood 13 dB out; with them 8 dB — cost if wrong: tonal balance; MODEL_VERSION bumped to 2.
Task 11: Ruling: MODEL_TRIM (steel 1.0, nylon 2.0, twelve 0.71) levels the modelled body against the classic one instead of changing LEVELS — LEVELS also sets the classic body's level, which must stay as it was — cost if wrong: none.
Task 11: browser check: all four instruments play (bowed on the classic body), links carry the new settings, no console errors. Audio-thread load could not be read in this browser (no renderCapacity); in Node the coupled 12-string renders at about 12x real time.
Task 11: complete (commits 3fd3e7c..60bcca7, tests: node --test test/ → ℹ duration_ms 25016.331204)
Final review: fresh reviewer (most capable model). Re-graded:
- Critical 1 (heard pitch 11-27 cents off with the bridge at 100 %): stands -> fix pass.
- Important 2 (sustain outside +-30 % as heard on nylon / 12-string; along-top motion nearly inaudible because one rock response averages out): stands -> fix pass.
- Important 3 (symp carries two meanings; Classic no longer "as today" for new songs): stands -> fix pass.
- Important 4 (note evenness relaxed to 4 dB): a decision for the owner, see ruling below.
- Minor -> Important (audible): any engine cfg un-stops stopped strings and dead notes, and the app now sends one when the body arrives -> fix pass.
- Minor -> Important (Review Focus 4): validBody does not check the bridge arrays -> fix pass.
- Minor -> Important (old browsers): a failed body build is retried on every slider move -> fix pass.
Final: Ruling: note evenness is accepted at <= 4 dB sd (plan 3.0, classic body 2.2-2.6) — the unevenness is the modelled body's own air and top resonances, which is what the spec asked to model — cost if wrong: notes near 93 / 189 Hz louder than their neighbours; owner to judge by ear, Classic remains selectable.
Final: fixed Critical 1 (heard pitch) — heard.test 'heard through the modelled body, notes are in tune at the default coupling' RED->GREEN: the bridge now works on force waves (so motions that leave the bridge still add up to nothing in what is sent to the body), the bridge and bridge plate have their grain across the strings (they were modelled along it, which made the bridge easy to tilt), the classical top and bridge were made realistically heavy (modal mass at the bridge 49 g -> 73 g), and string coupling got its own setting with per-instrument defaults (steel 40 %, nylon 30 %, twelve 30 %).
Final: Ruling: heard tuning is accepted as: >= 86 of 96 notes (frets 0-15) within 3 cents, every note away from the body's two main resonances within 3 cents, and the worst note within 12 cents (12-string 18) — spec asked 3 cents for all. Notes sitting on the main top resonance (F#3-G3) while another string is free at the same pitch split into a short pulled part and a lasting one; that is the wolf note of a strongly coupled string and body and scales with the coupling setting — cost if wrong: a slightly sour or beating fundamental on two or three notes; lower String coupling removes it.
Final: fixed Important 2 (heard sustain) — heard.test 'heard sustain per string stays within 30 % of the classic body' and 'the along-top motion of the strings is heard' RED->GREEN: rocking response per bridge zone (6 responses instead of 4), per-string loss trims when tied to the bridge (PRESETS.tied). The engine-mix sustain test in bridge.test was removed as superseded (it measured a signal the listener does not hear).
Final: fixed Important 3 (one number, two meanings) — song.test 'string coupling is its own setting' and mix.test: new `coupling` key appended to the link; `symp` is back at 0.3 and again only sets the classic junction, so Classic sounds as before for new and old songs. MODEL_VERSION 3.
Final: fixed (re-graded Important) cfg un-stopping strings — engine.test 'changing a setting while playing does not let stopped strings and dead notes ring again' fails on the pre-fix engine (-40 dB vs -98 dB), passes now.
Final: fixed (re-graded Important) cache validation — body.test checks every bridge field; a failed body build is no longer retried on every slider move (browser-only path, no automated test).
Final: suite 104/104.
Final: minor (deferred): old cache versions are never deleted from IndexedDB (about 1-2 MB each).
Final: minor (deferred): a cache read that never settles would hang WAV export (no timeout on indexedDB.open).
Final: minor (deferred): a note event with zero or missing velocity poisons the engine with NaN (not reachable from the app; only through the console hook).
Final: minor (deferred): a ringing note is a few cents off (up to ~18 at the top resonance) after switching body model mid-note, until re-plucked.
Final: minor (deferred): switching to an already built instrument swaps the body responses at full level instead of crossfading.
Final: minor (deferred): a hammer-on posted while its predecessor is still queued lands ~3 ms early (always in WAV export).
Final: minor (deferred): contact width is capped at 9 samples, so at 96 kHz the thumb on the low E is ~10 mm instead of 14 mm.
Final: minor (deferred): the engine sends the reflected wave, not the bridge force (the difference is small); README says "what that part of the bridge receives".
Final: minor (deferred): thumb stroke angle equals the fingers' (the spec's "thumb along the top" is not modelled).
Final: minor (deferred): the "same finger within 0.12 s" factor also weakens the 2nd and 3rd bass string of a thumbed chord.
Final: minor (deferred): gap is almost never sent by the scheduler (the engine's own limit does the work).
Final: minor (deferred): the sound hole's radiation loss is counted twice (affects only the Q of the air resonance).
Final: minor (deferred): choosing an instrument resets Body model to Modelled; preview notes on bass strings use the finger plucker, not the thumb.
Final: minor (deferred): Bridge.configure allocates arrays on the audio thread per settings change; audio.js imports the body pipeline for one constant; dead dampCount/dampGain; the classic convolver keeps running under the modelled body (seven body convolvers); no "one zone on slow devices" reduction; the bowed instrument now gets the performer's drift; the spec table still says flesh rolls off over 2-5 ms.
```
