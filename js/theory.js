// Pitch and scale maths. Everything is in MIDI note numbers until the
// very last moment, which keeps generation, display and MIDI export
// speaking the same language.

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const SCALES = {
  dorian: { steps: [0, 2, 3, 5, 7, 9, 10], label: 'Dorian' },
  aeolian: { steps: [0, 2, 3, 5, 7, 8, 10], label: 'Aeolian' },
  ionian: { steps: [0, 2, 4, 5, 7, 9, 11], label: 'Ionian' },
  mixolydian: { steps: [0, 2, 4, 5, 7, 9, 10], label: 'Mixolydian' },
  lydian: { steps: [0, 2, 4, 6, 7, 9, 11], label: 'Lydian' },
  phrygian: { steps: [0, 1, 3, 5, 7, 8, 10], label: 'Phrygian' },
  harmonicMinor: { steps: [0, 2, 3, 5, 7, 8, 11], label: 'Harmonic minor' },
  minorPent: { steps: [0, 3, 5, 7, 10], label: 'Minor pentatonic' },
  majorPent: { steps: [0, 2, 4, 7, 9], label: 'Major pentatonic' },
  kumoi: { steps: [0, 2, 3, 7, 9], label: 'Kumoi' },
  hirajoshi: { steps: [0, 2, 3, 7, 8], label: 'Hirajoshi' },
  insen: { steps: [0, 1, 5, 7, 10], label: 'Insen' },
  wholeTone: { steps: [0, 2, 4, 6, 8, 10], label: 'Whole tone' },

  // Kondo leans on modes that share a lowered seventh, which is what makes
  // the bVII-to-I move available and why Hyrule never sounds like it has
  // cadenced properly.
  lydianDominant: { steps: [0, 2, 4, 6, 7, 9, 10], label: 'Lydian dominant' },
  phrygianDominant: { steps: [0, 1, 4, 5, 7, 8, 10], label: 'Phrygian dominant' },
  dorianSharp4: { steps: [0, 2, 3, 6, 7, 9, 10], label: 'Dorian #4' },

  // Further Japanese pentatonics, for the Yoshimura and Hisaishi colours.
  yo: { steps: [0, 2, 5, 7, 9], label: 'Yo' },
  ritusen: { steps: [0, 2, 5, 7, 10], label: 'Ritusen' },
  akebono: { steps: [0, 2, 3, 7, 9], label: 'Akebono' },
};

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function noteLabel(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// Degree can run past the end of the scale or go negative; it wraps into
// octaves, so degree 7 in a 7-note scale is the root an octave up.
export function scalePitch(root, steps, degree, octave = 0) {
  const n = steps.length;
  const oct = Math.floor(degree / n) + octave;
  const idx = ((degree % n) + n) % n;
  return root + steps[idx] + 12 * oct;
}

// Stacks alternating scale degrees. In a seven-note scale that gives you
// triads and sevenths. In a pentatonic it gives you open, quartal-ish
// stacks, which is exactly the sound we want for the ambient modes.
export function buildChord(root, steps, degree, size = 3, octave = 0) {
  const notes = [];
  for (let i = 0; i < size; i++) {
    notes.push(scalePitch(root, steps, degree + i * 2, octave));
  }
  return notes;
}

// Nudge a set of notes into a comfortable register without changing the
// chord. Keeps voicings from wandering into mud or into whistle range.
export function voiceInRange(notes, low, high) {
  return notes.map((n) => {
    let m = n;
    while (m < low) m += 12;
    while (m > high) m -= 12;
    return m;
  });
}

export function nearestChordTone(midi, chordNotes) {
  let best = chordNotes[0];
  let bestDist = Infinity;
  for (const c of chordNotes) {
    for (let oct = -2; oct <= 2; oct++) {
      const cand = c + oct * 12;
      const d = Math.abs(cand - midi);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
  }
  return best;
}
