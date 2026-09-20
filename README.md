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

To use it on a phone, it deploys to Cloudflare Workers as static assets.
`wrangler.jsonc` is an assets-only config — no build step, no `main` entry,
Wrangler uploads the folder. The dashboard side is Settings → Build on the
Worker: branch `main`, empty build command, deploy command
`npx wrangler deploy`, root directory `/`. Pushing to `main` deploys.

Live at <https://driftloom.kruu-mikey-thaiculture.workers.dev/>. Open it in
Chrome and use "Add to home screen" — there's a manifest and a service
worker, so after the first visit it works with no signal at all.

The service worker is **network first**, with the cache as the offline
fallback. A deploy therefore shows up on the next cold start: close the app
from the recents switcher and reopen it, rather than returning to a
backgrounded instance. Diagnostics reports `build`, which is the way to
confirm what you are actually running; bump `BUILD` in `js/main.js` and
`CACHE` in `sw.js` together on every change.

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
| **Grove** | wooden mallets. Kalimba tines and marimba bars: dry pitched percussion, which nothing else here provides |
| **Hollow** | voices. Synthetic vowels and humming, wordless and unhurried |
| **Shrine** | struck metal left to ring. Temple bowls and church bells, long decays, a lot of space between strikes |
| **Undertow** | hypnotic pulse. Steady four, very short fragments, the mix breathing against the kick |

These are not ten boxes. Every loop draws a **weight across several of
them** -- an exponential draw per profile, normalised, which is a Dirichlet
and spreads weight far more naturally than picking fractions by hand. About
78% of loops blend two to four profiles, with lopsided mixes commoner than
even ones, so a loop still sounds like it is *about* something. Pools are
unioned rather than replaced, so a mostly-Dust loop with a little Glade in
it can still reach for an ocarina.

New voices go into **new profiles**, never into existing pools. Voices are
drawn at render time from the blended pool, so adding one entry to an
existing pool shifts that weighted draw and every random decision after it --
every share code already in circulation would quietly render as different
music. Verified: 2000 codes referencing only pre-existing profiles decode
identically after `grove` and `hollow` were added.

## Feeling

A loop's feeling is a **mixture of named moods**, not a position between two
poles. A readout of `60% peaceful · 30% reflective · 10% happy` means what it
says.

Averaging those would land on one middling value that is none of them. But a
piece really can be glad and inward at once -- a bright line over a low,
sparse accompaniment -- and that is not a midpoint, it is different layers
carrying different feeling. So the loop has a centre, and **each layer draws
its own mood from the mixture** and is pulled part-way back toward that
centre by the loop's *coherence*. Low coherence lets the melody be happy
while the harmony stays soothing; high coherence keeps everyone agreeing.

The moods are joyful, happy, enthusiastic, refreshing, soothing, peaceful,
comforting and reflective -- the bright quickened wing and the settled
comforted one, plus two inward. No sad pole. Roughly 76% of loops carry two
or three, and each mood takes between 10% and 15% of all emotional weight.

Which layer carries which mood is keyed off the loop seed rather than any
layer seed, so re-rolling the bass does not reshuffle the feeling.

Underneath, each mood is a point on three dials:

- **lift** -- settled to lifted. Steers scale choice, register, the
  direction of the melodic walk, added ninths.
- **energy** -- still to animated. Steers tempo, hat density, how often bars
  rest.
- **warmth** -- glassy to warm. Steers saturation and timbre.

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
- **Rhythm is drawn before pitch.** The motif takes its note positions and
  lengths from one of thirty rhythmic cells -- dotted, syncopated,
  anticipated, short-short-long, three-against-four, staccato bursts, long
  sustains -- with separate tables for 16- and 12-step bars, and the rest
  built to fit whatever other metre a profile asks for. Which cells are
  likely follows the loop's energy and lift, so a joyful loop gets a
  bouncier figure and a reflective one gets long notes. Pitch is a random
  walk laid over whatever the cell decided.
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

## Statistics

```sh
node tools/stats.mjs --n 4000
node tools/stats.mjs --n 4000 --lift-low --lift-high
```

Draws a corpus the way the app does -- `newSpec()` then `render()` -- and
reports what came out: dominant profile, steps per bar, melody voice and
rhythmic cell distributions, mean melodic span, note count, note duration and
velocity, and the share of melody notes landing off the beat. Counted on the
rendered pattern, after entry schedules and gaps have zeroed what they
silence, so the figures describe what you would hear.

`--lift-low` and `--lift-high` split the corpus by `feel.lift` and print the
two buckets side by side, which is how you check that a change actually
follows the feeling rather than applying evenly. Both take an optional
value; the defaults are roughly the quartiles of a distribution that is
skewed high.

The corpus is deterministic -- same `--seed`, same loops -- which is what
makes a before-and-after comparison mean anything.

## Measurement

```sh
node tools/measure.mjs --n 30
```

The audio counterpart to the statistics above. It renders loops offline and
reports what came out of the bus: per-loop peak, RMS and full-scale sample
count, the peak and RMS spread across the corpus, crest factor, and the dry
level of each layer tapped at its channel gain -- so the balance between
melody, keys and air is measured rather than read off the gain table and
hoped for. The per-layer figures are dry on purpose: reverb and echo returns
arrive through one shared pair of nodes, so a wet tail cannot be attributed
back to the layer that sent it.

It drives the real `Engine` and `Synth` against an `OfflineAudioContext` --
same nodes, same envelopes, same saturator, same ceiling, same scheduling
code that runs when you press play. Web Audio does not exist in Node, and a
reimplementation of the graph would only measure the reimplementation, so
the tool runs the app inside headless Chromium:

```sh
npm install -g playwright && npx playwright install chromium
```

That is a dependency of this one tool. The app still has no build step and
still runs from a folder.

## Track length

Off by default: a loop machine should loop until you say stop. Set it and a
track hands over after that many passes, from one up to 9999 -- a two-bar
loop set to the top runs for the better part of a week. The control is a
slider of curated stops rather than a linear range, because 0 to 9999
linear gives no useful control at the short end, and short lengths are what
anyone actually sets. The readout shows both the passes and what they come
to in time at this tempo, to the next loop in the album if
one is playing, otherwise onward through the history. It is stored per loop
and carried in the share code, so an album can have genuinely varied song
lengths rather than one global setting.

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

## Sharing

A loop is a recipe, not a recording, so it fits in a code and needs no
internet at either end.

MIDI is the wrong tool for this. MIDI carries the notes, which means the
recipient gets a frozen transcript they cannot re-roll, drift or edit. MIDI
is for taking music *out* to a DAW; a share code is for taking a loop to
another Driftloom.

A song code is about 111 characters:

    DL1-0405P-0020G-80BBK-BG48Y-8PAG3-A9R7D-QQJEX-14P70-S3BEK-...

Albums open to show their tracks. **Adding the current loop to an album
saves it** -- making someone press Save first was a rule the app imposed for
its own convenience. Tracks can be replaced in place with whatever is
playing (keeping their position in the running order), removed, or played
from. Albums can be renamed.

An album is a named list of loops and shares the same way, at roughly 110
characters per loop, and **plays as a playlist** -- the skip buttons walk the
album while one is playing -- long enough to copy and paste rather than read out,
but still just text.

Two decisions worth recording:

- **The code is explicit, not just a seed.** A seed-only code would be about
  ten characters, but it would mean whatever the generator happened to make
  of it *that week*: change one weighting and every code already written
  down quietly becomes different music. Writing the parameters down costs
  about seventy bytes and makes a code mean one thing permanently.
- **Crockford Base32**, because codes get read aloud and typed. It drops I,
  L, O and U so there is no 1/l or 0/O confusion, it is case-insensitive,
  and a Fletcher-16 checksum catches transposed characters -- which is
  exactly the mistake people make copying one out by hand.

Generation is quantised to the same 1/255 grid the encoding uses. These
weights feed weighted random picks, so a rounding difference of 0.004 is
enough to pick a different scale, and snapping generation to the grid makes
a code lossless by construction. Verified over 25,000 round-trips, edited
loops included: zero differences.

## Cover art

Generated from the same numbers as the music, so artwork travels inside a
share code without an image being sent.

The first version drew one full-bleed noise field per cover. It was cheap
and it was boring: same composition every time, uniform density, no empty
space, so after about ten you had seen the trick. **Noise is not
composition.**

A cover is now built the way a picture is:

- A **ground** that is a gradient, not a flat fill. Where a mask leaves the
  frame bare, the ground *is* the picture, and a flat fill there reads as
  unfinished canvas.
- One to three **masked fields** combined with blend modes. Compositions are
  horizon, orb, stack, split, aperture, drift, shard and full, so large
  areas are deliberately left empty.
- A **crop** that sometimes pushes into the detail, so covers do not all
  read at the same distance.
- **Geometry** set against the organic parts, and a posterising pass that
  turns smooth gradients into something graphic.

Tied to the music throughout: energy becomes turbulence, warmth picks the
palette family, lift sets brightness, **the key rotates the hue** (twelve
roots, twelve colourways), swing shears the field, bar count sets the number
of strata, **the metre sets rotational order** (threes in 6/8, fives in 5/4),
the number of profiles in the blend sets the number of layers, and coherence
governs how unified the composition is -- the same number that governs how
much the layers of the music agree.

Two guarantees, because generative art fails by being blank rather than by
being wrong. A field's **visible crop** is measured before use and re-rendered
wider if it came out featureless, since no amount of levelling afterwards
invents detail that was never drawn. And an **auto-levels** pass stretches to
the 2nd and 98th percentiles, at full strength only when the picture really
did come out flat, so deliberate restraint survives.

About 25ms per cover.

**Albums get their own artwork**, built from the loops inside them, so it
changes when the album changes and travels in the album code.

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

Two kinds of silence, independently drawn, so a loop can have one, the
other, both or neither. **Entry schedules** give long rests of one to three
bars. **Short gaps** give a quarter, half or whole bar -- a caught breath
before a phrase lands, cheap enough that several can sit in a long loop
without costing it. Long rests used to be forced to a two-bar minimum, which
is why an eight-bar loop so often lost a quarter of itself.

Entries and exits are quantised to two-bar boundaries. Music stopping on
bar three and a half is what reads as "it just stopped"; stopping where a
phrase would end reads as a breath.

Loops under 8 bars are left alone entirely; a hole in a two-bar loop is a
glitch, not a breath. Reverb and echo run through one gain node so a rest
can be ducked rather than filled with wash. Rests land 20-45 dB below
programme level rather than at digital zero, because held notes are allowed
to decay into them, which is what the references do too.

## Audit notes

Things found by measuring rather than reading, each with a test or a number
behind it:

- **Sustained notes clicked.** `setTargetAtTime` approaches its target
  exponentially and never arrives, so stopping an oscillator a fixed time
  later severs whatever is left. A six second Rhodes chord was being cut at
  a quarter of peak amplitude, -12 dB relative to its own peak: a step
  discontinuity on every held note. Releases now use
  `exponentialRampToValueAtTime` to a floor, which has a defined endpoint,
  then a short linear ramp to true zero. Worst cut across fourteen voices
  and three note lengths is now -79 dB.
- **Stop did not stop.** Notes are scheduled up to a lookahead ahead -- three
  seconds when the page is hidden -- and a pad triggered just before Stop
  rang for its full length regardless. The output now passes through a kill
  gain that fades in 60ms.
- **MIDI export did not match playback.** Every layer was offset by the
  pattern length, which is only correct when all cycles agree. Under
  polymeter a five-bar layer inside a four-bar loop ran past the end and
  collided with the next repeat, and a one-bar fragment never repeated at
  all. Layers now expand on their own cycles.
- **Stutter rolls collapsed in export.** They carry sub-step timing, which
  the exporter ignored, stacking a burst of eight onto four ticks as
  duplicate note-ons at identical pitch and tick.
- **The voice cap was below demand.** Busy loops want up to 38 simultaneous
  voices against a cap of 28, so about 1% dropped notes -- and whichever
  note arrived next, possibly the melody. Cap raised above the measured
  peak, with pads and textures hitting a lower one first so the background
  yields before the tune does.
- **The tempo slider could not reach most tempos.** It spanned 52-104 while
  the profiles now generate 36-183, so on 30% of loops it sat pinned at an
  end while the readout showed the real figure, and touching it threw the
  tempo by up to 80bpm. Range widened and generation clamped to match.
- **Rebuilding the graph leaked it.** The quality toggle built a new synth
  and abandoned the old one still wired to the speakers, LFOs running and
  combs ringing, plus another keepalive element in the DOM each time: six
  after five toggles. Both now have a dispose path, and the new bridge takes
  over the media session instead of leaving it on the discarded graph.
- **Saves could fail silently.** `save()` ignored whether the write
  succeeded, so a full quota, private browsing or disabled storage produced
  "Saved <name>" and no loop. For an app whose whole point is keeping the
  one you liked, that is the worst failure available. Save, delete and
  restore now report honestly.
- **Restore accepted anything.** A malformed entry would throw on open and
  look like the app breaking rather than one bad loop. Imports are now
  validated against what `render()` needs, missing fields from very old
  saves are defaulted, and opening a save is wrapped so one bad entry cannot
  take the app down.
- **Export filenames were unsanitised.** Loop names are user-editable, and a
  slash or colon in one breaks the download.
- **Breath noise stopped mid-note.** The shared noise buffer is two seconds;
  a longer flute or ocarina note simply ran out of air. It loops now.

## Known rough edges

- Output peaks span roughly **0.17 to 0.85** across loops, about 14 dB, with
  no full-scale samples across long multi-pass renders and a crest factor
  that survives the bus. An earlier version of this line claimed 0.46 to
  0.84; that was never measured over a whole corpus and is not true. The
  low end is a property of the sparse profiles rather than a fault --
  `thaw`, `haven` and the other airy palettes are quiet by design, nothing
  normalises between loops, and a loop machine whose every loop arrives at
  the same level has had something taken away from it. Run
  `node tools/measure.mjs` to see the current figures. Whether the spread is
  wider than intended over twenty tracks in a row is roadmap item 11.
- Loops are always 4/4. No odd meters yet.
- There's no way to edit a pattern by hand — you can only re-roll.
- Saves live in this browser on this device. "Back up all" downloads a file;
  if Android's file picker will not show it again, use "Copy backup" and
  "Paste backup", which go through the clipboard and avoid the file system
  entirely.

## Licence

MIT. Do what you like with it.
