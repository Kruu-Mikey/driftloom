# Roadmap

Open work, ordered. Everything here has a size and a test that would prove it
done. Decisions already made are at the bottom so they stop being reopened.

Sizes: **S** under an hour, **M** a session, **L** more than a session.

---

## 1. Commit the measurement harnesses — **S** — *shipped, both halves*

Four items below say "measure first" and the tools to do it were not in the
repo. They had been written inline in throwaway scripts against a local
server and never cleaned up, which is the only reason they were missing;
they were not low quality, they were the things that found the envelope
clicks, the saturator, the voice-budget miscount and the melody bug. Both
now live here.

**`tools/stats.mjs` — generation.** Draws a corpus through `newSpec()` and
`render()` and reports profile, metre, voice and rhythmic-cell distributions,
melodic span, note count, duration, velocity and the share of melody notes
landing off the beat, either overall or bucketed by `feel.lift`. It is what found the vestigial ternary
that had kept every melody note in the app's history on an even step.

**`tools/measure.mjs` — audio.** Drives the real `Engine` and `Synth` against
an `OfflineAudioContext` in headless Chromium and reports per-loop peak, RMS
and full-scale sample count, corpus peak and RMS spread, crest factor, and
the dry level of each layer tapped at its channel gain, so the balance
between layers is measured rather than read off the gain table. Web Audio
does not exist in Node and a reimplementation of the graph would only
measure the reimplementation, so the tool needs Playwright and a Chromium
build; that is a dependency of the tool, not of the app.

It is what established that the peak range the README used to claim was
never true, and what item 11 is waiting on.

**Not built:** the per-voice probe the original acceptance line described
(`--voice templebell` printing ring time and cut-off dB). Nothing has needed
it yet. It is a small addition to the same harness whenever something does.

## 2. Articulation, v1: dropped notes and velocity by phrase position — **M**

The biggest single improvement available, and it improves every pitched voice
at once. It is four features and shipping all four at once is why it has
stalled twice.

**v1 is exactly two things:** notes omitted mid-phrase at a rate that follows
energy, and velocity shaped by position within the phrase (stronger on the
first and last note of a phrase, weaker in the middle). Slid attacks and
breath-before-entry are v2 and v3 and are explicitly out of scope.

**Done when** velocity variance within a phrase is at least 3x what it is
today, and two loops from the same seed with different energy differ in note
count by at least 25%.

## 3. Melodic range — **M**

Melodies average 9.6 semitones. **Target: 14, roughly an octave and a half**,
which is an ordinary range for a tune and clearly wider than now.

Widening the contour arc changed the figure by nothing at all, so the arc is
not the constraint and the cause is unknown. Three suspects, in order:
`nearestChordTone` pulling phrase edges inward, the degree random walk rarely
approaching its own -5..10 limits, and the octave wrapping folding wide leaps
back into the window.

**Done when** the average is 14 semitones or more and distinct-shapes-per-bar
stays above 0.9, so range is not bought with repetition.

## 4. Keys and melody register — **S**

Both layers currently land in the same narrow band by accident. The decision,
not a coin flip:

- **Same drawn voice → force unison register.** This is the case that already
  sounds good by luck and should be deliberate.
- **Different voices → force a minimum separation** of 5 semitones between
  layer centroids, moving keys down rather than melody up.

**Done when** no loop has two different pitched voices whose centroids are
within 5 semitones, and same-voice loops sit within 2.

## 5. Real-hardware budget calibration — **S**

Nothing is stopping this except that it needs a phone, and the phone is not
mine. The totals (260 / 170 / 140) are reasoned, not measured. Diagnostics
already reports `lateTicks` and `worstLateMs`.

**Done when** a twenty-minute run on the target phone, on the densest profile
mix available, reports zero late ticks — or the totals are lowered until it
does, and the number that worked is written down here.

## 6. Cover art floor — **M**

"Occasionally amateurish" is not testable. The specific failure is the sparse
compositions (`drift`, `orb`, `aperture`) where the gradient ground carries
most of the frame and the result reads as a background rather than a picture.

**Done when** no cover in a 100-cover contact sheet has more than 70% of its
pixels within one palette stop of the ground colour.

## 7. Interface: three standalone tickets — **S each**

The old "revisit when the feature set stops moving" had no trigger, which
meant never. These stand on their own:

- **7a.** Reorder tracks within an album.
- **7b.** Duplicate a loop before editing, so a saved version survives.
- **7c.** Search or filter the saved list once it passes ~30 entries.

**Done when** each works from the album or saved panel without a page reload.

## 8. Album code length — **S to decide, M to build**

The real complaint is not size, it is that a 1300-character code is not
tappable the way a link is. Compression does not fix that; it makes an
untappable thing slightly shorter.

**Decide first:** if the goal is tappability, the answer is a file export or a
QR code, not deflate. **Ship compression only if it clears 35%** — below that
it adds an async path and a fallback for no felt benefit. Album payloads are
mostly high-entropy seeds, so measure before building.

**Done when** either a measurement below 35% is recorded here and the item is
closed, or codes are 35%+ shorter with a working no-compression fallback.

## 9. Articulation v2 and v3 — **M each**

Only after item 2 ships. v2: slid attacks into some notes. v3: breath before
phrase entries. Most of what makes a whistle sound human is articulation, so
these subsume the old "human whistle" item rather than sitting beside it.

## 10. Vowel movement within a note — **M**

Vowels are chosen per phrase and shared across a chord. The remaining step is
movement *within* a long note -- "ah" opening into "oh" across a sustained bar
-- which is the difference between a formant filter and something sung.

## 11. Loudness spread across the catalogue — **deferred, question first**

Measured with `tools/measure.mjs` over thirty loops: peak level runs from
about 0.17 to about 0.85, roughly 14 dB, with nothing normalising it. A
quiet loop is quiet because its profile is quiet -- the sparse, airy
palettes land at the bottom of that range and the busy ones at the top --
and the master chain deliberately does not pull them together.

**This is not filed as a fault.** Quiet tracks are wanted, and so is
dynamic range across the catalogue; a loop machine whose every loop arrives
at the same level has had something taken away from it. Normalisation is
not the obvious answer and is not being proposed here.

The open question is narrower: **is the spread wider than intended when you
listen to twenty in a row?** Reaching for the volume control between tracks
is a different experience from noticing that one piece is hushed, and 14 dB
of peak is a lot if the quiet ones are also quiet in the middle rather than
merely less peaky.

**What would settle it:** report RMS spread alongside peak spread from
`tools/measure.mjs` -- it already prints both -- and compare them. If RMS
spread is much narrower than peak spread, the quiet loops are simply less
peaky and the perceived range is smaller than the figure suggests, and this
closes. If the two track each other, the catalogue really does span 14 dB of
loudness and the question becomes a real one worth answering.

**First reading, thirty loops:** peak spread 13.4 dB, RMS spread 13.2 dB.
They track almost exactly, so the quiet loops are quiet in the middle and
not merely less peaky, and the perceived range is about what the peak
figure says. That points at the question being a real one rather than an
artefact of crest factor -- but one corpus of thirty is a reading, not a
verdict, and what it cannot say is whether 13 dB is wider than *wanted*.
That part is a judgement about listening, not a measurement.

No implementation until someone has sat through twenty in a row and said.

---

## Decided against

**More of the FM bell family.** There were already five FM bell voices (bell,
chime, musicbox, celeste, harp) differing mainly in ratio and decay, and a
sixth would have been a sixth setting of the same instrument.

This was wrongly used to defer temple and church bells too, which are a
different object rather than another setting: struck metal is inharmonic, and
a bowl's character is *beating* between partials a few cents apart, which a
single FM voice cannot produce however inharmonic its ratio. `templebell` and
`tubular` now exist in the `shrine` profile.

**Vocaloid-style sung words.** Words would make a loop be *about* something,
which fights the use case. A wordless voice also never sounds dated or
foreign; a synthesised word always does.

**Speech-synthesis dependencies** (Klattsch, Pink Trombone, Qlatt). They
optimise for intelligibility, which is the opposite of the goal, and each
brings a build step or a worklet, breaking "works offline from a folder".

---

## Contribution rules

Not roadmap items; the things that are not obvious from reading the code.

Run `node test/generator.test.mjs` before and after any change, a few times,
since it uses random seeds. For anything that touches generation, also run
`node tools/stats.mjs` before and after and compare the two: the tests prove
nothing is broken, the statistics say whether the change did what it claimed.

1. **New voices go in new profiles, never into existing pools.** Voices are
   drawn at render time from the blended pool, so one added entry shifts that
   draw and every random decision after it, and every share code in
   circulation renders as different music. `grove`, `hollow` and `shrine`
   were all added this way.
2. **`PROFILE_IDS`, `SCALE_IDS` and `MOOD_IDS` in `share.js` are append-only.**
   Reordering them silently rewrites codes already written down.
3. **Generation is quantised to a 1/255 grid** (`q8` in `generator.js`) so
   share codes are lossless. Weights feed weighted random picks and a
   rounding difference of 0.004 selects a different scale.
4. **A declared cost that is not passed is worse than no cost.** `VOICE_COST`
   only applies where the call site passes it; several weights sat declared
   and ignored for a while, charging the default instead.
