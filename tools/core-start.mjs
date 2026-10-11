// How soon the Rust core is ready, and what the first Play hears (queue item
// 32): the real app in headless Chromium, with the CPU slowed through the
// DevTools protocol.
//
// Run with:  node tools/core-start.mjs [--throttle 1,4,6] [--runs 5]
//                                      [--root <folder>] [--query <q>] [--chrome <path>]
//
// Two things, per throttle:
//
//   page load   how long after the page began the core is in: the .wasm
//               fetched and the worklet module added (nothing pressed)
//   first tap   Play pressed as soon as the page has its buttons: how long
//               after the tap the core's node is built, how many notes
//               played in JavaScript before it (Diagnostics' `fallback`),
//               and when the first sound reached the speakers
//
// `--root` serves another folder (a worktree of an older build, say), and
// `--query` goes on its URL: v82 needs  --query engine=rust.
// The figures are the medians over the runs. Nothing in js/ is touched; the
// instrumentation is a script run before the page's own.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
const ROOT = path.resolve(flag('--root', HERE));
const THROTTLES = flag('--throttle', '1,4,6').split(',').map(Number);
const RUNS = Number(flag('--runs', 5));
const QUERY = flag('--query', '');
const PORT = Number(flag('--port', 8751));
const CHROME = flag('--chrome', undefined);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch { /* try the next one */ }
  }
  console.error('core-start: Playwright is not installed.  npm install -g playwright && npx playwright install chromium');
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

// Before the page's own scripts: when the .wasm arrived, when the worklet
// module was added, when the core's node was built, when the first sound
// reached the speakers (an analyser on whatever connects to a destination).
const INSTRUMENT = `(() => {
  const t = (window.__t = { wasm: null, module: null, node: null, sound: null });
  const now = () => performance.now();
  const realFetch = window.fetch;
  window.fetch = function (input, ...rest) {
    const p = realFetch.call(this, input, ...rest);
    if (String((input && input.url) || input).endsWith('dlcore.wasm')) p.then(() => { if (t.wasm == null) t.wasm = now(); });
    return p;
  };
  const addModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = function (...args) {
    return addModule.apply(this, args).then((r) => { if (t.module == null) t.module = now(); return r; });
  };
  if (window.AudioWorkletNode) {
    const Real = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Real {
      constructor(...args) { super(...args); if (t.node == null) t.node = now(); }
    };
  }
  const taps = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      const an = new AnalyserNode(this.context, { fftSize: 1024 });
      connect.call(this, an);
      taps.push(an);
    }
    return connect.call(this, dest, ...rest);
  };
  const buf = new Float32Array(1024);
  const poll = () => {
    if (t.sound == null) {
      for (const an of taps) {
        an.getFloatTimeDomainData(buf);
        if (buf.some((x) => Math.abs(x) > 0.002)) { t.sound = now(); break; }
      }
    }
    requestAnimationFrame(poll);
  };
  document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(poll));
})();`;

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: CHROME || undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const fmt = (x) => (x == null ? '-' : `${Math.round(x)} ms`);

async function open(throttle) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(INSTRUMENT);
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  return { page, context };
}
const url = `http://127.0.0.1:${PORT}/index.html${QUERY ? `?${QUERY.replace(/^\?/, '')}` : ''}`;

async function engineLine(page) {
  await page.evaluate(() => document.querySelector('.diag').setAttribute('open', ''));
  await page.click('#diagRefresh');
  const text = await page.textContent('#diagOut');
  return (text.split('\n').find((l) => l.startsWith('engine:')) || '').trim();
}

console.log(`\nthe core's start, ${ROOT === HERE ? 'this folder' : ROOT}${QUERY ? ` ?${QUERY}` : ''}, ${RUNS} runs each, medians\n`);
console.log('  throttle   page load: .wasm in   module added     first tap: node built   fallback notes   first sound');
for (const throttle of THROTTLES) {
  const idle = [];
  const tap = [];
  for (let run = 0; run < RUNS; run++) {
    {
      const { page, context } = await open(throttle);
      await page.goto(url);
      await sleep(4000 * Math.max(1, throttle / 2));
      idle.push(await page.evaluate(() => ({ wasm: window.__t.wasm, module: window.__t.module })));
      await context.close();
    }
    {
      const { page, context } = await open(throttle);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#playBtn');
      const at = await page.evaluate(() => performance.now());
      await page.click('#playBtn');
      await sleep(3500 * Math.max(1, throttle / 2));
      const t = await page.evaluate(() => window.__t);
      const line = await engineLine(page);
      const fell = Number((line.match(/fallback: (\d+)/) || [])[1]);
      tap.push({ node: t.node == null ? null : t.node - at, fell: Number.isFinite(fell) ? fell : null, sound: t.sound == null ? null : t.sound - at, line });
      await context.close();
    }
  }
  console.log(`  ${`${throttle}x`.padEnd(9)}  ${fmt(median(idle.map((r) => r.wasm))).padEnd(18)} ${fmt(median(idle.map((r) => r.module))).padEnd(15)} ${fmt(median(tap.map((r) => r.node))).padEnd(22)} ${String(median(tap.map((r) => r.fell)) ?? '-').padEnd(15)} ${fmt(median(tap.map((r) => r.sound)))}`);
  const worst = tap.filter((r) => r.fell > 0).length;
  if (worst) console.log(`             ${worst} of ${tap.length} first taps played notes in JavaScript first`);
}
console.log('');
await browser.close();
server.close();
