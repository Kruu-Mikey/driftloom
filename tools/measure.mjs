// Offline audio measurement for the generator.
//
// Run with:  node tools/measure.mjs [--n 20] [--seed 1] [--passes 3]
//
// This is the audio half of roadmap item 1; `tools/stats.mjs` is the
// generation half. It renders loops offline and reports what actually came
// out of the bus: peak, RMS, full-scale sample count, and the dry level of
// each layer so the balance between them can be measured rather than read
// off the gain table and hoped for. Beside those, K-weighted loudness
// (ITU-R BS.1770) and loudness range per loop, and what the master chain's
// compressor and ceiling are doing to each one -- roadmap item 13's
// yardstick, because raw RMS over-counts bass and the ear does not.
//
// Every render seeds Math.random from the loop (or the note) it is
// rendering. The synth draws noise, jitter and drift from it, so without
// that the same seed gave slightly different numbers on every run; with it,
// same seed, same numbers, and the two renders of one loop that the chain
// comparison needs differ by the chain and nothing else. "Same" to within a
// thousandth of a dB, not to the bit: Chromium does not fix the order it
// adds a node's inputs in, and float addition is not associative, so where
// several sources meet in one node the last few bits move between runs.
// Every figure printed in dB or LU comes out the same; the last digit of a
// four-place linear peak can flip when it sits on a rounding boundary.
//
// Web Audio does not exist in Node, and a reimplementation of the graph
// would measure the reimplementation. So the real `Synth` and the real
// `Engine` are driven against an `OfflineAudioContext` inside headless
// Chromium: same nodes, same envelopes, same saturator, same ceiling, same
// scheduling code that runs when you press play. Nothing here is a model of
// the app; it is the app, rendered faster than real time.
//
// Requires Playwright and a Chromium build:
//
//   npm install -g playwright && npx playwright install chromium
//
// That is a developer dependency of this one tool, not of Driftloom -- the
// app itself still has no build step and still runs from a folder.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CHARACTERS } from '../js/characters.js';
import { newSpec, render } from '../js/generator.js';
import { Rng } from '../js/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Layers in the order the mix is usually talked about, loudest first.
const LAYERS = ['drums', 'bass', 'chords', 'melody', 'texture'];
const LAYER_LABELS = {
  drums: 'drums', bass: 'bass', chords: 'keys', melody: 'melody', texture: 'air',
};

const USAGE = `
driftloom offline audio measurement

  node tools/measure.mjs [options]

  --n <count>       how many loops to render           (default 20)
  --seed <number>   corpus seed; same seed, same loops  (default 1)
  --passes <count>  full passes of each loop to render   (default 3)
  --rate <hz>       sample rate                      (default 44100)
  --quality <q>     'full' or 'lite'                   (default full)
  --port <n>        port for the local file server     (default 8731)
  --chrome <path>   an explicit Chromium executable
  --jobs <count>    renders in flight at once             (default 4)
  --no-chain        skip the second, chain-bypassed render of each loop
  --json <file>     also write every figure, per loop or per note, as JSON
  --voice <names>   per-voice probe instead of the corpus report; 'all'
                    probes every voice characters.js draws, by layer
  --note <seconds>  how long each probed note is held       (default 1.6)
  --refusals [code] count voice-budget refusals per layer
  --endings         check that every note of every voice fades out
  --profile <id>    keep only loops that profile leads, drawing from the
                    same corpus until --n of them are in
  --selftest        check the loudness meter against reference signals
  --help            this

  The corpus report adds K-weighted loudness to peak and RMS: integrated
  loudness (LUFS) and loudness range (LRA) per loop, per ITU-R BS.1770 and
  EBU Tech 3342, with the bus measured as one channel at weight 1.0 because
  it is mono. Crest is sample peak minus integrated loudness. Beside them,
  the punch figures, for the mix and the drums layer alone: the loudest
  momentary (400ms) and short-term (3s) loudness, the 95th percentile of
  momentary, and PSR, sample peak minus the loudest short-term. Each loop is
  rendered a second time with the master compressor and ceiling routed
  around -- in this harness only -- and the difference is what the chain
  does to that loop. Same --seed, same numbers, whatever --jobs is.

  --refusals reports what the voice budget turned away, layer by layer,
  through the real Engine and Synth. Given a share code it reports that
  one loop; given nothing it draws a corpus and reports the distribution
  of per-loop melody refusal rates, because a mean hides the loops where
  the tune is actually being eaten.

  --profile narrows the corpus, for the loudness report and for
  --refusals, to the loops one profile leads: the ones the by-profile table
  would have counted for it, only n of them rather than the handful a
  mixed corpus of n holds. Its median is what that table's row sets
  against the catalogue.

  --voice takes a comma-separated list (--voice vowel,hum,kalimba) and
  reports, for each one, the share of its A-weighted energy that lands in
  the 2-5kHz presence band, note by note across two octaves. That band is
  where hearing is most sensitive and where a voice reads as harsh, so the
  figure is a stand-in for "how much does this one grate". It is a
  comparison between voices, not an absolute: what makes it useful is
  putting a voice next to one nobody complains about.

  It also reports each voice's K-weighted loudness, note by note at
  velocities 0.4 and 0.8, in every layer characters.js draws it for and
  through that layer's own path in the engine. Every figure is in LU
  against kalimba as a melody at the same velocity. With 'all', each voice
  is also set against the rest of its layer and the outliers are listed.

  --endings plays one note of every voice characters.js draws, in each
  layer that draws it, at 0.1, 0.4 and 1.6 s, and a melody voice at 30 ms
  as well, the length of a grace. It reads the most sudden fall in each
  note's level: a release, however fast, falls about as much from one
  short window to the next as from the one before, and a note cut off
  while still sounding falls all at once. Any over 12 dB is listed, and
  the run exits non-zero. It was written for a
  pan flute grace that swelled to full, held and was cut off 0.4 s later
  -- heard as static under the note it led into -- and it catches it.

  Needs Playwright and Chromium, which are a dependency of this tool and
  not of the app:  npm install -g playwright && npx playwright install chromium
`;

// ------------------------------------------------------------ arguments

function fail(message) {
  console.error(`measure: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    n: 20, seed: 1, passes: 3, rate: 44100, quality: 'full', port: 8731, chrome: null,
    jobs: 4, chain: true, json: null, voices: null, note: 1.6, refusals: null, selftest: false,
    profile: null, endings: false,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline = null;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const value = () => {
      if (inline != null) return inline;
      const next = argv[++i];
      if (next == null) fail(`${arg} needs a value`);
      return next;
    };
    const number = () => {
      const v = Number(value());
      if (!Number.isFinite(v)) fail(`${arg} needs a number`);
      return v;
    };
    switch (arg) {
      case '--n': case '-n': opts.n = Math.max(1, Math.round(number())); break;
      case '--seed': opts.seed = number() >>> 0; break;
      case '--passes': opts.passes = Math.max(1, number()); break;
      case '--rate': opts.rate = Math.max(8000, Math.round(number())); break;
      case '--quality': opts.quality = value() === 'lite' ? 'lite' : 'full'; break;
      case '--port': opts.port = Math.round(number()); break;
      case '--chrome': opts.chrome = value(); break;
      case '--jobs': opts.jobs = Math.max(1, Math.round(number())); break;
      case '--no-chain': opts.chain = false; break;
      case '--json': opts.json = value(); break;
      case '--selftest': opts.selftest = true; break;
      case '--endings': opts.endings = true; break;
      case '--note': opts.note = Math.max(0.05, number()); break;
      case '--voice':
        opts.voices = value().split(',').map((v) => v.trim()).filter(Boolean);
        if (!opts.voices.length) fail('--voice needs at least one voice name');
        break;
      case '--refusals': {
        // Optional: a share code to inspect, or nothing for a corpus.
        const next = inline != null ? inline : argv[i + 1];
        if (inline == null && next != null && !String(next).startsWith('--')) i++;
        opts.refusals = (inline != null || (next != null && !String(next).startsWith('--')))
          ? String(next) : 'corpus';
        break;
      }
      case '--profile':
        opts.profile = value();
        if (!CHARACTERS[opts.profile]) fail(`no profile called '${opts.profile}'`);
        break;
      case '--help': case '-h': console.log(USAGE); process.exit(0); break;
      default: fail(`unknown option ${arg}`);
    }
  }
  return opts;
}

// ------------------------------------------------------------- loudness
//
// ITU-R BS.1770-4 integrated loudness, and EBU Tech 3342 loudness range.
// Written as plain functions so the same source runs here, for --selftest,
// and inside the pages below, where the audio is: they are pasted into the
// page with toString() and must not reach for anything outside themselves.

// K-weighting: a high-frequency shelf, then the RLB highpass. The standard
// publishes coefficients for 48k only; these are its analogue prototypes
// through the bilinear transform, which reproduce the published 48k figures
// and hold at 44.1k, the rate everything here renders at by default.
function kWeighting(rate) {
  let K = Math.tan(Math.PI * 1681.974450955533 / rate);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0],
  };
  K = Math.tan(Math.PI * 38.13547087602444 / rate);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const highpass = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highpass];
}

// One channel at weight 1.0: the bus is mono. Returns integrated loudness
// in LUFS (-Infinity for silence) and loudness range in LU, and the punch
// figures: the loudest momentary (400ms) and short-term (3s) loudness, as
// EBU R128's M and S, and the 95th percentile of momentary loudness,
// because a single maximum is one block and one block is fragile.
//
// All are built from K-weighted energy summed in 100ms hops, since every
// block either standard asks for is a whole number of them: 400ms blocks
// stepping 100ms (75% overlap) for integrated and momentary loudness, 3s
// short-term blocks at the same 10Hz for the range and short-term.
function loudnessOf(data, rate) {
  const [s, h] = kWeighting(rate);
  const hop = Math.round(rate / 10);
  const hops = Math.floor(data.length / hop);
  const energy = new Float64Array(hops);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
  for (let j = 0; j < hops; j++) {
    let sum = 0;
    for (let i = j * hop, end = i + hop; i < end; i++) {
      const x = data[i];
      const y = s.b[0] * x + s.b[1] * x1 + s.b[2] * x2 - s.a[0] * y1 - s.a[1] * y2;
      const z = y - 2 * y1 + y2 - h.a[0] * z1 - h.a[1] * z2;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
      z2 = z1; z1 = z;
      sum += z * z;
    }
    energy[j] = sum;
  }
  const blocks = (len) => {
    const out = [];
    for (let j = len - 1; j < hops; j++) {
      let sum = 0;
      for (let k = j - len + 1; k <= j; k++) sum += energy[k];
      out.push(sum / (len * hop));
    }
    return out;
  };
  const lufs = (z) => -0.691 + 10 * Math.log10(z);
  const meanOf = (zs) => zs.reduce((a, b) => a + b, 0) / zs.length;
  // Absolute gate at -70 LUFS, then a relative one below the mean of what
  // survived it: -10 LU for integrated loudness, -20 LU for the range.
  const gated = (zs, relative) => {
    const loud = zs.filter((z) => lufs(z) > -70);
    if (!loud.length) return [];
    const gate = lufs(meanOf(loud)) + relative;
    return loud.filter((z) => lufs(z) > gate);
  };
  const m = blocks(4);
  const st = blocks(30);
  const momentary = gated(m, -10);
  const integrated = momentary.length ? lufs(meanOf(momentary)) : -Infinity;
  const shortTerm = gated(st, -20).map(lufs).sort((a, b) => a - b);
  const pick = (sorted, p) => sorted[Math.round((sorted.length - 1) * p)];
  const lra = shortTerm.length ? pick(shortTerm, 0.95) - pick(shortTerm, 0.1) : 0;
  // The maxima are ungated, as a meter's are. The percentile is over the
  // blocks that clear the absolute gate, so the digital silence of a
  // scheduled rest does not count as a quiet moment of the music.
  const peakOf = (zs) => (zs.length ? lufs(Math.max(...zs)) : -Infinity);
  const audible = m.map(lufs).filter((l) => l > -70).sort((a, b) => a - b);
  return {
    integrated,
    lra,
    momentaryMax: peakOf(m),
    momentaryP95: audible.length ? pick(audible, 0.95) : -Infinity,
    shortTermMax: peakOf(st),
  };
}

// Reference signals with known answers. A 997Hz sine at full scale in one
// channel is -3.01 LUFS by definition; the gating cases are 13 dB quieter
// tone either side of a louder one, which the relative gate must drop, and
// silence after tone, which the absolute gate must (ungated it would read
// -30.8); the range cases are EBU Tech 3342's first four, whose answers are
// differences and so do not care that this meter has one channel where
// theirs has two. The gating cases get 0.1: the few blocks straddling an
// edge are partly tone and pass the gates, as the standard has them do.
//
// The punch figures are held to EBU Tech 3341's constancy signals: a tone
// alternating 0.18s at -20 and 0.22s at -30 dBFS has a period of exactly one
// momentary window, so every 400ms block reads -23.0 LUFS, and 1.34s against
// 1.66s does the same for the 3s short-term window. Theirs are stereo, so
// this meter's one channel takes them 3 dB hotter to read the same. A steady
// sine has every maximum equal to its integrated loudness, and a peak 3.01
// dB above it, which is what PSR has to report.
function selftest() {
  const tone = (rate, parts) => {
    const n = parts.reduce((a, [, sec]) => a + Math.round(sec * rate), 0);
    const d = new Float32Array(n);
    let i = 0;
    for (const [db, sec] of parts) {
      const amp = Math.pow(10, db / 20);
      for (const end = i + Math.round(sec * rate); i < end; i++) d[i] = amp * Math.sin(2 * Math.PI * 997 * i / rate);
    }
    return d;
  };
  const times = (k, parts) => Array.from({ length: k }, () => parts).flat();
  const cases = [
    ['full-scale 997Hz sine, 48k', () => loudnessOf(tone(48000, [[0, 10]]), 48000).integrated, -3.01, 0.05],
    ['full-scale 997Hz sine, 44.1k', () => loudnessOf(tone(44100, [[0, 10]]), 44100).integrated, -3.01, 0.05],
    ['-20 dB sine, 44.1k', () => loudnessOf(tone(44100, [[-20, 10]]), 44100).integrated, -23.01, 0.05],
    ['relative gate: -33/-20/-33 dB, 10/60/10s', () => loudnessOf(tone(44100, [[-33, 10], [-20, 60], [-33, 10]]), 44100).integrated, -23.01, 0.1],
    ['absolute gate: -20 dB then silence', () => loudnessOf(tone(44100, [[-20, 10], [-200, 50]]), 44100).integrated, -23.01, 0.1],
    ['Tech 3342 #1: -20 then -30 dB, 20s each', () => loudnessOf(tone(44100, [[-20, 20], [-30, 20]]), 44100).lra, 10, 1],
    ['Tech 3342 #2: -20 then -15 dB', () => loudnessOf(tone(44100, [[-20, 20], [-15, 20]]), 44100).lra, 5, 1],
    ['Tech 3342 #3: -40 then -20 dB', () => loudnessOf(tone(44100, [[-40, 20], [-20, 20]]), 44100).lra, 20, 1],
    ['Tech 3342 #4: -50/-35/-20/-35/-50 dB', () => loudnessOf(tone(44100, [[-50, 20], [-35, 20], [-20, 20], [-35, 20], [-50, 20]]), 44100).lra, 15, 1],
    ['-20 dB sine: max momentary', () => loudnessOf(tone(44100, [[-20, 10]]), 44100).momentaryMax, -23.01, 0.05],
    ['-20 dB sine: momentary 95th percentile', () => loudnessOf(tone(44100, [[-20, 10]]), 44100).momentaryP95, -23.01, 0.05],
    ['-20 dB sine: max short-term', () => loudnessOf(tone(44100, [[-20, 10]]), 44100).shortTermMax, -23.01, 0.05],
    ['-20 dB sine: PSR, peak less max short-term', () => -20 - loudnessOf(tone(44100, [[-20, 10]]), 44100).shortTermMax, 3.01, 0.05, 'dB'],
    ['Tech 3341 momentary: 0.18/0.22s, max M', () => loudnessOf(tone(44100, times(25, [[-17, 0.18], [-27, 0.22]])), 44100).momentaryMax, -23, 0.1],
    ['Tech 3341 momentary: 0.18/0.22s, 95th pct', () => loudnessOf(tone(44100, times(25, [[-17, 0.18], [-27, 0.22]])), 44100).momentaryP95, -23, 0.1],
    ['Tech 3341 short-term: 1.34/1.66s, max S', () => loudnessOf(tone(44100, times(5, [[-17, 1.34], [-27, 1.66]])), 44100).shortTermMax, -23, 0.1],
    ['the same, max M is the louder tone', () => loudnessOf(tone(44100, times(5, [[-17, 1.34], [-27, 1.66]])), 44100).momentaryMax, -20.01, 0.1],
  ];
  const [shelf, hp] = kWeighting(48000);
  const published = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585, -1.99004745483398, 0.99007225036621];
  const ours = [...shelf.b, ...shelf.a, ...hp.a];
  const coeffErr = Math.max(...ours.map((c, i) => Math.abs(c - published[i])));
  const out = [''];
  out.push('driftloom loudness meter self-test');
  let failed = 0;
  const line = (label, got, want, tol, unit) => {
    const ok = Math.abs(got - want) <= tol;
    if (!ok) failed++;
    out.push(`  ${ok ? 'pass' : 'FAIL'}  ${label.padEnd(44)} ${got.toFixed(3).padStart(8)} ${unit}  (want ${want} +/- ${tol})`);
  };
  line('K-weighting against the published 48k filter', coeffErr, 0, 1e-8, '  ');
  for (const [label, fn, want, tol, unit] of cases) line(label, fn(), want, tol, unit || (label.startsWith('Tech 3342') ? 'LU' : 'LUFS'));
  out.push('');
  out.push(failed ? `  ${failed} failed` : '  all passed');
  out.push('');
  return { text: out.join('\n'), failed };
}

// Pasted into every page: the meter, and a seeded Math.random.
//
// FNV-1a over a string, so a note's seed comes from what it is -- voice,
// layer, pitch, velocity, repeat -- and not from where it falls in the run.
// Probing kalimba alone or beside forty other voices gives kalimba the same
// numbers either way.
const PAGE_HELPERS = `
${kWeighting.toString()}
${loudnessOf.toString()}
function seedFor(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
// Renders run in parallel, but a graph is built synchronously between
// seeding and startRendering(), which is the only time the synth draws, so
// nothing from one render can land in another's stream.
async function inParallel(tasks, width) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.max(1, width) }, worker));
  return results;
}
`;

// -------------------------------------------------------------- the page
//
// Everything below runs in the browser, where Web Audio exists. The seven
// destination channels are: the finished mix in 0 and 1, then one channel
// per layer carrying that layer's dry signal, tapped at its channel gain
// before the pump bus and before anything on the master chain.
//
// The taps are dry on purpose. Reverb and echo returns arrive through one
// shared pair of nodes, so a wet tail cannot be attributed back to the
// layer that sent it; a per-layer figure that silently folded in someone
// else's tail would be worse than no figure at all.

// The corpus, drawn the same way on every page: loops from the corpus seed
// in order, and with --profile only the ones that profile leads. Without a
// profile that is exactly n draws, the corpus it always was.
const CORPUS = `
function leadOf(spec) {
  return Object.entries(spec.mix || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '?';
}
function drawCorpus(seed, n, profile) {
  const master = new Rng(seed);
  const specs = [];
  // Capped, so a profile that never leads cannot spin forever.
  for (let tries = 0; specs.length < n && tries < n * 1000; tries++) {
    const spec = newSpec(master.seed32());
    if (!profile || leadOf(spec) === profile) specs.push(spec);
  }
  return specs;
}
`;
const ledBy = (opts) => (opts.profile ? `, loops led by ${opts.profile}` : '');

const PAGE = `<!doctype html><meta charset="utf-8"><title>measure</title>
<script type="module">
import { Engine } from '/js/engine.js';
import { Synth } from '/js/synth.js';
import { newSpec, characterOf } from '/js/generator.js';
import { Rng, mulberry32 } from '/js/rng.js';

const LAYERS = ${JSON.stringify(LAYERS)};
${PAGE_HELPERS}
${CORPUS}

const scan = (d) => {
  let peak = 0, sumSq = 0, full = 0;
  for (let s = 0; s < d.length; s++) {
    const a = d[s] < 0 ? -d[s] : d[s];
    if (a > peak) peak = a;
    if (a >= 0.999) full++;
    sumSq += d[s] * d[s];
  }
  return { peak, rms: Math.sqrt(sumSq / d.length), full };
};

// One loop, one way. 'real' is the shipped chain with a tap on every layer;
// 'bypass' routes around the bus compressor and the ceiling, here and
// nowhere else, and keeps everything in front of them -- saturator, tone,
// highpass, the profile's level trim. Both draw the same random stream, so
// what differs between them is the chain.
function renderLoop(spec, seconds, opts, bypass) {
  Math.random = mulberry32(spec.seed >>> 0 || 1);
  const channels = bypass ? 1 : 2 + LAYERS.length;
  const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * opts.rate), opts.rate);
  const synth = new Synth(ctx, opts.quality);
  const engine = new Engine(ctx, synth);
  // The engine's clock is never started here, but it has already opened a
  // Worker; a corpus would otherwise leave one behind per render.
  if (engine.clock.worker) engine.clock.worker.terminate();

  if (bypass) {
    synth.hp.disconnect();
    synth.hp.connect(synth.master);
    synth.kill.disconnect();
    synth.kill.connect(ctx.destination);
  } else {
    const merger = ctx.createChannelMerger(channels);
    merger.connect(ctx.destination);
    const splitter = ctx.createChannelSplitter(2);
    synth.ceiling.disconnect();
    synth.ceiling.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 1);
    LAYERS.forEach((name, n) => synth.channels[name].gain.connect(merger, 0, n + 2));
  }

  engine.load(spec);
  engine.playing = true;
  engine.nextStepTime = 0.05;
  let guard = 0;
  while (engine.nextStepTime < seconds && guard++ < 200000) {
    engine._scheduleStep(engine.step, engine.nextStepTime);
    engine._advance();
  }
  return ctx.startRendering();
}

// What the compressor and the ceiling do to a signal far below either
// threshold. Web Audio's compressor applies an automatic makeup gain, so a
// quiet loop is lifted by the chain rather than left alone; this is that
// lift, measured on the synth's own settings, so that what a loop loses to
// gain reduction can be told apart from what everything gains.
async function chainMakeup(opts) {
  const gainOf = async (which) => {
    const ctx = new OfflineAudioContext(1, opts.rate * 2, opts.rate);
    const synth = new Synth(ctx, opts.quality);
    const osc = ctx.createOscillator();
    osc.frequency.value = 997;
    const g = ctx.createGain();
    g.gain.value = 0.01;
    osc.connect(g);
    osc.start(0);
    let node = g;
    for (const name of which) {
      const c = ctx.createDynamicsCompressor();
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) c[k].value = synth[name][k].value;
      node.connect(c);
      node = c;
    }
    node.connect(ctx.destination);
    const d = (await ctx.startRendering()).getChannelData(0).subarray(opts.rate);
    return 20 * Math.log10(scan(d).rms / (0.01 / Math.SQRT2));
  };
  const probe = new Synth(new OfflineAudioContext(1, 128, opts.rate), opts.quality);
  const settings = {};
  for (const name of ['comp', 'ceiling']) {
    settings[name] = { threshold: probe[name].threshold.value, ratio: probe[name].ratio.value, knee: probe[name].knee.value };
  }
  return {
    makeup: { comp: await gainOf(['comp']), ceiling: await gainOf(['ceiling']), both: await gainOf(['comp', 'ceiling']) },
    settings,
  };
}

window.measure = async (opts) => {
  const specs = drawCorpus(opts.seed || 1, opts.n, opts.profile);

  const tasks = specs.map((spec) => async () => {
    // Render whole passes of whatever this loop is, so a slow twenty-four
    // bar piece is measured as a piece and not as its first few seconds.
    // Clamped at both ends so one very slow loop cannot dominate the run.
    const loopDur = spec.bars * (spec.stepsPerBar || 16) * (60 / spec.bpm / 4);
    const seconds = Math.min(70, Math.max(opts.passes * loopDur, 20));
    const pending = opts.chain ? renderLoop(spec, seconds, opts, true) : null;
    const buf = await renderLoop(spec, seconds, opts, false);

    const left = scan(buf.getChannelData(0));
    const right = scan(buf.getChannelData(1));
    const layers = {};
    LAYERS.forEach((name, n) => {
      const d = buf.getChannelData(n + 2);
      const ld = loudnessOf(d, opts.rate);
      layers[name] = {
        ...scan(d),
        lufs: ld.integrated,
        mMax: ld.momentaryMax,
        mP95: ld.momentaryP95,
        sMax: ld.shortTermMax,
      };
    });
    // The meter reads channel 0 alone because the bus is mono; this is the
    // check that it still is.
    let stereo = 0;
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    for (let s = 0; s < l.length; s++) stereo = Math.max(stereo, Math.abs(l[s] - r[s]));
    const loud = loudnessOf(l, opts.rate);

    let bypass = null;
    if (pending) {
      const d = (await pending).getChannelData(0);
      const b = scan(d);
      const bl = loudnessOf(d, opts.rate);
      bypass = { peak: b.peak, rms: b.rms, lufs: bl.integrated, lra: bl.lra };
    }

    const character = characterOf(spec);
    return {
      seed: spec.seed,
      name: spec.name,
      profile: Object.entries(spec.mix || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '?',
      level: character.level ?? 1,
      bpm: spec.bpm,
      seconds: +seconds.toFixed(1),
      passes: +(seconds / loopDur).toFixed(1),
      peak: Math.max(left.peak, right.peak),
      rms: (left.rms + right.rms) / 2,
      full: left.full + right.full,
      lufs: loud.integrated,
      lra: loud.lra,
      mMax: loud.momentaryMax,
      mP95: loud.momentaryP95,
      sMax: loud.shortTermMax,
      stereo,
      layers,
      bypass,
    };
  });
  // Each loop keeps two renders in flight, so half as many loops at once.
  const rows = await inParallel(tasks, Math.ceil(opts.jobs / (opts.chain ? 2 : 1)));
  return { rows, chain: opts.chain ? await chainMakeup(opts) : null };
};
</script>`;

// ------------------------------------------------------ the voice probe

// Roadmap item 1 described a per-voice probe and never built it, on the
// grounds that nothing had needed one. Something does now: the vowel voice
// is harsh, and "harsh" has to become a number before it can be fixed
// without breaking something else.
//
// The number is the share of a note's A-weighted energy that falls between
// 2 and 5kHz. A-weighting because the ear is not flat and the complaint is
// about what the ear does; 2-5kHz because that is where it is most
// sensitive, and where a sawtooth that has not been rolled off puts energy
// a real voice does not. The figure means nothing on its own -- it is only
// useful against the same figure for a voice nobody complains about, which
// is why the favourites are measured beside it.
//
// Two octaves because the harshness is pitch-dependent: formants sit at
// fixed frequencies while the harmonics move through them, so a note an
// octave up lands different partials on the same resonance. One note would
// be one sample of that.
const PROBE_LOW = 55;    // G3, the bottom of the melody window
const PROBE_HIGH = 79;   // G5, two octaves up

// Loudness is asked of every layer, and each is probed across the two
// octaves it actually plays in. Measured over a 3000-loop corpus, 5th to
// 95th percentile: melody 56-71, chords 43-65, bass 28-39 (genBass folds
// every note into 28-52), textures 67-89.
const PROBE_WINDOWS = {
  melody: [PROBE_LOW, PROBE_HIGH],
  chords: [43, 67],   // G2-G4
  bass: [28, 52],     // E1-E3
  texture: [67, 91],  // G4-G6
};
const PROBE_VELOCITIES = [0.4, 0.8];
const PROBE_REFERENCE = { layer: 'melody', voice: 'kalimba' };
// How far from the rest of its layer a voice has to sit to be listed, and
// how far its own velocity response has to differ from the layer's.
const FAMILY_LIMIT = 3;
const VELOCITY_LIMIT = 1.5;
// Loops drawn to find what velocity each voice is actually given.
const SURVEY_LOOPS = 2000;

const PROBE_PAGE = `
import { Engine } from '/js/engine.js';
import { Synth } from '/js/synth.js';
import { mulberry32 } from '/js/rng.js';
${PAGE_HELPERS}

// Radix-2 FFT, in place.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// IEC 61672 A-weighting, as a linear magnitude factor.
function aWeight(f) {
  if (f <= 0) return 0;
  const f2 = f * f;
  const num = 12194 * 12194 * f2 * f2;
  const den = (f2 + 20.6 * 20.6)
    * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9))
    * (f2 + 12194 * 12194);
  return (num / den) * Math.pow(10, 2.0 / 20);
}

// A-weighted energy in 2-5kHz and in total, for one rendered note.
//
// Summed periodograms across the whole note, so the figure is over the
// energy that actually leaves the voice -- attack included, which is where
// a struck voice does its brightest work.
function presenceOf(d, rate) {
  const N = 4096;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const power = new Float64Array(N / 2);
  const hop = N / 2;
  for (let start = 0; start + N <= d.length; start += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = d[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < N / 2; i++) power[i] += re[i] * re[i] + im[i] * im[i];
  }
  const df = rate / N;
  let band = 0;
  let total = 0;
  for (let i = 1; i < N / 2; i++) {
    const f = i * df;
    if (f > 20000) break;
    const w = aWeight(f);
    const p = power[i] * w * w;
    total += p;
    if (f >= 2000 && f <= 5000) band += p;
  }
  return { band, total };
}

const VOWELS = ['a', 'e', 'o', 'u'];
const STEP = 0.1; // seconds a step, at the 150bpm the one-note pattern runs at

// One note, played the way the engine plays that layer.
//
// Not by calling the voice directly: a chord reaches a voice through the
// engine, which sends a pad to pad() and everything else to voice() at a
// spread of 0.8 over the root of the note count, so the same voice is not
// the same level as a chord and as a tune. So the engine's own
// _scheduleStep is handed a one-event pattern for the layer. It is used
// without its constructor, which would open a clock Worker a note.
//
// Dry: the layer's channel goes straight to the output at unity, so the
// channel table, the reverb and echo sends, the bus and the master chain
// are all out of it. The reverb return is shared between layers and would
// put one voice's tail inside another voice's reading.
function renderNote(job, midi, vel, rep, o) {
  Math.random = mulberry32(seedFor([job.layer, job.voice, midi, vel.toFixed(2), rep].join('|')));
  const ctx = new OfflineAudioContext(1, Math.ceil((o.dur + (o.tail ?? 2.2)) * o.rate), o.rate);
  const synth = new Synth(ctx, 'full');
  // The budget is a runtime guard and would only refuse notes here.
  synth._budget = () => true;
  const channel = synth.channels[job.layer].gain;
  channel.disconnect();
  channel.gain.value = 1;
  channel.connect(ctx.destination);

  const tracks = { drums: [], bass: [], chords: [], melody: [], texture: [] };
  const dur = o.dur / STEP;
  const vowel = VOWELS[(midi - job.low) % 4];
  if (job.layer === 'melody') tracks.melody.push({ step: 0, dur, midi, vel, voice: job.voice, vowel });
  if (job.layer === 'chords') tracks.chords.push({ step: 0, dur, notes: [midi], vel, voice: job.voice, vowel });
  if (job.layer === 'bass') tracks.bass.push({ step: 0, dur, midi, vel, glide: false, voice: job.voice });
  // Drops and wind take no pitch; a note handed to them is ignored.
  if (job.layer === 'texture') tracks.texture.push({ step: 0, dur, notes: [midi], vel, kind: job.voice });
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    ctx, synth,
    spec: { bpm: 60 / STEP / 4, swing: 0, mutes: {} },
    live: { tracks, totalSteps: 1, stepsPerBar: 16 },
    absStep: 0, pumpAmount: 0, tailsDucked: false, visualQueue: [],
  });
  engine._scheduleStep(0, 0.05);
  return ctx.startRendering();
}

window.probeVoice = async (o) => {
  const tasks = [];
  for (const job of o.jobs) {
    for (const vel of o.velocities) {
      for (let midi = job.low; midi <= job.high; midi++) {
        for (let rep = 0; rep < o.reps; rep++) {
          tasks.push(async () => {
            const d = (await renderNote(job, midi, vel, rep, o)).getChannelData(0);
            return {
              lufs: loudnessOf(d, o.rate).integrated,
              presence: job.tone && vel === o.toneVelocity ? presenceOf(d, o.rate) : null,
            };
          });
        }
      }
    }
  }
  const results = await inParallel(tasks, o.width);

  // Repeats are averaged as energy, then read back as loudness.
  let i = 0;
  const out = [];
  for (const job of o.jobs) {
    const row = { layer: job.layer, voice: job.voice, low: job.low, high: job.high, drawn: job.drawn, notes: {}, tone: null };
    for (const vel of o.velocities) {
      const notes = [];
      const tone = [];
      for (let midi = job.low; midi <= job.high; midi++) {
        let energy = 0, band = 0, total = 0;
        for (let rep = 0; rep < o.reps; rep++) {
          const r = results[i++];
          energy += Number.isFinite(r.lufs) ? Math.pow(10, r.lufs / 10) : 0;
          if (r.presence) { band += r.presence.band; total += r.presence.total; }
        }
        notes.push({ midi, lufs: energy > 0 ? 10 * Math.log10(energy / o.reps) : -Infinity });
        tone.push({ midi, share: total > 0 ? band / total : 0 });
      }
      row.notes[vel] = notes;
      if (job.tone && vel === o.toneVelocity) row.tone = tone;
    }
    out.push(row);
  }
  const probe = new Synth(new OfflineAudioContext(1, 128, o.rate), 'full');
  const gains = {};
  for (const [name, c] of Object.entries(probe.channels)) gains[name] = c.base.gain;
  return { rows: out, gains };
};

// Whether a note was cut off: the most sudden fall in its level anywhere.
//
// At every point the level just before is set against the level just
// after, in windows of two periods of the note, so a low note's own
// waveform does not read as a fall. A cut is a fall that happens at once
// and then stops: the note is gone, or down to its breath, and stays
// there. A decay keeps on falling -- a stab loses 15 dB a window, window
// after window -- and a bell's beating dips and comes straight back. So a
// fall scores what is left of it after the fall in the next window and
// anything it climbs back within 30 ms: a cut scores the whole drop, a
// decay or a beat next to nothing. Only points within 30 dB of the peak
// count. Whether the note is still ringing when the render ends is
// reported too.
function endingOf(d, rate, midi) {
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  const w = Math.max(Math.round(0.002 * rate), Math.round((2 * rate) / hz));
  const back = Math.round(0.03 * rate);
  const sq = new Float64Array(d.length + 1);
  for (let i = 0; i < d.length; i++) sq[i + 1] = sq[i] + d[i] * d[i];
  const rms = (a, b) => Math.sqrt(Math.max(0, sq[b] - sq[a]) / (b - a));
  let peak = 0;
  for (let i = 0; i + w <= d.length; i += w) peak = Math.max(peak, rms(i, i + w));
  if (!peak) return { silent: true };
  const floor = peak * 1e-6;
  const db = (x, y) => 20 * Math.log10(Math.max(x, floor) / Math.max(y, floor));
  let sudden = 0;
  let at = 0;
  const hop = Math.max(1, w >> 2);
  for (let n = w; n + 2 * w + back <= d.length; n += hop) {
    const before = rms(n - w, n);
    if (before < peak * 0.0316) continue;
    const after = rms(n, n + w);
    const fall = db(before, after);
    if (fall <= 0) continue;
    const onward = Math.max(0, db(after, rms(n + w, n + 2 * w)));
    let high = 0;
    for (let k = n + w; k + w <= n + back; k += hop) high = Math.max(high, rms(k, k + w));
    const climb = Math.max(0, db(high, after));
    const score = fall - onward - climb;
    if (score > sudden) { sudden = score; at = n / rate; }
  }
  let last = d.length - 1;
  while (last > 0 && Math.abs(d[last]) < peak * 1e-3) last--;
  return { sudden, at, ringing: last >= d.length - 2 };
}

window.probeEndings = async (o) => {
  const tasks = [];
  for (const job of o.jobs) {
    for (const dur of job.lengths) {
      tasks.push(async () => {
        const d = (await renderNote(job, job.midi, o.vel, 0, { ...o, dur, tail: o.tail })).getChannelData(0);
        return { layer: job.layer, voice: job.voice, dur, ...endingOf(d, o.rate, job.midi) };
      });
    }
  }
  return inParallel(tasks, o.width);
};
`;

// ------------------------------------------------------ budget refusals

// What the voice budget turns away, layer by layer.
//
// The budget is a running total of cost reserved by notes that have not yet
// finished. The engine asks for layers in a fixed order -- drums, bass,
// chords, melody, texture -- so on a dense loop the melody asks fourth,
// after the chords have already reserved theirs, and is refused for want of
// room it never had a chance at.
//
// A refusal is attributed to the layer whose entry point was on the stack,
// which is the only way to tell chords from melody: both arrive through
// `voice()` and differ only by the channel they are handed.
const REFUSAL_PAGE = `
import { Engine } from '/js/engine.js';
import { Synth } from '/js/synth.js';
import { newSpec } from '/js/generator.js';
import { decodeSong } from '/js/share.js';
import { Rng, mulberry32 } from '/js/rng.js';

const LAYERS = ['drums', 'bass', 'chords', 'melody', 'texture'];
${CORPUS}

// Render one loop and count what each layer asked for and lost.
async function runOne(spec, quality, rate) {
  const spb = spec.stepsPerBar || 16;
  const seconds = Math.min(60, spec.bars * spb * (60 / spec.bpm / 4) + 3);
  // Drum jitter moves when a note is released, and so what is refused.
  Math.random = mulberry32(spec.seed >>> 0 || 1);
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const synth = new Synth(ctx, quality);
  const engine = new Engine(ctx, synth);

  const asked = {}; const refused = {}; const calls = {}; const callsRefused = {};
  for (const l of LAYERS) { asked[l] = 0; refused[l] = 0; calls[l] = 0; callsRefused[l] = 0; }

  let layer = null;
  let noteFailed = false;
  const realBudget = synth._budget.bind(synth);
  synth._budget = (...a) => {
    const ok = realBudget(...a);
    if (layer) { calls[layer]++; if (!ok) { callsRefused[layer]++; noteFailed = true; } }
    return ok;
  };
  // One "note" is one entry-point call. It counts as refused if any budget
  // question inside it was answered no -- for the single-oscillator voices
  // that means silence, and for the two-operator ones it means thinned.
  const wrap = (name, layerOf) => {
    const real = synth[name].bind(synth);
    synth[name] = (...a) => {
      const l = layerOf(a);
      const outer = layer; layer = l; noteFailed = false;
      try {
        const out = real(...a);
        asked[l]++;
        if (noteFailed) refused[l]++;
        return out;
      } finally { layer = outer; }
    };
  };
  wrap('drum', () => 'drums');
  wrap('bass', () => 'bass');
  wrap('pad', () => 'chords');
  wrap('texture', () => 'texture');
  wrap('voice', (a) => (a[5] === synth.channels.chords.gain ? 'chords' : 'melody'));

  engine.load(spec);
  engine.playing = true;
  engine.nextStepTime = 0.05;
  let guard = 0;
  while (engine.nextStepTime < seconds && guard++ < 200000) {
    engine._scheduleStep(engine.step, engine.nextStepTime);
    engine._advance();
  }
  await ctx.startRendering();
  return { asked, refused, calls, callsRefused, seconds };
}

window.refusalsOne = async (o) => {
  const spec = decodeSong(o.code);
  const out = {};
  for (const q of ['full', 'lite']) out[q] = await runOne(spec, q, o.rate);
  out.spec = {
    name: spec.name, bpm: spec.bpm, bars: spec.bars,
    stepsPerBar: spec.stepsPerBar || 16, seed: spec.seed,
  };
  return out;
};

window.refusalsCorpus = async (o) => {
  const rows = [];
  for (const spec of drawCorpus(o.seed, o.n, o.profile)) {
    const r = await runOne(spec, o.quality, o.rate);
    rows.push({
      name: spec.name, seed: spec.seed,
      asked: r.asked, refused: r.refused,
      profile: leadOf(spec),
    });
  }
  return rows;
};
`;

function reportRefusalsOne(data, opts) {
  const LAYERS = ['drums', 'bass', 'chords', 'melody', 'texture'];
  const out = [''];
  out.push('driftloom voice-budget refusals, one loop');
  out.push(`  ${data.spec.name}, ${data.spec.bpm}bpm, ${data.spec.bars} bars of ${data.spec.stepsPerBar}, seed ${data.spec.seed}`);
  out.push('');
  for (const q of ['full', 'lite']) {
    const r = data[q];
    out.push(`  quality '${q}'  (${q === 'lite' ? 'LITE_BUDGET 140' : 'MAX_BUDGET 260'})`);
    out.push('    layer      notes   silenced or thinned      budget asks   refused');
    for (const l of LAYERS) {
      const a = r.asked[l];
      if (!a) continue;
      const pc = (x, y) => (y ? `${(100 * x / y).toFixed(1)}%` : '-');
      out.push(`    ${l.padEnd(9)} ${String(a).padStart(6)}   ${`${r.refused[l]}  (${pc(r.refused[l], a)})`.padStart(20)}   ${String(r.calls[l]).padStart(11)}   ${`${r.callsRefused[l]} (${pc(r.callsRefused[l], r.calls[l])})`.padStart(9)}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function reportRefusalsCorpus(rows, opts) {
  const out = [''];
  out.push('driftloom voice-budget refusals, corpus');
  out.push(`  ${rows.length} loops, corpus seed ${opts.seed}${ledBy(opts)}, quality '${opts.quality}'`);
  out.push('');
  const rate = (r, l) => (r.asked[l] ? r.refused[l] / r.asked[l] : null);
  const melody = rows.map((r) => rate(r, 'melody')).filter((x) => x != null);
  const sorted = melody.slice().sort((a, b) => a - b);
  const q = (f) => (sorted.length ? sorted[Math.floor(f * (sorted.length - 1))] : NaN);
  const pc = (v) => `${(100 * v).toFixed(1)}%`;
  out.push('  per-loop melody refusal rate');
  out.push(`    loops with a melody      ${melody.length}`);
  out.push(`    mean                     ${pc(mean(melody))}`);
  out.push(`    median                   ${pc(q(0.5))}`);
  out.push(`    p75 / p90 / p99          ${pc(q(0.75))} / ${pc(q(0.9))} / ${pc(q(0.99))}`);
  out.push(`    max                      ${pc(q(1))}`);
  out.push('');
  for (const t of [0.001, 0.05, 0.2, 0.5]) {
    const n = melody.filter((x) => x > t).length;
    out.push(`    losing more than ${`${(100 * t).toFixed(1)}%`.padStart(5)}    ${String(n).padStart(5)} loops  (${pc(n / melody.length)})`);
  }
  out.push('');
  out.push('  other layers, mean per-loop refusal rate');
  for (const l of ['drums', 'bass', 'chords', 'texture']) {
    const xs = rows.map((r) => rate(r, l)).filter((x) => x != null);
    out.push(`    ${l.padEnd(9)} ${pc(mean(xs)).padStart(7)}   over ${xs.length} loops`);
  }
  out.push('');
  out.push('  worst loops by melody refusal rate');
  const worst = rows.filter((r) => r.asked.melody)
    .sort((a, b) => rate(b, 'melody') - rate(a, 'melody')).slice(0, 8);
  out.push('    loop             profile        melody   refused      keys notes');
  for (const r of worst) {
    out.push(`    ${r.name.padEnd(16)} ${r.profile.padEnd(12)} ${String(r.asked.melody).padStart(7)}   ${`${r.refused.melody} (${pc(rate(r, 'melody'))})`.padStart(12)}   ${String(r.asked.chords).padStart(10)}`);
  }
  out.push('');
  return out.join('\n');
}

// -------------------------------------------------------------- printing

const dbfs = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmtDb = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : '  -inf');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

function report(rows, opts, chain) {
  const out = [];
  out.push('');
  out.push('driftloom offline audio measurement');
  out.push(`  ${rows.length} loops at ${(opts.rate / 1000).toFixed(1)}k, >=${opts.passes} passes each (20-70s), quality '${opts.quality}'`);
  out.push(`  corpus seed ${opts.seed}${ledBy(opts)}, real Engine and Synth through an OfflineAudioContext`);
  out.push('');
  out.push('  seed         name             bpm    secs  passes    peak     rms  full-scale');
  out.push(`  ${'-'.repeat(74)}`);
  for (const r of rows) {
    out.push(`  ${String(r.seed).padStart(10)}  ${r.name.padEnd(15)} ${String(r.bpm).padStart(4)}  ${String(r.seconds).padStart(5)}  ${String(r.passes).padStart(6)}  ${r.peak.toFixed(4)}  ${r.rms.toFixed(4)}  ${String(r.full).padStart(10)}`);
  }

  const peaks = rows.map((r) => r.peak);
  const rmss = rows.map((r) => r.rms);
  const fullTotal = rows.reduce((a, r) => a + r.full, 0);
  out.push('');
  out.push('  output');
  out.push(`    peak                 min ${Math.min(...peaks).toFixed(4)}   median ${median(peaks).toFixed(4)}   max ${Math.max(...peaks).toFixed(4)}   mean ${mean(peaks).toFixed(4)}`);
  out.push(`    rms                  min ${Math.min(...rmss).toFixed(4)}   median ${median(rmss).toFixed(4)}   max ${Math.max(...rmss).toFixed(4)}   mean ${mean(rmss).toFixed(4)}`);
  out.push(`    peak spread          ${fmtDb(dbfs(Math.max(...peaks)) - dbfs(Math.min(...peaks)))} dB across the corpus`);
  out.push(`    rms spread           ${fmtDb(dbfs(Math.max(...rmss)) - dbfs(Math.min(...rmss)))} dB across the corpus`);
  out.push(`    crest factor         mean ${fmtDb(mean(rows.map((r) => dbfs(r.peak) - dbfs(r.rms))))} dB`);
  out.push(`    full-scale samples   ${fullTotal}`);

  // Per-layer dry level. A layer that never sounds would drag its own mean
  // toward zero and make a quiet layer look quieter still, so each figure
  // is taken only over the loops where that layer actually plays, and the
  // count is printed beside it.
  out.push('');
  out.push('  per-layer dry level, tapped at the channel gain before the bus');
  out.push('    layer      loops    peak      rms   rms dBFS   vs melody     LUFS   vs melody');
  const melodyRms = mean(rows.filter((r) => r.layers.melody.rms > 1e-6).map((r) => r.layers.melody.rms));
  // Loudness while the layer plays: the gates leave out the bars it sits out.
  // A layer can sound and still sit under the -70 LUFS gate throughout --
  // a thin wind -- so the mean is over the loops where it measured at all.
  const gatedMean = (name) => mean(rows.map((r) => r.layers[name].lufs).filter(Number.isFinite));
  const melodyLufs = gatedMean('melody');
  for (const name of LAYERS) {
    const sounding = rows.filter((r) => r.layers[name].rms > 1e-6);
    if (!sounding.length) {
      out.push(`    ${LAYER_LABELS[name].padEnd(9)} ${String(0).padStart(5)}        -        -          -           -`);
      continue;
    }
    const peak = Math.max(...sounding.map((r) => r.layers[name].peak));
    const rms = mean(sounding.map((r) => r.layers[name].rms));
    const rel = name === 'melody' ? '' : `${fmtDb(dbfs(melodyRms) - dbfs(rms))} dB`;
    const lufs = gatedMean(name);
    const relLufs = name === 'melody' ? '' : `${fmtDb(melodyLufs - lufs)} LU`;
    out.push(`    ${LAYER_LABELS[name].padEnd(9)} ${String(sounding.length).padStart(5)}   ${peak.toFixed(4)}   ${rms.toFixed(4)}     ${fmtDb(dbfs(rms)).padStart(6)}   ${rel.padStart(9)}   ${fmtDb(lufs).padStart(6)}   ${relLufs.padStart(9)}`);
  }
  out.push('');
  out.push('    "vs melody" is how far the melody sits above that layer. Positive');
  out.push('    means the melody is louder. Dry only: the reverb and echo returns');
  out.push('    are shared and cannot be attributed back to the layer that sent them.');
  out.push('    LUFS is K-weighted and gated, so it is the layer\'s loudness while it');
  out.push('    plays, and it does not over-count the kick and the bass as RMS does.');
  out.push('');
  out.push(reportLoudness(rows, opts, chain));
  return out.join('\n');
}

const fmt = (v, width, digits = 1, sign = true) => {
  if (v == null || Number.isNaN(v)) return '-'.padStart(width);
  if (!Number.isFinite(v)) return (v > 0 ? 'inf' : '-inf').padStart(width);
  return `${sign && v >= 0 ? '+' : ''}${v.toFixed(digits)}`.padStart(width);
};
// The middle value, or the mean of the two middle values.
const middle = (a) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const spreadOf = (xs) => Math.max(...xs) - Math.min(...xs);

// One row of a mean / min / max / spread summary.
const summaryLine = (label, xs, unit, sign = true) => `    ${label.padEnd(24)} ${fmt(mean(xs), 7, 1, sign)}  ${fmt(Math.min(...xs), 7, 1, sign)}  ${fmt(Math.max(...xs), 7, 1, sign)}  ${fmt(spreadOf(xs), 7, 1, false)} ${unit}`;

// Loudness, per loop and across the corpus, and what the master chain does.
function reportLoudness(rows, opts, chain) {
  const out = [];
  const crest = (peak, lufs) => dbfs(peak) - lufs;
  out.push('  loudness, K-weighted (ITU-R BS.1770; the bus is mono, so one channel at 1.0)');
  out.push('    loudest first. trim is the profile level characters.js authored for the');
  out.push('    loop; crest is sample peak minus integrated loudness; LRA from 3s blocks.');
  out.push('');
  out.push('    loop             profile      trim   peak dB   rms dB     LUFS    LRA   crest');
  out.push(`    ${'-'.repeat(78)}`);
  const byLoudness = rows.slice().sort((a, b) => b.lufs - a.lufs);
  for (const r of byLoudness) {
    out.push(`    ${r.name.padEnd(16)} ${r.profile.padEnd(10)} ${fmt(dbfs(r.level), 6)}  ${fmt(dbfs(r.peak), 8)} ${fmt(dbfs(r.rms), 8)} ${fmt(r.lufs, 8)} ${fmt(r.lra, 6, 1, false)} ${fmt(crest(r.peak, r.lufs), 7, 1, false)}`);
  }
  const stereo = Math.max(...rows.map((r) => r.stereo));
  if (stereo > 1e-6) {
    out.push('');
    out.push(`    WARNING: left and right differ by up to ${stereo.toExponential(2)}. The meter reads the`);
    out.push('    left channel alone because the bus has been mono; it no longer is.');
  }

  const line = (...a) => out.push(summaryLine(...a));
  out.push('');
  out.push(`  across the corpus, ${rows.length} loops (means are of the per-loop figures)`);
  out.push('                                mean      min      max    spread');
  line('loudness, LUFS', rows.map((r) => r.lufs), 'LU');
  line('rms, dBFS', rows.map((r) => dbfs(r.rms)), 'dB');
  line('peak, dBFS', rows.map((r) => dbfs(r.peak)), 'dB');
  line('loudness range, LU', rows.map((r) => r.lra), 'LU', false);
  line('crest, dB', rows.map((r) => crest(r.peak, r.lufs)), 'dB', false);
  line('authored trim, dB', rows.map((r) => dbfs(r.level)), 'dB');
  line('LUFS less the trim', rows.map((r) => r.lufs - dbfs(r.level)), 'LU');
  out.push('');
  out.push('    "LUFS less the trim" is what the loops would measure if every profile');
  out.push('    had the same level: the spread nobody set as a level decision.');
  // Max minus min grows with the size of the corpus; this does not. Played
  // back to back the catalogue is one programme, so its range is taken the
  // way LRA takes one: 10th to 95th percentile of loop loudness.
  const sorted = rows.map((r) => r.lufs).sort((a, b) => a - b);
  const at = (p) => sorted[Math.round((sorted.length - 1) * p)];
  out.push(`    catalogue range, 10th to 95th percentile of loop loudness, as LRA takes`);
  out.push(`    its range: ${fmt(at(0.95) - at(0.1), 4, 1, false)} LU (${fmt(at(0.1), 5)} to ${fmt(at(0.95), 5)} LUFS; median ${fmt(at(0.5), 5)})`);

  // By the profile that leads each loop's mix.
  const profiles = {};
  for (const r of rows) (profiles[r.profile] ||= []).push(r);
  out.push('');
  out.push('    by leading profile      loops     LUFS   trim dB   LUFS less trim   with drums');
  for (const [name, rs] of Object.entries(profiles).sort((a, b) => mean(b[1].map((r) => r.lufs)) - mean(a[1].map((r) => r.lufs)))) {
    const drums = rs.filter((r) => r.layers.drums.rms > 1e-6).length;
    out.push(`      ${name.padEnd(20)} ${String(rs.length).padStart(5)}  ${fmt(mean(rs.map((r) => r.lufs)), 7)}  ${fmt(mean(rs.map((r) => dbfs(r.level))), 8)}  ${fmt(mean(rs.map((r) => r.lufs - dbfs(r.level))), 15)}  ${`${drums} of ${rs.length}`.padStart(11)}`);
  }
  const withDrums = rows.filter((r) => r.layers.drums.rms > 1e-6);
  const without = rows.filter((r) => !(r.layers.drums.rms > 1e-6));
  if (withDrums.length && without.length) {
    out.push(`    loops with drums ${fmt(mean(withDrums.map((r) => r.lufs)), 5)} LUFS on average (${withDrums.length}), without ${fmt(mean(without.map((r) => r.lufs)), 5)} (${without.length})`);
  }

  out.push(...reportPunch(rows));

  if (!chain) return out.join('\n');
  const loops = rows.filter((r) => r.bypass);
  const makeup = chain.makeup.both;
  const delta = (r) => r.lufs - r.bypass.lufs;
  const reduction = (r) => makeup - delta(r);
  const crestChange = (r) => crest(r.peak, r.lufs) - crest(r.bypass.peak, r.bypass.lufs);
  const c = chain.settings;
  out.push('');
  out.push(`  the master chain: bus compressor (${c.comp.threshold} dBFS, ${c.comp.ratio}:1, ${c.comp.knee} dB knee) and ceiling`);
  out.push(`  (${c.ceiling.threshold} dBFS, ${c.ceiling.ratio}:1), against the same loop rendered with both routed around`);
  out.push('  -- in this harness only; the shipped chain is untouched');
  out.push('');
  out.push(`    makeup gain              ${fmt(makeup, 5)} dB on anything below threshold (compressor ${fmt(chain.makeup.comp, 4)},`);
  out.push(`                             ceiling ${fmt(chain.makeup.ceiling, 4)}). Web Audio's compressor applies it automatically,`);
  out.push('                             so the chain lifts every loop before it squeezes any.');
  out.push('    gain reduction is that lift minus what a loop actually gained: how much');
  out.push('    the chain took back from it. Crest change is with the chain minus without.');
  out.push('');
  out.push('    loop               no chain: peak dB    LUFS   crest    with: dLUFS      GR  dcrest');
  out.push(`    ${'-'.repeat(82)}`);
  const byInput = loops.slice().sort((a, b) => b.bypass.lufs - a.bypass.lufs);
  for (const r of byInput) {
    out.push(`    ${r.name.padEnd(16)} ${' '.repeat(12)}${fmt(dbfs(r.bypass.peak), 7)} ${fmt(r.bypass.lufs, 7)} ${fmt(crest(r.bypass.peak, r.bypass.lufs), 7, 1, false)}   ${' '.repeat(5)}${fmt(delta(r), 7)} ${fmt(reduction(r), 7, 1, false)} ${fmt(crestChange(r), 7)}`);
  }
  out.push('');
  out.push('                                mean      min      max    spread');
  line('loudness, chain on-off', loops.map(delta), 'LU');
  line('gain reduction, dB', loops.map(reduction), 'dB', false);
  line('crest change, dB', loops.map(crestChange), 'dB');
  line('LUFS, no chain', loops.map((r) => r.bypass.lufs), 'LU');
  line('LRA, no chain', loops.map((r) => r.bypass.lra), 'LU', false);
  out.push('');
  // Quarters by how loud the loop is before the chain sees it.
  const q = Math.max(1, Math.floor(byInput.length / 4));
  const top = byInput.slice(0, q);
  const bottom = byInput.slice(-q);
  out.push(`    by loudness before the chain, loudest ${q} against quietest ${q}:`);
  out.push(`      gain reduction       ${fmt(mean(top.map(reduction)), 5, 1, false)} dB against ${fmt(mean(bottom.map(reduction)), 5, 1, false)} dB`);
  out.push(`      crest change         ${fmt(mean(top.map(crestChange)), 5)} dB against ${fmt(mean(bottom.map(crestChange)), 5)} dB`);
  out.push(`      LRA change           ${fmt(mean(top.map((r) => r.lra - r.bypass.lra)), 5)} LU against ${fmt(mean(bottom.map((r) => r.lra - r.bypass.lra)), 5)} LU`);
  out.push(`    the chain moves the corpus LUFS spread from ${fmt(spreadOf(loops.map((r) => r.bypass.lufs)), 4, 1, false)} LU to ${fmt(spreadOf(loops.map((r) => r.lufs)), 4, 1, false)} LU`);
  out.push('');
  return out.join('\n');
}

// Which layers each voice is drawn for, read from the pools in
// characters.js. Textures are named there by what the generator draws, and
// genTexture writes two of those as a differently named event kind -- bells
// as 'bell', drops as 'drop' -- which is the name the synth plays.
const LAYER_POOLS = { melody: 'melodyVoices', chords: 'chordVoices', bass: 'bassVoices', texture: 'textures' };
const TEXTURE_KIND = { bells: 'bell', drops: 'drop' };

function drawnLayers() {
  const layers = {};
  for (const layer of Object.keys(LAYER_POOLS)) layers[layer] = [];
  for (const c of Object.values(CHARACTERS)) {
    for (const [layer, pool] of Object.entries(LAYER_POOLS)) {
      for (const [name] of c[pool] || []) {
        const voice = layer === 'texture' ? TEXTURE_KIND[name] || name : name;
        if (voice !== 'none' && !layers[layer].includes(voice)) layers[layer].push(voice);
      }
    }
  }
  return layers;
}

// The velocity each voice is actually handed in each layer, over a corpus
// drawn from --seed: context for the tables, since a voice that measures
// loud at 0.8 and is only ever drawn at 0.2 is not the problem it looks.
// A chord's figure is its velocity over the root of its note count -- the
// one-note chord that puts the same level on each note, which is what the
// probe plays -- so an arpeggio's single notes count at full weight.
function surveyVelocities(seed) {
  const master = new Rng(seed);
  const seen = {};
  const add = (layer, voice, vel) => { (seen[`${layer}|${voice}`] ||= []).push(vel); };
  for (let i = 0; i < SURVEY_LOOPS; i++) {
    const tracks = render(newSpec(master.seed32())).tracks;
    for (const e of tracks.melody) if (e.vel) add('melody', e.voice, e.vel);
    for (const e of tracks.chords) if (e.vel) add('chords', e.voice, e.vel / Math.sqrt(e.notes.length));
    for (const e of tracks.bass) if (e.vel) add('bass', e.voice, e.vel);
    for (const e of tracks.texture) if (e.vel) add('texture', e.kind, e.vel);
  }
  const out = {};
  for (const [key, vels] of Object.entries(seen)) out[key] = middle(vels);
  return out;
}

// What to render: every voice named (or all of them) in every layer it is
// drawn for, with kalimba as a melody always in, since everything is read
// against it. A voice no profile draws is probed as a melody, as before.
function probeJobs(names, layers) {
  const all = names.length === 1 && names[0] === 'all';
  const jobs = [];
  const add = (layer, voice, tone) => {
    if (jobs.some((j) => j.layer === layer && j.voice === voice)) return;
    const [low, high] = PROBE_WINDOWS[layer];
    jobs.push({ layer, voice, low, high, tone, drawn: layers[layer].includes(voice) });
  };
  if (all) {
    for (const [layer, voices] of Object.entries(layers)) {
      for (const voice of voices) add(layer, voice, layer === 'melody');
    }
  } else {
    for (const voice of names) {
      const home = Object.keys(layers).filter((l) => layers[l].includes(voice));
      if (!home.length) home.push('melody');
      home.forEach((layer, i) => add(layer, voice, i === 0));
    }
  }
  add(PROBE_REFERENCE.layer, PROBE_REFERENCE.voice, false);
  return { jobs, all };
}

// --endings: which note each layer plays, how long, and what counts as cut.
// The lengths are a grace (the engine's GRACE), a short step, the median
// note and a held one. Graces only reach the melody, and nothing else plays
// shorter than a step (0.08 s at the fastest tempo), so the grace length is
// the melody's alone. Six seconds of tail lets the bells ring out.
const ENDING_MIDI = { melody: 67, chords: 55, bass: 40 };
const ENDING_LENGTHS = [0.03, 0.1, 0.4, 1.6];
const endingLengths = (layer) => (layer === 'melody' ? ENDING_LENGTHS : ENDING_LENGTHS.slice(1));
const ENDING_TAIL = 6;
const ENDING_LIMIT = 12;
const endsBadly = (r) => !r.silent && (r.ringing || r.sudden > ENDING_LIMIT);

function reportEndings(rows) {
  const out = [''];
  out.push('driftloom note endings');
  out.push(`  one note per voice and layer at ${ENDING_LENGTHS.map((d) => `${d}s`).join(', ')} (the grace, melody only), dry, velocity 0.7;`);
  out.push(`  the most sudden fall in each note's level: dB from one window of two periods to the next,`);
  out.push(`  beyond the falls either side, within 30 dB of its peak. Over ${ENDING_LIMIT} dB, the note was cut off.`);
  out.push('');
  out.push(`    ${'layer'.padEnd(8)} ${'voice'.padEnd(12)} ${ENDING_LENGTHS.map((d) => `${d}s`.padStart(9)).join('')}`);
  const keys = [...new Set(rows.map((r) => `${r.layer}|${r.voice}`))];
  for (const key of keys) {
    const [layer, voice] = key.split('|');
    const cells = ENDING_LENGTHS.map((d) => {
      const r = rows.find((x) => x.layer === layer && x.voice === voice && x.dur === d);
      if (!r) return '-  '.padStart(9);
      const text = r.silent ? 'silent' : r.ringing ? 'ringing' : `${r.sudden.toFixed(1)}`;
      return `${text}${endsBadly(r) ? ' !' : '  '}`.padStart(9);
    });
    out.push(`    ${layer.padEnd(8)} ${voice.padEnd(12)} ${cells.join('')}`);
  }
  out.push('');
  const bad = rows.filter(endsBadly);
  out.push(bad.length
    ? `  ${bad.length} note(s) cut off: ${bad.map((r) => `${r.voice} (${r.layer}) at ${r.dur}s`).join(', ')}`
    : `  every note of every voice fades out`);
  out.push('');
  return out.join('\n');
}

const noteName = (midi) => `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;

// Punch: how loud the loudest moments are, not the average. Integrated
// loudness averages across the hits and the ear does not -- in blind
// listening a drum loop 0.6 LU over the reference drew a reach for the
// volume where a drumless one 2.7 LU over it drew nothing. These are the
// candidates for a figure that tracks that: EBU R128's momentary (400ms)
// and short-term (3s) loudness at their loudest, the 95th percentile of
// momentary because one block is fragile, and PSR, the peak against the
// loudest short-term loudness, beside the existing crest.
function reportPunch(rows) {
  const out = [];
  const line = (...a) => out.push(summaryLine(...a));
  const hasDrums = (r) => r.layers.drums.rms > 1e-6;
  const psr = (peak, sMax) => dbfs(peak) - sMax;
  out.push('');
  out.push('  punch: loudness at its loudest -- max momentary (400ms), its 95th');
  out.push('    percentile, max short-term (3s), as EBU R128\'s M and S. PSR is sample');
  out.push('    peak less max short-term; crest, beside it, is peak less integrated.');
  out.push('    Loudest first by max momentary.');
  out.push('');
  out.push('    loop             profile     drums     LUFS    max M    M p95    max S     PSR   crest');
  out.push(`    ${'-'.repeat(86)}`);
  for (const r of rows.slice().sort((a, b) => b.mMax - a.mMax)) {
    out.push(`    ${r.name.padEnd(16)} ${r.profile.padEnd(10)} ${(hasDrums(r) ? 'yes' : '-').padStart(5)}  ${fmt(r.lufs, 7)}  ${fmt(r.mMax, 7)}  ${fmt(r.mP95, 7)}  ${fmt(r.sMax, 7)}  ${fmt(psr(r.peak, r.sMax), 6, 1, false)}  ${fmt(dbfs(r.peak) - r.lufs, 6, 1, false)}`);
  }
  out.push('');
  out.push('                                mean      min      max    spread');
  line('max momentary, LUFS', rows.map((r) => r.mMax), 'LU');
  line('momentary p95, LUFS', rows.map((r) => r.mP95), 'LU');
  line('max short-term, LUFS', rows.map((r) => r.sMax), 'LU');
  line('PSR, dB', rows.map((r) => psr(r.peak, r.sMax)), 'dB', false);

  const drummed = rows.filter(hasDrums);
  if (drummed.length) {
    out.push('');
    out.push('  the drums layer alone, dry at its channel gain, on the loops that have it');
    out.push('');
    out.push('    loop             profile        LUFS    max M    M p95    max S     PSR');
    out.push(`    ${'-'.repeat(71)}`);
    for (const r of drummed.slice().sort((a, b) => b.layers.drums.mMax - a.layers.drums.mMax)) {
      const d = r.layers.drums;
      out.push(`    ${r.name.padEnd(16)} ${r.profile.padEnd(10)}  ${fmt(d.lufs, 7)}  ${fmt(d.mMax, 7)}  ${fmt(d.mP95, 7)}  ${fmt(d.sMax, 7)}  ${fmt(psr(d.peak, d.sMax), 6, 1, false)}`);
    }
    out.push('');
    out.push('                                mean      min      max    spread');
    line('drums max momentary', drummed.map((r) => r.layers.drums.mMax), 'LU');
    line('drums momentary p95', drummed.map((r) => r.layers.drums.mP95), 'LU');
    line('drums max short-term', drummed.map((r) => r.layers.drums.sMax), 'LU');
    line('drums PSR, dB', drummed.map((r) => psr(r.layers.drums.peak, r.layers.drums.sMax)), 'dB', false);
  }
  return out;
}

function reportVoices(data, opts, context) {
  const { all, survey } = context;
  const out = [''];
  const toned = data.rows.filter((r) => r.tone);
  if (toned.length) {
    const label = (r) => (r.layer === 'melody' ? r.voice : `${r.voice} (${r.layer})`);
    out.push('driftloom per-voice tone probe');
    out.push(`  A-weighted share of energy in 2-5kHz across two octaves (melody ${PROBE_LOW}-${PROBE_HIGH} MIDI),`);
    out.push(`  velocity 0.8, ${opts.reps} render(s) a note at ${(opts.rate / 1000).toFixed(1)}k, dry, straight off the voice`);
    out.push('');
    out.push('  voice                mean     min     max   spread      sd');
    out.push(`  ${'-'.repeat(60)}`);
    const pc = (v) => `${(100 * v).toFixed(1)}%`;
    for (const r of toned) {
      const xs = r.tone.map((t) => t.share);
      const m = mean(xs);
      const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
      out.push(`  ${label(r).padEnd(18)} ${pc(m).padStart(6)}  ${pc(Math.min(...xs)).padStart(6)}  ${pc(Math.max(...xs)).padStart(6)}  ${pc(spreadOf(xs)).padStart(7)}  ${pc(sd).padStart(6)}`);
    }
    out.push('');
    // Per note only while it still fits across a screen.
    if (toned.length <= 8 && toned.every((r) => r.low === toned[0].low)) {
      out.push('  per note');
      out.push(`    midi  ${toned.map((r) => r.voice.padStart(11)).join('')}`);
      for (let i = 0; i < toned[0].tone.length; i++) {
        out.push(`    ${String(toned[0].tone[i].midi).padStart(4)}  ${toned.map((r) => pc(r.tone[i].share).padStart(11)).join('')}`);
      }
      out.push('');
    }
    out.push('    A "spread" is max minus min across the two octaves: a voice whose');
    out.push('    harshness depends on which note it is playing is harder to mix than');
    out.push('    one that is evenly bright, because no single fix covers it.');
    out.push('');
  }

  // Loudness. Every level is read against kalimba as a melody at the same
  // velocity: a voice Mikey likes and has never complained about, so the
  // target is something he likes rather than a number anyone picked.
  const V = PROBE_VELOCITIES;
  const summary = (row, vel) => {
    const notes = row.notes[vel].filter((n) => Number.isFinite(n.lufs));
    const xs = notes.map((n) => n.lufs);
    return { mean: mean(xs), min: Math.min(...xs), max: Math.max(...xs), silent: row.notes[vel].length - notes.length };
  };
  const ref = data.rows.find((r) => r.layer === PROBE_REFERENCE.layer && r.voice === PROBE_REFERENCE.voice);
  const refLevel = {};
  for (const vel of V) refLevel[vel] = summary(ref, vel).mean;

  out.push('driftloom per-voice loudness');
  out.push(`  K-weighted (ITU-R BS.1770), integrated over each note, ${opts.dur}s notes, ${opts.reps} render(s) a note at ${(opts.rate / 1000).toFixed(1)}k.`);
  out.push('  Each note goes through the engine\'s own path for its layer, and the layer\'s channel goes');
  out.push('  straight out at unity: no channel gain, sends, bus or master chain. A chord is a one-note');
  out.push('  chord event: a pad through pad(), anything else through voice() at the engine\'s 0.8 spread.');
  out.push(`  Every level is in LU against ${PROBE_REFERENCE.voice} as a ${PROBE_REFERENCE.layer} at the same velocity, across its two octaves:`);
  out.push(`  ${PROBE_REFERENCE.voice} is ${V.map((v) => `${refLevel[v].toFixed(1)} LUFS at ${v}`).join(' and ')}.`);

  const flagged = [];
  const disagree = [];
  for (const layer of Object.keys(PROBE_WINDOWS)) {
    const rows = data.rows.filter((r) => r.layer === layer);
    if (!rows.length) continue;
    const stats = rows.map((row) => {
      const s = {};
      for (const vel of V) s[vel] = summary(row, vel);
      return { row, s, slope: s[V[1]].mean - s[V[0]].mean };
    });
    const layerMid = {};
    for (const vel of V) layerMid[vel] = middle(stats.map((x) => x.s[vel].mean));
    const slopeMid = middle(stats.map((x) => x.slope));
    for (const x of stats) {
      x.dev = {};
      for (const vel of V) x.dev[vel] = x.s[vel].mean - layerMid[vel];
      const past = V.map((vel) => Math.abs(x.dev[vel]) > FAMILY_LIMIT);
      x.loud = past.some(Boolean) ? (x.dev[V[1]] + x.dev[V[0]] > 0 ? 'loud' : 'quiet') : '';
      x.split = Math.abs(x.slope - slopeMid) >= VELOCITY_LIMIT || past[0] !== past[1];
      if (all && x.loud) flagged.push({ layer, x });
      if (all && x.split) disagree.push({ layer, x, slopeMid });
    }
    stats.sort((a, b) => b.s[V[1]].mean - a.s[V[1]].mean);

    const [low, high] = PROBE_WINDOWS[layer];
    out.push('');
    out.push(`  ${layer}: ${rows.length} voice${rows.length === 1 ? '' : 's'}, MIDI ${low}-${high} (${noteName(low)}-${noteName(high)}); channel gain ${data.gains[layer]} (${fmt(dbfs(data.gains[layer] / data.gains.melody), 4)} dB against melody) comes after this`);
    const cols = `  mean    min    max  sprd${all ? '  layer' : ''}`;
    const head = `    voice       ${V.map(() => cols).join('  ')}  0.8-0.4  drawn${all ? '  flags' : ''}`;
    // Each velocity's label centred over its own block of columns.
    let over = '';
    V.forEach((v, i) => {
      const label = `velocity ${v}`;
      const at = 16 + i * (cols.length + 2) + Math.floor((cols.length - label.length) / 2);
      over = over.padEnd(at) + label;
    });
    out.push(over);
    out.push(head);
    out.push(`    ${'-'.repeat(head.length - 4)}`);
    const cells = (x, vel) => {
      const s = x.s[vel];
      const r = refLevel[vel];
      return `${fmt(s.mean - r, 6)} ${fmt(s.min - r, 6)} ${fmt(s.max - r, 6)} ${fmt(s.max - s.min, 5, 1, false)}${all ? ` ${fmt(x.dev[vel], 6)}` : ''}`;
    };
    for (const x of stats) {
      const drawn = survey[`${layer}|${x.row.voice}`];
      const flags = [x.loud, x.split ? 'vel' : ''].filter(Boolean).join(' ');
      const name = `${x.row.voice}${x.row.drawn ? '' : '*'}`;
      out.push(`    ${name.padEnd(12)}${V.map((v) => cells(x, v)).join('  ')}  ${fmt(x.slope, 7)}  ${drawn == null ? '    -' : drawn.toFixed(2).padStart(5)}${all ? `  ${flags}` : ''}`);
    }
    if (all) {
      out.push(`    ${'layer median'.padEnd(12)}${V.map((v) => `${fmt(layerMid[v] - refLevel[v], 6)}${' '.repeat(26)}`).join('  ')}${fmt(slopeMid, 7)}`);
    }
  }

  out.push('');
  out.push('    mean, min and max are across the two octaves, in LU against the reference; sprd is');
  out.push('    max minus min. 0.8-0.4 is how much louder the voice gets from velocity 0.4 to 0.8 --');
  out.push('    6.0 LU for a voice whose level is simply proportional to velocity; more when velocity');
  out.push('    also brightens it, as an FM index scaled by velocity does. drawn is the median velocity');
  out.push(`    the generator gives that voice in that layer over ${SURVEY_LOOPS} loops from --seed ${opts.seed}`);
  out.push('    (a chord\'s over the root of its note count, which is the one-note chord this plays).');
  if (data.rows.some((r) => !r.drawn)) out.push('    * no profile draws this voice here; probed as a melody, the old default.');
  if (all) {
    out.push(`    layer is the voice against the median of its layer at that velocity. Flagged: 'loud' or`);
    out.push(`    'quiet' past ${FAMILY_LIMIT} LU from it; 'vel' where the two velocities disagree -- its 0.8-0.4 is`);
    out.push(`    ${VELOCITY_LIMIT} LU or more off the layer's, or it is past ${FAMILY_LIMIT} LU at one velocity only.`);
    out.push('');
    out.push(`  more than ${FAMILY_LIMIT} LU from its layer, at either velocity`);
    if (!flagged.length) out.push('    none');
    for (const { layer, x } of flagged) {
      out.push(`    ${layer.padEnd(8)} ${x.row.voice.padEnd(12)} ${V.map((v) => `${fmt(x.dev[v], 6)} at ${v}`).join('   ')}`);
    }
    out.push('');
    out.push('  where the two velocities disagree');
    if (!disagree.length) out.push('    none');
    for (const { layer, x, slopeMid } of disagree) {
      out.push(`    ${layer.padEnd(8)} ${x.row.voice.padEnd(12)} 0.8-0.4 ${fmt(x.slope, 5)} against the layer's ${fmt(slopeMid, 5)}   ${V.map((v) => `${fmt(x.dev[v], 6)} at ${v}`).join('   ')}`);
    }
  }
  out.push('');
  return out.join('\n');
}

// ----------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));
opts.reps = 3;
opts.dur = opts.note;

if (opts.selftest) {
  const { text, failed } = selftest();
  console.log(text);
  process.exit(failed ? 1 : 0);
}

function writeJson(data) {
  if (!opts.json) return;
  // JSON has no infinity; a silent note or loop is written as null.
  fs.writeFileSync(opts.json, `${JSON.stringify(data, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 1)}\n`);
  console.error(`measure: wrote ${opts.json}`);
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    'playwright',
    'playwright-core',
    '/opt/node22/lib/node_modules/playwright',
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).map((p) => path.join(p, 'playwright')) : []),
  ];
  for (const id of candidates) {
    try { return require(id); } catch { /* try the next one */ }
  }
  // A global install is the common case and `require` does not look there.
  try {
    const root = require('node:child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright'));
  } catch { /* fall through to the message below */ }
  console.error('measure: Playwright is not installed.\n');
  console.error('  Web Audio only exists in a browser, so this tool needs one:\n');
  console.error('    npm install -g playwright && npx playwright install chromium\n');
  console.error('  Then run this again. Nothing else in Driftloom needs it.');
  process.exit(3);
  return null;
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__measure.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(PAGE);
  }
  if (url === '/__probe.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>probe</title>\n<script type="module">${PROBE_PAGE}</script>`);
  }
  if (url === '/__refusals.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>refusals</title>\n<script type="module">${REFUSAL_PAGE}</script>`);
  }
  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
});

const { chromium } = loadPlaywright();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(opts.port, '127.0.0.1', resolve);
});

let browser;
try {
  browser = await chromium.launch({
    executablePath: opts.chrome || undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
} catch (err) {
  server.close();
  console.error(`measure: could not start Chromium -- ${err.message}\n`);
  console.error('  Install it with:  npx playwright install chromium');
  console.error('  Or point at an existing build with:  --chrome /path/to/chrome');
  process.exit(3);
}

const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const probing = !!opts.voices || opts.endings;
const counting = !!opts.refusals;
const pageName = counting ? '__refusals' : probing ? '__probe' : '__measure';
await page.goto(`http://127.0.0.1:${opts.port}/${pageName}.html`);

const ready = counting
  ? () => typeof window.refusalsOne === 'function'
  : probing
    ? () => typeof window.probeVoice === 'function'
    : () => typeof window.measure === 'function';
try {
  await page.waitForFunction(ready, null, { timeout: 15000 });
} catch {
  await browser.close();
  server.close();
  console.error('measure: the page never finished loading the app modules.');
  if (pageErrors.length) console.error(`  ${pageErrors.join('\n  ')}`);
  process.exit(1);
}

if (counting) {
  const corpus = opts.refusals === 'corpus';
  const data = corpus
    ? await page.evaluate((o) => window.refusalsCorpus(o), { n: opts.n, seed: opts.seed, quality: opts.quality, rate: opts.rate, profile: opts.profile })
    : await page.evaluate((o) => window.refusalsOne(o), { code: opts.refusals, rate: opts.rate });
  await browser.close();
  server.close();
  if (pageErrors.length) {
    console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
  }
  console.log(corpus ? reportRefusalsCorpus(data, opts) : reportRefusalsOne(data, opts));
  process.exit(0);
}

if (opts.endings) {
  const jobs = [];
  for (const [layer, voices] of Object.entries(drawnLayers())) {
    if (!ENDING_MIDI[layer]) continue;
    for (const voice of voices) {
      jobs.push({ layer, voice, midi: ENDING_MIDI[layer], low: ENDING_MIDI[layer], lengths: endingLengths(layer) });
    }
  }
  const rows = await page.evaluate((o) => window.probeEndings(o), {
    jobs, vel: 0.7, rate: opts.rate, tail: ENDING_TAIL, width: opts.jobs,
  });
  await browser.close();
  server.close();
  if (pageErrors.length) {
    console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
  }
  writeJson({ lengths: ENDING_LENGTHS, limit: ENDING_LIMIT, rows });
  console.log(reportEndings(rows));
  process.exit(rows.some(endsBadly) ? 1 : 0);
}

if (probing) {
  const { jobs, all } = probeJobs(opts.voices, drawnLayers());
  const survey = surveyVelocities(opts.seed);
  const data = await page.evaluate((o) => window.probeVoice(o), {
    jobs, velocities: PROBE_VELOCITIES, toneVelocity: 0.8,
    rate: opts.rate, reps: opts.reps, dur: opts.dur, width: opts.jobs,
  });
  await browser.close();
  server.close();
  if (pageErrors.length) {
    console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
  }
  writeJson({ reference: PROBE_REFERENCE, velocities: PROBE_VELOCITIES, dur: opts.dur, reps: opts.reps, rate: opts.rate, survey, ...data });
  console.log(reportVoices(data, opts, { all, survey }));
  process.exit(0);
}

const { rows, chain } = await page.evaluate((o) => window.measure(o), opts);
await browser.close();
server.close();

if (pageErrors.length) {
  console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
}

writeJson({ seed: opts.seed, n: opts.n, rate: opts.rate, quality: opts.quality, chain, rows });
console.log(report(rows, opts, chain));
