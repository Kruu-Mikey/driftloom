// The mood vocabulary, in one place (queue item 16).
//
// Everything that names a mood reads it from here: the generator's regions
// of the feeling space, the numbers a share code writes and the words the
// readout shows. Adding, renaming or merging a mood is an edit to this file
// and nothing else.
//
// Each mood has:
//   code  -- its number in a share code. Frozen: a code written down last
//            month says 1 for happy forever, so a number is never reused
//            or reassigned. A new mood takes the next free one; a renamed
//            mood keeps its own.
//   word  -- what the readout shows. Renaming a mood for listeners is a
//            change here and nowhere else.
//   lift, energy, warmth -- the region of the feeling space it names.
//
// Both wings of the axis are wholesome: the bright, quickened side and the
// settled, comforted side, plus two inward ones. Nothing here is a sad end.
export const MOODS = {
  joyful: { code: 0, word: 'joyful', lift: 0.92, energy: 0.72, warmth: 0.72 },
  happy: { code: 1, word: 'happy', lift: 0.82, energy: 0.52, warmth: 0.78 },
  enthusiastic: { code: 2, word: 'enthusiastic', lift: 0.88, energy: 0.9, warmth: 0.66 },
  refreshing: { code: 3, word: 'refreshing', lift: 0.72, energy: 0.62, warmth: 0.42 },
  soothing: { code: 4, word: 'soothing', lift: 0.62, energy: 0.18, warmth: 0.82 },
  peaceful: { code: 5, word: 'peaceful', lift: 0.58, energy: 0.28, warmth: 0.6 },
  comforting: { code: 6, word: 'comforting', lift: 0.54, energy: 0.36, warmth: 0.86 },
  reflective: { code: 7, word: 'reflective', lift: 0.3, energy: 0.22, warmth: 0.46 },
};

// Codes of moods that have been merged away, and the mood each now reads
// as, so share codes written before the merge still open. Empty until a
// merge happens.
const FORMER_CODES = {};

// What a share code's mood number reads as. An unknown number is a code
// from a newer build than this one; peaceful is the neutral guess.
export function moodForCode(code) {
  for (const [key, m] of Object.entries(MOODS)) if (m.code === code) return key;
  return FORMER_CODES[code] || 'peaceful';
}

export function codeForMood(key) {
  return MOODS[key] ? MOODS[key].code : -1;
}

export function moodWord(key) {
  return MOODS[key] ? MOODS[key].word : key;
}

// A word for a feeling saved as a single point, before feelings became
// mixtures. Rows by energy, from the top; each row is its word for low,
// middle and high lift. 'restless' has never been one of the moods above:
// only these old saves can show it.
const POINT_LIFT = [0.38, 0.66];
const POINT_WORDS = [
  [0.68, ['restless', 'refreshing', 'enthusiastic']],
  [0.36, ['reflective', 'comforting', 'happy']],
  [-Infinity, ['reflective', 'peaceful', 'joyful']],
];

export function pointWord({ lift, energy }) {
  const column = POINT_LIFT.filter((t) => lift > t).length;
  const [, words] = POINT_WORDS.find(([floor]) => energy > floor) || POINT_WORDS[POINT_WORDS.length - 1];
  return moodWord(words[column]);
}
