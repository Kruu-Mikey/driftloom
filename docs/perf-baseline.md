# Performance baseline (v54)

Queue item 10: numbers before any overhaul. Measured with
`tools/perf.mjs` on 2026-09-26, on `main` at v54. Nothing in `js/` was
changed to take them. This is also the baseline a compiled audio engine
(roadmap item 16) has to beat: the harness drives the page only from
outside, so it measures a replacement engine the same way
(`--query engine=rust`).

## What it says

**The audio never broke.** Across 86 live runs (7 loops, full and lite,
1x/4x/6x throttling, visible and hidden, muted and profiled), the scheduler never ran dry: no
late ticks at all, even at 6x or with the tab hidden. The browser's own
glitch counter (playout fill-ins) recorded 6 single-buffer fill-ins in 86
runs, 5 of them at 6x, in the 45 s windows. The worst audio callback
reached 66 ms against a 23 ms deadline once. At 6x the throttler keeps a
whole core busy on this 4-core machine, so those few are as likely the
rig as the app. Nothing here is a dropout anyone would hear. The question
is headroom and battery, not correctness.

**Where the time goes, per second of playback, heaviest loops (7 loops
less the near-silent one), at 1x:**

| | full | lite |
|---|---:|---:|
| main thread, all of it | 71-80 ms | 72-84 ms |
| of which paint (record, pre-paint, layerize, commit) | 57-64 ms | 57-67 ms |
| of which script (all JavaScript) | 6-9 ms | 6-8 ms |
| audio thread (Web Audio rendering) | 54-95 ms | 38-63 ms |
| of which the graph that runs regardless (every layer muted) | 37 ms | 28 ms |
| renderer process, every thread | 222-273 ms | 211-252 ms |

At 6x the main thread is 373-462 ms a second, about 40% of a slow phone's
main thread, and paint is 90% of that.

1. **Paint is the main thread's biggest cost, not the music.** Every
   frame repaints the whole page: about 116 paints a second, each covering
   the full 765 x 3555 document, because the page is one paint layer and
   the cursor, the playhead lights (a 90 ms colour transition and a glow
   `box-shadow`) and the grid cells change on it every step. (Paint
   areas from the trace's Paint events, in a separate 15 s run of
   undertow-sai-soan, full, 1x.) That is
   57-67 ms/s of paint at 1x and 340-430 ms/s at 6x. The idle page, with
   nothing moving, paints nothing. This is the cheapest large win on the
   table, and it is plain HTML/CSS, nothing to do with the engine.

2. **Finished voices keep costing audio time until the garbage collector
   finds them.** No voice is disconnected when it ends. Chromium keeps
   rendering a stopped voice's gains and filters until the page's garbage
   collector drops their JavaScript objects, so live Web Audio nodes pile up
   into the thousands (2,000-3,500 at 1x, 4,000-7,500 at 6x). Forcing a
   collection every second (`--gc-every 1`) shows what that costs:

   | loop, full | audio render as it runs | with a GC every second | live nodes as it runs / with GC |
   |---|---:|---:|---:|
   | undertow-sai-soan, 1x | 87 ms/s | 49 ms/s | 2031 / 183 |
   | undertow-sai-soan, 6x | 152 ms/s | 48 ms/s | 4165 / 186 |
   | cinder-da-yoan, 1x | 95 ms/s | 53 ms/s | 3502 / 261 |
   | cinder-da-yoan, 6x | 165 ms/s | 52 ms/s | 7520 / 157 |
   | undertow-sai-soan, 1x hidden | 122 ms/s | 75 ms/s | 1274 / 376 |
   | cinder-da-yoan, 1x hidden | 162 ms/s | 111 ms/s | 2361 / 563 |

   So 40-45% of the audio thread's work at 1x, and about 70% when the main
   thread is slow (it collects less often), goes to voices that have
   already finished. Take away the always-running graph as well (37 ms/s
   full) and the notes actually sounding cost about 12-16 ms/s. The
   forced GC is a diagnostic only, not a fix; the fix belongs in the synth
   and is for a later item.

3. **A hidden tab costs the audio thread more, not less.** Hidden, the
   main thread drops to 3-9 ms/s at 1x, next to nothing as it should, but
   the audio render goes up 20-100% (undertow 87 to 122 ms/s, cinder 95 to
   162, shatter 63 to 126). With a GC every second the excess stays (49 to
   75, 53 to 111), so it is not the lingering voices. The likely cause is
   the 3 s lookahead hidden pages need: each voice's graph is built and
   wired up to 3 s before its note starts (0.3 s when visible) and rendered,
   as silence, all that time. Likely, not proven: the harness cannot change
   the lookahead to show it.

4. **Building the graph is cheap on the main thread.** From the V8
   sampling profiler (1x, 12 runs): the synth's JavaScript 0.2-0.7 ms/s,
   the Web Audio calls it makes (creating oscillators, filters and gains,
   connecting them, automating their params) 1.0-3.6 ms/s, together
   **1.2-4.2 ms/s**, 2-5% of the main thread. Generation 0.02-0.1 ms/s
   (drift re-renders once a pass); scheduling 1.6-2.4 ms/s (the worker
   clock's ticks plus the cursor's read of the audio clock); UI JavaScript
   2.7-3.4; GC 0.4-0.7. The graph churns at 35-140 nodes a second (every
   node connected once) and 60-150 param automation calls a second.

5. **Memory does not climb.** Five minutes of the heaviest loop: the JS
   heap after a forced GC goes from 1.68 to 1.86 MB, rising 0.02-0.03 MB a
   minute and levelling off. DOM nodes stay at 594. Live Web Audio nodes
   rise and fall between about 100 and 1,300 as collections come and go,
   with no trend.

6. **Tap to sound:** 240-270 ms cold (the first press, which builds the
   audio context and the whole synth) and 70-95 ms warm at 1x; 400-470 ms
   cold at 6x. These are measured to the output by the browser's own
   output timestamp. The rig's output adds about 70 ms of latency of its
   own; a phone's differs (and Bluetooth adds far more).

7. **Page weight: 714 KB on a first visit, 458 KB gzipped**, service
   worker precache included. The keepalive audio is 334 KB of it (71% of
   the gzipped total): the service worker precaches both
   `keepalive.flac` (94 KB) and `keepalive.wav` (240 KB), though only one
   plays. The code is 363 KB (116 KB gzipped); `generator.js` and
   `synth.js` are 109 and 107 KB. Each script is fetched twice on a first
   visit, once by the page and once by the precache.

## What a compiled engine could save

The point of the split, for roadmap item 16:

- **Graph construction on the main thread:** 1.2-4.2 ms/s at 1x, about
  0.1-0.4% of a core; perhaps 1-3% of a slow phone's. Small.
- **The audio thread:** 38-95 ms/s at 1x (4-10% of this machine's core;
  on a phone's efficiency core 5-10x slower, most of one). This is the
  large number, and most of it is not the sound: 40-70% is finished voices
  waiting for collection (point 2), 25-45% is the graph that runs regardless
  (reverb combs, delays, bus), and the notes themselves are 12-16 ms/s. A
  preallocated voice pool in a worklet (item 13's design) would not have
  the first cost at all, nor the hidden-tab excess. But the first can also
  be removed in JavaScript by disconnecting each voice when it ends, which
  would take the audio thread from 54-95 to about 49-53 ms/s on these
  loops without a new engine.
- **The UI:** paint is 75-85% of the main thread and no engine touches it.

## Caveats

- One machine, one browser. The absolute figures are this container's;
  the ratios (paint against script, lingering against live voices,
  hidden against visible) are what should travel.
- Tracing adds a little to both threads; the profiler adds a little more
  in the split runs (their audio figures differ a few ms/s from the matrix
  runs for that reason, and because each run is a separate browser).
- Throttling slows only the main thread, and inflates whole-process CPU,
  so the renderer-CPU column means something at 1x only.
- The live-node and "graph that runs regardless" figures come from the
  heaviest loop; lighter loops pile up fewer nodes.

## How it was measured

`node tools/perf.mjs --seconds 45 --hidden-seconds 30` (queue item 10). The
real page, served from this folder, in headless Chromium, driven over the
DevTools protocol: a trusted click on Play, the loop loaded through "Paste
a code", "Let the loop wander" on, and nothing in `js/` touched. Each run is
a fresh browser with a fresh profile. After a cold press (the first loop
the page draws, fixed by seeding `Math.random` until the page's modules have
run), a stop and a warm press, the fixed loop is pasted, played for 8 s,
and then measured for 45 s (30 s hidden). The full method, figure by
figure, is at the top of `tools/perf.mjs`.

What the rig is, because it colours every number:

- **Machine:** a 4-core cloud container, no GPU, Chromium 141 (the build
  Playwright installs), `--headless=new`. Audio goes to Chromium's fake
  output device, which pulls the graph in real time on the audio thread
  exactly as a sound card would, with buffers of 1024 frames at 44.1 kHz
  (a 23.2 ms deadline per callback) and about 70 ms of output latency.
- **Throttling** (`Emulation.setCPUThrottlingRate`) slows the page's main
  thread by the factor given. It does not slow the audio thread, and it
  makes whole-process CPU meaningless (the throttler's own time lands in
  it), so renderer CPU is quoted at 1x only. Read 4x and 6x as "the main
  thread of a slow phone with this machine's audio thread"; for the audio
  thread on a phone, scale the 1x figure (a low-end Android efficiency core
  is roughly 5-10x slower than this machine's).
- **Paint** here is software paint recording on the main thread, and the
  raster that follows it runs on the compositor's threads; a phone's GPU
  rasters, but it records paint on the main thread just the same.
- **Tracing is on** during every measured window (for the audio thread and
  paint), and the V8 sampling profiler only in the "split" runs. Both add a
  little overhead of their own.

The fixed set (`LOOPS` in `tools/perf.mjs`, share codes, so a future engine
plays exactly these). Chosen with `--pick`: from corpus seed 1 (3000
loops) each profile's busiest loop by notes a second, the two longest forms
and the median loop were screened live for 20 s each at 1x, full quality,
and the heaviest by audio render kept, with the churn leaders, a long loop
and the longest form beside them:

| name | bars | bpm | why |
|---|---:|---:|---|
| undertow-sai-soan | 2 | 125 | the heaviest audio render in the screen (86.9 ms/s at 1x, full) |
| tide-rer-woa | 2 | 137 | second heaviest render; 109 nodes a second |
| hollow-laith-hu | 4 | 105 | the sung voices: heavy render (81.1 ms/s) |
| cinder-da-yoan | 8 | 147 | the most graph churn: 130 nodes a second, 147 bpm |
| shatter-glein-fei | 2 | 164 | fast and fractured: 164 bpm, 126 nodes a second |
| undertow-vith-glour | 32 | 131 | a 32-bar loop, the corpus median by notes a second |
| vapor-vui-thoum | 32 | 41 | the longest form in the corpus: 32 bars at 41 bpm, 187 s a pass, nearly silent |

## The figures

#### Page weight, cold first visit

| file | bytes | gzip | requests |
|---|---:|---:|---:|
| /audio/keepalive.wav | 240044 | 240044 | 1 |
| /js/generator.js | 108840 | 36407 | 2 |
| /js/synth.js | 107319 | 30539 | 2 |
| /audio/keepalive.flac | 93540 | 93540 | 1 |
| /js/main.js | 32129 | 9209 | 2 |
| /js/characters.js | 28369 | 7990 | 2 |
| /js/cover.js | 24146 | 8394 | 2 |
| /js/engine.js | 16041 | 5557 | 2 |
| /css/style.css | 11775 | 3156 | 2 |
| /js/share.js | 10707 | 3930 | 2 |
| /js/ui.js | 8771 | 3195 | 2 |
| /js/media.js | 6261 | 2336 | 2 |
| /icons/icon-512.png | 6186 | 6186 | 1 |
| /js/midi.js | 6173 | 2434 | 2 |
| /index.html | 5982 | 1920 | 2 |
| /js/storage.js | 5675 | 1885 | 2 |
| /icons/maskable-512.png | 5406 | 5406 | 1 |
| /js/theory.js | 4514 | 1861 | 2 |
| /js/rng.js | 2306 | 1067 | 2 |
| /sw.js | 2304 | 1063 | 1 |
| /icons/icon-192.png | 2062 | 2062 | 2 |
| /js/clock.js | 1891 | 840 | 2 |
| /manifest.webmanifest | 585 | 293 | 2 |

Total 713.9 KB sent (458.3 KB gzipped), service worker controlling; DOMContentLoaded 142 ms, load 144 ms, first contentful paint 68 ms (local server).

#### The page open, nothing playing (per second)

| quality | throttle | renderer CPU ms | main thread ms | script ms | layout+style ms | paint ms | long tasks |
|---|---:|---:|---:|---:|---:|---:|---:|
| full | 1x | 6 | 3.4 | 0.3 | 0.2 | 0.0 | 0 |
| full | 4x | 854 | 11.4 | 1.5 | 0.6 | 0.0 | 0 |
| full | 6x | 926 | 15.4 | 1.7 | 0.8 | 0.0 | 0 |
| lite | 1x | 6 | 3.3 | 0.3 | 0.2 | 0.0 | 0 |
| lite | 4x | 853 | 10.7 | 1.4 | 0.7 | 0.0 | 0 |
| lite | 6x | 921 | 15.6 | 2.0 | 0.9 | 0.0 | 0 |

#### Playing, visible (per second of playback)

| loop | quality | throttle | late ticks | worst late ms | device fill-ins | audio render ms | worst callback ms | renderer CPU ms | main thread ms | script ms | layout+style ms | paint ms | long tasks | nodes/s | connects/s | param calls/s | tap to sound ms (cold / warm) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undertow-sai-soan | full | 1x | 0 | 0 | 0 | 87.4 | 7.1 / 4.7 | 261 | 76.3 | 7.2 | 4.9 | 60.7 | 0 | 75 | 75 | 82 | 251 / 83 |
| undertow-sai-soan | full | 4x | 0 | 0 | 0 | 95.6 | 6.5 / 4.9 | 1106 | 308.2 | 28.3 | 22.5 | 277.5 | 0 | 74 | 74 | 80 | 323 / 96 |
| undertow-sai-soan | full | 6x | 0 | 0 | 1 | 151.9 | 39.7 / 7.4 | 1225 | 422.8 | 38.0 | 30.2 | 388.7 | 0 | 76 | 76 | 83 | 413 / 85 |
| undertow-sai-soan | lite | 1x | 0 | 0 | 0 | 63.4 | 4.5 / 3.0 | 252 | 83.8 | 7.3 | 5.7 | 67.1 | 0 | 52 | 52 | 65 | 255 / 81 |
| undertow-sai-soan | lite | 4x | 0 | 0 | 0 | 53.0 | 4.1 / 2.7 | 1048 | 258.6 | 22.8 | 16.6 | 231.5 | 0 | 52 | 52 | 65 | 345 / 73 |
| undertow-sai-soan | lite | 6x | 0 | 0 | 0 | 57.1 | 4.7 / 2.8 | 1123 | 383.5 | 36.2 | 24.6 | 346.2 | 0 | 52 | 52 | 65 | 404 / 89 |
| tide-rer-woa | full | 1x | 0 | 0 | 0 | 78.7 | 7.1 / 4.3 | 242 | 70.8 | 6.9 | 4.6 | 56.5 | 0 | 104 | 104 | 122 | 249 / 73 |
| tide-rer-woa | full | 4x | 0 | 0 | 0 | 84.6 | 6.0 / 4.6 | 1084 | 288.9 | 26.0 | 20.2 | 258.9 | 0 | 106 | 106 | 124 | 341 / 75 |
| tide-rer-woa | full | 6x | 0 | 0 | 1 | 106.3 | 12.2 / 6.4 | 1167 | 384.5 | 35.3 | 27.3 | 351.9 | 0 | 105 | 105 | 123 | 397 / 78 |
| tide-rer-woa | lite | 1x | 0 | 0 | 0 | 56.6 | 6.6 / 2.9 | 242 | 81.3 | 7.2 | 5.2 | 65.3 | 0 | 80 | 80 | 105 | 240 / 88 |
| tide-rer-woa | lite | 4x | 0 | 0 | 0 | 57.5 | 5.6 / 3.3 | 1068 | 297.9 | 25.3 | 22.2 | 266.7 | 0 | 79 | 79 | 103 | 361 / 80 |
| tide-rer-woa | lite | 6x | 0 | 0 | 2 | 55.5 | 66.3 / 3.0 | 1127 | 405.4 | 35.6 | 28.9 | 368.6 | 0 | 81 | 81 | 104 | 438 / 97 |
| hollow-laith-hu | full | 1x | 0 | 0 | 0 | 82.1 | 5.7 / 4.3 | 253 | 75.2 | 7.1 | 4.8 | 59.0 | 0 | 73 | 73 | 101 | 272 / 91 |
| hollow-laith-hu | full | 4x | 0 | 0 | 0 | 101.2 | 18.9 / 5.1 | 1092 | 276.2 | 27.5 | 19.1 | 247.4 | 0 | 87 | 87 | 119 | 353 / 73 |
| hollow-laith-hu | full | 6x | 0 | 0 | 0 | 99.8 | 42.4 / 5.0 | 1159 | 372.9 | 36.6 | 25.5 | 338.2 | 0 | 86 | 86 | 117 | 473 / 79 |
| hollow-laith-hu | lite | 1x | 0 | 0 | 0 | 57.1 | 5.6 / 2.5 | 223 | 72.6 | 6.7 | 4.7 | 57.7 | 0 | 58 | 58 | 81 | 272 / 75 |
| hollow-laith-hu | lite | 4x | 0 | 0 | 0 | 63.9 | 5.2 / 2.9 | 1061 | 281.4 | 26.6 | 19.0 | 250.4 | 0 | 57 | 57 | 81 | 322 / 85 |
| hollow-laith-hu | lite | 6x | 0 | 0 | 0 | 60.1 | 10.2 / 2.6 | 1119 | 381.8 | 35.2 | 26.6 | 343.1 | 0 | 57 | 57 | 81 | 408 / 95 |
| cinder-da-yoan | full | 1x | 0 | 0 | 0 | 95.2 | 13.3 / 5.1 | 273 | 80.4 | 8.6 | 5.3 | 64.3 | 0 | 135 | 135 | 124 | 253 / 80 |
| cinder-da-yoan | full | 4x | 0 | 0 | 0 | 169.0 | 19.4 / 9.0 | 1183 | 328.9 | 34.9 | 23.8 | 285.9 | 0 | 137 | 137 | 126 | 332 / 91 |
| cinder-da-yoan | full | 6x | 0 | 0 | 0 | 165.2 | 12.7 / 9.1 | 1252 | 459.9 | 48.5 | 34.2 | 406.8 | 0 | 138 | 138 | 125 | 400 / 82 |
| cinder-da-yoan | lite | 1x | 0 | 0 | 0 | 60.8 | 5.0 / 3.0 | 230 | 75.1 | 7.7 | 5.0 | 60.9 | 0 | 101 | 101 | 96 | 252 / 85 |
| cinder-da-yoan | lite | 4x | 0 | 0 | 0 | 59.8 | 17.8 / 2.8 | 1062 | 281.3 | 27.8 | 19.7 | 247.5 | 0 | 105 | 105 | 101 | 332 / 79 |
| cinder-da-yoan | lite | 6x | 0 | 0 | 1 | 84.7 | 43.7 / 5.0 | 1158 | 404.8 | 39.2 | 28.9 | 362.7 | 0 | 105 | 105 | 102 | 420 / 101 |
| shatter-glein-fei | full | 1x | 0 | 0 | 0 | 63.1 | 4.1 / 2.7 | 233 | 74.7 | 8.5 | 5.1 | 59.1 | 0 | 122 | 122 | 150 | 262 / 88 |
| shatter-glein-fei | full | 4x | 0 | 0 | 0 | 62.2 | 5.6 / 2.5 | 1061 | 285.0 | 31.1 | 21.9 | 244.8 | 0 | 123 | 123 | 150 | 365 / 88 |
| shatter-glein-fei | full | 6x | 0 | 0 | 0 | 64.4 | 6.2 / 3.3 | 1145 | 438.1 | 47.7 | 33.6 | 375.3 | 0 | 124 | 124 | 151 | 406 / 97 |
| shatter-glein-fei | lite | 1x | 0 | 0 | 0 | 45.1 | 4.4 / 1.9 | 211 | 72.4 | 7.6 | 5.2 | 57.4 | 0 | 98 | 98 | 116 | 264 / 72 |
| shatter-glein-fei | lite | 4x | 0 | 0 | 0 | 45.3 | 11.0 / 1.9 | 1046 | 277.4 | 28.7 | 21.0 | 239.5 | 0 | 98 | 98 | 117 | 329 / 92 |
| shatter-glein-fei | lite | 6x | 0 | 0 | 0 | 45.5 | 6.0 / 2.0 | 1120 | 411.3 | 44.5 | 30.9 | 354.9 | 1 | 100 | 100 | 119 | 443 / 82 |
| undertow-vith-glour | full | 1x | 0 | 0 | 0 | 53.9 | 13.3 / 2.6 | 222 | 73.2 | 6.1 | 4.5 | 61.4 | 0 | 48 | 48 | 82 | 267 / 83 |
| undertow-vith-glour | full | 4x | 0 | 0 | 0 | 54.7 | 5.8 / 2.4 | 1056 | 286.0 | 23.4 | 18.9 | 266.1 | 0 | 48 | 48 | 83 | 387 / 95 |
| undertow-vith-glour | full | 6x | 0 | 0 | 0 | 58.5 | 9.4 / 2.9 | 1140 | 461.6 | 36.7 | 32.3 | 431.0 | 0 | 48 | 48 | 82 | 429 / 87 |
| undertow-vith-glour | lite | 1x | 0 | 0 | 0 | 37.7 | 14.1 / 1.9 | 211 | 76.5 | 6.2 | 4.9 | 64.7 | 0 | 35 | 35 | 60 | 266 / 70 |
| undertow-vith-glour | lite | 4x | 0 | 0 | 0 | 35.2 | 9.0 / 1.6 | 1039 | 279.6 | 21.0 | 18.4 | 259.3 | 0 | 35 | 35 | 60 | 345 / 86 |
| undertow-vith-glour | lite | 6x | 0 | 0 | 0 | 37.1 | 3.4 / 1.9 | 1105 | 413.4 | 33.2 | 26.7 | 386.1 | 0 | 35 | 35 | 60 | 444 / 110 |
| vapor-vui-thoum | full | 1x | 0 | 0 | 0 | 37.3 | 3.7 / 1.5 | 135 | 39.3 | 4.3 | 1.8 | 23.7 | 0 | 6 | 6 | 11 | 248 / 93 |
| vapor-vui-thoum | full | 4x | 0 | 0 | 0 | 39.4 | 7.4 / 1.9 | 970 | 147.0 | 14.9 | 8.2 | 104.2 | 0 | 6 | 6 | 11 | 346 / 72 |
| vapor-vui-thoum | full | 6x | 0 | 0 | 0 | 38.2 | 5.3 / 1.7 | 1049 | 197.1 | 19.6 | 11.1 | 140.6 | 0 | 6 | 6 | 11 | 453 / 86 |
| vapor-vui-thoum | lite | 1x | 0 | 0 | 0 | 31.4 | 7.8 / 1.3 | 131 | 39.4 | 4.1 | 1.8 | 23.6 | 0 | 5 | 5 | 9 | 239 / 85 |
| vapor-vui-thoum | lite | 4x | 0 | 0 | 0 | 30.4 | 4.0 / 1.3 | 962 | 136.2 | 13.0 | 6.9 | 97.6 | 0 | 5 | 5 | 9 | 364 / 73 |
| vapor-vui-thoum | lite | 6x | 0 | 0 | 0 | 30.8 | 4.4 / 1.3 | 1039 | 202.3 | 20.0 | 10.7 | 146.9 | 0 | 5 | 5 | 9 | 430 / 86 |

"worst callback" is the slowest audio render callback, then the 99th percentile, against a deadline of one buffer.

#### Playing, tab hidden (per second of playback)

| loop | quality | throttle | visibility | late ticks | worst late ms | device fill-ins | audio render ms | renderer CPU ms | main thread ms | script ms | paint ms | nodes/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undertow-sai-soan | full | 1x | hidden | 0 | 0 | 0 | 122.3 | 144 | 6.5 | 2.5 | 0.0 | 74 |
| undertow-sai-soan | full | 6x | hidden | 0 | 0 | 0 | 119.1 | 1050 | 32.9 | 15.2 | 0.0 | 73 |
| undertow-sai-soan | lite | 1x | hidden | 0 | 0 | 0 | 78.5 | 101 | 6.3 | 2.0 | 0.0 | 52 |
| undertow-sai-soan | lite | 6x | hidden | 0 | 0 | 0 | 76.4 | 1009 | 29.7 | 13.5 | 0.0 | 53 |
| tide-rer-woa | full | 1x | hidden | 0 | 0 | 0 | 125.4 | 148 | 7.0 | 2.4 | 0.0 | 103 |
| tide-rer-woa | full | 6x | hidden | 0 | 0 | 0 | 126.0 | 1059 | 36.1 | 17.3 | 0.0 | 103 |
| tide-rer-woa | lite | 1x | hidden | 0 | 0 | 0 | 86.1 | 108 | 6.3 | 2.3 | 0.0 | 81 |
| tide-rer-woa | lite | 6x | hidden | 0 | 0 | 0 | 92.0 | 1027 | 41.1 | 17.7 | 0.0 | 79 |
| hollow-laith-hu | full | 1x | hidden | 0 | 0 | 0 | 112.5 | 135 | 6.6 | 2.3 | 0.0 | 70 |
| hollow-laith-hu | full | 6x | hidden | 0 | 0 | 0 | 107.0 | 1041 | 35.4 | 17.2 | 0.0 | 71 |
| hollow-laith-hu | lite | 1x | hidden | 0 | 0 | 0 | 74.9 | 97 | 5.9 | 2.0 | 0.0 | 55 |
| hollow-laith-hu | lite | 6x | hidden | 0 | 0 | 0 | 75.8 | 1012 | 31.2 | 13.7 | 0.0 | 55 |
| cinder-da-yoan | full | 1x | hidden | 0 | 0 | 0 | 162.0 | 187 | 7.9 | 3.1 | 0.0 | 137 |
| cinder-da-yoan | full | 6x | hidden | 0 | 0 | 0 | 166.7 | 1102 | 43.1 | 22.2 | 0.0 | 140 |
| cinder-da-yoan | lite | 1x | hidden | 0 | 0 | 0 | 105.5 | 128 | 7.2 | 2.8 | 0.0 | 106 |
| cinder-da-yoan | lite | 6x | hidden | 0 | 0 | 0 | 101.8 | 1038 | 38.5 | 19.1 | 0.0 | 107 |
| shatter-glein-fei | full | 1x | hidden | 0 | 0 | 0 | 125.9 | 153 | 8.8 | 3.7 | 0.0 | 123 |
| shatter-glein-fei | full | 6x | hidden | 0 | 0 | 0 | 115.8 | 1049 | 44.5 | 23.8 | 0.0 | 116 |
| shatter-glein-fei | lite | 1x | hidden | 0 | 0 | 0 | 84.8 | 110 | 7.6 | 2.8 | 0.0 | 95 |
| shatter-glein-fei | lite | 6x | hidden | 0 | 0 | 0 | 87.5 | 1026 | 42.1 | 21.0 | 0.0 | 98 |
| undertow-vith-glour | full | 1x | hidden | 0 | 0 | 0 | 69.5 | 91 | 5.6 | 2.1 | 0.0 | 49 |
| undertow-vith-glour | full | 6x | hidden | 0 | 0 | 0 | 67.7 | 1003 | 30.1 | 13.6 | 0.0 | 48 |
| undertow-vith-glour | lite | 1x | hidden | 0 | 0 | 0 | 48.2 | 70 | 5.3 | 1.8 | 0.0 | 35 |
| undertow-vith-glour | lite | 6x | hidden | 0 | 0 | 0 | 46.8 | 984 | 27.5 | 12.4 | 0.0 | 35 |
| vapor-vui-thoum | full | 1x | hidden | 0 | 0 | 0 | 44.2 | 64 | 3.4 | 0.7 | 0.0 | 8 |
| vapor-vui-thoum | full | 6x | hidden | 0 | 0 | 0 | 43.0 | 978 | 17.8 | 4.6 | 0.0 | 7 |
| vapor-vui-thoum | lite | 1x | hidden | 0 | 0 | 0 | 34.7 | 53 | 3.4 | 0.7 | 0.0 | 6 |
| vapor-vui-thoum | lite | 6x | hidden | 0 | 0 | 0 | 35.3 | 969 | 18.3 | 4.2 | 0.0 | 6 |

#### Playing with every layer muted: the graph that runs regardless (per second)

| loop | quality | audio render ms | renderer CPU ms | main thread ms | script ms | nodes/s |
|---|---:|---:|---:|---:|---:|---:|
| undertow-sai-soan | full | 36.5 | 213 | 76.0 | 4.8 | 0 |
| undertow-sai-soan | lite | 28.2 | 206 | 76.4 | 4.8 | 0 |

#### Where the main thread goes (ms per second of playback, V8 sampling profiler)

| loop | quality | throttle | generation | scheduling | synth JS | Web Audio calls | GC | UI JS | browser (layout, paint, tasks) | other JS | harness | audio render (own thread) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undertow-sai-soan | full | 1x | 0.06 | 2.00 | 0.53 | 2.22 | 0.58 | 3.36 | 84.89 | 0.00 | 0.17 | 88.9 |
| undertow-sai-soan | lite | 1x | 0.07 | 2.00 | 0.29 | 1.78 | 0.42 | 2.96 | 84.29 | 0.00 | 0.13 | 62.1 |
| tide-rer-woa | full | 1x | 0.06 | 1.96 | 0.41 | 2.16 | 0.51 | 2.70 | 81.68 | 0.00 | 0.12 | 81.8 |
| tide-rer-woa | lite | 1x | 0.05 | 2.09 | 0.52 | 2.04 | 0.45 | 2.85 | 87.04 | 0.01 | 0.11 | 57.0 |
| hollow-laith-hu | full | 1x | 0.03 | 1.76 | 0.39 | 1.92 | 0.57 | 2.92 | 76.78 | 0.00 | 0.09 | 89.7 |
| hollow-laith-hu | lite | 1x | 0.02 | 1.68 | 0.34 | 1.85 | 0.55 | 3.34 | 73.35 | 0.00 | 0.10 | 57.2 |
| cinder-da-yoan | full | 1x | 0.08 | 2.36 | 0.55 | 3.60 | 0.74 | 3.28 | 87.71 | 0.02 | 0.13 | 113.0 |
| cinder-da-yoan | lite | 1x | 0.05 | 1.63 | 0.46 | 2.49 | 0.59 | 3.21 | 81.53 | 0.00 | 0.17 | 60.6 |
| shatter-glein-fei | full | 1x | 0.04 | 1.80 | 0.73 | 2.95 | 0.51 | 3.08 | 79.10 | 0.00 | 0.16 | 63.1 |
| shatter-glein-fei | lite | 1x | 0.10 | 2.06 | 0.58 | 2.71 | 0.50 | 3.30 | 85.52 | 0.01 | 0.15 | 47.2 |
| undertow-vith-glour | full | 1x | 0.02 | 1.84 | 0.40 | 1.17 | 0.38 | 2.78 | 75.05 | 0.00 | 0.06 | 52.4 |
| undertow-vith-glour | lite | 1x | 0.02 | 1.95 | 0.18 | 1.01 | 0.46 | 2.77 | 87.48 | 0.05 | 0.07 | 36.8 |
| vapor-vui-thoum | full | 1x | 0.02 | 1.66 | 0.16 | 0.17 | 0.34 | 2.63 | 46.20 | 0.01 | 0.02 | 43.2 |
| vapor-vui-thoum | lite | 1x | 0.02 | 2.04 | 0.10 | 0.12 | 0.42 | 2.64 | 45.54 | 0.03 | 0.05 | 34.7 |

Web Audio calls, mean ms per second across those runs: createOscillator 0.50, createBiquadFilter 0.40, createGain 0.35, connect 0.29, createBufferSource 0.22, setValueAtTime 0.04, start 0.03, exponentialRampToValueAtTime 0.03, linearRampToValueAtTime 0.00, setTargetAtTime 0.00, stop 0.00.

#### Memory over a long run (after a forced GC at each reading)

| loop | quality | minutes | heap MB start | heap MB end | heap MB/min | live audio handlers start / end | handlers/min | DOM nodes start / end |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| undertow-sai-soan | full | 5 | 1.68 | 1.86 | 0.02 | 658 / 127 | -0.8 | 594 / 594 |
| undertow-sai-soan | lite | 5 | 1.67 | 1.87 | 0.03 | 451 / 872 | 7.0 | 594 / 594 |
