# Brain session handoff

Read this first in any new "brain" session. It is the working memory of the
project's planning side: how the work is organised, what Mikey has decided,
which methods proved themselves, and where things stand. Update the
**State** section at the end of every brain session.

## How the work is organised

Three roles.

- **Brain** — a claude.ai chat in the *Procedural Music App* project.
  Analyses, verifies, and writes briefs. Does not normally write code.
- **Hands** — Claude Code sessions. Write code, open PRs, report back.
- **Mikey** — the ears and the merge button. His listening is the acceptance
  test for anything that changes the sound.

The loop:

1. Brain writes a ready-to-paste brief.
2. Mikey pastes it into Claude Code, which opens a PR and writes a report.
3. Mikey pastes the report back to the brain.
4. Brain **verifies independently** — clones the repo, checks out the PR,
   re-runs the numbers. Reports from the hands have been wrong in
   instructive ways; see Methods.
5. Brain builds a **listening album** for whatever the PR changes.
6. Mikey listens (on the PR's preview deploy where relevant), then merges.

Mikey's point, and the reason for step 5: the one thing nobody in this loop
can do except him is hear it. Numbers check the ear; they do not replace it.

## Getting oriented

- Repo (public): `https://github.com/Kruu-Mikey/driftloom`.
  `git clone --depth 1` needs no credentials. A PR:
  `git fetch origin refs/pull/N/head:prN`.
- Live: `https://driftloom.kruu-mikey-thaiculture.workers.dev/`. Cloudflare
  Workers, assets only (`wrangler.jsonc`). Push to `main` deploys. Every PR
  gets a preview deploy; the Cloudflare bot's PR comment has the branch and
  commit preview URLs. Listen there before merging.
- The app's Diagnostics panel reports `build` (bump `BUILD` in `js/main.js`
  and `CACHE` in `sw.js` together on every app change), `sw` state, and
  `choir`.
- Also read `ROADMAP.md` and `README.md`. `Mikey's Thoughts.md` is his.
- Credentials: Mikey may paste a GitHub token in the session's opening
  message. With it the brain may commit and merge **docs-only** changes —
  `docs/BRAIN.md`, `ROADMAP.md`, `README.md` — as it did for #10, #16 and
  #17. Code stays with the hands. Never write the token into a file, a
  commit, memory, or a brief. Mikey manages his own tokens; don't
  relitigate that.
- If this project's knowledge files contain an old snapshot of the repo,
  prefer GitHub. The snapshot goes stale the moment anything merges.

## Listening albums

The app's **Paste a code** button takes an album code (`DLA1-…`) and imports
every loop in order. So any set of loops can be handed to Mikey as one paste.

- `js/share.js` exports `encodeAlbum(title, specs)`, `decodeAlbum`,
  `decodeSong`. Build specs with `newSpec()`, filter on `render(spec)`
  (e.g. `meta.melodyVoice`), encode, and round-trip-check the order.
- **Blind** tests: shuffle with a fixed seed, write the key to a file, and
  do not print it until Mikey has answered. He rates in one word per track.
- **A/B across a PR**: synth-only changes leave share codes rendering the
  same loops, so the same album on production and on the PR preview is a
  clean A/B.
- **Never type a code out.** Print it in tool output and copy it from there,
  then decode what you are about to send. The first brain session wrote one
  album to a file, printed only its length, and then produced a plausible
  code from nothing; the app's checksum rejected it as a typo. A code that
  was never on screen is not a code.
- `tools/listen.mjs` is meant to make all of this one command (pending).

Results so far:

| test | result |
|---|---|
| Choir quiz, seed 4127 | 5/5 found, 0 false picks; two took a moment |
| Lead audition (blind, 12 tracks) | musicbox ×2, kalimba ×2: all *fine*. **saw**: harsh, harsh. **moog**: sharp, harsh ("gross"). **analoglead**: sharp, harsh. **stab**: fine, sharp-but-nice |

## What Mikey has decided

These are stated decisions, not inferences.

- **The current balance is right.** Preserve it as profiles, characters and
  instruments are added. Meandering, ambient tracks are wanted alongside
  tuneful ones; not every track should be a triumphant melody.
- Whimsy in the Ocarina of Time sense, sometimes: catchy, childlike,
  hummable. Rhythm cells, stepwise motion and figure repetition got there.
- **Quiet tracks and dynamic range across the catalogue are wanted.** No
  loudness normalisation (roadmap item 11, closed). But the listener should
  not need the volume every other track: dynamic *and* sensible, found by
  ear and fixed at the source, never by a limiter or compressor on the mix
  (item 13).
- **The choir is a rarity** (about 1 loop in 30) that should feel special.
- **Building without Mikey's ears for a while (2026-09-25).** He has no
  time to listen. The brain wrote `docs/QUEUE.md`: the next items in
  order, with standing rules (every new sound measured for level, cost
  and tone; conservative taste calls written down "for Mikey's ears";
  stop and note rather than guess). Claude Code works down it; the brain
  verifies from GitHub; Mikey's listening happens later in one combined
  review album built from the queue's Done list, and anything he dislikes
  gets tuned or reverted then.
  Progress, 2026-09-25: items 0-4 merged by Claude Code under the merge
  policy (#59 v44, #62 v45, #63 v46, #64 v47, #65 v48, #66 v49); item 5,
  `wayfare`, open as #67. Brain check on main: tests and `--check` pass;
  3000 specs from before the queue render identically unless tide is in
  their mix. Open follow-up the hands raised: a fast blend that draws
  shrine's temple bell (cost 12, long ring) can starve the melody (one
  cinder loop in 183 lost half its tune; the same case exists in shatter
  and undertow blends on main). The review album is built from the Done
  list once #67 merges.
- **The north star for tone (2026-09-25): pleasant.** Things should sound
  pleasant generally: nothing that would bother people in a coffee shop.
  Harsh, buzzy or toy-like timbres fail this whatever their level.
- **How we work now (2026-09-24): the middle path.** Mikey's ears were
  becoming the bottleneck. Blind A/Bs only for changes that alter sounds he
  already likes; new sounds get one short album rated keep / tune / drop.
  Loudness, CPU cost and balance are checked by the tools, not by ear.
  Design and listening overlap with the building. Voices go in pairs
  (fiddle + accordion, then nylon + pan flute); `tide` in two PRs
  (harmony: progressions, drone, waltz reading; then ornaments, waves,
  hand drums, the profile); `cinder` and `wayfare` one each.
- **`tide` defaults** (Mikey unsure, brain's call, the album decides):
  leads weighted fiddle, then whistle, with ocarina and accordion for
  colour; the feel varies loop to loop, gentle loops slower and waltzing,
  lively ones faster and jigging, so metre and tempo are drawn together;
  the drone in about a third of loops.
- **Merging before an A/B is fine** (2026-09-24). Production is seen by
  testers only and a merge can be reverted, so sound-change PRs may merge
  whenever Mikey likes; the A/B runs on the two commit previews either way.
- **Old share codes, saved loops and albums may change or break** while the
  app is in testing (2026-09-23). Compatibility is not a constraint on any
  change. Keeping draws stable is still worth it where it costs nothing,
  for one reason only: it lets the same album on production and on a
  preview compare the same loop, so an A/B hears the change and nothing
  else.
- Voices he likes: struck and sung — kalimba, musicbox, marimba, hum, and
  vowel since #14 darkened it. Raw-sawtooth leads read as harsh (above).
- Fine with retro, strange, and occasionally wrong if it opens things up.
- Wants briefs ready to paste, and concise answers.

## Methods that proved themselves

- **Verify every report from the hands.** Examples: `figureRepeat` measured
  the motif array before any transform, not the pitches played; a claimed
  cause ("the melody follows the harmony") was worth a third of what was
  said; a probe that "showed the budget coping" was wrong and reversed a
  correct decision.
- **Measure what reaches the ear** — emitted events, rendered audio — not
  internal state. Rendered audio is noisy per note (jitter, vibrato); a
  filter chain's response is exact but only answers where resonances are.
- **Span is the guard metric** for melodic changes. It caught every bad fix
  before the headline metric did.
- **Move the figure, never a note.** Anchor to the harmony by transposing a
  bar; snapping single notes rewrites the intervals that make a figure
  recognisable.
- **Articulation lives in the synth**, drawn from `Math.random` (scoop,
  jitter, vibrato, vowel drift, slides). The composer may annotate events
  with *derived* values that draw no random numbers. That keeps generator
  stats byte-identical and share codes stable.
- **Seed-derived decisions use a salted RNG** (`spec.seed ^ SALT`), as the
  choir does, so every other loop renders exactly as before. Since
  2026-09-23 this is for clean A/Bs, not for compatibility.
- Any generator change that consumes random numbers re-renders every share
  code in circulation. Accepted during testing; say so in the PR, because
  an A/B album across it compares different loops.
- Single-stage bisects mislead when stages interact (the chord-tone snap hid
  the octave fold). Test combinations.
- One fixed curve applied everywhere becomes a mannerism (the old contour
  arc). The phrase-velocity cosine from #11 is on watch for the same reason.
- Targets should come from something Mikey likes (e.g. his favourite voices'
  presence band), not from a number the brain guessed.

## Tools

- `tools/stats.mjs` — corpus statistics. `--seed`, `--n`,
  `--lift-low/--lift-high`, `--choir-quiz [file]`, `--voice-codes <voice>`.
- `tools/measure.mjs` — offline audio through the real Engine and Synth in
  headless Chromium: peak, RMS, per-layer levels, K-weighted LUFS, LRA and
  crest per loop, and what the master chain does to each loop; `--voice`
  reports a voice's A-weighted share of 2–5 kHz note by note, and its
  loudness at 0.4 and 0.8 by layer against kalimba (`--voice all` lists
  the outliers). Seeded: same `--seed`, same numbers.
- `tools/listen.mjs` — pending; see State.

## State — 2026-09-23

`main` at **v34**, deployed (`edb6d4b`; #21-#24 since `2253ab9` are docs
and tools only). No open PRs. Shipped: #1 rhythm
cells + stats tool · #2–#4 Cloudflare deploy, build stamp, offline fix · #5
melody forward in the mix · #6 measure.mjs · #7 motif-level omission,
stepwise walk, register separation · #8 audible-contour metric and bisect ·
#9 anchor by transposition · #10 roadmap item 4/12 · #11 phrase velocity ·
#12 vowel drift · #13 choir · #14 glottal source (v31) · #15 slid attacks
(v32) · #16–#18 this file · #19 melody starvation (v33) · #20 keys routing
(v34) · #21-#23 item 13 and its order · #24 the loudness
yardstick in `measure.mjs`.

**#24, verified.** `js/` untouched, `--selftest` passes, and the brain's own
12-loop run matched the report's table to the decimal, chain section
included. The four "plain bug" causes were read in the code and hold. One
claim downgraded: arpeggiated keys notes at full chord velocity are equal
power to the struck chord by construction (n x (0.8/sqrt n)^2), so only
overlapping tails could make an arpeggio louder -- not a bug on this
evidence. The brain's loud-and-squeezed hypothesis was wrong; findings are
in ROADMAP item 13. Note for next time: this container has one core, a
30-loop corpus outlasts a single tool call, and a background run must be
started with `setsid` or it dies when the call returns.


**#26, three level bugs, v35 -- verified.** The diff was read line by line
and does exactly what the brief asked: bells take velocity once (partials
and strike fixed at their 0.8 values), pad chords get the same 0.8 as every
other chord voice through one `CHORD_SPREAD`, rhodesbass loses its second
trim. Tests, stats and refusals byte-identical. One effect understated in
the report: the bells rise by 0.8/v, so at the velocities the app actually
plays shrine's chord bells they come up roughly 8-10 dB -- from 10+ LU
under the chord layer to inside it. Intended, but it is the most audible
change in the PR for shrine (4.3% of loops), more than the pads. A
five-track "Shrine bells" album went to Mikey to check they sit right.

**Drums, heard.** The 100-loop corpus shows the music under the drums is
equally loud with or without them (-27.5 LUFS both), and the drums are a
near-fixed level (-22.1 over the quietest quarter of the music, -22.0 over
the loudest), so they sit 3-8 LU over it depending on what is underneath.
Blind album of 12 drum loops spread across that gap, heard on v35: 10
fine, and the only two flags ("a little loud, maybe fine") were the 10th
and 12th of 12 by gap (+7.3, +12.3). The loudest loops overall were all
fine. So within a loop the drums are mostly right; the extreme tail of the
gap is mild at worst. Working hypothesis: the "drum loops are too loud"
experience is the *jump* from a drumless loop into a drum loop, not the
drums themselves. Being tested with a 14-track "Coming in" album mixing
drumless and drum loops, rated per track as the volume reach coming in
(up / down / none). Keys for both albums are derivable: decode the album,
measure each loop.

**"Coming in", heard.** 14 tracks, 7 drumless and 7 with drums, rated as
the reach for the volume relative to where Mikey set it on track 1 (a
drumless loop at -25.5 LUFS). Three findings, in order of confidence:
(1) **no reach up at all**, including a drumless loop 8 LU under the
reference and 15 LU under the loudest -- the quiet end is fine and nothing
should be lifted; (2) **every complaint was a drum loop** -- 3 down, 2 soft
("wish it were a bit lower", "drums a bit loud") out of 7, against none of
7 drumless, even a drumless loop 2.7 LU *over* the reference; (3) against
the all-drums album (2 soft flags of 12) this says the complaint is drum
loops relative to drumless ones, and that **drum loops read louder than
integrated LUFS says** -- one at +0.6 LU over the reference drew a reach.
Integrated loudness averages across the hits; the ear does not. Neither
LUFS nor the drums-over-music gap separates the flagged drum loops cleanly
at this sample size. Next measurement: a punch figure (max momentary /
short-term loudness, peak against loudness) on the 26 rated loops, to find
the number that matches the ear, then size a drum-level fix from it.
One loop, task-glei (undertow), reported no bass, chords or melody level
at all -- worth a look.

**"Shrine bells", heard.** Melody bells all fine. Chord templebell (the
only chord bell drawn) read buried on 1, a bit buried on 1, fine on 2 --
still about 2.5 LU under the chord layer after #26. Candidate for the next
synth brief: templebell as a chord voice up to the layer median, then
re-listen.

**#19, the melody starvation fix.** The ear-found bug was real: measured
through the real Engine, 53.7% of melody notes refused on the glade loop at
the 260 cap, and 28.6% of corpus loops losing more than 5% of their melody
while the mean said 6.3%. Three causes: `keys` priced at 25 when it is one
FM voice (now 12); only pads used the soft cap; and the soft cap was inert
on lite because `Math.min(170, 140)` is 140 (now a reserve subtracted from
whatever ceiling is in force). Full quality: 0.0% mean, max 2.7%. Keys pay
23.2% → 27.9% across the corpus. **Lite is 16× better but 12% of loops still
lose >5%**, and there the melody is refused by its own earlier notes, so the
remaining fix is a shorter tail -- a change to the sound, parked.

**#20, keys on the keys bus.** `pluck()` hardcoded the melody channel, so
every `keys` chord in the app's history played through the melody bus
(0.58 / 0.28 / 0.12) instead of chords (0.44 / 0.35 / 0.15): the chords
channel measured silent on 25 of 25 keys loops. Mikey hears the keys as
quieter now, as predicted. Whether they are *too* far back is album 13a.
`keys` is the main chord voice of `dust`, the commonest profile, so this is
the most widely heard change of the session.

The brain did not independently re-measure #19 or #20; the #20 diff and the
channel table were read and match the report.

**#30, the balance lock -- verified.** `stats.mjs --check` passes on main.
The brief's tolerance rule (5 corpora, 3 sd) false-alarmed on 19 of 20
pure re-rolls; the hands' correction (20 corpora, sd of the *difference*,
i.e. sqrt 2 x one corpus's sd) brings that to 1 in 20, and is right. At
n=2000 the choir rate must move about 2 points to trip it; the next
generator PR re-baselines at n=10000 to halve that, since choir rarity is
a stated decision.

**#31, the punch figure -- verified.** The Album B separation figures
recompute from the table (sample peak 0.90, gap -1.5). No figure splits
flagged from fine in either album; only peak-based figures order the
toask-ha / fui-theith pair as heard. The 26 soft ratings cannot pin a
metric, so the drum level is now decided by ear: a hidden `?drums=` dB
knob on a preview, the Coming-in album at three levels, blind.

**Whole layers silenced -- a generator bug.** task-glei plays drums over a
texture and nothing else: `genForm`'s placed rest wraps into short
per-layer cycles and silences them for the whole loop. Confirmed; the
brain's broader count at seed 1 finds bass, chords or melody silent for
the whole loop in 2.08% of loops (melody in 1%), texture separately in
2.7%. One of the "drums too loud" complaints was a loop with no music
under the drums at all. **Not a bug after all -- heard.** Mikey: loops with fewer layers are wanted
variety. Six loops that lost a layer this way, heard: five "complete",
task-glei included (drums over texture only). The one "missing" was
noan-nou, which lost only its bass; va-gloung lost bass and melody and was
complete, so one case is not a pattern. Left as it is. If more bass-less
loops come up "missing", a narrow guard on the bass is the fix, not the
brief that was dropped.

Next, in order (agreed with Mikey, 2026-09-23). Step 1 (#24), the plain
level bugs (#26), the balance lock (#30) and the punch figure (#31) are
done.

0. The drum listening knob, a draft preview never merged as a knob.

**#34, item 14a, v36 -- verified.** Rendering 4000 loops on the old and new
generator: every 16- and 20-step loop identical, 1102 of 1108 12-step loops
changed. Tests pass, `--check` passes against the new n=10000 baseline.
A/B album "Six eight" (8 twelve-step loops, one per chord pattern, mostly
glade) sent blind as two commit previews, 58c203b4 (v35) and dc190634 (v36),
labelled X (v35) and Y (v36). **Heard:** the new offbeat (jig "pah-pah")
won both times, and the new stutter won; the old version won on pushed,
lateBloom, breathe and the half-bar change, and narrowly on twoAndFour
("leaned same"). The rule in Mikey's ears: chords move on the dotted
beats (0 and 6) and hold; figures between the beats are welcome; an entry
on the weak eighth tied over the second beat is not. Follow-up: keep
offbeat, stutter and pad; restore the old hits for the rest.

**#38, v37 -- verified.** Rendered 4000 loops against v35 and v36: the only
12-step chord hits differing from v35 are the 165 offbeat and stutter
loops kept from v36; every other layer of every 12-step loop matches v36;
16- and 20-step loops differ from v36 only in the bass of 47 loops (the
dub fix). Tests and `--check` pass, baseline unmoved.

**#40, v38 -- verified, merged before its A/B.** 4000 loops against v37:
every 16- and 20-step loop identical; in 12-step loops the base kicks and
snares are unchanged (the moved kick hits are all roll hits, now one beat
long). Tests and `--check` pass on the re-baselined file. The A/B went
out afterwards as "Six eight, part two" (8 twelve-step loops, one per
changed part), blind between the commit previews 53614cef (v38) and
f0e6ef84 (v37), X = v38. **Heard:** the old version won on the swells,
a walking bass, the rolls and the gaps; a second walk was "same"; the
new hi-hat accents won; the shaker split one each (bloom old, shatter
new). Tracks were picked by the part that changed most, but a loop can
carry several changes, so each verdict is on a bundle. The lesson, and
it refines the #34 rule: the chords wanted to sit in 6/8 because they
were plainly off, but in the rhythm section the old cross-rhythm reading
of 12 steps -- 3/4 and 2/4 against the 6/8 -- is liked. Follow-up v39:
restore the walk, swells, rolls and gaps; keep the hat accents and the
shaker pairs (a tie, kept because they match the offbeat chords, which
won 2 of 2 in #34 -- Mikey may veto).

**The drum knob, #42 (draft, never to merge) -- verified.** `?drums=<dB>`
scales the drums channel's post-fader gain, so its reverb and echo sends
move with it; clamped -8..+2; shown in Diagnostics; build stamp
v38-knob; commit preview 59fb09f4. Listening: the Coming-in album at
three levels (0, -2, -4 dB) as links A/B/C, rated as before (reach up /
down / none, plus "thin" if the drums feel too weak). A = -2, B = -4,
C = 0. **Heard -- the drum level is not the cause.** Down-reaches: 0 dB 5,
-2 dB 7, -4 dB 8 plus an "up" on the quietest loop. The same four drum
loops drew a reach at every level. The drumless loops were identical audio
on all three links yet drew 1, 2 and 4 reaches, which is the test-retest
noise; the level differences sit inside it. What the five loops flagged on
every pass share is the **melody voice: pluck in four (nong-lu is
drumless) and saw in one**; no loop never flagged plays either. #24's probe
agrees (pluck +3.3, saw +4.4 LU over the melody median at 1.6 s notes,
more at short ones). Pluck and saw live in dust and shatter, the
drum-heaviest profiles -- which is why "drum loops" read loud. Drums stay
at 0 dB; #42 closes unmerged. v39 (#46, the 6/8 rhythm section restored
as heard) merged without an A/B, as agreed.

**#48, v40 -- verified.** The diff is the two gain constants only (saw
0.28 -> 0.142, -5.9 dB; pluck 0.16 -> 0.095, -4.5 dB); tests and `--check`
pass; the generator is untouched. Blind A/B out on Coming-in between the
commit previews 7ea31427 (v39, from the Workers check run -- #46 had no
bot comment) and c4a8015f (v40), rated as the reach for the volume per
track. X = v39, Y = v40. **Heard:** Mikey guessed Y was the new one (so not
blind) and reached for the volume on none of its 14 tracks, against 5
down-reaches on the same album at the same drum level in the knob test.
The loudness complaint behind item 13 was the pluck and saw leads. Still
measured loud and not yet trimmed (#24, 1.6 s notes, over the melody
median): ocarina +6.8, flute +5.1, moog +3.9, whistle +3.4, analoglead
+2.5, all larger at 0.4 s. Flute drew a reach in 2 of 3 knob passes.
Next after the fiddle pair: trim these the same way, with an A/B,
since ocarina and whistle are sounds Mikey likes.

**#51, v41, fiddle and accordion -- checked locally.** The code parses, the
tests pass, `--check` passes on the re-baselined file, and glade's pools
change only by the three added entries. Its Cloudflare deploy failed with
no log four minutes in, while main deployed fine 20 minutes earlier:
infrastructure, most likely. Since merging is fine, the plan is to merge
and listen on the live site; if main's deploy also fails, it is real.
Costs measured (fiddle 24, accordion 23). Open concern: on lite, one
fiddle-over-pad loop (koun-nuing) now loses 38% of its melody; a cheaper
lite fiddle without the rosin noise is the likely fix, later. Album
"Fiddle and accordion" (6 tracks: 3 fiddle leads, 1 accordion lead, 2
accordion chords) out for keep / tune / drop, not blind. The failed
deploy was Cloudflare's: a retry passed on the same commit; #51 merged
and the live site now serves v41.

**#53, v42, the other five leads -- verified.** The diff is the five gain
constants; ocarina and flute scale tone and breath together, so their
breath ratios (0.15, 1/3) hold. Trims at 0.4 s: ocarina -8.6, flute -6.9,
whistle -5.9, moog -5.4, analoglead -3.6 dB. Watch-point from the hands:
the catalogue range widens 6.4 -> 6.9 LU and drumless loops get 0.8 LU
quieter, so the quiet end needs an ear. Blind A/B "Softer winds" (8
tracks: 2 ocarina, 2 whistle, flute, moog, analoglead, and a kalimba
control) between the commit previews f1d4bdd0 (v42) and efb9a0c5 (v41);
X = v42. **Heard:** the kalimba control "same"
(a good sign); the trimmed version preferred on flute, moog, analoglead
and a drumless ocarina; "same" on both whistles; the old, louder version
preferred only on the ocarina *over drums*. Kept v42. Watch-point:
ocarina took the biggest trim (-8.6 dB); if it comes up buried under
drums again, ease it back 2-3 dB.

**"Fiddle and accordion", heard: tune, both.** The fiddle is harsh,
robotic, grating; the accordion rough; together "a toy fiddle and
accordion played badly by a child". The brief's own design choices are
the likely cause: a raw sawtooth source with a per-note filter sweep (the
family the lead audition already called harsh), attacks sized for long
notes (80-120 ms bow, 150 ms bellows) on melody notes whose median is
0.35 s, a perfectly regular vibrato, two raw saws beating 12 cents apart,
and rosin noise. Take two rebuilds the timbre: a softer shaped source
with fixed body resonances, attacks that scale with note length,
slurred legato, a drifting vibrato, closer reeds, little or no bow noise
(which also cheapens the lite fiddle). Yardstick: the tone probe's
2-5 kHz share must land among voices Mikey likes (ocarina, flute, harp,
kalimba), not the harsh leads. Same album afterwards.

**#57, v43, `tide` part 1 -- verified.** 3000 of main's specs render
identically under the new code (fresh seeds differ, as they must, since
the profile pool grew). Tests and `--check` pass on the re-baselined file.
Tide leads about 10% of fresh loops; 32% of those get the drone. Level
0.83, solved from measurement. The hands fixed two things beyond the
brief, both right: progressions filtered per mode (the I-bVII shuttle is
a diminished vii in ionian), and glade's bVII ending no longer rewrites
tide's own progressions. Left for part 2: 3/4 melody rhythms still use
the 6/8 cells, 3/4 gaps still count 3-step beats. The tide album waits
for fiddle take two, since tide leans on the fiddle; #57 should merge
first so take two is built on top of it. (It merged mid-build; take two
rebased onto it.)

**#59, v44, fiddle and accordion take two -- in flight.** Synth only (the
diff touches synth.js and the stamps), built on main with tide. Tone
probe: both now read under flute in the 2-5 kHz share, against 11-14%
for take one. The hands found and fixed two accordion faults on the way:
two equal reeds 2.5 cents apart cancel at the bottom of each beat (second
reed now at 0.35), and in-phase starts skewed short versus long notes
(the second reed now starts 2-8 ms late). Costs re-measured: fiddle 8,
accordion 9, about a third of take one. After-runs pending. Two albums
out on the commit preview 2c98c11d: the same "Fiddle and accordion" (keep
/ tune / drop) and "Tide" (8 tide-led loops across waltz, jig and reel,
fiddle, whistle, ocarina and accordion leads, drums and drone). The hands found, and left, the
other 16-step assumptions in 12-step bars: shaker on 2/6/10, hat accents
on 0/4/8, 4-step rolls, gaps counting 3-step beats, 32-step swells, and
the walk at [0,3,6,9] (a 6/8 walk would be [0,4,6,10]); plus a 4/4 dub
bug (1.6% of loops), 5/4 on the 4/4 chord table, and arpeggios running
past the bar. The drums, bass and texture follow-up is a separate PR with its own A/B.

1. (done: lock and punch figure)
2. Item 14a, the 6/8 accompaniment, A/B'd on existing codes.
3. Item 14b, voices one PR each: fiddle, nylon with strumming, accordion,
   pan flute.
4. The drum fix, at the level Mikey picks with the knob (item 13). The chord
   templebell trim can ride any sound-change PR that is not being A/B'd.
5. Item 14c, `tide` first, then `cinder` and `wayfare`.
6. Then the saw leads, the taste calls, the articulation items and albums
   13b-13d on the finished catalogue.

Also open: `tools/listen.mjs`; the residual lite starvation (shorter tails,
a change to the sound); roadmap item 5, blocked on a phone that isn't
Mikey's and wanting the voice weights checked before the totals.
