// Regression tests for the parts of Driftloom that do not need a browser.
// Run with:  node test/generator.test.mjs
//
// The generator is the piece most likely to break silently. A bad chord
// voicing or an out-of-range note does not throw, it just sounds wrong,
// and often only on one seed in a thousand. So we check thousands.

import { newSpec, render, drift, rerollLayer, LAYERS, gracesOf, harmonyOf } from '../js/generator.js';
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

// A single re-roll can legitimately land on the same chord roots -- short
// progressions repeat, and a sparse bass may place the same few notes
// either way. The claim is that the bass *follows* the harmony, so test it
// over several re-rolls rather than demanding one differ.
let bassFollowed = false;
let drumsHeld = true;
for (let i = 0; i < 12; i++) {
  const reharmonised = render(rerollLayer(base, 'chords'));
  if (JSON.stringify(a.tracks.bass) !== JSON.stringify(reharmonised.tracks.bass)) bassFollowed = true;
  if (JSON.stringify(a.tracks.drums) !== JSON.stringify(reharmonised.tracks.drums)) drumsHeld = false;
}
check('re-rolling chords carries the bass with it', bassFollowed);
check('re-rolling chords keeps the drum groove', drumsHeld);

check('drift never edits the pattern it was given', (() => {
  const before = JSON.stringify(a.tracks);
  drift(a, new Rng(7), 2);
  return JSON.stringify(a.tracks) === before;
})());

// ---------------------------------------------------------------------
console.log('\nTide');

// Tempo and metre are drawn together, so a twelve-step tide loop at waltz
// tempo is a waltz, and one at jig tempo is a jig.
const tides = [];
for (let i = 0; tides.length < 400 && i < 20000; i++) {
  const spec = newSpec(randomSeed());
  const lead = Object.entries(spec.mix).sort((x, y) => y[1] - x[1])[0][0];
  if (lead === 'tide') tides.push({ spec, p: render(spec) });
}
check('tide loops keep tempo and metre together', tides.length === 400 && tides.every(({ spec }) => (spec.stepsPerBar === 16
  ? spec.bpm >= 112 && spec.bpm <= 136
  : (spec.bpm >= 84 && spec.bpm <= 104) || (spec.bpm >= 112 && spec.bpm <= 140))));
const waltzes = tides.filter(({ spec }) => spec.stepsPerBar === 12 && spec.bpm <= 104);
check('a tide waltz leaves the downbeat to the bass', waltzes.length > 50 && waltzes.every(({ p }) => p.harmony.events
  .filter((e) => e.notes.length > 1)
  .every((e) => [4, 6, 8, 10].includes(e.step % 12))), `${waltzes.length} waltzes`);
const drones = tides.filter(({ p }) => p.meta.bassStyle === 'drone');
// The form may still silence the bass for a section; what it silences is
// the drone, held from every downbeat through its bar.
check('a drone is struck on every downbeat and held through the bar', drones.length > 60 && drones.every(({ spec, p }) => {
  const spb = spec.stepsPerBar;
  const bass = p.tracks.bass;
  return bass.every((e) => e.step % spb === 0 && e.dur === spb - 1)
    && new Set(bass.map((e) => e.step)).size === spec.bars;
}), `${drones.length} drones`);

// The waltz tune sits on the beats and the eighths between them, and its
// breaths are whole beats of the waltz, not of 6/8.
check('a tide waltz tune falls on the eighths', waltzes.every(({ p }) => p.tracks.melody.every((e) => e.step % 2 === 0)));
check('a tide waltz breathes in waltz beats', waltzes.every(({ p }) => p.gaps.every((g) => g.start % 4 === 0 && [4, 8, 12].includes(g.len))));

// Graces and harmony are marks on the tune, played from the note as it
// stands; they only ever name a neighbour in the scale, and a real third or
// sixth below.
const heard = tides.flatMap(({ spec, p }) => p.tracks.melody.filter((e) => e.vel).map((e) => ({ spec, e })));
const graced = heard.filter(({ e }) => e.orn);
check('ornaments decorate some notes, never most', graced.length > 100 && graced.length < heard.length * 0.3, `${graced.length} of ${heard.length}`);
check('a grace is the scale neighbour of its note', graced.every(({ spec, e }) => {
  const g = gracesOf(e, spec);
  return g.length === (e.orn === 'turn' ? 2 : 1) && g[0] > e.midi && g[0] - e.midi <= 4 && (g.length === 1 || (g[1] < e.midi && e.midi - g[1] <= 4));
}));
const harmonised = tides.filter(({ p }) => p.tracks.melody.some((e) => e.harm));
check('a harmony line sits under some loops, never under every note', harmonised.length > 60 && harmonised.every(({ p }) => {
  const sounding = p.tracks.melody.filter((e) => e.vel);
  return sounding.filter((e) => e.harm).length < sounding.length;
}), `${harmonised.length} loops`);
// The hand kit is the kit's pattern on a frame drum and a tambourine: no
// kit instrument left in it, and no hand instrument anywhere else.
const HAND_INSTS = new Set(['frame', 'tap', 'jingle', 'ojingle']);
const handLoops = tides.filter(({ p }) => p.meta.kit === 'hand');
check('the hand kit plays frame, tap, zils and shaker only', handLoops.length > 20 && handLoops.every(({ p }) => p.tracks.drums
  .every((e) => HAND_INSTS.has(e.inst) || e.inst === 'shaker')), `${handLoops.length} hand-kit loops`);
check('no other kit plays a hand instrument', tides.filter(({ p }) => p.meta.kit !== 'hand')
  .every(({ p }) => p.tracks.drums.every((e) => !HAND_INSTS.has(e.inst))));
// Waves: one slow swell after another, six to nine seconds each.
const seas = tides.filter(({ p }) => p.meta.textureKind === 'waves');
check('the sea swells in waves of six to nine seconds', seas.length > 20 && seas.every(({ spec, p }) => {
  const sd = 60 / spec.bpm / 4;
  return p.tracks.texture.length > 0 && p.tracks.texture.every((e) => e.kind === 'waves'
    && (e.dur * sd >= 5.9 || e.dur === spec.stepsPerBar) && e.dur * sd <= 9.1);
}), `${seas.length} loops`);
check('the harmony is a third or a sixth below', heard.filter(({ e }) => e.harm).every(({ spec, e }) => {
  const h = harmonyOf(e, spec);
  if (h == null) return true;
  const gap = e.midi - h;
  return e.harm === 'third' ? gap === 3 || gap === 4 : gap === 8 || gap === 9;
}));

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

// A layer on its own cycle has to repeat on that cycle in the export too,
// or the file does not match what was playing.
let polySpec = null;
for (let s = 1; s < 80000 && !polySpec; s++) {
  const cand = newSpec(s);
  if (cand.cycles && cand.cycles.melody && cand.cycles.melody < cand.bars * cand.stepsPerBar) {
    if (render(cand).tracks.melody.some((e) => e.vel > 0)) polySpec = cand;
  }
}
check('a short-cycle layer repeats across the exported file', (() => {
  if (!polySpec) return false;
  const pat = render(polySpec);
  const bytes = patternToMidi(pat, { repeats: 1 }).bytes;
  parseMidi(bytes);
  const cycleSteps = polySpec.cycles.melody;
  const perCycle = pat.tracks.melody.filter((e) => e.vel > 0).length;
  const repeatsInLoop = Math.floor((polySpec.bars * polySpec.stepsPerBar) / cycleSteps);
  // Count melody note-ons in the exported file (track 4, channel 2).
  let ons = 0;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x92 && bytes[i + 2] > 0) ons++;
  }
  return repeatsInLoop > 1 && ons >= perCycle * repeatsInLoop * 0.8;
})(), polySpec ? '' : 'no polymetric example found');

// Roll bursts must not collapse onto the same tick and same pitch.
check('stutter rolls keep their sub-step timing', (() => {
  for (let s = 1; s < 120000; s++) {
    const cand = newSpec(s);
    const pat = render(cand);
    const rolls = pat.tracks.drums.filter((e) => e.roll && e.vel > 0);
    if (rolls.length < 4) continue;
    const bytes = patternToMidi(pat, { repeats: 1 }).bytes;
    parseMidi(bytes); // must still be structurally valid
    const micros = new Set(rolls.map((e) => e.micro));
    return micros.size > 1; // the burst is spread, not stacked
  }
  return false;
})());

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failing.\n`);
process.exit(failures === 0 ? 0 : 1);
