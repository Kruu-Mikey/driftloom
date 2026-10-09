# Driftloom

A procedural loop machine. It generates relaxing, meditative and joyful
nostalgic loops, plays them forever, and lets you re-roll one layer at a
time until it's yours.

Everything is synthesized in the browser from oscillators and one noise
buffer. No samples, no libraries, no build step, nothing to download. It
runs from a single folder on a cheap Android phone.

The synth is moving to a small Rust core, compiled to WebAssembly, so the
same engine can one day run a phone app (roadmap 16). Most of the melody
and chord voices already play from it behind `?engine=rust`; without the
flag everything plays in JavaScript. The built `js/dlcore.wasm` is committed,
so there is still no build step.

Live at <https://driftloom.nowmichaelclark.workers.dev/>.

## Running it

The app uses ES modules, which browsers refuse to load over `file://`. So you
need a local server — any of these will do:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

To use it on a phone, it deploys to Cloudflare Workers as static assets.
`wrangler.jsonc` is an assets-only config — no build step, no `main` entry,
Wrangler uploads the folder. The dashboard side is Settings → Build on the
Worker: branch `main`, empty build command, deploy command
`npx wrangler deploy`, root directory `/`. Pushing to `main` deploys.

Open the live site in Chrome and use "Add to home screen" — there's a
manifest and a service worker, so after the first visit it works with no
signal at all.

The service worker is **network first**, with the cache as the offline
fallback. A deploy therefore shows up on the next cold start: close the app
from the recents switcher and reopen it, rather than returning to a
backgrounded instance. Diagnostics reports `build`, which is the way to
confirm what you are actually running; bump `BUILD` in `js/main.js` and
`CACHE` in `sw.js` together on every change.

## Using it

| | |
|---|---|
| Space | play / stop |
| N | a completely new loop |
| S | save the current one |
| 1–5 | re-roll drums, bass, keys, melody, air |

The screen is one page that never scrolls: the **card** at the top shows
what is playing (tap its name to rename it), the **viewport** in the middle
is Layers, Sound or the Library, and the **buttons** at the bottom are
previous, play and next; Library and Save; New loop and the switch between
Layers and Sound. The Library holds albums and saved loops in pages, and
under More: sharing, backups, the processor switch and Diagnostics.

**Re-roll** replaces one layer and leaves the others untouched. Re-rolling the
keys is the exception — it changes the harmony, so the bass and melody follow
it while keeping their own rhythms.

**Drift** ("Let the loop wander"; all the way left is off) makes the loop vary as it repeats: a hat drops out, a melody note
steps to its neighbor, a layer takes a bar off. It always returns to the loop
you saved, because the variations are computed fresh from the original each
pass and never written back.

**Export MIDI** writes a four-repeat type-1 file with drums on GM channel 10,
so the notes can go to a DAW, a groovebox, or anything with a MIDI in.
Whatever the browser synth sounds like, the composition itself travels.

Saving, share codes and albums, track length, playing with the screen off,
and the Diagnostics panel (Library > More) are covered in `docs/NOTES.md`, with the rest of
how it works inside.

## Profiles

A profile is a set of constraints -- tempo band, scale pool, instruments,
density, meter, form -- that move together.

| | |
|---|---|
| **Dust** | worn tape; the original voice, still the commonest draw |
| **Glade** | modal folk. Modes sharing a lowered 7th so bVII-to-I is available; harp, ocarina, flute, often 6/8 |
| **Thaw** | cold and spacious. Sparse piano, long silence, octave leaps, quartal chords, dropped steps |
| **Haven** | still and domestic. Rhodes and a hushed pad, no percussion, very slow, deliberately dry |
| **Bloom** | bright and mechanical. Mono lead with portamento through a resonant filter |
| **Vapor** | drifting. Coprime layer cycles that never resynchronize |
| **Halcyon** | warm analog nostalgia. Fat detuned pads, soft breakbeat, long dub delays |
| **Clockwork** | prepared piano. Felt-damped, faintly out of tune, the mechanism audible |
| **Shatter** | fast and fractured. Chopped breaks, stutter rolls, chromatic turns |
| **Grove** | wooden mallets. Kalimba tines and marimba bars: dry pitched percussion, which nothing else here provides |
| **Hollow** | voices. Synthetic vowels and humming, wordless and unhurried |
| **Shrine** | struck metal left to ring. Temple bowls and church bells, long decays, a lot of space between strikes |
| **Undertow** | hypnotic pulse. Steady four, very short fragments, the mix breathing against the kick |
| **Tide** | sea and island folk. Fiddle, whistle and pan flute over harp, accordion and a strummed nylon guitar; gentle loops waltz in 3/4, lively ones jig in 6/8, and about a third sit on a drone. A frame drum and tambourine in place of the kit, and the slow swell of waves |
| **Cinder** | island and volcano: fast, rhythmic, Spanish-tinged. A driving 6/8 at 120-150 bpm, some 4/4, drums in nine loops in ten with the hand kit leading; a strummed nylon guitar on the Andalusian cadence, fiddle, whistle, marimba, accordion and pan flute on top |
| **Wayfare** | the traveling music: steady, bright, moving. A walking 4/4 at 104-138 bpm, some 6/8; pan flute, fiddle, whistle and ocarina over accordion, nylon guitar and harp, and in half its loops a chug -- eighth notes on the bass, and on the brushes when brushes play -- like wheels on rails. Its own light, steady drum grooves |

These are not sixteen boxes. Every loop draws a **weight across several of
them** -- an exponential draw per profile, normalized, which is a Dirichlet
and spreads weight far more naturally than picking fractions by hand. About
78% of loops blend two to four profiles, with lopsided mixes commoner than
even ones, so a loop still sounds like it is *about* something. Pools are
unioned rather than replaced, so a mostly-Dust loop with a little Glade in
it can still reach for an ocarina.

Adding a voice to an existing pool re-renders every loop that draws from
that pool, because voices are drawn at render time from the blended pool
and one added entry shifts that draw and every random decision after it.
While the app is in testing that is allowed -- old share codes are not
protected -- and the fiddle and accordion went straight into Glade that
way. The balance lock (`stats.mjs --check`, in `docs/NOTES.md`) is what guards the
overall character when pools change.

## Project documents

- `ROADMAP.md` -- everything planned, shipped or decided against, and the
  contribution rules.
- `docs/QUEUE.md` -- the work queue Claude Code works down, with its
  standing rules and merge policy, and a Done list of what shipped.
- `docs/NOTES.md` -- how it works inside: the sound, the measurements, and
  why things are the way they are.
- `docs/BRAIN.md` -- the planning side's handoff: decisions, listening
  results, methods, current state.
- `docs/MOODS.md` -- the mood vocabulary and its draft recipes.
- `docs/ALBUMS.md` -- listening albums waiting for answers.
- `docs/perf-baseline.md` -- the live performance baseline and what came
  of it.
- `core/` -- the Rust core's source; `js/dlcore.wasm` is built from it.
- `docs/theory-sheets.md` -- music theory notes.

## License

MIT. Do what you like with it.
