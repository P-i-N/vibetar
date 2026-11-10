# vibetar

A small guitar tab editor with a physically modelled acoustic guitar and string synthesizer, running entirely in the browser.

**▶ https://p-i-n.github.io/vibetar/**

Write a tab, press play, copy the page address to share it — the whole song (notes, instrument and effect settings) lives in the link.

## Features

- Six-string tab grid with keyboard, mouse and touch input; copy / paste, undo, bar tools
- Techniques: hammer-on / pull-off, slide, bend, vibrato, dead notes, accents — and they combine. A slide from a note that has faded (plucked more than half a second before) plucks that note again and slides from it
- Palm-muted passages, marked with a `P.M.` bracket above the staff
- Natural harmonics, written `<12>`
- A fretting hand read from the tab: it holds notes down while it can, barres chords, moves along the neck when it must, and mutes the string before in single-note lines; its fingers squeak where hands do — on shifts, at section starts, after pauses
- A fretboard under the tab that shows this hand: its position, the finger on each note, barres, open strings, harmonics and the strings that sound
- **Humanize** (the switch next to the tempo, the amount in the Player panel): timing and loudness drift, phrases breathe, the song slows into its last note, the melody is brought out, no string is exactly in tune. Off: the tab is played exactly as written
- A body computed from wood, bracing and air, heard through two virtual microphones
- Three instruments: steel-string, nylon and 12-string
- Three picking techniques: pick, fingers, hybrid (pick on the bass strings, fingers on the trebles)
- Tunings, capo, time signature and grid (8ths, 16ths, triplets)
- Convolution reverb with spaces from a small room to a cathedral, and tempo-synced ping-pong delay
- MIDI file import (menu, or drop a `.mid` on the page): every track but the drums, quantised to the grid that fits, on frets chosen so the hand moves as little as possible ([js/midi.js](js/midi.js)). The notes keep their pitch, laid out for standard tuning without a capo, or for the current song's tuning and capo
- Twelve demo songs ([js/demos.js](js/demos.js)) in the Demos menu: traditional tunes, a minuet and originals, which between them use every instrument, picking technique, technique mark, tuning and grid, all played in the same room
- Share by link, WAV export, no account, no server

## How the sound is made

Nothing is sampled. Everything is computed live in an `AudioWorklet` ([js/worklet.js](js/worklet.js)):

- **Strings** are digital waveguides. Each string has two transverse polarisations with slightly different tuning and decay, which gives the beating and two-stage decay of a real string.
- **Damping** follows a physical loss model `σ(f) = b1 + b3·f² / (1 + (f / f_flat)²)` that is fitted per note, with separate material constants for wound and plain steel and for nylon. Friction inside nylon grows with the square of the frequency (no `f_flat`). A plain steel string loses its energy to the air and to heat that flows across the bending wire, which grow more slowly: its loss stops growing at 8 kHz, so its highest partials last about twice as long. The winding of a new bronze-wound string takes about the same share of the energy in every cycle: the loss of the wound steel strings stops growing at 6 kHz (an estimate for new strings: a Q near 3000 from 4 kHz up), which keeps the low notes bright while they ring. Fretted notes, palm mutes and dead notes change the losses, not a volume envelope.
- **Tuning** a string loop to a pitch needs a delay of a fraction of a sample. A fifth-order Lagrange interpolator gives it. A shorter one takes more from the highs than the string does (at 8 kHz up to 2.6 % for each trip round the string, against 0.5 %), by an amount that changes from note to note.
- **Stiffness** stretches the overtones of every string: partial k lies at k f sqrt((1 + B k²) / (1 + B)). B comes from string data (B = π³ E d⁴ / (64 T L²), with the core diameter for a wound string; for steel from 1.1·10⁻⁵ on the wound G to 8.3·10⁻⁵ on the low E) and grows with the square of the frequency on a fretted, shorter string. For each note, a chain of one to six first-order allpass filters is fitted to partials 2–30 (up to 5 kHz): up to partial 16 the stretch is within about 20 % of the target; above that, first-order filters stretch less than a real string.
- **Tension modulation**: a plucked string is stretched, so its tension and pitch rise with the energy it carries and fall back as it dies away. An mf pluck starts about 4 cents sharp on the low E and 0.3 cents on the high E (estimated from string data); a hard pluck about twice that.
- **Longitudinal pull**: the stretching string also pulls on the bridge along itself, with the square of its slope there. That pull, ringing at the string's longitudinal resonance (1.4–3.9 kHz on steel), rocks the bridge and adds phantom partials at sums of the partials' frequencies: next to the normal partials on a stiff string, where the sums no longer coincide with them. On steel it is 24–38 dB below the note at mf and grows twice as fast in dB; on nylon it is far weaker.
- **Plucking** is a short contact at the plucking point: a pick, fingertip or nail travels across the string, pushing it aside through a spring and damper until it can hold no more, then the string slides off. Stiffness, contact width (in millimetres, so a fingertip dulls a bass string more than a treble), release time and stroke angle are what tell a pick from flesh from a nail. A string rolls off the edge of a pick or a nail over its own thickness, and a faster stroke is past it sooner: a thick wound string gets a rounder attack than a thin plain one (the low E has 6 dB less above 4 kHz at mf than it would with no thickness, the high E 1 dB), and a soft stroke a rounder one than a hard stroke (by 12 dB on the low E, 7 dB on the high E, between strengths 0.4 and 1). The roughness of the contact is small: more of it gives every attack the same hiss, whatever the string and the strength. The contact also damps whatever the string was doing, so re-plucking a ringing string sounds different from plucking a silent one.
- **Hammer-ons and pull-offs** are played by the fretting hand, not by a pitch glide: the string is the new length at once. A hammer-on is a fingertip striking the string onto the fret, a blow next to the new end of the string: it adds energy, with a thinner fundamental than a pluck, about 9 dB below a picked note. A pull-off is the finger flicking sideways off the higher fret: a soft pluck where it held the string, mostly along the top, about 7 dB below. Only slides glide.
- **The performer** decides who plays each note: the thumb takes the bass strings; each treble string has its finger (index on G, middle on B, ring on the top string), and along one string index and middle alternate; a pick alternates in runs and comes down on the beat; accents are rest strokes. Timing, loudness and plucking point drift slowly instead of jittering note by note (at Humanize 50 %: about 6 ms and 5 %, with up to 2 ms and 5 % of scatter from note to note).
- **Phrasing** (also scaled by Humanize): a phrase of four bars moves on towards its middle and eases off towards its end, and swells; the last bar slows down and softens into the last note, unless the song is looped; of notes plucked together the top one is louder; a note after a long, quick shift of the fretting hand comes a few milliseconds late; at Humanize 100 % each string is up to 1.5 cents off for the whole song, and a fretting finger pulls its note 0.6 to 1.8 cents sharp.
- **The bridge** ties the strings to the body's 24 lowest resonances, which run inside the string engine. Each string, in each direction of motion, pushes on the bridge at its own saddle point; the bridge moves; that motion goes back into every string. So a partial sitting on a body resonance is drained quickly, motion towards the top dies sooner than motion along it (the two-stage decay of a real string), and strings ring in sympathy through the actual body. The junction is solved exactly every sample and can only take energy from the strings. **String coupling** scales how strongly the strings feel the bridge; 100 % is the value computed from the model, at which notes sitting on the main top resonance turn into the wolf notes of a real guitar (a quickly dying, slightly detuned fundamental), so instruments start at 30–40 %.
- **Hands on the strings** are contact points: lossy junctions at a position along the string that absorb and reflect part of the passing wave, and can never add energy. A fingertip resting above the 12th fret leaves only the partials with a node there — a natural harmonic. The edge of the palm near the bridge gives palm muting, the fretting hand lying across the strings a dead note, and a finger letting go of a fret stops the note.
- **The fretting hand** ([js/hand.js](js/hand.js)) is planned from the tab before it is played. Its position along the neck is the cheapest path through the shapes the tab asks for: moving costs, stretching costs more. A fretted note keeps ringing while its finger can stay down together with the new notes; when the hand moves, or a finger is needed elsewhere, the note stops. Where the shape needs it (more than four notes, three neighbouring strings at one fret, or three strings at one fret around a higher note) the index finger lies flat as a barre; strings stopped by the soft side of a finger lose more of their highs and ring shorter. In a single-note line (one note at a time, mostly by step) each note mutes the string sounding before it, a little late or not at all now and then. Every fretted note has its finger: one finger for each fret from the hand's position (the index finger takes the lowest fret where the hand has the choice), neighbouring fingers for notes in one fret, the index finger for a barre. A hammer-on is as strong as the finger that plays it, a pull-off as the finger that leaves the string: the ring finger is a little weaker, the little finger weaker still.
- **Finger noise**: when the hand moves, a finger rides a string. It squeaks most with long shifts, at section starts and after pauses, little in fast passages; the hand re-gripping after a long chord or at a section start can squeak too. On wound strings that is a pulse train (one pulse per winding, so its pitch follows the finger speed) coloured by the string's longitudinal resonance; plain strings only hiss.
- **The body** is computed, not tuned by hand ([js/body/](js/body)). For each instrument — an X-braced dreadnought, a fan-braced classical, a jumbo 12-string — the top and back are thin orthotropic plates on an 8 mm grid, with every brace a beam along its own line, the bridge as added mass and stiffness, and the sound hole cut out. Their resonances are found with a sparse eigen-solver, then joined with the air between them (its breathing motion through the sound hole and its standing waves) and solved again as one instrument: about 250 resonances. With typical wood data and nothing fitted, the steel-string comes out with its air resonance at 93 Hz and main top resonance at 189 Hz, where real ones have them.
- **Two virtual microphones** stand 40 cm in front of the guitar, one towards the neck and one over the lower bout. What each hears is summed over the moving surface of the top, the sound hole and (at low frequencies) the back, so the stereo image comes from real path differences. Above about 3.5 kHz, where the grid stops being accurate, a calibrated statistical field takes over, at one level for all three parts of the bridge (and one for rocking): up there the top answers a force alike wherever on the bridge it acts. The result is six stereo impulse responses: for pushing on, and for rocking, the bass, middle and treble part of the bridge. The string engine feeds each with what that part of the bridge receives.
- **The microphone chain of the steel-string** is not computed: it is a response matched to a recording. Against 23 seconds of recorded fingerstyle playing, the model alone has its main top resonance 8 dB too far above the third-octave bands next to it, a hole below it, and falls 7 dB (3 kHz) to 25 dB (10 kHz) too far towards the highs. The chain ([js/ir.js](js/ir.js), `MICS`) cuts 12 dB at the top resonance, lifts 8 dB at 126 Hz, and rises from 2 kHz to +9 dB at 4 kHz and +16 dB at 13 kHz: about two thirds of the fall, because a part of it is the equalizer of the recording. With it the long-term spectrum of five steel-string demos is within 5 dB of the recording from 80 Hz to 8 kHz (but 7 dB above it at 800 Hz), and the fingerstyle demos have its brightness (median centroid 1170 Hz against 1280 Hz). The nylon and the 12-string have no such chain.
- The body takes about two seconds to compute the first time an instrument is used, in a background worker; it is then kept in the browser (IndexedDB). Playback waits until it is ready; the other instruments are then built in the background.
- **Reverb** is a synthesized impulse response too: early reflections and band-split decaying noise.

## Shortcuts

| Key | Action |
| --- | --- |
| `0`–`9` | Enter a fret (two digits quickly for 10–24) |
| Arrows | Move · `Shift` selects · `Ctrl` jumps a beat |
| `Space` / `Enter` | Play from the cursor's bar / from the top |
| `L` | Loop (the selection, if there is one) |
| `H` `S` `B` `V` | Hammer-on/pull-off · slide · bend · vibrato |
| `M` | Palm mute (select a passage first to mute all of it) |
| `*` | Natural harmonic: a finger touches the open string above that fret |
| `>` | Accent |
| `X` `.` | Dead note · stop the string |
| `+` `-` | Shift selected frets up / down |
| `Ctrl+C/X/V`, `Ctrl+Z` | Clipboard, undo |

## Development

No build step and no dependencies — static files only.

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765/.

The string engine, the body model, the song format, the demos and the MIDI import have offline tests (Node 22+, no packages; about 90 s, most of it building bodies and rendering the demos):

```bash
node --test "test/*.test.mjs"
```

## License

See [LICENSE](LICENSE).
