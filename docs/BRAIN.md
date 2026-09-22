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
  choir does, so every other loop renders exactly as before.
- Any generator change that consumes random numbers re-renders every share
  code in circulation. Export favourites first.
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
  headless Chromium: peak, RMS, per-layer levels; `--voice` reports a voice's
  A-weighted share of 2–5 kHz note by note.
- `tools/listen.mjs` — pending; see State.

## State — 2026-09-22, evening

`main` at **v34** (`2253ab9`), deployed. No open PRs. Shipped: #1 rhythm
cells + stats tool · #2–#4 Cloudflare deploy, build stamp, offline fix · #5
melody forward in the mix · #6 measure.mjs · #7 motif-level omission,
stepwise walk, register separation · #8 audible-contour metric and bisect ·
#9 anchor by transposition · #10 roadmap item 4/12 · #11 phrase velocity ·
#12 vowel drift · #13 choir · #14 glottal source (v31) · #15 slid attacks
(v32) · #16–#18 this file · #19 melody starvation (v33) · #20 keys routing
(v34).

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

Next, in order:

1. Item 13, level by ear. Album 13a (keys) can be built now from
   `share.js`. Hands: add a K-weighted loudness figure to `measure.mjs`.
2. Build `tools/listen.mjs`.
3. Fix the harsh sawtooth leads: saw, then moog and analoglead; stab lightly
   or not at all. Same approach as #14 -- soften at the source -- then
   re-run the blind lead audition. Leads may keep more bite than the
   sung voices; the re-audition decides. Album 13b comes after this.
4. Item 9 v3, breath before phrase entries.
5. Item 3: Mikey to decide whether to reframe it as a *spread* of melodic
   range across loops rather than a higher mean.
6. Before adding new content: the balance lock (`stats.mjs --check` against
   a committed baseline; pin melodic character, not per-profile shares).

Parked: the residual lite starvation (shorter tails, a sound change).
Roadmap item 5 is blocked on a phone that isn't Mikey's, and wants the
voice weights checked before the totals.
