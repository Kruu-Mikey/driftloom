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

const CHORD_RHYTHMS = {
  // Each entry is a bar's worth of hits: [startStep, durationInSteps]
  pad: [[0, 16]],
  breathe: [[0, 12]],
  twoAndFour: [[4, 3], [12, 3]],
  pushed: [[0, 6], [6, 4], [12, 3]],
  offbeat: [[2, 2], [6, 2], [10, 2], [14, 2]],
  lateBloom: [[6, 10]],
  stutter: [[0, 2], [3, 2], [8, 3]],
};

function genHarmony(spec) {
  const r = new Rng(spec.layerSeeds.chords);
  const c = characterOf(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
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
    const hits = chordsPerBar === 2
      ? [[0, slotLen], [4, slotLen - 4]].slice(0, r.chance(0.5) ? 1 : 2)
      : CHORD_RHYTHMS[rhythmName].filter(([st]) => st < spb);

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
            voice: 'keys',
          });
        });
      } else {
        events.push({
          step,
          dur,
          notes: notes.slice(),
          vel: 0.4 + r.f() * 0.25,
          voice: voice === 'both' ? (r.chance(0.5) ? 'keys' : 'pad') : voice,
          // One vowel for the whole chord. Singers on a chord sing the same
          // vowel; giving each note its own is not a choir, it is four
          // people disagreeing.
          vowel: slotVowel,
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

function genBass(spec, harmony) {
  const r = new Rng(spec.layerSeeds.bass);
  const c = characterOf(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
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
      place(slot.startStep, 6, base, 0.72);
      if (r.chance(0.7)) place(slot.startStep + 10, 4, base, 0.5, r.chance(0.4));
      if (r.chance(0.35)) place(slot.startStep + 14, 2, base + r.pick([3, 5, 7]), 0.4);
    } else if (style === 'walk') {
      const steps = (spb === 12 ? [0, 3, 6, 9] : [0, 4, 8, 12]).filter((s) => s < len);
      steps.forEach((s, i) => {
        const deg = slot.degree + (i === 0 ? 0 : r.pick([0, 1, -1, 2, 4]));
        const midi = scalePitch(spec.root, scale, deg, -2);
        place(slot.startStep + s, 3, midi, i === 0 ? 0.68 : 0.42 + r.f() * 0.15);
      });
    } else {
      // sparse: one long tone, sometimes nothing at all
      if (r.chance(0.75)) place(slot.startStep, len + (r.chance(0.3) ? len : 0) - 1, base, 0.55);
    }
  }

  return { events, style, voice };
}

// ------------------------------------------------------------- melody

function genMelody(spec, harmony) {
  const r = new Rng(spec.layerSeeds.melody);
  const c = characterOf(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const scale = SCALES[spec.scale].steps;
  const total = spec.bars * spb;
  const voice = r.weighted(c.melodyVoices);
  const lf = feelForLayer(spec, 'melody');
  const mood = lf.lift;
  if (!forced(spec, 'melody') && r.chance(0.08)) return { events: [], voice, motif: [] };

  // Build a short motif in scale-degree offsets, then quote it across the
  // loop with variations. Repetition with variation is most of what makes
  // a random line sound composed rather than sprayed.
  // Longer phrases at high energy, so a driven melody has somewhere to go.
  const motifLen = lf.energy > 0.6 ? r.int(5, 9) : r.int(3, 6);
  const rhythmPool = [
    [0, 2, 4, 6, 8, 10, 12, 14],
    [0, 3, 6, 8, 11, 14],
    [0, 2, 3, 6, 10, 12],
    [0, 4, 6, 10, 12, 14],
    [2, 4, 8, 10, 14],
  ];
  // At high energy prefer the busier grids: continuous motion is most of
  // what makes a melody read as going somewhere rather than settling.
  const driven = lf.energy > 0.6;
  const gridPool = spb === 12
    ? (driven
        ? [[0, 2, 4, 6, 8, 10], [0, 1, 3, 4, 6, 7, 9, 10], [0, 2, 3, 5, 6, 8, 9, 11]]
        : [[0, 3, 6, 9], [0, 2, 4, 6, 8, 10], [0, 3, 4, 7, 9], [0, 2, 6, 8, 11], [1, 3, 6, 10]])
    : (driven
        ? [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 3, 5, 6, 8, 10, 12, 14], [0, 1, 3, 4, 6, 8, 11, 12, 14]]
        : rhythmPool);
  const grid = r.pick(gridPool).filter((x) => x < spb);
  if (!grid.length) grid.push(0);
  const motif = [];
  let deg = 0;
  for (let i = 0; i < motifLen; i++) {
    motif.push({
      offset: grid[i % grid.length],
      degree: deg,
      dur: r.pick([2, 2, 3, 4, 6]),
      vel: 0.4 + r.f() * 0.3,
    });
    // A rising line reads as glad, a falling one as settled. The axis tilts
    // the random walk rather than dictating it.
    const up = 1 + mood * 2.2;
    const down = 1 + (1 - mood) * 2.2;
    deg += r.weighted([
      [0, 1], [1, 2 * up], [-1, 2 * down], [2, 1.4 * up], [-2, 1.1 * down],
      [3, 0.8 * up], [-3, 0.6 * down], [4, 0.4 * up],
    ]);
    deg = Math.max(-4, Math.min(9, deg));
  }

  const events = [];
  const octave = r.chance(0.25 + mood * 0.5) ? 1 : 0;
  // Energy trades silence for activity: a still loop rests far more often
  // than an animated one built from the same material.
  const restBarChance = Math.max(0.02, Math.min(0.7, c.restBar * (1.7 - lf.energy * 1.4)));
  const pointillist = c.pointillist || 0;
  // Kataoka's Lost Woods loop appears to skip a beat, which knocks it out of
  // phase and makes you lose count. One dropped step does the same here.
  const slip = c.skipStep && r.chance(c.skipStep) ? r.int(1, 2) : 0;

  // One vowel per phrase, changing every bar or two rather than per note.
  let vowel = r.pick(VOWEL_KEYS);
  for (let bar = 0; bar < spec.bars; bar++) {
    if (r.chance(restBarChance)) continue;
    if (bar > 0 && r.chance(0.45)) vowel = r.pick(VOWEL_KEYS);
    const barStart = bar * spb - slip * bar;
    const slot = slotAt(harmony.slots, barStart, harmony.cycleSteps);
    const transpose = bar === 0 ? 0 : r.weighted([[0, 4], [1, 1.5], [-1, 1.5], [2, 1]]);
    const trim = r.chance(0.3) ? r.int(1, 2) : 0;

    for (let i = 0; i < motif.length - trim; i++) {
      const m = motif[i];
      // An animated loop keeps moving; a still one leaves holes. Dropping
      // a fixed one note in eight regardless of energy was part of why
      // everything sounded becalmed.
      if (r.chance(0.2 - lf.energy * 0.15)) continue;
      let midi = scalePitch(spec.root, scale, m.degree + transpose + slot.degree, octave) + 12;
      // Land on a chord tone at the start of a phrase so it feels anchored.
      if (i === 0) midi = nearestChordTone(midi, slot.notes);
      if (r.chance(0.07)) midi += 12;
      // Pointillism: leap an octave instead of stepping, so the line reads
      // as colour rather than tune.
      if (pointillist && r.chance(pointillist)) midi += r.pick([-12, 12, 12]);
      while (midi < 55) midi += 12;
      while (midi > 95) midi -= 12;
      events.push({
        step: ((barStart + m.offset) % total + total) % total,
        dur: m.dur,
        midi,
        vel: m.vel * (bar === 0 ? 1 : 0.9),
        voice,
        vowel,
      });
    }
  }
  return { events, voice, motif };
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
        vel: (s % 4 === 0 ? 0.5 : 0.3) + r.f() * 0.2,
      });
    }
    if (useShaker) {
      for (let s = 2; s < spb; s += 4) {
        if (r.chance(0.6)) events.push({ step: b + s, inst: 'shaker', vel: 0.18 + r.f() * 0.15 });
      }
    }
    // Stutter rolls: a hit subdivided into a burst of rapidly quietening
    // repeats. This is the gesture that makes chopped breaks read as
    // chopped rather than merely fast.
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

// --------------------------------------------------------------- render

export function render(spec) {
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
    meta: { bassVoice: bass.voice, bassStyle: bass.style, kit: drums.kit, melodyVoice: melody.voice, textureKind: texture.kind },
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
    if (rng.chance(0.04 * a)) e.midi += 12;
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
