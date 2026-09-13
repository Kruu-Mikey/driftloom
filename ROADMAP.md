# Roadmap

Things deliberately deferred, with enough reasoning attached that picking one
up later does not mean rediscovering why it matters.

## Sound

**An articulation layer.** The highest-leverage item here. Every voice
currently attacks identically and plays every note of its motif. Real playing
does neither: notes get left out mid-phrase, some attacks slide in, velocity
follows phrase position, a breath lands before an entry. Building this once
improves all eighteen existing voices at the same time and makes every future
one land better. More valuable than making any individual oscillator more
realistic.

**A choir as one voice, not many.** GPT's sketch was three to five virtual
singers per note. On a four-note chord that is twenty voices for one layer,
and on a phone notes would start dropping. If this is built, it has to be a
single voice with internal detuning and per-partial timing offsets. The
`choir` voice already works this way; the idea is to push it further rather
than to stack real voices.

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
