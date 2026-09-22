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

## 2. Articulation, v1: velocity by phrase position — **S** — *shipped*

Four features, and shipping all four at once is why this stalled twice.
Splitting it is what moved it. v1 was two things and they landed apart.

**The omission half shipped in #7**, though not where this item expected it.
Notes omitted mid-phrase at a rate that follows energy now happens *in the
motif*: which notes the figure leaves out is decided once, when the figure is
built, so every restatement is missing the same notes. Rolling it per bar had
been quietly undoing the motif -- dropping a note does not merely remove it,
it fuses the two intervals either side into a third that was never in the
figure -- and bars sharing the commonest rhythm ran at 0.55 because of it.
Deciding it once took that to 0.85. Density still follows energy: 2.5 notes a
bar in the low-lift bucket against 3.8 in the high, a 50% difference.

**The velocity half is this change.** Stronger on the first and last note of a
phrase, weaker through the middle, with the depth following energy so a
hushed loop arrives even and a quickened one breathes. The rhythmic cells'
own note-level accent stays underneath it: the accent says which note of the
figure is leaned on, the phrase arc says where in the phrase the leaning
happens. Slid attacks and breath-before-entry remain v2 and v3 and are still
out of scope.

**The old criterion was "velocity variance within a phrase at least 3x what
it is today", and it stopped meaning anything.** It was written when the
melody had almost no velocity variation at all. The rhythmic cells then
added a per-note accent, and within-bar velocity now measures sd 0.0906 over
9,126 bars, mean 0.533, across 478 distinct values. Tripling *that* is a
recipe for jitter, not for phrasing. Variance cannot tell the two apart:
phrasing is the part of the variation that is **systematic**, the same shape
every phrase, and a spread figure counts the random part just as happily.

**Done when** the notes at a phrase's edges average at least **0.10 of
velocity above the notes in its middle**, measured across the corpus by
`tools/stats.mjs` as "edges above middle", **and** that gap is at least
**1.4x** larger in the high-lift bucket than in the low one.

The two numbers, and why those:

- **0.10** has to be audible and has to be unmistakably deliberate. Mean
  velocity is 0.533, so a gap of 0.10 is a ratio of about 1.21 between the
  edges of a phrase and its middle -- roughly 1.7 dB, which reads as
  intentional dynamics where anything under about 1 dB reads as nothing. It
  also has to clear what the cells produce by accident: most cells accent
  their own first note and a phrase begins on one, which was already worth
  0.044 before any of this. Double that accident is a figure no amount of
  luck reaches.
- **1.4x** is the shaping following the feeling rather than being applied
  flat. Before this change the gap was 0.041 in the low bucket against 0.045
  in the high -- a ratio of 1.1, which is to say none. The threshold sits
  below what the change actually achieves (1.52 to 1.62 across five corpus
  seeds) by enough that an ordinary corpus cannot fail it.

Measured on 4000 loops: edges 0.641 against 0.509 mid, a gap of **0.133**,
and **1.62x** between the buckets (0.097 low, 0.157 high). The within-phrase
range roughly doubles, 0.223 to 0.360, but that is a consequence rather than
the test.

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

## 4. Keys and melody register — **S** — *shipped*

Both layers currently land in the same narrow band by accident. The decision,
not a coin flip:

**Different voices → force a minimum separation** of 5 semitones between
layer centroids, moving keys down rather than melody up.

**Done when** no loop has two different pitched voices whose centroids are
within 5 semitones.

**Shipped.** `separateRegisters()` runs in `render()` once both layers exist
and moves the chord *events* by whole octaves; the slots the bass and melody
read their notes from are untouched, so the harmony is unchanged and only
its voicing moves. Measured over 4000 loops: different-voice loops inside
five semitones went from 99.4% to **0%**, and the mean centroid gap from 1.4
to 9.8 semitones.

This item originally carried a second clause: when both layers drew the
same voice, force them into unison, measured as 81% of such loops sitting
within 2 semitones. **That clause has been removed, and the 81% should not
be chased.** It was measuring an artefact. The old per-note octave fold
crushed the melody into a near-fixed band that happened to sit a roughly
constant distance from the keys, and the alignment was a side effect of
that crushing rather than of anything this item did. Item 9's anchor work
gave the line real register freedom, the accident went with it, and the
figure fell to 42%. Restoring it would mean undoing that work. Same-voice
loops still sit within six semitones, which is one register by any reading,
and that is all this item ever needed from them.

What the clause was reaching for is a different thing entirely, and it is
now item 12.

## 5. Real-hardware budget calibration — **S**

Nothing is stopping this except that it needs a phone, and the phone is not
mine. The totals (260 / 170 / 140) are reasoned, not measured. Diagnostics
already reports `lateTicks` and `worstLateMs`.

**Done when** a twenty-minute run on the target phone, on the densest profile
mix available, reports zero late ticks — or the totals are lowered until it
does, and the number that worked is written down here.

**This got more urgent, not less.** A melody-starvation bug (fixed in v33)
turned out to be the budget refusing the tune on 28.6% of loops, and part
of the cause was a weight that was simply wrong: `keys` was priced at 25,
the same as a piano, when it is *half* of a piano -- one FM voice against
two. If one weight was that far out, others may be. The tool to check is
now in the repo: `node tools/measure.mjs --voice` for tone and the
marginal-render-time method for cost, both documented in the README.

The same fix also found that `SOFT_BUDGET` did nothing on lite, because
`Math.min(170, 140)` is 140. So two of the three numbers in this item's
title were not doing what the title claims, and neither failure was
visible from reading them. **Calibrating the totals on real hardware is
worth less than it looks until the weights they are spent on are checked**,
and this item should probably be done in that order: weights first, then
totals.

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

Only after item 2 ships. Most of what makes a whistle sound human is
articulation, so these subsume the old "human whistle" item rather than
sitting beside it. They had one shared done-when between them, which is
no use to either; they have their own now.

### v2, slid attacks — *shipped*

The wind voices -- `ocarina`, `flute`, `whistle` -- had vibrato and breath
and still did not sound played, because nothing ever arrived at a pitch.
Every note simply began on one. A player reaches the note.

**Where it lives** is the split vowel drift established. Which notes get a
slide is articulation, decided in `_slide` with `Math.random` beside the
scoop, the jitter and the vibrato. Where the line came from is not
something the synth can know -- it sees one note at a time -- so the
composer writes it down: `annotatePrev` walks the finished melody and
records the previous sounding pitch on each event. That pass is derived and
draws nothing, so `tools/stats.mjs` is byte-identical at four corpus seeds
and 4,000 codes written on `main` decode and render the same music on both
trees, re-encoding to the same string.

**The shape.** From the previous note when the two are joined -- within
120ms, which over the corpus is 63.4% of notes -- and no wider than a
fourth, because a glide across a big leap is a siren. Anything else takes a
scoop from a tone and a half below, which is what a player reaching a note
after a breath actually does. The reach is `dur * 0.22` clamped to
30-90ms, so it lands well inside the first quarter of the note, and notes
under 180ms -- the shortest quarter of the corpus -- do not slide at all.

**The rate is 0.22 of eligible notes, which measures 18.1% of wind melody
notes overall**: 9.8% from the previous note, 8.3% scooped. About one note
in five and a half, which is a player leaning into some of them rather than
an effect applied to the line. It holds across the three voices, 16.8% to
19.1%.

**It is not tied to lift or energy, and does not need to be.** The material
already carries that relationship: a driven loop has shorter notes and
fewer joined pairs, so the share of its notes a slide can touch falls from
96.8% at low energy to 67.5% at high, and 88.2% to 71.2% across lift.
Consulting the feeling as well would count the same thing twice.

**Cost: nothing.** It is parameter automation on an oscillator that already
exists, lasting 30-90ms. With *every* eligible note sliding -- an upper
bound the 0.22 rate never approaches -- marginal render time moves -3.2%,
+2.0% and +0.6% for the three voices, which is noise either side of zero.
`VOICE_COST` is unchanged.

**Found by ear** with `node tools/stats.mjs --voice-codes ocarina`, which
exists because the three wind voices are 12.4% of melody draws between them
and any single one is nearer 4%.

**Done when** a slide lands on 15-25% of wind melody notes, no slide
crosses more than a fourth, every slide is on pitch before the note's
quarter point, `stats.mjs` is byte-identical and existing codes render
unchanged. All five hold.

### v3, breath before phrase entries — **not started**

A wind player inhales before a phrase, and the sound of that breath before
the first note is a large part of why a recording sounds like a person in a
room. The voices already have continuous breath noise *under* the note;
this is a separate, louder, unpitched event placed *before* an entry.

`annotatePrev` is half of what this needs already: a phrase entry is
exactly a note with no `prev`, which is the same test the scoop uses. What
it additionally needs is somewhere to put the breath, and that is the
problem -- it has to sound *before* the note, so either the engine
schedules it early (the note's own start time minus the breath length,
which can fall in the past at the top of a loop) or the composer leaves
room for it.

**Done when** a phrase-initial wind note is preceded by an audible breath
in 40-70% of entries, the breath never delays or clips the note it
precedes, and no breath is scheduled at a negative time. The last of those
is the one that will bite.

## 10. Vowel movement within a note — **M** — *shipped*

Vowels are chosen per phrase and shared across a chord. The remaining step was
movement *within* a long note -- "ah" opening into "oh" across a sustained bar
-- which is the difference between a formant filter and something sung.

**Shipped in the synth, not the composer**, and that is the whole of why it
was cheap. Contribution rule 1 is about voices, but its reason is general:
anything drawn from the composer's stream renumbers every decision after it,
and every share code in circulation renders as different music. A vowel's
*destination* is not a compositional decision in any case -- it is
articulation, the same category as the scoop, the jitter and the vibrato,
which have always been per-note and drawn from `Math.random`. It is also the
only place that can answer the question: the composer knows a note's length
in steps, and whether a vowel has time to travel is a question about seconds.

The move is one rung along the open/close axis and never across it -- a to
o or e, o to u or a, u to o, e to a. F1 is the openness formant (a 800,
o 450, e 400, u 325), so neighbouring rungs glide and the ear hears one
vowel changing shape. A jump across the ladder ("eh" straight into "oo") is
two vowels in succession, which is a word, and words are in *Decided
against*. A hum has no vowel to go to and opens instead: the same closed
tract relaxing.

**Length decides both halves.** `held` is how far a note is into "long" --
zero below 0.5s, one from 2.0s up -- and it is both the probability of
moving at all and, through `0.34 + held * 0.66`, how far along the way the
note actually gets. Over 4000 loops, 26.4% of formant-voice notes move, at a
mean depth of 0.81; the 41% of them under 0.55s never move at all. That is
the "short notes stay put" clause, measured rather than asserted.

**The filters move; there is no second bank.** Crossfading into a second set
of peaking filters is the obvious build and it is wrong: two banks summed
have different phase responses, so the sum combs and it sounds like a
flanger rather than a mouth. Sliding the resonances themselves means every
instant in between is a real vowel shape, and it adds no nodes at all.

**Cost: 5 units on top of the voice**, against 22 for `vowel`, 16 for `hum`
and 34 for `choir`, and it is passed rather than merely declared, which is
contribution rule 4. Measured the same way the rest of the table was: the
marginal render time of a note through the real `Synth` in an
`OfflineAudioContext`, one build with the decision pinned off against the
same build with it pinned on. Movement runs 27-29% of a vowel, 19-23% of a
hum and 13-16% of a choir, which through each voice's own weight is 4.7 and
5.0 units on two clean passes. One constant rather than three, because the
extra is not nodes -- none are added -- but the same three biquads
recomputing coefficients while a parameter is in motion, which is the same
work in every case. The README has the caveats on the conversion.

**Done, and how it was checked.** One 3.0s "a" pinned to drift to "o",
rendered dry and band-integrated early (22% in) and late (90% in): the two
builds are identical in the early window to a tenth of a dB, and in the late
one the moving build puts 8.2 dB more into 350-600Hz (o's F1) and
11.8 dB less into 1000-1400Hz (a's F2). The note starts on the vowel it
was given and arrives somewhere else. `tools/stats.mjs` over 4000 loops is
byte-identical before and after, which is the other half of the claim: no
draw moved.

## 11. Loudness spread across the catalogue — **closed, the spread is wanted; reopened narrower as 13**

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

**Somebody has now sat through twenty in a row, and the answer is that the
spread is intended.** Quiet tracks are wanted and so is dynamic range
across the catalogue; a loop machine whose every loop arrives at the same
level has had something taken away from it. Reaching for the volume
control between two tracks is the cost of that, and it is worth paying.

**So: no normalisation, and nothing to build.** Not a limiter across the
master, not a loudness target, not a per-loop trim written into the spec.
The 13 dB stands. If this is ever reopened it should be reopened as a
different question -- something about the *order* loops arrive in, which is
a sequencing problem and not a gain one -- rather than as this one.

The measurement stays in `tools/measure.mjs` because it is worth knowing
when the figure moves. A future change that quietly narrowed the spread to
4 dB would be a regression, and this is the item that says so.

**Reopened, narrower, as item 13** (2026-09-22). The spread stays wanted.
Reaching for the volume every other track does not: the aim is loops that
are dynamic but sensible, still with no limiter, compressor or
normalisation doing the work.

## 12. An occasional choir — **M** — *shipped*

Melody and keys currently draw the same voice in **11.1% of loops**, purely
because the two pools sometimes collide. Nothing makes those loops sound
like anything in particular; they are just loops where the register
separation had nothing to do. One in nine is also far too often for
something that is supposed to feel like an event.

The intent is the opposite of an accident: a doubling drawn **on purpose,
rarely**, and arranged so that it lands. Three parts, all of which have to
be true at once or it is just two layers playing the same thing:

- **Drawn deliberately, at roughly 1 loop in 30.** Not a consequence of the
  two pools matching -- an explicit draw that then sets both voices.
- **A voice that rewards doubling.** The sung and struck families are the
  candidates; a pad doubling a pad is inaudible as an effect.
- **The arrangement thins around it.** Doubling is only audible if something
  gets out of the way. Whatever else is competing in that register steps
  back for the duration.

**Done when** the deliberate case fires in 3 ± 1% of loops, the incidental
collision no longer forces unison on its own, and a listener who did not
know the feature existed can pick the choir loops out of twenty by ear.
That last part is the real test and it is not a number `stats.mjs` can
produce.

**Shipped, with the last clause still open** -- see the bottom of this item.

**The draw.** `choirOf(spec)` hangs a stream off the loop seed with its own
salt, the same pattern `feelForLayer`, `genGaps` and `genForm` use. It
therefore takes nothing from any layer's stream, which is what makes the
next paragraph possible, and it survives a per-layer re-roll because
`rerollLayer` replaces a layer seed and never the loop seed. It needed no
share-format change either: `writeSpec` has always written `spec.seed`, so
a code written down before this existed already says whether its loop
sings. Measured at **3.06%** over 400,000 draws; 2.9-3.3% on 4,000-loop
corpora.

**Nothing else moved.** A choir loop *relabels* the voice its draw
produced rather than replacing the draw, so every `r.` call in `genHarmony`
and `genMelody` still happens in the same order with the same results. A
choir loop is the loop that seed always made, sung. Checked against a
worktree of `main` over 4,000 loops at each of six corpus seeds: every loop
that is neither a choir nor one of the collisions below is byte-identical,
0 differences out of ~3,430 per seed.

**The accident is gone.** `separateRegisters`' unison branch read "the keys
drew the voice the melody drew", which fired on 11.1% of loops and forced
unison on pairs nobody had chosen. It now reads "this loop drew a choir".
`genMelody` asked the same question a second time, for its register
anchor, and that one is changed too -- leaving it would have had the melody
aim at the keys while the keys walked away from it. Collisions still
happen at about the same rate and are now simply separated like anything
else; `stats.mjs` prints the count so a silent return to acting on them
would show.

**The sound.** Melody and keys take one sung voice -- `vowel` or `hum`,
weighted 3:2 -- with a standing detune of 4-11 cents in opposite
directions, an ensemble slip of +/-8ms drawn per layer per step, and
starting vowels two rungs apart along `VOWEL_KEYS`. The air layer drops to
0.4 of its level for the loop, which is the only thing left competing in
that register once the keys stop being a pad.

The voice actually named `choir` is not in the pool. It is three detuned
singers per note at a cost of 34, and this loop pays on two layers at once,
one of them a chord: putting it in roughly doubles what the budget refuses,
melody notes from 8.9% to 19.7% and keys from 8.1% to 19.3%. Dropping one
melody note in five on the loops built to show off a doubled melody is the
opposite of the point.

The unison works: choir loops sit **2.66 semitones** apart at the centroid
against 11.75 for everything else, and 100% of them are inside six.

**Two things measured here turned out to contradict the reasoning that
produced them**, and both are worth writing down because the wrong version
is the intuitive one:

- *Two identical voices do not sum to +6dB here.* They measure +3.3dB --
  the incoherent sum -- because each note already draws its own scoop,
  jitter, vibrato rate and breath. The detune is still worth having, since
  a standing lean is a different thing from a zero-mean wobble, but it is
  not what prevents the doubling collapsing into one louder voice. Nothing
  was going to.
- *Thinning the air layer is not a budget lever.* It is charged against the
  same voice budget, so it looked as though stepping it back would buy the
  doubling headroom. Silencing it outright moves melody refusals from 9.1%
  to 8.7%. The depth is a mix decision and was chosen as one.

A third thing went the other way and is worth the same honesty: the
`choir` voice was excluded on reasoning, the exclusion was removed on the
strength of a probe that seemed to show the budget coping, and it was put
back when an independent probe measured the doubling of refusals above.
The first probe was wrong. Reasoning that a measurement appears to
overturn is worth re-measuring before it is thrown away.

**Cost: +2.3 units a note, 14%,** counted over the melody and keys of
12,000 loops with the weights read out of `synth.js`. The worst single
chord attack on a choir loop is 88 units at the 90th percentile against
125 for the catalogue at large, and 110 at the maximum against 170 -- a
choir loop is nowhere near the heaviest thing this app makes. Choir loops
also *refuse fewer* notes overall than ordinary ones, because a sung chord
at 16-22 a note is cheaper than the pad or piano it replaced: keys
refusals fall from 17.5% to 8.1%, against melody refusals rising from 6.8%
to 8.9%.

**The listening test passed.** The acceptance line was a listener picking
the choirs out of twenty by ear, and no amount of the above substitutes
for it. `node tools/stats.mjs --seed 4127 --choir-quiz` produced the
quiz -- twenty share codes shuffled, five of them choirs, answers written
to a file rather than the screen.

**5 of 5 picked, 0 false picks.** Two of the five were not immediate: they
registered a moment after the loop started rather than on the first phrase,
which is about what a rare event should feel like. The other three were
obvious at once. Item 12 is done on its own terms, not merely on its
numbers.

Worth recording that the marker is *audible* and not just statistical: an
effect that only a spectrum reveals is not an event, and this one does not
need the spectrum.

## 13. Level, by ear — **M**

Item 11 in the narrower form it asked to be reopened in. The spread across
the catalogue is still wanted: a hushed loop stays hushed, a busy one stays
bigger, and nothing pulls them to one level. What is no longer accepted is
the cost item 11 wrote off as worth paying -- a listener reaching for the
volume every other track. **Dynamic, but sensible.**

**Not the answer:** a limiter or compressor doing the work, a loudness
target, normalisation. The master already carries a gentle compressor (3:1
above -10 dBFS) and a ceiling at -3 dBFS. Both only touch the loud end;
they stay the backstop they are and are not to be leaned on harder.

**One behaviour for everybody** (decided 2026-09-22). No Room/Car switch, no
range slider, nothing for the user to scroll past. That also rules out the
slow leveler: it is defensible as an opt-in for noisy places and nothing
else, because always on it is the compressor this item exists to avoid.
The reaching goes both ways about equally -- some loops too quiet, some
jumping out -- and all three listening patterns happen: one loop for an
hour, new loops back to back, saved albums in order. Ordering therefore
helps the album case only and cannot be the whole fix.

**The target.** Played back to back the catalogue is one programme, and the
spread between loops is that programme's loudness range. Online and mobile
content generally sits around -16 to -14 LUFS with a loudness range of
6-8 LU; this catalogue measures about 13 dB. The authored profile trims are
4.6 dB and fit inside that band with room to spare, which is the argument of
this whole item: the accidental spread is the entire problem, and removing
it lands the catalogue in the band on its own, with no per-loop mechanism at
all. Two things to establish alongside it -- a house level taken from a loop
Mikey already likes, and whether the loudest loops are riding the master
compressor (-10 dBFS, 3:1), since a loud loop that is also squeezed is
exactly the one that jumps out.

**Why there is something to find.** The per-profile `level` trims in
`characters.js` run from 0.62 to 1.05, about 4.6 dB. That is the spread
somebody chose. Item 11 measured about 13 dB. The rest comes from things
nobody set as a level decision -- density, which voices a loop draws, how
loud each voice is for a given velocity, and bugs like the one #20 fixed,
where every `keys` chord in the app's history played through the melody
bus. The aim is to keep the authored spread and find the accidental one.

**Albums first, fixes second.** Each question gets a listening album,
chosen with `tools/measure.mjs` numbers attached, answered blind in one word
per track with the key in a file. The tracks Mikey flags, matched against
their measurements, say where "sensible" actually sits -- a target from his
ears rather than a number anyone guessed.

- **13a. Keys, after #20.** `dust` loops with `keys` chords against `dust`
  loops with `pad` chords, then the other four profiles that draw `keys`.
  Same profile, different chord voice, so only the voice differs. One word
  for the chords: *buried / fine / forward*. If keys read as buried and pad
  does not, the fix is inside the keys voice, not the channel table.
  `keys` is the main chord voice of `dust`, the commonest profile, so this
  is the change most widely heard.
- **13b. Melody voices.** Does the tune sit in front whichever voice draws
  it? The same melody voice across similar loops, extremes picked by
  `measure.mjs --voice` and the per-layer levels. *lost / fine / loud*.
  After the sawtooth-lead fix, since softening those at the source moves
  their level too.
- **13c. Kinds of loop.** Sparse against busy, low energy against high,
  across profiles. The question is whether a quiet loop reads as a quiet
  *piece* or as a loop that has merely been turned down -- the first is
  the spread working, the second is the accident. *hushed / fine / loud*.
- **13d. Twenty in a row.** A shuffled run at the catalogue's natural
  spread, straight through at one volume. Mikey marks every track where he
  would have reached for the volume, and which way. The measured loudness
  of those tracks, and the jump from the track before, turns "too much
  spread" into a number.

**Tooling.** `measure.mjs` reports peak and RMS. It wants a perceived
loudness figure as well -- K-weighted, as in ITU-R BS.1770, the basis of
LUFS -- because raw RMS over-counts bass and the albums should be chosen and
read on what the ear weights. `tools/listen.mjs` is what makes each album
one command.

**Candidate fixes, chosen by the albums rather than before them:**

- *Per-voice calibration.* A voice that is inherently louder or quieter than
  its family at the same velocity is trimmed at the source. This is
  calibration, the same kind of fix as the `keys` cost weight in #19, and
  not normalisation.
- *Pull in the tails, leave the middle.* If only the extremes send a hand to
  the volume, narrow the extremes and touch nothing else. Anything per-loop
  is derived from the spec and draws no random numbers, so codes stay stable.
- *Order, not level.* If the reach comes from big jumps between neighbours
  rather than from any one track, smoothing the shuffle or playlist order
  fixes it without changing a single gain. Item 11 pointed here.

**Done when** a fresh twenty-in-a-row run, on a new seed, draws **at most
one** reach for the volume, **and** the corpus loudness spread has not
fallen below what 13d shows Mikey is comfortable with -- that number gets
written here once it exists -- 6-8 LU is the expectation, not the rule.
Crest factor and within-loop range must be unchanged: the macro spread is
what moves, and the phrase-level dynamics are not to be touched by anything
done here. Item 11's warning stands too: a change that passes the first half
by collapsing the spread toward 4 dB has failed the item.

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
