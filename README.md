# Driftloom

A procedural loop machine. It generates relaxing, meditative and joyful nostalgic loops, plays
it forever, and lets you re-roll one layer at a time until it's yours.

Everything is synthesised in the browser from oscillators and one noise buffer.
No samples, no libraries, no build step, nothing to download. It runs from a
single folder on a cheap Android phone.

## Running it

The app uses ES modules, which browsers refuse to load over `file://`. So you
need a local server — any of these will do:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

To use it on a phone, push the repo to GitHub and turn on Pages
(Settings → Pages → deploy from `main`, root). Open the URL in Chrome and use
"Add to home screen" — there's a manifest and a service worker, so after the
first visit it works with no signal at all.

## Using it

| | |
|---|---|
| Space | play / stop |
| N | a completely new loop |
| S | save the current one |
| 1–5 | re-roll drums, bass, keys, melody, air |

**Re-roll** replaces one layer and leaves the others untouched. Re-rolling the
keys is the exception — it changes the harmony, so the bass and melody follow
it while keeping their own rhythms.

**Drift** makes the loop vary as it repeats: a hat drops out, a melody note
steps to its neighbour, a layer takes a bar off. It always returns to the loop
you saved, because the variations are computed fresh from the original each
pass and never written back.

**Export MIDI** writes a four-repeat type-1 file with drums on GM channel 10,
so the notes can go to a DAW, a groovebox, or anything with a MIDI in.
Whatever the browser synth sounds like, the composition itself travels.

## How it works

A loop is a **spec**: a tempo, a key, a mode, a swing amount, three tone
settings, and one random seed per layer. Rendering a spec is deterministic, so
the spec *is* the loop. That's why saves are a few hundred bytes and why
re-rolling one layer cannot disturb the others — each layer draws from its own
random stream, and re-rolling only moves one of them.

```
js/rng.js         seeded PRNG, and the syllable generator for loop names
js/theory.js      scales, chord building, pitch maths
js/generator.js   the composer: spec -> pattern, and the drift mutations
js/synth.js       voices and the reverb/echo bus
js/engine.js      lookahead scheduler
js/midi.js        standard MIDI file writer
js/storage.js     localStorage saves, plus backup and restore
js/ui.js          DOM rendering
js/main.js        state and wiring
```

Notes worth knowing if you go digging:

- **Scheduling** uses the two-clock pattern. `setTimeout` only wakes the
  scheduler up; every note is placed at an absolute Web Audio time, which is
  sample-accurate. `setTimeout` itself is far too jittery to put notes on.
- **Melodies are motif-based.** A short figure is generated once and then
  quoted across the loop with transposition, trimming and dropped notes.
  Repetition with variation is most of what separates a composed line from a
  sprayed one.
- **The reverb** is six damped comb filters rather than a convolver: cheaper on
  a weak phone, and tunable while it plays, which a fixed impulse response
  isn't.
- **Lighter on the processor** halves the comb count and drops oversampling.
  It's on by default on devices reporting four cores or fewer.

## Tests

```sh
node test/generator.test.mjs
```

Checks 5,000 seeds for out-of-range notes, confirms that re-rolling a layer
leaves the others byte-identical, and parses 500 exported MIDI files to verify
they're structurally valid with no unreleased notes. This has already caught
three real bugs, including chord voicings that walked off the bottom of the
keyboard over successive bars.

## Known rough edges

- **The mix is not balanced yet.** Bass sits about two to three times louder
  than the drums, and one melody voice is louder still. Peaks before limiting
  run to about 1.45, so the output compressor is working on every loop instead
  of catching the occasional transient. Expect it to sound bass-heavy and a
  little squashed. This is the next thing to fix.
- Loops are always 4/4. No odd meters yet.
- There's no way to edit a pattern by hand — you can only re-roll.
- Saves live in this browser on this device. Use "Back up all" to move them.

## Licence

MIT. Do what you like with it.
