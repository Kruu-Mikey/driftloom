# Engineering notes

How Driftloom works inside, what was measured, and why things are the way
they are. These sections were the body of `README.md` until 2026-10-08,
moved here unchanged; the README is now a short front page, and
**Profiles** stays there.

## Feeling

A loop's feeling is a **mixture of named moods**, not a position between two
poles. A readout of `60% peaceful · 30% reflective · 10% happy` means what it
says.

Averaging those would land on one middling value that is none of them. But a
piece really can be glad and inward at once -- a bright line over a low,
sparse accompaniment -- and that is not a midpoint, it is different layers
carrying different feeling. So the loop has a center, and **each layer draws
its own mood from the mixture** and is pulled part-way back toward that
center by the loop's *coherence*. Low coherence lets the melody be happy
while the harmony stays soothing; high coherence keeps everyone agreeing.

The moods are joyful, happy, enthusiastic, refreshing, soothing, peaceful,
comforting and reflective -- the bright quickened wing and the settled
comforted one, plus two inward. No sad pole. Roughly 76% of loops carry two
or three, and each mood takes between about 7% and 17% of all emotional
weight: the bright wing the most (refreshing, enthusiastic, joyful, happy
at 15-17% each), soothing and reflective the least.

Which layer carries which mood is keyed off the loop seed rather than any
layer seed, so re-rolling the bass does not reshuffle the feeling.

Underneath, each mood is a point on three dials:

- **lift** -- settled to lifted. Steers scale choice, register, the
  direction of the melodic walk, added ninths. Above about 0.66 it leans
  hard on the bright modes, and below 0.5 it leans inward, toward the
  middle of the axis rather than its darkest modes; in between the choice
  is only nudged. A loop labeled happy sounds happy in any profile whose
  modes can: cinder's and shatter's have no bright mode to offer.
- **energy** -- still to animated. Steers tempo, hat density, how often bars
  rest.
- **warmth** -- glassy to warm. Steers saturation and timbre.

Neither end of any axis is a sad end. The framing is sukha to piti, comfort
to brightness, rather than gloom to joy.

The moods, their places on the dials, their share-code numbers and the
words the readout shows all live in `js/moods.js`, so adding, renaming or
merging one is an edit to that file.

The words themselves are being reworked: a larger vocabulary of
Mikey's (`docs/MOODS.md`), labels of one to five words drawn from what a
loop actually does, and words that steer the music as well as describe
it. See roadmap item 19.

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
js/moods.js       the mood vocabulary: feelings, words, share-code numbers
js/characters.js  the sixteen profiles, and how a blend of them is mixed
js/generator.js   the composer: spec -> pattern, and the drift mutations
js/synth.js       voices and the reverb/echo bus
js/core.js        the Rust core, main-thread side (the default; ?engine=js asks for JavaScript)
js/worklet.js     the Rust core's AudioWorklet host
js/dlcore.wasm    the Rust core, built from core/ and committed
js/engine.js      lookahead scheduler
js/midi.js        standard MIDI file writer
js/share.js       song and album share codes
js/cover.js       cover art, from the same numbers as the music
js/storage.js     localStorage saves, plus backup and restore
js/ui.js          DOM rendering
js/main.js        state and wiring
core/             the Rust core's source (see "The Rust core" below)
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
  fit whatever other meter a profile asks for. Which cells are
  likely follows the loop's energy and lift, so a joyful loop gets a
  bouncier figure and a reflective one gets long notes. Pitch is a random
  walk laid over whatever the cell decided.
- **The chords keep time in their own meter.** A chord rhythm is drawn by
  name -- pad, breathe, backbeat, pushed, offbeat, late bloom, stutter --
  and each meter has its own table, so in 6/8 the offbeat is the jig's
  "pah-pah" on the eighths between the two dotted beats rather than 4/4's
  pattern cut off at step 12. The rest of the 6/8 table was settled by ear:
  chords move on the two dotted beats and hold, figures between the beats
  are welcome, and a weak-eighth entry tied over the second beat or a chord
  cut short is not. Tables are keyed by meter, not step count, because a
  waltz reads the same twelve steps as 3/4: beats at 0, 4 and 8, the bass
  on the downbeat and the chords answering on the other two, so every name
  in its table is a way of playing the oom-pah-pah.
- **A profile can bring its tempo, meter and harmony with it.** Tide draws
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
  of its own rather than the catalog's lo-fi patterns, whose boom-bap
  kicks and claps spoiled its tunes: the kick on 1 and 3, a rim or soft
  snare on 2 and 4 (in 6/8 a kick and a backbeat a bar), the eighths
  light, the same on every kit it draws, with a softer, rounder kick on
  tape and brush. One plain bar repeated was heard as lifeless, so the
  bars vary as the catalog's do: a four-bar phrase with answer bars (a
  pickup kick, an open hat), ghost notes, color from the shaker or the
  hats, a fill or a soft roll at the phrase's end, and a swell across it.
  `stats.mjs --drums <profile>` measures the variety.
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
- **Some long loops develop.** About a third of the loops of 8 bars or
  more (fewer at 8, more at 16 and up; never vapor or undertow, whose point
  is an idea that changes without changing) are a statement, a departure
  and a return. The departure (B) answers the statement (A) with its own
  motif turned -- on a new rhythm, upside down, or slowed -- usually in
  another register and over its own progression, played a touch firmer.
  The return restates A's motif through a different phrase plan. Sixteen
  bars are four four-bar phrases instead -- A, A varied, B, A varied again
  -- where each A takes the motif with its end turned and cadences on
  chords of its own, and B always moves rhythm, register and harmony.
  About two thirds of the 24-bar loops develop. B's tune is always heard:
  an airy loop's rests never take the melody out of it. Every other loop
  is exactly as simple as it was: the choice and everything
  about it come from salted streams of their own. `DEPTH` in
  `js/generator.js` is the knob (0 turns it off), with `DEPTH_SHARE` by
  length and `DEPTH_WEIGHTS` by profile beside it; `node tools/stats.mjs
  --depth` measures what it does.
- **A held vowel moves.** The three formant voices take their vowel from the
  composer -- one per phrase, shared across a chord -- and then open or close
  it across the note, the way a singer's jaw gives on a long one. Both the
  chance of moving and how far it travels follow the note's length in
  seconds, so short notes keep their shape and only sustains change.
- **No sung note jumps out.** A note whose fundamental lands on a formant
  peak used to come out 10-15 LU louder than its neighbors. Each note is
  now trimmed by how much energy the vowel's own filters hand its
  harmonics, against the voice's usual note on that vowel: loud notes come
  down, nothing is lifted, and the filters -- the vowel's color -- are
  untouched. Worked out from the filter formulas, so it costs no nodes and
  draws no random numbers.
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
dice in the app: the three wind voices that slide are about 16% of melody
draws between them, and the flute alone under 2%. Deterministic in
`--seed`, so the same codes come back.

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
roadmap item 13 wanted this before anything is leveled. `--selftest` checks
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
and by kit and meter (`--json` carries each loop's kit and meter too).

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

`--engine rust`, the default since queue item 32, plays the voices through
the Rust core, as the app does, for every report here but `--retire` (which
is about Web Audio nodes and always runs the JavaScript synth); `--engine js`
plays the JavaScript synth, which the app falls back to where it has no core,
and which keeps passing its own checks (`--refusals`, `--clicks`,
`--endings`). `--null` is still a tool: it shows how far the core is from the
JavaScript synth (see "The Rust core"), but it is no longer the gate for a
change (see "The core baseline" there). Chromium keeps every offline render that loaded the core's worklet
until the page goes away, so on the core these runs are split across fresh
loads of the page; a renderer that crashes stops the run with a message.

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
can match its neighbors at one and not the other, and one whose velocity
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

```sh
node tools/measure.mjs --retire
```

Renders each voice and drum note twice, once as it plays and once with its
audio nodes let go at the moment the synth disconnects them, and checks the
two are identical. Finished voices are disconnected to save the audio
thread (queue item 14.2); this proves letting go never
cuts anything short. Letting voices go a second early makes it fail, as it
should.

`--profile <id>` keeps only the loops a profile leads, for the loudness
report and for `--refusals`; it is how a new profile's `level` is solved
against the catalog median.

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
Profile, meter and voice shares are printed beside them and never fail it,
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

### Live performance

```sh
node tools/perf.mjs                          # the whole baseline, about 100 minutes
node tools/perf.mjs --quick                  # a smoke run, one loop, a few minutes
node tools/perf.mjs --parts matrix --loops cinder-da-yoan --throttle 6
node tools/perf.mjs --query engine=js        # the JavaScript synth (the core is the default)
node tools/perf.mjs --ab-query engine=js     # each run twice, the core and then the JavaScript synth
node tools/perf.mjs --ab <folder> --passes 2 # each run twice, <folder> and this one, first in turn
node tools/perf.mjs --parts path            # walk the app, reading the output after each step
```

`measure.mjs` renders offline, faster than real time; this plays the real
page live in headless Chromium, the way a listener does, under CPU
throttling (1x, 4x, 6x), full and lite, visible and with the tab hidden,
with "Let the loop wander" on. It reports the engine's late ticks (read off
the Diagnostics panel), the browser's own glitch counter, the audio
thread's render time, the main thread's script, layout and paint time,
Web Audio nodes created a second, memory over a long run, the time from a
tap on Play to the first sound, and the page's weight on a first visit.
It drives the page only from outside and instruments the Web Audio API
rather than the app, so a replacement engine is measured by the same tool.
An A/B (`--ab`, `--ab-query`) runs each configuration on both sides, and by
default swaps which side goes first from one pair to the next: the sandbox
machine freezes now and then, and a slot's luck must fall on both sides
alike. It reports each side's device fill-ins and long render quanta;
`--trace-dir` keeps the trace of any run with a quantum over
`--trace-over` ms, to look inside before blaming code.
The fixed set of loops, how they were chosen and what the first baseline
found are in [`docs/perf-baseline.md`](perf-baseline.md).

### The word-ranking test

```sh
node tools/ranks.mjs driftloom-ranks-2026-10-03.jsonl
```

`rank.html` is a separate page, not linked from the app: open it by URL
(`/rank.html` on the live site).
Tap Start and a loop plays, with five words from a pool. Tap them in
order, most like the loop first, and stop when the rest don't fit; Next
records the answer and moves on, Skip marks a loop that can't be judged.
Loops are `newSpec(19000)`, `newSpec(19001)` and on, so a run is the same
on any device, played through the app's own engine and synth with "Let the
loop wander" off, at the app's lite or full setting and volume. Words are
drawn least-shown first, so each is shown about equally often, and about
one trial in twenty replays an earlier loop with its words reshuffled, to
check the answers hold. The pool and those figures are data at the top of
the page's script.

Answers stay in the browser until Export, which downloads them as JSON
lines (and copies them where the browser allows). `tools/ranks.mjs` prints,
per word, how often it was shown, tapped first, tapped at all and never
tapped, and how well the repeats agree with their originals.

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
  about seventy bytes and makes a code mean one thing permanently. That is
  the design; while the app is in testing a voice added to a pool still
  re-renders the codes that draw from it (see Profiles).
- **Crockford Base32**, because codes get read aloud and typed. It drops I,
  L, O and U so there is no 1/l or 0/O confusion, it is case-insensitive,
  and a Fletcher-16 checksum catches transposed characters -- which is
  exactly the mistake people make copying one out by hand.

Generation is quantized to the same 1/255 grid the encoding uses. These
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
- **Geometry** set against the organic parts, and a posterizing pass that
  turns smooth gradients into something graphic.

Tied to the music throughout: energy becomes turbulence, warmth picks the
palette family, lift sets brightness, **the key rotates the hue** (twelve
roots, twelve colorways), swing shears the field, bar count sets the number
of strata, **the meter sets rotational order** (threes in 6/8, fives in 5/4),
the number of profiles in the blend sets the number of layers, and coherence
governs how unified the composition is -- the same number that governs how
much the layers of the music agree.

Two guarantees, because generative art fails by being blank rather than by
being wrong. A field's **visible crop** is measured before use and re-rendered
wider if it came out featureless, since no amount of leveling afterwards
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

`engine` says which synth plays: `rust` (the default) with the notes that
reached the core after their start time had been rendered (`late`, started
at once) and the ones that played in JavaScript instead (`fallback`: before
the core had loaded, or if it failed to); or `js (asked)` for `?engine=js`;
or `js (fallback: <why>)` when the core is not running and everything plays
in JavaScript: the browser has no WebAssembly or no AudioWorklet, the module
did not arrive or could not run, the worklet node could not be built, or the
core threw while playing (the node's `onprocessorerror`, queue item 31b).
A core that has failed stays failed for the session: a later synth (the
quality toggle) does not build another. `rust (loading)` is only for the
moment before the core has arrived, and the `core:` line beneath says when
it did (milliseconds after the page began): the core is loaded as the page
loads, not on the first tap.

## The Rust core

The synth is in Rust (roadmap 16), for portability rather than speed: the
same core is meant to run the phone app, a native build and games. It came
over a voice at a time, behind a flag: the kalimba (queue item
21); the fiddle and the pad (item 22), the two that cover the hard parts --
a custom wave, vibrato, slurs, a body of filters, and a filter that moves;
every `fm()` voice, sine and tubular (item 23); the wave-table voices
(item 24); the accordion and the nylon guitar (item 25); and the stab,
ocarina, flute, pan flute, prepared's knock and temple bell, on the noise
and the bandpass (item 26); bass, textures and drums (item 27); and the
sung voices (item 28), so every voice. Then the rest of the sound path:
the mix -- the five channels, their sends, the kick's duck, the echo, the
reverb and the tails (item 29) -- and the master chain: the tape wobble,
the saturator, the tone lowpass and the highpass (item 30), and the bus
compressor, the master and kill gains and the ceiling (item 31). Item 32
made it the default: Web Audio carries only the notes the core cannot take,
and the output.

The core plays unless `?engine=js` asks for the JavaScript synth (an old
`?engine=rust` link asks for what is already the default), or the browser
cannot run it. `js/core.js` loads `js/dlcore.wasm` into
an AudioWorklet (`js/worklet.js`) with one input per channel and one output,
the mix through the whole master chain, connected straight to the speakers.
Each
channel's node, where every voice plays into, becomes the core's input for
that channel: a note the core cannot take (before it has loaded, a sung
note too long for it) plays there in Web Audio and reaches the core's mix
like any other. `setTone`, `setEchoTime`, `setMute`, `duck`, the tails'
fades, `setVolume`, `setCharacterLevel`, `silence` and `unsilence` go to
the core as AudioParam calls, which it runs on a port of Chromium's own
timeline (`timeline.rs`). If the core fails -- at load, or while playing,
when a trap in it makes the worklet's `process` throw -- the JavaScript mix
and chain take everything back and the notes play in Web Audio; a core that
arrives mid-play is handed the mix's state (the tone, the echo, the mutes)
as plain sets, so its values start where the JavaScript ones were asked to
be and only later changes glide. JavaScript keeps everything else: scheduling, the voice
budget (asked exactly as the JavaScript voice asks it) and every
`Math.random` draw. A note travels to the worklet
with its absolute start time and starts on its exact sample.

The core (`core/`) is a Rust library with no dependencies and nothing
browser in it: a queue of waiting notes, a fixed pool of voices, and
`process`, which renders one 128-frame block per channel. Nothing allocates
after it is built. Its building blocks are what every later voice needs, so
later voices are ports and not research: a parameter that automates the
way a Web Audio `AudioParam` does (`param.rs`); band-limited wavetables
built the way Chromium builds a `PeriodicWave` and its own sine and
triangle (`wave.rs`); an oscillator that reads them, steps, starts and
stops the way Chromium's does, FM and detune included (`osc.rs`); and a
biquad filter with Chromium's coefficients (`filter.rs`). The bodies of the
fiddle, nylon and accordion (`folk.rs`) are one chain per kind and channel,
as `_body()` builds them in JavaScript; a body with nothing in it and
nothing ringing is skipped. A new strum damps the last strum's nylon
strings in the core as `damp()` does in JavaScript, whether they are
already sounding or still waiting to start. The noise every breath and
strike plays is the synth's own -- drawn from `Math.random` as it is built
-- so JavaScript hands its samples to the core once per synth (`noise.rs`,
up to two seconds at 96 kHz; a faster context keeps its noise voices in
JavaScript), and a source plays it the way Chromium plays an
`AudioBufferSourceNode`. The mix (`mix.rs`) is `_build()` node for node,
with Chromium's delay line (`delay.rs`: a buffer a block longer than the
longest delay, read every frame in 32-bit floats) and its way with a
feedback loop: a node renders once a block, and one pulled again while it
renders hands over its last block, so the echo and each comb go round a
block (128 frames) later than their delay alone. The master chain
(`master.rs`) runs the wobble's two LFOs from when the synth built them,
reads the saturator's curve as Chromium's WaveShaper does, on full quality
oversamples it with Chromium's own half-band filters (`resample.rs`), and
ends in two of Chromium's `DynamicsCompressorNode`s, the bus compressor and
the ceiling (`compressor.rs`: the knee, the detector, the adaptive release,
the 6 ms lookahead, the makeup gain and the metering, in Chromium's
precisions). Everything that carries the signal is kept per output channel
and the compressors link their channels' detection, so a stereo mix is a
second lane rather than a new chain; today there is one. The worklet
renders the block `currentFrame` says, except that Chromium sometimes hands
`process()` the last block's frame again, which it rides out by keeping its
own count. Time never goes backward, however stale the clock stays (queue
item 32): a block rendered a second time starts the voices that began in it
again, and the pads', leads' and basses' filters spiked to ten or thirty
times their level when the worklet once handed the core one; the core itself
now renders a block before the one due as the one due, and a count the
clock never catches up with is a lead that costs a few notes counted late.
A core that loads late has the wobble's LFOs moved to where
they would be in one step, not stepped there block by block: the wow's
phase exactly, the flutter's to within rounding (about 7e-12 of a table
sample after a thousand blocks and 5.4e-9 after 1.24 million, an hour in;
inaudible, and well inside the 1e-7 the tests allow).

**The engine is Driftloom's own, not a copy of Chromium (Mikey,
2026-10-10).** The port used Chromium as its reference so each step could be
proven; from queue item 31b the core may do better where better is
possible, judged by measurement and by ear. The first place it does: both
compressors start *warm* (`Compressor::settle`). Chromium's `Reset` leaves
the detector at 0, as if the signal were infinitely loud, so a node that
has just been built dips whatever first reaches it, by up to 9 dB on the
bus compressor and 14 dB on the ceiling, recovering over the next hundred
milliseconds or so: the first notes after a Play, a rebuild or the core's
arrival. The core plays that settling out on silence as it is built (about
a hundred blocks, under a millisecond) and starts where Chromium's own node
ends up, so only the dip is gone. (Where that is, is Chromium's too: the
detector's climb to 1 stalls in 32-bit floats a hair short of it, which
leaves the gain 0.03 dB under unity until something presses.) The
JavaScript synth keeps its cold start (the reference), so a whole loop on
the core differs from it in its first second, and nowhere else; the chain
stage of `--null` starts the core's compressors cold (the core's `cold`
parameter, the harness's) so it still proves the port.
`cargo test` in `core/` runs its own tests, `node test/worklet.test.mjs` the
worklet's, and `node tools/core-paths.mjs` plays the real app in headless
Chromium with the core made to fail every way it can.

### The first note

The core is loaded as the page loads, not on the first tap: `js/main.js`
makes the AudioContext then (it starts suspended until a tap resumes it),
fetches `js/dlcore.wasm` and adds the worklet module to it, so by the time
Play is pressed the core is almost always in and the first synth is built
with it. If Play comes first, the synth plays in JavaScript and hands over
when the core arrives, as it always did. `tools/core-start.mjs` measures it
in the real app under a slowed CPU (medians of five runs, headless
Chromium on the test machine, queue item 32):

| CPU | core in after the page began (.wasm / module added) | Play pressed at the first moment: core node built | notes that fell back to JavaScript |
|---|---|---|---|
| 1x | 178 ms / 190 ms | 59 ms after the tap | 0 |
| 4x | 489 ms / 516 ms | 167 ms after the tap | 0 |
| 6x | 763 ms / 801 ms | 249 ms after the tap | 0 |

Before this (v82, the core only behind the flag, loaded from the first tap)
the same first tap played 4, 5 and 8 notes in JavaScript (medians) at 1x, 4x
and 6x, in all five runs at each speed, with the node built 118, 335 and 447
ms after the tap; in the five runs at each speed of this build, none did. So
no wait before the first Play is needed: even a tap at the first moment the
button exists reaches the core before the first note is due.

### The core baseline

Until queue item 32 the gate for a change to the core was nulling it against
the JavaScript synth. The core is the engine now, so the gate is its own
renders. `tools/baseline.mjs` renders a fixed set through the real app's
Synth and Engine on the core and compares it with `test/core-baseline.json`:

- **loops**: 40 loops of the corpus (seed 1), full and lite, each as a
  fingerprint (FNV-1a over the float samples) of the output at the speakers
  and of every layer's tap, with the loop's loudness, peak and each layer's
  loudness beside it so a diff says what moved;
- **voices**: every voice in every layer at 0.4 s notes (every third note of
  its window, both velocities): the level, the layer's median level, the
  2-5 kHz share of the melody voices (the coffee shop test), and a
  fingerprint of the notes;
- **refusals**: what the voice budget turns away per layer over 100 loops,
  full and lite;
- **costs**: `VOICE_COST` and the two budgets as `synth.js` states them (the
  figures came from render timing, which a baseline cannot keep).

The core's renders are deterministic, so the fingerprints are exact: any
difference fails the check, and the output lists the figures that moved. A
PR that changes the sound on purpose runs `node tools/baseline.mjs --update`
in the same PR and says in its body what moved and why; a PR that does not
must leave the check passing. The JavaScript synth is not in it: it is the
fallback, and keeps passing its own checks (`measure.mjs --engine js
--refusals`, `--clicks`, `--endings`).

The built `.wasm` is committed, so the site keeps no build step:

```sh
tools/build-core.sh          # build core/ and copy it to js/dlcore.wasm
tools/build-core.sh --check  # fail if js/dlcore.wasm is not exactly that build
```

The compiler is pinned in `core/rust-toolchain.toml` and paths are
remapped, so the build is reproducible, and `.github/workflows/core.yml`
runs `--check`, the core's tests and the generator's on every pull request.
The module needs Safari 15 or later (2021): Rust's standard library uses
WebAssembly features older Safari lacks. Anywhere it cannot run, the synth
plays in JavaScript.

The JavaScript synth was the reference every ported voice was proven against,
and it stays as the fallback. Since item 32 the gate for a change to the core
is its own baseline (below); the comparison with JavaScript is a tool:

```sh
node tools/baseline.mjs                         # the core against test/core-baseline.json
node tools/measure.mjs --null                   # the same notes, both engines, subtracted
node tools/measure.mjs --voice kalimba,fiddle,pad            # the core (the default)
node tools/measure.mjs --voice kalimba,fiddle,pad --engine js
node tools/measure.mjs --endings --engine js    # the fallback keeps passing its checks
node tools/perf.mjs --ab-query engine=js --code <codes>      # live cost, core against JavaScript
node tools/core-paths.mjs                       # the core failing: Diagnostics, fallback, handover
node tools/core-start.mjs                       # how soon the core is ready, what the first Play hears
```

`--null` renders every voice the core has, in every layer that draws it,
note by note -- each started at its own fraction of a sample and point in
the render block, some exactly on a block, melody notes free, slurred and
repeated, chord notes alone and as triads -- and then whole loops that play
them through the engine and master chain, through both engines, and
reports the difference against what the voice plays. Nylon is also
strummed twice, the second strum damping the first: both scheduled before
the render, the second scheduled mid-render (as the app does), and a damp
that comes after its time. Notes null to about
-100 dB and loops to their own floor. Last, the mix stage on its own:
impulses, swept sines and noise played into all five channels at once and
read where the bus compressor takes them, with `setTone`, the echo's time,
mutes, ducks on fractions of a frame and the tails' fades, some called
mid-render, on full and lite; then the chain stage, read at the speakers:
level steps from -60 to +4 dB, loud bursts and the sweep, with the volume,
the character level, stops and starts on fractions of a frame, a start in
the middle of a stop's fade and a stop long enough for Chromium's ceiling
to stop rendering, and the same 'clean' -- into the melody alone, the
tails at 0, the wobble still -- where the master chain gets the same signal
bit for bit on both engines, beside JavaScript against itself with its
input a part in ten million louder (the compressors' own sensitivity to a
last-bit difference, which the core is held to). The whole loops are split
at one second -- the core's warm compressors differ from JavaScript's cold
ones there and only there -- and `--cold` starts the core's the way
Chromium's start, for the old comparison. `--null --mix` runs those
alone, and `--null --loud <n>` nulls the <n> loops of `--n` that press the
ceiling hardest. The 38 Hz
highpass sets its floor: its recursion amplifies its own last-bit rounding
near DC some thirty thousand times, so the smallest difference in what
reaches it, even the order Chromium adds a node's inputs in, shows as a
slow wander below 38 Hz, at -70 to -90 dB; the report gives the residual
above 100 Hz beside it. Before the voices that play the
noise, the noise source is proven alone: the hat's graph -- a grain through
a highpass under a gain -- on the melody channel. That took matching Chromium where it
is not the obvious reading of the spec, measured and then read in its
source:

- An oscillator whose pitch is steady starts its wave where it would have
  been had the note begun between samples; one whose pitch moves (FM, an
  automated frequency, a vibrato on the detune) reads its first render
  block's steps from the block's start, so the kalimba's body sine sounds
  at its 440 Hz default for up to 128 frames before its own pitch arrives,
  and a fiddle's slur starts a block late.
- A parameter is first rendered when its node first renders, and any of
  its events dated before that block move to the block's start: an
  oscillator's frequency, and a gain that feeds only one (the kalimba's FM
  depth, the fiddle's vibrato depth), first render when the oscillator
  starts.
- A `setTargetAtTime` starts from the value the parameter had at the frame
  before its first, not at its own time: the last sample rendered, which is
  carried from block to block. A nylon string's attack is an exponential
  ramp that hands straight over to a target, and where the ramp ends inside
  the last frame of a block the target starts a frame's worth of attack
  low, a few percent (inside a block Chromium clips the ramp to its end
  value). An event added after its time has been rendered -- a damp that
  arrives late -- moves to the start of the next block. The voices ported
  before nylon keep the spec's start (none hands a curve straight to a
  target), so their renders did not move.
- A buffer source schedules itself on Chromium's `TimeToSampleFrame`,
  which rounds the time to 1/1024 of a frame before taking the ceiling, so
  a strike at 11.3 s (498330.00000000006 frames at 44.1 kHz) starts on
  frame 498330. Oscillators take the plain ceiling, 498331, and a gain's
  events compare in frames too, so that one frame of noise plays through
  gains still at their default of 1: a click in every JavaScript temple
  bell struck at such a time, which the core now makes as well. The source
  reads from a whole frame (the offset rounded to the nearest), steps by a
  32-bit playback rate, and ends a grain at its offset plus its duration
  in buffer frames, rounded to the nearest; checked sample for sample
  against Chromium 141, the harness's. (Newer Chromium keeps the offset's
  fraction.)

All of this is in every JavaScript note today, so the core does it too;
`core/src/osc.rs` and `core/src/param.rs` have the details.

## A note on the tape saturator

It is easy to write this stage as `tanh(x * drive) / tanh(drive)`, because
that maps 1 to 1 and looks like the right normalization. It is not. The
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
catalog at large, and 110 at the maximum against 170. A choir loop is
nowhere near the heaviest thing here. It actually refuses *fewer* notes
than an ordinary loop, because a sung chord at 16-22 a note is cheaper
than the pad or piano it replaced -- keys refusals fall from 17.5% to
8.1%, while melody refusals rise from 6.8% to 8.9%.

The voice literally named `choir` is not one of the two. It is three
detuned singers per note at a cost of 34, on two layers at once, and
putting it in the pool roughly doubles what the budget refuses -- melody
notes from 8.9% to 19.7%. A doubled melody with a fifth of its notes
missing is not the feature.

**Whether it works is a listening question**, and it passed. The test is
whether somebody who does not know the feature exists can pick the choirs
out of twenty loops by ear. `node tools/stats.mjs --choir-quiz` prints
twenty share codes in shuffled order, five of them choirs, and writes the
answer key to a file instead of the screen. Sat on `--seed 4127`: 5 of 5
picked, no false picks (roadmap item 12).

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

**The rate is one judgment rather than a measurement**, so it is worth
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
a trade nobody agreed to. A `PeriodicWave` is normalized when it is built
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
a 800Hz, o 450, e 400, u 325 -- so neighboring rungs glide, and the ear
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
fraction of the distance actually traveled. Over 4000 loops that puts 26.4%
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
hat-normalized column does not reproduce the table's own internal ratios on
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

Entries and exits are quantized to two-bar boundaries. Music stopping on
bar three and a half is what reads as "it just stopped"; stopping where a
phrase would end reads as a breath.

Entry schedules leave loops under 8 bars alone, since a rest of a bar or
more in a two-bar loop reads as a glitch rather than a breath. Short gaps
are drawn at any length, though: about one loop in three of 2 or 4 bars
takes one, and about one in thirteen a whole bar of silence. Reverb and
echo run through one gain node so a rest can be ducked rather than filled
with wash. Rests land 20-45 dB below program level rather than at
digital zero, because held notes are allowed to decay into them, which is
what the references do too.

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
- **Export filenames were unsanitized.** Loop names are user-editable, and a
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
  normalizes between loops, and a loop machine whose every loop arrives at
  the same level has had something taken away from it. Run
  `node tools/measure.mjs` to see the current figures. What made listeners
  reach for the volume turned out to be two melody voices sitting too hot,
  since trimmed at the source (roadmap item 13).
- Meters are 4/4, 6/8, 3/4 (the waltz reading of twelve steps) and 5/4;
  nothing else yet.
- Album codes are long (well over a thousand characters for a full
  album), which makes them awkward to share by hand. Roadmap item 8.
- On lite quality, tide and cinder loops drop a few more melody notes than
  average, and a rare fast blend with shrine's temple bell can crowd the
  tune. Roadmap item 15.
- There's no way to edit a pattern by hand — you can only re-roll.
- Saves live in this browser on this device. "Back up all" downloads a file;
  if Android's file picker will not show it again, use "Copy backup" and
  "Paste backup", which go through the clipboard and avoid the file system
  entirely.
