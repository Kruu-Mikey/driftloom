// The core baseline: what the Rust core plays today, kept in the repo, and a
// check that fails on any difference (queue item 32).
//
//   node tools/baseline.mjs            render, and compare with test/core-baseline.json
//   node tools/baseline.mjs --update   render, and rewrite it
//   node tools/baseline.mjs --only loops,voices,refusals,costs   some parts
//
// Until item 32 the gate for a change to the core was nulling it against the
// JavaScript synth. The core is the engine now; the JavaScript synth is the
// fallback a phone without the core hears. So the gate is this: the core's
// own renders, fingerprinted. The core is deterministic (its renders come
// out the same bit for bit, run after run), so a fingerprint that moves says
// that a sound moved. A PR that changes the sound on purpose runs --update in
// the same PR, and says what moved and why; one that does not change it
// must leave this check passing.
//
// What it keeps, from tools/measure.mjs (the real app's Synth and Engine in
// headless Chromium, on the core):
//
//   loops     40 loops of the corpus (seed 1), full and lite quality: a
//             fingerprint of the output as it reaches the speakers and of
//             each layer's tap, with the integrated loudness, the peak and
//             each layer's loudness beside them to read what a change did
//   voices    every voice in every layer, probed as `measure.mjs --voice
//             all` does (K-weighted level at 0.4 s notes, velocities 0.4
//             and 0.8, and for melody voices the 2-5 kHz share, the coffee
//             shop test): the level per voice, the median of each layer, and
//             a fingerprint of the notes
//   refusals  what the voice budget turns away, per layer, over 100 loops,
//             full and lite
//   costs     VOICE_COST as synth.js states it (the figures themselves came
//             from render timing, which no baseline can keep)
//
// The fingerprints are exact. The figures beside them are rounded
// (loudness and level to 0.01 dB, the tone share to 0.1 point) so a diff is
// readable. The Chromium that rendered them is noted but not compared: the
// core's own renders do not depend on it.
//
// Needs Playwright and Chromium, like tools/measure.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'test', 'core-baseline.json');
const MEASURE = path.join(ROOT, 'tools', 'measure.mjs');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
const update = argv.includes('--update');
const onlyAt = argv.indexOf('--only');
const PARTS = ['loops', 'voices', 'refusals', 'costs'];
const only = onlyAt >= 0 ? argv[onlyAt + 1].split(',') : PARTS;
for (const part of only) if (!PARTS.includes(part)) { console.error(`baseline: no part called '${part}'`); process.exit(2); }
const passThrough = [];
for (const flag of ['--chrome', '--port']) {
  const i = argv.indexOf(flag);
  if (i >= 0) passThrough.push(flag, argv[i + 1]);
}

const LOOPS = 40;
const SEED = 1;
const REFUSAL_LOOPS = 100;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-'));
function measure(args, name) {
  const json = path.join(tmp, `${name}.json`);
  const run = spawnSync(process.execPath, [MEASURE, ...args, ...passThrough, '--json', json], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0 || !fs.existsSync(json)) {
    console.error(`baseline: measure.mjs ${args.join(' ')} failed (${run.status})\n${run.stdout}\n${run.stderr}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(json, 'utf8'));
}

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const dbOf = (x) => (x > 0 ? r2(20 * Math.log10(x)) : null);
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
// FNV-1a over a string, for a fingerprint of figures.
function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ----------------------------------------------------------------- loops

function loopsFor(quality) {
  const data = measure(['--n', String(LOOPS), '--seed', String(SEED), '--quality', quality, '--passes', '1', '--no-chain'], `loops-${quality}`);
  // By name, so a diff says which loop moved (the seed breaks a tie).
  const out = {};
  for (const r of data.rows) {
    out[out[r.name] ? `${r.name}#${r.seed}` : r.name] = {
      seed: r.seed,
      profile: r.profile,
      seconds: r.seconds,
      out: r.hashes.out,
      layers: r.hashes.layers,
      lufs: r2(r.lufs),
      peakDb: dbOf(r.peak),
      layerLufs: Object.fromEntries(Object.entries(r.layers).map(([k, v]) => [k, r2(v.lufs)])),
    };
  }
  return out;
}

// ---------------------------------------------------------------- voices

function voices() {
  // Every other note of each window, one render of each: the core renders
  // the same notes the same way every time, and a change to a voice moves
  // many of them.
  const data = measure(['--voice', 'all', '--note', '0.4', '--reps', '1', '--stride', '3'], 'voices');
  const rows = {};
  const layers = {};
  for (const row of data.rows) {
    const key = `${row.layer}/${row.voice}`;
    const at = (vel) => (row.notes[vel] || []).map((n) => r2(n.lufs));
    const lo = at(0.4);
    const hi = at(0.8);
    const tone = row.tone ? row.tone.map((t) => Math.round(t.share * 1000) / 10) : null;
    rows[key] = {
      level04: r2(median(lo)),
      level08: r2(median(hi)),
      tone: tone ? Math.round(10 * tone.reduce((a, b) => a + b, 0) / tone.length) / 10 : null,
      print: fnv(JSON.stringify([lo, hi, tone])),
    };
    (layers[row.layer] ||= []).push(median(lo));
  }
  return {
    window: 'every 3rd note of each layer\'s window, 0.4 s notes, one render each',
    layerMedian04: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, r2(median(v))])),
    rows,
  };
}

// -------------------------------------------------------------- refusals

function refusals() {
  const out = {};
  for (const quality of ['full', 'lite']) {
    const rows = measure(['--refusals', '--n', String(REFUSAL_LOOPS), '--seed', String(SEED), '--quality', quality], `refusals-${quality}`);
    const sum = { asked: {}, refused: {} };
    for (const r of rows) {
      for (const l of Object.keys(r.asked)) {
        sum.asked[l] = (sum.asked[l] || 0) + r.asked[l];
        sum.refused[l] = (sum.refused[l] || 0) + r.refused[l];
      }
    }
    const melody = rows.map((r) => (r.asked.melody ? r.refused.melody / r.asked.melody : null)).filter((x) => x != null);
    out[quality] = {
      loops: rows.length,
      asked: sum.asked,
      refused: sum.refused,
      meanMelodyRefusal: Math.round(1e4 * melody.reduce((a, b) => a + b, 0) / Math.max(1, melody.length)) / 1e4,
      loopsLosingMelody: melody.filter((x) => x > 0.001).length,
    };
  }
  return out;
}

// ----------------------------------------------------------------- costs

function costs() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'synth.js'), 'utf8');
  const start = source.indexOf('const VOICE_COST = {');
  const end = source.indexOf('\n};', start);
  if (start < 0 || end < 0) { console.error('baseline: VOICE_COST not found in js/synth.js'); process.exit(1); }
  const table = new Function(`return ${source.slice(start + 'const VOICE_COST = '.length, end + 2)}`)();
  const budgets = {};
  for (const name of ['MAX_BUDGET', 'LITE_BUDGET']) {
    const m = source.match(new RegExp(`const ${name} = (\\d+)`));
    budgets[name] = m ? Number(m[1]) : null;
  }
  return { budgets, voices: table };
}

// ------------------------------------------------------------------ run

const now = {};
const log = (m) => console.error(`baseline: ${m}`);
if (only.includes('loops')) {
  now.loops = {};
  for (const quality of ['full', 'lite']) {
    log(`${LOOPS} loops, ${quality}`);
    now.loops[quality] = loopsFor(quality);
  }
}
if (only.includes('voices')) { log('every voice'); now.voices = voices(); }
if (only.includes('refusals')) { log(`refusals over ${REFUSAL_LOOPS} loops, full and lite`); now.refusals = refusals(); }
if (only.includes('costs')) now.costs = costs();
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------ comparing

// Every leaf of a value, as 'a.b[2].c' -> value.
function leaves(value, prefix = '', out = new Map()) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leaves(v, Array.isArray(value) ? `${prefix}[${k}]` : prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

if (update) {
  // A part not rendered this time keeps what was there.
  const kept = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  const next = {
    about: 'The Rust core\'s render fingerprints and measured figures (tools/baseline.mjs). Rewritten by a PR that changes the sound on purpose; checked by every other.',
    ...kept,
    ...now,
  };
  fs.writeFileSync(FILE, `${JSON.stringify(next, null, 1)}\n`);
  console.log(`baseline: wrote ${path.relative(ROOT, FILE)} (${only.join(', ')})`);
  process.exit(0);
}

if (!fs.existsSync(FILE)) {
  console.error('baseline: test/core-baseline.json does not exist; run  node tools/baseline.mjs --update');
  process.exit(1);
}
const kept = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lines = [];
let moved = 0;
for (const part of only) {
  const was = leaves(kept[part] ?? null);
  const is = leaves(now[part]);
  const keys = [...new Set([...was.keys(), ...is.keys()])];
  const diffs = keys.filter((k) => was.get(k) !== is.get(k));
  moved += diffs.length;
  if (diffs.length) {
    lines.push(`  ${part}: ${diffs.length} figure(s) moved`);
    // Fingerprints first, then the figures that explain them.
    for (const k of diffs.slice(0, 60)) lines.push(`    ${k}: ${was.has(k) ? JSON.stringify(was.get(k)) : '(none)'} -> ${is.has(k) ? JSON.stringify(is.get(k)) : '(gone)'}`);
    if (diffs.length > 60) lines.push(`    ... and ${diffs.length - 60} more`);
  } else {
    lines.push(`  ${part}: unchanged (${keys.length} figures)`);
  }
}
console.log(`\nThe core against its baseline (test/core-baseline.json)\n${lines.join('\n')}\n`);
if (moved) {
  console.log('The sound moved. If that is the point of this change, run  node tools/baseline.mjs --update\nin the same PR, and say in it what moved and why.\n');
  process.exit(1);
}
console.log('Nothing moved.\n');
