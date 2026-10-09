# The queue

Written by the brain for Claude Code, so building can carry on while Mikey
has no time to listen (2026-09-25). Work top to bottom. Mikey's ears come
later, in listening albums the brain builds from the Done list.

**Status, 2026-10-09:** items 0-29 are done (13 stopped at its gate by
design): every voice and the mix (channels, sends, duck, echo, reverb) play
from the Rust core behind `?engine=rust`. Items 30-31 are queued (the
master chain). A new Claude Code session starts here: read the standing
rules and the merge policy, then take the next item.

## Standing rules, for every item

- **One PR per item** (split an item into a/b if that is cleaner). Start
  each from the latest `main`, take the next version number, and bump
  `BUILD` and `CACHE` together.
- **Merging:** see "Merge policy" at the end.
- **Measured, not guessed.** Every new voice, texture or kit: level
  calibrated to its layer's median at 0.4 s notes (`measure.mjs --voice`),
  `VOICE_COST` measured by render timing, and the tone probe's 2-5 kHz
  share at or below the flute's. That last one is the coffee-shop test:
  Mikey's north star is that nothing should bother people in a coffee
  shop. Every new profile: its `level` solved so its loops land on the
  catalog median (`measure.mjs --profile <id>`).
- **Refusals** on full and lite for the loops the item touches: melody at
  full quality stays near zero, and lite no worse than the catalog.
- **The balance lock:** run `stats.mjs --check`. If a locked figure moves,
  report which and by how much, re-baseline at `--n 10000`, and say so.
- **Existing loops:** say exactly what changes for specs that already
  exist. Anything not named in the item must render identically.
- **Tests** three times.
- **Taste:** where the item leaves a musical choice open, take the more
  conservative option and write it down in the PR, marked "for Mikey's
  ears". Never guess silently.
- **American English** in new comments, docs and PR text (Mikey,
  2026-09-28). Don't rename identifiers or spec fields for spelling:
  share codes and history depend on them.
- **Stop and leave a note** at the bottom of this file, rather than push
  on, if a check can't be met or the item turns out to need a decision.
- **When a PR is merged,** add one line to Done below: the PR number, the
  commit preview URL, and what the ears should listen for.

## 0. Finish #59 (fiddle and accordion, take two)

Finish its after-runs, fill in the PR body, and merge it before starting 1.

## 1. `tide`, part 2

- **3/4 melody rhythms.** In 3/4 the melody still uses the 6/8 cells.
  Give 3/4 its own cells (a waltz tune: long notes on the beat, lilting
  pickups), chosen as the 6/8 cells are.
- **3/4 gaps.** Silent gaps in 3/4 still count 3-step beats; count the
  waltz's 4-step beats.
- **Ornaments.** Cuts and turns, the quick grace notes of folk fiddle and
  whistle. The generator only marks which notes get one (a profile field
  such as `ornament: 0.4`, a salted draw); the engine plays the grace at
  sub-step timing, 30-60 ms before the note, never on the step grid.
  Only tide asks for them for now.
- **Harmony in thirds or sixths**, on held notes only (long notes and
  phrase ends), never doubling every melody note, costed like any voice.
  A profile field; tide only.
- **A waves texture:** slow swells of filtered noise, the sea without
  anything literal. Add it to tide's textures.
- **A hand-drum kit** beside tape, brush and machine: a frame drum
  (bodhran-like), with shaker and jingle. Add it to tide's kits.
  Calibrate to the drums layer as it stands.

## 2. Soften the harsh leads

Saw, moog and analoglead are at the right level (#48, #53) but Mikey
called them "harsh", "sharp" and "gross" in the blind lead audition. Do
what take two did for the fiddle: a softer shaped source instead of a raw
sawtooth, fixed tone rather than a bright per-note sweep, keeping each
voice's character (moog may keep a gentle filter movement). Tone probe:
each at or below the flute's 2-5 kHz share. Re-level to the melody
median at 0.4 s, re-measure `VOICE_COST`.

## 3. Voices, pair 2: nylon and pan flute

- **Nylon guitar.** Plucked, warm, with body resonance. As a chord voice
  it strums: 15-30 ms across the strings, down on the beat and up off it,
  the downstroke accented. Today's chords spread 11 ms in one fixed
  order; the strum applies to nylon only.
- **Pan flute**, the Spirit Tracks instrument: a flute variant with more
  breath, a chiff on the attack, a small pitch dip into the note, no
  vibrato on short notes.
- Into tide: chords nylon 2.5; melody pan flute 1.5. Keep every existing
  entry. (They also go into items 4 and 5.)

## 4. `cinder`, the fiery 6/8

The island-and-volcano music: fast, rhythmic, Spanish-tinged.

- 6/8 mostly (about 120-150 bpm), some 4/4; drums in about 90% of loops,
  the hand kit leading.
- Scales: phrygianDominant, harmonicMinor, aeolian, dorian, phrygian.
- The signature progression is the Andalusian cadence (in A: Am-G-F-E,
  ending on a *major* V). Degrees alone give the wrong chord qualities in
  these modes, as #57 found, so filter or override per mode to get it
  right.
- Chords: nylon (strummed) leading, marimba, accordion. Melody: fiddle,
  whistle, marimba, accordion, pan flute. Bass: pulse and walk.
- `level` solved by measurement; appended to the end of `PROFILE_IDS`.

## 5. `wayfare`, the rolling train

The traveling music: steady, bright, moving.

- Mostly 4/4 (about 104-138 bpm), some 6/8. A **chug**: a steady
  eighth-note pulse in the bass (and brushes) under the tune, like wheels
  on rails; a new bass style, drawn only by profiles that ask for it.
- Scales: mixolydian, ionian, dorian, lydian, majorPent.
- Progressions: I-bVII-IV-I and I-IV-V-IV, filtered per mode.
- Melody: pan flute leading, then fiddle, whistle, ocarina. Chords:
  accordion, nylon, harp. Drums in about 85% of loops: brush, tape, hand.
- `level` solved by measurement; appended to the end of `PROFILE_IDS`.

## 6. Pan flute: static when notes overlap (a bug)

Mikey, review album track 11 (a tide loop, pan flute leading): "some sort
of glitch ... almost sounds like it's clipping; there's this static noise
that happens when the pan flute notes overlap. The pan flute itself
sounds good." So the tone stays; the glitch goes.

Find the cause by rendering, not guessing: overlapping pan flute notes
through the real Synth, looking for clipping at any node, sample-to-sample
jumps (clicks), and noise that builds as notes stack. Suspects, unproven:
the chiff spike (a 4 ms exponential ramp up to `PANFLUTE_CHIFF`), every
note's breath starting the same shared noise buffer at offset 0 (so
overlapping notes play the same noise a few milliseconds apart, which
combs), or the breath's bandpass stacking. Fix whatever it is, keep the
tone probe and level where they are, and add a check to the tests or
`measure.mjs` that would have caught it. Other voices that share the
noise buffer the same way should be checked for the same fault and named
in the PR, fixed only if they have it.

## 7. Nylon: a cleaner strum

Mikey, track 10 (tide, nylon strumming): "sounds smeared, not bad sounding
though either." Keep the sound; tighten it. Likely levers: a narrower
spread across the strings than 15-30 ms, the previous strum's strings
damped when the next chord starts (a guitarist's strings don't ring on
into the next chord), and less ring from the shared body resonance. Take
the conservative end, write the choices down "for Mikey's ears", and
re-check tone, level and cost.

## 8. `wayfare`'s drums and chug: playful, not tough

Mikey, review album tracks 16-19 (all `wayfare`): the melodies, chords
and the minor v are nice, but the drums "kill it" on all four, though
"not at all terrible". The chug "leans a bit toward that machine gun
vibe or hip-hop ... too heavy or tough rather than playful". On the
others: "the kick on the drums is a bit too loud, or not the right sound
shape or tone -- more tribal sounding? Not sure."

What the brain found: `wayfare` draws the catalog's lo-fi drum patterns,
so two of the four tracks played a syncopated boom-bap kick (steps 0, 6
and 11 in the bar) with claps; one played the tape kit; the hand-kit track
put the same kind of pattern on the frame drum. The kits aren't the
problem (tide's hand-kit jig got "love it"); the grooves are.

Do, for `wayfare` only:
- **Its own drum grooves:** traveling music, light and steady. The kick
  (or frame drum) on 1 and 3, never syncopated boom-bap; brush, rim or tap
  on 2 and 4; no claps; hats, shaker or jingles light on the eighths. The
  same shapes on every kit it draws.
- **A softer kick in `wayfare`**, lower and rounder. Yardstick: the drums'
  level over the music (as in #31) should sit near tide's hand-kit jig
  loops, which Mikey loved, not near the catalog's lo-fi loops.
- **A playful chug:** the beat accented and the offbeats ghosted well
  down ("chug-a" rather than an even rattle), shorter bass notes, and the
  brush's eighths lighter to match. Keep it a train, not a march.
- Melody, chords and everything outside `wayfare` untouched; existing
  non-`wayfare` loops must render identically. The usual level, refusal
  and balance-lock checks. Take the gentle option where unsure, and say
  "for Mikey's ears".

## 9. `wayfare`'s drums: bring the life back

Mikey, before/after on the four wayfare tracks: "the drums sound better
in v53, but ... the composition is less dynamic and interesting than it
was in v52 for the drums." Keep what #79 fixed (no boom-bap, no claps,
the soft round kick, the lighter chug); give back the variety it took.

Measured by the brain, 150 wayfare-led loops each (tide-led for the
yardstick, which Mikey loved):

| | wayfare v52 | wayfare v53 | tide v53 |
|---|---|---|---|
| bars that differ from each other (share) | 0.95 | **0.32** | 0.99 |
| instruments per loop | 4.8 | **3.0** | 4.7 |
| velocity spread (sd) | 0.177 | **0.150** | 0.193 |
| hits per bar | 11.4 | 11.1 | 7.3 |

So v53 plays nearly the same bar over and over, on fewer instruments, with
flatter dynamics. The item 8 brief asked for grooves that were "steady"
with "the same shapes on every kit", and took it too literally.

Do, for `wayfare` only:
- Several groove variants per loop, not one, with bars that vary as the
  catalog's do: the kick stays anchored on 1 and 3, but pickups, an
  occasional extra kick into a beat, ghost notes, open hats or shaker
  accents, and a fill or roll at phrase ends are all welcome. Still never
  boom-bap and never claps.
- Back to about 4-5 instruments per loop (percussion color: rim, shaker,
  jingles, taps, whatever each kit has).
- Dynamics: accents and ghosts, and swells across the phrase, so the
  velocity spread returns to v52's or tide's.
- Yardsticks, reported in the table above's form: bars that differ at or
  above 0.9, instruments near 4.5, velocity spread at or above 0.17, and
  drums over the music still near tide's hand-kit jigs.
- The chug stays as #79 made it unless the variation needs it to breathe.
- Everything outside `wayfare` untouched. The usual checks.

## 10. A performance harness and baseline (measure only)

Mikey, 2026-09-25: even at full quality the app should be very light and
fast -- "something that would make even DHH go 'wow, I can't believe how
smooth this is even while I have a hundred other apps open'". Overhauls
are on the table, but numbers come first. This item changes nothing in
`js/`.

Build `tools/perf.mjs`: the real app in headless Chromium, playing loops
live (not offline), under CPU throttling through the DevTools protocol (at
least 1x, 4x and 6x), full and lite. Per run, report:
- audio health: the engine's late ticks, and any glitch signal the browser
  exposes;
- main-thread cost: script, layout and paint time per second of playback
  (`Performance.getMetrics`), and long tasks;
- audio-graph churn: Web Audio nodes created per second (instrument the
  context in the harness, not the app);
- memory: JS heap over a few minutes of playback, and whether it climbs;
- time from pressing play to first sound; page weight on first load;
- the same with the tab hidden, which should cost next to nothing.
Use a fixed set of loops that includes the heaviest profiles and long
loops. Commit a baseline report (for example `docs/perf-baseline.md`) and
say where the time goes. Do not optimize anything yet.

Two more asks, because this baseline is what a future compiled audio
engine (roadmap item 16) has to beat:
- Keep the harness engine-agnostic: it drives the app from outside and
  reads its figures from the page, so the same tool can measure a
  replacement engine later.
- Split the cost as far as the browser lets you: note scheduling and
  generation in JavaScript, audio-graph construction (node creation and
  connection), audio rendering, and the UI. The point is to know how
  much a compiled engine could actually save, and where.
Play with "Let the loop wander" on, the default, since that's how most
people will listen.

## 11. Sound polish: measured fixes

Each is small and measurable; they change how existing loops sound, which
is the point.
- **Sung notes that jump out.** In `vowel`, `choir` and `hum`, a note whose
  fundamental lands on a formant peak comes out 10-15 LU louder than its
  neighbors (#24's probe: note-to-note spreads of 16-21 LU against about
  1-2 for most voices). Tame the jumps without flattening the voices'
  character; report the per-note spread before and after.
- **Temple bell as a chord voice** is still about 2.5 LU under the chords
  layer, and Mikey heard it as buried. Bring the chord use to the layer
  median at 0.4 s notes; the melody use stays.
- **5/4 chords.** 5/4 still uses the 4/4 chord table, so its fifth beat is
  always empty. Give 5/4 its own table, in the spirit of the 6/8 rules
  (#34, #38): chords move on the beats and hold.
- **Arpeggios run past the bar**, because each note keeps the full length.
  Clip them to their slot.

## 12. Composition depth, first pass

Mikey: "wider melodies and just wider compositions in general would be
really nice. It can sometimes feel like the app will stick with
compositions that are too elementary even when there are many bars to
fill." Also: "it should still be completely possible for the very simple
melodies and compositions to fill a 24-bar song. ... I really like the
music the app already makes, we only need some compositions to explore
adding more depth. We can play with what that balance should be."

Measured by the brain (3000 loops, main at v54):

| loop length | loops | distinct melody bars | bars with melody | distinct chord bars | melodic span |
|---|---|---|---|---|---|
| 4 bars | 36% | 2.9 | 3.6 | 3.5 | 8.8 |
| 8 bars | 28% | 4.2 | 5.7 | 4.9 | 10.3 |
| 16 bars | 16% | 6.0 | 9.9 | 6.5 | 11.4 |
| 24 bars | 2% | 7.9 | 13.7 | 7.4 | 15.8 |
| 32 bars | 1% | 5.1 | 10.8 | 5.3 | 7.8 |

A 32-bar loop carries five distinct melody bars and a narrower tune than
an 8-bar one. Long loops mostly repeat a short idea.

Do:
- **Development in some loops, not all.** A share of loops, weighted
  toward the long ones, develop: a contrasting section (a B phrase that
  answers the A, derived from its motif, often in a different register or
  rhythm), a return that varies rather than repeats (A'), chord movement
  that spans the form rather than cycling one short progression, and a
  shape across the whole loop.
- **Range as a spread.** Some tunes stay narrow, some roam: widen the
  distribution, not every tune.
- **One knob for the balance**, easy to turn later (for example a global
  `DEPTH` share with per-profile weights), so Mikey can "play with what
  that balance should be". Start conservative, around a third of loops of
  8 bars or more.
- **Simple loops survive.** Loops that don't develop must stay exactly as
  simple as today, and any length can still be filled by a simple idea.
- Yardsticks, in the table above's form, reported separately for loops
  that develop and loops that don't. The balance lock will move; that is
  the point. Report every figure that moves and re-baseline deliberately.
- For Mikey's ears afterwards: the brain builds an album of developing
  long loops beside simple ones.

## 13. Rust engine, step 2 -- stopped at its gate (brain, 2026-09-26)

Item 10's baseline answers the gate: building the graph costs 1.2-4.2 ms
a second on the main thread, 2-5% of it. The big costs are elsewhere and
fixable in plain JavaScript and CSS (item 14). Don't build the prototype.
The Rust port stays on the roadmap (item 16) as a portability project --
the phone app's core, a native build, games -- to be taken up after
composition depth settles, not as the performance fix. The original
brief follows for the record.

### (original brief, not to be built now)

Agreed with Mikey (2026-09-26): the synth moves to Rust sooner, the
generator later. This is the first real step. Start it only after items
10 and 11 are merged.

**The gate.** Read item 10's baseline first. If building and tearing down
the audio graph is a small share of the cost, stop and leave a note here
saying so, with the numbers: a Rust engine wouldn't pay for itself.

Otherwise:
- An AudioWorklet engine with its DSP in Rust compiled to WebAssembly,
  a preallocated pool of voices, and no per-note objects or garbage.
- Three voices, chosen to span the kinds: `kalimba` (simple and struck),
  `fiddle` (a shaped wave through fixed filters), and `pad` as a chord
  voice (the heaviest). Everything else stays on the JavaScript engine,
  and both engines play together through the same channels, reverb and
  master chain.
- Behind a URL flag (for example `?engine=rust`), off by default, so
  Mikey can play the same loops both ways on his phone.
- **Proven, not assumed:** each Rust voice against its JavaScript
  original with `measure.mjs` -- tone probe, level at both note lengths,
  and `--endings` -- within tight tolerances. Then item 10's harness,
  both engines, same loops, same throttling: that decides whether this
  goes further.
- **The build:** the repo deploys plain files today. Keep that: commit
  the compiled `.wasm` with a reproducible build script, and add a check
  that the committed file matches its source.
- The generator, the voice budget's rules, share codes and every other
  voice are untouched.

Report the equivalence table, the before/after performance figures, the
file size added to the app, and anything that made the port harder than
expected.

## 14. The performance wins the baseline found

From `docs/perf-baseline.md` (item 10). Re-measure every change with
`tools/perf.mjs` against that baseline, same loops, same settings, and
report before and after. None of these should change how anything sounds;
prove it with `measure.mjs --voice all`, `--endings` and the corpus
loudness where the audio path is touched.

1. **Paint, the main thread's biggest cost** (57-67 ms/s of 71-84 at 1x,
   90% at 6x). The whole 765 x 3555 page repaints about 116 times a
   second because it is one paint layer and the cursor, the playhead
   lights (a 90 ms color transition and a glowing `box-shadow`) and the
   grid cells change on it every step. Put what moves on its own
   compositor layers, animate only `transform` and `opacity`, drop the
   glow's `box-shadow` transition for something that doesn't repaint,
   and touch only the cells that change. Keep the look. Target: paint
   under 10 ms/s at 1x.
2. **Disconnect every voice when it ends.** Finished voices keep
   rendering until garbage collection finds them: 40-45% of the audio
   thread at 1x, about 70% when the main thread is slow. Disconnect each
   voice's nodes on its end. Expected: the audio thread from 54-95 to
   about 49-53 ms/s on the baseline loops.
3. **The hidden-tab excess.** Hidden, the audio thread costs 20-100% more,
   likely because voices are built and wired up to 3 s before they
   sound. Prove the cause, then build or connect voices closer to their
   start without risking dropouts when timers throttle.
4. **The graph that always runs** (reverb combs, delays, the bus: 28-37
   ms/s, even with every layer muted). Find what costs what; look for
   savings that leave the sound identical, and propose (don't make) any
   that would change it.
5. **Page weight.** The service worker precaches both `keepalive.flac` and
   `keepalive.wav` (334 KB of 458 KB gzipped) though only one plays, and
   every script is fetched twice on a first visit. Precache what's used.

6. **Drop the playhead lights' fade** (Mikey, 2026-09-27: "drop it for
   speed"). #96 kept the 90 ms fade and put the choice to him; he chose
   speed. Remove it, confirm paint under 10 ms/s at 1x.

One PR per part, in this order, each merged under the policy.

## 15. The temple bell as a chord voice: lift it

Item 11's note: at 0.4 s notes the chord temple bell already sits above
the chords median, at 1.6 s it sits 1.9 LU under, and the bell rings 6.5 s
whatever the note length. Mikey heard it as buried, so the long-note
reading decides: lift the chord use about 1.9 LU, melody use unchanged.

## 16. The mood labels: make "happy" sound happy

Mikey: "sometimes I will get a track that is '100%' happy and it certainly
doesn't sound that way. It's not a bad track or a negative sounding
track, but it doesn't feel like it is '100%' happy." And the constraint
stands: never negative or depressing -- Animal Crossing and a nice coffee
shop wouldn't go there. The eight moods already keep to that.

What the brain found (20,000 fresh loops on v55): 1,028 are labeled 90%+
happy. Their final `lift` averages 0.80, right on the happy region (0.82),
so the feel numbers are fine. But **42% of them are in minor-ish modes**:
dorian 16%, aeolian 9%, then harmonic minor, phrygian dominant, kumoi,
hirajoshi, insen and more. The scale comes from the profile's pool and the
mood barely steers it, so a "100% happy" loop in aeolian or phrygian
dominant sounds wistful or fiery, not happy. And the "100%" reads as
intensity when it means "all of its mood comes from the happy region".

Do:
- **Measure first:** for each mood, how its loops come out on the cues a
  listener hears as bright or dark -- mode (major-ish vs minor-ish), share
  of major chords, tempo, register, melodic direction. Report the table.
- **Let the mood steer the music.** High `lift` should weight bright modes
  and major harmony, and the other cues, clearly enough that the label is
  honest; low `lift` leans inward (reflective, peaceful), never sad. Keep
  every profile's character: steer within its scale pool where you can,
  and say where a profile's pool can't honour a mood.
- **The labels: not yet.** Mikey (2026-09-27): the mood words are
  "something we need to work through and maybe have some test albums to
  decide. We might need more mood words." So leave the words and the
  display as they are for now. Do make the vocabulary easy to change:
  the moods, their feel targets and their display words as data in one
  place, so adding, merging or renaming moods later is a small edit. The
  brain will run listening albums (Mikey describing tracks in his own
  words) to find the vocabulary; a later item changes the labels.
- The balance lock will move (more major modes, perhaps); report and
  re-baseline deliberately.
- Afterwards the brain builds a blind album to check the steering is
  audible (bright moods sounding brighter), separate from the naming.

## 17. Composition depth, second pass

Mikey heard the blind "Depth" album (8 long loops, 5 developing, 3
simple), rating each "goes somewhere", "loops" or "too busy":

| loop | kind | bars | heard |
|---|---|---|---|
| rul-glun (glade) | developing | 32 | goes somewhere |
| yam-vai (hollow) | developing | 24 | goes somewhere |
| neing-sho (wayfare) | developing | 16 | goes somewhere |
| shuing-soun (thaw) | developing | 16 | goes somewhere at the end, mostly loops |
| loal-lor (shrine) | developing | 16 | kind of; circles one idea |
| yain-hain (haven) | simple | 24 | goes somewhere -- "wonderful" |
| thoum-yeim (tide) | simple | 16 | loops |
| keing-shai (bloom) | simple | 16 | loops |

Nothing was "too busy". At 24 and 32 bars development is clearly heard and
liked. At 16 bars it's weak: the contrast comes late (A8 B4 A'4 puts B at
bar 9) and two of three still read as looping, matching the numbers
(distinct melody bars 7.3 developing vs 6.7 simple). And his favorite
was a simple 24-bar loop, so simple long loops stay.

Do:
- **Stronger development at 16 bars:** the contrast earlier and clearer --
  four-bar phrases (A A' B A'', each A varied, not repeated), a B that
  moves register, rhythm and harmony together. Measure the 16-bar
  developing loops against the 24-bar ones and aim for a comparable lift.
- **More development at 24 and 32 bars:** raise their share to about two
  thirds, per length, through the `DEPTH` weights. Leave 8 and 16 bars'
  share as it is until the 16-bar form has been heard again.
- Simple loops untouched. The usual checks; the balance lock will move.
- Afterwards the brain sends a second blind album.

## 18. Housekeeping: comments and README against the code

The brain audited the documents at the end of its long session (README,
roadmap, `docs/*.md` updated in the same PR as this item). The code's own
comments it can't edit. Known stale ones:
- `js/characters.js`'s header says profiles "would be ten boxes" and
  "ten points"; there are sixteen.
- `js/generator.js` (around line 1124) says phrase position "is roadmap
  item 2 and is still absent"; item 2 shipped (phrase velocity, #11).

Do a pass over `js/`, `tools/` and `test/`:
- Fix comments that are stale: counts, "not yet" notes about things that
  shipped, rules that changed (new voices may now join existing pools;
  old share codes are not protected while testing; the hands merge under
  the queue's policy).
- Check the README's claims against the code where they are checkable
  (flags, file names, figures quoted as current), and fix what's wrong.
- Comments and docs only: no behavior change. Prove it: tests three
  times, `stats.mjs` output byte-identical, `--check` unchanged. No
  version bump needed.

List what you changed in the PR, and anything you found but weren't sure
about as a note here.

## 19. A word-ranking test (diagnostics, roadmap 19)

Mikey (2026-09-28): describing tracks in his own words is too abstract.
He wants to hear a loop, see four or five words, and put them in order
from most like the track to least like it -- "not an over-engineered test
with nice UI, in fact simple code and fast would be preferable", so that
"a hundred plus songs" is easy. His answers become the data that places
each word on the maps (`docs/MOODS.md`, maps and clouds).

Build a separate page, `rank.html`, not linked from the app's main screen
(Mikey opens it by URL). It uses the app's own engine and synth, so it
always tests what the app plays. Plain HTML, legible on a phone, nothing
more.

- **A trial:** a fresh loop from `newSpec`, seeds counting up from a
  fixed start so a run is reproducible; it starts on its own and loops.
  Don't show the loop's mood label or profile (they'd bias the answer).
- **Five words** from the pool, shuffled, as big buttons. Mikey taps them
  in order, most like the track first, and **stops when the rest don't
  fit**: untapped words mean "doesn't fit" (no taps at all is allowed).
  Buttons: Undo, Next (records, moves on), Skip (a loop he can't judge or
  that sounds broken; recorded as a skip).
- **The pool is data** at the top of the page's script, so the brain can
  change it. Each trial draws five different words, balanced so every
  word is shown about equally often. Pool v1 (all from his list): merry,
  tender, serene, golden, twinkling, crisp, velvety, sour, bouncy,
  floating, swaying, quirky, happy, joyful, peaceful, reflective, lively,
  cozy, airy, misty, intimate, spacious.
- **A consistency check:** about one trial in twenty replays an earlier
  loop with the same five words in a new order, unmarked.
- **Record per trial:** trial number, build, the loop's song code
  (`encodeSong`), the words in the order shown, the taps in order, skip,
  and seconds from start to Next. Saved in the browser as he goes, so he
  can stop and pick up another day; a counter shows how many are done.
- **Export:** one button that copies everything as JSON lines and also
  downloads a `.jsonl`. Clear sits behind a confirm.
- **A tool for the brain:** `tools/ranks.mjs <file.jsonl>` prints per
  word how often it was shown, tapped first, tapped at all, never tapped,
  and the repeat trials' agreement. Measuring each loop's cloud on the
  dials is a later item.
- **Nothing in the app changes:** `index.html`, the engine and share
  codes untouched; the balance lock doesn't move. Say in the PR whether
  the service worker caches `rank.html` and why.

## 20. Ranking test: one word per map (pool v2)

From the first 20 trials (`docs/MOODS.md`, ranking results): no word fit
8 times, partly because five random words can bunch on one corner (one
trial offered tender, golden, misty, serene and peaceful together), and
fast, tense loops had few words to reach for. So each trial now shows
**one word from each of the five maps**, and the pool grows to cover both
ends of every map. All words are from Mikey's list.

- The pool becomes five groups, data at the top of the script:
  - color (warmth x lift): golden, frosty, tender, happy, joyful,
    reflective, merry, peaceful
  - shimmer (edge x height): twinkling, crisp, velvety, booming, soft
  - air (room x ground): floating, airy, intimate, cozy, spacious,
    serene, misty, steady
  - motion (energy x bounce): bouncy, swaying, lively, energetic, still,
    flowing
  - flavor (tang x oddness): sour, sweet, spicy, quirky, zany
- Each trial draws one word per group, least-shown-first within the group
  (as now), and shows the five shuffled. Group names are never shown.
- Record the pool version on each trial (`"pool": 2`; trials without it
  are pool 1) and keep the saved answers: v1 trials stay valid data.
- New loops continue from where the saved run left off; the seeds and
  hidden repeats work as before.
- `tools/ranks.mjs` reports per pool version, and per group.
- Nothing else in the app changes; the balance lock doesn't move.

## 21. Rust core, step 1: the pipeline and one voice (kalimba)

Roadmap 16, timing 2026-10-03: the synth moves to a Rust core now. Its
case is **portability**, not speed: the same core will later run the
phone app, a native build and games. This item proves the whole path end
to end with one voice, so the next voices are routine. Read roadmap 16
first, including "Feasibility": the brain's probe built, ran in an
AudioWorklet and nulled to -55.6 dB against Web Audio, but only once
note starts were sample-accurate.

**Intent.** With the flag on, a kalimba note comes out of Rust and sounds
the same as today; with it off, nothing in the app changes at all. Every
other voice, the effects and the master chain stay in JavaScript and
work exactly as now. The JavaScript synth stays the reference.

**The crate.**
- `core/`: a Rust library crate with **no dependencies** (crates.io has
  been flaky behind the sandbox's proxy, and the core needs none). Use
  `std`: its math (`sin`, `exp`, `powf`, `tanh`) compiles to WebAssembly
  with zero imports.
- **Host-agnostic:** the DSP knows nothing about browsers -- a voice
  pool, `process` into a block, events in. The WebAssembly exports live
  in their own module behind `cfg(target_arch = "wasm32")`. Native
  `cargo test` covers the core.
- **Preallocated:** a fixed pool of voices, no allocation after init, no
  panics reachable from `process`. Note what happens when the pool is
  full (it shouldn't be: the JS budget still decides who plays).
- **The building blocks, built to be reused by every later voice:** a
  parameter type that follows Web Audio's automation rules exactly
  (`setValueAtTime`, linear and exponential ramps, `setTargetAtTime`,
  as the spec defines them, including where a ramp starts), a sine
  oscillator, and FM by phase modulation the way an oscillator's
  frequency input does it. Kalimba is `fm()` (sine carrier, sine
  modulator, the decaying index) plus a sine body an octave down; port
  that, nothing more.

**The build -- the committed file.**
- `core/rust-toolchain.toml` pins an **exact** stable version (the newest
  the sandbox can fetch, e.g. `1.9x.0`, never `stable`) with the
  `wasm32-unknown-unknown` target. Release profile: `opt-level = 3`,
  `lto`, one codegen unit, `panic = "abort"`, `strip`; remap the source
  path so the output doesn't depend on where the repo sits.
- `tools/build-core.sh` builds and copies the result to `js/dlcore.wasm`
  (commit it). `--check` rebuilds and fails if the committed file
  differs by a single byte.
- `.github/workflows/core.yml`: on every PR and push to `main`, run
  `tools/build-core.sh --check`, `cargo test` in `core/`, and
  `node test/generator.test.mjs`. This becomes the repo's first CI beyond
  Cloudflare's build. **If the push of the workflow file is refused**
  (Claude Code may lack permission to change workflows), leave the
  file's full contents in a note at the bottom of this file and carry
  on; Mikey adds it on GitHub's website.
- `.gitignore`: `core/target/`. `.assetsignore`: `core`, `.github` (the
  source must not ship as site assets; `js/dlcore.wasm` must).
- If the sandbox and GitHub Actions produce different bytes from the same
  source, stop and leave a note: the whole decision rests on this.

**The host -- the worklet.**
- `js/worklet.js`, an `AudioWorkletProcessor`. The main thread fetches
  `js/dlcore.wasm` once and passes the **bytes** in `processorOptions`;
  the worklet compiles them with `new WebAssembly.Module` (sync, small
  module). Bytes rather than a compiled module, because iOS Safari is
  the target and support for passing a module across is less certain.
- No `SharedArrayBuffer`, no threads, nothing that needs special headers.
- **Events by `port.postMessage`**, each with its absolute start time in
  context seconds. The worklet queues them and starts each **on its exact
  sample** within the block (block-boundary starts wrecked the probe's
  match). A note that arrives late starts at once; count late notes for
  Diagnostics.
- **Outputs into the existing channels:** the node has one output per
  channel it serves (melody and chords for now), each connected into
  that channel's input in the synth, so echo, reverb, ducking, mutes,
  `silence()` and the master chain apply exactly as to a JS note. If a
  note's destination isn't one of those, it plays on the JS engine
  (count those too).
- Stop, re-roll, "let the loop wander", the hidden tab and `dispose()`:
  find what happens to an already-scheduled JS kalimba note in each case
  and make the Rust note do the same. Add a clear-all message for
  disposal.
- `recordingContext` and `OfflineAudioContext` (the measure harness) must
  work too: the probe ran there.

**The split -- what stays in JavaScript.**
- Scheduling, the voice budget (`_budget` and `_release` with kalimba's
  same costs, so refusals don't move), and **every `Math.random` draw,
  in the same order and number as today's kalimba code**. The values a
  note needs travel with its event. That keeps seeded renders comparable
  and keeps every other voice's draws where they were. Kalimba draws none
  today as far as the brain can see; check, and keep the principle for
  the next voices.

**The flag.** `?engine=rust` turns it on; off by default. Diagnostics
shows `engine: js` or `engine: rust` (plus late and fallback counts when
on). Precache `js/dlcore.wasm` and `js/worklet.js` in the service worker
so the flag works offline; say the bytes added.

**Proven, not assumed.** `measure.mjs --engine js|rust` (default js).
Report, both engines, kalimba as a melody voice and as a chord voice:
- `--voice kalimba` level at `--note 0.4` and `--note 1.6`: within
  **0.25 dB**.
- The tone probe's bands, including the 2-5 kHz share: within 0.5 points.
- `--endings`: no flags the JS voice doesn't have.
- **A null test** (new option): the same seeded notes through both
  engines, subtracted. Kalimba is all sines, so expect well below
  -40 dB; report the figure and explain anything above.
- **Nothing else moves:** with the flag off, `measure.mjs` output on a
  fixed set of loops (include some kalimba loops) is byte-identical to
  `main`. With it on, loops without kalimba are byte-identical too.
- Refusals on full and lite unchanged; the balance lock untouched (the
  generator isn't touched); tests three times.

**Report in the PR:** the equivalence table, the null figures, the
`.wasm` size and the bytes added to the page, the late and fallback
counts over a few loops, and anything that made the port harder than
expected. Since the sandbox can't open workers.dev, list the commit
preview URL with `?engine=rust` for the brain and Mikey.

## 22. Rust core, step 2: fiddle and pad, and the performance A/B

Start only after item 21 is merged. Same crate, host, flag, split and
proofs as item 21; this item adds the two voices that cover the hard
parts, and measures both engines.

- **Fiddle:** the custom `bowed` wave (Web Audio's `PeriodicWave` is
  band-limited: build a band-limited equivalent from the same harmonics,
  as Chrome does, and say how), vibrato on detune with its random rate
  and depth, slurs and slides (`_slur`, `_slide`, including its
  `SLIDE_CHANCE` draw), and the fixed body filters (`_body('fiddle')`,
  Web Audio's biquad formulas). Port the body into Rust too, per channel,
  so the voice is whole for the native and game hosts.
- **Pad:** both paths, `pad()` and `pad` as a chord voice: two detuned
  band-limited triangles per note through a lowpass whose frequency
  ramps.
- **Random draws:** in the same order and number as today, drawn in JS
  and sent with the note (item 21's rule). Fiddle has several; get the
  order right or every later draw in the loop shifts.
- **Proofs:** item 21's table for fiddle (melody and chords) and pad, at
  both note lengths, endings, and the null test. Band-limited waves may
  not null as deep as sines; report the figure and what's left in the
  residual (aliasing, phase, the wavetable). Nothing else moves, as in
  item 21.
- **Performance:** `perf.mjs --ab`, flag off against flag on, on the same
  loops (pick some with all three ported voices), under the usual
  throttling. Audio health must not get worse; report main-thread and
  audio-thread cost, graph churn and memory. This is information for the
  roadmap, not a gate: the port's case is portability.

**Then stop.** After the merge, the brain verifies, builds a short blind
X/Y album (the same loops with and without the flag, plus a control
track), and Mikey listens on his phone. What comes next -- the rest of
the voices, behind the same flag -- is written after he has heard it.

## Rust core, steps 3-8: every voice (items 23-28)

Written 2026-10-08 (brain, Session 5). Items 21-22 proved the path:
kalimba, fiddle and pad play from Rust behind `?engine=rust`, null
against JavaScript, and Mikey heard no difference (Firefox, desktop).
These six items bring **every remaining voice** over, behind the same
flag, so the synth runs whole on the core. The effects and the master
chain stay in Web Audio (see "After item 28"). The plan rests on a
read-only survey of `synth.js` (brain, 2026-10-08): which voices share
which building blocks, and every `Math.random` draw. Its findings are
summarized in each item; check them against the code as you go -- the
survey is a map, not a proof.

**Standing rules for items 23-28**, on top of the usual ones and item
21's crate, host, flag and split:

- **The JavaScript synth stays the reference.** With the flag off,
  nothing changes. Every `Math.random` draw stays in JavaScript, in the
  same order and number, including draws made before a budget refusal;
  the values travel with the note. The budget (`_budget`, `_release`,
  costs, timing) stays in JavaScript, unchanged, per part where a voice
  is billed in parts (kalimba's `parts` mask is the pattern).
- **A voice is whole in Rust.** Its constants, waves and bodies live in
  the core, not only in the message, so a native or game host gets the
  same voice. A note that can't go to the core (its channel isn't served
  yet, or the core hasn't loaded) plays in JavaScript, as now.
- **Widen the note message** when a voice needs more than four extra
  values (fm's five options, tubular's five detunes): a fixed, larger
  array, still no allocation after init.
- **The proofs, for every voice the item ports**, on melody and chords
  where the voice plays both: item 21's table (level at `--note 0.4` and
  `1.6` within 0.25 dB; tone bands within 0.5 points; `--endings` no new
  flags), the **null test**, and **nothing else moves** (flag off:
  `measure.mjs` byte-identical to `main` on a fixed set that includes the
  item's voices; flag on: loops without them byte-identical too).
  Refusals on full and lite unchanged, the balance lock untouched, core
  tests and generator tests three times, `tools/build-core.sh --check`.
  Where a voice nulls shallower than -60 dB, say what the residual is.
- **Memory and size.** Report the `.wasm` size and the core's memory
  (static and at peak) after each item. Each band-limited wave is about
  590 KB of tables at Chromium's layout, and this plan adds about ten
  (roughly 6 MB, zeros in the `.wasm`, real memory once built). The
  phone is the target: if the core's memory would pass 16 MB, stop and
  leave a note with the options rather than choosing.
- **Report** as item 21 did, plus the commit preview URL with
  `?engine=rust`, and the Diagnostics `fallback` count over a few loops
  (it falls as items land; say which voices still fall back).
- **Self-merge** stays as the merge policy says. If Claude Code's safety
  check refuses the merge, stop and tell Mikey; he merges.

## 23. Rust core, step 3: the FM voices, sine and tubular (no new DSP)

The core's `Fm` is `fm()` exactly, and eight voices are nothing but
`fm()` calls: keys (a third of all loops, 11% of all notes), bell,
celeste, musicbox, rhodes, marimba, harp (two calls) and piano (two
calls). **Hook `fm()` itself**, as `pad()` is hooked: when the core is
on and the note's channel is one it serves, the note goes to the core
with its five options; each `fm()` call is still budgeted on its own,
so a refused second strike stays refused. That covers every caller on
melody and chords at once. `fm()` calls on bass (rhodesbass) and
texture (bell, chime) keep playing in JavaScript until item 27.

Also: **sine** (one sine, a linear swell, `_release2`) and **tubular**
(five sines, five detune draws sent with the note). Moogpad already
plays through `pad()`; confirm it does.

Survey notes: no voice in this item draws, except tubular's five.
`keys` and `bell` reach `fm()` through `pluck()`'s first branches; the
rest through `voice()`.

## 24. Rust core, step 4: the wave-table voices

Seven voices need only new wave tables, built the way the core already
builds `triangle` and `bowed`:
- Chromium's **built-in sawtooth and square**: softpad (three saws),
  analogpad (three saws), and the square beep (`pluck()`'s default
  branch: `pluck` and any name without its own case), with its constant
  5.4 Hz vibrato on detune.
- The leads' custom waves, `_makeWave(1.5 / 1.8 / 1.7)`: saw, moog,
  analoglead.
- **Whistle** (built-in triangle, which the core has): its pitch scoop
  comes from `_slide`, whose draw happens only when `dur >= 0.18`;
  JavaScript draws and sends whether it slid, from where, and the reach.
  Moog and whistle share one case with an automated lowpass and a
  vibrato depth that ramps in.

Stab waits for the bandpass (item 26). Report the memory per table and
in total (standing rule).

## 25. Rust core, step 5: accordion and nylon, the shared bodies

**First, a harness fix (brain, 2026-10-08).** `measure.mjs --voice
<the 18 voices of items 23-24> --engine rust --note 0.4` runs Chromium
out of memory: the renderer was killed by the kernel at 5.7 GB, after
which the tool waits forever with no output (seen twice). The same probe
on `--engine js`, and on one voice with `--engine rust`, completes; the
`--null` run over the same voices completes too. Suspect: each offline
render builds a core (7.1 MB since item 24) whose memory is never
released. Find where; make the harness release it, and fail loudly when
the page crashes instead of hanging. Then say whether the app can leak
the same way (the synth rebuilt on a quality change, the recording
context, export): `dispose()` sets `alive` false so `process` returns
false, but check it happens.

The core has one body (the fiddle's, per channel). Generalize it to a
body per kind and channel, as `_body()` does in JavaScript, with the
`BODIES` table: nylon and accordion (peaking and lowpass, kinds the core
has).
- **Accordion:** the `reed` wave (`_makeWave(2.0, 0.6)`), two reeds at
  -1.25 and +1.25 cents, the second at 0.35 and started `rand / f`
  seconds late (one draw, after the budget, sent with the note); its
  level differs on chords.
- **Nylon:** `nylonMellow` and `nylonBright` (`_makePluck`), two gains
  with their own decays, and **`damp`**: a strummed chord damps the
  previous strum's strings that are still ringing (`damp()` and
  `_strung`). In the core that is a message that adds a
  `setTargetAtTime(0.0001, time, 0.08)` to notes already queued or
  playing on that channel, in the order JavaScript pushed them (mellow,
  then bright). Find what Chromium does when an event is inserted into
  a timeline that is already rendering, and match it; prove it with a
  null test on strummed nylon chords, not only single notes.

## 26. Rust core, step 6: bandpass, highpass and the noise source

The one big new primitive. Every breath, strike and drum uses
`this.noise`, a two-second buffer filled from `Math.random` in the
Synth's constructor, so Rust cannot make it: **JavaScript hands its
samples to the core once per Synth** (about 384 KB at 48 kHz; size the
buffer for the highest rate the app accepts, and say what that is).
- **Biquad kinds:** bandpass (its Q is linear, unlike the lowpass's dB)
  and highpass, from Chromium's formulas, including its edge cases.
- **A buffer source** that plays the noise as Chromium's
  `AudioBufferSourceNode` does: `start(when, offset, duration)` with the
  duration in buffer time, a constant `playbackRate`, looped and
  unlooped, sub-frame starts, Chromium's interpolation. Read Chromium's
  source rather than guessing. Two users: `_noiseSource` (unlooped, rate
  and offset drawn) and the winds' and singers' looped breath (rate
  drawn, offset 0).
- Prove the source first on the simplest case before any voice: noise
  -> highpass -> gain (the hat's graph, rendered on melody for the test).
- **Voices:** stab (saws, bandpass), ocarina and flute (sine and
  triangle, slide, vibrato, looped breath through a bandpass), panflute
  (the `pipe` wave, a vibrato drawn only when `dur >= 0.5`, breath and
  chiff), prepared's knock (three draws, only after its 3-unit budget)
  and the temple bell (eight sine partials with eight detune draws, then
  the strike's two). Draw orders are in the survey notes below; check
  them in the code.

Survey notes on draws: ocarina and flute, the slide draw (`dur >= 0.18`)
then the breath rate; panflute, the vibrato rate (`dur >= 0.5`) then the
breath rate; templebell, eight detunes (partial by partial, -4 then +4
cents) then rate and offset; prepared, rate, offset, then the knock's
bandpass frequency.

## 26b. The one-frame click in the noise voices (before item 27)

Found by the hands in item 26 (#137) and traced by the brain from the
code (2026-10-08). **A sound fix, in both engines at once.**

- **What happens.** A noise buffer source started at `t` can start one
  frame before its note's gain takes its first value: Chromium rounds a
  buffer source's start to 1/1024 of a frame, but compares automation
  times in frames (`time * rate <= frame`). When `t * rate` lands just
  above a whole frame (by less than about 1/2048), that one frame of
  noise passes through a gain still at its default of **1**: a single
  loud sample (a -33 dBFS click was seen). #137 made the core reproduce
  it, since JavaScript is the reference.
- **How often.** Notes on the bare step grid (bass, texture, melody
  and chord roots when the loop has no choir) land on whole frames
  whenever `rate * 15 / bpm` is whole (bpm 120 at 44.1 kHz on every
  other step, about 24 tempos in 40-190 at 44.1 kHz and 19 at 48 kHz),
  and about half of those carry the tiny positive error. Jittered notes
  (drums, swung steps, strums) hit it about 1 time in 2000. The voices
  exposed are mostly quiet-onset ones, where a tick stands out.
- **Exposed gains** (brain's reading; check each in the code): ocarina
  and flute's air gain, panflute's air gain, prepared's knock, the
  temple bell's strike and its outer gain, the kick's click, snare and
  clap, hat/open hat/shaker, the frame and tap slap, the jingle's outer
  gain, pluckbass's click, the sung voices' breath and their `amp`,
  and the textures drop, wind and waves. Oscillator-fed gains are not
  exposed (oscillators start on the plain ceiling, and their waves start
  at zero); confirm.
- **The fix.** Give each exposed gain its first event's value as its
  intrinsic value when it is made (`g.gain.value = x` before
  `setValueAtTime(x, t)`), so the early frame plays at `x`, not 1. Make
  the matching change in the core (its `reset_at(UNITY, ...)` for those
  gains), so both engines lose the click together and keep nulling.
  Only the clicking frames should change.
- **Proof.** A reproduction first, on `main`: a temple bell and a hat
  struck where `t * rate` sits just above a whole frame (11.3 s at
  44.1 kHz, or a grid note at an integral tempo) render a loud first
  sample in JavaScript; after the fix they don't, on both engines. The
  hat test in `--null` starts on fractional frames and never hits the
  window, so add starts that do. Then: every sample outside the clicking
  frames unchanged (flag off, a corpus of loops, compared with `main`
  within the known summing noise), nulls for the ported voices as deep
  as before, refusals and the balance lock untouched. Count how many
  notes in a few hundred loops landed in the window before the fix.
  Version bump: it changes what the app plays, if only by a sample.
- For Mikey's ears: nothing to listen for but the absence of rare ticks.

## 27. Rust core, step 7: bass, textures and drums (five channels)

Three more outputs, so the core serves all five channels: **bass,
texture, drums** next to melody and chords, each connected into its
channel's gain as the first two are (ducking, sends and mutes stay in
Web Audio). Split it **27a** (bass and textures) and **27b** (drums) if
that is cleaner. Start from 26b's fixed JavaScript, so the drums and
textures are ported without the click.
- **Bass:** sub and moogbass (sawtooth through an automated resonant
  lowpass, from item 24), round and pluckbass (triangle, lowpass;
  pluckbass's click from item 26), fifths (two sines), rhodesbass
  (`fm()`, from item 23). Glide, chug's shorter release, and each
  voice's trim. Only pluckbass draws (its click's two).
- **Textures:** swell (sines, one budget check per note; the first
  refusal drops the rest of the call), bell and chime (`fm()`), drop
  (noise, bandpass at a drawn frequency), wind (looped noise, a bandpass
  whose frequency a 0.07-0.13 Hz sine moves at audio rate) and waves
  (looped noise, a drawn rate and offset, two lowpasses in series).
- **Drums:** kick and softkick, snare and clap, hat, open hat and shaker,
  rim, and the hand kit (frame, tap, jingle, open jingle). They are the
  most notes per second of anything in the app, so this item also runs
  **`perf.mjs --ab`** (flag off against on, loops with full kits, the
  usual throttling): audio health must not get worse; report audio- and
  main-thread cost, graph churn and memory, as item 22 did.

## 27c. Three small fixes from the brain's check of 26b and 27 (before item 28)

Found 2026-10-09 by the brain's review and reruns. One PR, a version
bump (the first changes what the app plays).

- **26b's setter and late notes (JavaScript, flag off and on).** The
  Web Audio `value` setter is `setValueAtTime(value, currentTime)`. For
  a note built after its own start time (the engine plays notes up to
  about 0.25 s late, e.g. after a hidden tab or a stall), that event
  lands *after* the note's envelope events: the gain jumps back to its
  first value when the envelope has already moved on (most are 0.0001,
  which would cut the note; the kick's click would hold at `v * 0.28`).
  Offline renders never build a note late, so 26b's proofs couldn't see
  it. Reproduce first (a note built behind `currentTime`, in an offline
  render through `suspend()`, before and after 26b), then fix every
  setter 26b added: e.g. `setValueAtTime(x, Math.min(time,
  ctx.currentTime))`, which is 26b's fix when on time and a no-op when
  late. Check the core does what the fixed JavaScript does for a late
  note (it starts late notes at once).
- **The jingle's draws on a fallback (flag on).** `_coreDrum` draws the
  jingle's five zil detunes before `_coreNoiseChannel` can refuse; on a
  fallback the JavaScript jingle draws them again, 12 draws where the
  rule is 7. Check the channel first, or hand the JS path the drawn
  values. Check the other drums for the same pattern.
- **Pan flute grace notes (flag on).** `--null --voice panflute` on v75:
  the 0.1 s and "repeated" rows show a worst sample of -68.5 dBFS (worst
  note -80.8 dB); in the brain's check of item 26 (v72) the same rows
  were -125 dBFS. Something in 26b or 27a moved it, likely the air
  gain's new first value or the frame-based event compare. Find which,
  make it null again, and say why the other voices didn't move.

## 28. Rust core, step 8: the sung voices (vowel, hum, choir)

The hardest voices, last. Each singer's detune is a ramp, then a jitter
of many small ramps (two draws per step, about one step per 0.13 s),
**plus** a vibrato oscillator summed into the same detune; three peaking
formant filters whose frequency, Q and gain all ramp when the vowel
drifts; a lowpass; and a breath through a bandpass.
- **Param capacity:** `MAX_EVENTS` is 8 and a long sung note needs
  dozens. Measure the longest note a sung voice gets across the corpus
  and size it from that, with a margin; still no allocation after init.
- **The draw order is intricate** and partly before the budget: whether
  it drifts and where to (both drawn before the budget check), then per
  singer the choir spread, the scoop's start and end, the jitter steps,
  the vibrato's three, and last the breath rate. Read `voice()`'s sung
  case closely; a single misplaced draw shifts every later note.
- The `glottal` wave, `_formantTrim` (computed in JavaScript and sent,
  or ported: say which), choir's three singers into one tract.

Start from 27c's fixed code.

**After item 28, stop.** Every voice plays from Rust behind the flag.
The brain verifies, Mikey listens to one labeled album across the new
voices, and then he decides what is next: making the core the default,
moving the effects and master chain into Rust (needed for a native or
game host, not for the phone's web app), and the generator's port after
the words.

## Rust core, steps 9-11: the effects and the master chain (items 29-31)

Written 2026-10-09 (brain, Session 5), at Mikey's word: after item 28
every voice plays from the core; now **the rest of the sound path moves
too**, so the core makes the whole mix and a native or game host needs
nothing from Web Audio but an output. Same flag (`?engine=rust`), same
standing rules as items 23-28 (JavaScript is the reference; flag off,
nothing changes; every check, every item), plus these:

- **The graph, as it is today** (`_build()` in `synth.js`; read it, this
  is a map): five channel gains (drums .82, bass .62, chords .44, melody
  .58, texture .50), each with a reverb send and an echo send taken from
  the channel gain itself; drums go straight to `preBus`, the other four
  through `pumpBus` (the kick's duck). Reverb: `reverbIn` -> six combs on
  full, three on lite (each a delay with a lowpass in its feedback, the
  sum taken *before* the lowpass) -> `combSum` -> `reverbOut` ->
  `preDelay` -> `tails` -> `preBus`. Echo: a delay with a lowpass and a
  feedback gain, out through `tails`. Master: `preBus` -> `wobble` (a
  delay whose time two always-running sine LFOs move, wow and flutter) ->
  `sat` (a WaveShaper, a `tanh` curve, 2x oversampling on full, none on
  lite) -> `tone` lowpass -> `hp` highpass -> `comp` (a
  DynamicsCompressor) -> `master` gain -> `kill` gain -> `ceiling` (a
  second DynamicsCompressor, the limiter) -> the destination. Runtime
  changes: `setTone`, `fadeTails`/`restoreTails`, `duck`,
  `setEchoTime`, `setMute`, `silence`/`unsilence`, `setVolume`,
  `setCharacterLevel`. `setTone` replaces the saturator's curve outright.
- **Notes that still play in JavaScript must keep reaching the effects.**
  A fallback note (an unserved channel, a note before the core loads, a
  sung note too long for its detune) plays through Web Audio nodes; once
  the effects live in the core, those nodes need a way in. Give the
  worklet node one input per channel, and connect each channel's JS path
  into it, so a fallback note gets the same sends, duck and master as a
  core note. If the core fails to load, the whole JavaScript graph plays,
  as now.
- **Cycles.** The echo and the combs are feedback loops; Web Audio clamps
  a delay inside a cycle to at least one render quantum (128 frames).
  Match what Chromium does, not what the spec suggests, and prove it.
- **Proofs move from notes to the mix.** Each item adds a `--null` stage
  for what it ports: the same input through the JavaScript stage and the
  core's, subtracted, with signals that exercise it (impulses, swept
  sines, noise, real loops; level steps for the compressors; every
  runtime change at an awkward time). Whole loops: the mix against
  JavaScript, next to the JS-against-JS floor (about -86 dB). Where a
  stage can't null to the floor, say what the residual is and how loud,
  in dBFS and against the signal, before going on.
- **Performance** each item: `perf.mjs --ab`, flag off against on, on
  loops with full kits and long reverb, the usual throttling, on full
  and lite. The native Web Audio effects are fast C++; the core must not
  make audio health worse (late ticks, fill-ins). If it does, stop and
  leave a note with the figures rather than optimizing past the brief.
- **Stereo.** Today the graph is mono end to end, as far as the brain can
  see; confirm it, and keep it so.

## 29. Rust core, step 9: channels, sends, duck, echo and reverb

The mixing stage, up to `preBus`. The core sums its own voices into the
five channels as now, plus the worklet's five inputs (the JS fallback
notes); applies channel gains and mutes, the two sends, the duck on
`pumpBus`, the echo (delay, lowpass, feedback, `setEchoTime`), the
reverb (the combs on full and lite, `combSum`, `reverbOut`, `preDelay`)
and `tails` (`fadeTails`/`restoreTails`), and outputs `preBus` to one
node that feeds the JavaScript master chain (`wobble` onward), which
stays as it is for now. **DelayNode** as Chromium renders it: its
interpolation, its smoothing of `delayTime` changes, and the cycle
clamp. `setTone`'s reverb and comb changes go to the core as messages,
with the same `setTargetAtTime` curves.

## 30. Rust core, step 10: wobble, saturator, tone and highpass

The first half of the master chain. **Wobble:** a delay whose time is
0.014 s plus two sine LFOs (wow 0.32 Hz, flutter 6.3 Hz) at audio rate,
the LFOs started when the synth is built (find their phase on a real
context, where the synth is built mid-stream). **Saturator:** the
WaveShaper's curve lookup as Chromium does it (its index mapping and
interpolation), with `oversample` 'none' on lite and '2x' on full:
Chromium's up- and downsampling filters, read from its source, not
approximated. `setTone` swaps the curve outright: match when the new
curve takes effect. **Tone** (lowpass, `setTone` moves it) and **hp**
(highpass, 38 Hz): the core has both kinds. The core then outputs the
signal before `comp`.

## 31. Rust core, step 11: the compressors and the whole mix in the core

The last of the graph. **`comp` and `ceiling`:** Chromium's
DynamicsCompressor (its kernel: the knee curve, attack, the adaptive
release, its lookahead pre-delay, its makeup gain, its metering),
ported from Chromium's source, then `master` (`setVolume`,
`setCharacterLevel`) and `kill` (`silence`, `unsilence`). The worklet's
output goes straight to the destination. Prove both compressors with
level steps, bursts, and loops at the catalog's loudest (the loudest
loops reach about 0.85 peak; find a few that push `ceiling`), and the
whole app path: play, stop, re-roll, "let the loop wander", the hidden
tab, a quality change (which rebuilds the synth), and `dispose()`. With
the flag on, Web Audio then carries only the fallback notes and the
output.

**After item 31, stop.** The brain verifies; Mikey hears one more labeled
album (the mix, on his phone); then he decides about making the core the
default, and the generator's port (which waits on the words, his
2026-10-03 decision, unless he changes it).

## Later, not queued

Mikey liked the fiddle, accordion and drone as they are, and may want
more nuance in them later. Not now. No new sound profiles or instruments
for now (2026-09-25): the base is solid; the focus is optimization and
bettering what the app already makes.

## Merge policy

Mikey decides this line:

- (yes, from Mikey) When CI is green and every check above passes, Claude
  Code merges its own PR and starts the next item.

## Notes from Claude Code

- **Item 11, the temple bell as a chord voice: needs a decision, left as it
  is (2026-09-26).** Decided by the brain from Mikey's ear: item 15. The brief's yardstick is the chords layer's median at
  0.4 s notes, and there the chord templebell is already *above* it:
  -1.8 LU against a median of -2.6 (`measure.mjs --voice all --note 0.4`,
  LU against kalimba). Meeting the yardstick would mean turning it *down*,
  the opposite of "buried". At 1.6 s notes it is under: -5.3 against -3.4,
  1.9 LU. The bell rings 6.5 s whatever the note length, so a short-note
  probe flatters it against voices that stop, and a long one does not. So
  which length decides for a bell is a taste call: lift it about 1.9 LU to
  the 1.6 s median, or leave it and re-listen. The other three parts of
  item 11 went ahead without it.

- **Item 17, 32-bar loops: two thirds is out of reach through the weights;
  a decision if more is wanted (2026-09-27).** Three in four 32-bar loops
  (287 of 378 in 30,000) play their own layer cycles -- the micro-loops
  that slide short fragments against the long frame -- and those never
  develop, by item 12's design: their motion is the sliding. The weight
  reaches only the rest. At 0.72 (the same as 24 bars) 73% of those
  develop, 17% of all 32-bar loops (was 16% at 0.65). Getting
  near two thirds of all of them would mean developing micro-loops too,
  which is a new kind of form rather than a weight: say if you want it.

- **Item 18, short loops can still fall silent: a decision (2026-09-28).**
  The README said loops under 8 bars get no rests at all, "a hole in a
  two-bar loop is a glitch". That holds for the entry schedules
  (`genForm` returns early under 8 bars) but not for the short gaps:
  `genGaps` draws at every length. Over 6,000 loops, 30% of the 2-bar and
  34% of the 4-bar loops take a gap, and 7% and 8% a whole bar of silence
  -- half of a two-bar loop. Item 18 was comments and docs only, so the
  README now says what the code does; whether short loops should keep
  their gaps (or keep only the beat-long ones) is for Mikey's ears. Any
  change re-renders the short loops that have one.
- **Item 18, left alone (2026-09-28).** `ROADMAP.md` item 9 v2 still says
  the three wind voices are 12.4% of melody draws; that was true when it
  was written and reads as history there, so it stays (the README and
  `stats.mjs` now say about 16%). The synth and vowel-drift comments that
  keep articulation off the composer's stream "or every share code in
  circulation renders differently" are still true, and still the reason
  existing loops render identically, so they stay as written.

## Done

- #59, fiddle and accordion take two (v44),
  https://e2c802cd-driftloom.kruu-mikey-thaiculture.workers.dev: a rounder,
  softer fiddle and accordion with no rasp or buzz; short notes speak at
  once and joined fiddle notes slur; vibrato only on long fiddle notes; the
  accordion's shimmer slow and gentle, never dropping out on a held note.
- #62, tide part 2a (v45),
  https://23353f47-driftloom.kruu-mikey-thaiculture.workers.dev: waltz
  tunes leaning on the beat with pickups into the bar; quick grace notes
  (cuts and turns) on some of tide's beat notes; in some loops a second
  line in thirds or sixths under the held notes. Listen for graces that
  sound played rather than glitchy, and a harmony that stays underneath.
- #63, tide part 2b (v46),
  https://778e624e-driftloom.kruu-mikey-thaiculture.workers.dev: on about
  a quarter of tide's drum loops a frame drum and tambourine play the kit's
  part (round low skin, soft tipper taps, zils above the harsh band); and
  waves as the air, slow swells of filtered sea. Listen for a hand kit that
  sits where the kit did, and waves that stay a background.
- #64, the harsh leads softened (v47),
  https://c5c031fd-driftloom.kruu-mikey-thaiculture.workers.dev: saw, moog
  and analoglead without the rasp or the wah on every note -- each still
  itself (the saw a pluck, the moog a little movement, the analoglead its
  detuned shimmer). Listen for leads that no longer grate, and whether the
  moog now reads as too dull.
- #65, nylon guitar and pan flute (v48),
  https://ce292354-driftloom.kruu-mikey-thaiculture.workers.dev: a nylon
  guitar strumming tide's chords (down on the beat, up off it, the upstroke
  lighter) and a breathy pan flute among tide's tunes. Listen for a strum
  that sounds played rather than smeared, and a pan flute whose breath is
  air, not hiss.
- #66, cinder, the fiery 6/8 (v49),
  https://d7e09d62-driftloom.kruu-mikey-thaiculture.workers.dev: a new
  profile, fast and Spanish-tinged -- a driving 6/8 on frame drum and zils,
  a nylon guitar strumming the Andalusian cadence (Am-G-F-E, ending on a
  major E) with the tune taking G# over that E. Listen for the fall landing
  bright rather than clashing, and whether the b9 (F) the E chord sometimes
  takes should go.
- #67, wayfare, the rolling train (v50),
  https://6d5ae00b-driftloom.kruu-mikey-thaiculture.workers.dev: a new
  profile for traveling -- a walking 4/4, pan flute and fiddle over
  accordion, nylon and harp, and in half its loops a chug, a short bass
  note on every eighth with the brushes swishing along. Listen for wheels
  on rails rather than a machine gun, and whether I-IV-v-IV's minor v in
  mixolydian and dorian should go.
- #74, pan flute without the static (v51),
  https://14260a7b-driftloom.kruu-mikey-thaiculture.workers.dev: the
  static was tide's grace notes, which held for 0.4 s under the note they
  led into and were cut off with a click; now they flick into the note and
  let go (pan flute, and the flute, ocarina and analoglead, which had the
  same fault). Listen for clean graces in tide's pan flute and ocarina
  tunes, and a pan flute that otherwise sounds exactly as before.
- #75, a cleaner nylon strum (v52),
  https://178f4bb4-driftloom.kruu-mikey-thaiculture.workers.dev: the strum
  crosses the strings in 10-20 ms (was 15-30), and a strum still held when
  the next one starts lets go under it rather than ringing on. Listen for
  each strum landing as one gesture, and a new chord no longer sitting on
  the old one's strings (clearest in 6/8); the guitar's tone is unchanged.
- #79, wayfare's drums and chug (v53),
  https://d90d26df-driftloom.kruu-mikey-thaiculture.workers.dev: wayfare
  plays grooves of its own -- the kick on 1 and 3, a rim or soft snare on 2
  and 4, light eighths, no boom-bap and no claps -- with a softer, rounder
  kick on tape and brush, the drums a little under where tide's jigs sit;
  and the chug leans on the beat with the eighths between ghosted, short
  notes, the brushes lighter with it. Listen for a light, steady traveling
  beat under the same tunes, a kick that thumps rather than punches, and a
  chug that bounces ("chug-a") like wheels on rails rather than a machine
  gun -- and whether the chug's bass, 4.4 LU lighter, is now too faint.
- #82, wayfare's drums with their life back (v54),
  https://edcf8d59-driftloom.kruu-mikey-thaiculture.workers.dev: the same
  soft wayfare kit as #79 -- kick on 1 and 3, a rim or soft snare on 2 and
  4, no boom-bap, no claps, the chug as it was -- but no longer one bar
  over and over: four-bar phrases that swell toward a fill or a soft
  roll, an answer bar every so often with a pickup kick and an open hat,
  ghost notes before the backbeat, and a shaker or hat coloring the
  offbeats. Listen for drums that move and breathe across the phrase
  again, as in v52, while still sounding like v53's gentle kit; and
  whether the fills or the pickup kick ever tip it back toward tough.
- #88, the performance harness and baseline (item 10; `js/` untouched,
  still v54), https://15986051-driftloom.kruu-mikey-thaiculture.workers.dev:
  nothing to listen for, it measures and changes no sound. What it found
  is in `docs/perf-baseline.md`: no dropouts in any run; the main thread
  goes mostly on repainting the whole page every frame; finished voices
  keep the audio thread busy until the garbage collector finds them
  (40-70% of its work); a hidden tab costs the audio thread more, not less.
- #89, sound polish (item 11, v55),
  https://8de059b7-driftloom.kruu-mikey-thaiculture.workers.dev: sung notes
  (vowel, hum, choir) no longer leap out when a note lands on a formant --
  the loud ones come down, nothing is lifted, the vowels' color is the
  same; 5/4 chords fill the bar, felt 3+2, instead of stopping after four
  beats; keys arpeggios stop with their chord instead of ringing into the
  next one. Listen for hollow and choir tunes that stay even, thaw's 5/4
  loops, and arpeggios that no longer smear. The temple bell is unchanged
  (see Notes).
- #92, composition depth, first pass (item 12, v56),
  https://b8b54753-driftloom.kruu-mikey-thaiculture.workers.dev: about a
  third of the loops of 8 bars or more develop -- a statement, a departure
  that answers it with its own motif turned (new rhythm, upside down, or
  slowed), usually higher, over its own chords, and a return that
  restates the motif another way. Every other loop plays exactly as
  before. Listen for long loops that go somewhere and come home, a middle
  that sounds like an answer rather than a new tune, and whether a third
  is too many or too few (`DEPTH` in `js/generator.js` is the knob).
- #96, paint (item 14.1, v57),
  https://762d584a-driftloom.kruu-mikey-thaiculture.workers.dev: nothing
  to hear; the playhead lights and the layer cursors now move without
  repainting the page (paint 33 -> 0.7 ms/s, the main thread 60 -> 43 ms/s
  at normal speed, 338 -> 223 at 6x). Look for the same playhead and
  cursors; and whether a light that switched off instantly would do, which
  would save another ~12 ms/s (the 90 ms glow-out is kept for now).
- #100, finished voices let go (item 14.2, v58),
  https://c83c1eb5-driftloom.kruu-mikey-thaiculture.workers.dev: nothing
  to hear -- every note of every voice renders identically with and
  without it (`measure.mjs --retire`). The audio thread does 25% less
  work at normal speed and 44% less when the phone is busy, and no longer
  grows with load. Measured A/B on one machine (`perf.mjs --ab`), since a
  container restart moved the session to another mid-item.
- #102, hidden tab (item 14.3, v59),
  https://f18c1275-driftloom.kruu-mikey-thaiculture.workers.dev: nothing
  to hear; with the screen off or the app in the background, each voice is
  now built just before its note instead of up to 3 s early, and the
  audio thread does about 31% less work there. Listen for music that
  carries on with the phone locked exactly as before -- no gaps, no late
  notes -- including after a long time in the background.
- #103, the graph that always runs (item 14.4; `js/` untouched),
  https://6ddfb7ef-driftloom.kruu-mikey-thaiculture.workers.dev: nothing
  to hear. What the always-on reverb, dynamics, tape wobble and channels
  cost, part by part (in `docs/perf-baseline.md`); no saving leaves the
  sound identical. Four that would change it are proposed for Mikey's
  ears: four reverb combs instead of six, no saturator oversampling on
  full, one dynamics stage instead of two, a coarser wobble.
- #104, page weight (item 14.5, v60),
  https://01076bc2-driftloom.kruu-mikey-thaiculture.workers.dev: nothing
  to hear; a first visit now sends half what it did (233 KB gzipped, was
  467), the unused WAV keepalive no longer precached. Look for the lock
  screen controls still appearing when playing, and the app still working
  offline after one visit.
- #105, the playhead without its fade (item 14.6, v61),
  https://c251be28-driftloom.kruu-mikey-thaiculture.workers.dev: nothing
  to hear; the playhead's lights now switch on and off with the beat
  instead of glowing out over 90 ms, and the main thread does a quarter
  less work (61 to 46 ms a second at 1x, paint 15 to 10). Look for the
  playhead still reading clearly on full and on lite.
- #106, the temple bell as a chord voice (item 15, v62),
  https://ca65ea28-driftloom.kruu-mikey-thaiculture.workers.dev: listen
  for a loop whose keys are the temple bell -- its chords 1.9 dB up, now
  level with the other chord voices on held chords (was 1.7 LU under).
  On short chords it now sits 2.7 LU above them, since it rings 6.5 s
  whatever the note: the long-note reading decided. The bell as a melody
  is unchanged.
- #107, the mood steers the mode (item 16, v63),
  https://270efce4-driftloom.kruu-mikey-thaiculture.workers.dev: new loops
  whose mood is joyful, happy or enthusiastic now come out in bright modes
  (lydian, ionian, major pentatonic, mixolydian ...) about 80% of the time,
  was under 60%; "90%+ happy" in a minor-third mode went from 38% to 18%.
  Reflective loops lean inward -- dorian, kumoi, minor pentatonic -- away
  from both the bright and the darkest modes (for Mikey's ears: is that
  inward, not sad?). Soothing, peaceful and comforting as they were.
  Cinder's and shatter's pools have no bright mode, so a happy cinder or
  shatter loop still is not bright. Loops that already exist are
  unchanged (a code keeps its mode); the labels and display too. The mood
  words, feel targets and code numbers now live in `js/moods.js`.
- #108, composition depth, second pass (item 17, v64),
  https://0ee8da3d-driftloom.kruu-mikey-thaiculture.workers.dev: a 16-bar
  loop that develops is now four four-bar phrases -- A, A turned, B, A
  turned again. Listen for the tune moving at bar 5 (same rhythm, its end
  going somewhere else over a new cadence), B at bar 9 in a new register
  and rhythm over its own chords, and a return that is A but not A again.
  B's tune is always heard now (an airy loop used to rest it away in one
  developing loop in five). About two thirds of 24-bar loops develop (was
  57%). Simple loops are untouched, note for note. 32 bars: see the note
  above.
- #111, housekeeping: comments and README against the code (item 18; no
  version bump), https://11e02ab0-driftloom.kruu-mikey-thaiculture.workers.dev:
  nothing to hear -- comments and docs only, and `stats.mjs` renders the
  same corpus byte for byte. Stale counts, "not yet" notes about things
  that shipped and quoted figures were corrected in the code's comments
  and the README (the list is in the PR). One thing for Mikey's ears came
  out of it: short loops still take short gaps, a whole bar of silence in
  about one 2- or 4-bar loop in thirteen (see the note above).
- #117, the word-ranking test (item 19, v65),
  https://51ca22bb-driftloom.kruu-mikey-thaiculture.workers.dev/rank.html:
  nothing changes in the app. Open `/rank.html`, tap Start, and rank the
  five words for each loop, most like it first, stopping when the rest
  don't fit. Check that the loop starts on its own after Next, that the
  buttons are easy to hit on the phone, and that Export downloads the file
  (`node tools/ranks.mjs <file>` reads it). Drift is off on this page so
  each recorded code is exactly what was heard.
- #122, the ranking test's second pool (item 20, v66),
  https://6e6a5116-driftloom.kruu-mikey-thaiculture.workers.dev/rank.html:
  nothing changes in the app. Each loop now offers one word from each of
  the five maps (color, shimmer, air, motion, flavor), so the five can't
  bunch on one corner and fast, tense loops get words to reach for. Saved
  v1 answers stay and the run carries on from the next seed; new trials
  are marked `"pool": 2`, and `tools/ranks.mjs` reports per pool and per
  group. Check that a fresh trial shows a spread of words, and that your
  earlier answers are still counted.
- #126, the Rust core's first step (item 21, v67),
  https://09d9e12a-driftloom.kruu-mikey-thaiculture.workers.dev/?engine=rust:
  nothing should sound different. Without the flag the app is unchanged;
  with `?engine=rust` the kalimba comes out of Rust (it nulls against the
  JavaScript kalimba to about -100 dB). Check on the phone that
  Diagnostics reads `engine: rust  late: 0  fallback: 0` while a grove
  loop plays, and that the kalimba is there. If Diagnostics says
  `rust (failed: ...)`, the phone's browser cannot run the module (it
  needs Safari 15 or later) and everything played in JavaScript.
- #127, the Rust core's second step: fiddle and pad (item 22, v68),
  https://767f07a1-driftloom.kruu-mikey-thaiculture.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust` the fiddle and the
  pad come out of Rust as well as the kalimba (they null against the
  JavaScript voices to about -105 and -117 dB). Play a tide loop (the
  fiddle) and one with the pad, and check that Diagnostics reads
  `engine: rust  late: 0`. `fallback` may read 1 or 2 just after a fresh
  load: the first chord played in JavaScript while the core was still
  arriving. If Diagnostics says `rust (failed: ...)`, the phone's browser
  cannot run the module (it needs Safari 15 or later).
- #133, the Rust core's third step: the FM voices, sine and tubular (item 23, v69),
  https://23327644-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust`, keys, bell, celeste,
  music box, Rhodes, marimba, harp, piano, sine and the tubular bell (and
  prepared piano's two strikes; its knock is still JavaScript) come out of
  Rust; they null against the JavaScript voices to between -88 and -121 dB.
  Play a loop with keys or a bell and one with tubular bells, and check
  Diagnostics reads `engine: rust  late: 0`; `fallback` still counts bass,
  texture and drum notes, which move in later items.
- #134, the Rust core's fourth step: the wave-table voices (item 24, v70),
  https://20650621-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust`, softpad, analogpad,
  analoglead, the saw pluck, the square beep, the moog and the whistle come
  out of Rust, on five new wave tables (they null against the JavaScript
  voices between -106 and -119 dB). Play a loop with a lead (the whistle's
  slides are the thing to listen for) and one with a pad, and check
  Diagnostics reads `engine: rust  late: 0`. The core's memory is now about
  7 MB, up from 4.
- #136, the Rust core's fifth step: accordion and nylon (item 25, v71),
  https://58895670-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust` the accordion and the
  nylon guitar come out of Rust, through their bodies (accordion -115 to
  -117 dB, nylon about -100 dB against the JavaScript voices). Play a loop
  with the accordion (glade, tide) and one with strummed nylon chords
  (cinder, wayfare): each strum should still stop the last chord's strings.
  Also in it: the measure harness no longer runs out of memory on
  `--engine rust`. Core memory about 9 MB.
- #137, the Rust core's sixth step: bandpass, highpass and the noise
  source (item 26, v72),
  https://b2222e78-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust` the stab, ocarina,
  flute, pan flute, prepared piano's knock and temple bell come out of Rust,
  breath and strikes included (-99 to -126 dB against the JavaScript
  voices). Play a loop with an ocarina or flute and one with temple bells,
  and check Diagnostics reads `engine: rust  late: 0`; `fallback` now counts
  only bass, texture, drum and sung notes. Core memory about 11 MB.
- #139, the one-frame click (item 26b, v73),
  https://64580854-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing to listen for but the absence of rare ticks. A noise voice
  started a hair after a whole frame (about 1.4% of noise starts, and one
  loop in four had one) let one loud sample through; it is gone in both
  engines (`measure.mjs --clicks`: 26 voices clicked, none do now). Hats,
  snares, claps, the bells and the breath voices are where it was. Nothing
  else changes, apart from the tick.
- #140, the Rust core's seventh step, first half: bass and textures (item 27a,
  v74), https://0f217058-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust` the bass voices (sub,
  round, fifths, pluck, moog; the Rhodes bass through the FM voice) and the
  swell, drop, wind and waves textures come out of Rust (-94 to -147 dB
  against the JavaScript voices), and the core now serves all five channels.
  Play a loop with a bass line and one with the wind or the sea (tide's waves)
  and check Diagnostics reads `engine: rust  late: 0  fallback: 0`. Drum
  notes still play in JavaScript until the next step. Also in it: a core bug
  at frame-exact note starts (a loop at 11.3 s, 44.1 kHz nulled at -38 dB)
  fixed for every voice. Core memory 10.4 MB.
- #141, the Rust core's seventh step, second half: the drums (item 27b, v75),
  https://d282b713-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust` every drum comes out of
  Rust (kick, soft kick, snare, clap, hats, shaker, rim, and tide's frame,
  tap and jingle; -117 to -148 dB against the JavaScript drums), so the core
  plays all five channels. Play tide's hand kit and a house or wayfare loop,
  and check Diagnostics reads `engine: rust  late: 0  fallback: 0`. On the
  drum loops measured (`perf.mjs --ab`) the audio thread runs 4-5% busier,
  the main thread 9-13% lighter, and no Web Audio nodes are made at all (110
  a second before); no late ticks or device fill-ins either way. Only the
  sung voices still play in JavaScript. Core memory 10.4 MB.
- #143, three small fixes before the sung voices (item 27c, v76),
  https://e6fb9fa3-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing to listen for. With `?engine=rust`, a note that starts or stops a
  hair past a whole sample (one time in about two thousand) now plays
  exactly as JavaScript plays it; before, the core could play its breath or
  noise a sample late for the whole note (the pan flute's -68.5 dBFS in the
  brain's check; snares and hats too, when they landed there). Also: the
  first-value fix from 26b no longer uses the `value` setter, which a
  browser could apply after a late note's envelope (Chromium doesn't), and
  a jingle the core can't take no longer draws its zils twice.
- #144, the Rust core's eighth and last step: the sung voices (item 28, v77),
  https://d03e5106-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust` the vowel, the hum and
  the choir come out of Rust (-96 to -99 dB against the JavaScript voices,
  6-second notes with a drifting vowel included), so every voice does now.
  Play a `hollow` loop and check Diagnostics reads `engine: rust  late: 0
  fallback: 0`; listen for the scoop into each note, the vowel opening on
  long ones, and the breath at the start. Core memory 12.4 MB.
- #147, the Rust core's ninth step: the mix (item 29, v78),
  https://8b136266-driftloom.nowmichaelclark.workers.dev/?engine=rust:
  nothing should sound different. With `?engine=rust` the core mixes: the
  channel gains and mutes, the reverb and echo sends, the kick's duck, the
  echo, the reverb's combs and pre-delay, and the tails' fades, into the
  master chain at `preBus` (a mix-stage null at -143 to -175 dB; whole
  loops at the JS-against-JS floor). Play a roomy loop (haven, tide),
  re-roll a few times, mute and unmute a layer, and check Diagnostics reads
  `engine: rust  late: 0  fallback: 0`. Core memory 14.4 MB.
