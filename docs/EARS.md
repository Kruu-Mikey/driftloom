# Ears prototypes

Sketches from the sounds-and-ideas brain chat (2026-10-09/10), built from
what its "ears" measured on 32 of Mikey's albums. The reports live in the
Project knowledge: `claude/ears-batch-1.md`, `claude/ears-batch-2.md`,
`claude/ears-prototypes.md`, `claude/ears-tools.md`.

**Status:** draft, for listening. Every sketch is off unless the URL asks
for it, and the JavaScript engine only (not `?engine=rust`). With the
switches off, renders null against `main` at the same level as `main`
against itself (-79 dB, the wobble's run-to-run noise), and the
generator tests pass. Mikey has heard them as before/after clips: "all
the new stuff is sounding really great ... good enough for now"
(2026-10-10).

## How to listen

Add `?proto=` to the address, with one or more names separated by
commas, or `?proto=all`:

- `?proto=stereo`
- `?proto=roundBass,glass`
- `?proto=all`

## The sketches

| Name | What it does | Measured, before → after |
|---|---|---|
| `roundBass` | Bass register 36–57 instead of 28–52, never the extra octave down; soft 2nd, 3rd and 4th harmonics under a 900 Hz lowpass on every bass voice but `rhodesbass`, so the bass reads on a phone | "dust": 40–60 Hz 18% → 6% of the energy, 120–250 Hz 10% → 27% |
| `glass` | On a chord's first beat (55% of the time), two or three of its notes ring out in E5–G6 as a soft FM bell (ratio 3.5), a dotted eighth apart, into the texture channel | "thaw": 1–2 kHz 2.8% → 6.2% |
| `floorDrop` | Drift's "the whole thing stops" becomes kick and bass out for one or two bars while everything else plays on, at 0.35 a pass instead of 0.1; rests no longer fade the tails | "grove": floor drops 0 → 0.62 a minute (records: 0.42); full stops 0.62 → 0 a minute |
| `stereo` | Channels panned (chords -0.6, melody +0.5, texture -0.25, bass and drums in the middle), a ping-pong echo, reverb combs split left and right | "halcyon": side/mid -99 → -19 dB (records: -5 to -19) |
| `arc` | A second lowpass after the tone filter that breathes 300 Hz → 9 kHz → 300 Hz, lingering on the dark side, once every 120 s; echo feedback rises a little as it opens | "haven": -15 dB above 500 Hz at the closed points, unchanged when open |

All five together, 150 s: "grove" side/mid -98 → -18 dB, drift 60/10
0.97 → 1.53, 1–5 kHz 0.2% → 1.5%, 40–60 Hz 36% → 3%.

## For the brain and the hands

- These are sketches, not the build. The ears reports place stereo, bass
  and presence, and tails after item 31 (the master chain in Rust);
  build them there, in the core, using these as the reference for what
  Mikey approved by ear.
- `roundBass` and `floorDrop` change the generator: the Drift contract
  and the balance lock move. `glass` and `arc` add layers and motion.
  Each needs the usual level, refusal and balance-lock checks, and the
  arc's period should be 2–5 minutes in the app (120 s here so a demo
  clip holds a whole cycle).
- `stereo` keeps the bass and kick in the middle and the channels
  positively correlated, so a phone's single speaker sums cleanly.
