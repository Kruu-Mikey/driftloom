// The composer.
//
// A loop is stored as a "spec": a handful of numbers, plus one seed per
// layer. Rendering a spec always produces the same pattern. Because each
// layer holds its own seed, you can re-roll the bass without touching
// anything else — the other layers literally cannot change, because their
// random streams never moved.

import { Rng, randomSeed, seedName } from './rng.js';
import { SCALES, scalePitch, buildChord, voiceInRange, nearestChordTone, moodWeighted } from './theory.js';
import { CHARACTERS, CHARACTER_WEIGHTS, POLY_CYCLES, blendCharacters } from './characters.js';

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

// ---------------------------------------------------------------- spec

export function newSpec(seed = randomSeed()) {
  const r = new Rng(seed);
  const characterKey = r.weighted(CHARACTER_WEIGHTS);
  // Most loops lean on one character, but well over half pull something in
  // from a second, so the six palettes shade into each other rather than
  // sitting in six separate boxes.
  let secondKey = null;
  let blend = 0;
  if (r.chance(0.62)) {
    secondKey = r.weighted(CHARACTER_WEIGHTS.filter(([k]) => k !== characterKey));
    blend = r.range(0.2, 0.6);
  }
  const c = blendCharacters(characterKey, secondKey, blend);

  // The character axis runs from settled to lifted -- reflective, soothing,
  // peaceful at one end, happy and joyful at the other. Both ends are
  // wholesome; there is no sombre pole. Skewed upward because the app was
  // reliably wistful and almost never glad, and it should be able to be both.
  const mood = c.mood[0] + (c.mood[1] - c.mood[0]) * Math.pow(r.f(), 0.62);

  const stepsPerBar = r.weighted(c.stepsPerBar);
  const bars = r.weighted(c.bars);

  const spec = {
    seed,
    name: seedName(seed),
    character: characterKey,
    character2: secondKey,
    blend: +blend.toFixed(3),
    mood: +mood.toFixed(3),
    bpm: Math.round(r.range(c.bpm[0], c.bpm[1]) + (mood - 0.5) * 6),
    root: r.int(0, 11),
    scale: r.weighted(moodWeighted(c.scales, mood)),
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
    tone: {
      warmth: r.range(c.tone.warmth[0], c.tone.warmth[1]),
      space: r.range(c.tone.space[0], c.tone.space[1]),
      wobble: r.range(c.tone.wobble[0], c.tone.wobble[1]),
    },
  };

  // Eno's trick: give each layer its own loop length, chosen so they do not
  // share factors. Nothing ever changes, and it never repeats.
  if (c.polymeter) {
    const pool = r.shuffle(POLY_CYCLES);
    spec.cycles = {
      drums: null,
      bass: pool[0] * stepsPerBar,
      chords: pool[1] * stepsPerBar,
      melody: pool[2] * stepsPerBar,
      texture: pool[3] * stepsPerBar,
    };
  }
  return spec;
}

export function characterOf(spec) {
  if (!spec.character2 || !spec.blend) return CHARACTERS[spec.character] || CHARACTERS.tape;
  return blendCharacters(spec.character, spec.character2, spec.blend);
}

export function moodOf(spec) {
  return spec.mood ?? 0.5;
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
    const mood = moodOf(spec);
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
  const mood = moodOf(spec);
  if (!forced(spec, 'melody') && r.chance(0.08)) return { events: [], voice, motif: [] };

  // Build a short motif in scale-degree offsets, then quote it across the
  // loop with variations. Repetition with variation is most of what makes
  // a random line sound composed rather than sprayed.
  const motifLen = r.int(3, 6);
  const rhythmPool = [
    [0, 2, 4, 6, 8, 10, 12, 14],
    [0, 3, 6, 8, 11, 14],
    [0, 2, 3, 6, 10, 12],
    [0, 4, 6, 10, 12, 14],
    [2, 4, 8, 10, 14],
  ];
  const grid = r.pick(spb === 12
    ? [[0, 3, 6, 9], [0, 2, 4, 6, 8, 10], [0, 3, 4, 7, 9], [0, 2, 6, 8, 11], [1, 3, 6, 10]]
    : rhythmPool).filter((x) => x < spb);
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
  const restBarChance = c.restBar;
  const pointillist = c.pointillist || 0;
  // Kataoka's Lost Woods loop appears to skip a beat, which knocks it out of
  // phase and makes you lose count. One dropped step does the same here.
  const slip = c.skipStep && r.chance(c.skipStep) ? r.int(1, 2) : 0;

  for (let bar = 0; bar < spec.bars; bar++) {
    if (r.chance(restBarChance)) continue;
    const barStart = bar * spb - slip * bar;
    const slot = slotAt(harmony.slots, barStart, harmony.cycleSteps);
    const transpose = bar === 0 ? 0 : r.weighted([[0, 4], [1, 1.5], [-1, 1.5], [2, 1]]);
    const trim = r.chance(0.3) ? r.int(1, 2) : 0;

    for (let i = 0; i < motif.length - trim; i++) {
      const m = motif[i];
      if (r.chance(0.12)) continue; // drop a note
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
  const kick = spb === 12 ? r.pick(KICK_12) : spb === 20 ? r.pick(KICK_20) : r.pick(KICK_PATTERNS);
  const snare = spb === 12 ? r.pick(SNARE_12) : spb === 20 ? r.pick(SNARE_20) : r.pick(SNARE_PATTERNS);
  const snareVoice = r.weighted([['snare', 3], ['rim', 2], ['clap', 1.5]]);
  const hatDensity = r.range(c.hatDensity[0], c.hatDensity[1]);
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
      if (!r.chance(hatDensity)) continue;
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
  const mood = moodOf(spec);
  // No birdsong. Wherever this gets played there are already real birds, and
  // the job is to complement what is outside rather than imitate it.
  const kind = r.weighted([
    ['bells', 3], ['swell', 3], ['wind', 2], ['drops', 2],
    ['none', forced(spec, 'texture') ? 0 : 1.5],
  ]);
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
  } else {
    events.push({ step: 0, dur: total, notes: [], vel: 0.1 + r.f() * 0.1, kind: 'wind' });
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
  return {
    spec,
    form,
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
    const len = on ? r.int(inLo, inHi) : r.int(outLo, outHi);
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
      const start = rng.int(1, Math.max(1, bars - span));
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
