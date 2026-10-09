# Brain session handoff

Read this first in any new "brain" session. It is the working memory of the
project's planning side: how the work is organized, what Mikey has decided,
what he has heard, which methods proved themselves, and where things stand.
Keep **State** current as you go, not only at the end; a long session can
stop without warning.

## How the work is organized

Three roles.

- **Brain** -- a claude.ai chat in the *Driftloom* project (Mikey's
  nowmichaelclark Claude account since 2026-10-08). Analyzes, verifies, designs, and writes the queue. Does not write code.
- **Hands** -- Claude Code sessions. Write code, open PRs, measure, merge
  under the merge policy, and report.
- **Mikey** -- the ears. His listening is the acceptance test for anything
  that changes how the app sounds. He relays between brain and hands.

The loop, since 2026-09-25:

1. The brain writes work into **`docs/QUEUE.md`**: numbered items with a
   why, a what, and yardsticks, under standing rules at the top (every new
   sound measured for level, cost and tone; conservative taste calls
   written down "for Mikey's ears"; stop and leave a note rather than
   guess).
2. Mikey tells the hands to continue with the queue. They work down it,
   one PR per item, and **merge their own PRs** when CI is green and every
   check passes (the queue's merge policy, "yes, from Mikey"). Claude
   Code's own safety check may flag a self-merge as "merge without
   review"; the policy line in the queue is the answer to that.
3. The brain **verifies independently** from GitHub -- fetches main, runs
   the tests and the balance lock, renders loops before and after with
   its own metrics. Reports from the hands have been wrong in instructive
   ways (see Methods).
4. The brain builds **listening albums** for what changed; Mikey listens
   when he has time, and his verdicts become new queue items.

Mikey's point, and the reason for step 4: the one thing nobody in this loop
can do except him is hear it. Numbers check the ear; they do not replace
it.

Only one brain chat edits these files at a time. Long chats get slow and
lose detail; start a fresh brain chat per phase (the words, the Rust port)
and a fresh hands chat per phase too, since the queue file carries
everything a session needs.

## Getting oriented

- Repo (public): `https://github.com/nowmichaelclark/driftloom`. A PR:
  `git fetch origin pull/N/head:prN`. It moved from `Kruu-Mikey/driftloom`
  on 2026-10-08 with its history, PR numbers and branches.
- Live: `https://driftloom.nowmichaelclark.workers.dev/`. Cloudflare
  Workers, assets only (`wrangler.jsonc`). Push to `main` deploys; only
  testers see it. Every PR gets preview deploys: the Cloudflare bot's PR
  comment has the branch and **commit** preview URLs (use the commit one;
  it never moves), and when the bot doesn't comment, the Workers Builds
  check run's output carries the commit preview URL. An old commit's
  preview stays live, which is what makes A/Bs across merged PRs possible.
  Since the move, PR branches build as Cloudflare **Previews**: the commit
  link is the Deployment URL, `<deployment-id>-driftloom...`; the
  branch's Preview URL moves (see Session 5 in State). Previews from the
  old account's links in QUEUE.md's Done list depend on that account.
- The app's Diagnostics panel reports `build` (bump `BUILD` in `js/main.js`
  and `CACHE` in `sw.js` together on every app change), `sw` state, and
  `choir`.
- Read `ROADMAP.md`, `docs/QUEUE.md`, `docs/MOODS.md`, `docs/ALBUMS.md`,
  `docs/perf-baseline.md`, `README.md` (a short front page since
  2026-10-08) and `docs/NOTES.md` (the engineering sections that were the
  README's body). `Mikey's Thoughts.md` is his.
- Credentials: Mikey pastes a GitHub token in the session's opening
  message. With it the brain commits and merges **docs-only** changes --
  `docs/*.md`, `ROADMAP.md`, `README.md` -- through small PRs it merges
  itself. Code stays with the hands. Never write the token into a file, a
  commit, memory, Project knowledge, or a brief. Mikey manages his own
  tokens. Commits are authored as
  `Mikey <162073748+nowmichaelclark@users.noreply.github.com>` (Kruu
  Mikey before 2026-10-08).
- In a claude.ai brain session the GitHub API answers 403 for the repo
  until it is attached to the session (`add_repo` with push access);
  after that `gh api` (REST only, no GraphQL) and pushes work with the
  token. The shell can't reach workers.dev: check the live site with
  WebFetch.
- Things that tripped the hands before: a Claude Code session may push
  only to its one designated branch, so an open draft PR on that branch
  (like the never-to-merge drum knob, #42) blocks the next PR -- close it
  first. The hands can't retry a failed Cloudflare build (one failed with
  no log, #51); Mikey retries it from the check's Details link, or simply
  merges, since main redeploys. Their sandbox can't fetch workers.dev, so
  the brain checks previews. Sessions hit usage limits mid-item; the
  queue and the branch make resuming cheap.
- The brain's container: one core; `/tmp` does not survive between
  sessions; a background run must start with `setsid` or it dies when the
  tool call returns; `measure.mjs` takes a few seconds per loop, so 100
  loops is a background job. Playwright is installed globally
  (`NODE_PATH=$(npm root -g)`).

## Listening albums

The app's **Paste a code** button takes an album code (`DLA1-...`) and
imports every loop in order.

- `js/share.js` exports `encodeAlbum(title, specs)` and `decodeAlbum`.
  Build specs with `newSpec()`, filter on `render(spec)` (e.g.
  `meta.melodyVoice`, `meta.kit`, `developmentOf(spec)`), encode, and
  round-trip-check the order.
- **Never type a code out.** Print it in tool output and copy it from
  there, then decode what you are about to send. The first brain session
  produced a plausible code from nothing; the app's checksum rejected it.
- **Blind tests:** shuffle with a fixed seed. Prefer albums whose key can
  be read back from the code itself (the loop's mood, voice, profile or
  `developmentOf`), so nothing needs storing. Albums out for listening go
  in `docs/ALBUMS.md` with how to read their key. **Never write a key into
  a public file before Mikey has answered** -- the brain slipped once
  (#35, taken back in #36).
- **A/Bs:** play the same album on two commit previews, labeled X and Y,
  randomly assigned. If the change is synth-only, both previews render the
  same loops. A control track that didn't change is worth including: it
  measures his test-retest noise.
- **Labeled albums** (keep / tune / drop) for new sounds; **blind A/Bs**
  only when a change alters sounds he already likes (the middle path).
- He rates in one word per track, and describes freely when asked.

## What Mikey has decided

Stated decisions, not inferences. Dated where the date matters.

**The music**

- **The current balance is right.** Preserve it as things are added.
  Meandering, ambient loops alongside tuneful ones; not every loop a
  triumphant melody. The balance lock (`stats.mjs --check`) guards it; a
  deliberate change re-baselines and says so.
- Whimsy in the Ocarina of Time sense, sometimes: catchy, childlike,
  hummable. Inspiration also from Wind Waker and Spirit Tracks.
- **The north star for tone: pleasant** -- nothing that would bother people
  in a coffee shop. Harsh, buzzy or toy-like timbres fail whatever their
  level. Respectable through an aux cable at a live venue or in a car.
- **Moods stay wholesome, never negative or depressing** (Animal Crossing,
  a nice coffee shop). In the spirit of Buddhadasa and Ajahn Dhammarato:
  feelings and sensations are textures, neither good nor bad. See
  `docs/MOODS.md`.
- **Dynamic but sensible:** quiet loops and a spread across the catalog
  are wanted, but the listener shouldn't need the volume every other
  track. Fixed at the source, never by a limiter, compressor or
  normalization on the mix. (Solved in practice by the lead trims, #48 and
  #53. "Twenty in a row" is not needed for now.)
- **One behavior for everybody:** no user-facing modes, toggles or sliders
  to scroll through.
- **Loops with fewer layers are wanted variety**, not a bug, even drums
  over a texture alone.
- **About twice the variety it had in September 2026**: some loops wider
  and deeper, very simple ones still possible at any length.
- **The choir is a rarity** (about 1 loop in 30) that should feel special.
- Fine with retro, strange, and occasionally wrong if it opens things up.
- **6/8:** chords move on the dotted beats and hold; figures between the
  beats are welcome; an entry on a weak eighth tied over the beat is not.
  In the rhythm section he likes the old cross-rhythm (hints of 3/4 and
  2/4 against the 6/8); only the chords wanted to be strict.
- **Cinder's added F over the E chord stays; wayfare's minor v stays.**
- **Composition depth:** some loops develop, simple ones stay (his
  favorite in the Depth album was a simple 24-bar loop). The share is a
  knob to tune by ear.
- **No new sound profiles or instruments for now** (2026-09-25). The base is
  solid; the focus is optimization, composition, and bettering what the
  app already makes. Fiddle, accordion and drone may get more nuance later.
- **The playhead fade is gone for speed** (2026-09-27).

**The words (roadmap 19)**

- 178 mood words of his own, in `docs/MOODS.md` (lively added
  2026-09-28; candidates for more listed there). Near-synonyms may
  differ ("a happy song isn't the same as a merry song").
- Labels of one to five words, mostly two or three of different kinds;
  some loops one word fully embraced. Words steer generation, bending a
  profile within its character; how each word meets each profile is
  defined with him by ear.
- **No pair is forbidden:** words that pull apart find their in-between,
  a shape over time (bouncy + floating is a helium balloon).
- A pilot dozen is agreed: merry, tender, serene, golden, twinkling,
  crisp, velvety, sour, bouncy, floating, swaying, quirky. Draft recipes
  in `docs/MOODS.md`; he loves most of the approach (2026-09-28).
- **Heart words replace the eight moods** (2026-09-28), eventually; the
  eight become heart words with recipes. Tender is close, soothing
  settling; serene still and wide, peaceful content and gently moving.
- **Percentages stay only if honest:** measured from the rendered loop.
- **Ten dials, five maps (option B), loops as clouds**, word regions
  fitted from his rankings (`docs/MOODS.md`). Open: which candidate words
  join.
- **Listening tests don't ask him to describe tracks freely** (too
  abstract). The word-ranking test (queue item 19) is the tool.
- The old branches stay: he likes looking back on them.

**The platform**

- **Old share codes, saved loops and albums may change or break** while the
  app is in testing (2026-09-23). Keep draws stable where it's free, only
  because it keeps A/B albums comparing the same loops.
- **Merging before an A/B is fine**, and the hands merge their own PRs
  under the queue's policy. Production is testers only; merges can be
  reverted.
- **Performance: excellence.** Light and fast even at full quality,
  "DHH-wow" smooth with a hundred other apps open.
- **Baking loops for playback: no.** "Let the loop wander" is on by default
  and changes the loop every pass, and re-rolls must be instant. Baking
  lives on as an audio export (roadmap 17).
- **Rust:** the synth, then the generator, move to a host-agnostic Rust
  core (WebAssembly in an AudioWorklet for the web), in its own brain
  chat. **Timing (2026-10-03): the synth ports now; the generator waits
  until the words' draws stop moving.** Its case is
  portability, not speed (the performance baseline showed the fixable
  costs were elsewhere). The deliverable is the phone app; a native build
  and games are separate projects. Rust over C++ and the rest: roadmap 16.
- **Games:** chill ones -- Animal Crossing, point-and-click, turn-based --
  where music follows time of day, weather, place, season, turn. Not
  action. Roadmap 18.

**Working style**

- Briefs ready to paste; concise answers; instructions step by step.
- His ears are the scarce resource: batch listening, keep albums short,
  let the tools judge level, cost and tone.
- Voices he likes: struck and sung -- kalimba, musicbox, marimba, hum,
  vowel since #14; the fiddle and accordion since take two.

## What he has heard

| album | verdict |
|---|---|
| Choir quiz (seed 4127) | 5/5 found, no false picks |
| Lead audition (blind, 12) | saw, moog, analoglead harsh; musicbox, kalimba, stab fine |
| Drums (blind, 12) | drums within a loop mostly right; two mild flags at the far end of drums-over-music |
| Coming in (14) | never reached up; every complaint a drum loop |
| Shrine bells (5) | melody bells fine; chord temple bell buried (lifted in #106) |
| Missing layers (6) | five "complete": fewer layers are variety |
| Six eight (A/B, 8) | new offbeat and stutter won; old won where chords entered on a weak eighth |
| Six eight, part two (A/B, 8) | rhythm section: keep the cross-rhythm; new hat accents won |
| Drum knob (3 levels x 14) | drum level not the cause; the pluck and saw leads were |
| Lead trims (A/B, 14) | volume reaches 5 -> 0 |
| Softer winds (A/B, 8) | trims kept; the ocarina over drums preferred louder (watch) |
| Fiddle and accordion, take one (6) | "a toy fiddle and accordion played badly by a child" -> rebuilt |
| Review album (19) | take two keep; nylon smeared and pan flute static (both fixed, #74, #75); cinder keep; wayfare drums wrong (#79, then #82: "pretty nice") |
| Depth (blind, 8) | development heard at 24 and 32 bars; weak at 16 (second pass #108) |

## Methods that proved themselves

- **Verify every report from the hands**, with the brain's own measure where
  possible. Past misses: `figureRepeat` measured the motif before its
  transforms; a claimed cause was worth a third of what was said; a probe
  "showed the budget coping" and was wrong.
- **Render, don't guess.** The brain's hypotheses were wrong often enough
  to label them "unproven": the loud-and-squeezed theory (#24), "drums too
  loud" (it was the melody voice), all three pan-flute suspects (it was
  grace notes shorter than the attack). Queue items name suspects and ask
  the hands to find the cause by rendering.
- **Group ratings by feature.** The drum complaints resolved when the
  flagged loops were grouped by melody voice.
- **Briefs get taken literally.** "Steady, the same shapes on every kit"
  produced static drums (#79). Say the intent and give yardsticks for
  what must not be lost (variety, dynamics), not only constraints.
- **Targets come from something Mikey likes** -- the flute's 2-5 kHz share
  for tone, tide's hand-kit jig for drum level and variety, kalimba for
  loudness -- not a number the brain guessed.
- **Measure what reaches the ear** -- emitted events and rendered audio --
  not internal state. Short notes (0.4 s, near the app's median melody
  note) calibrate level; long ones flatter or hide ringing voices.
- **Controls and repeats.** Identical audio on two links drew different
  ratings; a control track and patterns consistent across passes separate
  signal from noise.
- **Span is the guard metric** for melodic changes; **move the figure,
  never a note**; **articulation lives in the synth** (drawn from
  `Math.random`), and the composer annotates with derived values only.
- **Seed-derived decisions use a salted RNG** (`spec.seed ^ SALT`) so loops
  that don't take the feature render exactly as before; it keeps A/Bs
  clean.
- Single-stage bisects mislead when stages interact. One fixed curve
  applied everywhere becomes a mannerism.

## Tools

- `test/generator.test.mjs` -- the tests; run three times.
- `tools/stats.mjs` -- corpus statistics. `--seed`, `--n`,
  `--lift-low/--lift-high`, `--choir-quiz [file]`, `--voice-codes <voice>`,
  `--check` and `--write-baseline` (the balance lock,
  `test/stats-baseline.json`, n=10000), `--drums <profiles>` (drum
  variety), `--depth` (composition depth, developing vs simple).
- `tools/measure.mjs` -- offline audio through the real Engine and Synth in
  headless Chromium: peak, RMS, LUFS, LRA, crest, per-layer levels,
  punch figures, drums over the music; `--voice all|names` (tone and
  level by layer, `--note` for note length), `--refusals [code]`
  (`--quality lite`), `--profile <id>`, `--endings` (cut-off notes),
  `--retire` (voices letting go changes nothing), `--selftest`,
  `--json`, `--jobs`, `--seed`. Seeded: same seed, same numbers.
- `tools/perf.mjs` -- live performance in headless Chromium under CPU
  throttling: audio health, main-thread cost, graph churn, memory, time
  to first sound, page weight, hidden tab; `--ab` for before/after.
  Baseline in `docs/perf-baseline.md`.
- `tools/listen.mjs` -- one-command albums; still not built (roadmap 20).

## State -- 2026-10-08

`main` at **v68**, deployed at the new address (see Session 5, below).
No open PRs. Nothing is queued. Item 20
(#122, v66) and items 21-22 (#126 v67, #127 v68, Session 4) are merged
and brain-verified (below).

As of 2026-09-28: queue items 0-17 done (13
stopped at its gate, by design); item 18, the housekeeping pass over
code comments and the README, merged as #111 (brain check: tests pass,
`--check` holds, `stats.mjs` output byte-identical). Nothing is queued. The
brain's document audit (2026-09-28) rewrote this file, updated the
roadmap's statuses (items 3, 9, 13, 14, 16, new 20 and 21) and the
README (profiles, rough edges, `--retire`, `--profile`, a project
documents list).

Since the last full State: the performance wins (#96 paint, #100 voices
let go, #102 hidden-tab build window, #103 always-on chain costed, #104
page weight, #105 fade dropped), the temple bell as a chord voice lifted
1.9 LU (#106), moods steering the mode with the vocabulary as data in
`js/moods.js` (#107: loops 90%+ happy in minor-ish modes 38% -> about
20%), and composition depth's second pass (#108: 16-bar developing loops
8.8 distinct melody bars against 6.7 simple). Brain check on v64: tests
and `--check` pass.

**Open decisions for Mikey:**
- **32-bar micro-loops** (three in four 32-bar loops) never develop, by
  design; developing them would be a new kind of form. Say if wanted.
- **Reflective leans brighter** since #107; is that right?
- **Cinder and shatter can't sound bright**: no bright modes in their
  pools. Part of roadmap 19.
- The ocarina over drums: ease back 2-3 dB if it comes up buried again.
- **Short loops' gaps** (from #111): `genGaps` draws at every length, so
  about a third of 2- and 4-bar loops take a gap and 7-8% a whole bar of
  silence (half a 2-bar loop). Keep, keep only beat-long ones, or none?

**Out for listening:** `docs/ALBUMS.md` -- "Depth two" (goes somewhere /
loops / too busy). "Moods" was retired unheard (2026-09-28).

**Sessions (Mikey, 2026-10-03).** Every session gets a label, one
counter for brain and hands: Session 1 is the words brain chat
(2026-09-28 to 10-03). For each next session, tell Mikey: brain or a new
hands session, which model, which effort, and its label. Defaults: brain
chats on Opus 5.5; hands on Sonnet 5.5 at medium effort for items with a
clear spec, Opus 5.5 at high for hard or judgment-heavy ones (DSP
parity, first prototypes). Next labels: Session 2, hands, queue item 20;
Session 3, brain, the Rust port.

**Words session (Session 1, 2026-09-28 to 10-03, closed):** State checked against GitHub;
item 18 (#111) verified. Decided this session (details in `docs/MOODS.md`):
lively joins (178 words); tender/soothing and serene/peaceful told apart;
heart words will replace the eight moods; percentages stay only if honest;
ten dials, paired as option B into five maps; a loop measured as a cloud,
with each word's region fitted from Mikey's own answers. **American
English** for the project (docs converted; identifiers left alone).
Free description and most/least albums were too slow and abstract, so the
words get a **ranking test** instead: queue item 19 (`rank.html`), for the
hands: merged as #117 (v65), brain-verified (tests pass, `--check`
holds, app untouched but the stamps; live page matches the repo). It
lives at https://driftloom.nowmichaelclark.workers.dev/rank
(`/rank.html` redirects there). The Moods album is retired; Depth two is
still out. Next: Mikey does a first batch of rankings, exports, and the
brain reads them with `tools/ranks.mjs`. Candidate words later (he
likes about half).

**Rust session (Session 3, brain, 2026-10-03, in progress):** State
checked against GitHub (drift fixed here: v65, the Rust timing line,
the retired album). Feasibility settled -- see roadmap 16, "Feasibility":
the hands' sandbox can build Rust, Cloudflare's build image can't without
installing it on every build, and the decision is to **commit the built
`.wasm`**, built by a pinned toolchain, with a check that it
matches its source. Mikey said go: queue items 21 (the pipeline and
kalimba) and 22 (fiddle and pad, the performance A/B) are written. Next
label: **Session 4, hands, Opus 5.5 at high effort**, items 21-22. After
21 merges, the brain checks the `?engine=rust` preview and sends Mikey a
few kalimba loops to try on his phone; after 22, a blind X/Y album.

**Rust core, items 21-22 verified (brain, 2026-10-05).** On a third
machine, the pinned toolchain (1.99.0) rebuilt `js/dlcore.wasm`
byte for byte (41,832 bytes); 32 core tests, the generator tests three
times and `--check` (22 of 22) pass. `measure.mjs --null` reproduces the
hands' figures: notes null at -95 to -119 dB, core layers in whole loops
at -105 to -123 dB, and the mix sits at Chromium's own JS-against-JS
floor (about -86 dB), with no late notes or fallbacks. The live site
serves the same `.wasm` (`application/wasm`) and 404s the crate's
source. Performance, from the hands: audio thread about 10-20% busier
with Rust, main thread the same or lighter, 4x fewer Web Audio nodes.

**The album is labeled, not blind (a change from the plan):** the engine
is a URL flag Mikey can see, and Diagnostics names it, so a blind X/Y
isn't possible without a hidden toggle. On Chromium a blind test would
find nothing anyway (the residual is float rounding). The open question
is his phone: on iPhone, the JS voices are rendered by WebKit while the
core copies Chromium, so the two engines could differ audibly there --
the case for a hidden toggle and a real blind test. Asked Mikey which
phone and browser he listens on.

**Rust check heard (2026-10-07):** Mikey played the album with and
without `?engine=rust` in **Firefox on desktop (Fedora)** and heard no
difference. That is a cross-engine result: Firefox renders the JS voices
with its own Web Audio, while the core copies Chromium's, so the two
engines agreeing there is good evidence the port holds outside Chrome.
iPhone/WebKit is still unheard; a hidden-toggle blind test stays optional.

**Account move (planned 2026-10-07, done 2026-10-08):** Mikey is moving Driftloom from
the Kruu-Mikey GitHub and Claude accounts to his nowmichaelclark ones.
Nothing is queued and no PR is open, so it's a clean point to move.
After the move, the repo URL, the brain's token and possibly the live
URL change; the next brain fixes the links (README, this file, the
Done lines) once Mikey confirms the new addresses. Old preview links in
QUEUE.md's Done list keep working only if the Cloudflare account stays.

**Session 5 (brain, 2026-10-08), the first on the new account.** State
checked against GitHub and the live site: the repo arrived with its
history (#129 the last merge, no open PRs, Workers Builds green on
main); the live site serves v68 and `/rank` works. The old site's saved
songs and ranking answers stay behind, and Mikey is fine with that. The
handoff file from the old account's memory is in the Project's
knowledge; what it held that this file lacked (the variety goal) is now
under the decisions. This session, as a docs PR: links moved to the new
repo and site (README, this file; the Done list's old preview links are
history and stay), the commit identity switched, and the README trimmed
to a front page -- what Driftloom is, the live link, how to use and run
it, Profiles, the documents list -- with the engineering sections moved
unchanged into `docs/NOTES.md` (one relative link fixed so it still
resolves). The intro now names the Rust core behind `?engine=rust`, and
the British spellings left in the README and NOTES are American now.
Its PR (#130) was the first build on the new Cloudflare account, and
the preview failed. The new Cloudflare account builds PR branches as
**Previews** (beta, "Previews Base" in Settings -> Build), whose command
is `npx wrangler preview` and which needs a `previews` block in
`wrangler.jsonc` (added in this PR; config, not code, so the brain made
it). `npx wrangler versions upload` doesn't work there: the preview
build runs as a different Worker and rejects the config's name. Each
Preview deploy gets a **Deployment URL** that "never changes"
(`<deployment-id>-driftloom.nowmichaelclark.workers.dev`): use it as the
commit preview for A/Bs. The branch's Preview URL moves with each push.
Limits: 100 deployments per Preview, 100 Previews per Worker on the free
plan, oldest pruned first. Production stays `npx wrangler deploy`.
**Each Preview keeps its own copy of the build settings**, taken from
Previews Base when its branch first builds: fixing Base doesn't fix a
Preview that already exists (a typo'd command broke `brain-rust-6`'s
until Mikey fixed it in that Preview's own settings). When a branch's
preview fails and Base looks right, check that branch's Preview.

**Next (Mikey, 2026-10-08): the Rust port first.** The brain wrote
queue items 23-28 (every remaining voice, behind `?engine=rust`), from a
read-only survey of `synth.js` done by two Sonnet subagents and
spot-checked by the brain. Mikey's note: Sonnet 5.5 and Haiku 5.5 (new
that day) are available, and the brain chooses models and effort. The
sessions:
- **Session 6:** hands, **Sonnet 5.5, high effort**: items 23-24 (the FM
  voices, sine, tubular; the wave-table voices). Existing building
  blocks and Chromium's own wave formulas; high effort because parity is
  exact.
- **Session 7:** hands, **Opus 5.5, high effort**: items 25-26 (bodies
  and nylon's damp; bandpass, highpass and the noise source). Chromium
  behavior to read and match: judgment-heavy.
- **Session 8:** hands, **Sonnet 5.5, high effort**: item 27 (bass,
  textures, drums; five channels; the performance A/B). Routine by then,
  but many voices.
- **Session 9:** hands, **Opus 5.5, high effort**: item 28 (the sung
  voices).
- **Brain checks between sessions.** The brain verifies each merged item
  from GitHub, as before, and hands the mechanical reruns (the `.wasm`
  byte check, tests three times, `--check`, the null and equivalence
  runs) to **Haiku 5.5** subagents, reviewing their figures itself; a
  Sonnet subagent reads diffs against the briefs. Haiku starts on these
  low-risk reruns until it has a track record.
- **Listening is batched:** one labeled album after item 28 across the
  new voices, unless a null comes out shallow enough to be worth
  hearing sooner.
**Session 6 (hands, Sonnet 5.5, high) merged items 23 (#133, v69) and
24 (#134, v70); brain-verified 2026-10-08.** A Sonnet subagent read
both diffs against the briefs: no bugs; flag-off paths, draw order and
count (tubular's five, whistle's slide), budget costs and fallbacks
unchanged; voice constants live in Rust; the 0.2 s filter tail (a fix
the hands found: the core freed the voice before the resonant lowpass
had rung out) only on filtered voices. A Haiku subagent reran: generator
tests three times pass, `--check` holds (22 of 22), and `--null` over
all 18 ported voices reproduces the hands' figures (single notes -85 to
-121 dB worst note; loops at the JS-against-JS floor, late 0). The
`.wasm` byte check and `cargo test` could not run here: **this
container's proxy refuses `static.rust-lang.org`** (policy, not a
glitch), so the pinned 1.99.0 toolchain can't be installed; GitHub
Actions' `core` job ran both, green on #133 and #134, and that is the
independent machine for now. Found while verifying: the Rust per-voice
probe over many voices runs Chromium out of memory and hangs -- a
harness fix put in front of item 25. Haiku 5.5's first job: accurate
and candid (it reported the toolchain failure and the stall plainly),
but slow (about 100 minutes, mostly the stall); fine for reruns.
Wasm 55,229 bytes; core memory 7.08 MB (the hands' figure).

**Session 7 (hands, Opus 5.5, high) merged items 25 (#136, v71) and
26 (#137, v72); brain-verified 2026-10-08.** Harness fix first: Chromium
never frees an offline context that loaded a worklet module (about
1.6 MB a render), so `measure.mjs` now splits Rust and `--null` runs
across fresh page loads and exits non-zero when the renderer crashes;
the app can't leak this way (it never renders offline; 200 cores built
and disposed on one live context stayed flat). A Sonnet subagent read
both diffs: no bugs; flag-off paths, draw orders (accordion, the winds,
panflute, temple bell, prepared's knock) and budgets unchanged; nylon's
damp handled ahead, live and late; Chromium's "a setTarget starts from
the last rendered value" rule (`reset_at`) applied only to the new
voices, so earlier ones render as before. A Haiku subagent reran:
generator tests three times, `--check` 22 of 22, `--null` over the new
voices (noise source -146 dB; voices -99 to -131 dB; loops at the floor,
late 0), and the per-voice probe through the core, which now finishes.
CI's `core` job (byte check, core tests) green on both. Wasm 81,796
bytes; core memory 10.9 MB. Haiku flagged its two probe runs (Rust and
JS) as byte-identical as suspicious; the brain's reading: expected,
since the tool prints levels to 0.1 LU and the engines differ by about
-100 dB.

**The one-frame click** (found by the hands in #137, traced by the
brain's Sonnet subagent from the code): a real defect in the
JavaScript synth, on `main` today. A noise note on the bare grid at
certain tempos plays one sample through a gain still at 1. Queued as
**item 26b**, a fix in both engines, before the drums are ported.

**Session 8 (hands, Sonnet 5.5, high) merged 26b (#139, v73), 27a
(#140, v74) and 27b (#141, v75); brain-verified 2026-10-09.** 26b: a
`--clicks` probe found 26 voices clicking on `main` and none after, on
both engines; 1.4% of noise starts landed in the window (215 of 15,340
in 200 loops). 27a/27b: bass, textures and drums play from the core,
which serves all five channels; #140 also made every core parameter
compare event times in frames (a loop at 11.3 s nulled at -38 dB
before). Performance A/B, four loops with full kits: late ticks 0 both
sides, audio thread 4-5% busier, main thread 9-13% lighter, node
creation 110/s -> 0. Wasm 106,458 bytes; core memory 10.4 MB. Only the
sung voices remain in JavaScript (not counted as fallbacks in
Diagnostics). Brain's check: a Sonnet subagent read all three diffs
(26b touched exactly the noise-fed gains, nothing else; flag-off paths,
draws, budgets, ducking and the drums channel unchanged); a Haiku
subagent reran tests three times, `--check`, `--clicks` on both engines
(no clicks) and `--null` over every new voice (-95 to -147 dB; loops at
the floor, late 0, fallback 0) and over the earlier voices. Three small
problems found, queued as **item 27c**: 26b's `value` setter misbehaves
for notes built late (offline proofs can't see it); the jingle draws
its zils twice on a fallback; pan flute grace notes regressed to a
-68.5 dBFS worst sample (was -125 at v72).

**Session 9 (hands, Opus 5.5, high) merged 27c (#143, v76) and 28
(#144, v77); brain-verified 2026-10-09. Every voice now plays from the
Rust core behind `?engine=rust`.** 27c: the -68.5 dBFS pan flute was a
core bug since item 21, not 26b or 27a: Chromium times sources to
1/1024 of a frame, the core used whole frames, so notes starting or
stopping a hair past a frame (about 1 in 2000) came out wrong in every
voice; fixed, and `--null` now starts one note in five in that window.
The 26b setter did not cut late notes in Chromium (it moves a late
note's past events to the present), but the safer form went in anyway,
for WebKit. The jingle draws 7 on a fallback. 28: vowel, hum and choir;
each singer's detune holds 13.5 s (longest sung note in 30,000 loops:
10.2 s); the formant trim is computed in JavaScript and sent (a native
host needs it ported, about 40 lines). Wasm 121,209 bytes; core memory
12.44 MB. Brain's check: a Sonnet subagent read both diffs (no bugs; the
source-timing fix goes through one `schedule` for every voice; every
`_core*` call site checks the channel before drawing; the sung draws
match in order and count, and a note over 13.5 s falls back before
drawing); a Haiku subagent reran tests three times, `--check`, `--null`
over every voice (worst note -84 dB or deeper, worst sample -89 dBFS;
12 loops late 0, fallback 0) and `--clicks` on both engines (none).
Small, unverified, for later: the core's sung step count isn't clamped
to the draws it got (only a corrupt message could exploit it); a sung
note's draws (up to about 7 KB) are cloned per message, where a
transferred `Float64Array` would avoid garbage on the audio thread; no
test plays a 13.5 s three-singer note.

**Out for listening: "Rust, all voices"** (`docs/ALBUMS.md`), ten
loops, each played with and without the flag.

**Then Mikey decides** (queue, "After item 28"): make the core the
default; move the effects and master chain into Rust (for a native or
game host, not needed for the web app); the generator's port after the
words. Not started: the word rankings, Depth two, the open decisions,
the iPhone check.

Not started, for Mikey's own time: the word rankings, Depth two, the
open decisions above, the iPhone check.

## History

One line per PR; details are in the PRs, `ROADMAP.md` and the queue's
Done list.

- **#1-#15 (to v32):** rhythm cells and `stats.mjs`; Cloudflare deploy,
  build stamp, offline fix; melody forward in the mix; `measure.mjs`;
  motif-level omission, stepwise walk, register separation; audible
  contour; anchor by transposition; phrase velocity; vowel drift; the
  choir; the glottal source (v31); slid attacks (v32).
- **#16-#18:** this file.
- **#19 (v33):** the melody starvation fix -- `keys` priced 25 -> 12, the
  soft cap made a reserve that works on lite. Lite still lost >5% of the
  melody on 12% of loops then.
- **#20 (v34):** `keys` chords had played through the melody bus since the
  app began; moved to the chords bus.
- **#21-#25:** roadmap item 13; the loudness yardstick in `measure.mjs`.
- **#26 (v35):** three level bugs -- bells took velocity twice, pad skipped
  the chord spread, rhodesbass trimmed twice.
- **#30, #31:** the balance lock; the punch figures (no metric matched the
  ear, so levels went to listening).
- **#34, #38, #40, #46 (v36-v39):** 6/8 -- chords made strict, then the
  rhythm section restored to the cross-rhythm he preferred.
- **#42:** the drum knob, a listening test, closed unmerged.
- **#48, #53 (v40, v42):** the loud leads trimmed at the source (pluck,
  saw; then ocarina, flute, whistle, moog, analoglead).
- **#51, #59 (v41, v44):** fiddle and accordion, take one (disliked) and
  take two.
- **#57, #62, #63 (v43, v45, v46):** `tide` -- profile, progressions per
  mode, drone, 3/4; waltz melodies, grace notes, harmony; waves and the
  hand kit.
- **#64, #65 (v47, v48):** the harsh leads softened; nylon with strumming,
  pan flute.
- **#66, #67 (v49, v50):** `cinder` (the Andalusian cadence spelled per
  mode), `wayfare` (the chug, with its budget fix).
- **#74, #75 (v51, v52):** grace notes shorter than the attack cut off with
  a click (pan flute, flute, ocarina, analoglead) and `--endings`; the
  nylon strum tightened.
- **#79, #82 (v53, v54):** wayfare's own drum grooves; then their variety
  back.
- **#88, #89 (v55):** the performance harness and baseline; sound polish
  (sung notes on formant peaks, 5/4 chords, arpeggios clipped).
- **#92 (v56):** composition depth, first pass.
- **#96-#108 (v57-v64):** performance wins, the temple bell, the moods,
  composition depth's second pass.
- Docs PRs from the brain are the rest of the numbers in between.
