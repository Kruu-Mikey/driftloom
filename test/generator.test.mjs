// Regression tests for the parts of Driftloom that do not need a browser.
// Run with:  node test/generator.test.mjs
//
// The generator is the piece most likely to break silently. A bad chord
// voicing or an out-of-range note does not throw, it just sounds wrong,
// and often only on one seed in a thousand. So we check thousands.

import { newSpec, render, drift, rerollLayer, LAYERS } from '../js/generator.js';
import { Rng, randomSeed, seedName } from '../js/rng.js';
import { patternToMidi } from '../js/midi.js';

// Node ships a real Blob, but it only hands its bytes back asynchronously.
// Override it so the export can be inspected byte for byte.
globalThis.Blob = class { constructor(parts) { this.bytes = parts[0]; } };

let failures = 0;
function check(label, condition, detail = '') {
  console.log(condition ? `  pass  ${label}` : `  FAIL  ${label} ${detail}`);
  if (!condition) failures++;
}

// ---------------------------------------------------------------------
console.log('\nGeneration across 5000 seeds');

const SEEDS = 5000;
const problems = [];
const range = { melody: [999, 0], bass: [999, 0], chords: [999, 0] };
let drumless = 0;
let sparse = 0;

for (let i = 0; i < SEEDS; i++) {
  const spec = newSpec(randomSeed());
  const p = render(spec);
  let sounding = 0;

  for (const layer of LAYERS) {
    for (const e of p.tracks[layer]) {
      if (e.vel > 0) sounding++;
      const cycle = (p.cycles && p.cycles[layer]) || p.totalSteps;
      if (e.step < 0 || e.step >= cycle) problems.push(`${layer} step ${e.step}/${cycle}`);
      if (!Number.isFinite(e.vel)) problems.push(`${layer} velocity ${e.vel}`);
      const notes = e.notes || (e.midi != null ? [e.midi] : []);
      for (const n of notes) {
        if (!Number.isInteger(n) || n < 21 || n > 108) {
          problems.push(`${layer} note ${n} in ${spec.scale}`);
        }
        if (range[layer]) {
          range[layer][0] = Math.min(range[layer][0], n);
          range[layer][1] = Math.max(range[layer][1], n);
        }
      }
    }
  }
  if (!p.tracks.drums.length) drumless++;
  if (sounding < 6) sparse++;

  // Drift has to respect the same limits, even at full intensity.
  const d = drift(p, new Rng(randomSeed()), 2.4);
  for (const e of d.tracks.melody) {
    if (e.midi < 40 || e.midi > 108) problems.push(`drifted melody ${e.midi}`);
  }
  for (const e of d.tracks.bass) {
    if (e.midi < 24 || e.midi > 55) problems.push(`drifted bass ${e.midi}`);
  }
}

check('every note lands inside the playable range', problems.length === 0, problems.slice(0, 4).join('; '));
check('loops are almost never empty', sparse / SEEDS < 0.01, `${((sparse / SEEDS) * 100).toFixed(2)}% empty`);
// Three of the six characters are ambient by definition, so a large share of
// loops having no percussion is the design, not a fault. The band is wide;
// the printed figure is the thing to actually look at.
check('drums appear on a reasonable share of loops', drumless / SEEDS > 0.2 && drumless / SEEDS < 0.6, `${((drumless / SEEDS) * 100).toFixed(1)}% drumless`);
console.log(`        registers: melody ${range.melody}, bass ${range.bass}, keys ${range.chords}`);

// ---------------------------------------------------------------------
console.log('\nSeeds carry the whole state');

const base = newSpec(20260903);
const a = render(base);
check('the same seed gives the same loop', JSON.stringify(a.tracks) === JSON.stringify(render(base).tracks));

const rolled = render(rerollLayer(base, 'bass'));
check('re-rolling bass changes the bass', JSON.stringify(a.tracks.bass) !== JSON.stringify(rolled.tracks.bass));
check('re-rolling bass leaves drums untouched', JSON.stringify(a.tracks.drums) === JSON.stringify(rolled.tracks.drums));
check('re-rolling bass leaves melody untouched', JSON.stringify(a.tracks.melody) === JSON.stringify(rolled.tracks.melody));

const reharmonised = render(rerollLayer(base, 'chords'));
check('re-rolling chords carries the bass with it', JSON.stringify(a.tracks.bass) !== JSON.stringify(reharmonised.tracks.bass));
check('re-rolling chords keeps the drum groove', JSON.stringify(a.tracks.drums) === JSON.stringify(reharmonised.tracks.drums));

check('drift never edits the pattern it was given', (() => {
  const before = JSON.stringify(a.tracks);
  drift(a, new Rng(7), 2);
  return JSON.stringify(a.tracks) === before;
})());

// ---------------------------------------------------------------------
console.log('\nNames');

const names = new Set();
for (let i = 0; i < 3000; i++) names.add(seedName(randomSeed()));
check('names are reasonably distinct', names.size > 2200, `${names.size} of 3000 unique`);
check('names stay short enough for one line', [...names].every((n) => n.length <= 14));
check('the same seed always gets the same name', seedName(42) === seedName(42));

// ---------------------------------------------------------------------
console.log('\nMIDI export');

function parseMidi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'MThd') throw new Error('missing header');
  if (dv.getUint32(4) !== 6) throw new Error('bad header length');
  const trackCount = dv.getUint16(10);
  let pos = 14;
  const open = new Map();

  for (let t = 0; t < trackCount; t++) {
    if (String.fromCharCode(...bytes.slice(pos, pos + 4)) !== 'MTrk') throw new Error(`track ${t} is not MTrk`);
    const end = pos + 8 + dv.getUint32(pos + 4);
    if (end > bytes.length) throw new Error('track runs past the end of the file');
    let q = pos + 8;
    let running = null;
    let ended = false;
    const varlen = () => {
      let v = 0;
      for (let g = 0; g < 5; g++) {
        const byte = bytes[q++];
        v = (v << 7) | (byte & 0x7f);
        if (!(byte & 0x80)) return v;
      }
      throw new Error('runaway variable-length quantity');
    };

    while (q < end) {
      varlen();
      let status = bytes[q];
      if (status & 0x80) { q++; running = status; } else { status = running; }
      if (status == null) throw new Error('running status with no status byte before it');
      if (status === 0xff) {
        const type = bytes[q++];
        // Read the length into a variable first. `q += varlen()` would
        // capture q before varlen advances it, throwing the read pointer
        // back to where the length field started.
        const dataLength = varlen();
        q += dataLength;
        if (type === 0x2f) ended = true;
      } else {
        const kind = status & 0xf0;
        if (kind === 0x90 || kind === 0x80) {
          const note = bytes[q];
          const vel = bytes[q + 1];
          q += 2;
          if (note > 127 || vel > 127) throw new Error('data byte above 127');
          const key = `${status & 0x0f}:${note}`;
          const n = open.get(key) || 0;
          open.set(key, kind === 0x90 && vel > 0 ? n + 1 : Math.max(0, n - 1));
        } else if (kind === 0xc0 || kind === 0xd0) q += 1;
        else q += 2;
      }
    }
    if (q !== end) throw new Error('track length does not match its contents');
    if (!ended) throw new Error('track has no end marker');
    pos = end;
  }
  if (pos !== bytes.length) throw new Error('bytes left over after the last track');
  const stuck = [...open].filter(([, v]) => v !== 0);
  if (stuck.length) throw new Error(`notes never released: ${JSON.stringify(stuck.slice(0, 2))}`);
}

let midiFailures = 0;
let lastMidiError = '';
for (let i = 0; i < 500; i++) {
  try {
    parseMidi(patternToMidi(render(newSpec(randomSeed())), { repeats: 2 }).bytes);
  } catch (err) {
    midiFailures++;
    lastMidiError = err.message;
  }
}
check('every exported file parses as valid MIDI', midiFailures === 0, lastMidiError);

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failing.\n`);
process.exit(failures === 0 ? 0 : 1);
