// The word-ranking test's answers, summed up (queue item 19).
//
// Run with:  node tools/ranks.mjs <file.jsonl>
//
// The file is what rank.html's Export downloads: one trial a line, with the
// words in the order they were shown and the ones tapped, most like the
// loop first. Untapped words mean "doesn't fit".
//
// Per word: how often it was shown, tapped first, tapped at all and never
// tapped, and its mean place when tapped. Counted over answered trials
// that are not repeats; skips are counted apart, and a repeat is there only
// to be compared with its original, below, so it would count one loop
// twice.
//
// Repeats: about one trial in twenty replays an earlier loop with the same
// words reshuffled. For each pair where both were answered: the same first
// word (or none tapped both times), the same words tapped, the same order,
// and word by word, the share of the five that got the same fits / doesn't
// fit answer.

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/ranks.mjs <file.jsonl>');
  process.exit(2);
}

const trials = [];
fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
  if (!line.trim()) return;
  try {
    trials.push(JSON.parse(line));
  } catch {
    console.error(`line ${i + 1} is not JSON, left out`);
  }
});

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');

const skips = trials.filter((t) => t.skip);
const repeats = trials.filter((t) => t.repeatOf);
const answered = trials.filter((t) => !t.skip && !t.repeatOf);
const builds = [...new Set(trials.map((t) => t.build))];
const seconds = trials.filter((t) => !t.skip).map((t) => t.seconds).sort((a, b) => a - b);

console.log(`${trials.length} trials: ${answered.length} answered, ${skips.length} skipped, `
  + `${repeats.length} repeats; builds ${builds.join(', ') || '-'}`);
if (seconds.length) {
  console.log(`median ${seconds[Math.floor(seconds.length / 2)]} s from start to Next`);
}
const none = answered.filter((t) => !t.taps.length).length;
console.log(`nothing tapped on ${none} of ${answered.length} (${pct(none, answered.length)})`);

// ------------------------------------------------------------------ words

const words = new Map();
const row = (w) => {
  if (!words.has(w)) words.set(w, { shown: 0, first: 0, tapped: 0, places: 0 });
  return words.get(w);
};
for (const t of answered) {
  for (const w of t.words) row(w).shown++;
  t.taps.forEach((w, i) => {
    const r = row(w);
    r.tapped++;
    r.places += i + 1;
    if (i === 0) r.first++;
  });
}

const W = 12;
const C = 9;
console.log('\n' + 'word'.padEnd(W) + ['shown', 'first', 'tapped', 'never', 'place'].map((h) => h.padStart(C)).join(''));
const order = [...words.entries()].sort((a, b) => b[1].tapped / b[1].shown - a[1].tapped / a[1].shown
  || b[1].first / b[1].shown - a[1].first / a[1].shown || a[0].localeCompare(b[0]));
for (const [w, r] of order) {
  const cells = [
    r.shown,
    `${r.first} ${pct(r.first, r.shown)}`,
    `${r.tapped} ${pct(r.tapped, r.shown)}`,
    `${r.shown - r.tapped} ${pct(r.shown - r.tapped, r.shown)}`,
    r.tapped ? (r.places / r.tapped).toFixed(1) : '-',
  ];
  console.log(w.padEnd(W) + cells.map((c) => String(c).padStart(C)).join(''));
}
console.log('(place: mean position when tapped, 1 = most like the loop)');

// ------------------------------------------------------------------ repeats

const byTrial = new Map(trials.map((t) => [t.trial, t]));
const pairs = repeats
  .map((t) => [byTrial.get(t.repeatOf), t])
  .filter(([a, b]) => a && !a.skip && !b.skip);

console.log(`\nrepeats: ${pairs.length} answered pairs`
  + (repeats.length > pairs.length ? ` (${repeats.length - pairs.length} left out: a skip or a missing original)` : ''));
if (pairs.length) {
  let first = 0, set = 0, same = 0, fit = 0, fitOf = 0, rebuilt = 0;
  for (const [a, b] of pairs) {
    if ((a.taps[0] ?? null) === (b.taps[0] ?? null)) first++;
    const sa = new Set(a.taps);
    const sb = new Set(b.taps);
    if (sa.size === sb.size && [...sa].every((w) => sb.has(w))) set++;
    if (a.taps.join() === b.taps.join()) same++;
    for (const w of a.words) {
      fitOf++;
      if (sa.has(w) === sb.has(w)) fit++;
    }
    if (a.code !== b.code) rebuilt++;
    console.log(`  #${a.trial} ${a.taps.join(' > ') || '(none)'}  |  #${b.trial} ${b.taps.join(' > ') || '(none)'}`);
  }
  console.log(`same first word   ${first}/${pairs.length} ${pct(first, pairs.length)}`);
  console.log(`same words tapped ${set}/${pairs.length} ${pct(set, pairs.length)}`);
  console.log(`same order        ${same}/${pairs.length} ${pct(same, pairs.length)}`);
  console.log(`word fits agree   ${fit}/${fitOf} ${pct(fit, fitOf)}`);
  if (rebuilt) console.log(`(${rebuilt} replayed under a build whose code came out different: not quite the same loop)`);
}
