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

## Profiles

A profile is a set of constraints -- tempo band, scale pool, instruments,
density, metre, form -- that move together.

| | |
|---|---|
| **Dust** | worn tape; the original voice, still the commonest draw |
| **Glade** | modal folk. Modes sharing a lowered 7th so bVII-to-I is available; harp, ocarina, flute, often 6/8 |
| **Thaw** | cold and spacious. Sparse piano, long silence, octave leaps, quartal chords, dropped steps |
| **Haven** | still and domestic. Rhodes and a hushed pad, no percussion, very slow, deliberately dry |
| **Bloom** | bright and mechanical. Mono lead with portamento through a resonant filter |
| **Vapor** | drifting. Coprime layer cycles that never resynchronise |
| **Halcyon** | warm analogue nostalgia. Fat detuned pads, soft breakbeat, long dub delays |
| **Clockwork** | prepared piano. Felt-damped, faintly out of tune, the mechanism audible |
| **Shatter** | fast and fractured. Chopped breaks, stutter rolls, chromatic turns |
| **Undertow** | hypnotic pulse. Steady four, very short fragments, the mix breathing against the kick |

These are not ten boxes. Every loop draws a **weight across several of
them** -- an exponential draw per profile, normalised, which is a Dirichlet
and spreads weight far more naturally than picking fractions by hand. About
78% of loops blend two to four profiles, with lopsided mixes commoner than
even ones, so a loop still sounds like it is *about* something. Pools are
unioned rather than replaced, so a mostly-Dust loop with a little Glade in
it can still reach for an ocarina.

## Feeling

Three dials, not one slider:

- **lift** -- settled to lifted. Steers scale choice, register, the
  direction of the melodic walk, added ninths.
- **energy** -- still to animated. Steers tempo, hat density, how often bars
  rest.
- **warmth** -- glassy to warm. Steers saturation and timbre.

Independent axes let a loop be glad and unhurried at once, or hushed and
restless, rather than sliding along one line between two moods. The word in
the readout comes from their combination: serene, exuberant, wistful,
bustling, reflective, peaceful, happy, easy, restless.

Neither end of any axis is a sad end. The framing is sukha to piti, comfort
to brightness, rather than gloom to joy.

## How it works

A loop is a **spec**: a tempo, a key, a mode, a swing amount, three tone
settings, and one random seed per layer. Rendering a spec is deterministic, so
the spec *is* the loop. That's why saves are a few hundred bytes and why
re-rolling one layer cannot disturb the others — each layer draws from its own
random stream, and re-rolling only moves one of them.

```
js/rng.js         seeded PRNG, and the syllable generator for loop names
js/clock.js       worker-based tick source that survives backgrounding
js/media.js       media element routing and lock-screen / headset controls
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

## Playhead

`AudioContext.currentTime` is the time of audio handed to the output, not of
audio arriving at the ear. The gap is the output latency, which on Android
can exceed 300ms and changes the moment Bluetooth headphones connect.
Lighting the cursor at `currentTime` therefore runs ahead of the music by an
unknown amount, and asking the user to dial that in by hand is not a fix.

`getOutputTimestamp()` exists for exactly this. It returns a correlated
pair: the audio-clock time of the sample being played *at the output*, and
the performance-clock time it happened. Interpolating from that pair with
`performance.now()` gives true playback position, self-correcting as latency
changes underneath. The implied latency is smoothed rather than the
position, so the cursor never jumps backwards on a wobbly measurement.
Falls back to `outputLatency` / `baseLatency` if the timestamp is unusable.

The cursor repaints on animation frames and touches only the two cells that
changed. A manual trim survives in Diagnostics for hardware that reports
nothing usable; it should never be needed.

## Tests

```sh
node test/generator.test.mjs
```

Checks 5,000 seeds for out-of-range notes, confirms that re-rolling a layer
leaves the others byte-identical, and parses 500 exported MIDI files to verify
they're structurally valid with no unreleased notes. This has already caught
three real bugs, including chord voicings that walked off the bottom of the
keyboard over successive bars.

## Playing it in your pocket

Android will only give a web page lock-screen controls, a notification, and
the Bluetooth transport buttons if it considers the page a media player.
Web Audio alone does not qualify.

The obvious approach — routing the mix through an `<audio>` element with a
`MediaStreamAudioDestinationNode` — **does not work on Chrome for Android**.
Stream-backed elements are classed as communications audio, the same
category as a WebRTC call, and communications audio is deliberately
excluded from media notifications. It also adds a resampling stage that
glitches under load. It was tried, and it produced sound and nothing else.

What works is playing a real encoded file, and it has to clear two separate
bars that are easy to miss:

- **Length.** Chrome treats media under about five seconds as a sound
  effect rather than content, and sound effects never get transport
  controls. A two second loop was granted a session and still produced no
  notification. `audio/keepalive` is fifteen seconds.
- **Level.** A stream Chrome judges silent loses the session, so the file
  is not digital silence: it is noise at roughly -62 dBFS RMS, inaudible
  under music but clear of the detector's threshold. That is also why it
  stays lossless — an MP3 encoder would discard a signal that quiet and
  hand back real silence. FLAC is offered first, with a WAV fallback.

It runs alongside the music, which goes straight to the speakers untouched.

Skipping forward past the end of the history makes a brand new loop, so the
next-track button always does something.

The scheduler runs off a Web Worker and queues further ahead while the page
is hidden (3s instead of 0.3s). Backgrounded pages get their timers clamped
to roughly one tick a second, which starves a short queue.

## Diagnostics

There is a Diagnostics panel at the bottom of the page. It reports which
audio path is live, whether the media session was granted, and a count of
scheduler wake-ups that arrived too late to place a note — which is what a
stutter looks like from the inside. Play with the screen off for a minute,
come back, and read `lateTicks` and `worstLateMs`.

## A note on the tape saturator

It is easy to write this stage as `tanh(x * drive) / tanh(drive)`, because
that maps 1 to 1 and looks like the right normalisation. It is not. The
slope at zero becomes `drive / tanh(drive)`, which reached 3.2, so every
quiet detail got hauled up while the peaks were clamped. That is a
distortion pedal wearing a tape machine's name, and it was audible as
clipping even though the output never came near full scale.

Dividing by `drive` instead makes the slope at zero exactly 1. Quiet
passages pass through untouched and only loud ones round off, which is what
tape does.

## Silence

Temple of Time and the Breath of the Wild field music have several seconds
of actual nothing in them. A loop cannot get that by leaving a fixed hole in
the bar line -- on a short loop the same gap every sixteen seconds reads as
a skip rather than a rest.

Instead each layer gets an **entry schedule**: which bars it is present for,
in runs of a few bars at a time. Silence emerges wherever the runs coincide
in absence, and because layers have different run lengths (and under
polymeter different cycle lengths) it lands somewhere different each time
round. Drift can also rest everything for a bar or two, unpredictably, over
a loop you already know.

Schedules alone overshoot badly, because entry runs, the melody's rest-bar
chance and the sparser bass styles all subtract independently. One sixteen
bar loop played for four bars and then stopped for eleven. So after masking,
any run of empty bars beyond the character's allowance gets a layer put
back. Longest rest now tops out at 3 bars, with 18% of an airy loop silent
-- four to eight seconds at these tempos.

Entries and exits are quantised to two-bar boundaries. Music stopping on
bar three and a half is what reads as "it just stopped"; stopping where a
phrase would end reads as a breath.

Loops under 8 bars are left alone entirely; a hole in a two-bar loop is a
glitch, not a breath. Reverb and echo run through one gain node so a rest
can be ducked rather than filled with wash. Rests land 20-45 dB below
programme level rather than at digital zero, because held notes are allowed
to decay into them, which is what the references do too.

## Known rough edges

- Output now peaks between about 0.46 and 0.84 with no full-scale samples
  across long multi-pass renders, and the crest factor survives the bus.
- Loops are always 4/4. No odd meters yet.
- There's no way to edit a pattern by hand — you can only re-roll.
- Saves live in this browser on this device. "Back up all" downloads a file;
  if Android's file picker will not show it again, use "Copy backup" and
  "Paste backup", which go through the clipboard and avoid the file system
  entirely.

## Licence

MIT. Do what you like with it.
