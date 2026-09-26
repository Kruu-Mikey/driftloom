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
| **Tide** | sea and island folk. Fiddle, whistle and pan flute over harp, accordion and a strummed nylon guitar; gentle loops waltz in 3/4, lively ones jig in 6/8, and about a third sit on a drone. A frame drum and tambourine in place of the kit, and the slow swell of waves |
| **Cinder** | island and volcano: fast, rhythmic, Spanish-tinged. A driving 6/8 at 120-150 bpm, some 4/4, drums in nine loops in ten with the hand kit leading; a strummed nylon guitar on the Andalusian cadence, fiddle, whistle, marimba, accordion and pan flute on top |
| **Wayfare** | the travelling music: steady, bright, moving. A walking 4/4 at 104-138 bpm, some 6/8; pan flute, fiddle, whistle and ocarina over accordion, nylon guitar and harp, and in half its loops a chug -- eighth notes on the bass, and on the brushes when brushes play -- like wheels on rails. Its own light, steady drum grooves |

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
  lengths from one of forty rhythmic cells -- dotted, syncopated,
  anticipated, short-short-long, three-against-four, staccato bursts, long
  sustains -- with separate tables for 4/4, 6/8 and the waltz (long notes
  on the beat, lilting pickups into the bar line), and the rest built to
  fit whatever other metre a profile asks for. Which cells are
  likely follows the loop's energy and lift, so a joyful loop gets a
  bouncier figure and a reflective one gets long notes. Pitch is a random
  walk laid over whatever the cell decided.
- **The chords keep time in their own metre.** A chord rhythm is drawn by
  name -- pad, breathe, backbeat, pushed, offbeat, late bloom, stutter --
  and each metre has its own table, so in 6/8 the offbeat is the jig's
  "pah-pah" on the eighths between the two dotted beats rather than 4/4's
  pattern cut off at step 12. The rest of the 6/8 table was settled by ear:
  chords move on the two dotted beats and hold, figures between the beats
  are welcome, and a weak-eighth entry tied over the second beat or a chord
  cut short is not. Tables are keyed by metre, not step count, because a
  waltz reads the same twelve steps as 3/4: beats at 0, 4 and 8, the bass
  on the downbeat and the chords answering on the other two, so every name
  in its table is a way of playing the oom-pah-pah.
- **A profile can bring its tempo, metre and harmony with it.** Tide draws
  a gait -- a slow waltz, a quick jig or, now and then, a reel in four --
  and its tempo band from the gait, so a gentle loop is never a fast one.
  It plays its own progressions (the I-bVII shuttle, i-bVII-bVI-bVII,
  I-IV-I-V, IV-I endings) as written, and about a third of its loops hold
  the tonic and fifth as a drone under the changing chords. Its tunes take
  ornaments -- cuts and turns, the grace notes of folk fiddle and whistle,
  played 30-60 ms ahead of the note and never on the step grid -- and in
  some loops a second line in thirds or sixths under the held notes. A
  loop whose profile does not ask draws exactly what it drew before: the
  gait, the drone, the ornaments and the harmony come from streams of
  their own, and the progression is the same one draw, from a different
  pool.
- **A progression can spell its own chords.** Cinder's signature is the
  Andalusian cadence, Am-G-F-E in A, and it ends on a *major* V that no
  mode it plays in gives by degrees alone: aeolian's fifth degree is
  minor, harmonic minor's seventh is diminished. So its progressions are
  written per mode, and a step can say `{ d: 4, major: true }` or
  `flat: true`. A spelled chord brings its scale with it -- the mode with
  that chord's root and third moved -- and the tune and the bass over it
  play in that scale, G# over the E major rather than the mode's G against
  it, graces and harmony included. Dorian's F# is the cadence's F, so
  dorian cinder loops keep their own i-IV and i-bVII-IV.
- **A bass style can belong to one profile.** Wayfare's chug, a short
  note on every eighth on the chord's bass, is not in any pool: the
  profile asks for it (in half its loops), and the answer is drawn once
  for the loop from its seed, so the drums hear it too -- under a chug a
  brush kit swishes on every eighth, the beat leaned on and the eighths
  between ghosted, as the bass's are: chug-a, not an even rattle. A loop
  wayfare does not lead never chugs, and every other loop draws what it
  drew before. A chug note holds the voice budget only as long as it
  sounds (0.4 s past its end rather than the bass's usual 0.8): charged
  the old way, eight short notes a bar took room the tune needed on lite.
- **Drum grooves can belong to one profile too.** Wayfare plays grooves
  of its own rather than the catalogue's lo-fi patterns, whose boom-bap
  kicks and claps spoiled its tunes: the kick on 1 and 3, a rim or soft
  snare on 2 and 4 (in 6/8 a kick and a backbeat a bar), the eighths
  light, the same on every kit it draws, with a softer, rounder kick on
  tape and brush.
- **The figure is fixed before it is played.** Which notes a motif leaves
  out is decided once, when the motif is built, so every restatement is
  missing the same notes. Rolling the omission per bar instead looked like
  variation and was not: dropping a note fuses the two intervals either
  side of it into a third that was never in the figure, so every bar quoted
  a slightly different tune.
- **The walk moves mostly by step, and answers its leaps.** A leap is
  followed by a step back into the gap it opened, which is the oldest rule
  in counterpoint and the thing that makes a leap sound intended rather
  than random. Two degrees of a pentatonic is a fifth where two degrees of
  a seven-note mode is a third, so the allowance narrows to match the
  scale.
- **Keys and melody are kept apart.** The keys move down until the two
  centroids are at least five semitones apart. The melody never moves: it
  is the part being listened to. The one exception is a loop that drew a
  choir, where the two are put into unison on purpose.
- **A phrase is leaned on at its edges.** Velocity follows a full cosine
  across the phrase -- strongest on the first and last note, easing through
  the middle -- and the depth of it follows energy, so a hushed loop arrives
  even and a quickened one breathes. The rhythmic cell's own accent stays
  underneath: the accent says which note of the figure is leaned on, the arc
  says where in the phrase the leaning happens.
- **A held vowel moves.** The three formant voices take their vowel from the
  composer -- one per phrase, shared across a chord -- and then open or close
  it across the note, the way a singer's jaw gives on a long one. Both the
  chance of moving and how far it travels follow the note's length in
  seconds, so short notes keep their shape and only sustains change.
- **The wind voices slide into notes.** `ocarina`, `flute` and `whistle`
  reach a pitch rather than beginning on it: from the previous note when
  the two are joined and the interval is small, and from a tone and a half
  below when they are not. About one note in five and a half, which is a
  player leaning into some of them rather than an effect on all of them.
- **One loop in thirty is a choir.** Melody and keys are put on the same
  sung voice deliberately and rarely, a few cents apart and a few
  milliseconds apart, with the air layer stepping back to make room. Drawn
  from the loop seed, so it survives a re-roll and a share code alike.
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
velocity, how velocity is shaped across a phrase, and the share of melody
notes landing off the beat. Counted on the
rendered pattern, after entry schedules and gaps have zeroed what they
silence, so the figures describe what you would hear.

`--lift-low` and `--lift-high` split the corpus by `feel.lift` and print the
two buckets side by side, which is how you check that a change actually
follows the feeling rather than applying evenly. Both take an optional
value; the defaults are roughly the quartiles of a distribution that is
skewed high.

The corpus is deterministic -- same `--seed`, same loops -- which is what
makes a before-and-after comparison mean anything.

### Finding one voice

```sh
node tools/stats.mjs --voice-codes ocarina
```

Prints share codes whose melody draws a given voice, with the bar count,
length, note count and how many of those notes are joined to the one
before. A change to one voice is otherwise close to unfindable by rolling
dice in the app: the three wind voices are 12.4% of melody draws between
them and any single one is nearer 4%. Deterministic in `--seed`, so the
same codes come back.

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

Beside peak and RMS it reports loudness as the ear weights it: K-weighted
integrated loudness in LUFS and loudness range in LU, per ITU-R BS.1770 and
EBU Tech 3342, with the mono bus measured as one channel at weight 1.0, and
crest as sample peak minus loudness. Raw RMS over-counts bass, which is why
roadmap item 13 wanted this before anything is levelled. `--selftest` checks
the meter against reference tones and Tech 3342's range cases, no browser
needed.

Integrated loudness averages across the hits, and the ear does not: in
blind listening a drum loop 0.6 LU over the reference drew a reach for the
volume where a drumless one 2.7 LU over it drew nothing. So the report also
gives each loop's punch, for the whole mix and for the drums layer alone:
the loudest momentary (400 ms) and short-term (3 s) loudness, as EBU R128's
M and S, the 95th percentile of momentary loudness because a single maximum
is one block, and PSR, the sample peak against the loudest short-term
loudness, beside the existing crest. `--selftest` holds them to EBU Tech
3341's constancy signals. Beside them, the drums over the music: the drums
layer's integrated loudness less that of every other layer summed, per loop
and by kit and metre (`--json` carries each loop's kit and metre too).

Each loop is also rendered a second time with the master compressor and
ceiling routed around -- inside the tool only -- so the report can say what
the chain does to each loop: how much louder it arrives, how much of that
is taken back as gain reduction, and what happens to its crest. Web Audio's
compressor applies an automatic makeup gain, so the chain lifts everything
before it squeezes anything; the report measures that lift and separates
the two. `--no-chain` skips the second render.

Every render seeds `Math.random` from the loop it is rendering, so the same
`--seed` gives the same numbers on every run and at any `--jobs`, and
`--json <file>` writes every figure out for anything the tables do not show.
The same to within a thousandth of a dB rather than to the bit: where
several sources meet in one node Chromium does not fix the order it adds
them in, so the last few bits move. Every figure printed in dB or LU comes
out the same; the last digit of a four-place linear peak can flip.

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

### Budget refusals

```sh
node tools/measure.mjs --refusals <share-code>     # one loop
node tools/measure.mjs --refusals --n 150          # a corpus
```

What the voice budget turned away, layer by layer, through the real
`Engine` and `Synth`. Given a code it reports that loop at both quality
settings; given nothing it draws a corpus and reports the *distribution*
of per-loop melody refusal rates rather than the mean, because a mean of
6.3% hid the fact that 28.6% of loops were losing more than 5% of their
tune and one was losing half of it.

Refusals are attributed to the layer whose entry point was on the stack,
which is the only way to tell chords from melody: both arrive through
`voice()` and differ only by the channel they are handed.

### Per-voice tone

```sh
node tools/measure.mjs --voice vowel,hum,kalimba
```

Takes one voice at a time through two octaves and reports the share of its
A-weighted energy that lands between 2 and 5kHz -- the band where hearing is
most sensitive, and where a voice reads as harsh. A-weighted because the
complaint is about what the ear does, and two octaves because the answer
moves with pitch: formants sit still while the harmonics climb through
them, so one note is one sample of the problem.

The figure means nothing on its own. It is only useful next to the same
figure for a voice nobody complains about, which is why the tool takes a
list. This is the probe roadmap item 1 described and left unbuilt on the
grounds that nothing had needed it; the vowel voice needed it.

### Per-voice loudness

```sh
node tools/measure.mjs --voice all
```

The same probe also measures each voice's K-weighted loudness, note by note
across two octaves, at velocities 0.4 and 0.8 reported separately -- a voice
can match its neighbours at one and not the other, and one whose velocity
also brightens it gets louder faster than one whose velocity is only a
level. Each voice is measured in every layer `characters.js` draws it for,
across the two octaves that layer actually plays in, and through that
layer's own path in the engine: a chord voice is heard as the engine plays
a chord, not as a tune. Everything is in LU against kalimba as a melody at
the same velocity, a voice nobody has complained about.

With `all`, every voice is set against the median of its own layer, and
anything more than 3 LU from it, or whose two velocities disagree, is listed
at the end. `--note <seconds>` changes how long each note is held (1.6 by
default); a sustained voice and a plucked one compare differently at the
length a melody note actually is.

### Note endings

```sh
node tools/measure.mjs --endings
```

Plays one note of every voice `characters.js` draws, in each layer that
draws it, at 0.1, 0.4 and 1.6 s, and every melody voice at 30 ms too: the
length of a grace. It reads the most sudden fall in each note's level. A
release falls by about as much in one short window as the next, and a
bell's beating dips and comes back; a note cut off while still sounding
drops at once and stays down. Any drop over 12 dB is listed and the run
exits non-zero.

It exists because a pan flute grace did exactly that. Its attack ran
longer than the note, the ramps were scheduled after its release began,
and Web Audio runs a ramp from the event before it -- the release -- so a
30 ms grace swelled to full, held under the note it led into for 0.4 s,
and was cut off. Heard as static when pan flute notes overlapped. The
flute, ocarina and analoglead had the same fault; every ramp now ends by
the time a note lets go.

### The balance lock

```sh
node tools/stats.mjs --check                   # against test/stats-baseline.json
node tools/stats.mjs --write-baseline          # rewrite it, deliberately
```

The generation half, in `stats.mjs`. The current balance is a decision --
ambient, meandering loops alongside tuneful ones, not every loop a
triumphant melody, the choir about one in thirty -- and it has to survive
new profiles and voices. The lock records the melodic character of a
corpus: the share of loops with a melody; the melody's span, notes per bar,
duration, velocity and odd-step share; velocity across a phrase; the
interval profile; motif survival, audible included; the deliberate choir
rate; and keys against melody, both the register guarantee (no loop outside
a choir with the two layers under five semitones apart) and the share of
loops whose pools drew one voice by accident.

`--check` redraws the corpus the baseline recorded (its `--n` and
`--seed`, not the command line's), prints every figure as baseline, now,
difference and tolerance, and exits 1 if any is outside its tolerance.
Profile, metre and voice shares are printed beside them and never fail it,
because new profiles move those on purpose.

Tolerances are sampling noise, not taste: three times each figure's
seed-to-seed standard deviation, the spread of the difference between two
corpora of the same size, measured over twenty further corpora. That is the
noise a generator change meets when it draws one more random number and
re-rolls every loop without changing what loops are like. Such a change
passes about nineteen times in twenty; a real one -- melodies 5% softer, a
choir at 5% -- does not. Five corpora, the first attempt, underestimated
the spread and failed nineteen re-rolls in twenty.

A miss is not a verdict. Either the change is wrong, or the balance has
moved on purpose -- in which case `--write-baseline` rewrites
`test/stats-baseline.json`, and the pull request says so. The file is
deterministic, so rewriting it on unchanged code changes nothing.

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

## The occasional choir

About one loop in thirty puts the melody and the keys on the same sung
voice on purpose. Before this, they landed on one voice in 11.1% of loops
purely because the two pools sometimes collided, and the register code
forced those loops into unison -- which made them sound like nothing in
particular, because nobody had decided anything. One in nine is also far
too often for something meant to feel like an event.

**The draw hangs off the loop seed**, with its own salt, the way the
feeling mixture and the entry schedules already do. Three consequences,
all of which matter more than they look:

- It consumes nothing from any layer's stream, so a choir loop is the loop
  that seed always made, only sung. Every other loop renders exactly as it
  did before the feature existed.
- It survives re-rolling a layer, because a re-roll replaces a layer seed
  and never the loop seed. You cannot roll the drums and lose the choir.
- It needed no change to the share format. `spec.seed` has always been in
  the code, so a code written down months ago already knows whether its
  loop sings.

**What makes it sound like several people.** The two layers take a
standing detune of four to eleven cents in opposite directions; each gets
an independent timing slip of up to eight milliseconds, drawn fresh every
bar so it is a scatter rather than a delay; and they start on vowels two
rungs apart. The air layer -- bells an octave above the chord, swells
sitting on the line -- drops to 0.4 of its level for the loop, because a
doubling nothing makes room for is inaudible.

**A premise worth correcting.** The obvious reason to detune a doubling is
that two identical voices at one pitch sum to 6 dB of one voice rather
than sounding like two. That is not what happens here. These voices
already draw their own scoop, jitter, vibrato rate and breath per note, so
two of them on one pitch measure **+3.3 dB** -- the incoherent sum, near
enough -- with no detune at all. The detune is still worth having, because
a standing lean is a different thing from a zero-mean wobble: the layers
never settle onto one pitch instead of merely crossing each other. But it
is not load-bearing, and the collapse it is supposed to prevent was never
going to happen.

**Cost: 2.3 units a note, 14%**, counted across the melody and keys of
12,000 loops at the weights in `VOICE_COST`. The worst single chord attack
on a choir loop is 88 units at the 90th percentile against 125 for the
catalogue at large, and 110 at the maximum against 170. A choir loop is
nowhere near the heaviest thing here. It actually refuses *fewer* notes
than an ordinary loop, because a sung chord at 16-22 a note is cheaper
than the pad or piano it replaced -- keys refusals fall from 17.5% to
8.1%, while melody refusals rise from 6.8% to 8.9%.

The voice literally named `choir` is not one of the two. It is three
detuned singers per note at a cost of 34, on two layers at once, and
putting it in the pool roughly doubles what the budget refuses -- melody
notes from 8.9% to 19.7%. A doubled melody with a fifth of its notes
missing is not the feature.

**Whether it works is a listening question**, and the answer is not in.
The test is whether somebody who does not know the feature exists can pick
the choirs out of twenty loops by ear. `node tools/stats.mjs --choir-quiz`
prints twenty share codes in shuffled order, five of them choirs, and
writes the answer key to a file instead of the screen. Nobody has sat it
yet.

## Why the melody was losing notes

Found by ear, on a busy `glade` loop: the tune kept dropping notes. It was
the voice budget, and the melody was losing to it on **28.6% of loops**.

The budget is a running total of cost reserved by notes that have not
finished. The engine asks layer by layer, in a fixed order -- drums, bass,
chords, melody, air -- so the melody asks **fourth**, after the
accompaniment has already reserved. On a dense loop it is refused for want
of room it never had a chance at. Measured on the loop that found it: 53.7%
of its melody notes turned away at the default ceiling, 63.0% on lite.

Three things were wrong, and only one of them was the obvious one.

**`keys` was priced at 25, the same as a piano.** A `keys` note is one
two-operator FM voice. A `piano` note is *two* of them. They cannot cost
the same, and measured marginal render time says they do not: keys is 2.1x
a sine and 0.47x a piano -- the structure exactly. It is now 12. At 25 a
busy keys part was reserving twice what an actual piano would.

**Only pads used the soft cap.** The mechanism for "yield to whatever asks
later" already existed and exactly one family of voices was using it. Any
voice handed the chords channel now bills against it, which is the whole
of the fix in one line: accompaniment yields before the tune.

**The soft cap did nothing on lite.** It read `Math.min(SOFT_BUDGET,
ceiling)`, and 170 against a 140 ceiling is 140 -- no cap at all. The one
mechanism that keeps room for the tune was inert on exactly the devices
that needed it. It is now a *reserve* subtracted from whatever ceiling is
in force, which is what `SOFT_BUDGET` always meant: 260 - 170 = 90 held
back. Capped at 42% of the ceiling so that on lite it holds back 59 rather
than 90, because 90 of 140 stops being "leave room for the tune" and
becomes "delete the accompaniment".

### What it cost the keys

| | melody before | melody after | keys before | keys after |
|---|---|---|---|---|
| the loop that found it | 53.7% | **0.0%** | 38.6% | 38.2% |
| the same, lite | 63.0% | **0.0%** | 69.5% | 79.1% |
| corpus of 150, mean | 6.3% | **0.0%** | 23.2% | 27.9% |
| corpus, loops losing >5% of melody | 28.6% | **0.0%** | | |
| corpus, lite, mean | 31.6% | **1.9%** | 46.0% | 66.0% |
| corpus, lite, loops losing >5% | 81.2% | **12.0%** | | |

At the default ceiling the keys pay almost nothing: 23.2% to 27.9% across
the corpus, and on the loop that started this, 38.6% to 38.2% -- *lower*,
because halving the keys weight gave back more room than the soft cap took
away. On lite they pay 46.0% to 66.0%, which is the real price of the fix;
lite was already thinning the keys heavily before any of this, and the
alternative was the tune. Drums and bass stop losing anything either way:
1.2% to 0.0% and 7.1% to 0.5% on lite.

### The tail is not the problem, and that was worth checking

The obvious next suspicion is the reservation: `dur + 1.2s` looks arbitrary
for a short pluck. Measured, it is not arbitrary and it is not too long. It
is exactly the time the note's oscillators are scheduled to run, and the
sound really is still there: a `keys` note with a 0.6s body is 40dB down at
1.86s, against a reservation that ends at 1.92s. Across `keys`, `piano` and
`pluck` the reservation expires within 0.1-0.4s of the note reaching -40dB.

So shortening the reservation alone would be claiming headroom that does
not exist -- reporting less CPU than is actually being spent, which is the
one thing a budget must not do. Shortening the *synthesis* tail would work
and would change the sound, so it is not bundled in here.

### What is left, on lite

Lite is 16x better and still not zero: 12.0% of loops lose more than 5% of
their melody. The cause is not the keys, which is why no further tightening
of the accompaniment cap would help, and tightening it anyway would have
destroyed the keys for nothing.

Tagging every reservation with the layer that made it and reading them back
at the moment of each refusal: on the worst lite loops the melody is
refused by **its own earlier notes**. One holds 120 units of melody against
a 140 ceiling with the keys at zero. Another is refused by the bass, which
is holding 78. A note turned away because three of its own predecessors are
still ringing is a different and much more benign failure than one turned
away because the accompaniment took everything, and it wants a different
fix -- most likely a shorter tail, which is a change to the sound.

## The keys were on the wrong bus

Found while fixing the budget starvation above, and fixed separately so
that one could be A/B'd on its own.

`voice()` is the single entry point for every tuned sound, and it takes the
channel to play into. Voices without an explicit case fall through to
`pluck()` -- and `pluck()` did not take a channel. It hardcoded the melody
one, because that is where most of the voices reaching it play.

Exactly one chord voice falls through that way: `keys`. So **every keys
chord in the app was playing through the melody bus**: gain 0.58, reverb
0.28, echo 0.12, where the chords channel is 0.44 / 0.35 / 0.15. Louder,
drier and with less echo than intended, which quietly undid the "keys give
up a little to make the room" balance set a few lines above the channel
table itself.

It measures exactly as that description predicts. Tapping each layer at its
own channel gain, on 25 corpus loops whose keys layer draws the keys voice:

| | before | after |
|---|---|---|
| loops whose chords channel was **entirely silent** | **25 of 25** | 0 |
| melody channel level | — | **-2.8 dB** |
| drums, bass | — | unchanged |

The chords channel was not quiet, it was **zero** -- nothing was reaching
it at all. And the melody channel falls by 2.8dB not because the tune got
quieter, but because it stops carrying an entire second layer stacked on
top of it.

The budget is untouched: refusals on the test loop are identical to the
figure before this change, at both quality settings. This moves where the
notes go, not whether they play.

## Slid attacks

The wind voices had vibrato and breath and still did not sound played,
because nothing ever *arrived* at a pitch -- every note simply began on
one. A player reaches the note.

**Where the decision lives** is the split vowel drift established. Which
notes get a slide is articulation, so it is drawn in the synth beside the
scoop, the jitter and the vibrato. Where the line came *from* is not
something the synth can know, since it sees one note at a time -- so the
composer writes it down. A pass over the finished melody records the
previous sounding pitch on each event, which is derived rather than drawn:
it reads pitches that were already decided and takes nothing from any
random stream. That is what keeps every share code in circulation
rendering the loop it always rendered.

The annotation runs after the entry schedules and the gaps, because the
question is about what is *heard*. A note whose predecessor was scheduled
out has nothing to slide from, and the note before that one may be half a
bar away.

**The shape.** From the previous note when the two are joined -- within
120ms, which turns out to be 63% of notes, since most of this melody is
legato -- and no wider than a fourth, because a glide across a big leap is
a siren rather than a player. Everything else gets a scoop from a tone and
a half below, which is what reaching a note after a breath sounds like. The
reach is 22% of the note clamped to 30-90ms, landing inside the first
quarter: the note has to be *on* pitch for most of its length, or the slide
stops being an attack and becomes the note. Notes under 180ms, the shortest
quarter of the corpus, stay clean.

**The rate is one judgement rather than a measurement**, so it is worth
stating plainly: 0.22 of eligible notes, which measures **18.1%** of wind
melody notes overall -- 9.8% from the previous note, 8.3% scooped. About
one note in five and a half. Much above that and the line reads as an
effect applied to it; much below and nobody ever meets one.

**It is not tied to lift or energy.** It does not need to be, because the
material already carries the relationship: a driven loop has shorter notes
and fewer joined pairs, so the share of its notes a slide can touch falls
from 96.8% at low energy to 67.5% at high, and 88.2% to 71.2% across lift.
Consulting the feeling as well would count the same thing twice. Energy
influences the slide rate without ever being asked.

**Cost: nothing.** It is parameter automation on an oscillator that already
exists, over 30-90ms. With every eligible note sliding -- an upper bound
the real rate never approaches -- marginal render time moves -3.2%, +2.0%
and +0.6% across the three voices, noise either side of zero. `VOICE_COST`
is unchanged.

One thing found on the way in: the `whistle` voice already had a glide
branch, reading `opts.glide`, and nothing has ever reached it. `glide` is
written onto bass events only, and the bass has its own method. It has been
dead since it was written, which is part of why nothing here ever glided.

## Why the vowel voice was harsh

It was arithmetic, not taste. A sawtooth falls at 6dB an octave. A real
voiced source falls at about 12. So every harmonic above the first formant
arrived at roughly twice the level a throat would have sent it -- and the
lowpass that was meant to stand in for that difference sat at 3400Hz, which
is above the whole region that matters. A filter contributes nothing below
its own corner, so between 1kHz and 3.4kHz there was no rolloff at all:
full sawtooth brightness, with a narrow F3 resonance of +6 to +9dB sitting
on top of it at 2.5-2.9kHz, which is precisely where hearing is sharpest.

Measured with `--voice`, **12.2%** of this voice's A-weighted energy landed
in 2-5kHz, and **28%** on the worst note of two octaves. The struck voices
it shares a mix with sit at 0.0-0.2%. A hum -- the same code with a closed
tract and a 1700Hz corner -- sits at 0.2%.

**The fix is at the source rather than after it.** A high shelf taking
24dB off everything above 1800Hz was built first and worked -- 12.2% down
to 0.2% -- but it cost a filter node on every note forever, measured at 12%
of the voice, to remove a slope that never had to be generated. So instead
the oscillator is given the slope a voice actually has: a `PeriodicWave`
whose harmonics fall as 1/n^2.5 rather than a sawtooth's 1/n, built once in
the constructor and shared by every note. The lowpass corner comes down
from 3400 to 2600Hz to finish the job.

That lands the vowel at **0.1% mean and 0.8% max**, inside the range of the
voices nobody complains about on both figures, rather than at a number
chosen for being comfortable.

1/n^2.5 is 15dB an octave. The textbook figure for a voiced source is 12,
and it was tried first: it leaves 0.32% in the band, which is outside the
target. 15dB an octave is the soft, breathy end of the real range, which is
the register this app sings in anyway.

**The vowels survive it, and that is provable rather than hopeful.** Both
the source change and the shelf apply the same curve to a/e/o/u alike, so
neither can pull them toward each other: measured on the filter chain
itself, the closest pair of vowels stays **3.82dB** apart, identical to
before. F2 is still a peak and not a bump on a slope. What is lost is
brightness, which is the thing being removed.

That check had to be done on the filter chain rather than on rendered
notes. The rendered version of it disagreed with itself by a factor of
three between runs -- the scoop, the jitter, the vibrato and the breath are
all redrawn per note and swamped the thing being measured. The chain's
magnitude response is exact and has no randomness in it at all.

The chain cannot answer everything, though. It says where the resonances
are; it cannot say whether anything is left to resonate, and a steeper
source puts less energy up where F2 sits. So that one was measured on the
emitted sound after all, averaged over five notes and both builds. F2 is
still a peak and not a shoulder:

| | a | e | o | u |
|---|---|---|---|---|
| F2 above the F1-F2 dip, before | 45.4dB | 55.9dB | 58.9dB | 63.1dB |
| after | 46.7dB | **38.2dB** | 49.8dB | 65.6dB |
| F2 above the 6-8kHz floor, before | 32.0dB | 28.8dB | 38.8dB | 39.8dB |
| after | 59.0dB | 40.2dB | 57.9dB | 69.9dB |

"e" gives up the most, which is what should happen: its F2 sits at 1600Hz,
higher than any of the others, so a steeper source costs it most. 38dB is
still an unmistakable formant. Every vowel ends up further clear of the
noise floor than it started, because the thing that was crowding it has
gone.

**Level is compensated**, because a fix that quietly turns a voice down is
a trade nobody agreed to. A `PeriodicWave` is normalised when it is built
and a 1/n^2.5 wave is a far smoother shape than a sawtooth, so it arrives
several dB hotter; the trim is set from A-weighted loudness, since that is
what "no quieter in the mix" means to a listener. Both voices come back
within a couple of tenths of a dB of where they were, and **peak level
falls about 2dB** on its own -- free headroom, because a smoother wave is a
less peaky one.

**It costs nothing.** The source change is one `PeriodicWave` built in the
constructor and shared by every note, so there is no node to pay for:
marginal render time measures -2.4% for the vowel and +1.0% for the choir,
which is noise either side of zero, and `VOICE_COST` is unchanged. The
shelf it replaced measured +12%. That is the whole argument for fixing a
slope at the source rather than filtering it back out afterwards.

**The choir voice shares this code path** and gets the same treatment:
12.4% to 0.1% mean, 27.9% to 0.8% max. **The hum is left alone** -- its
source is already a triangle, its corner is already at 1700 and it already
measured 0.2%, so there was nothing in it to fix.

## Vowel movement

`vowel`, `hum` and `choir` are three peaking filters in series standing in
for a vocal tract. Those filters used to be set once and left, which meant a
two-second sustain held one mouth shape for two seconds. Nothing holds a
mouth that still, and it is most of what separated these voices from
something sung.

**Where it goes.** One rung along the open/close axis and never across it:
a to o or e, o to u or a, u to o, e to a. F1 is the openness formant --
a 800Hz, o 450, e 400, u 325 -- so neighbouring rungs glide, and the ear
hears one vowel changing shape rather than two vowels in succession. A jump
across the ladder ("eh" straight into "oo") is a diphthong, which is a word,
and words are deliberately out of scope. A hum has no vowel to move to and
opens instead: the same closed tract relaxing.

**When it goes.** The note holds its vowel for the first third, travels
through the middle, and lands at 85% so the release sings the vowel it
arrived at. Leaving at the attack reads as a filter sweep laid over the note
rather than as a mouth.

**How much it moves follows how long the note is.** `held` is how far a note
is into "long" -- zero below 0.5s, one from 2.0s up -- and it serves as both
the probability of moving at all and, through `0.34 + held * 0.66`, the
fraction of the distance actually travelled. Over 4000 loops that puts 26.4%
of formant-voice notes in motion at a mean depth of 0.81, while the 41% of
them shorter than 0.55s never move. A mouth that crosses a whole vowel in
half a second has sung a word.

**There is no second filter bank.** Crossfading into a second set of
peaking filters is the obvious build and it is wrong: two banks summed have
different phase responses, so the sum combs and the result sounds like a
flanger. The resonances themselves slide instead, so every instant in
between is a real vowel shape, and no nodes are added.

**It costs 5 units**, on top of the 22 a `vowel` already costs, the 16 a
`hum` costs and the 34 a `choir` costs -- and it is charged, not merely
declared: a moving note is budgeted at the higher figure and is the first
thing to give when a dense passage runs out of room.

The number is measured the way the rest of `VOICE_COST` was, as marginal
render time of a note through the real `Synth` in an `OfflineAudioContext`,
with one build's drift decision pinned off against the same build's pinned
on. Movement runs 27-29% of a vowel, 19-23% of a hum and 13-16% of a choir;
put through each voice's own weight that comes to 4.7 and 5.0 units on two
clean passes, so 5. One constant rather than three, because in every case it
is the same three biquads doing the same extra work.

Two caveats on that figure, both of which cut the same way. The probe's
hat-normalised column does not reproduce the table's own internal ratios on
this machine -- a 0.05s hat against a 2.4s vowel is not a like-for-like
per-note comparison -- so the conversion goes through each voice's own
weight rather than through a hat. And the table's absolute weights were
never a phone's to begin with, which the comment above them says plainly.
5 is a ratio measured against numbers that are themselves a reasoned
starting point.

**How it was checked.** One 3.0s "a", pinned to drift to "o", rendered dry
and band-integrated early (22% into the note) and late (90% in), against the
same note with the drift pinned off. The two are identical in the early
window to a tenth of a dB -- the note starts on the vowel it was given -- and
in the late window the moving one puts 8.2 dB more into 350-600Hz, which is
o's F1, and 11.8 dB less into 1000-1400Hz, which is a's F2. It arrives
somewhere else.

**The composer never sees any of this.** The vowel itself is still drawn
there and still belongs to the composition; only the movement is decided in
the synth, beside the scoop, the jitter and the vibrato, which have always
been per-note. That is not tidiness. A draw from the composer's stream
renumbers every decision after it, so every share code in circulation would
render as different music -- and the composer could not answer the question
anyway, because it knows a note's length in steps and this is a question
about seconds. `tools/stats.mjs` over 4000 loops is byte-identical before
and after.

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
