// Characters.
//
// One generator making one kind of music gets samey no matter how good the
// randomness is, because the *shape* never changes: same tempo band, same
// instruments, same density, same four bars of 4/4. A character is a set of
// constraints that moves all of those together, so two loops can differ in
// kind rather than just in detail.
//
// Each is built from how the real thing actually works, not from a vibe:
//
//  tape       the original lo-fi voice. Weighted highest so the app still
//             mostly makes what it already made.
//  hyrule     Koji Kondo. Modes sharing a lowered seventh (Mixolydian,
//             Dorian, Aeolian) so bVII-to-I is available, which is the move
//             that makes a phrase end without sounding finished. Harp,
//             ocarina, flute. Often in 6/8.
//  field      Breath of the Wild. Sparse piano, long silence, pointillistic
//             lines that leap octaves, quartal harmony, and loops that
//             occasionally drop a step so you lose count of the beat.
//  postcard   Hiroshi Yoshimura. Rhodes and a hushed pad, no percussion at
//             all, very slow, Japanese pentatonics. Deliberately dry: the
//             records have next to no reverb on them.
//  plantasia  Mort Garson. Monophonic Moog lead with portamento through a
//             resonant filter. Bright, major, quick and a bit silly.
//  airports   Brian Eno. Layer cycles of coprime lengths that never come
//             back into sync, so a handful of fixed elements keep
//             recombining. Long tones, no pulse.

export const CHARACTERS = {
  tape: {
    level: 1.0,
    label: 'Tape',
    weight: 3.8,
    bpm: [61, 88],
    stepsPerBar: [[16, 1]],
    bars: [[4, 7], [2, 2], [8, 2]],
    swing: [0.04, 0.3],
    scales: [
      ['dorian', 3], ['aeolian', 3], ['minorPent', 2], ['majorPent', 1.6],
      ['kumoi', 2], ['ionian', 1.4], ['mixolydian', 1.4], ['lydian', 1.2],
      ['hirajoshi', 1.2], ['insen', 1], ['phrygian', 0.7],
      ['harmonicMinor', 0.6], ['wholeTone', 0.25],
    ],
    drums: 0.9,
    hatDensity: [0.15, 0.85],
    chordVoices: [['keys', 5], ['pad', 3], ['both', 2]],
    melodyVoices: [['pluck', 3], ['bell', 2], ['keys', 2], ['saw', 1]],
    bassStyles: [['held', 3], ['pulse', 3], ['dub', 2.5], ['walk', 1.5], ['sparse', 2]],
    bassVoices: [['sub', 3], ['round', 2], ['pluckbass', 2], ['moogbass', 1.5]],
    mood: [0.2, 0.8],
    restBar: 0.22,
    chordSize: [[3, 3], [4, 4], [2, 1]],
    tone: { warmth: [0.35, 0.9], space: [0.25, 0.8], wobble: [0.1, 0.7] },
  },

  hyrule: {
    level: 0.8,
    label: 'Hyrule',
    weight: 2.1,
    bpm: [74, 112],
    stepsPerBar: [[16, 2], [12, 3]], // 4/4 and 6/8
    bars: [[4, 5], [8, 3], [2, 1]],
    swing: [0, 0.1],
    scales: [
      ['mixolydian', 3.5], ['dorian', 3], ['lydian', 2.5], ['ionian', 2],
      ['aeolian', 1.5], ['majorPent', 1.5], ['phrygianDominant', 1.2],
      ['lydianDominant', 1], ['dorianSharp4', 0.8],
    ],
    drums: 0.72,
    hatDensity: [0.1, 0.5],
    chordVoices: [['harp', 4], ['keys', 2], ['pad', 2]],
    melodyVoices: [['ocarina', 4], ['flute', 2.5], ['harp', 2], ['musicbox', 1]],
    bassStyles: [['held', 3], ['pulse', 2], ['walk', 2], ['sparse', 1]],
    bassVoices: [['pluckbass', 3], ['round', 3], ['sub', 1.5], ['fifths', 1]],
    mood: [0.45, 1],
    restBar: 0.14,
    chordSize: [[3, 4], [4, 3]],
    flatSeven: 0.45,   // chance a progression reaches for bVII
    tone: { warmth: [0.2, 0.5], space: [0.45, 0.85], wobble: [0.05, 0.3] },
  },

  field: {
    level: 0.42,
    label: 'Field',
    weight: 1.9,
    bpm: [50, 72],
    stepsPerBar: [[16, 3], [12, 1], [20, 1]], // sometimes 5/4
    bars: [[4, 3], [8, 3], [6, 1], [3, 1]],
    swing: [0, 0.06],
    scales: [
      ['lydian', 2.5], ['kumoi', 2.5], ['majorPent', 2], ['insen', 1.5],
      ['hirajoshi', 1.5], ['dorian', 1.5], ['akebono', 1.5],
      ['wholeTone', 1.2], ['ionian', 1],
    ],
    drums: 0.12,
    hatDensity: [0.05, 0.3],
    chordVoices: [['piano', 5], ['pad', 1.5]],
    melodyVoices: [['piano', 5], ['musicbox', 1.5], ['sine', 1]],
    bassStyles: [['sparse', 4], ['held', 2]],
    bassVoices: [['round', 3], ['fifths', 2.5], ['sub', 1]],
    mood: [0.35, 0.9],
    restBar: 0.45,
    chordSize: [[3, 2], [4, 3]],
    pointillist: 0.5,  // leap an octave rather than step
    skipStep: 0.35,    // drop a step so the loop slips out of phase
    quartal: 0.5,
    tone: { warmth: [0.15, 0.4], space: [0.6, 0.95], wobble: [0, 0.15] },
  },

  postcard: {
    level: 0.4,
    label: 'Postcard',
    weight: 1.7,
    bpm: [46, 66],
    stepsPerBar: [[16, 3], [12, 1]],
    bars: [[4, 3], [8, 3], [2, 1]],
    swing: [0, 0.05],
    scales: [
      ['majorPent', 3], ['kumoi', 2.5], ['yo', 2], ['ritusen', 1.8],
      ['lydian', 2], ['ionian', 2], ['minorPent', 1.5], ['dorian', 1],
      ['akebono', 1.2],
    ],
    drums: 0,
    hatDensity: [0, 0],
    chordVoices: [['rhodes', 5], ['pad', 2]],
    melodyVoices: [['rhodes', 4], ['sine', 2], ['musicbox', 1.5]],
    bassStyles: [['sparse', 4], ['held', 3]],
    bassVoices: [['round', 3], ['rhodesbass', 2.5], ['fifths', 2]],
    mood: [0.5, 1],
    restBar: 0.4,
    chordSize: [[3, 3], [4, 2]],
    // The records are close-miked and almost dry. Resist the urge to drown
    // this in reverb; the restraint is the point.
    tone: { warmth: [0.35, 0.6], space: [0.2, 0.45], wobble: [0, 0.2] },
  },

  plantasia: {
    level: 0.5,
    label: 'Plantasia',
    weight: 1.5,
    bpm: [84, 118],
    stepsPerBar: [[16, 3], [12, 2]],
    bars: [[4, 5], [8, 2], [2, 2]],
    swing: [0, 0.16],
    scales: [
      ['ionian', 3], ['lydian', 3], ['mixolydian', 2], ['majorPent', 2],
      ['dorian', 1.5], ['lydianDominant', 1],
    ],
    drums: 0.7,
    hatDensity: [0.2, 0.7],
    chordVoices: [['moogpad', 3], ['keys', 2], ['pad', 2]],
    melodyVoices: [['moog', 5], ['whistle', 3]],
    bassStyles: [['pulse', 4], ['walk', 2], ['dub', 1.5]],
    bassVoices: [['moogbass', 4], ['sub', 2], ['pluckbass', 1.5]],
    mood: [0.6, 1],
    restBar: 0.1,
    chordSize: [[3, 4], [4, 2]],
    glide: 0.55,       // portamento, the Moog giveaway
    tone: { warmth: [0.3, 0.6], space: [0.3, 0.6], wobble: [0.15, 0.5] },
  },

  airports: {
    level: 0.42,
    label: 'Airports',
    weight: 1.3,
    bpm: [40, 58],
    stepsPerBar: [[16, 1]],
    bars: [[4, 1]],
    swing: [0, 0],
    scales: [
      ['lydian', 2.5], ['ionian', 2], ['majorPent', 2], ['kumoi', 1.5],
      ['dorian', 1.5], ['aeolian', 1],
    ],
    drums: 0,
    hatDensity: [0, 0],
    chordVoices: [['pad', 4], ['choir', 3], ['piano', 2]],
    melodyVoices: [['piano', 3], ['choir', 2], ['sine', 2]],
    bassStyles: [['sparse', 5]],
    bassVoices: [['fifths', 3], ['round', 3], ['rhodesbass', 1.5]],
    mood: [0.4, 0.95],
    restBar: 0.5,
    chordSize: [[3, 3], [4, 3]],
    polymeter: true,   // coprime layer cycles that never resynchronise
    tone: { warmth: [0.2, 0.45], space: [0.75, 1], wobble: [0, 0.1] },
  },
};

export const CHARACTER_WEIGHTS = Object.entries(CHARACTERS).map(([k, c]) => [k, c.weight]);

// Cycle lengths in bars for the Eno character. Coprime, so the combination
// only returns to its starting alignment after their product: five layers
// at 3, 4, 5, 7 and 8 bars restate together once every 840 bars, which at
// these tempos is several hours.
export const POLY_CYCLES = [3, 4, 5, 7, 8, 9, 11];


// ---------------------------------------------------------------- blending

const NUM_RANGES = ['bpm', 'swing', 'hatDensity'];
const NUM_SCALARS = ['drums', 'restBar', 'level', 'flatSeven', 'quartal', 'pointillist', 'skipStep', 'glide'];
const WEIGHTED = ['scales', 'stepsPerBar', 'bars', 'chordVoices', 'melodyVoices', 'bassStyles', 'bassVoices', 'chordSize'];

const lerp = (a, b, t) => a + (b - a) * t;

function blendWeighted(a = [], b = [], mix) {
  // Both pools stay available; the mix only changes how likely each is. That
  // is what lets a Hyrule/Airports loop reach for an ocarina or a choir.
  const out = new Map();
  for (const [k, w] of a) out.set(k, (out.get(k) || 0) + w * (1 - mix));
  for (const [k, w] of b) out.set(k, (out.get(k) || 0) + w * mix);
  return [...out].filter(([, w]) => w > 0.001);
}

// A pure function of (a, b, mix), so a spec only has to store two names and a
// number and the blend can be rebuilt identically every time.
export function blendCharacters(keyA, keyB, mix) {
  const a = CHARACTERS[keyA] || CHARACTERS.tape;
  if (!keyB || keyB === keyA) return a;
  const b = CHARACTERS[keyB] || CHARACTERS.tape;

  const out = { label: `${a.label}/${b.label}`, blended: true };
  for (const k of NUM_RANGES) {
    const av = a[k] || [0, 0];
    const bv = b[k] || [0, 0];
    out[k] = [lerp(av[0], bv[0], mix), lerp(av[1], bv[1], mix)];
  }
  for (const k of NUM_SCALARS) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    const v = lerp(av, bv, mix);
    if (v) out[k] = v;
  }
  for (const k of WEIGHTED) out[k] = blendWeighted(a[k], b[k], mix);
  out.tone = {};
  for (const k of ['warmth', 'space', 'wobble']) {
    out.tone[k] = [lerp(a.tone[k][0], b.tone[k][0], mix), lerp(a.tone[k][1], b.tone[k][1], mix)];
  }
  out.mood = [lerp(a.mood[0], b.mood[0], mix), lerp(a.mood[1], b.mood[1], mix)];
  // Polymeter is all or nothing; it goes with whichever side is dominant.
  out.polymeter = mix < 0.5 ? !!a.polymeter : !!b.polymeter;
  out.level = lerp(a.level ?? 1, b.level ?? 1, mix);
  return out;
}
