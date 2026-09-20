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
  --help            this

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
  const opts = { n: 20, seed: 1, passes: 3, rate: 44100, quality: 'full', port: 8731, chrome: null };
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

// ----------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));

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
await page.goto(`http://127.0.0.1:${opts.port}/__measure.html`);

try {
  await page.waitForFunction(() => typeof window.measure === 'function', null, { timeout: 15000 });
} catch {
  await browser.close();
  server.close();
  console.error('measure: the page never finished loading the app modules.');
  if (pageErrors.length) console.error(`  ${pageErrors.join('\n  ')}`);
  process.exit(1);
}

const rows = await page.evaluate((o) => window.measure(o), opts);
await browser.close();
server.close();

if (pageErrors.length) {
  console.error(`measure: errors were reported while rendering:\n  ${pageErrors.join('\n  ')}`);
}

console.log(report(rows, opts));
