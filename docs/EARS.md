# Ears prototypes

Sketches from the sounds-and-ideas brain chat (2026-10-09/10), built from
what its "ears" measured on 32 of Mikey's albums. The reports live in the
Project knowledge: `claude/ears-batch-1.md`, `claude/ears-batch-2.md`,
`claude/ears-prototypes.md`, `claude/ears-tools.md`.

**Status:** draft, for listening. Every sketch is off unless the URL asks
for it, and the JavaScript engine only (not `?engine=rust`). With the
switches off, renders null against `main` at the same level as `main`
against itself (-79 dB, the wobble's run-to-run noise), and the
generator tests pass. Mikey heard the first five as before/after clips: "all
the new stuff is sounding really great ... good enough for now"
(2026-10-10).

## How to listen

Add `?proto=` to the address, with one or more names separated by
commas, or `?proto=all`:

- `?proto=stereo`
- `?proto=roundBass,glass`
- `?proto=all` (all nine)

## The sketches

| Name | What it does | Measured, before → after |
|---|---|---|
| `roundBass` | Bass register 36–57 instead of 28–52, never the extra octave down; soft 2nd, 3rd and 4th harmonics under a 900 Hz lowpass on every bass voice but `rhodesbass`, so the bass reads on a phone | "dust": 40–60 Hz 18% → 6% of the energy, 120–250 Hz 10% → 27% |
| `glass` | On a chord's first beat (55% of the time), two or three of its notes ring out in E5–G6 as a soft FM bell (ratio 3.5), a dotted eighth apart, into the texture channel | "thaw": 1–2 kHz 2.8% → 6.2% |
| `floorDrop` | Drift's "the whole thing stops" becomes kick and bass out for one or two bars while everything else plays on, at 0.35 a pass instead of 0.1; rests no longer fade the tails | "grove": floor drops 0 → 0.62 a minute (records: 0.42); full stops 0.62 → 0 a minute |
| `stereo` | Channels panned (chords -0.6, melody +0.5, texture -0.25, bass and drums in the middle), a ping-pong echo, reverb combs split left and right | "halcyon": side/mid -99 → -19 dB (records: -5 to -19) |
| `arc` | A second lowpass after the tone filter that breathes 300 Hz → 9 kHz → 300 Hz, lingering on the dark side, once every 120 s; echo feedback rises a little as it opens | "haven": -15 dB above 500 Hz at the closed points, unchanged when open |
| `dubStab` | After a chord's attack, a short sawtooth chord (G3–C5) through a 820 → 560 Hz bandpass, thrown hard into the echo, on the offbeat of beat one (60%) and of beat three (35%) | "undertow": the stabs and their echoes add -14 dB against the loop |
| `organ` | Soft drawbars (16', 8', 5 1/3', 4'), notes folded under G4, swelling in over 0.6 s and held until the chord changes, with a 5.4 Hz tremolo | "haven": -11 dB against the loop; 120–250 Hz 19% → 29% |
| `wash` | Two decorrelated noise loops through a bandpass sweeping 500 Hz → 2 kHz → 500 Hz, swelling in and out once every 20 s, into the texture channel | "vapor": swells peak about -10 dB against the loop |
| `longChords` | Each loop draws how long its chords last: as before (35%), twice that (30%), about 8 s (20%) or about 16 s (15%, which can hold one chord for the whole loop); three in ten shorten the progression's last chord (a turnaround). A stream of its own, so the other draws are unchanged | 400 loops, chord changes a minute (10th / median / 90th percentile): 11 / 26 / 47 → 1.4 / 14 / 37; loops under 2 a minute 2 → 42; one-chord loops 0 → 10% |

All five together, 150 s: "grove" side/mid -98 → -18 dB, drift 60/10
0.97 → 1.53, 1–5 kHz 0.2% → 1.5%, 40–60 Hz 36% → 3%.

All nine together, 150 s: "glade" side/mid -99 → -12 dB, chord changes
18.0 → 12.8 a minute, 1–5 kHz 0.2% → 1.7%, 40–60 Hz 24% → 4%; "vapor"
side/mid -79 → -2 dB (too wide: a sparse, wet loop is mostly reverb,
split left and right), chord changes 8.0 → 1.6 a minute, 1–5 kHz 0% → 14%.

`glass` scales itself down in loops with fewer than one chord a bar, so
the bells don't outweigh the chords they come from (in "vapor" they had
added 5.7 LU; now 1.3).

## For the brain and the hands

- These are sketches, not the build. The ears reports place stereo, bass
  and presence, and tails after item 31 (the master chain in Rust);
  build them there, in the core, using these as the reference for what
  Mikey approved by ear. He approved the first five; the last four
  (`dubStab`, `organ`, `wash`, `longChords`) went to him as clips on
  2026-10-10.
- `roundBass`, `floorDrop` and `longChords` change the generator: the
  Drift contract and the balance lock move. The others add layers and
  motion.
  Each needs the usual level, refusal and balance-lock checks, and the
  arc's period should be 2–5 minutes in the app (120 s here so a demo
  clip holds a whole cycle).
- `stereo` keeps the bass and kick in the middle and the channels
  positively correlated, so a phone's single speaker sums cleanly
  (left/right correlation: "halcyon" 0.97, "glade" with all nine 0.88,
  "vapor" with all nine only 0.25, the same too-wide reverb as above).
