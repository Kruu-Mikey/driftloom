// The composer.
//
// A loop is stored as a "spec": a handful of numbers, plus one seed per
// layer. Rendering a spec always produces the same pattern. Because each
// layer holds its own seed, you can re-roll the bass without touching
// anything else — the other layers literally cannot change, because their
// random streams never moved.

import { Rng, randomSeed, seedName } from './rng.js';
import { SCALES, scalePitch, buildChord, voiceInRange, nearestChordTone, moodWeighted } from './theory.js';
import { CHARACTERS, CHARACTER_WEIGHTS, POLY_CYCLES, blendMix, resolveKey } from './characters.js';

export const LAYERS = ['drums', 'bass', 'chords', 'melody', 'texture'];
export const LAYER_LABELS = {
  drums: 'Drums',
  bass: 'Bass',
  chords: 'Keys',
  melody: 'Melody',
  texture: 'Air',
};

// Kept as the default and as the export other modules still import, but the
// real value now lives on the spec: 16 is 4/4, 12 is 6/8, 20 is 5/4.
export const STEPS_PER_BAR = 16;

// Vowels belong to the composition, not to the pitch. Deriving them from
// the note number (the first attempt) meant they changed on every note,
// which reads as texture rather than singing, and meant any two loops in a
// similar register sang the same sequence.
export const VOWEL_KEYS = ['a', 'e', 'o', 'u'];

// ---------------------------------------------------------------- spec

export function newSpec(seed = randomSeed()) {
  const r = new Rng(seed);

  // A loop's identity is a weight across profiles, not a choice between
  // them. Draw a few, give each an exponential weight and normalise: that
  // produces everything from a single pure profile through to a genuine
  // four-way blur, with the lopsided mixes commoner than the even ones,
  // which is what keeps a loop sounding like it is *about* something.
  // Decide how lively this loop wants to be BEFORE choosing profiles.
  //
  // Choosing profiles first and mood second cannot produce an adventurous
  // loop, because the profile's own feel range then clamps the mood: pick
  // three slow palettes and no amount of enthusiasm survives the clamp.
  // Drive therefore steers both, and the profile draw is what actually
  // decides whether a loop can be fast at all.
  const drive = Math.pow(r.f(), 0.82) * 1.8 - 0.5;
  const pool = CHARACTER_WEIGHTS.map(([k, wt]) => {
    const fe = CHARACTERS[k].feel.energy;
    const mid = (fe[0] + fe[1]) / 2;
    // Floored well above zero so the quiet profiles stay genuinely
    // reachable: the point is to make adventure possible, not to trade one
    // narrow band of output for another.
    return [k, wt * Math.max(0.28, 1 + drive * (mid - 0.45) * 2.5)];
  });
  const howMany = r.weighted([[1, 2.2], [2, 4], [3, 2.6], [4, 1.2]]);
  const mix = {};
  for (let i = 0; i < howMany && pool.length; i++) {
    const key = r.weighted(pool);
    const idx = pool.findIndex(([k]) => k === key);
    if (idx >= 0) pool.splice(idx, 1);
    // -log(u) is an exponential draw; normalising a set of them is a
    // Dirichlet, which spreads weight much more naturally than picking
    // fractions by hand.
    mix[key] = -Math.log(1 - r.f() * 0.999) * (i === 0 ? 1.6 : 1);
  }
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(mix)) mix[k] = q8(mix[k] / total);

  const c = blendMix(mix);

  // Feeling is three dials, not one slider. Independent axes let a loop be
  // glad and unhurried at once, or hushed and restless, instead of sliding
  // along a single line between two moods.
  // Draw a mixture of named moods, weighted toward the ones this profile
  // blend can actually reach, then take the loop's centre as their weighted
  // average. Individual layers stray back out toward their own mood later.
  const fit = (m) => {
    let d = 0;
    for (const axisName of ['lift', 'energy', 'warmth']) {
      const [lo, hi] = c.feel[axisName];
      const v = m[axisName];
      if (v < lo) d += lo - v;
      else if (v > hi) d += v - hi;
    }
    return 1 / (1 + d * 3.5);
  };
  // Some loops want to be an adventure rather than a lullaby. Without this
  // the mood pool averages to 0.475 energy every time, because that is
  // simply the mean of the eight moods -- so nearly every loop came out
  // gentle and the bright, quickened end of the axis was unreachable in
  // practice. A per-loop drive bias tilts the whole pool one way or the
  // other, skewed so that lively loops are genuinely common.
  const moodPool = Object.entries(MOODS).map(([k, m]) => [
    k, fit(m) * Math.max(0.08, 1 + drive * (m.energy - 0.47) * 2.4),
  ]);
  const moodCount = r.weighted([[1, 2], [2, 4], [3, 2.4]]);
  const feelMix = {};
  const takenMoods = moodPool.slice();
  for (let i = 0; i < moodCount && takenMoods.length; i++) {
    const key = r.weighted(takenMoods);
    const idx = takenMoods.findIndex(([k]) => k === key);
    if (idx >= 0) takenMoods.splice(idx, 1);
    feelMix[key] = -Math.log(1 - r.f() * 0.999) * (i === 0 ? 1.7 : 1);
  }
  const moodTotal = Object.values(feelMix).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(feelMix)) {
    const w = feelMix[k] / moodTotal;
    // A trace below half a percent is not a colour, it is rounding noise.
    if (w < 0.005) delete feelMix[k];
    else feelMix[k] = q8(w);
  }

  const feel = { lift: 0, energy: 0, warmth: 0 };
  for (const [k, w] of Object.entries(feelMix)) {
    for (const axisName of ['lift', 'energy', 'warmth']) feel[axisName] += MOODS[k][axisName] * w;
  }
  for (const axisName of ['lift', 'energy', 'warmth']) {
    const [lo, hi] = c.feel[axisName];
    feel[axisName] = q8(Math.max(lo, Math.min(hi, feel[axisName])));
  }
  // How closely the layers agree with the loop's centre. Low values let a
  // bright melody sit over a settled accompaniment.
  const coherence = q8(r.range(0.42, 0.82));

  const stepsPerBar = r.weighted(c.stepsPerBar);
  const bars = r.weighted(c.bars);

  const spec = {
    seed,
    name: seedName(seed),
    mix,
    feel,
    feelMix,
    coherence,
    mood: feel.lift, // kept so older code and saves still read something
    // Clamped to the range the tempo control can actually represent, so the
    // slider and the readout can never disagree.
    bpm: Math.max(32, Math.min(190, Math.round(
      r.range(c.bpm[0], c.bpm[1]) + (feel.lift - 0.5) * 5 + (feel.energy - 0.5) * 10
    ))),
    root: r.int(0, 11),
    scale: r.weighted(moodWeighted(c.scales, feel.lift)),
    bars,
    stepsPerBar,
    swing: r.range(c.swing[0], c.swing[1]),
    layerSeeds: {
      drums: r.seed32(),
      bass: r.seed32(),
      chords: r.seed32(),
      melody: r.seed32(),
      texture: r.seed32(),
    },
    mutes: { drums: false, bass: false, chords: false, melody: false, texture: false },
    // How many times round before moving on. Null means it never moves on,
    // which is the default: a loop machine should loop until you say stop.
    playFor: null,
    tone: {
      warmth: r.range(c.tone.warmth[0], c.tone.warmth[1]) * (0.6 + feel.warmth * 0.6),
      space: r.range(c.tone.space[0], c.tone.space[1]),
      wobble: r.range(c.tone.wobble[0], c.tone.wobble[1]),
    },
  };

  if (c.polymeter) {
    const cycles = r.shuffle(POLY_CYCLES);
    spec.cycles = {
      drums: null,
      bass: cycles[0] * stepsPerBar,
      chords: cycles[1] * stepsPerBar,
      melody: cycles[2] * stepsPerBar,
      texture: cycles[3] * stepsPerBar,
    };
  } else if (c.microLoop && bars >= 8) {
    // Very short fragments against a longer frame: the loop stays put while
    // its parts slide, which is how this music changes without changing.
    const short = r.pick([1, 2, 2, 4]);
    spec.cycles = {
      drums: null,
      bass: short * stepsPerBar,
      chords: r.pick([2, 4]) * stepsPerBar,
      melody: r.pick([1, 2, 3]) * stepsPerBar,
      texture: null,
    };
  }
  return spec;
}

export function characterOf(spec) {
  if (spec.mix) return blendMix(spec.mix);
  // Saves from before profiles became weights.
  const mix = {};
  mix[resolveKey(spec.character || 'dust')] = 1 - (spec.blend || 0);
  if (spec.character2 && spec.blend) mix[resolveKey(spec.character2)] = spec.blend;
  return blendMix(mix);
}

// Named regions of the feeling space, in (lift, energy, warmth).
//
// Both wings of the axis are wholesome: the bright, quickened side and the
// settled, comforted side, plus two inward ones. Nothing here is a sad end.
export const MOODS = {
  joyful: { lift: 0.92, energy: 0.72, warmth: 0.72 },
  happy: { lift: 0.82, energy: 0.52, warmth: 0.78 },
  enthusiastic: { lift: 0.88, energy: 0.9, warmth: 0.66 },
  refreshing: { lift: 0.72, energy: 0.62, warmth: 0.42 },
  soothing: { lift: 0.62, energy: 0.18, warmth: 0.82 },
  peaceful: { lift: 0.58, energy: 0.28, warmth: 0.6 },
  comforting: { lift: 0.54, energy: 0.36, warmth: 0.86 },
  reflective: { lift: 0.3, energy: 0.22, warmth: 0.46 },
};

const LAYER_SALT = {
  drums: 0x1f3b, bass: 0x2c5d, chords: 0x3a71, melody: 0x4d93, texture: 0x5e17,
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Quantise to the same 1/255 grid a share code uses.
//
// These weights feed weighted random picks, so a rounding difference of
// 0.004 is enough to select a different scale or voice. Snapping generation
// to the grid the encoding can represent makes a share code lossless by
// construction rather than lossless-if-you-are-lucky.
const q8 = (v) => Math.round(clamp01(v) * 255) / 255;

// A loop's feeling is a *mixture* of those regions, not a point among them.
//
// Averaging 60% peaceful with 30% reflective would land on one middling
// value that is neither. But a piece really can be glad and inward at the
// same time -- a bright line over a low, sparse accompaniment -- and that is
// not a midpoint, it is different layers carrying different feeling. So each
// layer draws its own mood from the mixture and is pulled part-way back
// toward the loop's centre by its coherence. The weights then mean what you
// would expect: 60% peaceful really is most of the material.
//
// Keyed off the loop seed rather than any layer seed, so re-rolling the bass
// does not reshuffle which layer is carrying which feeling.
export function feelForLayer(spec, layer) {
  const base = feelOf(spec);
  const mix = spec.feelMix;
  if (!mix || !Object.keys(mix).length) return base;
  const r = new Rng(((spec.seed ^ (LAYER_SALT[layer] || 0x77)) >>> 0) || 3);
  const key = r.weighted(Object.entries(mix));
  const m = MOODS[key];
  if (!m) return base;
  const stray = 1 - (spec.coherence ?? 0.6);
  return {
    lift: clamp01(base.lift + (m.lift - base.lift) * stray),
    energy: clamp01(base.energy + (m.energy - base.energy) * stray),
    warmth: clamp01(base.warmth + (m.warmth - base.warmth) * stray),
    mood: key,
  };
}

// ------------------------------------------------------- the choir

// Roadmap item 12. A doubling drawn on purpose, rarely.
//
// Melody and keys used to land on the same voice in 11.1% of loops, purely
// because the two pools sometimes collided, and `separateRegisters` then
// forced those loops into unison. Nothing made them sound like anything;
// they were loops where the register separation had nothing to do. One in
// nine is also far too often for something meant to feel like an event.
//
// So it is drawn, and drawn here rather than inside a layer. The salt is
// the same pattern `feelForLayer`, `genGaps` and `genForm` already use: a
// stream of its own hung off the loop seed, which means it consumes
// nothing from any layer and a re-rolled bass cannot turn the choir on or
// off. It also needs no share-format change -- `spec.seed` is already in
// the code (`writeSpec` writes it), so a code written down last month
// still says whether its loop sings.
const CHOIR_SALT = 0x7c9e6b2d;

// 3% of loops, which is the roadmap's 3 +/- 1%. Below about one in fifty a
// listener never meets one; above about one in twenty it stops being an
// event and becomes a texture the catalogue has.
const CHOIR_RATE = 0.03;

// Two of the three sung voices. The one called `choir` is left out, and
// that is a measured exclusion rather than a taste one.
//
// A `choir` note is three detuned singers sharing one tract and costs 34,
// against a vowel's 22 and a hum's 16 -- and this loop is paying for it on
// two layers at once, one of them a chord. Putting it in the pool roughly
// doubles what the voice budget refuses on a choir loop: melody notes
// refused go from 8.9% to 19.7% and keys notes from 8.1% to 19.3%, against
// an ordinary loop's 6.8% and 17.5%. Dropping one melody note in five on
// the loops that exist to show off a doubled melody is the opposite of the
// point.
//
// Worth saying that this exclusion was briefly removed on the strength of
// a probe that appeared to show the budget coping, and put back when an
// independent one showed the numbers above. The first probe was wrong. The
// pull request has both.
const CHOIR_VOICES = [['vowel', 3], ['hum', 2]];

export function choirOf(spec) {
  if (!spec || spec.seed == null) return null;
  const r = new Rng(((spec.seed ^ CHOIR_SALT) >>> 0) || 17);
  if (!r.chance(CHOIR_RATE)) return null;
  // A standing few cents between the two layers.
  //
  // The obvious justification for this is that two identical voices at one
  // pitch sum to 6dB of one voice rather than sounding like two, and it is
  // not the true one here: these voices already draw their own scoop,
  // jitter, vibrato rate and breath per note, so two of them on one pitch
  // measure +3.3dB -- the incoherent sum, near enough -- before any detune
  // is applied. The failure this is supposed to prevent does not happen.
  //
  // What it does do is make the disagreement *standing* rather than
  // momentary. The jitter and vibrato are zero-mean, so the two layers
  // keep crossing each other; a fixed lean means they never settle onto
  // one pitch at all, which is the difference between two singers drifting
  // and two singers who are simply two people. It measures as a further
  // push away from coherence, +3.3dB to +2.9dB at eight cents, and it
  // costs nothing: an offset on a parameter that was being set anyway.
  const voice = r.weighted(CHOIR_VOICES);
  const cents = 4 + r.f() * 7;
  return {
    voice,
    // Opposed, so the interval between the layers is the full spread
    // rather than each drifting the same way off a shared centre.
    keysDetune: -cents,
    melodyDetune: cents,
  };
}

export function feelOf(spec) {
  if (spec.feel) return spec.feel;
  const lift = spec.mood ?? 0.5;
  return { lift, energy: 0.5, warmth: 0.6 };
}

export function moodOf(spec) {
  return feelOf(spec).lift;
}

// Rolling a layer should always give you that layer. If a character almost
// never has drums, rolling the drum track still has to produce drums --
// otherwise the button looks broken. Silence is what Mute is for.
function forced(spec, layer) {
  return !!(spec.forceLayers && spec.forceLayers[layer]);
}

// The longest thing that has to happen before the piece could repeat.
export function patternSteps(spec) {
  const base = spec.bars * (spec.stepsPerBar || STEPS_PER_BAR);
  if (!spec.cycles) return base;
  return Math.max(base, ...Object.values(spec.cycles).filter(Boolean));
}

export function rerollLayer(spec, layer) {
  const next = cloneSpec(spec);
  next.layerSeeds[layer] = randomSeed();
  next.forceLayers = { ...(next.forceLayers || {}), [layer]: true };
  return next;
}

export function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}

// ------------------------------------------------------------ harmony

// Progression shapes written as scale degrees. Two pools: one for the
// seven-note modes, one for the pentatonics where degree numbers mean
// something different.
const SHAPES_7 = [
  [0, 5, 3, 4],
  [0, 3, 5, 4],
  [0, 4, 5, 3],
  [0, 6, 3, 4],
  [0, 2, 5, 4],
  [5, 3, 0, 4],
  [0, 0, 3, 4],
  [1, 4, 0, 0],
  [0, 5, 1, 4],
  [3, 4, 0, 5],
  [0, 1, 3, 4],
  [0, 3, 0, 4],
];
const SHAPES_PENT = [
  [0, 3, 4, 2],
  [0, 2, 4, 3],
  [0, 4, 0, 2],
  [0, 1, 3, 4],
  [0, 3, 0, 4],
  [0, 2, 3, 1],
];

// How a bar is counted. The step count alone cannot say: twelve steps are
// 6/8 today, and a waltz will want to read the same twelve as 3/4 (item
// 14c). That reading gets its own name and its own tables; it does not
// reinterpret the 6/8 ones.
function metreOf(spec) {
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  return spb === 12 ? '6/8' : spb === 20 ? '5/4' : '4/4';
}

// Each entry is a bar's worth of hits: [startStep, durationInSteps]. One
// table per metre, and a name means the same thing in every table; only the
// steps move. A metre without a table of its own borrows 4/4's, cut to fit.
const CHORD_RHYTHMS = {
  // Beats at 0, 4, 8 and 12.
  '4/4': {
    pad: [[0, 16]],
    breathe: [[0, 12]],
    twoAndFour: [[4, 3], [12, 3]],
    pushed: [[0, 6], [6, 4], [12, 3]],
    offbeat: [[2, 2], [6, 2], [10, 2], [14, 2]],
    lateBloom: [[6, 10]],
    stutter: [[0, 2], [3, 2], [8, 3]],
  },
  // Two dotted beats at 0 and 6, each three eighths: 0, 2, 4 and 6, 8, 10.
  //
  // Settled by ear, in a blind A/B against the 4/4 table cut off at step
  // 12, which is what 6/8 played before v36. Chords move on the two dotted
  // beats and hold, and figures between the beats are welcome; an entry on
  // the weak eighth tied over the second beat, or a chord cut short, is
  // not. So offbeat and stutter are 6/8's own, and the rest play what the
  // cut 4/4 table played, stopped at the bar line where it rang past it.
  '6/8': {
    // Holds the bar, and only the bar: 4/4's hold rang four steps into the
    // next one.
    pad: [[0, 12]],
    // Holds the bar as well. Letting go for the last eighth was heard as a
    // chord cut short.
    breathe: [[0, 12]],
    // One stab on the first beat's last eighth. A stab on the second beat
    // was the narrowest verdict in the A/B, and lost.
    twoAndFour: [[4, 3]],
    // Struck on both beats. Anticipating the second on the eighth before it
    // was heard as a weak-eighth entry tied over the beat.
    pushed: [[0, 6], [6, 4]],
    // The two eighths after each beat: the jig's "pah-pah" under the kick's
    // "oom".
    offbeat: [[2, 2], [4, 2], [8, 2], [10, 2]],
    // Comes in on the second beat and holds to the bar line, not past it.
    lateBloom: [[6, 6]],
    // The same catch at the top as 4/4's, a dotted eighth apart, landing on
    // the second beat.
    stutter: [[0, 2], [3, 2], [6, 3]],
  },
};

function genHarmony(spec) {
  const r = new Rng(spec.layerSeeds.chords);
  const c = characterOf(spec);
  // A choir loop relabels the voice the draw produced; it never replaces
  // the draw. Every `r.` call below still happens in the same order with
  // the same results, so a choir loop is the loop that seed always made,
  // sung. That is what keeps the A/B honest and what keeps the 97% of
  // loops that are not choirs byte-identical.
  const choir = choirOf(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const metre = metreOf(spec);
  const scale = SCALES[spec.scale].steps;
  const pentatonic = scale.length <= 5;
  const shapePool = pentatonic ? SHAPES_PENT : SHAPES_7;
  let shape = r.pick(shapePool).slice();

  // A gentle mutation so we aren't just replaying twelve fixed progressions.
  if (r.chance(0.35)) {
    const i = r.int(1, shape.length - 1);
    shape[i] = (shape[i] + r.pick([-1, 1, 2])) % scale.length;
    if (shape[i] < 0) shape[i] += scale.length;
  }

  // bVII is the Kondo move: it ends a phrase without ending it.
  if (c.flatSeven && !pentatonic && r.chance(c.flatSeven)) {
    shape[shape.length - 1] = 6;
  }

  const chordsPerBar = r.chance(0.18) && spb % 2 === 0 ? 2 : 1;
  const slotLen = Math.floor(spb / chordsPerBar);
  const slotCount = spec.bars * chordsPerBar;

  const size = r.weighted(c.chordSize);
  const voice = r.weighted(c.chordVoices);
  // Stacking fourths instead of thirds removes the major/minor question
  // altogether, which is most of why the BOTW piano sounds placeless.
  const quartal = c.quartal ? r.chance(c.quartal) : false;
  const rhythmName = r.weighted([
    ['pad', 3],
    ['breathe', 2],
    ['twoAndFour', 2.5],
    ['pushed', 2],
    ['offbeat', 1.4],
    ['lateBloom', 1.2],
    ['stutter', 0.8],
  ]);
  const arpeggiate = r.chance(0.22);
  const slashChance = { field: 0.5, airports: 0.45, postcard: 0.3, hyrule: 0.25 }[spec.character] || 0.12;

  const slots = [];
  const events = [];
  let prevVoicing = null;

  for (let s = 0; s < slotCount; s++) {
    const degree = shape[s % shape.length];
    let notes = quartal
      ? [0, 3, 6, 9].slice(0, size).map((step) => scalePitch(spec.root, scale, degree + step, 0))
      : buildChord(spec.root, scale, degree, size, 0);
    // Occasionally colour the chord with a ninth.
    const mood = feelForLayer(spec, 'chords').lift;
    if (!pentatonic && r.chance(0.18 + mood * 0.3)) {
      // The added ninth is most of what separates glad from merely pleasant.
      notes.push(scalePitch(spec.root, scale, degree + 8, 0));
    }
    notes = voiceInRange(notes, 55, 79);
    // Voice leading: nudge the whole shape toward the previous chord, but
    // never by more than an octave, and always re-clamp afterwards. Without
    // both guards the comparison feeds on its own output and the harmony
    // walks off the bottom of the keyboard within a few bars.
    if (prevVoicing) {
      const here = notes.reduce((s, n) => s + n, 0) / notes.length;
      const there = prevVoicing.reduce((s, n) => s + n, 0) / prevVoicing.length;
      const shift = Math.max(-1, Math.min(1, Math.round((there - here) / 12)));
      if (shift !== 0) notes = notes.map((n) => n + shift * 12);
    }
    notes = voiceInRange(notes, 52, 84);
    notes = Array.from(new Set(notes)).sort((a, b) => a - b);
    prevVoicing = notes;

    const startStep = s * slotLen;
    // Held across the chord and usually across several, the way a sung line
    // stays on a vowel rather than changing on every note.
    const slotVowel = VOWEL_KEYS[Math.floor(s / (1 + r.int(0, 2))) % VOWEL_KEYS.length];
    const rootMidi = scalePitch(spec.root, scale, degree, 0);
    // A bass note that disagrees with the chord is the one idea from the
    // theory sheets that transfers directly: every chord there is a slash
    // chord (Amaj13/B, Fm13/D). It is what stops harmony from settling.
    const pedalDegree = r.chance(slashChance) ? degree + r.pick([1, 2, 4, 6]) : degree;
    slots.push({
      startStep, lengthSteps: slotLen, degree, notes, rootMidi,
      bassDegree: pedalDegree,
      bassMidi: scalePitch(spec.root, scale, pedalDegree, 0),
    });

    // Hit positions are written relative to the chord's own slot, so a
    // half-bar change gets its own attack instead of borrowing the bar's.
    // The first strike rings through the second in every metre; in 6/8,
    // letting it go for the second was heard as a chord cut short.
    const hits = chordsPerBar === 2
      ? [[0, slotLen], [4, slotLen - 4]].slice(0, r.chance(0.5) ? 1 : 2)
      : (CHORD_RHYTHMS[metre] || CHORD_RHYTHMS['4/4'])[rhythmName].filter(([st]) => st < spb);

    for (const [hitStep, dur] of hits) {
      const step = startStep + hitStep;
      if (step >= spec.bars * spb) continue;
      // Sometimes leave a hole. Space is an instrument.
      if (r.chance(0.08)) continue;

      if (arpeggiate) {
        notes.forEach((n, i) => {
          events.push({
            step: (step + i * 2) % (spec.bars * spb),
            dur: Math.max(2, dur),
            notes: [n],
            vel: 0.45 + r.f() * 0.2,
            voice: choir ? choir.voice : 'keys',
            ...(choir ? { vowel: slotVowel, detune: choir.keysDetune } : {}),
          });
        });
      } else {
        // Drawn either way, so the stream does not move when the choir
        // takes the label.
        const drawn = voice === 'both' ? (r.chance(0.5) ? 'keys' : 'pad') : voice;
        events.push({
          step,
          dur,
          notes: notes.slice(),
          vel: 0.4 + r.f() * 0.25,
          voice: choir ? choir.voice : drawn,
          // One vowel for the whole chord. Singers on a chord sing the same
          // vowel; giving each note its own is not a choir, it is four
          // people disagreeing.
          vowel: slotVowel,
          ...(choir ? { detune: choir.keysDetune } : {}),
        });
      }
    }
  }

  return { slots, events, shape, cycleSteps: spec.bars * spb };
}

function slotAt(slots, step, cycleSteps) {
  // Wrap, because with polymeter a layer can run past the end of the chord
  // cycle and still needs to know what harmony it is sitting on.
  let q = cycleSteps ? ((step % cycleSteps) + cycleSteps) % cycleSteps : step;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (q >= slots[i].startStep) return slots[i];
  }
  return slots[0];
}

// With polymeter each layer is generated as though the piece were as long as
// that layer's own cycle. Everything downstream stays unchanged.
function layerSpec(spec, layer) {
  const cyc = spec.cycles && spec.cycles[layer];
  if (!cyc) return spec;
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  return { ...spec, bars: Math.max(1, Math.round(cyc / spb)) };
}

// --------------------------------------------------------------- bass

// Dub's three notes, [step, length] from the slot's start: the root, then
// room for the drop (4/4's third beat, 6/8's second), an answer just after
// it, and a pickup a third, fourth or fifth up into the next bar. 6/8 used
// 4/4's steps, which held the answer over the bar line and put the pickup
// at 14, past the end of a twelve-step bar, where it landed on the next
// bar's second eighth, under the next chord.
const DUB = {
  '4/4': [[0, 6], [10, 4], [14, 2]],
  '6/8': [[0, 4], [8, 2], [10, 2]],
};

// The walk's notes, [step, length] from the slot's start: one per beat in
// 4/4. In twelve steps it walks four dotted eighths, 2/4 against the 6/8.
// The jig's lilt, [0,4,6,10], was tried in v38 and the cross-rhythm won
// the blind A/B: only the chords want to be strictly 6/8.
const WALK = {
  '4/4': [[0, 3], [4, 3], [8, 3], [12, 3]],
  '6/8': [[0, 3], [3, 3], [6, 3], [9, 3]],
};

function genBass(spec, harmony) {
  const r = new Rng(spec.layerSeeds.bass);
  const c = characterOf(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const metre = metreOf(spec);
  const scale = SCALES[spec.scale].steps;
  const total = spec.bars * spb;
  const style = forced(spec, 'bass')
    ? r.weighted(c.bassStyles.filter(([k]) => k !== 'sparse').length
        ? c.bassStyles.filter(([k]) => k !== 'sparse') : c.bassStyles)
    : r.weighted(c.bassStyles);
  const voice = r.weighted(c.bassVoices || [['sub', 1]]);
  const glideChance = c.glide || 0;
  const octaveShift = r.chance(0.25) ? -12 : 0;
  const events = [];

  const place = (step, dur, midi, vel, glide = false) => {
    let m = midi + octaveShift;
    while (m > 52) m -= 12;
    while (m < 28) m += 12;
    events.push({ step: step % total, dur, midi: m, vel, glide, voice });
  };

  for (const slot of harmony.slots) {
    // Follow the slash note, not the chord root.
    const base = (slot.bassMidi != null ? slot.bassMidi : slot.rootMidi) - 24;
    const len = slot.lengthSteps;
    if (r.chance(0.06)) continue; // leave one slot empty now and then

    if (style === 'held') {
      place(slot.startStep, len - 1, base, 0.62 + r.f() * 0.15, r.chance(glideChance));
      if (r.chance(0.3)) place(slot.startStep + len - 2, 2, base + 7, 0.4);
    } else if (style === 'pulse') {
      const grid = spb === 12
        ? r.pick([[0, 6], [0, 3, 6, 9], [0, 4, 8], [0, 6, 9]])
        : r.pick([[0, 8], [0, 6, 10], [0, 4, 8, 12], [0, 7, 10]]);
      for (const g of grid) {
        if (g >= len) continue;
        place(slot.startStep + g, r.pick([2, 3, 4]), base, g === 0 ? 0.7 : 0.45 + r.f() * 0.2,
          g > 0 && r.chance(glideChance));
      }
    } else if (style === 'dub') {
      const [[, held], [answer, answerLen], [pickup, pickupLen]] = DUB[metre] || DUB['4/4'];
      // A half-bar slot has no room after the root for the answer or the
      // pickup. Placed anyway, they sounded under the next chord on this
      // chord's root. They are drawn all the same, so the stream does not
      // move, and simply not placed.
      const fits = (at) => at < len;
      place(slot.startStep, held, base, 0.72);
      if (r.chance(0.7)) {
        const glide = r.chance(0.4);
        if (fits(answer)) place(slot.startStep + answer, answerLen, base, 0.5, glide);
      }
      if (r.chance(0.35)) {
        const interval = r.pick([3, 5, 7]);
        if (fits(pickup)) place(slot.startStep + pickup, pickupLen, base + interval, 0.4);
      }
    } else if (style === 'walk') {
      const steps = (WALK[metre] || WALK['4/4']).filter(([s]) => s < len);
      steps.forEach(([s, dur], i) => {
        const deg = slot.degree + (i === 0 ? 0 : r.pick([0, 1, -1, 2, 4]));
        const midi = scalePitch(spec.root, scale, deg, -2);
        place(slot.startStep + s, dur, midi, i === 0 ? 0.68 : 0.42 + r.f() * 0.15);
      });
    } else {
      // sparse: one long tone, sometimes nothing at all
      if (r.chance(0.75)) place(slot.startStep, len + (r.chance(0.3) ? len : 0) - 1, base, 0.55);
    }
  }

  return { events, style, voice };
}

// ------------------------------------------------------------- melody

// A rhythmic cell is one bar of rhythm: a list of [step, length] pairs, with
// an optional third element marking an accent.
//
// The melody used to be laid on a fixed even-step grid. The loop that built
// it read `i += (driven ? 2 : 2)`, a ternary with the same value in both
// branches, so the "driven" case never existed and every melody note in the
// app's history landed on an even step. Measured across four thousand loops,
// 0.2% of notes fell off the beat, and those only because a phrase transform
// clamped an offset into an odd slot by accident. A grid is not a rhythm; it
// is the absence of one.
//
// These are ordinary figures a player would reach for. What tells them apart
// is mostly where the notes are *not*: the same five pitches read as a march,
// a gallop or a stumble depending only on the gaps between them.
//
// `e` and `l` say which end of the energy and lift axes a cell belongs to.
// They scale its weight by 2^(bias * 2 * (value - 0.5)), so a bias of 1.5
// makes a cell eight times likelier at the top of an axis than at the bottom,
// and a joyful loop really does get the bouncier figure. Nothing is forbidden
// outright -- a reflective loop can still stumble into a burst, it just
// rarely does -- which keeps the pool from emptying at the extremes and keeps
// the rare figures reachable.
const cell = (id, e, l, w, pat) => ({ id, e, l, w, pat });

// 16-step bars: 4/4 on a sixteenth grid. Beats at 0, 4, 8 and 12, eighths on
// the even steps, and everything odd is a sixteenth off the beat.
const CELLS_16 = [
  // On the beat, and the long sustains the quiet profiles live on.
  cell('quarters',    -0.8, -0.6, 2.0, [[0, 4, 1], [4, 4], [8, 4, 1], [12, 4]]),
  cell('halves',      -2.2, -0.8, 1.4, [[0, 8, 1], [8, 8]]),
  cell('whole',       -3.0, -1.4, 0.8, [[0, 16, 1]]),
  cell('openLate',    -1.8, -0.3, 1.2, [[0, 8, 1], [10, 6]]),
  // Dotted. 3+3+2 is the one everybody knows; the gallop is a dotted eighth
  // answered by a sixteenth, which is where the swagger comes from.
  cell('dotted32',     0.2,  0.3, 2.0, [[0, 6, 1], [6, 6], [12, 4]]),
  cell('dottedPair',   0.2,  0.4, 1.6, [[0, 6, 1], [6, 2], [8, 6, 1], [14, 2]]),
  cell('gallop',       1.2,  0.9, 1.9, [[0, 3, 1], [3, 1], [4, 3, 1], [7, 1], [8, 3, 1], [11, 1], [12, 4]]),
  // Syncopated: the weight lands where the beat is not.
  cell('charleston',   1.0,  1.0, 1.8, [[0, 4, 1], [6, 4], [11, 5, 1]]),
  cell('clave',        1.6,  1.1, 1.7, [[0, 3, 1], [3, 3], [6, 4], [10, 3, 1], [13, 3]]),
  cell('offEighths',   0.9,  0.7, 1.7, [[2, 2, 1], [6, 2], [10, 2], [13, 1], [14, 2, 1]]),
  // Anticipated: the note arrives a sixteenth early and holds through the
  // beat it was meant to land on.
  cell('anticipate',   1.1,  1.0, 1.9, [[0, 4, 1], [7, 1], [8, 4, 1], [15, 1]]),
  cell('pushIn',       1.1,  0.9, 1.4, [[3, 5, 1], [8, 4], [15, 1]]),
  // Short-short-long, and its mirror.
  cell('shortLong',    1.3,  1.2, 1.8, [[0, 1], [1, 1], [2, 6, 1], [8, 1], [9, 1], [10, 6, 1]]),
  cell('longShort',    0.3,  0.3, 1.5, [[0, 6, 1], [6, 1], [7, 1], [8, 8, 1]]),
  // Three against four: a three-step cycle over a four-step beat, which is as
  // close to a triplet as a sixteenth grid can get.
  cell('threeFour',    1.0,  0.7, 1.8, [[0, 3, 1], [3, 3], [6, 3], [9, 3], [12, 3, 1]]),
  // Staccato bursts. Dense and short, so they only make sense once the loop
  // is already moving.
  cell('burst',        2.8,  1.8, 1.4, [[0, 1], [1, 1], [2, 1], [4, 2, 1], [8, 1], [9, 1], [10, 1], [12, 2, 1]]),
  cell('chatter',      3.0,  1.7, 1.2, [[0, 1], [2, 1], [3, 1], [6, 1], [8, 1], [10, 1], [11, 1], [14, 2, 1]]),
  cell('skipStep',     2.2,  1.6, 1.5, [[0, 2, 1], [2, 2], [5, 1], [6, 2], [9, 1], [10, 2, 1], [13, 3]]),
];

// 12-step bars: 6/8, two dotted beats at 0 and 6, eighths on the even steps.
// The figures that carry this metre are the cross-rhythms -- three or four
// evenly spaced notes laid over two dotted beats -- rather than the backbeat
// displacements that carry 4/4.
const CELLS_12 = [
  cell('six8',        -0.2,  0.2, 2.1, [[0, 2, 1], [2, 2], [4, 2], [6, 2, 1], [8, 2], [10, 2]]),
  cell('dotted12',    -2.2, -0.8, 1.4, [[0, 6, 1], [6, 6]]),
  cell('whole12',     -3.0, -1.4, 0.8, [[0, 12, 1]]),
  cell('airy12',      -1.6, -0.3, 1.1, [[0, 6, 1], [8, 4]]),
  cell('lilt12',      -0.2,  0.2, 2.0, [[0, 4, 1], [4, 2], [6, 3, 1], [9, 1], [10, 2]]),
  cell('hemiola12',    1.0,  0.9, 2.0, [[0, 3, 1], [3, 3], [6, 3, 1], [9, 3]]),
  cell('cross12',      0.3,  0.5, 1.5, [[0, 4, 1], [4, 4], [8, 4]]),
  cell('sync12',       1.3,  1.1, 1.6, [[0, 2, 1], [3, 3], [6, 2, 1], [9, 3]]),
  cell('antic12',      1.2,  1.0, 1.6, [[0, 4, 1], [5, 1], [6, 4, 1], [11, 1]]),
  cell('shortLong12',  1.3,  1.2, 1.8, [[0, 1], [1, 1], [2, 4, 1], [6, 1], [7, 1], [8, 4, 1]]),
  cell('burst12',      2.6,  1.6, 1.3, [[0, 1], [1, 1], [2, 1], [3, 1], [6, 2, 1], [9, 3]]),
  cell('skip12',       2.1,  1.5, 1.4, [[0, 2, 1], [3, 1], [4, 2], [6, 2, 1], [9, 1], [10, 2]]),
];

// Any other metre -- 5/4 exists in the thaw profile, and nothing stops a
// later one being added -- gets the same families built to fit, rather than a
// 16-step cell with its tail lopped off. Fewer figures, because a rare metre
// does not earn a hand-written library, but the same vocabulary.
function genericCells(spb) {
  const beat = spb % 4 === 0 ? 4 : 3;
  const beats = [];
  for (let i = 0; i + beat <= spb; i += beat) beats.push(i);
  const half = Math.max(2, Math.round(spb / 2));
  const dotted = [];
  for (let i = 0; i + 3 <= spb; i += 3) dotted.push([i, 3, i % beat === 0 ? 1 : 0]);
  // Every other beat, each with a sixteenth leaning into it.
  const anticipated = [];
  beats.forEach((b, i) => {
    if (i % 2) return;
    if (b > 0) anticipated.push([b - 1, 1]);
    anticipated.push([b, beat, 1]);
  });
  return [
    cell('pulse',      -0.8, -0.6, 2.2, beats.map((b, i) => [b, beat, i % 2 === 0 ? 1 : 0])),
    cell('halves',     -2.2, -0.8, 1.4, [[0, half, 1], [half, spb - half]]),
    cell('whole',      -3.0, -1.4, 0.8, [[0, spb, 1]]),
    cell('openLate',   -1.8, -0.3, 1.2, [[0, half, 1], [half + 2, spb - half - 2]]),
    cell('dotted',      0.6,  0.6, 1.8, dotted),
    cell('anticipate',  1.1,  1.0, 1.8, anticipated),
    cell('shortLong',   1.3,  1.2, 1.8, [
      [0, 1], [1, 1], [2, half - 2, 1],
      [half, 1], [half + 1, 1], [half + 2, spb - half - 2, 1],
    ]),
    cell('burst',       2.6,  1.7, 1.4, [[0, 1], [1, 1], [2, 1], [3, 1], [half, 2, 1], [half + 3, 3]]),
  ];
}

// A note outside the bar, or one with no length, is a typo rather than a
// rhythm. Dropping them here means the tables above can be edited without the
// risk of a silently malformed bar reaching the synth, and it is what lets
// genericCells() write expressions rather than check its own arithmetic.
function usable(list, spb) {
  return list
    .map((c) => ({ ...c, pat: c.pat.filter(([at, dur]) => at >= 0 && at < spb && dur >= 1) }))
    .filter((c) => c.pat.length);
}

const CELL_POOLS = new Map();

function cellsFor(spb) {
  if (!CELL_POOLS.has(spb)) {
    const table = spb === 16 ? CELLS_16 : spb === 12 ? CELLS_12 : genericCells(spb);
    CELL_POOLS.set(spb, usable(table, spb));
  }
  return CELL_POOLS.get(spb);
}

function drawCell(r, spb, energy, lift) {
  return r.weighted(cellsFor(spb).map((c) => [
    c,
    c.w * Math.pow(2, c.e * (energy - 0.5) * 2) * Math.pow(2, c.l * (lift - 0.5) * 2),
  ]));
}

function genMelody(spec, harmony) {
  const r = new Rng(spec.layerSeeds.melody);
  const c = characterOf(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const scale = SCALES[spec.scale].steps;
  const total = spec.bars * spb;
  const drawnVoice = r.weighted(c.melodyVoices);
  const choir = choirOf(spec);
  const voice = choir ? choir.voice : drawnVoice;
  const lf = feelForLayer(spec, 'melody');
  const mood = lf.lift;
  // Drawn either way, so the stream does not move; a choir loop simply
  // never takes the rest. A doubling with nothing to double is not one.
  const silent = r.chance(0.08);
  if (!forced(spec, 'melody') && !choir && silent) return { events: [], voice, motif: [], cell: null };

  // --- the motif ------------------------------------------------------
  //
  // One rhythmic cell per motif. The cell fixes where the notes fall and
  // how long they last; the walk below decides what pitch each one is. Two
  // loops drawing the same cell are still two different tunes, and the same
  // tune under two cells is two different pieces of music, which is the
  // whole reason rhythm is drawn separately from pitch.
  const driven = lf.energy > 0.6;
  const pointillist = c.pointillist || 0;
  const rhythm = drawCell(r, spb, lf.energy, mood);

  const motif = [];
  let deg = 0;
  // The size of the last move, so a leap can be answered. Kept as the move
  // that actually happened rather than the one drawn, because the clamp
  // below can turn a drawn leap into a step at the edge of the range.
  let lastMove = 0;
  const up = 1 + mood * 2.2;
  const down = 1 + (1 - mood) * 2.2;
  // A degree is not a fixed distance. Two degrees of a seven-note mode is
  // a third; two degrees of a pentatonic is a fourth or a fifth, which is
  // why the pentatonic scales measured worst for leaps by a clear margin.
  // Same walk, narrower allowance, so the figure comes out the same shape
  // whatever it is spelled in.
  const wide = scale.length <= 5 ? 0.4 : 1;
  for (const [at, dur, accent] of rhythm.pat) {
    motif.push({
      offset: at,
      degree: deg,
      dur,
      // The accent belongs to the figure, not to the phrase: a syncopation
      // nobody leans on does not read as a syncopation. Velocity by
      // position within a phrase is roadmap item 2 and is still absent.
      vel: 0.36 + r.f() * 0.26 + (accent ? 0.16 : 0),
    });
    // A tune moves mostly by step.
    //
    // The old weights made a degree move of two or more about as likely as
    // one, which across the corpus put 41% of consecutive intervals at a
    // fifth or wider and only 28% at a tone or less. That is not a melody
    // wandering, it is a melody being drawn from a hat: a line that leaps
    // as often as it steps has no shape to remember.
    //
    // Two changes, because the first alone was not enough. Weighting
    // toward 0 and +/-1 got leaps to about 34%, still miles off anything
    // singable. The rest comes from answering a leap: a leap followed by a
    // step back into the gap it opened is the oldest rule in counterpoint
    // and the thing that makes a leap sound intended rather than random,
    // and it removes the case the weights could not -- two leaps in a row
    // compounding into an interval nobody chose.
    let move;
    if (Math.abs(lastMove) >= 2) {
      const back = lastMove > 0 ? -1 : 1;
      move = r.weighted([[back, 9], [back * 2, 0.8], [0, 1.4]]);
    } else {
      move = r.weighted([
        [0, 4], [1, 9 * up], [-1, 9 * down],
        [2, 0.4 * up * wide], [-2, 0.32 * down * wide],
        [3, 0.06 * up * wide], [-3, 0.05 * down * wide], [4, 0.02 * up * wide],
      ]);
    }
    const before = deg;
    deg = Math.max(-5, Math.min(10, deg + move));
    lastMove = deg - before;
  }

  // Which notes the figure leaves out, decided once.
  //
  // The omission used to be rolled per restatement, which quietly undid the
  // motif: measured across the corpus, bars sharing the commonest rhythm
  // ran at 0.55 and bars sharing the commonest pitch contour at only 0.32.
  // The contour came apart faster than the rhythm because dropping a note
  // does not merely remove it -- it fuses the two intervals either side
  // into a third interval that was never in the motif, so every bar quoted
  // a slightly different tune. Deciding here means the gaps belong to the
  // figure, and the figure is the same figure every time it is played.
  const omit = Math.max(0, 0.2 - lf.energy * 0.15);
  const kept = motif.filter(() => !r.chance(omit));
  const figure = kept.length >= Math.min(2, motif.length) ? kept : motif;

  // --- how the motif is developed --------------------------------------
  //
  // A melody that restates the same figure every bar is not a melody, it is
  // a stamp. These are the standard ways a phrase is actually varied: move
  // it to a new degree, turn it upside down, run it backwards, break off a
  // piece, or stretch it out.
  const transform = (m, kind, amount) => {
    const base = m[0].degree;
    switch (kind) {
      case 'sequence':
        return m.map((x) => ({ ...x, degree: x.degree + amount }));
      case 'invert':
        return m.map((x) => ({ ...x, degree: base - (x.degree - base) }));
      case 'retro':
        return m.map((x, i) => ({ ...x, degree: m[m.length - 1 - i].degree }));
      case 'fragment': {
        const head = m.slice(0, Math.max(2, Math.ceil(m.length / 2)));
        return head.concat(head.map((x) => ({
          ...x,
          offset: Math.min(spb - 1, x.offset + Math.floor(spb / 2)),
          degree: x.degree + amount,
        })));
      }
      case 'augment':
        // Half as many notes, twice as long: the phrase in slow motion.
        return m.filter((_, i) => i % 2 === 0).map((x) => ({ ...x, dur: x.dur * 2 }));
      default:
        return m.map((x) => ({ ...x }));
    }
  };

  // Phrase plan. Forms are the ordinary shapes of a tune: a statement, an
  // answer, a departure, a return.
  const barsPerPhrase = spec.bars >= 8 ? (r.chance(0.45) ? 4 : 2) : Math.max(1, Math.min(2, spec.bars));
  const phraseCount = Math.max(1, Math.round(spec.bars / barsPerPhrase));
  const FORMS = [
    ['A', 'A2', 'B', 'A3'],
    ['A', 'B', 'A2', 'C'],
    ['A', 'A2', 'A3', 'B'],
    ['A', 'B', 'B2', 'A2'],
  ];
  const form = r.pick(FORMS);
  const KINDS = {
    A: ['exact', 0], A2: ['sequence', 0], A3: ['sequence', 0],
    B: ['invert', 0], C: ['retro', 0], B2: ['fragment', 0],
  };

  const events = [];
  const barOf = [];
  // Mean pitch of everything placed so far, so each bar can enter near
  // where the line already is rather than wherever the chord puts it.
  let centreSoFar = null;
  let centreCount = 0;
  let centreSum = 0;

  // On a choir loop the two layers are meant to be in unison, so the
  // register to aim at from the first bar is the one the keys are in. Item
  // 4 corrects afterwards but only in whole octaves, and a melody sitting
  // five semitones off can never be met by an octave; the anchor can meet
  // it, because a chord has several tones to land on and they are only a
  // few semitones apart.
  //
  // This used to read "when the keys drew the voice the melody drew",
  // which fired on the 11.1% of loops where the two pools happened to
  // collide. Those loops were not doublings, they were coincidences, and
  // unison was being forced on them for no reason anybody chose. They now
  // take the ordinary separated path; only a drawn choir asks for unison.
  const chordPitches = [];
  for (const e of harmony.events) {
    if (!e.notes || !e.notes.length) continue;
    for (const n of e.notes) chordPitches.push(n);
  }
  const unison = chordPitches.length > 0 && !!choir;
  // Singers on a chord share a vowel; a line over that chord does not sing
  // the same one, or the doubling is one wider voice instead of two. Two
  // rungs along VOWEL_KEYS from whatever the keys opened on, which cannot
  // land back on it.
  const keysVowel = choir && harmony.events.find((e) => e.vowel);
  const vowelBase = keysVowel
    ? (VOWEL_KEYS.indexOf(keysVowel.vowel) + 2) % VOWEL_KEYS.length
    : 0;
  if (unison) {
    centreSoFar = chordPitches.reduce((a, b) => a + b, 0) / chordPitches.length;
    while (centreSoFar < 55) centreSoFar += 12;
    while (centreSoFar > 95) centreSoFar -= 12;
  }
  const restPhrase = Math.max(0.02, Math.min(0.5, c.restBar * (1.5 - lf.energy * 1.2)));

  for (let ph = 0; ph < phraseCount; ph++) {
    const role = form[ph % form.length];
    let [kind] = KINDS[role] || ['exact'];
    // Sequences step somewhere rather than wandering: that directed motion
    // is what makes a phrase feel like it is going anywhere.
    const step = r.pick([1, 2, -1, 3, -2]);
    if (kind === 'sequence' && r.chance(0.25)) kind = 'augment';
    const shaped = transform(figure, kind, step);

    // Velocity across the phrase.
    //
    // A player leans on the note a phrase enters on and the note it lands
    // on, and eases through the middle. Nothing here did that: the only
    // shaping was a 5% lift on the closing note and a flat 6% drop for
    // every phrase after the first, so a phrase arrived at one level and
    // left at the same one.
    //
    // Measured, the edges already sat 0.044 above the middle, but that was
    // an accident of the rhythmic cells -- most of them accent their first
    // note, and a phrase begins on one. Against a within-phrase spread of
    // 0.223 that shape was buried five to one under note-to-note jitter,
    // which is why the phrase did not read as a phrase.
    //
    // A full cosine over the phrase is +1 at both ends and -1 in the
    // middle, and averages to zero across it, so the shaping bends the
    // line without making the melody louder or quieter overall.
    //
    // Depth follows energy. A hushed loop should arrive even -- evenness is
    // what hushed sounds like -- and a quickened one should breathe.
    const phraseNotes = Math.max(1, barsPerPhrase * shaped.length);
    const breath = 0.02 + lf.energy * 0.33;

    // Contour arc across the whole loop: rise toward a high point about two
    // thirds through, then come back down. Without this a long loop has no
    // shape at all, which is what makes twenty-four bars feel like one bar
    // played twenty-four times.
    const pos = phraseCount > 1 ? ph / (phraseCount - 1) : 0;
    // Peaks about two thirds through and stays lifted at the edges. A plain
    // sine returns to zero at both ends, so a two-phrase loop got an arc of
    // zero at each end -- no arc at all, which is why widening it changed
    // nothing the first time it was tried.
    const arc = Math.sin(Math.PI * Math.min(0.97, pos * 0.72 + 0.14)) * (driven ? 4.5 : 3.2);
    const lift = Math.round(arc) + (kind === 'sequence' ? step : 0);

    for (let bar = 0; bar < barsPerPhrase; bar++) {
      const absBar = ph * barsPerPhrase + bar;
      if (absBar >= spec.bars) break;
      // Rest at the end of a phrase rather than at random: a breath belongs
      // between sentences.
      if (bar === barsPerPhrase - 1 && r.chance(restPhrase)) continue;
      const barStart = absBar * spb;
      const slot = slotAt(harmony.slots, barStart, harmony.cycleSteps);
      const lastBarOfPhrase = bar === barsPerPhrase - 1;

      // Anchor the bar by moving all of it.
      //
      // Snapping one note onto a chord tone and leaving its neighbours
      // where the figure put them is the single largest thing standing
      // between the motif and what you hear: measured against the emitted
      // pitch it costs 0.12 of the contour on its own, and it manufactures
      // a leap the walk never had a chance to answer. Shifting the whole
      // bar by what the anchor note needed lands the anchor exactly where
      // the harmony wants it and keeps every interval of the figure.
      //
      // The shift is counted in scale degrees rather than semitones, so
      // the bar arrives transposed inside the mode rather than chromatically
      // beside it. That is the same reason neighbourInScale exists.
      const degreeOf = (m) => m.degree + lift + slot.degree;
      const pitchOf = (d) => scalePitch(spec.root, scale, d, 0) + 12;

      // One anchor per bar, because a bar can only be transposed once. A
      // phrase enters on a chord tone, a phrase ends on one, and the loop
      // closes on the tonic; where a one-bar phrase wants two of those,
      // the closing one wins.
      const closing = lastBarOfPhrase && ph === phraseCount - 1;
      let anchorAt = null;
      let landOn = null;
      if (closing) {
        anchorAt = shaped.length - 1;
        landOn = new Set([((spec.root % 12) + 12) % 12]);
      } else if (bar === 0 || lastBarOfPhrase) {
        anchorAt = bar === 0 ? 0 : shaped.length - 1;
        landOn = new Set(slot.notes.map((n) => ((n % 12) + 12) % 12));
      }

      // Which chord tone, not just the nearest one.
      //
      // Any note of the chord satisfies the anchor, and they are spread
      // across several semitones, so the choice is free to be spent on
      // something else: keeping the bar in the register the line is
      // already in. Spending it on "nearest" instead lets the progression
      // walk the bars apart -- measured, bar centres spread 7.7 semitones
      // and the loop span went to 12.0, outside the band a melody should
      // sit in. Choosing the chord tone that keeps the bar near the
      // running centre costs nothing musically and is what holds it.
      let anchorShift = 0;
      if (anchorAt != null) {
        const rawCentre = shaped.reduce((a, m) => a + pitchOf(degreeOf(m)), 0) / shaped.length;
        const aim = centreSoFar == null ? rawCentre : centreSoFar;
        const from = degreeOf(shaped[anchorAt]);
        const at = pitchOf(from);
        let bestScore = Infinity;
        for (let d = -scale.length * 2; d <= scale.length * 2; d++) {
          const p = pitchOf(from + d);
          if (!landOn.has(((p % 12) + 12) % 12)) continue;
          const score = Math.abs(rawCentre + (p - at) - aim);
          if (score < bestScore) { bestScore = score; anchorShift = d; }
        }
      }

      shaped.forEach((m, i) => {
        let midi = pitchOf(degreeOf(m) + anchorShift);
        const isLast = lastBarOfPhrase && i === shaped.length - 1;
        const pos = phraseNotes > 1 ? (bar * shaped.length + i) / (phraseNotes - 1) : 0;
        const arc = Math.cos(pos * Math.PI * 2);
        if (pointillist && r.chance(pointillist)) midi += r.pick([-12, 12, 12]);
        barOf.push(absBar);
        centreSum += midi;
        centreCount += 1;
        centreSoFar = centreSum / centreCount;
        events.push({
          step: ((barStart + m.offset) % total + total) % total,
          dur: m.dur,
          midi,
          // The cell's own accent stays underneath this: the accent says
          // which note of the figure is leaned on, the arc says where in
          // the phrase the leaning happens. Two layers of one thing.
          vel: Math.min(1, m.vel * (1 + arc * breath) * (ph === 0 ? 1 : 0.94)),
          voice,
          // The figure's own scale degree, carried through for measurement.
          // Semitone intervals cannot tell whether a motif is being quoted,
          // because transposing it diatonically through a progression
          // changes them by design; the degree can.
          degree: m.degree,
          // Which phrase this note belongs to, carried through so the
          // shaping across a phrase can be measured rather than asserted.
          phrase: ph,
          vowel: VOWEL_KEYS[(ph + (kind === 'invert' ? 1 : 0) + vowelBase) % VOWEL_KEYS.length],
          ...(choir ? { detune: choir.melodyDetune } : {}),
        });
      });
    }
  }
  // One octave per bar, chosen toward the line's own register centre.
  //
  // Folding each note into 55..95 on its own is what put octave-sized
  // jumps inside figures. Deleting the fold is not the answer either: the
  // raw line is far wider than the window, and without it the span goes to
  // 17.8. So the bar moves as a unit, and the octave it moves to is the
  // one nearest the centre of this line -- the same centroid item 4 reads
  // to keep the keys out of the melody's way, rather than a second idea of
  // register invented here. Choosing per bar without that target scatters
  // the bars and the span goes further still.
  if (events.length) {
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

    // Where the line wants to sit. Its own centre, unless the keys drew
    // the same voice the melody did -- then the two are meant to be in
    // unison, and the register to aim at is the one the keys are already
    // in. Item 4 moves the keys to hold that separation afterwards, but it
    // can only move them by whole octaves, so a melody that lands five
    // semitones off can never be met; aiming here instead is what makes
    // the unison a unison rather than an approximate one.
    let centre = unison
      ? chordPitches.reduce((a, b) => a + b, 0) / chordPitches.length
      : mean(events.map((e) => e.midi));
    while (centre < 55) centre += 12;
    while (centre > 95) centre -= 12;

    const bars = new Map();
    events.forEach((e, i) => {
      const b = barOf[i];
      if (!bars.has(b)) bars.set(b, []);
      bars.get(b).push(e);
    });

    for (const [, list] of bars) {
      let shift = Math.round((centre - mean(list.map((e) => e.midi))) / 12) * 12;
      const lo = Math.min(...list.map((e) => e.midi));
      const hi = Math.max(...list.map((e) => e.midi));
      // Never chase the centre out of the window.
      while (lo + shift < 55 && hi + shift + 12 <= 95) shift += 12;
      while (hi + shift > 95 && lo + shift - 12 >= 55) shift -= 12;
      for (const e of list) {
        let n = e.midi + shift;
        // A figure wider than the window itself still has to fit.
        while (n < 55) n += 12;
        while (n > 95) n -= 12;
        e.midi = n;
      }
    }
  }

  return { events, voice, motif: figure, cell: rhythm.id };
}

// -------------------------------------------------------------- drums

const KICK_PATTERNS = [
  [0, 10],
  [0, 6, 10],
  [0, 7, 10],
  [0, 10, 11],
  [0],
  [0, 3, 10],
  [0, 8],
  [0, 6, 11],
];
const SNARE_PATTERNS = [[4, 12], [12], [4, 12], [4, 12, 14], [8]];
// 6/8: two dotted-crotchet beats, so the accents fall on 0 and 6.
const KICK_12 = [[0, 6], [0], [0, 7], [0, 6, 9], [0, 4]];
const SNARE_12 = [[6], [3, 9], [6], [6, 10]];
// 5/4: group as 3+2 rather than 2+3, which is the friendlier of the two.
const KICK_20 = [[0, 12], [0], [0, 8, 12], [0, 12, 16]];
const SNARE_20 = [[8], [8, 16], [12]];

function genDrums(spec) {
  const r = new Rng(spec.layerSeeds.drums);
  const c = characterOf(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const metre = metreOf(spec);
  // Steps to a beat: a crotchet in 4/4 and 5/4, a dotted crotchet in 6/8.
  const beat = metre === '6/8' ? 6 : 4;
  const total = spec.bars * spb;
  const events = [];
  if (!forced(spec, 'drums') && !r.chance(c.drums)) return { events, kit: 'none', hatDensity: 0 };
  const kit = r.weighted([['tape', 4], ['brush', 2], ['machine', 3]]);

  // A bar of 6/8 is not a bar of 4/4 with four steps missing; it needs its
  // own patterns or the backbeat lands in the wrong place.
  // A steady four is not one of the boom-bap patterns with extra kicks; it
  // is a different idea, and the hats move to the offbeats to match.
  const fourFloor = c.fourFloor && spb === 16 && r.chance(c.fourFloor);
  const kick = fourFloor
    ? [0, 4, 8, 12]
    : spb === 12 ? r.pick(KICK_12) : spb === 20 ? r.pick(KICK_20) : r.pick(KICK_PATTERNS);
  const snare = spb === 12 ? r.pick(SNARE_12) : spb === 20 ? r.pick(SNARE_20) : r.pick(SNARE_PATTERNS);
  const snareVoice = r.weighted([['snare', 3], ['rim', 2], ['clap', 1.5]]);
  const feel = feelForLayer(spec, 'drums');
  const hatDensity = Math.min(1,
    r.range(c.hatDensity[0], c.hatDensity[1]) * (0.55 + feel.energy * 0.9));
  const hatGrid = r.chance(0.55) ? 2 : 1; // eighths or sixteenths
  const useShaker = r.chance(0.4);

  for (let bar = 0; bar < spec.bars; bar++) {
    const b = bar * spb;
    const lastBar = bar === spec.bars - 1;

    for (const s of kick) {
      if (bar > 0 && r.chance(0.1)) continue;
      events.push({ step: b + s, inst: 'kick', vel: s === 0 ? 0.84 : 0.62 + r.f() * 0.18 });
    }
    for (const s of snare) {
      events.push({ step: b + s, inst: snareVoice, vel: 0.58 + r.f() * 0.18 });
    }
    // Ghost notes give the groove its lean.
    if (r.chance(0.4)) events.push({ step: b + r.int(1, spb - 1), inst: 'rim', vel: 0.22 });

    for (let s = 0; s < spb; s += hatGrid) {
      // Offbeat hats against a steady kick, which is where the lift comes
      // from in this music.
      if (fourFloor && s % 4 !== 2) { if (!r.chance(hatDensity * 0.25)) continue; }
      else if (!r.chance(hatDensity)) continue;
      const open = r.chance(0.08);
      events.push({
        step: b + s,
        inst: open ? 'ohat' : 'hat',
        vel: (s % beat === 0 ? 0.5 : 0.3) + r.f() * 0.2,
      });
    }
    // The shaker takes the offbeat: the "and" of each beat in 4/4. In 6/8
    // the offbeat is the two eighths after each dotted beat, the jig's
    // "pah-pah", so it shakes them in pairs, a beat at a time. It shook
    // 2, 6 and 10 before, and 6 is the second beat. The loop still makes
    // those three draws a bar; in 6/8 the third decides nothing.
    if (useShaker) {
      const pairs = metre === '6/8' ? [[2, 4], [8, 10], []] : null;
      for (let s = 2, i = 0; s < spb; s += 4, i++) {
        if (!r.chance(0.6)) continue;
        const vel = 0.18 + r.f() * 0.15;
        for (const at of pairs ? pairs[i] : [s]) events.push({ step: b + at, inst: 'shaker', vel });
      }
    }
    // Stutter rolls: a hit subdivided into a burst of rapidly quietening
    // repeats. This is the gesture that makes chopped breaks read as
    // chopped rather than merely fast.
    //
    // A roll spans four steps and starts anywhere, in every metre. Filling
    // a dotted beat in 6/8 was tried in v38 and lost the blind A/B to this.
    if (c.rolls && r.chance(c.rolls)) {
      const from = r.int(0, spb - 4);
      const count = r.pick([3, 4, 6, 8]);
      const inst = r.pick(['snare', 'rim', 'hat', 'kick']);
      for (let k = 0; k < count; k++) {
        const step = b + from + Math.floor((k * 4) / count);
        if (step >= b + spb) break;
        events.push({
          step,
          inst,
          vel: (0.55 - k * 0.045) * (0.8 + r.f() * 0.4),
          roll: true,
          micro: k / count, // fractional offset inside the step
        });
      }
    }

    // A small fill to mark the turnaround.
    if (lastBar && r.chance(0.35)) {
      const from = spb - r.int(2, 4);
      for (let s = from; s < spb; s++) {
        events.push({ step: b + s, inst: r.pick(['rim', 'snare', 'shaker']), vel: 0.3 + r.f() * 0.3 });
      }
    }
  }
  return { events: events.filter((e) => e.step < total), kit, hatDensity };
}

// ------------------------------------------------------------- texture

function genTexture(spec, harmony) {
  const r = new Rng(spec.layerSeeds.texture);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const total = spec.bars * spb;
  const mood = feelForLayer(spec, 'texture').lift;
  // No birdsong. Wherever this gets played there are already real birds, and
  // the job is to complement what is outside rather than imitate it.
  const c = characterOf(spec);
  const pool = (c.textures || [['bells', 3], ['swell', 3], ['chime', 2], ['drops', 2], ['wind', 1], ['none', 1.5]])
    .filter(([k]) => !(forced(spec, 'texture') && k === 'none'));
  const kind = r.weighted(pool);
  const events = [];
  if (kind === 'none') return { events, kind };

  if (kind === 'swell') {
    for (let bar = 0; bar < spec.bars; bar += 2) {
      const slot = slotAt(harmony.slots, bar * spb, harmony.cycleSteps);
      events.push({
        step: bar * spb,
        dur: 32,
        notes: slot.notes.slice(0, 2).map((n) => n + 12),
        vel: 0.16 + r.f() * 0.1,
        kind: 'swell',
      });
    }
  } else if (kind === 'bells') {
    const count = r.int(2, 5);
    for (let i = 0; i < count; i++) {
      const step = r.int(0, total - 1);
      const slot = slotAt(harmony.slots, step, harmony.cycleSteps);
      events.push({
        step,
        dur: 8,
        notes: [slot.notes[r.int(0, slot.notes.length - 1)] + 24],
        vel: 0.12 + r.f() * 0.12,
        kind: 'bell',
      });
    }
  } else if (kind === 'drops') {
    for (let i = 0; i < r.int(3, 7); i++) {
      events.push({ step: r.int(0, total - 1), dur: 2, notes: [], vel: 0.2 + r.f() * 0.2, kind: 'drop' });
    }
  } else if (kind === 'chime') {
    // Struck metal with a long decay and an inharmonic partial, so it reads
    // as a different object from the bells rather than the same one slower.
    const count = r.int(2, 4);
    for (let i = 0; i < count; i++) {
      const step = r.int(0, total - 1);
      const slot = slotAt(harmony.slots, step, harmony.cycleSteps);
      events.push({
        step,
        dur: 16,
        notes: [slot.notes[r.int(0, slot.notes.length - 1)] + 12],
        vel: 0.1 + r.f() * 0.1,
        kind: 'chime',
      });
    }
  } else {
    // Wind used to be one source running the whole loop, which is why it
    // dominated far beyond how often it was picked: every other texture is
    // a handful of events, this one never stopped. Cut into segments with
    // gaps, so it comes and goes and the entry schedule can act on it.
    const seg = spb * 2;
    for (let st = 0; st < total; st += seg) {
      if (st > 0 && r.chance(0.35)) continue;
      events.push({
        step: st,
        dur: seg,
        notes: [],
        vel: 0.07 + r.f() * 0.08,
        kind: 'wind',
        band: 420 + r.f() * 520,
      });
    }
  }
  return { events, kind };
}

// --------------------------------------------------- register

// Keys and melody in different rooms -- or deliberately in the same one.
//
// Roadmap item 4. Measured across the corpus, the two layers' centroids sat
// 1.4 semitones apart, and 99% of loops whose keys and melody drew
// *different* voices had them inside five semitones of each other. That is
// not two parts, it is one thicker part: a piano chord and a piano melody
// in the same octave blur together, and the tune stops being a tune.
//
// The decision, rather than a coin flip:
//
//   a drawn choir     -> put them in unison, which is the whole point of
//                        having drawn one
//   anything else     -> at least five semitones apart
//
// The first line used to read "same drawn voice". That fired whenever the
// two pools collided, which is 11.1% of loops, and forced unison on loops
// where nobody had decided anything -- item 4 shipped with that clause and
// item 12 is what replaces it. A collision now takes the separated path
// like any other pair of voices; a collision is not a decision.
//
// Keys move, melody does not. The melody is the part being listened to and
// it has already been placed in a register that suits its voice; dragging
// it up to clear the accompaniment would fix the spacing by spoiling the
// thing the spacing is for.
// `melody` used to be passed in for its drawn voice and is not any more:
// the question is now about the loop, not about what the two layers
// happened to draw.
function separateRegisters(harmony, tracks, choir) {
  const chords = tracks.chords.filter((e) => e.vel && e.notes && e.notes.length);
  const sung = tracks.melody.filter((e) => e.vel);
  if (!chords.length || !sung.length) return;

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const notes = [];
  for (const e of chords) for (const n of e.notes) notes.push(n);
  const melodyCentre = mean(sung.map((e) => e.midi));
  const chordCentre = mean(notes);

  const same = !!choir;

  const lowest = Math.min(...notes);
  const highest = Math.max(...notes);
  // Octaves only, and only ones that keep the voicing somewhere a keyboard
  // would actually play it.
  const room = (sh) => lowest + sh >= 33 && highest + sh <= 96;
  const gap = (sh) => Math.abs(melodyCentre - (chordCentre + sh));

  let shift = 0;
  if (same) {
    // Unison: whichever octave puts the two centres closest together.
    for (const sh of [-12, 12, -24]) {
      if (room(sh) && gap(sh) < gap(shift)) shift = sh;
    }
  } else if (gap(0) < 5) {
    // Down, by the least that clears five semitones; failing that, by
    // whatever opens the most room.
    const down = [-12, -24].filter(room);
    shift = down.find((sh) => gap(sh) >= 5)
      ?? down.sort((a, b) => gap(b) - gap(a))[0]
      ?? 0;
  }

  if (!shift) return;
  // Every copy of a chord event, in the pattern and in the layer it was
  // built from, so a bar the repair pass puts back later comes back in the
  // octave the rest of the keys are in. Silenced copies share their notes
  // array with the original and are left alone; they make no sound.
  const moved = new Set();
  for (const list of [harmony.events, tracks.chords]) {
    for (const e of list) {
      if (!e.notes || moved.has(e)) continue;
      moved.add(e);
      e.notes = e.notes.map((n) => n + shift);
    }
  }
}

// ------------------------------------------- where the line came from

// Roadmap item 9 v2. A wind player slides into notes, and a slide needs a
// pitch to slide *from* -- which is the one thing the synth cannot work
// out. It sees one note at a time and has no idea what came before it.
//
// So the composer writes it down. `prev` is the pitch of the previous
// sounding note, and it is derived rather than drawn: a pass over the
// finished track, reading pitches that were already decided. Nothing is
// taken from any random stream, which is why every existing share code
// still renders the loop it always rendered.
//
// It is annotated only when the two notes are close enough in time to be
// one gesture. A slide joins notes a player did not re-articulate between;
// across a rest you take a breath and start the next note cleanly. Over
// the corpus, 64% of consecutive wind-melody notes are legato or
// overlapping outright, so this is the common case rather than a rare one.
//
// Run after the entry schedules and the gaps, because the question is
// about what is *heard*: a note whose predecessor was scheduled out has
// nothing to slide from, and the note before that one may be half a bar
// away.
const SLIDE_JOIN = 0.12;

function annotatePrev(events, spec, cycleSteps) {
  const sd = 60 / spec.bpm / 4;
  const sounding = events.filter((e) => e.vel).sort((a, b) => a.step - b.step);
  if (sounding.length < 2) return;
  const joined = (fromEnd, toStart) => (toStart - fromEnd) * sd <= SLIDE_JOIN;
  for (let i = 1; i < sounding.length; i++) {
    const prev = sounding[i - 1];
    const cur = sounding[i];
    if (joined(prev.step + prev.dur, cur.step)) cur.prev = prev.midi;
  }
  // The loop repeats, so the first note's predecessor is the last one --
  // one note a loop, and the one a listener hears most often, since it is
  // the seam.
  const first = sounding[0];
  const last = sounding[sounding.length - 1];
  if (cycleSteps && joined(last.step + last.dur - cycleSteps, first.step)) {
    first.prev = last.midi;
  }
}

// --------------------------------------------------------------- render

export function render(spec) {
  const choir = choirOf(spec);
  const harmony = genHarmony(layerSpec(spec, 'chords'));
  const bass = genBass(layerSpec(spec, 'bass'), harmony);
  const melody = genMelody(layerSpec(spec, 'melody'), harmony);
  const drums = genDrums(layerSpec(spec, 'drums'));
  const texture = genTexture(layerSpec(spec, 'texture'), harmony);

  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const form = genForm(spec);
  const gaps = genGaps(spec);
  const raw = {
    drums: drums.events,
    bass: bass.events,
    chords: harmony.events,
    melody: melody.events,
    texture: texture.events,
  };
  const tracks = { ...raw };
  let quiet = [];
  if (form) {
    for (const layer of LAYERS) tracks[layer] = applyForm(tracks[layer], form[layer], spb);
    const c = characterOf(spec);
    // Airier characters get a longer allowance, but nobody gets an outage.
    const maxRest = Math.max(1, Math.round(1 + (c.airy ?? 0.25) * 2));
    const counts = limitSilence(tracks, raw, form, spec.bars, spb, maxRest, spec.cycles);
    // Report what is actually empty, not what the schedule intended: a layer
    // can be scheduled in and still have nothing to play that bar.
    for (let bar = 0; bar < spec.bars; bar++) if (!counts[bar]) quiet.push(bar);
  }
  // Short gaps silence every layer for a beat or two. Applied after the
  // entry schedules and after the repair pass, so they are never undone.
  if (gaps.length) {
    for (const layer of LAYERS) {
      tracks[layer] = tracks[layer].map((e) => {
        const inGap = gaps.some((g) => e.step >= g.start && e.step < g.start + g.len);
        return inGap ? { ...e, vel: 0 } : e;
      });
    }
  }

  // Kept until here, after the entry schedules and the gaps, because the
  // question it answers is about what you hear. Deciding it on every event
  // the generator produced gives the wrong answer once the bars of a
  // melody sit in different octaves: silencing one bar then moves the
  // sounding centroid by several semitones, and a separation that was
  // correct on paper is wrong in the room.
  separateRegisters(harmony, tracks, choir);

  // After the register work, so the pitch written down is the pitch played.
  annotatePrev(tracks.melody, spec, (spec.cycles && spec.cycles.melody) || spec.bars * spb);

  // Something has to get out of the way or the doubling is inaudible.
  //
  // Once the keys are singing there is no pad left in that register -- the
  // relabel took it -- so what remains competing with two voices around
  // MIDI 55-95 is the air layer: its bells and chimes sit an octave or two
  // above the chord and its swells sit directly on top of the line. They
  // step back rather than leave: deleting a layer for a loop reads as
  // something having broken, where 0.4 of the level reads as the room
  // making space. That is about 8dB, which is a step back anybody hears.
  //
  // This is a mix decision and nothing else. The air layer is charged
  // against the same voice budget, so it looked as though thinning would
  // also buy the doubling headroom -- it does not. Silencing the layer
  // outright moves melody refusals from 9.1% to 8.7%, so there is no
  // budget argument here and the depth was chosen by ear instead.
  if (choir) {
    tracks.texture = tracks.texture.map((e) => (e.vel ? { ...e, vel: e.vel * 0.4 } : e));
  }

  return {
    spec,
    form,
    gaps,
    silentBars: quiet,
    totalSteps: spec.bars * spb,
    stepsPerBar: spb,
    // Per-layer loop lengths. Null means "same as the pattern"; the Eno
    // character gives each layer a coprime length so they drift apart.
    cycles: {
      drums: (spec.cycles && spec.cycles.drums) || spec.bars * spb,
      bass: (spec.cycles && spec.cycles.bass) || spec.bars * spb,
      chords: (spec.cycles && spec.cycles.chords) || spec.bars * spb,
      melody: (spec.cycles && spec.cycles.melody) || spec.bars * spb,
      texture: (spec.cycles && spec.cycles.texture) || spec.bars * spb,
    },
    harmony,
    tracks,
    meta: { bassVoice: bass.voice, bassStyle: bass.style, kit: drums.kit, melodyVoice: melody.voice, melodyCell: melody.cell, textureKind: texture.kind,
      // Only present when there is one, so a loop that is not a choir
      // carries a meta object identical to the one it carried before this
      // existed.
      ...(choir ? { choir } : {}) },
  };
}

// Walk up or down until we land on a note that belongs to the scale, so a
// drifting melody never wanders outside the mode it was written in.
function neighbourInScale(midi, root, steps, dir) {
  for (let i = 1; i <= 4; i++) {
    const cand = midi + dir * i;
    const pc = (((cand - root) % 12) + 12) % 12;
    if (steps.includes(pc)) return cand;
  }
  return midi;
}


// --------------------------------------------------------------- form

// Entry schedules.
//
// Temple of Time and the Breath of the Wild field tracks have several
// seconds of actual nothing in them. A loop cannot get that by leaving a
// fixed hole in the bar line -- on a short loop the same gap every sixteen
// seconds reads as a skip, not a rest.
//
// Instead each layer is given its own schedule of which bars it is present
// for, in runs of a few bars at a time. Silence emerges wherever the runs
// happen to coincide in absence, and because the layers have different run
// lengths (and under polymeter, different cycle lengths) it lands somewhere
// different each time round.
//
// Derived from the loop seed rather than any layer seed, so re-rolling the
// bass does not rearrange the whole form underneath you.

const FORM_RUNS = {
  //          in-run bars     out-run bars
  drums:   [[4, 12], [2, 6]],
  bass:    [[4, 10], [2, 6]],
  chords:  [[4, 12], [2, 5]],
  melody:  [[2, 6], [3, 9]],   // the sparsest, which is what leaves holes
  texture: [[2, 6], [3, 10]],
};

function runSchedule(r, bars, [inLo, inHi], [outLo, outHi], startIn) {
  const out = new Array(bars).fill(false);
  let i = 0;
  let on = startIn;
  while (i < bars) {
    // Quantise every entry and exit to a two-bar boundary. Music stopping
    // on bar three and a half is what reads as "it just stopped for no
    // reason"; stopping where a phrase would end reads as a breath.
    // Entries still land on two-bar boundaries, but a rest no longer has to
    // be two whole bars: forcing that minimum is why an eight-bar loop so
    // often lost a quarter of itself.
    const raw = on ? r.int(inLo, inHi) : r.int(outLo, outHi);
    const len = on ? Math.max(2, Math.round(raw / 2) * 2) : Math.max(1, raw);
    for (let k = 0; k < len && i < bars; k++, i += 1) out[i] = on;
    on = !on;
  }
  // Never schedule a layer out for the entire loop; that is not silence,
  // that is a missing instrument.
  if (!out.some(Boolean)) {
    for (let k = 0; k < Math.min(bars, 4); k++) out[k] = true;
  }
  return out;
}

// Short gaps: a beat or two of nothing, not a whole bar.
//
// Bar-level entry schedules only ever produce long rests, and a long rest is
// a big commitment -- on an eight-bar loop it costs a quarter of the piece.
// A caught breath before a phrase lands is a different gesture entirely, it
// is cheap, and several of them in a long loop reads as playing rather than
// as stopping. These are independent of the entry schedules, so a loop can
// have one, the other, both or neither.
export function genGaps(spec) {
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const total = spec.bars * spb;
  const r = new Rng(((spec.seed ^ 0x3c6ef372) >>> 0) || 13);
  const c = characterOf(spec);
  // Busier profiles want fewer of these; still ones want more.
  if (!r.chance(0.18 + (c.airy ?? 0.2) * 0.5)) return [];
  const count = r.weighted([[1, 4], [2, 3], [3, 1.5]]);
  const gaps = [];
  for (let i = 0; i < count; i++) {
    // A quarter, a half or a whole bar, landing on a beat.
    const len = r.pick([spb / 4, spb / 4, spb / 2, spb / 2, spb]);
    const beats = Math.max(1, Math.floor(total / (spb / 4)));
    const start = r.int(1, beats - 1) * (spb / 4);
    if (start + len > total) continue;
    gaps.push({ start: Math.round(start), len: Math.round(len) });
  }
  return gaps;
}

export function genForm(spec) {
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const c = characterOf(spec);
  // Short loops are left alone. A hole in a two-bar loop is a glitch.
  if (spec.bars < 8) return null;
  const r = new Rng(((spec.seed ^ 0x5f3759df) >>> 0) || 7);
  if (!r.chance(c.airy ?? 0.25)) return null;

  const schedules = {};
  for (const layer of LAYERS) {
    // A freshly rolled layer plays throughout, so the roll is audible at
    // once instead of waiting eight bars for its entry.
    if (spec.forceLayers && spec.forceLayers[layer]) {
      schedules[layer] = null;
      continue;
    }
    const cycle = (spec.cycles && spec.cycles[layer]) || spec.bars * spb;
    const bars = Math.max(1, Math.round(cycle / spb));
    const [inRun, outRun] = FORM_RUNS[layer];
    schedules[layer] = runSchedule(r, bars, inRun, outRun, r.chance(0.7));
  }

  // If nothing ever coincides, place one rest by hand at a phrase boundary,
  // so a loop that asked for air actually gets some.
  const silent = silentBars(schedules, spec, spb);
  if (!silent.length) {
    const at = Math.min(spec.bars - 2, Math.max(4, Math.round(spec.bars / 2 / 4) * 4));
    const span = r.chance(0.5) ? 2 : 1;
    for (const layer of LAYERS) {
      const sched = schedules[layer];
      if (!sched) continue;
      for (let k = 0; k < span; k++) {
        const idx = (at + k) % sched.length;
        sched[idx] = false;
      }
    }
  }
  return schedules;
}

// Which bars of the loop have every layer scheduled out.
function silentBars(schedules, spec, spb) {
  const out = [];
  for (let bar = 0; bar < spec.bars; bar++) {
    let quiet = true;
    for (const layer of LAYERS) {
      const sched = schedules[layer];
      if (!sched) { quiet = false; break; }
      const cycleBars = sched.length;
      if (sched[bar % cycleBars]) { quiet = false; break; }
    }
    if (quiet) out.push(bar);
  }
  return out;
}

// Silence events rather than deleting them, so the pattern keeps its shape,
// Drift still has something to vary, and a masked bar can be put back.
// Order and length are preserved, so index i here matches index i in the
// unmasked track -- which is what makes the repair pass below cheap.
function applyForm(events, schedule, spb) {
  if (!schedule) return events;
  return events.map((e) => {
    const bar = Math.floor(e.step / spb) % schedule.length;
    return schedule[bar] ? e : { ...e, vel: 0 };
  });
}

// Counting with `% bars` is wrong under polymeter: a layer on an 8-bar cycle
// inside a 32-bar loop has no events past global bar 7, yet it plays all the
// way through because the engine wraps it on its own cycle. Fold each layer
// on its own length first, then read it off per global bar.
function localBars(cycles, layer, bars, spb) {
  const cycle = (cycles && cycles[layer]) || bars * spb;
  return Math.max(1, Math.round(cycle / spb));
}

function audiblePerBar(tracks, bars, spb, cycles) {
  const counts = new Array(bars).fill(0);
  for (const layer of LAYERS) {
    const cb = localBars(cycles, layer, bars, spb);
    const per = new Array(cb).fill(0);
    for (const e of tracks[layer]) {
      if (!e.vel) continue;
      per[Math.floor(e.step / spb) % cb] += 1;
    }
    for (let b = 0; b < bars; b++) counts[b] += per[b % cb];
  }
  return counts;
}

// Schedules alone overshoot badly. Entry runs, the melody's own rest-bar
// chance and the sparser bass styles all subtract independently, and they
// compound: one sixteen-bar loop played for four bars and then stopped for
// eleven. A rest is a few seconds of held breath, not an outage.
//
// So after masking, any run of empty bars longer than the allowance gets a
// layer put back, cheapest-sounding first.
const REPAIR_ORDER = ['chords', 'bass', 'texture', 'melody', 'drums'];

function limitSilence(tracks, raw, form, bars, spb, maxRest, cycles) {
  let counts = audiblePerBar(tracks, bars, spb, cycles);
  let run = 0;
  for (let bar = 0; bar < bars; bar++) {
    if (counts[bar] > 0) { run = 0; continue; }
    run += 1;
    if (run <= maxRest) continue;
    let repaired = false;
    for (const layer of REPAIR_ORDER) {
      const cb = localBars(cycles, layer, bars, spb);
      const local = bar % cb;
      const inBar = (e) => Math.floor(e.step / spb) % cb === local;
      if (!raw[layer].some((e) => e.vel > 0 && inBar(e))) continue;
      tracks[layer] = tracks[layer].map((e, i) => (inBar(e) ? { ...raw[layer][i] } : e));
      if (form[layer]) form[layer][local] = true;
      repaired = true;
      break;
    }
    if (!repaired) continue; // genuinely nothing to put back anywhere
    counts = audiblePerBar(tracks, bars, spb, cycles);
    run = 0;
  }
  return counts;
}

// ----------------------------------------------------------- drift

// Called once per loop repeat when Drift is on. It never edits the stored
// pattern; it returns a shallow variation, so the piece always remembers
// what it actually is and keeps returning home.
export function drift(pattern, rng, amount) {
  const p = {
    ...pattern,
    tracks: {
      drums: pattern.tracks.drums.map((e) => ({ ...e })),
      bass: pattern.tracks.bass.map((e) => ({ ...e })),
      chords: pattern.tracks.chords.map((e) => ({ ...e, notes: e.notes.slice() })),
      melody: pattern.tracks.melody.map((e) => ({ ...e })),
      texture: pattern.tracks.texture.map((e) => ({ ...e, notes: e.notes.slice() })),
    },
  };
  const spec = pattern.spec;
  const scale = SCALES[spec.scale].steps;
  const a = amount;

  // Hats flicker in and out.
  for (const e of p.tracks.drums) {
    if ((e.inst === 'hat' || e.inst === 'shaker') && rng.chance(0.1 * a)) e.vel = 0;
    if (e.inst === 'hat' && rng.chance(0.05 * a)) e.inst = 'ohat';
  }
  // An extra ghost hit.
  if (rng.chance(0.4 * a) && p.tracks.drums.length) {
    p.tracks.drums.push({
      step: rng.int(0, p.totalSteps - 1),
      inst: rng.pick(['rim', 'shaker', 'hat']),
      vel: 0.16 + rng.f() * 0.14,
    });
  }
  // Occasionally the kick sits one out.
  if (rng.chance(0.18 * a)) {
    const kicks = p.tracks.drums.filter((e) => e.inst === 'kick' && e.step > 0);
    if (kicks.length) kicks[rng.int(0, kicks.length - 1)].vel = 0;
  }
  // A melody note steps to a neighbour, or jumps an octave.
  for (const e of p.tracks.melody) {
    if (rng.chance(0.09 * a)) {
      e.midi = neighbourInScale(e.midi, spec.root, scale, rng.chance(0.5) ? 1 : -1);
    }
    // Keep the jump inside the melody's own window, the way the bass jump
    // below already does. It was unclamped and got away with it only
    // because the old per-note fold left nothing near the top of the
    // register; now that a bar is placed as a unit the top is reachable,
    // and an unclamped octave on top of a scale step walks off the
    // keyboard.
    if (rng.chance(0.04 * a) && e.midi + 12 <= 95) e.midi += 12;
    if (rng.chance(0.07 * a)) e.vel = 0;
  }
  // Bass finds a passing tone.
  for (const e of p.tracks.bass) {
    if (rng.chance(0.07 * a)) {
      let m = e.midi + rng.pick([-2, 3, 5, 7, 12]);
      while (m > 52) m -= 12;
      while (m < 28) m += 12;
      e.midi = m;
    }
  }
  // A chord opens up.
  for (const e of p.tracks.chords) {
    if (rng.chance(0.06 * a) && e.notes.length) e.notes.push(e.notes[0] + 14);
    if (rng.chance(0.05 * a)) e.vel *= 0.4;
  }
  // And now and then the whole thing stops. Unpredictable, over a loop you
  // already know, which is the part a fixed rest can never give you.
  if (rng.chance(0.1 * a)) {
    const spb = pattern.stepsPerBar || 16;
    const bars = Math.max(1, Math.floor(p.totalSteps / spb));
    if (bars >= 4) {
      const span = rng.chance(0.35) ? 2 : 1;
      // Land the rest on an even bar, for the same reason.
      const latest = Math.max(1, bars - span);
      const start = Math.min(latest, Math.max(2, rng.int(1, latest) & ~1));
      const from = start * spb;
      const to = (start + span) * spb;
      for (const layer of Object.keys(p.tracks)) {
        for (const e of p.tracks[layer]) {
          if (e.step >= from && e.step < to) e.vel = 0;
        }
      }
      p.driftSilentBars = [];
      for (let k = 0; k < span; k++) p.driftSilentBars.push(start + k);
    }
  }

  // Now and then a single layer takes a breath.
  if (rng.chance(0.1 * a)) {
    const layer = rng.pick(['melody', 'chords', 'drums']);
    const half = rng.chance(0.5) ? 0 : p.totalSteps / 2;
    for (const e of p.tracks[layer]) {
      if (e.step >= half && e.step < half + p.totalSteps / 2) e.vel = 0;
    }
  }
  return p;
}
