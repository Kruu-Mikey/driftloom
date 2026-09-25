// Sound profiles.
//
// A profile is a set of constraints -- tempo band, scale pool, instruments,
// density, metre, form -- that move together. On their own they would be ten
// boxes. They are not used that way: every loop draws a *weight* across
// several of them, so the palette is a continuous space rather than ten
// points, and a loop can be mostly one thing with three others colouring it.
//
// Names are deliberately about the sound rather than where it came from.

export const CHARACTERS = {
  // Worn tape. The original voice of the app, and still the commonest draw.
  dust: {
    label: 'Dust',
    weight: 3.0,
    level: 1.05,
    bpm: [61, 88],
    stepsPerBar: [[16, 1]],
    bars: [[4, 7], [2, 2], [8, 3], [16, 1.2]],
    airy: 0.25,
    swing: [0.04, 0.3],
    scales: [
      ['dorian', 3], ['aeolian', 3], ['minorPent', 2], ['majorPent', 1.6],
      ['kumoi', 2], ['ionian', 1.4], ['mixolydian', 1.4], ['lydian', 1.2],
      ['hirajoshi', 1.2], ['insen', 1], ['phrygian', 0.7],
      ['harmonicMinor', 0.6], ['wholeTone', 0.25],
    ],
    drums: 0.9,
    hatDensity: [0.15, 0.85],
    chordVoices: [['keys', 5], ['pad', 3]],
    melodyVoices: [['pluck', 3], ['bell', 2], ['keys', 2], ['saw', 1]],
    bassStyles: [['held', 3], ['pulse', 3], ['dub', 2.5], ['walk', 1.5], ['sparse', 2]],
    bassVoices: [['sub', 3], ['round', 2], ['pluckbass', 2], ['moogbass', 1.5]],
    textures: [['bells', 3], ['swell', 2], ['drops', 2], ['chime', 1.5], ['wind', 0.7], ['none', 2]],
    restBar: 0.22,
    chordSize: [[3, 3], [4, 4], [2, 1]],
    tone: { warmth: [0.35, 0.9], space: [0.25, 0.8], wobble: [0.1, 0.7] },
    feel: { lift: [0.2, 0.8], energy: [0.3, 0.7], warmth: [0.5, 0.95] },
  },

  // Modal folk. Modes sharing a lowered seventh, so bVII-to-I is available
  // and a phrase can end without sounding finished. Harp, ocarina, flute.
  glade: {
    label: 'Glade',
    weight: 2.0,
    level: 0.8,
    bpm: [74, 112],
    stepsPerBar: [[16, 2], [12, 3]],
    bars: [[4, 5], [8, 3], [2, 1], [16, 1.5]],
    airy: 0.35,
    swing: [0, 0.1],
    scales: [
      ['mixolydian', 3.5], ['dorian', 3], ['lydian', 2.5], ['ionian', 2],
      ['aeolian', 1.5], ['majorPent', 1.5], ['phrygianDominant', 1.2],
      ['lydianDominant', 1], ['dorianSharp4', 0.8],
    ],
    drums: 0.72,
    hatDensity: [0.1, 0.5],
    // Fiddle and accordion are item 14b's folk voices, pair one.
    chordVoices: [['harp', 4], ['keys', 2], ['pad', 2], ['accordion', 1.5]],
    melodyVoices: [['ocarina', 4], ['flute', 2.5], ['harp', 2], ['musicbox', 1], ['fiddle', 3], ['accordion', 1]],
    bassStyles: [['held', 3], ['pulse', 2], ['walk', 2], ['sparse', 1]],
    bassVoices: [['pluckbass', 3], ['round', 3], ['sub', 1.5], ['fifths', 1]],
    textures: [['bells', 3], ['chime', 2.5], ['swell', 2], ['drops', 1], ['wind', 0.4], ['none', 1.5]],
    restBar: 0.14,
    chordSize: [[3, 4], [4, 3]],
    flatSeven: 0.45,
    tone: { warmth: [0.2, 0.5], space: [0.45, 0.85], wobble: [0.05, 0.3] },
    feel: { lift: [0.45, 1], energy: [0.45, 0.85], warmth: [0.35, 0.75] },
  },

  // Cold and spacious. Sparse piano, long silence, lines that leap octaves,
  // quartal chords, and loops that drop a step so you lose count.
  thaw: {
    label: 'Thaw',
    weight: 1.8,
    level: 0.68,
    bpm: [50, 72],
    stepsPerBar: [[16, 3], [12, 1], [20, 1]],
    bars: [[4, 2.5], [8, 3], [6, 1], [3, 1], [16, 3], [24, 1.5]],
    airy: 0.75,
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
    textures: [['swell', 3], ['chime', 2.5], ['bells', 2.5], ['drops', 1.2], ['wind', 1], ['none', 2]],
    restBar: 0.45,
    chordSize: [[3, 2], [4, 3]],
    pointillist: 0.5,
    skipStep: 0.35,
    quartal: 0.5,
    tone: { warmth: [0.15, 0.4], space: [0.6, 0.95], wobble: [0, 0.15] },
    feel: { lift: [0.3, 0.85], energy: [0.05, 0.35], warmth: [0.15, 0.5] },
  },

  // Still and domestic. Rhodes and a hushed pad, no percussion, very slow,
  // Japanese pentatonics. Deliberately dry.
  haven: {
    label: 'Haven',
    weight: 1.6,
    level: 0.78,
    bpm: [46, 66],
    stepsPerBar: [[16, 3], [12, 1]],
    bars: [[4, 2.5], [8, 3], [2, 1], [16, 2.5], [24, 1.2]],
    airy: 0.7,
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
    textures: [['swell', 3], ['chime', 2.5], ['bells', 2], ['drops', 0.8], ['wind', 0.8], ['none', 2]],
    restBar: 0.4,
    chordSize: [[3, 3], [4, 2]],
    tone: { warmth: [0.35, 0.6], space: [0.2, 0.45], wobble: [0, 0.2] },
    feel: { lift: [0.45, 1], energy: [0.05, 0.4], warmth: [0.5, 0.85] },
  },

  // Bright and mechanical. Monophonic lead with portamento through a
  // resonant filter. Quick, major, slightly silly.
  bloom: {
    label: 'Bloom',
    weight: 1.5,
    level: 0.62,
    bpm: [84, 118],
    stepsPerBar: [[16, 3], [12, 2]],
    bars: [[4, 5], [8, 2], [2, 2], [16, 1]],
    airy: 0.15,
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
    textures: [['bells', 2], ['drops', 2], ['chime', 1.5], ['swell', 1.5], ['wind', 0.3], ['none', 2]],
    restBar: 0.1,
    chordSize: [[3, 4], [4, 2]],
    glide: 0.55,
    tone: { warmth: [0.3, 0.6], space: [0.3, 0.6], wobble: [0.15, 0.5] },
    feel: { lift: [0.6, 1], energy: [0.55, 0.95], warmth: [0.4, 0.8] },
  },

  // Drifting. Layer cycles of coprime lengths that never resynchronise.
  vapor: {
    label: 'Vapor',
    weight: 1.3,
    level: 0.64,
    bpm: [40, 58],
    stepsPerBar: [[16, 1]],
    bars: [[4, 1], [8, 2], [16, 2.5], [32, 1.5]],
    airy: 0.8,
    swing: [0, 0],
    scales: [
      ['lydian', 2.5], ['ionian', 2], ['majorPent', 2], ['kumoi', 1.5],
      ['dorian', 1.5], ['aeolian', 1],
    ],
    drums: 0,
    hatDensity: [0, 0],
    chordVoices: [['pad', 4], ['softpad', 3], ['piano', 2]],
    melodyVoices: [['piano', 3], ['softpad', 2], ['sine', 2]],
    bassStyles: [['sparse', 5]],
    bassVoices: [['fifths', 3], ['round', 3], ['rhodesbass', 1.5]],
    textures: [['swell', 4], ['chime', 2], ['bells', 1.5], ['wind', 1], ['drops', 0.5], ['none', 1.5]],
    restBar: 0.5,
    chordSize: [[3, 3], [4, 3]],
    polymeter: true,
    tone: { warmth: [0.2, 0.45], space: [0.75, 1], wobble: [0, 0.1] },
    feel: { lift: [0.35, 0.9], energy: [0, 0.25], warmth: [0.25, 0.6] },
  },

  // Warm analogue nostalgia. Fat detuned pads, a soft breakbeat, long dub
  // delays, simple diatonic melodies sitting well back in the mix.
  halcyon: {
    label: 'Halcyon',
    weight: 1.7,
    level: 0.72,
    bpm: [96, 132],
    stepsPerBar: [[16, 1]],
    bars: [[4, 4], [8, 4], [16, 2]],
    airy: 0.3,
    swing: [0, 0.12],
    scales: [
      ['aeolian', 3], ['dorian', 2.5], ['ionian', 2], ['minorPent', 2],
      ['lydian', 1.5], ['mixolydian', 1.5], ['harmonicMinor', 0.7],
    ],
    drums: 0.75,
    hatDensity: [0.3, 0.8],
    chordVoices: [['analogpad', 5], ['pad', 2], ['keys', 1.5]],
    melodyVoices: [['analoglead', 3], ['sine', 2], ['bell', 1.5], ['keys', 1.5]],
    bassStyles: [['pulse', 3], ['held', 2.5], ['dub', 2]],
    bassVoices: [['round', 3], ['sub', 2.5], ['moogbass', 1.5]],
    textures: [['swell', 3], ['chime', 2], ['bells', 1.5], ['drops', 1], ['none', 2]],
    restBar: 0.2,
    chordSize: [[4, 4], [3, 3]],
    dubEcho: 0.5,
    tone: { warmth: [0.5, 0.85], space: [0.5, 0.85], wobble: [0.2, 0.55] },
    feel: { lift: [0.25, 0.7], energy: [0.4, 0.8], warmth: [0.55, 1] },
  },

  // Prepared piano. Felt-damped, slightly detuned, faintly mechanical.
  // No percussion; the instrument's own knocks are the percussion.
  clockwork: {
    label: 'Clockwork',
    weight: 1.5,
    level: 0.88,
    bpm: [54, 84],
    stepsPerBar: [[16, 3], [12, 2]],
    bars: [[4, 3], [8, 3], [16, 1.5], [2, 1]],
    airy: 0.35,
    swing: [0, 0.14],
    scales: [
      ['aeolian', 3], ['ionian', 2.5], ['dorian', 2], ['harmonicMinor', 1.5],
      ['lydian', 1.5], ['majorPent', 1.2], ['phrygian', 0.8],
    ],
    drums: 0.1,
    hatDensity: [0.05, 0.25],
    chordVoices: [['prepared', 5], ['musicbox', 1.5]],
    melodyVoices: [['prepared', 4], ['musicbox', 2.5], ['celeste', 2]],
    bassStyles: [['held', 3], ['sparse', 2.5], ['walk', 1.5]],
    bassVoices: [['pluckbass', 3], ['round', 2.5], ['rhodesbass', 1.5]],
    textures: [['chime', 3], ['bells', 2], ['drops', 1.5], ['swell', 1], ['none', 2.5]],
    restBar: 0.24,
    chordSize: [[3, 3], [4, 3]],
    tone: { warmth: [0.3, 0.6], space: [0.35, 0.7], wobble: [0.1, 0.4] },
    feel: { lift: [0.2, 0.75], energy: [0.2, 0.6], warmth: [0.3, 0.7] },
  },

  // Fast and fractured. Chopped breaks, stutter rolls, chromatic turns.
  // The loudest thing here, and rare enough to stay a surprise.
  shatter: {
    label: 'Shatter',
    weight: 0.9,
    level: 0.72,
    bpm: [140, 178],
    stepsPerBar: [[16, 3], [12, 1]],
    bars: [[2, 3], [4, 4], [8, 1.5]],
    airy: 0.1,
    swing: [0, 0.08],
    scales: [
      ['harmonicMinor', 2.5], ['phrygian', 2], ['aeolian', 2],
      ['hirajoshi', 1.5], ['wholeTone', 1.2], ['phrygianDominant', 1.5],
      ['dorian', 1.2],
    ],
    drums: 1,
    hatDensity: [0.5, 1],
    chordVoices: [['prepared', 3], ['keys', 2], ['pad', 1.5]],
    melodyVoices: [['musicbox', 2.5], ['prepared', 2], ['pluck', 2], ['saw', 1.5]],
    bassStyles: [['pulse', 3], ['dub', 2.5], ['held', 1.5]],
    bassVoices: [['sub', 3], ['moogbass', 2.5], ['pluckbass', 1.5]],
    textures: [['drops', 3], ['chime', 1.5], ['bells', 1], ['none', 2]],
    restBar: 0.12,
    chordSize: [[3, 3], [4, 2]],
    rolls: 0.6,
    tone: { warmth: [0.25, 0.6], space: [0.2, 0.5], wobble: [0.05, 0.3] },
    feel: { lift: [0.15, 0.7], energy: [0.75, 1], warmth: [0.25, 0.6] },
  },

  // Wooden mallets. Kalimba tines and marimba bars: dry, pitched percussion,
  // which nothing else here provides. Bright, unhurried, a bit handmade.
  grove: {
    level: 0.72,
    label: 'Grove',
    weight: 1.6,
    bpm: [68, 104],
    stepsPerBar: [[16, 3], [12, 2]],
    bars: [[4, 4], [8, 3], [2, 1], [16, 1]],
    airy: 0.3,
    swing: [0, 0.18],
    scales: [
      ['majorPent', 3], ['ionian', 2.5], ['lydian', 2], ['mixolydian', 2],
      ['yo', 2], ['ritusen', 1.5], ['dorian', 1.5], ['kumoi', 1.2],
    ],
    drums: 0.5,
    hatDensity: [0.1, 0.5],
    chordVoices: [['kalimba', 3], ['marimba', 2.5], ['harp', 2], ['pad', 1.5]],
    melodyVoices: [['kalimba', 4], ['marimba', 3], ['musicbox', 1.5], ['whistle', 1.5]],
    bassStyles: [['pulse', 3], ['held', 2.5], ['sparse', 2]],
    bassVoices: [['pluckbass', 3], ['round', 3], ['sub', 1.5]],
    textures: [['chime', 3], ['bells', 2.5], ['drops', 1.5], ['swell', 1.5], ['none', 2]],
    restBar: 0.18,
    chordSize: [[3, 4], [4, 2]],
    tone: { warmth: [0.4, 0.75], space: [0.35, 0.7], wobble: [0.05, 0.35] },
    feel: { lift: [0.5, 1], energy: [0.35, 0.8], warmth: [0.45, 0.85] },
  },

  // Voices. Synthetic vowels and humming rather than words: a wordless
  // voice never sounds dated or foreign, and words would make a loop be
  // *about* something, which is the opposite of what this is for.
  hollow: {
    level: 0.62,
    label: 'Hollow',
    weight: 1.4,
    bpm: [46, 74],
    stepsPerBar: [[16, 3], [12, 1]],
    bars: [[4, 2], [8, 3], [16, 2.5], [24, 1]],
    airy: 0.65,
    swing: [0, 0.06],
    scales: [
      ['aeolian', 2.5], ['dorian', 2.5], ['lydian', 2], ['ionian', 2],
      ['kumoi', 1.5], ['majorPent', 1.5], ['minorPent', 1.2],
    ],
    drums: 0.12,
    hatDensity: [0.05, 0.3],
    chordVoices: [['vowel', 3], ['hum', 3], ['choir', 2.5], ['pad', 2]],
    melodyVoices: [['vowel', 4], ['hum', 3], ['choir', 2], ['sine', 1.5]],
    bassStyles: [['sparse', 4], ['held', 3]],
    bassVoices: [['round', 3], ['fifths', 3], ['rhodesbass', 1.5]],
    textures: [['swell', 3], ['chime', 2], ['bells', 1.5], ['none', 2]],
    restBar: 0.38,
    chordSize: [[3, 3], [4, 2]],
    tone: { warmth: [0.35, 0.7], space: [0.6, 0.95], wobble: [0.05, 0.3] },
    feel: { lift: [0.3, 0.9], energy: [0.05, 0.45], warmth: [0.4, 0.8] },
  },

  // Struck metal left to ring. Temple bowls and church bells, long decays,
  // a lot of space between strikes. Slow enough that a single bell is an
  // event rather than a note.
  shrine: {
    level: 0.66,
    label: 'Shrine',
    weight: 1.4,
    bpm: [42, 70],
    stepsPerBar: [[16, 3], [12, 1]],
    bars: [[4, 2], [8, 3], [16, 2.5], [24, 1]],
    airy: 0.34,
    swing: [0, 0.05],
    scales: [
      ['kumoi', 2.5], ['hirajoshi', 2], ['insen', 2], ['minorPent', 2],
      ['aeolian', 2], ['dorian', 1.5], ['majorPent', 1.5], ['akebono', 1.5],
    ],
    drums: 0.1,
    hatDensity: [0.02, 0.2],
    chordVoices: [['templebell', 3], ['tubular', 2.5], ['pad', 2], ['softpad', 1.5]],
    melodyVoices: [['templebell', 3.5], ['tubular', 3], ['kalimba', 1.5], ['sine', 1.5]],
    bassStyles: [['sparse', 5], ['held', 2]],
    bassVoices: [['fifths', 3], ['round', 2.5], ['sub', 1.5]],
    textures: [['chime', 3], ['swell', 2.5], ['bells', 2], ['none', 2]],
    restBar: 0.4,
    chordSize: [[2, 3], [3, 3]],
    tone: { warmth: [0.25, 0.55], space: [0.7, 1], wobble: [0, 0.2] },
    feel: { lift: [0.35, 0.85], energy: [0.02, 0.35], warmth: [0.3, 0.7] },
  },

  // Hypnotic pulse. A steady four, very short looping fragments, and the
  // whole mix breathing against the kick. Change arrives by accumulation.
  undertow: {
    label: 'Undertow',
    weight: 1.6,
    level: 0.72,
    bpm: [112, 128],
    stepsPerBar: [[16, 1]],
    bars: [[8, 3], [16, 3], [4, 2], [32, 1]],
    airy: 0.3,
    swing: [0, 0.06],
    scales: [
      ['aeolian', 3], ['dorian', 3], ['minorPent', 2], ['ionian', 1.5],
      ['mixolydian', 1.5], ['majorPent', 1.2],
    ],
    drums: 1,
    hatDensity: [0.45, 0.9],
    chordVoices: [['stab', 4], ['analogpad', 3], ['pad', 2]],
    melodyVoices: [['stab', 3], ['sine', 2], ['analoglead', 2], ['bell', 1.5]],
    bassStyles: [['pulse', 5], ['held', 2]],
    bassVoices: [['round', 3], ['sub', 3], ['moogbass', 1.5]],
    textures: [['swell', 3], ['chime', 1.5], ['drops', 1.5], ['none', 2]],
    restBar: 0.15,
    chordSize: [[3, 3], [4, 3]],
    fourFloor: 0.85,
    pump: 0.55,
    microLoop: true,
    tone: { warmth: [0.4, 0.75], space: [0.45, 0.8], wobble: [0.1, 0.4] },
    feel: { lift: [0.25, 0.75], energy: [0.55, 0.9], warmth: [0.4, 0.8] },
  },

  // Sea and island folk: the sailing tunes of Wind Waker and Spirit Tracks.
  // A loop is a gentle, rocking waltz or a lively, dancing jig, now and then
  // a reel. Tempo and metre are drawn together from `gaits`, because a fast
  // waltz or a slow jig is neither; `bpm` and `stepsPerBar` below are only
  // what a blend sees when tide colours another profile's loop.
  tide: {
    label: 'Tide',
    weight: 2.0,
    // Measured, not guessed: at 0.8 the loops tide leads came out 0.25 LU
    // under the catalogue median (measure.mjs --profile tide --n 60 against
    // --n 100). A loop's level is blended across its mix, so this is the
    // profile level that puts their mean on the median.
    level: 0.83,
    bpm: [84, 140],
    stepsPerBar: [[12, 9], [16, 1]],
    gaits: [
      { weight: 5, metre: '3/4', stepsPerBar: 12, bpm: [84, 104] },
      { weight: 4, metre: '6/8', stepsPerBar: 12, bpm: [112, 140] },
      { weight: 1, metre: '4/4', stepsPerBar: 16, bpm: [112, 136] },
    ],
    bars: [[4, 4], [8, 4], [16, 1.5], [2, 0.5]],
    airy: 0.3,
    swing: [0, 0.08],
    scales: [
      ['dorian', 3], ['mixolydian', 3], ['ionian', 2.5], ['aeolian', 2], ['majorPent', 1.5],
    ],
    drums: 0.6,
    // The hand kit: a frame drum and a tambourine playing the kit's part.
    kits: [['brush', 3], ['tape', 2], ['hand', 2]],
    hatDensity: [0.1, 0.45],
    chordVoices: [['harp', 3], ['accordion', 2], ['keys', 1], ['nylon', 2.5]],
    melodyVoices: [['fiddle', 4], ['whistle', 3], ['ocarina', 2], ['accordion', 1.5], ['panflute', 1.5]],
    bassStyles: [['held', 3], ['pulse', 3], ['walk', 1.5], ['sparse', 1]],
    // A third of loops hold the tonic and fifth under the changing chords.
    drone: 1 / 3,
    // Cuts and turns on a quarter of the beat notes long enough to take
    // one, and a harmony in thirds or sixths on the held notes of 40% of
    // loops. Both on the sparing side, for Mikey's ears.
    ornament: 0.25,
    harmonize: 0.4,
    bassVoices: [['round', 3], ['pluckbass', 3], ['fifths', 1.5]],
    textures: [['bells', 2.5], ['chime', 2], ['swell', 2], ['waves', 2], ['none', 2]],
    restBar: 0.14,
    chordSize: [[3, 5], [4, 2]],
    // Scale degrees, as SHAPES_7 in the generator. Only for the seven-note
    // modes; a pentatonic tide loop draws the ordinary pentatonic shapes.
    progressions: [
      [0, 6, 0, 6], // the I-bVII shuttle
      [0, 6, 5, 6], // i-bVII-bVI-bVII
      [0, 3, 0, 4], // I-IV-I-V
      [0, 4, 3, 0], // I-V-IV-I, ending IV-I
      [0, 5, 3, 0], // I-vi-IV-I, ending IV-I
    ],
    tone: { warmth: [0.3, 0.6], space: [0.4, 0.75], wobble: [0.05, 0.25] },
    feel: { lift: [0.45, 1], energy: [0.35, 0.9], warmth: [0.4, 0.8] },
  },

  // Island and volcano: fast, rhythmic and Spanish-tinged, the fire temples
  // and lava islands. A driving 6/8 most of the time, the hand kit leading
  // and a nylon guitar strumming the Andalusian cadence.
  cinder: {
    label: 'Cinder',
    weight: 1.4,
    level: 0.8,
    bpm: [120, 150],
    stepsPerBar: [[12, 8], [16, 2]],
    gaits: [
      { weight: 8, metre: '6/8', stepsPerBar: 12, bpm: [120, 150] },
      { weight: 2, metre: '4/4', stepsPerBar: 16, bpm: [120, 150] },
    ],
    bars: [[4, 4], [8, 4], [16, 1], [2, 0.5]],
    airy: 0.15,
    swing: [0, 0.04],
    scales: [
      ['phrygianDominant', 3], ['harmonicMinor', 2.5], ['aeolian', 2], ['dorian', 1.5],
      ['phrygian', 1.5],
    ],
    drums: 0.95,
    kits: [['hand', 4], ['tape', 1], ['brush', 1]],
    hatDensity: [0.3, 0.7],
    chordVoices: [['nylon', 5], ['marimba', 2], ['accordion', 2]],
    melodyVoices: [
      ['fiddle', 3], ['whistle', 2.5], ['marimba', 2], ['accordion', 2], ['panflute', 2],
    ],
    bassStyles: [['pulse', 3], ['walk', 2]],
    bassVoices: [['pluckbass', 3], ['round', 2]],
    textures: [['none', 4], ['swell', 1], ['drops', 1]],
    restBar: 0.12,
    chordSize: [[3, 4], [4, 1]],
    // Per mode, because the Andalusian cadence -- in A, Am-G-F-E -- ends on
    // a major V, and each mode has its own wrong chord somewhere in it:
    // aeolian's V is minor, harmonic minor's VII is diminished, and so on.
    // Those are spelled out (see stepDegree in the generator), and the
    // melody follows the spelling. The cadence is listed twice so it is the
    // signature, beside one other idiom of the mode. Dorian's raised sixth
    // is the F of the cadence, so dorian keeps its own progressions.
    progressions: {
      aeolian: [
        [0, 6, 5, { d: 4, major: true }], // Am-G-F-E
        [0, 6, 5, { d: 4, major: true }],
        [0, 5, 6, 0], // i-bVI-bVII-i
      ],
      harmonicMinor: [
        [0, { d: 6, flat: true, major: true }, 5, 4], // Am-G-F-E
        [0, { d: 6, flat: true, major: true }, 5, 4],
        [0, 3, 4, 0], // i-iv-V-i
      ],
      phrygian: [
        [3, 2, 1, { d: 0, major: true }], // Am-G-F-E, in E
        [3, 2, 1, { d: 0, major: true }],
        [0, 1, 2, 1], // Em-F-G-F
      ],
      phrygianDominant: [
        [3, { d: 2, flat: true, major: true }, 1, 0], // Am-G-F-E, in E
        [3, { d: 2, flat: true, major: true }, 1, 0],
        [0, 1, 0, 1], // E-F, the flamenco vamp
      ],
      dorian: [
        [0, 3, 0, 3], // i-IV, Am-D
        [0, 6, 3, 0], // i-bVII-IV-i
      ],
    },
    tone: { warmth: [0.35, 0.65], space: [0.25, 0.55], wobble: [0.03, 0.2] },
    feel: { lift: [0.25, 0.75], energy: [0.65, 1], warmth: [0.4, 0.75] },
  },
};

// Saved loops from before the rename still resolve.
export const LEGACY_NAMES = {
  tape: 'dust',
  hyrule: 'glade',
  field: 'thaw',
  postcard: 'haven',
  plantasia: 'bloom',
  airports: 'vapor',
};

export function resolveKey(key) {
  if (CHARACTERS[key]) return key;
  return LEGACY_NAMES[key] || 'dust';
}

export const CHARACTER_WEIGHTS = Object.entries(CHARACTERS).map(([k, c]) => [k, c.weight]);

export const POLY_CYCLES = [3, 4, 5, 7, 8, 9, 11];

// ---------------------------------------------------------------- mixing

const NUM_RANGES = ['bpm', 'swing', 'hatDensity'];
const NUM_SCALARS = [
  'drums', 'restBar', 'level', 'flatSeven', 'quartal', 'pointillist',
  'skipStep', 'glide', 'airy', 'pump', 'rolls', 'fourFloor', 'dubEcho',
];
const WEIGHTED = [
  'scales', 'stepsPerBar', 'bars', 'chordVoices', 'melodyVoices',
  'bassStyles', 'bassVoices', 'chordSize', 'textures',
];
const FEEL_AXES = ['lift', 'energy', 'warmth'];

function normalise(mix) {
  const out = {};
  let total = 0;
  for (const [k, w] of Object.entries(mix)) {
    if (w > 0) total += w;
  }
  if (!total) return { dust: 1 };
  for (const [k, w] of Object.entries(mix)) {
    if (w > 0) out[resolveKey(k)] = (out[resolveKey(k)] || 0) + w / total;
  }
  return out;
}

// Combine any number of profiles by weight. Pure, so a spec only stores the
// weights and the blend rebuilds identically every time.
export function blendMix(mix) {
  const w = normalise(mix);
  const keys = Object.keys(w);
  if (keys.length === 1) return CHARACTERS[keys[0]];

  const out = { blended: true };
  out.label = keys
    .slice()
    .sort((a, b) => w[b] - w[a])
    .map((k) => CHARACTERS[k].label)
    .join('/');

  // Numbers blend with the dominant profile weighted far more heavily than
  // its share suggests.
  //
  // A plain weighted average is what a mix "should" be, and it was quietly
  // destroying the thing profiles exist for. Averaging four tempo bands
  // lands near the middle every time: measured, single-profile loops had a
  // tempo spread of sd 29.7 while three- and four-profile loops had 20.5.
  // Since most loops blend, most loops were being pulled toward a middling
  // tempo, middling energy and middling density -- audible as everything
  // sounding like a lullaby. Raising the weights to a power before
  // normalising keeps a mostly-Shatter loop actually fast while still
  // letting the other profiles colour it.
  const sharp = {};
  let sharpTotal = 0;
  for (const key of keys) {
    sharp[key] = Math.pow(w[key], 2.2);
    sharpTotal += sharp[key];
  }
  for (const key of keys) sharp[key] /= sharpTotal;

  for (const k of NUM_RANGES) {
    let lo = 0;
    let hi = 0;
    for (const key of keys) {
      const v = CHARACTERS[key][k] || [0, 0];
      lo += v[0] * sharp[key];
      hi += v[1] * sharp[key];
    }
    out[k] = [lo, hi];
  }

  for (const k of NUM_SCALARS) {
    let v = 0;
    for (const key of keys) v += (CHARACTERS[key][k] ?? 0) * sharp[key];
    if (v) out[k] = v;
  }

  // Pools are unioned, not replaced, so a mostly-Dust loop with a little
  // Glade in it can still reach for an ocarina.
  for (const k of WEIGHTED) {
    const acc = new Map();
    for (const key of keys) {
      for (const [name, weight] of CHARACTERS[key][k] || []) {
        acc.set(name, (acc.get(name) || 0) + weight * w[key]);
      }
    }
    out[k] = [...acc].filter(([, v]) => v > 0.001);
  }

  out.tone = {};
  for (const k of ['warmth', 'space', 'wobble']) {
    let lo = 0;
    let hi = 0;
    for (const key of keys) {
      lo += CHARACTERS[key].tone[k][0] * w[key];
      hi += CHARACTERS[key].tone[k][1] * w[key];
    }
    out.tone[k] = [lo, hi];
  }

  out.feel = {};
  for (const axis of FEEL_AXES) {
    let lo = 0;
    let hi = 0;
    for (const key of keys) {
      const range = CHARACTERS[key].feel[axis];
      lo += range[0] * sharp[key];
      hi += range[1] * sharp[key];
    }
    out.feel[axis] = [lo, hi];
  }

  // All-or-nothing traits go to whichever profile dominates.
  const lead = keys.reduce((a, b) => (w[a] >= w[b] ? a : b));
  out.polymeter = !!CHARACTERS[lead].polymeter;
  out.microLoop = !!CHARACTERS[lead].microLoop;
  // So are the things a profile brings of its own: how tempo and metre go
  // together, which kits it plays, its progressions, the drone, ornaments
  // and the harmony line. A loop that tide merely colours does not start
  // waltzing.
  for (const k of ['gaits', 'kits', 'progressions', 'drone', 'ornament', 'harmonize']) {
    if (CHARACTERS[lead][k] !== undefined) out[k] = CHARACTERS[lead][k];
  }
  return out;
}
