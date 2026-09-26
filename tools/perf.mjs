// Live performance measurement: the real app, playing, in headless Chromium.
//
// Run with:  node tools/perf.mjs [--quick] [--out docs/perf-baseline.json]
//
// `measure.mjs` renders offline, faster than real time, which answers "how
// loud" and "how much does a voice cost" but not "how does it feel to have
// this open on a phone". This tool answers the second question. It opens
// the page the way a listener does, presses Play with a real (trusted)
// click, lets the loop wander (drift on, the default), and reads what the
// browser can tell it while the music plays in real time: whether the
// scheduler ran dry, whether the audio device had to fill in silence, how
// busy the main thread is and on what, how fast the audio graph churns,
// whether memory climbs, and how long a tap on Play takes to become sound.
// Under CPU throttling (1x, 4x, 6x) and in both qualities, visible and
// with the tab hidden.
//
// It is engine-agnostic on purpose (roadmap item 16): it drives the app
// only from outside -- clicks, the Diagnostics panel, the page's own
// controls -- and instruments the Web Audio API, not the app's code. A
// replacement engine that keeps the page and reports the same Diagnostics
// lines is measured by the same tool with no changes; `--query
// engine=rust` passes a URL flag through to the page.
//
// Where each figure comes from:
//
//   late ticks        the engine's own counter, read from Diagnostics
//                     (`lateTicks`, `worstLateMs`): the scheduler woke after
//                     a step it should already have queued.
//   device fill-ins   AudioContext.playoutStats (Chromium, behind a Blink
//                     feature this tool turns on): frames the audio device
//                     had to fill because the graph did not deliver in time.
//                     The browser's own glitch signal.
//   audio render      the audio thread's render callbacks, from a Chromium
//                     trace (`RealtimeAudioDestinationHandler::Render`),
//                     per second of playback, and the worst single callback
//                     as a share of its deadline. This is the native Web
//                     Audio graph doing the DSP, off the main thread.
//   main thread       CDP `Performance.getMetrics` deltas: task, script,
//                     layout and style time; paint from the same trace
//                     (Paint, PrePaint, Layerize, UpdateLayer, Commit);
//                     long tasks from a PerformanceObserver.
//   the split         with `--js-profile`, the V8 sampling profiler, each
//                     sample charged to the nearest app file on its stack:
//                     generation (generator, theory, rng, characters),
//                     scheduling (engine, clock), the synth's JavaScript
//                     (synth.js), Web Audio calls (native API functions
//                     called from the synth or engine: creating nodes,
//                     connecting them, automating their params), the UI
//                     (main, ui, cover, media, share, storage), and GC.
//   graph churn       the harness wraps BaseAudioContext's create*
//                     methods, the node constructors, connect, disconnect,
//                     start and every AudioParam automation call, and
//                     counts. Nothing in js/ is touched.
//   memory            JS heap, live Web Audio handlers and DOM nodes over a
//                     long run, each read after a forced GC, and the slope.
//   first sound       from the pointerdown on Play to the first audible
//                     sample at the output, found with an analyser tapped
//                     onto whatever connects to the destination and mapped
//                     through getOutputTimestamp. Cold (the first press
//                     after load, which builds the whole synth) and warm.
//   page weight       bytes the harness's own server sent on a cold first
//                     visit, service worker precache included, and the same
//                     files gzipped (what a compressing CDN would send).
//
// CPU throttling (`Emulation.setCPUThrottlingRate`) slows the page's main
// thread; it does not slow the audio thread. So at 4x and 6x the main
// thread is a phone's and the audio render is still this machine's: read
// the audio figures at 1x and scale them for a slower device.
//
// Chromium only, launched directly over the DevTools protocol (Playwright's
// own page handling keeps every tab "visible", which would make the hidden
// measurements a lie). Uses the Chromium Playwright installs, or --chrome.
// A developer dependency of this one tool, not of Driftloom.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `
driftloom live performance harness

  node tools/perf.mjs [options]

  --loops <names>     comma-separated names from the fixed set, or 'all'
                                                        (default all)
  --code <code>       measure one share code instead of the fixed set
  --quality <list>    full,lite                         (default full,lite)
  --throttle <list>   CPU slowdown factors              (default 1,4,6)
  --seconds <n>       measured window per run           (default 60)
  --warmup <n>        seconds played before measuring   (default 8)
  --parts <list>      which parts to run, any of
                      load,idle,matrix,hidden,muted,split,memory
                                                        (default all)
  --hidden-throttle <list>  throttles for the hidden runs (default 1,6)
  --hidden-seconds <n>      window for the hidden runs   (default --seconds)
  --memory-minutes <n>      length of each memory run    (default 5)
  --js-profile        profile JS in the matrix runs too (default: only in
                      the split part)
  --url <url>         measure a deployed page instead of this folder
  --query <q>         query string for the page, e.g. engine=rust
  --port <n>          local server port                 (default 8741)
  --chrome <path>     an explicit Chromium executable
  --quick             a short smoke run: one loop, 1x and 6x, 15 s windows
  --json <file>       write every figure as JSON
  --md <file>         write the report as Markdown too
  --pick              draw candidate loops and screen them live, to choose
                      the fixed set (prints codes, measures nothing else)
  --help              this
`;

// The fixed set. Chosen by --pick (see the baseline report for how): the
// heaviest loops a live screen found among each profile's busiest, the
// longest forms, and one ordinary loop for scale. Share codes pin the
// loops, so a future engine plays exactly these; a generator change that
// re-renders share codes changes them, and the report says which build
// measured them.
const LOOPS = [
  { name: 'undertow-sai-soan', bars: 2, bpm: 125, why: 'the heaviest audio render in the screen (86.9 ms/s at 1x, full)',
    code: 'DL1-0C05T-28808-60VJT-AEAXA-ES63R-8HYR1-AQGZP-6S656-KAFJ9-78YQX-ZXY0G-18W4V-G083Z-YW9WT-W1S8G-00000-000AM-SR' },
  { name: 'tide-rer-woa', bars: 2, bpm: 137, why: 'second heaviest render; 109 nodes a second',
    code: 'DL1-0C06J-10308-6074Z-2RC1A-SV7BX-SCZ6S-KG6PF-CSEZ4-P0XVV-KXHXH-61A0G-E446X-W0G6B-W1T19-W5JNY-7ABG0-00000-00A3W' },
  { name: 'hollow-laith-hu', bars: 4, bpm: 105, why: 'the sung voices: heavy render (81.1 ms/s)',
    code: 'DL1-0C04J-2R00G-60ZHQ-01BZP-630Q2-3DP7M-GV3HF-3QTSE-RFHKD-SP413-ABM10-87G5Q-000V1-RW061-8Y02P-G6CYN-M2J71-49H00-00000-041D0' },
  { name: 'cinder-da-yoan', bars: 8, bpm: 147, why: 'the most graph churn: 130 nodes a second, 147 bpm',
    code: 'DL1-0C076-20110-60H1R-PE1MF-FVF35-ZPPA7-DDQPN-9D5MS-SBK94-FAREY-9KW08-EZW10-CDR3S-2QAD0-WEFGB-00000-0006S-3R' },
  { name: 'shatter-glein-fei', bars: 2, bpm: 164, why: 'fast and fractured: 164 bpm, 126 nodes a second',
    code: 'DL1-0C088-1GE08-60511-HBCQY-R4DR4-V7RDR-ND7HF-X1MQ6-VHDRA-009XE-Z9G08-8ZW0G-5ZXKW-TCREH-SH000-00000-V4G0' },
  { name: 'undertow-vith-glour', bars: 32, bpm: 131, why: 'a 32-bar loop, the corpus median by notes a second',
    code: 'DL1-0C066-0R240-80QFF-STBB1-S7BSN-XARZ1-AG3PA-793NP-FN4X2-HKYN6-DS210-9T420-Y3G51-WD020-7ZR2W-BGV5B-5G000-08000-04001-00080-00000-2B5R' },
  { name: 'vapor-vui-thoum', bars: 32, bpm: 41, why: 'the longest form in the corpus: 32 bars at 41 bpm, 187 s a pass, nearly silent',
    code: 'DL1-0C00J-08440-801HQ-8B5C4-TNY6D-WE6XG-6FA6N-8P8C4-Z93JQ-WWAHY-RKT08-5ZW0G-BZWM8-2CPDY-R1000-02000-01001-000A0-09000-0BPR0' },
];

// ------------------------------------------------------------ arguments

function fail(message) {
  console.error(`perf: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const o = {
    loops: 'all', code: null, quality: ['full', 'lite'], throttle: [1, 4, 6],
    seconds: 60, warmup: 8, parts: ['load', 'idle', 'matrix', 'hidden', 'muted', 'split', 'memory'],
    hiddenThrottle: [1, 6], hiddenSeconds: null, memoryMinutes: 5, jsProfile: false,
    url: null, query: '', port: 8741, chrome: null, quick: false, json: null, md: null, pick: false,
  };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '--loops': o.loops = next(); break;
      case '--code': o.code = next(); break;
      case '--quality': o.quality = list(next()); break;
      case '--throttle': o.throttle = list(next()).map(Number); break;
      case '--seconds': o.seconds = Number(next()); break;
      case '--warmup': o.warmup = Number(next()); break;
      case '--parts': o.parts = list(next()); break;
      case '--hidden-throttle': o.hiddenThrottle = list(next()).map(Number); break;
      case '--hidden-seconds': o.hiddenSeconds = Number(next()); break;
      case '--memory-minutes': o.memoryMinutes = Number(next()); break;
      case '--js-profile': o.jsProfile = true; break;
      case '--url': o.url = next(); break;
      case '--query': o.query = next().replace(/^\?/, ''); break;
      case '--port': o.port = Number(next()); break;
      case '--chrome': o.chrome = next(); break;
      case '--quick': o.quick = true; break;
      case '--json': o.json = next(); break;
      case '--md': o.md = next(); break;
      case '--pick': o.pick = true; break;
      case '--help': case '-h': console.log(USAGE); process.exit(0); break;
      default: fail(`unknown option ${a}`);
    }
  }
  for (const q of o.quality) if (q !== 'full' && q !== 'lite') fail(`--quality takes full and lite, not ${q}`);
  if (o.throttle.some((t) => !(t >= 1))) fail('--throttle factors are 1 or more');
  if (o.quick) {
    o.seconds = 15;
    o.warmup = 4;
    o.throttle = [1, 6];
    o.hiddenThrottle = [1];
    o.memoryMinutes = 1;
    if (o.loops === 'all') o.loops = LOOPS.length ? LOOPS[0].name : 'all';
  }
  return o;
}

// ------------------------------------------------------------- chromium

function findChrome(explicit) {
  if (explicit) return explicit;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), '.cache', 'ms-playwright')]
    .filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  console.error('perf: no Chromium found. Install one with  npx playwright install chromium');
  console.error('  or point at an existing build with  --chrome /path/to/chrome');
  process.exit(3);
  return null;
}

// A browser with a DevTools connection and nothing else: flattened
// sessions, one socket, events to whoever listens.
async function launch(chromePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftloom-perf-'));
  const proc = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-component-update', '--disable-sync', '--mute-audio',
    // The one glitch counter the browser keeps, off by default in 141.
    '--enable-blink-features=AudioContextPlayoutStats',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not start')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Chromium exited (${code}): ${buf.slice(-400)}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { res, rej, method } = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) rej(new Error(`${method}: ${d.error.message}`));
      else res(d.result);
    } else {
      for (const l of listeners) l(d);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej, method });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const close = async () => {
    try { await Promise.race([send('Browser.close'), sleep(3000)]); } catch { /* already gone */ }
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    try { ws.close(); } catch { /* already gone */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return { send, on, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------- the file server

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.png': 'image/png', '.wasm': 'application/wasm',
};

// Every byte sent is logged, so a cold visit's page weight is what this
// server actually handed over, service worker precache and all.
const served = [];
function startServer(port) {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(ROOT, path.normalize(url));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    const body = fs.readFileSync(file);
    served.push({ at: Date.now(), url, bytes: body.length });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    return res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// --------------------------------------------------- page instrumentation

// Runs before any of the page's own scripts. It wraps the Web Audio API --
// never the app -- to count what the page asks of it, taps the output to
// hear the first sound, and watches for long tasks. `seed` fixes the first
// loop the page draws (Math.random is seeded until the page's modules have
// run, then handed back), so a cold press always starts the same loop.
function instrument(seed) {
  return `(() => {
  if (window.top !== window) return;
  const P = window.__perf = {
    nodes: 0, byType: {}, connects: 0, disconnects: 0, starts: 0, params: 0,
    contexts: [], longTasks: 0, longTaskMs: 0, presses: [], sounds: [], armed: false,
  };
  const seed = ${seed >>> 0};
  if (seed) {
    const native = Math.random;
    let a = seed;
    Math.random = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    document.addEventListener('DOMContentLoaded', () => { Math.random = native; }, { once: true });
  }
  const count = (key) => { P.byType[key] = (P.byType[key] || 0) + 1; };
  const NOT_NODES = new Set(['createBuffer', 'createPeriodicWave']);
  const origConnect = AudioNode.prototype.connect;
  const origDisconnect = AudioNode.prototype.disconnect;
  let makeAnalyser = null;
  for (const proto of [BaseAudioContext.prototype, AudioContext.prototype]) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (!name.startsWith('create')) continue;
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || typeof d.value !== 'function') continue;
      const orig = d.value;
      if (name === 'createAnalyser') makeAnalyser = orig;
      proto[name] = function (...args) {
        if (!NOT_NODES.has(name)) P.nodes++;
        count(name);
        return orig.apply(this, args);
      };
    }
  }
  // Nodes built with constructors rather than factory methods count too.
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!/Node$/.test(key) || key === 'AudioNode' || key === 'AudioDestinationNode') continue;
    const C = window[key];
    if (typeof C !== 'function' || !(C.prototype instanceof AudioNode)) continue;
    window[key] = new Proxy(C, {
      construct(target, args, newTarget) { P.nodes++; count('new ' + key); return Reflect.construct(target, args, newTarget); },
    });
  }
  // The first sound: whatever feeds the destination is also fed to an
  // analyser while a press is waiting to be heard, and only then.
  const taps = [];
  const tapFor = (ctx) => {
    let entry = P.contexts.find((c) => c.ctx === ctx);
    if (!entry) return null;
    if (!entry.analyser) {
      entry.analyser = makeAnalyser.call(ctx);
      entry.analyser.fftSize = 32768;
      entry.buf = new Float32Array(entry.analyser.fftSize);
    }
    return entry;
  };
  const outs = [];
  const tap = (node) => {
    const entry = tapFor(node.context);
    if (!entry) return;
    origConnect.call(node, entry.analyser);
    taps.push([node, entry.analyser]);
  };
  const untap = () => {
    for (const [node, an] of taps.splice(0)) { try { origDisconnect.call(node, an); } catch { /* gone */ } }
  };
  AudioNode.prototype.connect = function (dest, ...rest) {
    P.connects++;
    if (dest instanceof AudioDestinationNode) {
      outs.push(this);
      if (P.armed) tap(this);
    }
    return origConnect.call(this, dest, ...rest);
  };
  AudioNode.prototype.disconnect = function (...args) {
    P.disconnects++;
    return origDisconnect.apply(this, args);
  };
  const origStart = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function (...args) { P.starts++; return origStart.apply(this, args); };
  for (const name of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
    'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) {
    const orig = AudioParam.prototype[name];
    if (typeof orig !== 'function') continue;
    AudioParam.prototype[name] = function (...args) { P.params++; return orig.apply(this, args); };
  }
  const wrapCtx = (C) => C && new Proxy(C, {
    construct(target, args, newTarget) {
      const ctx = Reflect.construct(target, args, newTarget);
      P.contexts.push({ ctx, createdAt: performance.now() });
      return ctx;
    },
  });
  if (window.AudioContext) window.AudioContext = wrapCtx(window.AudioContext);
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;

  let poll = null;
  const listen = () => {
    const found = [];
    for (const entry of P.contexts) {
      if (!entry.analyser) continue;
      const { ctx, analyser, buf } = entry;
      analyser.getFloatTimeDomainData(buf);
      let i = 0;
      while (i < buf.length && Math.abs(buf[i]) < 0.001) i++;
      if (i === buf.length) continue;
      const at = ctx.currentTime - (buf.length - i) / ctx.sampleRate;
      const ts = ctx.getOutputTimestamp();
      const heard = ts.performanceTime + (at - ts.contextTime) * 1000;
      found.push(heard);
    }
    if (!found.length) return;
    const press = P.presses[P.presses.length - 1];
    P.sounds.push({ press, heard: Math.min(...found), ms: Math.min(...found) - press });
    P.armed = false;
    untap();
    clearInterval(poll);
    poll = null;
  };
  P.arm = (at) => {
    P.presses.push(at);
    P.armed = true;
    for (const n of outs) tap(n);
    if (!poll) poll = setInterval(listen, 20);
  };
  // A press on Play. The event's own timestamp is when the finger landed,
  // however long a throttled main thread took to get round to it.
  addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest && e.target.closest('#playBtn')) P.arm(e.timeStamp);
  }, true);
  // New AudioContexts built after the press still have to be tapped.
  const armLate = () => { if (P.armed) for (const n of outs) if (!taps.some(([t]) => t === n)) tap(n); };
  setInterval(armLate, 50);

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { P.longTasks++; P.longTaskMs += e.duration; }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no long task timing */ }

  P.snap = () => {
    const last = P.contexts[P.contexts.length - 1];
    const ctx = last && last.ctx;
    let playout = null;
    try { playout = ctx && ctx.playoutStats ? ctx.playoutStats.toJSON() : null; } catch { playout = null; }
    return {
      now: performance.now(), nodes: P.nodes, byType: { ...P.byType }, connects: P.connects,
      disconnects: P.disconnects, starts: P.starts, params: P.params,
      longTasks: P.longTasks, longTaskMs: P.longTaskMs, playout,
      contexts: P.contexts.length, ctxState: ctx ? ctx.state : null, ctxTime: ctx ? ctx.currentTime : null,
      sampleRate: ctx ? ctx.sampleRate : null, baseLatency: ctx ? ctx.baseLatency : null,
      outputLatency: ctx ? ctx.outputLatency : null, visibility: document.visibilityState,
    };
  };
})();
//# sourceURL=perf-harness.js`;
}

// ------------------------------------------------------------- a session

class Tab {
  constructor(browser, sessionId, targetId) {
    this.b = browser;
    this.sid = sessionId;
    this.targetId = targetId;
  }

  send(method, params) { return this.b.send(method, params, this.sid); }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  // A trusted click, at the element's centre, as a finger would land.
  async press(selector) {
    const box = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`no ${selector} on the page`);
    const base = { x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' };
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }

  metrics() {
    return this.send('Performance.getMetrics').then(({ metrics }) => Object.fromEntries(metrics.map((m) => [m.name, m.value])));
  }

  snap() { return this.eval('window.__perf && window.__perf.snap()'); }

  // The Diagnostics panel, as a listener would read it.
  async diagnostics({ reset = false } = {}) {
    const text = await this.eval(`(() => {
      const d = document.querySelector('details.diag');
      if (d && !d.open) d.open = true;
      ${reset ? "document.getElementById('diagReset').click();" : ''}
      document.getElementById('diagRefresh').click();
      return document.getElementById('diagOut').textContent;
    })()`);
    const out = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (m) out[m[1]] = /^-?\d+(\.\d+)?$/.test(m[2]) ? Number(m[2]) : m[2];
    }
    return out;
  }
}

async function openTab(b, url, { seed, throttle }) {
  const { targetInfos } = await b.send('Target.getTargets');
  const target = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await b.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const tab = new Tab(b, sessionId, target.targetId);
  await tab.send('Page.enable');
  await tab.send('Runtime.enable');
  await tab.send('Performance.enable');
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: instrument(seed) });
  // A prompt is how the app asks for a code when the clipboard is out of
  // reach; answer it with the code being loaded.
  b.on((d) => {
    if (d.sessionId === sessionId && d.method === 'Page.javascriptDialogOpening') {
      tab.send('Page.handleJavaScriptDialog', { accept: true, promptText: tab.pendingCode || '' }).catch(() => {});
    }
  });
  const loaded = new Promise((resolve) => {
    const off = b.on((d) => {
      if (d.sessionId === sessionId && d.method === 'Page.loadEventFired') { off(); resolve(); }
    });
  });
  if (throttle > 1) await tab.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await tab.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(30000)]);
  await tab.eval(`new Promise((r) => (function wait() {
    document.getElementById('playBtn') ? r(true) : setTimeout(wait, 50);
  })())`);
  return tab;
}

// Set a checkbox the way a listener would: click it only if it is wrong.
async function setSwitch(tab, id, want) {
  const on = await tab.eval(`document.getElementById(${JSON.stringify(id)}).checked`);
  if (on !== want) await tab.eval(`document.getElementById(${JSON.stringify(id)}).click()`);
}

async function waitSound(tab, count, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await tab.eval('window.__perf.sounds.length');
    if (s >= count) return tab.eval(`window.__perf.sounds[${count - 1}].ms`);
    await sleep(50);
  }
  return null;
}

// Load a share code through "Paste a code", which is how a person would.
async function loadCode(tab, code) {
  tab.pendingCode = code;
  await tab.eval(`(() => {
    const code = ${JSON.stringify(code)};
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => code, writeText: async () => {} } });
    } catch { /* the prompt fallback answers instead */ }
    document.getElementById('pasteCode').click();
    return true;
  })()`);
  await sleep(300);
  return tab.eval("document.getElementById('loopName').textContent");
}

// -------------------------------------------------------------- tracing

const TRACE_CATEGORIES = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'webaudio', 'audio', 'toplevel',
].join(',');

async function traceStart(b) {
  const events = [];
  let done;
  const finished = new Promise((r) => { done = r; });
  const off = b.on((d) => {
    if (d.method === 'Tracing.dataCollected') events.push(...d.params.value);
    if (d.method === 'Tracing.tracingComplete') done();
  });
  await b.send('Tracing.start', { categories: TRACE_CATEGORIES, transferMode: 'ReportEvents' });
  return async () => {
    await b.send('Tracing.end');
    await Promise.race([finished, sleep(30000)]);
    off();
    return events;
  };
}

// Paint, by the names Chromium gives its main-thread rendering phases.
const PAINT = new Set(['Paint', 'PrePaint', 'Layerize', 'UpdateLayer', 'Commit', 'PaintImage', 'CompositeLayers', 'UpdateLayerTree']);

function readTrace(events, seconds) {
  const names = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  // The page's renderer is the one whose audio device thread rendered.
  const pids = new Map();
  for (const e of events) {
    if (e.name === 'RealtimeAudioDestinationHandler::Render') pids.set(e.pid, (pids.get(e.pid) || 0) + 1);
  }
  const pid = [...pids.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const out = { renderCalls: 0, renderMs: 0, callbacks: 0, callbackMs: 0, worstCallbackMs: 0, paintMs: 0, gcMs: 0, renderThreads: {}, mainPaint: {}, mainTop: {} };
  const callbackDurs = [];
  for (const e of events) {
    if (e.pid !== pid || e.ph !== 'X') continue;
    const thread = names.get(`${e.pid}:${e.tid}`) || String(e.tid);
    const dur = (e.dur || 0) / 1000;
    if (e.name === 'RealtimeAudioDestinationHandler::Render') {
      out.renderCalls++;
      out.renderMs += dur;
      out.renderThreads[thread] = (out.renderThreads[thread] || 0) + dur;
    } else if (e.name === 'AudioDestination::Render') {
      out.callbacks++;
      out.callbackMs += dur;
      callbackDurs.push(dur);
      if (dur > out.worstCallbackMs) out.worstCallbackMs = dur;
    } else if (thread === 'CrRendererMain') {
      out.mainTop[e.name] = (out.mainTop[e.name] || 0) + dur;
      if (PAINT.has(e.name)) {
        out.paintMs += dur;
        out.mainPaint[e.name] = (out.mainPaint[e.name] || 0) + dur;
      } else if (e.name === 'MinorGC' || e.name === 'MajorGC' || e.name === 'V8.GCScavenger' || e.name === 'V8.GCFinalizeMC') {
        out.gcMs += dur;
      }
    }
  }
  callbackDurs.sort((a, b) => a - b);
  out.p99CallbackMs = callbackDurs.length ? callbackDurs[Math.floor(callbackDurs.length * 0.99)] : 0;
  out.seconds = seconds;
  return out;
}

// ------------------------------------------------------------ profiling

const FILE_KIND = {
  'generator.js': 'generation', 'theory.js': 'generation', 'rng.js': 'generation', 'characters.js': 'generation',
  'engine.js': 'scheduling', 'clock.js': 'scheduling',
  'synth.js': 'synth JS',
  'main.js': 'UI JS', 'ui.js': 'UI JS', 'cover.js': 'UI JS', 'media.js': 'UI JS', 'share.js': 'UI JS', 'storage.js': 'UI JS', 'midi.js': 'UI JS',
};

// Each sample is charged to the nearest app frame on its stack. A native
// Web Audio method (creating a node, connecting it, automating a param)
// is charged to "Web Audio calls" when the synth or the engine called it;
// any other native (Math, arrays, performance.now) to the file that called
// it. The harness's own counting wrappers are charged to "harness".
const WEB_AUDIO = /^(create[A-Z]\w*|connect|disconnect|start|stop|setValueAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|setTargetAtTime|setValueCurveAtTime|cancelScheduledValues|cancelAndHoldAtTime|(set |get )?value)$/;

function readProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const kindOf = new Map();
  const classify = (id) => {
    if (kindOf.has(id)) return kindOf.get(id);
    const node = byId.get(id);
    const fn = node.callFrame.functionName;
    const url = node.callFrame.url || '';
    let kind;
    if (fn === '(idle)') kind = 'idle';
    else if (fn === '(garbage collector)') kind = 'GC';
    else if (fn === '(program)') kind = 'browser (layout, paint, tasks)';
    else if (fn === '(root)') kind = 'other';
    else if (url.endsWith('perf-harness.js')) kind = 'harness';
    else {
      let cur = id;
      let file = null;
      while (cur != null) {
        const m = (byId.get(cur).callFrame.url || '').match(/\/js\/([a-z]+\.js)/);
        if (m) { file = m[1]; break; }
        cur = parent.get(cur);
      }
      const k = file ? FILE_KIND[file] || 'other JS' : 'other JS';
      kind = !url && WEB_AUDIO.test(fn) && (k === 'synth JS' || k === 'scheduling') ? 'Web Audio calls' : k;
    }
    kindOf.set(id, kind);
    return kind;
  };
  const ms = {};
  const calls = {};
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) {
    const dt = (timeDeltas[i + 1] ?? timeDeltas[i] ?? 0) / 1000;
    const kind = classify(samples[i]);
    ms[kind] = (ms[kind] || 0) + dt;
    if (kind === 'Web Audio calls') {
      const fn = byId.get(samples[i]).callFrame.functionName;
      calls[fn] = (calls[fn] || 0) + dt;
    }
  }
  return { ms, calls };
}

// ------------------------------------------------------------- one run

// The first loop the page draws, fixed so a cold press measures the same
// thing every time: this seed gives a loop that sounds on its first step.
const FIRST_LOOP_SEED = 20260926;

function pageUrl(opts) {
  const base = opts.url || `http://127.0.0.1:${opts.port}/`;
  return opts.query ? `${base}${base.includes('?') ? '&' : '?'}${opts.query}` : base;
}

async function run(opts, chromePath, cfg) {
  const b = await launch(chromePath);
  try {
    const tab = await openTab(b, pageUrl(opts), { seed: FIRST_LOOP_SEED, throttle: cfg.throttle });
    await setSwitch(tab, 'liteMode', cfg.quality === 'lite');
    await setSwitch(tab, 'driftToggle', true);
    const result = { ...cfg, loop: cfg.loop ? cfg.loop.name : 'idle' };

    if (cfg.idle) {
      // Nothing playing: what the open page costs on its own.
      await sleep(cfg.warmup * 1000);
      const m0 = await tab.metrics();
      const s0 = await tab.snap();
      const stop = await traceStart(b);
      await sleep(cfg.seconds * 1000);
      const m1 = await tab.metrics();
      const s1 = await tab.snap();
      const trace = readTrace(await stop(), cfg.seconds);
      return { ...result, ...perSecond(m0, m1, s0, s1, trace, cfg.seconds) };
    }

    // Cold press: builds the audio context and the whole synth.
    await tab.press('#playBtn');
    result.coldMs = await waitSound(tab, 1);
    await sleep(1500);
    await tab.press('#playBtn'); // stop
    await sleep(700);
    await tab.press('#playBtn'); // warm press
    result.warmMs = await waitSound(tab, 2);
    result.firstLoop = await tab.eval("document.getElementById('loopName').textContent");

    result.loopName = await loadCode(tab, cfg.loop.code);
    await sleep(cfg.warmup * 1000);

    if (cfg.muted) {
      // Every layer muted from its row: the scheduler stops asking for
      // notes and what is left is the graph that runs regardless.
      await tab.eval(`(() => {
        for (const row of document.querySelectorAll('.layer')) row.querySelectorAll('button.icon')[1].click();
        return document.querySelectorAll('.layer.muted').length;
      })()`);
      await sleep(3000); // let the last tails die away
    }

    let other = null;
    if (cfg.hidden) {
      const { targetId } = await b.send('Target.createTarget', { url: 'about:blank', newWindow: false });
      other = targetId;
      await b.send('Target.activateTarget', { targetId });
      await sleep(3000); // let the page notice and retune
    }

    await tab.diagnostics({ reset: true });
    if (cfg.jsProfile) {
      await tab.send('Profiler.enable');
      await tab.send('Profiler.setSamplingInterval', { interval: 500 });
      await tab.send('Profiler.start');
    }
    const m0 = await tab.metrics();
    const s0 = await tab.snap();
    const stop = await traceStart(b);
    await sleep(cfg.seconds * 1000);
    const m1 = await tab.metrics();
    const s1 = await tab.snap();
    const trace = readTrace(await stop(), cfg.seconds);
    let split = null;
    if (cfg.jsProfile) {
      const { profile } = await tab.send('Profiler.stop');
      split = readProfile(profile);
    }
    const diag = await tab.diagnostics();
    if (other) {
      await b.send('Target.closeTarget', { targetId: other });
      await b.send('Target.activateTarget', { targetId: tab.targetId });
    }
    Object.assign(result, perSecond(m0, m1, s0, s1, trace, cfg.seconds), {
      lateTicks: diag.lateTicks, worstLateMs: diag.worstLateMs, ticks: diag.ticks, clock: diag.clock,
      visibility: s1.visibility, split,
    });
    return result;
  } finally {
    await b.close();
  }
}

// Per-second figures between two snapshots.
function perSecond(m0, m1, s0, s1, trace, seconds) {
  const per = (a, b) => (b - a) / seconds;
  const po0 = s0.playout || {};
  const po1 = s1.playout || {};
  return {
    seconds,
    taskMs: per(m0.TaskDuration, m1.TaskDuration) * 1000,
    scriptMs: per(m0.ScriptDuration, m1.ScriptDuration) * 1000,
    layoutMs: per(m0.LayoutDuration, m1.LayoutDuration) * 1000,
    styleMs: per(m0.RecalcStyleDuration, m1.RecalcStyleDuration) * 1000,
    threadMs: per(m0.ThreadTime, m1.ThreadTime) * 1000,
    processMs: per(m0.ProcessTime, m1.ProcessTime) * 1000,
    paintMs: trace.paintMs / seconds,
    gcTraceMs: trace.gcMs / seconds,
    renderMs: trace.renderMs / seconds,
    renderThreads: trace.renderThreads,
    mainPaint: trace.mainPaint,
    mainTop: Object.fromEntries(Object.entries(trace.mainTop).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, +(v / seconds).toFixed(3)])),
    callbacks: trace.callbacks / seconds,
    callbackMs: trace.callbacks ? trace.callbackMs / trace.callbacks : 0,
    worstCallbackMs: trace.worstCallbackMs,
    p99CallbackMs: trace.p99CallbackMs,
    longTasks: s1.longTasks - s0.longTasks,
    longTaskMs: s1.longTaskMs - s0.longTaskMs,
    nodesPerSec: per(s0.nodes, s1.nodes),
    connectsPerSec: per(s0.connects, s1.connects),
    disconnectsPerSec: per(s0.disconnects, s1.disconnects),
    startsPerSec: per(s0.starts, s1.starts),
    paramsPerSec: per(s0.params, s1.params),
    audioHandlers: m1.AudioHandlers,
    heapMB: m1.JSHeapUsedSize / 1048576,
    fillEvents: po1.fallbackFramesEvents != null ? po1.fallbackFramesEvents - (po0.fallbackFramesEvents || 0) : null,
    fillMs: po1.fallbackFramesDuration != null ? po1.fallbackFramesDuration - (po0.fallbackFramesDuration || 0) : null,
    outputLatencyMs: po1.averageLatency ?? (s1.outputLatency ? s1.outputLatency * 1000 : null),
    sampleRate: s1.sampleRate,
    byType: diffCounts(s0.byType, s1.byType, seconds),
  };
}

function diffCounts(a, b, seconds) {
  const out = {};
  for (const [k, v] of Object.entries(b)) {
    const d = (v - (a[k] || 0)) / seconds;
    if (d > 0) out[k] = d;
  }
  return out;
}

// ------------------------------------------------------------ memory run

async function memoryRun(opts, chromePath, cfg) {
  const b = await launch(chromePath);
  try {
    const tab = await openTab(b, pageUrl(opts), { seed: FIRST_LOOP_SEED, throttle: 1 });
    await setSwitch(tab, 'liteMode', cfg.quality === 'lite');
    await setSwitch(tab, 'driftToggle', true);
    await tab.press('#playBtn');
    await waitSound(tab, 1);
    await loadCode(tab, cfg.loop.code);
    await sleep(opts.warmup * 1000);
    await tab.send('HeapProfiler.enable');
    const samples = [];
    const total = cfg.minutes * 60;
    const every = Math.max(10, Math.round(total / 20));
    for (let t = 0; t <= total; t += every) {
      if (t > 0) await sleep(every * 1000);
      await tab.send('HeapProfiler.collectGarbage');
      const m = await tab.metrics();
      samples.push({ t, heapMB: m.JSHeapUsedSize / 1048576, audioHandlers: m.AudioHandlers, domNodes: m.Nodes, listeners: m.JSEventListeners });
    }
    const snap = await tab.snap();
    return { ...cfg, loop: cfg.loop.name, samples, nodesCreated: snap.nodes, slope: slopeOf(samples) };
  } finally {
    await b.close();
  }
}

// Least-squares slope, per minute, of each figure after the first minute.
function slopeOf(samples) {
  const tail = samples.filter((s) => s.t >= 60);
  const use = tail.length >= 3 ? tail : samples;
  const fit = (key) => {
    const n = use.length;
    const mx = use.reduce((a, s) => a + s.t, 0) / n;
    const my = use.reduce((a, s) => a + s[key], 0) / n;
    let num = 0;
    let den = 0;
    for (const s of use) { num += (s.t - mx) * (s[key] - my); den += (s.t - mx) ** 2; }
    return den ? (num / den) * 60 : 0;
  };
  return { heapMBPerMin: fit('heapMB'), audioHandlersPerMin: fit('audioHandlers'), domNodesPerMin: fit('domNodes') };
}

// ------------------------------------------------------------- page load

async function loadRun(opts, chromePath) {
  const b = await launch(chromePath);
  try {
    const start = Date.now();
    served.length = 0;
    const tab = await openTab(b, pageUrl(opts), { seed: FIRST_LOOP_SEED, throttle: 1 });
    // Let the service worker install and precache.
    const t0 = Date.now();
    let sw = '';
    while (Date.now() - t0 < 10000) {
      sw = await tab.eval("navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlling' : (navigator.serviceWorker ? 'pending' : 'none')");
      if (sw === 'controlling') break;
      await sleep(200);
    }
    await sleep(1500);
    const timing = await tab.eval(`(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { domContentLoaded: n ? n.domContentLoadedEventEnd : null, load: n ? n.loadEventEnd : null, fcp: fcp ? fcp.startTime : null };
    })()`);
    const files = new Map();
    for (const s of served) if (s.at >= start) files.set(s.url, (files.get(s.url) || { url: s.url, bytes: s.bytes, requests: 0 }));
    for (const s of served) if (s.at >= start) files.get(s.url).requests++;
    const rows = [...files.values()].map((f) => {
      const body = fs.readFileSync(path.join(ROOT, f.url));
      const text = /\.(js|css|html|json|webmanifest|svg)$/.test(f.url);
      return { ...f, gzip: text ? zlib.gzipSync(body, { level: 9 }).length : f.bytes };
    });
    const firstLoad = served.filter((s) => s.at >= start).reduce((a, s) => a + s.bytes, 0);
    return { sw, timing, rows, firstLoad, local: !opts.url };
  } finally {
    await b.close();
  }
}

// ----------------------------------------------------------------- pick

// Candidates for the fixed set: from corpus seed 1, each profile's
// busiest loop by notes a second (chord notes counted one by one), the
// longest forms, and the corpus's median loop. The live screen then
// measures each one and the report keeps the heaviest.
async function pickCandidates() {
  const { newSpec, render } = await import('../js/generator.js');
  const { Rng } = await import('../js/rng.js');
  const { encodeSong } = await import('../js/share.js');
  const master = new Rng(1);
  const rows = [];
  for (let i = 0; i < 3000; i++) {
    const spec = newSpec(master.seed32());
    const p = render(spec);
    const seconds = p.totalSteps * (60 / spec.bpm / 4);
    let notes = 0;
    for (const [layer, events] of Object.entries(p.tracks)) {
      for (const e of events) {
        if (!e.vel) continue;
        notes += layer === 'chords' || layer === 'texture' ? (e.notes ? e.notes.length : 1) : 1;
      }
    }
    const lead = Object.entries(spec.mix || {}).sort((a, c) => c[1] - a[1])[0][0];
    rows.push({ spec, lead, bars: p.totalSteps / (spec.stepsPerBar || 16), seconds, rate: notes / seconds });
  }
  const pick = [];
  const leads = [...new Set(rows.map((r) => r.lead))].sort();
  for (const lead of leads) {
    const best = rows.filter((r) => r.lead === lead).sort((a, c) => c.rate - a.rate)[0];
    pick.push({ why: `${lead}'s busiest`, ...best });
  }
  const longest = rows.slice().sort((a, c) => c.seconds - a.seconds).slice(0, 2);
  for (const r of longest) pick.push({ why: 'longest', ...r });
  const byRate = rows.slice().sort((a, c) => a.rate - c.rate);
  pick.push({ why: 'median', ...byRate[Math.floor(byRate.length / 2)] });
  return pick.map((r) => ({
    name: `${r.lead}-${r.spec.name}`, why: r.why, code: encodeSong(r.spec), lead: r.lead,
    bars: r.bars, seconds: +r.seconds.toFixed(1), notesPerSec: +r.rate.toFixed(1), bpm: r.spec.bpm,
  }));
}

// --------------------------------------------------------------- report

const f1 = (v) => (v == null || Number.isNaN(v) ? '-' : v.toFixed(1));
const f0 = (v) => (v == null || Number.isNaN(v) ? '-' : Math.round(v).toString());
const f2 = (v) => (v == null || Number.isNaN(v) ? '-' : v.toFixed(2));

function table(head, rows) {
  const lines = [`| ${head.join(' | ')} |`, `|${head.map((h, i) => (i ? '---:' : '---')).join('|')}|`];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

function report(data, opts) {
  const out = [];
  out.push(`Driftloom perf harness -- ${data.build}, Chromium ${data.chromium}, ${data.cpus}; ${opts.seconds} s windows after ${opts.warmup} s of play, drift on.`);
  if (data.load) {
    const L = data.load;
    const total = L.rows.reduce((a, r) => a + r.bytes, 0);
    const gz = L.rows.reduce((a, r) => a + r.gzip, 0);
    out.push('\n### Page weight, cold first visit\n');
    out.push(table(['file', 'bytes', 'gzip', 'requests'], L.rows.sort((a, b) => b.bytes - a.bytes).map((r) => [r.url, r.bytes, r.gzip, r.requests])));
    out.push(`\nTotal ${(total / 1024).toFixed(1)} KB sent (${(gz / 1024).toFixed(1)} KB gzipped), service worker ${L.sw}; DOMContentLoaded ${f0(L.timing.domContentLoaded)} ms, load ${f0(L.timing.load)} ms, first contentful paint ${f0(L.timing.fcp)} ms (local server).`);
  }
  if (data.idle && data.idle.length) {
    out.push('\n### The page open, nothing playing (per second)\n');
    out.push(table(['quality', 'throttle', 'renderer CPU ms', 'main thread ms', 'script ms', 'layout+style ms', 'paint ms', 'long tasks'],
      data.idle.map((r) => [r.quality, `${r.throttle}x`, f0(r.processMs), f1(r.taskMs), f1(r.scriptMs), f1(r.layoutMs + r.styleMs), f1(r.paintMs), r.longTasks])));
  }
  const runs = data.runs || [];
  const vis = runs.filter((r) => r.part === 'matrix' && !r.error);
  if (vis.length) {
    out.push('\n### Playing, visible (per second of playback)\n');
    out.push(table(['loop', 'quality', 'throttle', 'late ticks', 'worst late ms', 'device fill-ins', 'audio render ms', 'worst callback ms', 'renderer CPU ms', 'main thread ms', 'script ms', 'layout+style ms', 'paint ms', 'long tasks', 'nodes/s', 'connects/s', 'param calls/s', 'tap to sound ms (cold / warm)'],
      vis.map((r) => [r.loop, r.quality, `${r.throttle}x`, r.lateTicks, r.worstLateMs, r.fillEvents ?? '-', f1(r.renderMs), `${f1(r.worstCallbackMs)} / ${f1(r.p99CallbackMs)}`,
        f0(r.processMs), f1(r.taskMs), f1(r.scriptMs), f1(r.layoutMs + r.styleMs), f1(r.paintMs), r.longTasks, f0(r.nodesPerSec), f0(r.connectsPerSec), f0(r.paramsPerSec),
        `${f0(r.coldMs)} / ${f0(r.warmMs)}`])));
    out.push('\n"worst callback" is the slowest audio render callback, then the 99th percentile, against a deadline of one buffer.');
  }
  const hid = runs.filter((r) => r.part === 'hidden' && !r.error);
  if (hid.length) {
    out.push('\n### Playing, tab hidden (per second of playback)\n');
    out.push(table(['loop', 'quality', 'throttle', 'visibility', 'late ticks', 'worst late ms', 'device fill-ins', 'audio render ms', 'renderer CPU ms', 'main thread ms', 'script ms', 'paint ms', 'nodes/s'],
      hid.map((r) => [r.loop, r.quality, `${r.throttle}x`, r.visibility, r.lateTicks, r.worstLateMs, r.fillEvents ?? '-', f1(r.renderMs), f0(r.processMs), f1(r.taskMs), f1(r.scriptMs), f1(r.paintMs), f0(r.nodesPerSec)])));
  }
  const muted = runs.filter((r) => r.part === 'muted' && !r.error);
  if (muted.length) {
    out.push('\n### Playing with every layer muted: the graph that runs regardless (per second)\n');
    out.push(table(['loop', 'quality', 'audio render ms', 'renderer CPU ms', 'main thread ms', 'script ms', 'nodes/s'],
      muted.map((r) => [r.loop, r.quality, f1(r.renderMs), f0(r.processMs), f1(r.taskMs), f1(r.scriptMs), f0(r.nodesPerSec)])));
  }
  const splits = runs.filter((r) => r.split && !r.error);
  if (splits.length) {
    const kinds = ['generation', 'scheduling', 'synth JS', 'Web Audio calls', 'GC', 'UI JS', 'browser (layout, paint, tasks)', 'other JS', 'harness'];
    out.push('\n### Where the main thread goes (ms per second of playback, V8 sampling profiler)\n');
    out.push(table(['loop', 'quality', 'throttle', ...kinds, 'audio render (own thread)'],
      splits.map((r) => [r.loop, r.quality, `${r.throttle}x`, ...kinds.map((k) => f2((r.split.ms[k] || 0) / r.seconds)), f1(r.renderMs)])));
    const calls = {};
    for (const r of splits) for (const [k, v] of Object.entries(r.split.calls)) calls[k] = (calls[k] || 0) + v / r.seconds / splits.length;
    const top = Object.entries(calls).sort((a, b) => b[1] - a[1]).slice(0, 12);
    out.push('\nWeb Audio calls, mean ms per second across those runs: ' + top.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ') + '.');
  }
  if (data.memory && data.memory.length) {
    out.push('\n### Memory over a long run (after a forced GC at each reading)\n');
    out.push(table(['loop', 'quality', 'minutes', 'heap MB start', 'heap MB end', 'heap MB/min', 'live audio handlers start / end', 'handlers/min', 'DOM nodes start / end'],
      data.memory.map((m) => {
        const a = m.samples[0];
        const z = m.samples[m.samples.length - 1];
        return [m.loop, m.quality, m.minutes, f2(a.heapMB), f2(z.heapMB), f2(m.slope.heapMBPerMin), `${a.audioHandlers} / ${z.audioHandlers}`, f1(m.slope.audioHandlersPerMin), `${a.domNodes} / ${z.domNodes}`];
      })));
  }
  return out.join('\n');
}

// ----------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));
const chromePath = findChrome(opts.chrome);
const server = opts.url ? null : await startServer(opts.port);
const buildOf = () => {
  try { return fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8').match(/const BUILD = '([^']+)'/)[1]; } catch { return '?'; }
};

async function main() {
  if (opts.pick) {
    const cands = await pickCandidates();
    const screened = [];
    for (const c of cands) {
      for (const quality of opts.quality) {
        const r = await run(opts, chromePath, { loop: c, quality, throttle: 1, warmup: 4, seconds: 20 });
        screened.push({ ...c, quality, renderMs: r.renderMs, nodesPerSec: r.nodesPerSec, taskMs: r.taskMs, scriptMs: r.scriptMs });
        console.error(`screened ${c.name} ${quality}: render ${f1(r.renderMs)} ms/s, nodes ${f0(r.nodesPerSec)}/s, main ${f1(r.taskMs)} ms/s`);
      }
    }
    console.log(JSON.stringify(screened, null, 1));
    return;
  }

  let loops = LOOPS;
  if (opts.code) loops = [{ name: 'code', code: opts.code }];
  else if (opts.loops !== 'all') {
    const want = opts.loops.split(',');
    loops = LOOPS.filter((l) => want.includes(l.name));
    if (!loops.length) fail(`no loops named ${opts.loops}; the set is ${LOOPS.map((l) => l.name).join(', ')}`);
  }
  if (!loops.length) fail('the fixed set is empty; run --pick, or pass --code');

  const probe = await launch(chromePath);
  const { product } = await probe.send('Browser.getVersion');
  await probe.close();
  const data = {
    build: buildOf(), chromium: product, cpus: `${os.cpus().length} x ${os.cpus()[0].model.trim()}`,
    date: new Date().toISOString(), opts, loops, runs: [], memory: [], idle: [],
  };
  const has = (p) => opts.parts.includes(p);
  const log = (s) => console.error(`perf: ${s}`);

  if (has('load')) {
    log('page load');
    data.load = await loadRun(opts, chromePath);
  }
  if (has('idle')) {
    for (const quality of opts.quality) {
      for (const throttle of opts.throttle) {
        log(`idle ${quality} ${throttle}x`);
        data.idle.push(await run(opts, chromePath, { idle: true, quality, throttle, warmup: 3, seconds: Math.min(20, opts.seconds) }));
      }
    }
  }
  const once = async (cfg) => {
    log(`${cfg.loop.name} ${cfg.quality} ${cfg.throttle}x${cfg.hidden ? ' hidden' : ''}${cfg.jsProfile ? ' profiled' : ''}`);
    try {
      const r = await run(opts, chromePath, cfg);
      data.runs.push(r);
      log(`  late ${r.lateTicks}, fill-ins ${r.fillEvents}, render ${f1(r.renderMs)} ms/s, main ${f1(r.taskMs)} ms/s, nodes ${f0(r.nodesPerSec)}/s, tap ${f0(r.coldMs)}/${f0(r.warmMs)} ms`);
    } catch (err) {
      log(`  failed: ${err.message}`);
      data.runs.push({ ...cfg, loop: cfg.loop.name, error: err.message });
    }
  };
  if (has('matrix')) {
    for (const loop of loops) for (const quality of opts.quality) for (const throttle of opts.throttle) {
      await once({ part: 'matrix', loop, quality, throttle, warmup: opts.warmup, seconds: opts.seconds, jsProfile: opts.jsProfile });
    }
  }
  if (has('hidden')) {
    for (const loop of loops) for (const quality of opts.quality) for (const throttle of opts.hiddenThrottle) {
      await once({ part: 'hidden', loop, quality, throttle, hidden: true, warmup: opts.warmup, seconds: opts.hiddenSeconds || opts.seconds });
    }
  }
  if (has('muted')) {
    for (const quality of opts.quality) {
      await once({ part: 'muted', loop: loops[0], quality, throttle: 1, muted: true, warmup: opts.warmup, seconds: Math.min(opts.seconds, 30) });
    }
  }
  if (has('split')) {
    for (const loop of loops) for (const quality of opts.quality) {
      await once({ part: 'split', loop, quality, throttle: 1, warmup: opts.warmup, seconds: Math.min(opts.seconds, 40), jsProfile: true });
    }
  }
  if (has('memory')) {
    const heavy = loops[0];
    for (const quality of opts.quality) {
      log(`memory ${heavy.name} ${quality}, ${opts.memoryMinutes} min`);
      data.memory.push(await memoryRun(opts, chromePath, { loop: heavy, quality, minutes: opts.memoryMinutes }));
    }
  }

  const text = report(data, opts);
  console.log(text);
  if (opts.json) fs.writeFileSync(opts.json, `${JSON.stringify(data, null, 1)}\n`);
  if (opts.md) fs.writeFileSync(opts.md, `${text}\n`);
}

try {
  await main();
} finally {
  if (server) server.close();
}
