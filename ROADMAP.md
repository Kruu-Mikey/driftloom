# Roadmap

Things deliberately deferred, with enough reasoning attached that picking one
up later does not mean rediscovering why it matters.

## Working on this

Run `node test/generator.test.mjs` before and after any change; it checks
5000 seeds for out-of-range notes, confirms re-rolling a layer leaves the
others byte-identical, and parses 500 exported MIDI files. It uses random
seeds, so run it a few times.

Four invariants worth knowing before changing anything:

1. **New voices go in new profiles, never into existing pools.** Voices are
   drawn at render time from the blended pool, so one added entry shifts that
   draw and every random decision after it, and every share code in
   circulation renders as different music.
2. **`PROFILE_IDS`, `SCALE_IDS` and `MOOD_IDS` in `share.js` are append-only**
   for the same reason. Reordering them silently rewrites codes already
   written down.
3. **Generation is quantised to a 1/255 grid** (`q8` in `generator.js`) so
   share codes are lossless by construction. Weights feed weighted random
   picks, and a rounding difference of 0.004 is enough to select a different
   scale.
4. **Measure, do not assume.** Nearly every real bug in this project was
   found by rendering audio offline and measuring it, and several confident
   fixes made things worse until re-measured. The harnesses used are not
   committed, but they are all the same shape: render through
   `OfflineAudioContext`, then check peak, RMS, tonal range, or the amplitude
   at the moment a node stops.

## Sound

**An articulation layer.** The highest-leverage item here. Every voice
currently attacks identically and plays every note of its motif. Real playing
does neither: notes get left out mid-phrase, some attacks slide in, velocity
follows phrase position, a breath lands before an entry. Building this once
improves all eighteen existing voices at the same time and makes every future
one land better. More valuable than making any individual oscillator more
realistic.

**A choir as one voice, not many.** Done. Three singers share a single
formant chain, since the filters are the expensive part and extra
oscillators into the same chain cost little. Each singer has its own detune,
its own vibrato rate and its own jitter, which is what makes a group read as
a group rather than as one voice through a chorus pedal. Cost is 34 units
against a single vowel's 22, not triple.

**A more human whistle.** Agreed as worth doing and never started, so it is
recorded here rather than lost. The existing `whistle` shares its
implementation with `moog` -- a triangle through a resonant filter with
vibrato -- and it sounds synthetic in a way that does not suit it. The target
is someone quietly whistling outside, not a cartoon whistle: slight pitch
instability, vibrato that varies between notes rather than being identical
every time, a soft breath component, imperfect attacks, occasional slides
between notes, and notes left out. Most of that is the articulation layer
above, which is the argument for doing that first and then revisiting this.
It should stay slightly synthetic; fully realistic would suit it worse.

**More of the bell family.** Deprioritised on purpose: there are already six
bell-adjacent voices (bell, bells, chime, musicbox, celeste, harp) and the
distinctions between adding tubular, handbell and templebell are thinner than
the distinctions already in place.

**Vowel movement within a note.** Right now a vowel is chosen per note and
held. Moving between vowels across a sustained note ("ah" opening into "oh")
is the difference between a formant filter and something that sounds sung.

## Cover art

Still occasionally amateurish and rough. Noted as likeable in its own way, so
this is about raising the floor rather than changing the character. The known
weak spots are the sparser compositions, where the ground gradient carries
too much of the frame.

## Voice budget

Migrated from a flat voice count to cost units, since a hi-hat and a
three-oscillator analogue pad plainly do not cost the same. Two things remain:

- Eight call sites still fall back to `DEFAULT_COST` rather than declaring a
  measured weight. Functional, just imprecise: ocarina, flute, moog, whistle,
  sine, stab, choir, and the texture swell/drop/wind cases.
- **The absolute budget figures are not measured on real hardware.** The
  relative costs between voices come from render-time measurements and should
  hold anywhere, since they follow node counts rather than clock speed. The
  totals (260/170/140) are reasoned, not observed. If a phone drops notes,
  this is the first number to revisit, and Diagnostics reports `lateTicks`
  for exactly that purpose.

## Interface

Everything lives on one screen, which is wanted for now. Worth revisiting
once the feature set stops moving. Known gaps: no reordering of tracks within
an album, no way to duplicate a loop before editing it, and the saved list
grows without any grouping or search.

## Sharing

Album codes run roughly 110 characters per loop, so a twelve-track album is
about 1300 characters. Fine to copy and paste, unwieldy to send in a message.
Compression via `CompressionStream` would help, but album payloads are mostly
high-entropy seeds, so the gain is probably modest -- worth measuring before
building.

## A standing constraint

New voices go into **new profiles**, not into existing pools. Voices are drawn
at render time from the blended pool, so adding one entry to an existing pool
shifts that weighted draw and every random decision after it: every share code
already in circulation would quietly render as different music. `grove` and
`hollow` were added this way, and 2000 old-profile-only codes were verified to
decode identically afterwards. `PROFILE_IDS` in `share.js` is append-only for
the same reason.
