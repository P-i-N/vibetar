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
- A body computed from wood, bracing and air, heard through two virtual microphones
- Three instruments: steel-string, nylon and 12-string
- Five picking techniques: pick, bare fingers, short nails, long nails, hybrid
- Tunings, capo, time signature and grid (8ths, 16ths, triplets)
- Convolution reverb with spaces from a small room to a cathedral, and tempo-synced ping-pong delay
- MIDI file import (menu, or drop a `.mid` on the page): every track but the drums, quantised to the grid that fits, on frets chosen so the hand moves as little as possible ([js/midi.js](js/midi.js)). The notes keep their pitch, laid out for standard tuning without a capo, or for the current song's tuning and capo
- 15 demo songs ([js/demos.js](js/demos.js)): traditional tunes, Beethoven, Pachelbel and originals, which between them use every instrument, picking technique, technique mark, tuning, grid and reverb space
- Share by link, WAV export, no account, no server

## How the sound is made

Nothing is sampled. Everything is computed live in an `AudioWorklet` ([js/worklet.js](js/worklet.js)):

- **Strings** are digital waveguides. Each string has two transverse polarisations with slightly different tuning and decay, which gives the beating and two-stage decay of a real string.
- **Damping** follows a physical loss model `σ(f) = b1 + b3·f²` that is fitted per note, with separate material constants for wound and plain steel and for nylon. Fretted notes, palm mutes and dead notes change the losses, not a volume envelope.
- **Stiffness** of the wound strings is modelled with an allpass dispersion chain, so their overtones are slightly stretched.
- **Plucking** is a short contact at the plucking point: a pick, fingertip or nail travels across the string, pushing it aside through a spring and damper until it can hold no more, then the string slides off. Stiffness, contact width (in millimetres, so a fingertip dulls a bass string more than a treble), release time and stroke angle are what tell a pick from flesh from a nail. The contact also damps whatever the string was doing, so re-plucking a ringing string sounds different from plucking a silent one.
- **The performer** decides who plays each note: the thumb takes the bass strings, index and middle alternate, a pick alternates in runs and comes down on the beat, accents are rest strokes. Timing, loudness and plucking point drift slowly instead of jittering note by note.
- **The bridge** ties the strings to the body's 24 lowest resonances, which run inside the string engine. Each string, in each direction of motion, pushes on the bridge at its own saddle point; the bridge moves; that motion goes back into every string. So a partial sitting on a body resonance is drained quickly, motion towards the top dies sooner than motion along it (the two-stage decay of a real string), and strings ring in sympathy through the actual body. The junction is solved exactly every sample and can only take energy from the strings. **String coupling** scales how strongly the strings feel the bridge; 100 % is the value computed from the model, at which notes sitting on the main top resonance turn into the wolf notes of a real guitar (a quickly dying, slightly detuned fundamental), so instruments start at 30–40 %.
- **Hands on the strings** are contact points: lossy junctions at a position along the string that absorb and reflect part of the passing wave, and can never add energy. A fingertip resting above the 12th fret leaves only the partials with a node there — a natural harmonic. The edge of the palm near the bridge gives palm muting, the fretting hand lying across the strings a dead note, and a finger letting go of a fret stops the note.
- **The fretting hand** ([js/hand.js](js/hand.js)) is planned from the tab before it is played. Its position along the neck is the cheapest path through the shapes the tab asks for: moving costs, stretching costs more. A fretted note keeps ringing while its finger can stay down together with the new notes; when the hand moves, or a finger is needed elsewhere, the note stops. Where the shape needs it (more than four notes, three neighbouring strings at one fret, or three strings at one fret around a higher note) the index finger lies flat as a barre; strings stopped by the soft side of a finger lose more of their highs and ring shorter. In a single-note line (one note at a time, mostly by step) each note mutes the string sounding before it, a little late or not at all now and then.
- **Finger noise**: when the hand moves, a finger rides a string. It squeaks most with long shifts, at section starts and after pauses, little in fast passages; the hand re-gripping after a long chord or at a section start can squeak too. On wound strings that is a pulse train (one pulse per winding, so its pitch follows the finger speed) coloured by the string's longitudinal resonance; plain strings only hiss.
- **The body** is computed, not tuned by hand ([js/body/](js/body)). For each instrument — an X-braced dreadnought, a fan-braced classical, a jumbo 12-string — the top and back are thin orthotropic plates on an 8 mm grid, with every brace a beam along its own line, the bridge as added mass and stiffness, and the sound hole cut out. Their resonances are found with a sparse eigen-solver, then joined with the air between them (its breathing motion through the sound hole and its standing waves) and solved again as one instrument: about 250 resonances. With typical wood data and nothing fitted, the steel-string comes out with its air resonance at 93 Hz and main top resonance at 189 Hz, where real ones have them.
- **Two virtual microphones** stand 40 cm in front of the guitar, one towards the neck and one over the lower bout. What each hears is summed over the moving surface of the top, the sound hole and (at low frequencies) the back, so the stereo image comes from real path differences. Above about 3.5 kHz, where the grid stops being accurate, a calibrated statistical field takes over. The result is six stereo impulse responses: for pushing on, and for rocking, the bass, middle and treble part of the bridge. The string engine feeds each with what that part of the bridge receives.
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
