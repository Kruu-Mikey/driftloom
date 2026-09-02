// The composer.
//
// A loop is stored as a "spec": a handful of numbers, plus one seed per
// layer. Rendering a spec always produces the same pattern. Because each
// layer holds its own seed, you can re-roll the bass without touching
// anything else — the other layers literally cannot change, because their
// random streams never moved.

import { Rng, randomSeed, seedName } from './rng.js';
import { SCALES, scalePitch, buildChord, voiceInRange, nearestChordTone } from './theory.js';

export const LAYERS = ['drums', 'bass', 'chords', 'melody', 'texture'];
export const LAYER_LABELS = {
  drums: 'Drums',
  bass: 'Bass',
  chords: 'Keys',
  melody: 'Melody',
  texture: 'Air',
};

export const STEPS_PER_BAR = 16;

// ---------------------------------------------------------------- spec

export function newSpec(seed = randomSeed()) {
  const r = new Rng(seed);
  // Keep the existing dreamy/modal character, but deliberately make
  // bright, uncomplicated scales more common. This gives the generator
  // more of the gentle, happy nostalgia of old game soundtracks without
  // turning every loop into a major-key tune.
  const scale = r.weighted([
    ['dorian', 2.5],
    ['aeolian', 2.2],
    ['minorPent', 1.8],
    ['majorPent', 3.2],
    ['kumoi', 2.2],
    ['ionian', 2.8],
    ['mixolydian', 1.8],
    ['lydian', 2.2],
    ['hirajoshi', 1.0],
    ['insen', 0.8],
    ['phrygian', 0.55],
    ['harmonicMinor', 0.45],
    ['wholeTone', 0.15],
  ]);
  return {
    seed,
    name: seedName(seed),
    bpm: Math.round(r.range(61, 88)),
    root: r.int(0, 11),
    scale,
    bars: r.weighted([[4, 7], [2, 2], [8, 2]]),
    swing: r.range(0.04, 0.3),
    layerSeeds: {
      drums: r.seed32(),
      bass: r.seed32(),
      chords: r.seed32(),
      melody: r.seed32(),
      texture: r.seed32(),
    },
    mutes: { drums: false, bass: false, chords: false, melody: false, texture: false },
    tone: {
      warmth: r.range(0.35, 0.9),
      space: r.range(0.25, 0.8),
      wobble: r.range(0.1, 0.7),
    },
  };
}

export function rerollLayer(spec, layer) {
  const next = cloneSpec(spec);
  next.layerSeeds[layer] = randomSeed();
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

  const chordsPerBar = r.chance(0.18) ? 2 : 1;
  const slotLen = STEPS_PER_BAR / chordsPerBar;
  const slotCount = spec.bars * chordsPerBar;

  const size = r.weighted([[3, 3], [4, 4], [2, 1]]);
  const voice = r.weighted([['keys', 5], ['pad', 3], ['both', 2]]);
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

  const slots = [];
  const events = [];
  let prevVoicing = null;

  for (let s = 0; s < slotCount; s++) {
    const degree = shape[s % shape.length];
    let notes = buildChord(spec.root, scale, degree, size, 0);
    // Occasionally colour the chord with a ninth.
    if (!pentatonic && r.chance(0.28)) notes.push(scalePitch(spec.root, scale, degree + 8, 0));
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
    slots.push({ startStep, lengthSteps: slotLen, degree, notes, rootMidi });

    // Hit positions are written relative to the chord's own slot, so a
    // half-bar change gets its own attack instead of borrowing the bar's.
    const hits = chordsPerBar === 2
      ? [[0, slotLen], [4, slotLen - 4]].slice(0, r.chance(0.5) ? 1 : 2)
      : CHORD_RHYTHMS[rhythmName];

    for (const [hitStep, dur] of hits) {
      const step = startStep + hitStep;
      if (step >= spec.bars * STEPS_PER_BAR) continue;
      // Sometimes leave a hole. Space is an instrument.
      if (r.chance(0.08)) continue;

      if (arpeggiate) {
        notes.forEach((n, i) => {
          events.push({
            step: (step + i * 2) % (spec.bars * STEPS_PER_BAR),
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

  return { slots, events, shape };
}

function slotAt(slots, step) {
  for (let i = slots.length - 1; i >= 0; i--) {
    if (step >= slots[i].startStep) return slots[i];
  }
  return slots[0];
}

// --------------------------------------------------------------- bass

function genBass(spec, harmony) {
  const r = new Rng(spec.layerSeeds.bass);
  const scale = SCALES[spec.scale].steps;
  const total = spec.bars * STEPS_PER_BAR;
  const style = r.weighted([
    ['held', 3],
    ['pulse', 3],
    ['dub', 2.5],
    ['walk', 1.5],
    ['sparse', 2],
  ]);
  const octaveShift = r.chance(0.25) ? -12 : 0;
  const events = [];

  const place = (step, dur, midi, vel, glide = false) => {
    let m = midi + octaveShift;
    while (m > 52) m -= 12;
    while (m < 28) m += 12;
    events.push({ step: step % total, dur, midi: m, vel, glide });
  };

  for (const slot of harmony.slots) {
    const base = slot.rootMidi - 24;
    const len = slot.lengthSteps;
    if (r.chance(0.06)) continue; // leave one slot empty now and then

    if (style === 'held') {
      place(slot.startStep, len - 1, base, 0.62 + r.f() * 0.15);
      if (r.chance(0.3)) place(slot.startStep + len - 2, 2, base + 7, 0.4);
    } else if (style === 'pulse') {
      const grid = r.pick([[0, 8], [0, 6, 10], [0, 4, 8, 12], [0, 7, 10]]);
      for (const g of grid) {
        if (g >= len) continue;
        place(slot.startStep + g, r.pick([2, 3, 4]), base, g === 0 ? 0.7 : 0.45 + r.f() * 0.2);
      }
    } else if (style === 'dub') {
      place(slot.startStep, 6, base, 0.72);
      if (r.chance(0.7)) place(slot.startStep + 10, 4, base, 0.5, r.chance(0.4));
      if (r.chance(0.35)) place(slot.startStep + 14, 2, base + r.pick([3, 5, 7]), 0.4);
    } else if (style === 'walk') {
      const steps = [0, 4, 8, 12].filter((s) => s < len);
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

  return { events, style };
}

// ------------------------------------------------------------- melody

function genMelody(spec, harmony) {
  const r = new Rng(spec.layerSeeds.melody);
  const scale = SCALES[spec.scale].steps;
  const total = spec.bars * STEPS_PER_BAR;
  const voice = r.weighted([['pluck', 3], ['bell', 3.5], ['keys', 3], ['saw', 0.7]]);
  const brightScale = ['majorPent', 'ionian', 'lydian', 'mixolydian'].includes(spec.scale);
  const silent = r.chance(brightScale ? 0.05 : 0.09);
  if (silent) return { events: [], voice, motif: [] };

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
  const grid = r.pick(rhythmPool);
  const motif = [];
  let deg = 0;
  for (let i = 0; i < motifLen; i++) {
    motif.push({
      offset: grid[i % grid.length],
      degree: deg,
      dur: r.pick([2, 2, 3, 4, 6]),
      vel: 0.4 + r.f() * 0.3,
    });
    deg += r.weighted([[0, 1], [1, 3], [-1, 3], [2, 2], [-2, 1.5], [3, 1], [-3, 0.8], [4, 0.5]]);
    deg = Math.max(-4, Math.min(9, deg));
  }

  const events = [];
  const octave = r.pick([0, 0, 1]);
  const restBarChance = brightScale ? 0.16 : 0.20;

  for (let bar = 0; bar < spec.bars; bar++) {
    if (r.chance(restBarChance)) continue;
    const barStart = bar * STEPS_PER_BAR;
    const slot = slotAt(harmony.slots, barStart);
    const transpose = bar === 0 ? 0 : r.weighted([[0, 4], [1, 1.5], [-1, 1.5], [2, 1]]);
    const trim = r.chance(0.3) ? r.int(1, 2) : 0;

    for (let i = 0; i < motif.length - trim; i++) {
      const m = motif[i];
      if (r.chance(0.12)) continue; // drop a note
      let midi = scalePitch(spec.root, scale, m.degree + transpose + slot.degree, octave) + 12;
      // Land on a chord tone at the start of a phrase so it feels anchored.
      if (i === 0) midi = nearestChordTone(midi, slot.notes);
      if (r.chance(0.07)) midi += 12;
      while (midi < 62) midi += 12;
      while (midi > 92) midi -= 12;
      events.push({
        step: (barStart + m.offset) % total,
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

function genDrums(spec) {
  const r = new Rng(spec.layerSeeds.drums);
  const total = spec.bars * STEPS_PER_BAR;
  const events = [];
  const kit = r.weighted([['tape', 4], ['brush', 2], ['machine', 3], ['none', 1.1]]);
  if (kit === 'none') return { events, kit, hatDensity: 0 };

  const kick = r.pick(KICK_PATTERNS);
  const snare = r.pick(SNARE_PATTERNS);
  const snareVoice = r.weighted([['snare', 3], ['rim', 2], ['clap', 1.5]]);
  const hatDensity = r.range(0.15, 0.85);
  const hatGrid = r.chance(0.55) ? 2 : 1; // eighths or sixteenths
  const useShaker = r.chance(0.4);

  for (let bar = 0; bar < spec.bars; bar++) {
    const b = bar * STEPS_PER_BAR;
    const lastBar = bar === spec.bars - 1;

    for (const s of kick) {
      if (bar > 0 && r.chance(0.1)) continue;
      events.push({ step: b + s, inst: 'kick', vel: s === 0 ? 0.84 : 0.62 + r.f() * 0.18 });
    }
    for (const s of snare) {
      events.push({ step: b + s, inst: snareVoice, vel: 0.58 + r.f() * 0.18 });
    }
    // Ghost notes give the groove its lean.
    if (r.chance(0.4)) events.push({ step: b + r.pick([3, 7, 11, 15]), inst: 'rim', vel: 0.22 });

    for (let s = 0; s < STEPS_PER_BAR; s += hatGrid) {
      if (!r.chance(hatDensity)) continue;
      const open = r.chance(0.08);
      events.push({
        step: b + s,
        inst: open ? 'ohat' : 'hat',
        vel: (s % 4 === 0 ? 0.5 : 0.3) + r.f() * 0.2,
      });
    }
    if (useShaker) {
      for (let s = 2; s < STEPS_PER_BAR; s += 4) {
        if (r.chance(0.6)) events.push({ step: b + s, inst: 'shaker', vel: 0.18 + r.f() * 0.15 });
      }
    }
    // A small fill to mark the turnaround.
    if (lastBar && r.chance(0.35)) {
      const from = r.pick([12, 13, 14]);
      for (let s = from; s < STEPS_PER_BAR; s++) {
        events.push({ step: b + s, inst: r.pick(['rim', 'snare', 'shaker']), vel: 0.3 + r.f() * 0.3 });
      }
    }
  }
  return { events: events.filter((e) => e.step < total), kit, hatDensity };
}

// ------------------------------------------------------------- texture

function genTexture(spec, harmony) {
  const r = new Rng(spec.layerSeeds.texture);
  const total = spec.bars * STEPS_PER_BAR;
  const kind = r.weighted([['bells', 3], ['swell', 3], ['wind', 2], ['drops', 2], ['none', 1.5]]);
  const events = [];
  if (kind === 'none') return { events, kind };

  if (kind === 'swell') {
    for (let bar = 0; bar < spec.bars; bar += 2) {
      const slot = slotAt(harmony.slots, bar * STEPS_PER_BAR);
      events.push({
        step: bar * STEPS_PER_BAR,
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
      const slot = slotAt(harmony.slots, step);
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
  const harmony = genHarmony(spec);
  const bass = genBass(spec, harmony);
  const melody = genMelody(spec, harmony);
  const drums = genDrums(spec);
  const texture = genTexture(spec, harmony);

  return {
    spec,
    totalSteps: spec.bars * STEPS_PER_BAR,
    stepsPerBar: STEPS_PER_BAR,
    harmony,
    tracks: {
      drums: drums.events,
      bass: bass.events,
      chords: harmony.events,
      melody: melody.events,
      texture: texture.events,
    },
    meta: { bassStyle: bass.style, kit: drums.kit, melodyVoice: melody.voice, textureKind: texture.kind },
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
  // Now and then a whole layer takes a breath.
  if (rng.chance(0.1 * a)) {
    const layer = rng.pick(['melody', 'chords', 'drums']);
    const half = rng.chance(0.5) ? 0 : p.totalSteps / 2;
    for (const e of p.tracks[layer]) {
      if (e.step >= half && e.step < half + p.totalSteps / 2) e.vel = 0;
    }
  }
  return p;
}
