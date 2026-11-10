# vibetar

A small guitar tab editor with a physically modelled acoustic guitar and string synthesizer, running entirely in the browser.

**▶ https://p-i-n.github.io/vibetar/**

Write a tab, press play, copy the page address to share it — the whole song (notes, instrument and effect settings) lives in the link.

## Features

- Six-string tab grid with keyboard, mouse and touch input; copy / paste, undo, bar tools
- Techniques: hammer-on / pull-off, slide, bend, vibrato, palm mute, dead notes, accents, natural harmonics
- Four instruments: steel-string, nylon, 12-string and bowed strings
- Tunings, capo, time signature and grid (8ths, 16ths, triplets)
- Convolution reverb and tempo-synced ping-pong delay
- Share by link, WAV export, no account, no server

## How the sound is made

Nothing is sampled. Everything is computed live in an `AudioWorklet` ([js/worklet.js](js/worklet.js)):

- **Strings** are digital waveguides. Each string has two transverse polarisations with slightly different tuning and decay, which gives the beating and two-stage decay of a real string.
- **Damping** follows a physical loss model `σ(f) = b1 + b3·f²` that is fitted per note, with separate material constants for wound and plain steel and for nylon. Fretted notes, palm mutes and dead notes change the losses, not a volume envelope.
- **Stiffness** of the wound strings is modelled with an allpass dispersion chain, so their overtones are slightly stretched.
- **Plucking** injects an ideal-pluck velocity pulse. Its length comes from the picking position, its edges from pick hardness and pluck strength — harder plucks are brighter, not just louder.
- **The bridge** is a passive scattering junction shared by all strings, so open strings ring in sympathy.
- **Bowed strings** use a stick-slip friction junction between two waveguide sections.
- **The body** is a synthesized modal impulse response ([js/ir.js](js/ir.js)): the air and top-plate resonances plus a dense, calibrated field of a few hundred higher modes, slightly different for the left and right channel.
- **Reverb** is a synthesized impulse response too: early reflections and band-split decaying noise.

## Shortcuts

| Key | Action |
| --- | --- |
| `0`–`9` | Enter a fret (two digits quickly for 10–24) |
| Arrows | Move · `Shift` selects · `Ctrl` jumps a beat |
| `Space` / `Enter` | Play from the cursor's bar / from the top |
| `L` | Loop (the selection, if there is one) |
| `H` `S` `B` `V` | Hammer-on/pull-off · slide · bend · vibrato |
| `M` `>` `*` | Palm mute · accent · natural harmonic |
| `X` `.` | Dead note · stop the string |
| `+` `-` | Shift selected frets up / down |
| `Ctrl+C/X/V`, `Ctrl+Z` | Clipboard, undo |

## Development

No build step and no dependencies — static files only.

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765/.

## License

See [LICENSE](LICENSE).
