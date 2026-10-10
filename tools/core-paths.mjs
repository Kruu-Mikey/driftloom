// The Rust core's failure paths and its handover, in the real app (queue
// item 31b): the page as a listener has it, in headless Chromium, with
// `?engine=rust`, and the core made to fail in every way it can.
//
// Run with:  node tools/core-paths.mjs [--port 8741] [--seed 7] [--chrome <path>]
//
// Nothing in js/ is touched. The failures are made from outside, by the
// network layer: a worklet that throws from process() the way a trap in
// the core does (the page's `onprocessorerror`), a .wasm that never
// arrives, a .wasm that is not a module, and a browser whose worklet node
// cannot be built. Each is checked for what a listener would see and what
// Diagnostics reads:
//
//   - the music keeps playing (the JavaScript synth takes over, the page
//     never goes silent for good),
//   - Diagnostics says `rust (failed: ...)`, not `loading` for ever and not
//     healthy,
//   - and a synth the page builds later (the quality toggle) starts with the
//     same answer.
//
// And the handover: when the core arrives after the page has asked for its
// tone, the values it starts from are set at once, not glided to from the
// core's defaults. The messages the page posts to the worklet are recorded
// and the first for each of those parameters must be a plain set.
//
// Needs Playwright and a Chromium build, as tools/measure.mjs does.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('node tools/core-paths.mjs [--port 8741] [--seed 7] [--chrome <path>]');
  process.exit(0);
}
const PORT = Number(flag('--port', 8741));
const CHROME = flag('--chrome', undefined);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch { /* try the next one */ }
  }
  try {
    const root = require('node:child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright'));
  } catch { /* fall through */ }
  console.error('core-paths: Playwright is not installed.  npm install -g playwright && npx playwright install chromium');
  process.exit(3);
  return null;
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.png': 'image/png', '.wasm': 'application/wasm',
};
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url.endsWith('/')) url += 'index.html';
  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', resolve);
});

// Runs before the page's own scripts. A level meter on whatever reaches the
// speakers (an analyser on every node connected to a destination), and a
// record of the parameter messages posted to the worklet.
const SEED = Number(flag('--seed', 7));
const INSTRUMENT = `(() => {
  // The first loop the page draws is always the same one (Math.random is
  // seeded until the page's modules have run), so a run does not depend on
  // how soon its intro has a note in it.
  const native = Math.random;
  let a = ${SEED};
  Math.random = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  document.addEventListener('DOMContentLoaded', () => { Math.random = native; }, { once: true });
  const taps = [];
  window.__taps = taps;
  window.__params = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      const an = new AnalyserNode(this.context, { fftSize: 2048 });
      connect.call(this, an);
      taps.push(an);
    }
    return connect.call(this, dest, ...rest);
  };
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && m.type === 'param') window.__params.push({ id: m.id, op: m.op, value: m.value, tau: m.tau });
    return post.call(this, m, ...rest);
  };
  // The loudest recent sample at the speakers, over every tap.
  const buf = new Float32Array(2048);
  window.__level = () => {
    let peak = 0;
    for (const an of taps) {
      an.getFloatTimeDomainData(buf);
      for (const x of buf) peak = Math.max(peak, Math.abs(x));
    }
    return peak;
  };
})();`;

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: CHROME || undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${ok || !detail ? '' : `  -- ${detail}`}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fresh page on the app with `?engine=rust`, `setup` run on it first.
async function open(setup) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(INSTRUMENT);
  if (setup) await setup(page, context);
  await page.goto(`http://127.0.0.1:${PORT}/index.html?engine=rust`);
  return { page, context, errors };
}
async function play(page) {
  await page.click('#playBtn');
}
// Diagnostics' engine line, as the page prints it.
async function engineLine(page) {
  await page.evaluate(() => document.querySelector('.diag').setAttribute('open', ''));
  await page.click('#diagRefresh');
  const text = await page.textContent('#diagOut');
  return (text.split('\n').find((l) => l.startsWith('engine:')) || '').trim();
}
// The loudest the speakers got over the next `ms`.
async function loudest(page, ms) {
  const until = Date.now() + ms;
  let peak = 0;
  while (Date.now() < until) {
    peak = Math.max(peak, await page.evaluate(() => window.__level()));
    await sleep(40);
  }
  return peak;
}
const AUDIBLE = 0.005;

// ---------------------------------------------------------------- control

console.log('\nThe core, healthy');
{
  const { page, context, errors } = await open();
  await play(page);
  await sleep(2500);
  const line = await engineLine(page);
  check('Diagnostics reads the core, healthy', /^engine: rust\s+late: \d+\s+fallback: \d+/.test(line), line);
  check('and it is playing', (await loudest(page, 2500)) > AUDIBLE);
  check('the page reported no errors', errors.length === 0, errors.join('; '));
  await context.close();
}

// ----------------------------------------------- a processor error, playing

console.log('\nThe core throws from process() while playing (a trap)');
{
  // The worklet, as served, with a throw in process() on its 800th block
  // (about 2.3 s): what a trap in the core does. A network route cannot
  // reach a worklet's module, so the page's addModule hands the worklet the
  // patched source as a blob instead.
  const { page, context, errors } = await open(async (p) => {
    await p.addInitScript(() => {
      const addModule = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = async function (url, options) {
        const source = await (await fetch(url)).text();
        const patched = source.replace(
          'process(inputs, outputs) {',
          'process(inputs, outputs) {\n    globalThis.__blocks = (globalThis.__blocks || 0) + 1;\n'
          + "    if (globalThis.__blocks === 800) throw new WebAssembly.RuntimeError('unreachable');",
        );
        if (patched === source) throw new Error('core-paths: the worklet has no process() to patch');
        return addModule.call(this, URL.createObjectURL(new Blob([patched], { type: 'text/javascript' })), options);
      };
    });
  });
  await play(page);
  await sleep(1500);
  const before = await engineLine(page);
  check('before the trap Diagnostics reads the core, healthy', /^engine: rust\s+late:/.test(before), before);
  check('and it is playing', (await loudest(page, 1500)) > AUDIBLE);
  await sleep(2500);
  const after = await engineLine(page);
  check('after it Diagnostics says the core failed', /^engine: rust \(failed: .+\)/.test(after), after);
  check('the music did not stop: the JavaScript synth plays on', (await loudest(page, 4000)) > AUDIBLE);
  const later = await engineLine(page);
  check('and the notes the core would have played count as fallbacks', /fallback: [1-9]\d*/.test(later), later);
  check('the page reported no errors', errors.length === 0, errors.join('; '));
  await context.close();
}

// ------------------------------------------------- a core that never arrives

console.log('\nThe core fails to load (the .wasm never arrives)');
{
  const { page, context, errors } = await open(async (p) => {
    await p.route('**/js/dlcore.wasm', (route) => route.abort('failed'));
  });
  await play(page);
  await sleep(2500);
  const line = await engineLine(page);
  check('Diagnostics says the core failed, not loading', /^engine: rust \(failed: .+\)/.test(line), line);
  check('the music plays in JavaScript', (await loudest(page, 3000)) > AUDIBLE);
  check('and the notes count as fallbacks', /fallback: [1-9]\d*/.test(await engineLine(page)));
  // A synth the page builds later starts with the same answer.
  await page.evaluate(() => { document.querySelector('#liteMode').click(); });
  await sleep(1500);
  const rebuilt = await engineLine(page);
  check('a rebuilt synth (the quality toggle) says so too', /^engine: rust \(failed: .+\)/.test(rebuilt), rebuilt);
  check('and plays', (await loudest(page, 2500)) > AUDIBLE);
  check('the page reported no errors', errors.length === 0, errors.join('; '));
  await context.close();
}

console.log('\nThe .wasm is not a module');
{
  const { page, context } = await open(async (p) => {
    await p.route('**/js/dlcore.wasm', (route) => route.fulfill({ status: 200, contentType: 'application/wasm', body: Buffer.from('not wasm') }));
  });
  await play(page);
  await sleep(2500);
  const line = await engineLine(page);
  check('Diagnostics says the core failed', /^engine: rust \(failed: .+\)/.test(line), line);
  check('the music plays in JavaScript', (await loudest(page, 3000)) > AUDIBLE);
  await context.close();
}

console.log('\nThe worklet node cannot be built');
{
  const { page, context } = await open(async (p) => {
    await p.addInitScript(() => {
      const Real = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Real {
        constructor() { throw new Error('no worklet node here'); }
      };
    });
  });
  await play(page);
  await sleep(2500);
  const line = await engineLine(page);
  check('Diagnostics says the core failed, with why', /^engine: rust \(failed: no worklet node here\)/.test(line), line);
  check('the music plays in JavaScript', (await loudest(page, 3000)) > AUDIBLE);
  await context.close();
}

// ------------------------------------------------------------- the handover

console.log('\nThe core arrives after the page asked for its tone');
{
  // The .wasm held back a second, so the page's setTone, setEchoTime and the
  // rest have been asked for before the core is there to hear them.
  const { page, context } = await open(async (p) => {
    await p.route('**/js/dlcore.wasm', async (route) => {
      await sleep(1000);
      await route.continue();
    });
  });
  await play(page);
  await sleep(3500);
  const line = await engineLine(page);
  check('the core arrived and plays', /^engine: rust\s+late:/.test(line), line);
  const params = await page.evaluate(() => window.__params);
  // The ids the handover replays (js/core.js, MIX): the tone, the wobble's
  // depths, the reverb's, the echo's time, and the five channel gains.
  const names = { 12: 'tone', 13: 'wow', 14: 'flutter', 8: 'combFb', 9: 'combFreq', 10: 'combSum', 11: 'reverbOut', 7: 'echo' };
  const SET = 0;
  const first = new Map();
  for (const m of params) if (!first.has(m.id)) first.set(m.id, m);
  check('the handover set the tone, the wobble and the reverb', [12, 13, 14, 8, 9, 10, 11].every((id) => first.has(id)),
    `seen: ${[...first.keys()].join(',')}`);
  for (const [id, label] of Object.entries(names)) {
    const m = first.get(Number(id));
    if (!m) continue;
    check(`the first ${label} message is a set, not a glide`, m.op === SET, `op ${m.op}`);
  }
  await context.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failing.\n` : '\nAll good.\n');
process.exit(failures ? 1 : 0);
