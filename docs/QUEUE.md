# The queue

Written by the brain for Claude Code, so building can carry on while Mikey
has no time to listen (2026-09-25). Work top to bottom. Mikey's ears come
later, in one combined review album the brain builds from the Done list.

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
  catalogue median (`measure.mjs --profile <id>`).
- **Refusals** on full and lite for the loops the item touches: melody at
  full quality stays near zero, and lite no worse than the catalogue.
- **The balance lock:** run `stats.mjs --check`. If a locked figure moves,
  report which and by how much, re-baseline at `--n 10000`, and say so.
- **Existing loops:** say exactly what changes for specs that already
  exist. Anything not named in the item must render identically.
- **Tests** three times.
- **Taste:** where the item leaves a musical choice open, take the more
  conservative option and write it down in the PR, marked "for Mikey's
  ears". Never guess silently.
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

The travelling music: steady, bright, moving.

- Mostly 4/4 (about 104-138 bpm), some 6/8. A **chug**: a steady
  eighth-note pulse in the bass (and brushes) under the tune, like wheels
  on rails; a new bass style, drawn only by profiles that ask for it.
- Scales: mixolydian, ionian, dorian, lydian, majorPent.
- Progressions: I-bVII-IV-I and I-IV-V-IV, filtered per mode.
- Melody: pan flute leading, then fiddle, whistle, ocarina. Chords:
  accordion, nylon, harp. Drums in about 85% of loops: brush, tape, hand.
- `level` solved by measurement; appended to the end of `PROFILE_IDS`.

## Merge policy

Mikey decides this line:

- (yes, from Mikey) When CI is green and every check above passes, Claude
  Code merges its own PR and starts the next item.

## Notes from Claude Code

(none yet)

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
  profile for travelling -- a walking 4/4, pan flute and fiddle over
  accordion, nylon and harp, and in half its loops a chug, a short bass
  note on every eighth with the brushes swishing along. Listen for wheels
  on rails rather than a machine gun, and whether I-IV-v-IV's minor v in
  mixolydian and dorian should go.
