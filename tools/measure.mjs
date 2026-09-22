// Offline audio measurement for the generator.
//
// Run with:  node tools/measure.mjs [--n 20] [--seed 1] [--passes 3]
//
// This is the audio half of roadmap item 1; `tools/stats.mjs` is the
// generation half. It renders loops offline and reports what actually came
// out of the bus: peak, RMS, full-scale sample count, and the dry level of
// each layer so the balance between them can be measured rather than read
// off the gain table and hoped for.
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
  --voice <names>   per-voice tone probe instead of the corpus report
  --refusals [code] count voice-budget refusals per layer
  --help            this

  --refusals reports what the voice budget turned away, layer by layer,
  through the real Engine and Synth. Given a share code it reports that
  one loop; given nothing it draws a corpus and reports the distribution
  of per-loop melody refusal rates, because a mean hides the loops where
  the tune is actually being eaten.

  --voice takes a comma-separated list (--voice vowel,hum,kalimba) and
  reports, for each one, the share of its A-weighted energy that lands in
  the 2-5kHz presence band, note by note across two octaves. That band is
  where hearing is most sensitive and where a voice reads as harsh, so the
  figure is a stand-in for "how much does this one grate". It is a
  comparison between voices, not an absolute: what makes it useful is
  putting a voice next to one nobody complains about.

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
  const opts = { n: 20, seed: 1, passes: 3, rate: 44100, quality: 'full', port: 8731, chrome: null, voices: null, refusals: null };
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
      case '--help': case '-h': console.log(USAGE); process.exit(0); break;
      default: fail(`unknown option ${arg}`);
    }
  }
  return opts;
}

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

const PAGE = `<!doctype html><meta charset="utf-8"><title>measure</title>
<script type="module">
import { Engine } from '/js/engine.js';
import { Synth } from '/js/synth.js';
import { newSpec } from '/js/generator.js';
import { Rng } from '/js/rng.js';

const LAYERS = ${JSON.stringify(LAYERS)};

window.measure = async (opts) => {
  const master = new Rng(opts.seed || 1);
  const out = [];
  for (let i = 0; i < opts.n; i++) {
    const seed = master.seed32();
    const spec = newSpec(seed);
    // Render whole passes of whatever this loop is, so a slow twenty-four
    // bar piece is measured as a piece and not as its first few seconds.
    // Clamped at both ends so one very slow loop cannot dominate the run.
    const loopDur = spec.bars * (spec.stepsPerBar || 16) * (60 / spec.bpm / 4);
    const seconds = Math.min(70, Math.max(opts.passes * loopDur, 20));

    const ctx = new OfflineAudioContext(2 + LAYERS.length, Math.ceil(seconds * opts.rate), opts.rate);
    const synth = new Synth(ctx, opts.quality);
    const engine = new Engine(ctx, synth);

    const merger = ctx.createChannelMerger(2 + LAYERS.length);
    merger.connect(ctx.destination);
    const splitter = ctx.createChannelSplitter(2);
    synth.ceiling.disconnect();
    synth.ceiling.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 1);
    LAYERS.forEach((name, n) => synth.channels[name].gain.connect(merger, 0, n + 2));

    engine.load(spec);
    engine.playing = true;
    engine.nextStepTime = 0.05;
    let guard = 0;
    while (engine.nextStepTime < seconds && guard++ < 200000) {
      engine._scheduleStep(engine.step, engine.nextStepTime);
      engine._advance();
    }
    const buf = await ctx.startRendering();

    const scan = (ch) => {
      const d = buf.getChannelData(ch);
      let peak = 0, sumSq = 0, full = 0;
      for (let s = 0; s < d.length; s++) {
        const a = d[s] < 0 ? -d[s] : d[s];
        if (a > peak) peak = a;
        if (a >= 0.999) full++;
        sumSq += d[s] * d[s];
      }
      return { peak, rms: Math.sqrt(sumSq / d.length), full };
    };

    const left = scan(0);
    const right = scan(1);
    const layers = {};
    LAYERS.forEach((name, n) => { layers[name] = scan(n + 2); });

    out.push({
      seed,
      name: spec.name,
      bpm: spec.bpm,
      seconds: +seconds.toFixed(1),
      passes: +(seconds / loopDur).toFixed(1),
      peak: Math.max(left.peak, right.peak),
      rms: (left.rms + right.rms) / 2,
      full: left.full + right.full,
      layers,
    });
  }
  return out;
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
const PROBE_PAGE = `
import { Synth } from '/js/synth.js';

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

window.probeVoice = async (o) => {
  const N = 4096;
  const out = {};
  // Precompute the weight per bin: it depends only on the transform size.
  for (const name of o.voices) {
    const notes = [];
    for (let midi = o.low; midi <= o.high; midi++) {
      let share = 0;
      let band = 0;
      let total = 0;
      for (let rep = 0; rep < o.reps; rep++) {
        const seconds = o.dur + 2.2;
        const ctx = new OfflineAudioContext(1, Math.ceil(seconds * o.rate), o.rate);
        const synth = new Synth(ctx, 'full');
        // The budget is a runtime guard and would only refuse notes here.
        synth._budget = () => true;
        // Dry, straight out. The reverb return is shared between layers and
        // would put one voice's tail inside another voice's reading.
        const vowels = ['a', 'e', 'o', 'u'];
        synth.voice(name, midi, 0.05, o.dur, 0.8, ctx.destination,
          { vowel: vowels[(midi - o.low) % 4] });
        const buf = await ctx.startRendering();
        const d = buf.getChannelData(0);

        // Summed periodograms across the whole note, so the figure is over
        // the energy that actually leaves the voice -- attack included,
        // which is where a struck voice does its brightest work.
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
        const df = o.rate / N;
        let b = 0;
        let t = 0;
        for (let i = 1; i < N / 2; i++) {
          const f = i * df;
          if (f > 20000) break;
          const w = aWeight(f);
          const p = power[i] * w * w;
          t += p;
          if (f >= 2000 && f <= 5000) b += p;
        }
        band += b;
        total += t;
      }
      notes.push({ midi, share: total > 0 ? band / total : 0 });
    }
    out[name] = notes;
  }
  return out;
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
import { Rng } from '/js/rng.js';

const LAYERS = ['drums', 'bass', 'chords', 'melody', 'texture'];

// Render one loop and count what each layer asked for and lost.
async function runOne(spec, quality, rate) {
  const spb = spec.stepsPerBar || 16;
  const seconds = Math.min(60, spec.bars * spb * (60 / spec.bpm / 4) + 3);
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
  const master = new Rng(o.seed);
  const rows = [];
  for (let i = 0; i < o.n; i++) {
    const spec = newSpec(master.seed32());
    const r = await runOne(spec, o.quality, o.rate);
    rows.push({
      name: spec.name, seed: spec.seed,
      asked: r.asked, refused: r.refused,
      profile: Object.entries(spec.mix || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '?',
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
  out.push(`  ${rows.length} loops, corpus seed ${opts.seed}, quality '${opts.quality}'`);
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

function report(rows, opts) {
  const out = [];
  out.push('');
  out.push('driftloom offline audio measurement');
  out.push(`  ${rows.length} loops at ${(opts.rate / 1000).toFixed(1)}k, >=${opts.passes} passes each (20-70s), quality '${opts.quality}'`);
  out.push(`  corpus seed ${opts.seed}, real Engine and Synth through an OfflineAudioContext`);
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
  out.push('    layer      loops    peak      rms   rms dBFS   vs melody');
  const melodyRms = mean(rows.filter((r) => r.layers.melody.rms > 1e-6).map((r) => r.layers.melody.rms));
  for (const name of LAYERS) {
    const sounding = rows.filter((r) => r.layers[name].rms > 1e-6);
    if (!sounding.length) {
      out.push(`    ${LAYER_LABELS[name].padEnd(9)} ${String(0).padStart(5)}        -        -          -           -`);
      continue;
    }
    const peak = Math.max(...sounding.map((r) => r.layers[name].peak));
    const rms = mean(sounding.map((r) => r.layers[name].rms));
    const rel = name === 'melody' ? '' : `${fmtDb(dbfs(melodyRms) - dbfs(rms))} dB`;
    out.push(`    ${LAYER_LABELS[name].padEnd(9)} ${String(sounding.length).padStart(5)}   ${peak.toFixed(4)}   ${rms.toFixed(4)}     ${fmtDb(dbfs(rms)).padStart(6)}   ${rel.padStart(9)}`);
  }
  out.push('');
  out.push('    "vs melody" is how far the melody sits above that layer. Positive');
  out.push('    means the melody is louder. Dry only: the reverb and echo returns');
  out.push('    are shared and cannot be attributed back to the layer that sent them.');
  out.push('');
  return out.join('\n');
}

function reportVoices(data, opts) {
  const out = [''];
  out.push('driftloom per-voice tone probe');
  out.push(`  A-weighted share of energy in 2-5kHz, ${PROBE_LOW}-${PROBE_HIGH} MIDI (two octaves),`);
  out.push(`  ${opts.reps} render(s) a note at ${(opts.rate / 1000).toFixed(1)}k, dry, straight off the voice`);
  out.push('');
  out.push('  voice        mean     min     max   spread      sd');
  out.push(`  ${'-'.repeat(52)}`);
  for (const [name, notes] of Object.entries(data)) {
    const xs = notes.map((r) => r.share);
    const m = mean(xs);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
    const pc = (v) => `${(100 * v).toFixed(1)}%`;
    out.push(`  ${name.padEnd(10)} ${pc(m).padStart(6)}  ${pc(lo).padStart(6)}  ${pc(hi).padStart(6)}  ${pc(hi - lo).padStart(7)}  ${pc(sd).padStart(6)}`);
  }
  out.push('');
  out.push('  per note');
  const names = Object.keys(data);
  out.push(`    midi  ${names.map((n) => n.padStart(9)).join('')}`);
  for (let i = 0; i < data[names[0]].length; i++) {
    const row = names.map((n) => `${(100 * data[n][i].share).toFixed(1)}%`.padStart(9)).join('');
    out.push(`    ${String(data[names[0]][i].midi).padStart(4)}  ${row}`);
  }
  out.push('');
  out.push('    A "spread" is max minus min across the two octaves: a voice whose');
  out.push('    harshness depends on which note it is playing is harder to mix than');
  out.push('    one that is evenly bright, because no single fix covers it.');
  out.push('');
  return out.join('\n');
}

// ----------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));
opts.reps = 3;

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
const probing = !!opts.voices;
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
    ? await page.evaluate((o) => window.refusalsCorpus(o), { n: opts.n, seed: opts.seed, quality: opts.quality, rate: opts.rate })
    : await page.evaluate((o) => window.refusalsOne(o), { code: opts.refusals, rate: opts.rate });
  await browser.close();
  server.close();
  if (pageErrors.length) {
    console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
  }
  console.log(corpus ? reportRefusalsCorpus(data, opts) : reportRefusalsOne(data, opts));
  process.exit(0);
}

if (probing) {
  const data = await page.evaluate((o) => window.probeVoice(o), {
    voices: opts.voices, low: PROBE_LOW, high: PROBE_HIGH,
    rate: opts.rate, reps: opts.reps, dur: 1.6,
  });
  await browser.close();
  server.close();
  if (pageErrors.length) {
    console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
  }
  console.log(reportVoices(data, opts));
  process.exit(0);
}

const rows = await page.evaluate((o) => window.measure(o), opts);
await browser.close();
server.close();

if (pageErrors.length) {
  console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
}

console.log(report(rows, opts));
