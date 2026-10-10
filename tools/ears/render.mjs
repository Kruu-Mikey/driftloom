// Render Driftloom loops to WAV files, the way the app plays them:
// the real Engine and Synth (JavaScript engine, full quality) through an
// OfflineAudioContext in headless Chromium, with "Let the loop wander" on
// at its default amount. Lives outside the repo; reads the repo's modules.
//
// Usage: PROTO='{"stereo":true}' PICK=8,9 TAG=after node render-proto.mjs REPO OUTDIR N SECONDS SEED
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const [REPO, OUT, N = '60', SECONDS = '60', SEED = '20261009'] = process.argv.slice(2);
const ROOT = path.resolve(REPO);
fs.mkdirSync(OUT, { recursive: true });
const RATE = 44100;

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { Engine } from '/js/engine.js';
import { Synth } from '/js/synth.js';
import { newSpec, render } from '/js/generator.js';
import { Rng, mulberry32 } from '/js/rng.js';

function leadOf(spec) {
  return Object.entries(spec.mix || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '?';
}
window.specsFor = (seed, n) => {
  const master = new Rng(seed);
  return Array.from({ length: n }, () => newSpec(master.seed32()));
};
window.renderOne = async (spec, seconds, rate) => {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  Math.random = mulberry32(spec.seed >>> 0 || 1);
  const synth = new Synth(ctx, 'full');
  const engine = new Engine(ctx, synth);
  if (engine.clock.worker) engine.clock.worker.terminate();
  engine.driftOn = true;
  engine.driftAmount = 1;
  engine.driftRng = new Rng((spec.seed ^ 0x5eed1e55) >>> 0);
  engine.load(spec);
  engine.playing = true;
  engine.nextStepTime = 0.05;
  let guard = 0;
  while (engine.nextStepTime < seconds && guard++ < 400000) {
    engine._scheduleStep(engine.step, engine.nextStepTime);
    engine._advance();
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  let s = '';
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const r = render(spec);
  const meta = r.meta || {};
  return {
    b64: btoa(s), lead: leadOf(spec), mix: spec.mix, seed: spec.seed,
    bpm: spec.bpm ?? null,
    mood: spec.mood ?? null, meta, bars: r.totalSteps ? r.totalSteps / 16 : null,
  };
};
window.setProto = (p) => { globalThis.PROTO = p; };
window.ready = true;
</script>`;

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__render.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const require = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(globalRoot, 'playwright'));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/__render.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 20000 });

const specs = await page.evaluate(([s, n]) => window.specsFor(s, n), [Number(SEED), Number(N)]);
const index = [];
const PICK = (process.env.PICK || '').split(',').filter(Boolean).map(Number);
const TAG = process.env.TAG || 'x';
await page.evaluate((p) => window.setProto(p), JSON.parse(process.env.PROTO || '{}'));
for (let i = 0; i < specs.length; i++) {
  if (PICK.length && !PICK.includes(i)) continue;
  const r = await page.evaluate(([spec, sec, rate]) => window.renderOne(spec, sec, rate), [specs[i], Number(SECONDS), RATE]);
  const pcm = Buffer.from(r.b64, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  const name = `${String(i).padStart(3, '0')}-${r.lead}-${TAG}.wav`;
  fs.writeFileSync(path.join(OUT, name), Buffer.concat([header, pcm]));
  delete r.b64;
  index.push({ file: name, ...r });
  console.log(name, r.bpm ?? '', r.mood ?? '');
}
fs.writeFileSync(path.join(OUT, `index-${TAG}.json`), JSON.stringify(index, null, 1));
await browser.close();
server.close();
