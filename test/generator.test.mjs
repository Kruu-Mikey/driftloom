// Regression tests for the parts of Driftloom that do not need a browser.
// Run with:  node test/generator.test.mjs
//
// The generator is the piece most likely to break silently. A bad chord
// voicing or an out-of-range note does not throw, it just sounds wrong,
// and often only on one seed in a thousand. So we check thousands.

import { newSpec, render, drift, rerollLayer, LAYERS, gracesOf, harmonyOf, developmentOf, DEPTH, characterOf } from '../js/generator.js';
import { Rng, randomSeed, seedName } from '../js/rng.js';
import { patternToMidi } from '../js/midi.js';
import { SCALES, SCALE_BRIGHTNESS } from '../js/theory.js';
import { MOODS, moodForCode, codeForMood, moodWord, pointWord } from '../js/moods.js';
import { encodeSong, decodeSong } from '../js/share.js';

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
// Six of the sixteen profiles rarely or never have drums (haven and vapor
// never; thaw, clockwork, hollow and shrine about one loop in ten), so a
// large share of loops having no percussion is the design, not a fault.
// The band is wide; the printed figure is the thing to actually look at.
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
// A nylon guitar strums down on the beat and up off it; nothing else strums.
const strummed = tides.filter(({ p }) => p.tracks.chords.some((e) => e.voice === 'nylon'));
check('nylon strums down on the beat and up off it, and nothing else strums', strummed.length > 20 && tides.every(({ spec, p }) => {
  const beat = spec.stepsPerBar === 12 && spec.bpm >= 112 ? 6 : 4;
  return p.tracks.chords.every((e) => (e.voice === 'nylon'
    ? e.strum === ((e.step % spec.stepsPerBar) % beat === 0 ? 'down' : 'up')
    : e.strum === undefined));
}), `${strummed.length} loops with nylon`);
check('the harmony is a third or a sixth below', heard.filter(({ e }) => e.harm).every(({ spec, e }) => {
  const h = harmonyOf(e, spec);
  if (h == null) return true;
  const gap = e.midi - h;
  return e.harm === 'third' ? gap === 3 || gap === 4 : gap === 8 || gap === 9;
}));

// ---------------------------------------------------------------------
console.log('\nCinder');

const cinders = [];
for (let i = 0; cinders.length < 300 && i < 20000; i++) {
  const spec = newSpec(randomSeed());
  const lead = Object.entries(spec.mix).sort((x, y) => y[1] - x[1])[0][0];
  if (lead === 'cinder') cinders.push({ spec, p: render(spec) });
}
check('cinder loops run a fast 6/8, some 4/4', cinders.length === 300 && cinders.every(({ spec }) => (spec.stepsPerBar === 12
  || spec.stepsPerBar === 16) && spec.bpm >= 120 && spec.bpm <= 150));
const drummed = cinders.filter(({ p }) => p.tracks.drums.length).length;
check('drums play in about nine cinder loops in ten', drummed > 300 * 0.8 && drummed < 300 * 0.97, `${drummed} of 300`);
// The Andalusian cadence, in A: Am-G-F-E, the last chord major. In each
// mode it is written for, every chord of it comes out a plain triad of the
// quality the cadence wants, whatever the mode's own degrees would make.
const pcOf = (n) => ((n % 12) + 12) % 12;
// A blend can bring two-note chords, and stacked fourths that have no third
// at all; what no chord may do is carry the wrong third.
const third = (slot) => {
  const pcs = new Set(slot.notes.map(pcOf));
  const r = pcOf(slot.rootMidi);
  const [minor, major] = [pcs.has(pcOf(r + 3)), pcs.has(pcOf(r + 4))];
  return major && !minor ? 'M' : minor && !major ? 'm' : '-';
};
// A two-bar loop has room for the first two chords of it. A loop that
// develops can play it in its departure rather than from the top, so the
// four chords are read from the start of the section it is in.
// A section has only its own chords: a two-bar departure holds the first
// two of the cadence, as a two-bar loop does.
const cadenceRange = ({ spec, p }) => {
  const dev = developmentOf(spec);
  if (!dev) return [0, Infinity];
  const first = p.harmony.slots.find((s) => s.steps).startStep;
  let at = 0;
  let range = [0, Infinity];
  for (const sec of dev.sections) {
    if (first >= at * p.stepsPerBar) range = [at * p.stepsPerBar, (at + sec.bars) * p.stepsPerBar];
    at += sec.bars;
  }
  return range;
};
const cadenceOf = (x) => {
  const [from, to] = cadenceRange(x);
  return x.p.harmony.slots.filter((s) => s.startStep >= from && s.startStep < to).slice(0, 4);
};
const cadences = cinders.filter(({ p }) => p.harmony.slots.some((s) => s.steps));
const whole = cadences.filter((x) => cadenceOf(x).length >= 4);
const spelt = whole.map((x) => cadenceOf(x).map(third).join(''));
check('the Andalusian cadence falls a tone, a tone, a semitone, to a major chord', whole.length > 30 && whole.every((x) => {
  const four = cadenceOf(x);
  return four.slice(1).map((s, i) => pcOf(four[i].rootMidi - s.rootMidi)).join() === '2,2,1';
}) && spelt.every((q) => /^[m-][M-][M-][M-]$/.test(q)) && spelt.filter((q) => q === 'mMMM').length > whole.length * 0.8,
`${spelt.filter((q) => q === 'mMMM').length} of ${whole.length} loops spell every chord in full`);
// Over a spelled chord the tune and the bass play in its scale: the G# over
// the E major, never the mode's G against it.
const slotOf = (p, step) => p.harmony.slots.filter((s) => s.startStep <= step % p.harmony.cycleSteps).pop();
check('a line over a spelled chord never plays the tone the spelling replaced', cadences.every(({ spec, p }) => {
  const mode = SCALES[spec.scale].steps;
  return ['melody', 'bass'].every((layer) => p.tracks[layer].every((e) => {
    const slot = slotOf(p, e.step);
    if (!slot.steps) return true;
    const pc = pcOf(e.midi - spec.root);
    return e.steps === slot.steps && (slot.steps.includes(pc) || !mode.includes(pc));
  }));
}));
check('graces and harmony over a spelled chord stay in its scale', cadences.every(({ spec, p }) => p.tracks.melody
  .filter((e) => e.steps)
  .every((e) => {
    const marked = { ...e, orn: 'turn', harm: 'third' };
    const h = harmonyOf(marked, spec);
    return [...gracesOf(marked, spec), ...(h == null ? [] : [h])].every((n) => e.steps.includes(pcOf(n - spec.root)));
  })));
check('no profile but cinder spells a chord', tides.every(({ p }) => p.harmony.slots.every((s) => !s.steps)));

// ---------------------------------------------------------------------
console.log('\nWayfare');

const wayfares = [];
for (let i = 0; wayfares.length < 300 && i < 20000; i++) {
  const spec = newSpec(randomSeed());
  const lead = Object.entries(spec.mix).sort((x, y) => y[1] - x[1])[0][0];
  if (lead === 'wayfare') wayfares.push({ spec, p: render(spec) });
}
check('wayfare loops walk in 4/4, some 6/8', wayfares.length === 300 && wayfares.every(({ spec }) => (spec.stepsPerBar === 16
  || spec.stepsPerBar === 12) && spec.bpm >= 104 && spec.bpm <= 138));
const wayDrums = wayfares.filter(({ p }) => p.tracks.drums.length).length;
check('drums play in about five wayfare loops in six', wayDrums > 300 * 0.75 && wayDrums < 300 * 0.95, `${wayDrums} of 300`);
// The chug: an eighth on every eighth, on the chord's bass note, short, and
// never a gap; under brushes, a swish on every eighth as well.
const chugs = wayfares.filter(({ p }) => p.meta.bassStyle === 'chug');
check('about half of wayfare\'s loops chug', chugs.length > 300 * 0.35 && chugs.length < 300 * 0.65, `${chugs.length} of 300`);
const everyEighth = (spec, steps) => {
  const at = new Set(steps);
  for (let s = 0; s < spec.bars * spec.stepsPerBar; s += 2) if (!at.has(s)) return false;
  return steps.every((s) => s % 2 === 0);
};
check('a chug is a short bass note on every eighth, on the chord\'s bass', chugs.every(({ spec, p }) => everyEighth(spec, p.tracks.bass.map((e) => e.step))
  && p.tracks.bass.every((e) => {
    const slot = p.harmony.slots.filter((sl) => sl.startStep <= e.step).pop();
    return e.dur === 0.5 && e.chug === true && pcOf(e.midi - slot.bassMidi) === 0;
  })));
check('only a chug note is marked as one', wayfares.every(({ p }) => p.meta.bassStyle === 'chug'
  || p.tracks.bass.every((e) => e.chug === undefined)));
const brushed = chugs.filter(({ p }) => p.meta.kit === 'brush');
check('under a chug the brushes swish every eighth, none open', brushed.length > 20 && brushed.every(({ spec, p }) => {
  const hats = p.tracks.drums.filter((e) => (e.inst === 'hat' || e.inst === 'ohat') && !e.roll);
  return hats.every((e) => e.inst === 'hat') && everyEighth(spec, hats.map((e) => e.step));
}), `${brushed.length} loops`);
// Its own grooves (queue items 8 and 9): the kick anchored on the first
// and third beats (in 6/8 the first of two), with only a pickup on the
// bar's last eighth besides, never a syncopated kick; a rim, snare or tap
// on the backbeat, as a ghost a sixteenth before a beat, or in a fill on
// the last beat, never a clap; the soft kick on tape and brush, the frame
// drum by hand. And bars that differ, on several instruments, with
// dynamics: the life v53 took out.
const wayDrummed = wayfares.filter(({ p }) => p.tracks.drums.length);
const KICKS = new Set(['softkick', 'frame']);
check('wayfare\'s kick is anchored on 1 and 3, with a pickup into the bar and nothing else', wayDrummed.length > 200 && wayDrummed.every(({ spec, p }) => {
  const every = spec.stepsPerBar === 12 ? 12 : 8;
  const kicks = p.tracks.drums.filter((e) => KICKS.has(e.inst));
  const anchors = kicks.filter((e) => e.step % every === 0);
  return anchors.length === spec.bars * (spec.stepsPerBar / every)
    && kicks.every((e) => e.step % every === 0 || e.step % spec.stepsPerBar === spec.stepsPerBar - 2);
}), `${wayDrummed.length} loops`);
check('its rim, snare or tap plays the backbeat, a ghost or a fill, and never a clap', wayDrummed.every(({ spec, p }) => {
  const spb = spec.stepsPerBar;
  const beat = spb === 12 ? 6 : 4;
  return p.tracks.drums.filter((e) => ['rim', 'snare', 'tap', 'clap'].includes(e.inst)).every((e) => {
    const s = e.step % spb;
    return e.inst !== 'clap' && (s % (2 * beat) === beat || (s + 1) % beat === 0 || s > spb - beat);
  });
}));
check('the soft kick on tape and brush, the frame drum on the hand kit, and never the lo-fi kick', wayDrummed.every(({ p }) => {
  const insts = new Set(p.tracks.drums.map((e) => e.inst));
  return !insts.has('kick') && (p.meta.kit === 'hand' ? !insts.has('softkick') : !insts.has('frame'));
}));
check('the eighths stay light, and open only on the bar\'s last eighth', wayDrummed.every(({ spec, p }) => {
  const cymbal = p.tracks.drums.filter((e) => ['hat', 'ohat', 'shaker', 'jingle', 'ojingle'].includes(e.inst));
  return cymbal.every((e) => e.vel < 0.6 && (!['ohat', 'ojingle'].includes(e.inst) || e.step % spec.stepsPerBar === spec.stepsPerBar - 2));
}));
{
  const variety = wayDrummed.map(({ spec, p }) => {
    const hits = p.tracks.drums.filter((e) => e.vel > 0);
    const bars = [];
    for (let b = 0; b < spec.bars; b++) {
      bars.push(hits.filter((e) => Math.floor(e.step / spec.stepsPerBar) === b).map((e) => `${e.step % spec.stepsPerBar}:${e.inst}`).sort().join());
    }
    let pairs = 0, differ = 0;
    for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) { pairs++; if (bars[i] !== bars[j]) differ++; }
    const m = hits.reduce((a, e) => a + e.vel, 0) / hits.length;
    return {
      differ: pairs ? differ / pairs : 0,
      insts: new Set(hits.map((e) => e.inst)).size,
      sd: Math.sqrt(hits.reduce((a, e) => a + (e.vel - m) ** 2, 0) / hits.length),
    };
  });
  const avg = (k) => variety.reduce((a, v) => a + v[k], 0) / variety.length;
  check('wayfare\'s bars differ, on four or five instruments, with dynamics', avg('differ') > 0.88 && avg('insts') > 4.2 && avg('sd') > 0.165,
    `differ ${avg('differ').toFixed(2)}, instruments ${avg('insts').toFixed(1)}, sd ${avg('sd').toFixed(3)}`);
}
check('a chug leans on the beat and ghosts the eighths between', chugs.every(({ spec, p }) => {
  const beat = spec.stepsPerBar === 12 ? 6 : 4;
  return p.tracks.bass.every((e) => !e.vel || (e.step % beat === 0 ? e.vel >= 0.6 : e.vel <= 0.37));
}));
check('no loop wayfare does not lead plays its soft kick', [...tides, ...cinders].every(({ p }) => p.tracks.drums.every((e) => e.inst !== 'softkick')));
check('no loop wayfare does not lead chugs', [...tides, ...cinders].every(({ p }) => p.meta.bassStyle !== 'chug'));
// Its progressions, filtered per mode: I-bVII-IV-I and I-IV-V-IV, each
// played only where every chord of it is a plain triad.
const ways = wayfares.filter(({ spec, p }) => ['mixolydian', 'ionian', 'dorian'].includes(spec.scale) && p.harmony.slots.length >= 4);
check('wayfare plays I-bVII-IV-I and I-IV-V-IV where the mode has them', ways.length > 50 && ways.every(({ spec, p }) => {
  const roots = p.harmony.slots.slice(0, 4).map((s) => pcOf(s.rootMidi - spec.root)).join();
  return roots === '0,10,5,0' || roots === '0,5,7,5';
}) && ways.filter(({ spec }) => spec.scale === 'ionian').every(({ spec, p }) => p.harmony.slots.slice(0, 4)
  .map((s) => pcOf(s.rootMidi - spec.root)).join() === '0,5,7,5'), `${ways.length} loops`);

// ---------------------------------------------------------------------
console.log('\nChords stay in their slot, and 5/4 has its own');

// Every chord event, arpeggio notes included, ends by the end of the chord
// it starts under. Arpeggio notes used to keep the hit's whole length from
// their own later start and ran on into the next chord.
check('every chord event ends inside the chord it starts under', (() => {
  let arps = 0;
  for (let i = 0; i < 3000; i++) {
    const p = render(newSpec(i * 7919 + 13));
    const { slots } = p.harmony;
    for (const e of p.tracks.chords) {
      if (!e.vel) continue;
      let slot = slots[0];
      for (const sl of slots) if (sl.startStep <= e.step) slot = sl;
      if (e.step + e.dur > slot.startStep + slot.lengthSteps) return false;
      if (e.notes.length === 1) arps++;
    }
  }
  return arps > 0;
})());

// 5/4 used the 4/4 table cut at the bar line, so nothing ever sounded on
// its fifth beat. Now some chords reach it, and none rings past the bar.
{
  let loops = 0;
  let bars = 0;
  let fifth = 0;
  let past = 0;
  for (let s = 1; loops < 200 && s < 400000; s++) {
    const spec = newSpec(s);
    if ((spec.stepsPerBar || 16) !== 20) continue;
    loops++;
    const p = render(spec);
    const total = spec.bars * 20;
    const covered = new Set();
    for (const e of p.tracks.chords) {
      if (!e.vel) continue;
      if ((e.step % 20) + e.dur > 20) past++;
      for (let t = e.step; t < e.step + e.dur; t++) if (t % 20 >= 16) covered.add(Math.floor((t % total) / 20));
    }
    bars += spec.bars;
    fifth += covered.size;
  }
  check('5/4 loops found', loops >= 50, `(${loops})`);
  check('5/4 chords reach the fifth beat', fifth / bars > 0.3, `(${(fifth / bars).toFixed(2)} of bars)`);
  check('no 5/4 chord rings past its bar', past === 0, `(${past})`);
}

console.log('\nComposition depth');

// A share of the loops of 8 bars or more develop: a statement, a departure
// over its own progression, a return. Everything else is the loop it was.
{
  let long = 0;
  let developing = 0;
  let wrongly = 0;
  let departs = 0;
  let answers = 0;
  let checked = 0;
  for (let i = 0; i < 3000; i++) {
    const spec = newSpec(i * 104729 + 7);
    const dev = developmentOf(spec);
    if (dev && (spec.bars < 8 || spec.cycles)) wrongly++;
    if (spec.bars >= 8) long++;
    if (!dev) continue;
    developing++;
    const p = render(spec);
    if (!p.meta.depth) { wrongly++; continue; }
    const spb = p.stepsPerBar;
    let at = 0;
    for (const sec of dev.sections) { sec.at = at; at += sec.bars; }
    const a = dev.sections.find((x) => x.role === 'A');
    const b = dev.sections.find((x) => x.role === 'B');
    // B's chords are not A's.
    const chordsIn = (sec) => p.tracks.chords.filter((e) => e.vel && e.step >= sec.at * spb && e.step < (sec.at + sec.bars) * spb)
      .map((e) => `${(e.step - sec.at * spb)}:${e.notes.join('.')}`).join();
    if (chordsIn(a) !== chordsIn(b)) departs++;
    // B's tune is not A's.
    const melIn = (sec, len) => p.tracks.melody.filter((e) => e.vel && e.step >= sec.at * spb && e.step < (sec.at + len) * spb)
      .map((e) => `${(e.step - sec.at * spb)}:${e.midi}`).join();
    if (p.tracks.melody.some((e) => e.vel)) {
      checked++;
      if (melIn(a, b.bars) !== melIn(b, b.bars)) answers++;
    }
  }
  const share = developing / long;
  check('the depth knob is where it was set', DEPTH === 1);
  check('about a third of the loops of 8 bars or more develop', share > 0.25 && share < 0.42, `(${share.toFixed(3)})`);
  check('only loops of 8 bars or more without their own layer cycles develop', wrongly === 0, `(${wrongly})`);
  check('a departure moves to other chords', departs / developing > 0.9, `(${departs} of ${developing})`);
  check('a departure plays another tune', answers / checked > 0.95, `(${answers} of ${checked})`);
}

// Queue item 17. Sixteen bars develop in four-bar phrases -- A, A varied,
// the departure, A varied again -- and the departure moves register,
// rhythm and harmony together. In every developing loop B's tune is heard.
{
  const master = new Rng(17);
  let sixteen = 0;
  let cadences = 0;
  let generic = 0;
  let shaped = 0;
  let moves = 0;
  let varied = 0;
  let returns = 0;
  let tuned = 0;
  let heard = 0;
  let withTune = 0;
  const long = { 24: [0, 0], 32: [0, 0] };
  for (let i = 0; i < 12000; i++) {
    const spec = newSpec(master.seed32());
    if (long[spec.bars]) {
      long[spec.bars][0]++;
      if (developmentOf(spec)) long[spec.bars][1]++;
    }
    const dev = developmentOf(spec);
    if (!dev) continue;
    const p = render(spec);
    const spb = p.stepsPerBar;
    let at = 0;
    for (const sec of dev.sections) { sec.at = at; at += sec.bars; }
    const role = (k) => dev.sections.find((x) => x.role === k);
    const melIn = (sec) => p.tracks.melody.filter((e) => e.vel && e.step >= sec.at * spb && e.step < (sec.at + sec.bars) * spb)
      .map((e) => `${(e.step - sec.at * spb)}:${e.midi}`).join();
    const written = p.tracks.melody.some((e) => e.vel);
    if (written) {
      withTune++;
      if (melIn(role('B'))) heard++;
    }
    if (spec.bars !== 16) continue;
    sixteen++;
    const chordsIn = (sec) => p.harmony.slots.filter((sl) => sl.startStep >= sec.at * spb && sl.startStep < (sec.at + sec.bars) * spb)
      .map((sl) => sl.notes.join('.')).join();
    const [ca, cv, cr] = ['A', 'V', 'R'].map((k) => chordsIn(role(k)));
    if (!characterOf(spec).progressions) {
      generic++;
      if (cv !== ca && cr !== ca && cr !== cv) cadences++;
    }
    if (dev.sections.map((x) => `${x.role}${x.bars}`).join() === 'A4,V4,B4,R4') shaped++;
    const d = p.meta.depth;
    if (written && melIn(role('A'))) {
      tuned++;
      if ((d.answer === 'rhythm' || d.answer === 'both') && d.shift !== 0) moves++;
      if (melIn(role('V')) !== melIn(role('A'))) varied++;
      if (melIn(role('R')) !== melIn(role('A'))) returns++;
    }
  }
  check('sixteen bars develop in four four-bar phrases', sixteen > 200 && shaped === sixteen, `(${shaped} of ${sixteen})`);
  check('the departure moves rhythm and register', moves === tuned, `(${moves} of ${tuned})`);
  // A profile's own progressions are idioms and end as written.
  check('A, its variation and the return each cadence somewhere of their own', cadences / generic > 0.97, `(${cadences} of ${generic})`);
  check('the varied statement is not the statement again', varied / tuned > 0.95, `(${varied} of ${tuned})`);
  check('nor is the return', returns / tuned > 0.95, `(${returns} of ${tuned})`);
  check('the departure\'s tune is heard', heard / withTune > 0.97, `(${heard} of ${withTune})`);
  const share24 = long[24][1] / long[24][0];
  check('about two thirds of the 24-bar loops develop', share24 > 0.6 && share24 < 0.74, `(${share24.toFixed(3)})`);
  check('32-bar loops develop more than before', long[32][1] / long[32][0] > 0.14, `(${(long[32][1] / long[32][0]).toFixed(3)})`);
}

console.log('\nMoods steer the mode');
{
  // Queue item 16. The mood picks the mode a loop is made in: loops whose
  // largest share is a bright mood come out mostly in bright modes, the
  // reflective ones mostly in the middle of the axis, and the middle moods
  // as they were. Before, every mood drew bright modes 38-60% of the time.
  const master = new Rng(16);
  const tally = {};
  for (let i = 0; i < 4000; i++) {
    const spec = newSpec(master.seed32());
    const [mood] = Object.entries(spec.feelMix).sort((a, b) => b[1] - a[1])[0];
    const b = SCALE_BRIGHTNESS[spec.scale];
    const t = tally[mood] ||= { n: 0, bright: 0, darkest: 0 };
    t.n++;
    if (b >= 0.6) t.bright++;
    if (b < 0.24) t.darkest++;
  }
  const share = (moods, key) => {
    const n = moods.reduce((a, m) => a + tally[m].n, 0);
    return moods.reduce((a, m) => a + tally[m][key], 0) / n;
  };
  const glad = share(['joyful', 'happy', 'enthusiastic'], 'bright');
  const middle = share(['soothing', 'peaceful', 'comforting'], 'bright');
  const inward = share(['reflective'], 'bright');
  check('the bright moods are mostly in bright modes', glad > 0.7, `(${glad.toFixed(3)})`);
  check('the middle moods are left where they were', middle > 0.4 && middle < 0.58, `(${middle.toFixed(3)})`);
  check('reflective leans inward', inward < 0.25, `(${inward.toFixed(3)})`);
  check('reflective is rarely in the darkest modes', share(['reflective'], 'darkest') < 0.06,
    `(${share(['reflective'], 'darkest').toFixed(3)})`);

  // The vocabulary is data: every mood has its own share-code number, the
  // numbers are the ones codes have always used, and a code still reads.
  const codes = Object.values(MOODS).map((m) => m.code);
  check('every mood has its own code', new Set(codes).size === codes.length);
  const WRITTEN = ['joyful', 'happy', 'enthusiastic', 'refreshing', 'soothing', 'peaceful', 'comforting', 'reflective'];
  check('mood codes are the ones already written down', WRITTEN.every((k, i) => codeForMood(k) === i && moodForCode(i) === k));
  check('an unknown mood code reads as peaceful', moodForCode(200) === 'peaceful');
  check('every mood has a word', Object.keys(MOODS).every((k) => typeof moodWord(k) === 'string' && moodWord(k).length));
  const spec = newSpec(12345);
  check('a share code keeps its moods', JSON.stringify(decodeSong(encodeSong(spec)).feelMix) === JSON.stringify(spec.feelMix));
  const old = (lift, energy) => {
    const high = lift > 0.66;
    const mid = lift > 0.38;
    if (energy > 0.68) return high ? 'enthusiastic' : mid ? 'refreshing' : 'restless';
    if (energy > 0.36) return high ? 'happy' : mid ? 'comforting' : 'reflective';
    return high ? 'joyful' : mid ? 'peaceful' : 'reflective';
  };
  let same = true;
  for (let l = 0; l <= 1.0001; l += 0.02) for (let e = 0; e <= 1.0001; e += 0.02) if (pointWord({ lift: l, energy: e }) !== old(l, e)) same = false;
  check('an old save shows the word it always did', same);
}

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
