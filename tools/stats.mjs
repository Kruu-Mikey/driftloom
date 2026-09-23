// Corpus statistics for the generator.
//
// Run with:  node tools/stats.mjs [--n 2000] [--seed 1] [--lift-low] [--lift-high]
//
// Roadmap item 1 asks for the measurement harnesses to stop living in
// throwaway scripts. This is the generation half of that: it draws a corpus
// of loops the same way the app does -- newSpec() then render() -- and
// reports what actually came out. The audio half (peak, RMS, ring time,
// per-voice cost) is a separate tool and needs a different kind of harness.
//
// Everything is counted on the rendered pattern, after entry schedules and
// gaps have zeroed the notes they silence, so the figures describe what you
// would hear rather than what was generated and then thrown away.
//
// The corpus is deterministic: the same --seed and --n give the same
// numbers, which is what makes a before-and-after comparison mean anything.
// Pass a different --seed for an independent corpus.

import fs from 'node:fs';
import path from 'node:path';
import { newSpec, render, choirOf, STEPS_PER_BAR } from '../js/generator.js';
import { Rng } from '../js/rng.js';
import { SCALES } from '../js/theory.js';
import { encodeSong } from '../js/share.js';

// ------------------------------------------------------------ arguments

const BASELINE_DEFAULT = 'test/stats-baseline.json';
// How the tolerances are set. Sampling noise, not taste.
//
// The noise that matters is seed to seed: a generator change that draws one
// more random number re-rolls every loop, so --check then compares two
// independent corpora, and their difference has the root of two times the
// spread of either. The tolerance is three times that, estimated from twenty
// corpora the size of the locked one.
//
// Twenty and not five because five was measured and does not work. Its
// standard deviations came out well short of the real ones -- the collision
// share's at 0.0025 against a binomial 0.0067 -- and a lock built on them
// failed 19 of 20 corpora that differed from the baseline by nothing but
// the seed. A lock that cries wolf on every re-roll is one nobody reads.
const TOLERANCE_SEEDS = 20;
const TOLERANCE_SIGMA = 3;
// Salts the stream the tolerance corpora are drawn from, so they never
// include the baseline's own seed's corpus.
const TOLERANCE_SALT = 0x10c4b1a5;

const USAGE = `
driftloom generation statistics

  node tools/stats.mjs [options]

  --n <count>         how many loops to draw            (default 2000)
  --seed <number>     corpus seed; same seed, same loops   (default 1)
  --lift-low [value]  upper bound of the low-lift bucket   (default 0.6)
  --lift-high [value] lower bound of the high-lift bucket (default 0.78)
  --choir-quiz [file] print a listening test instead of the report
  --voice-codes <v>   print share codes whose melody draws voice <v>
  --write-baseline [file]  write the balance lock      (default ${BASELINE_DEFAULT})
  --check [file]      rerun the locked corpus against it; non-zero exit on a miss
  --help              this

  --choir-quiz prints twenty share codes in shuffled order, five of which
  are choir loops, and writes the answer key to a file (default
  choir-quiz-key.txt) so it is not on the screen you are reading. Paste the
  codes in one at a time and write down which five you think are the
  choirs. That is roadmap item 12's real acceptance test and it is not a
  number this tool can produce on its own.

  Giving either --lift-low or --lift-high splits the corpus by feel.lift
  and prints the two buckets side by side; the other bound takes its
  default. Loops between the two bounds are in neither column. The
  defaults are roughly the lower and upper quartiles of feel.lift, which
  is skewed high, so a bound picked by eye puts almost nothing in the
  low column.

  --voice-codes exists because a change to one voice is otherwise hard to
  hear: the three wind voices together are 12.4% of melody draws, so
  rolling the dice in the app until one turns up is a poor use of an
  evening. Give it a voice name and it prints codes to paste straight in.

  --write-baseline and --check are the balance lock. The baseline records
  the melodic character of a corpus -- how often a loop has a melody,
  what the line does, how its motifs survive, how rare the choir is, how
  often keys and melody collide -- with a tolerance on every figure taken
  from sampling noise: ${TOLERANCE_SIGMA}x its seed-to-seed standard deviation, the
  spread of the difference between two corpora of the same size, measured
  over ${TOLERANCE_SEEDS} further corpora. --check redraws the recorded
  corpus (its --n and --seed, not the command line's) and prints every
  figure against the baseline, exiting 1 if any is outside its tolerance.
  Profile, metre and voice shares are printed beside them but not locked,
  because new profiles move those on purpose. A miss is a decision, not a
  verdict: either the change is wrong, or the balance has moved on purpose
  and the baseline is rewritten, which the pull request says out loud.
`;

const LIFT_LOW_DEFAULT = 0.6;
const LIFT_HIGH_DEFAULT = 0.78;

function parseArgs(argv) {
  const opts = {
    n: 2000, seed: 1, liftLow: null, liftHigh: null, bucketed: false, quiz: null, voiceCodes: null,
    writeBaseline: null, check: null,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline = null;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    // A flag whose value is optional takes the next token only when that
    // token is a number, so `--lift-low --lift-high` means both defaults.
    const value = (optional) => {
      if (inline != null) return Number(inline);
      const next = argv[i + 1];
      if (next != null && next !== '' && Number.isFinite(Number(next))) {
        i++;
        return Number(next);
      }
      if (optional) return null;
      fail(`${arg} needs a number`);
      return null;
    };

    // The same, for a flag whose optional value is a path rather than a
    // number: take the next token unless it is another flag.
    const text = (fallback) => {
      if (inline != null) return inline;
      const next = argv[i + 1];
      if (next != null && next !== '' && !next.startsWith('--')) {
        i++;
        return next;
      }
      return fallback;
    };

    switch (arg) {
      case '--n': case '-n':
        opts.n = Math.max(1, Math.round(value(false)));
        break;
      case '--seed':
        opts.seed = value(false) >>> 0;
        break;
      case '--lift-low':
        opts.liftLow = value(true);
        opts.bucketed = true;
        break;
      case '--lift-high':
        opts.liftHigh = value(true);
        opts.bucketed = true;
        break;
      case '--choir-quiz':
        opts.quiz = text('choir-quiz-key.txt');
        break;
      case '--voice-codes':
        opts.voiceCodes = text(null);
        if (!opts.voiceCodes) fail('--voice-codes needs a voice name');
        break;
      case '--write-baseline':
        opts.writeBaseline = text(BASELINE_DEFAULT);
        break;
      case '--check':
        opts.check = text(BASELINE_DEFAULT);
        break;
      case '--help': case '-h':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        fail(`unknown option ${arg}`);
    }
  }
  if (opts.bucketed) {
    if (opts.liftLow == null) opts.liftLow = LIFT_LOW_DEFAULT;
    if (opts.liftHigh == null) opts.liftHigh = LIFT_HIGH_DEFAULT;
    if (opts.liftLow > opts.liftHigh) fail('--lift-low must not be above --lift-high');
  }
  return opts;
}

function fail(message) {
  console.error(`stats: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

// -------------------------------------------------------------- corpus

// One record per loop. Scalars only, so a corpus of a hundred thousand
// still fits in memory.
function measure(spec) {
  const pattern = render(spec);
  const spb = spec.stepsPerBar || STEPS_PER_BAR;
  const notes = pattern.tracks.melody.filter((e) => e.vel > 0);

  let profile = null;
  let best = -1;
  for (const [key, weight] of Object.entries(spec.mix || {})) {
    if (weight > best) { best = weight; profile = key; }
  }

  const rec = {
    lift: spec.feel.lift,
    energy: spec.feel.energy,
    profile: profile || 'unknown',
    spb,
    voice: pattern.meta.melodyVoice,
    // Not present on older builds; the tool still runs without it, which
    // is what makes a before-and-after comparison possible at all.
    cell: pattern.meta.melodyCell || null,
    bars: Math.max(1, Math.round(((pattern.cycles && pattern.cycles.melody) || pattern.totalSteps) / spb)),
    count: notes.length,
    odd: 0,
    durSum: 0,
    velSum: 0,
    span: null,
    // Melodic interval profile, as the share of consecutive intervals in
    // each band. Repeats and steps are kept apart because they are
    // different gestures -- a held note is not a move -- even though both
    // count as "not a leap".
    repeats: 0,
    steps: 0,
    mids: 0,
    leaps: 0,
    intervals: 0,
    // How much of the motif survives restatement, measured on the rendered
    // bars rather than on the motif object: a figure that is a motif in the
    // source and a different shape in every bar is not a motif.
    rhythmRepeat: null,
    contourRepeat: null,
    figureRepeat: null,
    audibleRepeat: null,
    // Velocity across a phrase. Edge notes are the first and last of a
    // phrase as it actually sounds, not as it was written: a phrase whose
    // opening bar the form scheduled out starts where you can hear it
    // start.
    edgeSum: 0,
    edgeN: 0,
    midSum: 0,
    midN: 0,
    rangeSum: 0,
    rangeN: 0,
    // Distance between the keys and melody centroids, and whether the two
    // layers ended up on one voice.
    separation: null,
    sameVoice: null,
    // Drawn on purpose (item 12) rather than by collision. A loop can have
    // sameVoice without this, and that is exactly the case the item was
    // written to stop forcing into unison.
    choir: !!choirOf(spec),
  };

  if (notes.length) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of notes) {
      if (e.step % 2 === 1) rec.odd++;
      rec.durSum += e.dur;
      rec.velSum += e.vel;
      if (e.midi < lo) lo = e.midi;
      if (e.midi > hi) hi = e.midi;
    }
    rec.span = hi - lo;

    const line = notes.slice().sort((a, b) => a.step - b.step);
    for (let i = 0; i + 1 < line.length; i++) {
      const d = Math.abs(line[i + 1].midi - line[i].midi);
      rec.intervals++;
      if (d === 0) rec.repeats++;
      else if (d <= 2) rec.steps++;
      else if (d <= 4) rec.mids++;
      else rec.leaps++;
    }

    // Group the line into bars and ask how many bars share the commonest
    // rhythm, and the commonest sequence of intervals. Two separate
    // questions: dropping one note of a figure leaves the rhythm of the
    // others intact while fusing two of its intervals into a third that was
    // never in the motif, so the pitch shape can come apart while the
    // rhythm still looks like a quotation.
    const bars = new Map();
    for (const e of line) {
      const b = Math.floor(e.step / spb);
      if (!bars.has(b)) bars.set(b, []);
      bars.get(b).push(e);
    }
    if (bars.size >= 2) {
      const commonest = (signature) => {
        const counts = new Map();
        for (const [bar, list] of bars) {
          const key = signature(list, bar * spb);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return Math.max(...counts.values()) / bars.size;
      };
      rec.rhythmRepeat = commonest((list, start) => list.map((e) => e.step - start).join(','));
      rec.contourRepeat = commonest((list) => list.slice(1).map((e, i) => e.midi - list[i].midi).join(','));
      // The same question asked in the figure's own terms. A motif
      // transposed diatonically through a progression is the same motif,
      // but its semitone intervals genuinely change -- that is what a
      // sequence is -- so the semitone figure above under-reads quoting by
      // a long way. Measured directly: adjacent bars inside one phrase
      // agree on semitone contour 9.5% of the time, and 40.1% of the time
      // once the chord underneath them is also the same.
      const phrases = new Map();
      for (const e of line) {
        if (e.phrase == null) continue;
        if (!phrases.has(e.phrase)) phrases.set(e.phrase, []);
        phrases.get(e.phrase).push(e);
      }
      for (const [, group] of phrases) {
        if (group.length < 2) continue;
        const vs = group.map((e) => e.vel);
        rec.rangeSum += Math.max(...vs) - Math.min(...vs);
        rec.rangeN++;
        // A two-note phrase is all edge and has no middle to compare
        // against, so it counts toward the range and nothing else.
        if (group.length < 3) continue;
        rec.edgeSum += group[0].vel + group[group.length - 1].vel;
        rec.edgeN += 2;
        for (let i = 1; i < group.length - 1; i++) {
          rec.midSum += group[i].vel;
          rec.midN++;
        }
      }

      if (line[0].degree != null) {
        rec.figureRepeat = commonest((l) => l.slice(1).map((e, i) => e.degree - l[i].degree).join(','));
      }

      // The same question again, asked of the pitch that actually comes
      // out. `figureRepeat` above reads `degree` straight off the motif,
      // which is the figure *before* the arc, the chord it is sitting on,
      // the chord-tone snap, the closing cadence and the octave fold have
      // touched it -- so it measures whether the motif was reused, not
      // whether anything reused is audible. This converts the emitted midi
      // back to scale degrees with the loop's own root and scale, which
      // makes it blind to the transposition a progression applies (a
      // sequence is still the same figure) while still seeing every other
      // thing done to the note on its way out.
      //
      // The two disagree by a lot -- 0.68 against 0.35 -- and the gap is
      // the point: see the bisect in the pull request that added this.
      const steps = SCALES[spec.scale] && SCALES[spec.scale].steps;
      if (steps && steps.length) {
        const degreeOf = (midi) => {
          const rel = midi - spec.root;
          const pc = ((rel % 12) + 12) % 12;
          let idx = steps.indexOf(pc);
          // Chord tones are built from scale degrees, so this does not fire
          // in practice; kept so a future chromatic note cannot silently
          // corrupt the figure rather than merely being unusual.
          if (idx < 0) {
            let best = 0;
            let bd = 99;
            steps.forEach((v, j) => { const d = Math.abs(v - pc); if (d < bd) { bd = d; best = j; } });
            idx = best;
          }
          return Math.floor(rel / 12) * steps.length + idx;
        };
        rec.audibleRepeat = commonest((l) => l.slice(1)
          .map((e, i) => degreeOf(e.midi) - degreeOf(l[i].midi)).join(','));
      }
    }
  }

  // Register separation. Taken on the sounding notes of each layer, so a
  // layer the form has scheduled out for most of the loop is measured on
  // what is actually heard.
  const chordNotes = [];
  for (const e of pattern.tracks.chords) {
    if (!e.vel || !e.notes) continue;
    for (const n of e.notes) chordNotes.push(n);
  }
  if (chordNotes.length && notes.length) {
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    rec.separation = Math.abs(mean(notes.map((e) => e.midi)) - mean(chordNotes));
    const chordVoices = new Set(pattern.tracks.chords.filter((e) => e.vel).map((e) => e.voice));
    rec.sameVoice = chordVoices.size === 1 && chordVoices.has(pattern.meta.melodyVoice);
  }
  return rec;
}

function collect(opts) {
  const master = new Rng(opts.seed || 1);
  const records = [];
  for (let i = 0; i < opts.n; i++) records.push(measure(newSpec(master.seed32())));
  return records;
}

// ------------------------------------------------------------ summaries

function tally(records, key) {
  const counts = new Map();
  for (const rec of records) {
    const v = rec[key];
    if (v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts;
}

function summarise(records) {
  const sung = records.filter((r) => r.count > 0);
  const spanned = records.filter((r) => r.span != null && r.count > 1);
  const notes = sung.reduce((a, r) => a + r.count, 0);
  const mean = (list, f) => (list.length ? list.reduce((a, r) => a + f(r), 0) / list.length : NaN);
  return {
    loops: records.length,
    sung: sung.length,
    notes,
    profiles: tally(records, 'profile'),
    spb: tally(records, 'spb'),
    voices: tally(sung, 'voice'),
    cells: tally(sung, 'cell'),
    span: mean(spanned, (r) => r.span),
    perLoop: mean(sung, (r) => r.count),
    perBar: mean(sung, (r) => r.count / r.bars),
    dur: notes ? sung.reduce((a, r) => a + r.durSum, 0) / notes : NaN,
    vel: notes ? sung.reduce((a, r) => a + r.velSum, 0) / notes : NaN,
    oddFraction: notes ? sung.reduce((a, r) => a + r.odd, 0) / notes : NaN,
    ...(() => {
      const total = sung.reduce((a, r) => a + r.intervals, 0);
      const share = (key) => (total ? sung.reduce((a, r) => a + r[key], 0) / total : NaN);
      return {
        intervals: total,
        repeatShare: share('repeats'),
        stepShare: share('steps'),
        midShare: share('mids'),
        leapShare: share('leaps'),
        stepOrRepeat: total
          ? (sung.reduce((a, r) => a + r.steps + r.repeats, 0)) / total
          : NaN,
      };
    })(),
    ...(() => {
      const sum = (key) => sung.reduce((a, r) => a + r[key], 0);
      const edgeN = sum('edgeN');
      const midN = sum('midN');
      const rangeN = sum('rangeN');
      const edgeVel = edgeN ? sum('edgeSum') / edgeN : NaN;
      const midVel = midN ? sum('midSum') / midN : NaN;
      return {
        edgeVel,
        midVel,
        edgeOverMid: edgeVel - midVel,
        phraseRange: rangeN ? sum('rangeSum') / rangeN : NaN,
      };
    })(),
    rhythmRepeat: mean(records.filter((r) => r.rhythmRepeat != null), (r) => r.rhythmRepeat),
    contourRepeat: mean(records.filter((r) => r.contourRepeat != null), (r) => r.contourRepeat),
    figureRepeat: mean(records.filter((r) => r.figureRepeat != null), (r) => r.figureRepeat),
    audibleRepeat: mean(records.filter((r) => r.audibleRepeat != null), (r) => r.audibleRepeat),
    separation: mean(records.filter((r) => r.separation != null), (r) => r.separation),
    // Item 4's guarantee, and the split is by the choir rather than by the
    // drawn voice on purpose. A collision takes the separated path now, so
    // counting it as exempt would hide exactly the regression this line
    // exists to catch.
    tooClose: (() => {
      const pairs = records.filter((r) => r.separation != null && !r.choir);
      return pairs.length ? pairs.filter((r) => r.separation < 5).length / pairs.length : NaN;
    })(),
    unison: (() => {
      const pairs = records.filter((r) => r.separation != null && r.choir);
      return pairs.length ? pairs.filter((r) => r.separation <= 2).length / pairs.length : NaN;
    })(),
    // Within 2 is a strict reading of a figure that compares a wandering
    // line's centroid against a four-note chord's, so it never reaches 1
    // however well the unison works. Six semitones is one register by any
    // reading, and it is the figure that is actually a guarantee.
    oneRegister: (() => {
      const pairs = records.filter((r) => r.separation != null && r.choir);
      return pairs.length ? pairs.filter((r) => r.separation <= 6).length / pairs.length : NaN;
    })(),
    choirRate: records.length ? records.filter((r) => r.choir).length / records.length : NaN,
    choirLoops: records.filter((r) => r.choir).length,
    // Loops where the two pools still collide. Nothing is done about these
    // any more; the figure is kept because it is the thing item 12 stopped
    // acting on, and a silent return to acting on it would be a bug.
    collisionLoops: records.filter((r) => r.sameVoice === true && !r.choir).length,
  };
}

// -------------------------------------------------------------- printing

const LABEL_WIDTH = 32;
const COLUMN_WIDTH = 15;

function line(label, cells, indent = 2) {
  const head = ' '.repeat(indent) + label;
  return (head.padEnd(LABEL_WIDTH) + cells.map((c) => String(c).padStart(COLUMN_WIDTH)).join('')).trimEnd();
}

function rule(columns) {
  return ' '.repeat(2) + '-'.repeat(LABEL_WIDTH - 2 + COLUMN_WIDTH * columns);
}

const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '-');
const num = (v, places = 2) => (Number.isFinite(v) ? v.toFixed(places) : '-');

// Distribution rows share one order across every column so the eye can run
// across a row and compare like with like. Ordered by the summed share
// rather than by the first column, or a row that dominates the second column
// and is absent from the first would sort to the bottom and be cut.
function distribution(title, pick, columns, { limit = 0, sortKeys = false } = {}) {
  const out = [line(title, columns.map(() => ''))];
  const shares = new Map();
  for (const col of columns) {
    const counts = pick(col.stats);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    for (const [key, n] of counts) shares.set(key, (shares.get(key) || 0) + (total ? n / total : 0));
  }
  const keys = [...shares.keys()];
  if (sortKeys) keys.sort((a, b) => Number(a) - Number(b));
  else keys.sort((a, b) => shares.get(b) - shares.get(a) || String(a).localeCompare(String(b)));
  const shown = limit ? keys.slice(0, limit) : keys;
  for (const key of shown) {
    out.push(line(String(key), columns.map((col) => {
      const counts = pick(col.stats);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      return counts.has(key) ? pct(counts.get(key), total) : '-';
    }), 4));
  }
  if (shown.length < keys.length) {
    out.push(line(`(${keys.length - shown.length} more)`, columns.map(() => ''), 4));
  }
  return out;
}

function report(columns, opts) {
  const out = [];
  out.push('');
  out.push('driftloom generation statistics');
  out.push(`  ${opts.n} loops drawn from corpus seed ${opts.seed}`);
  if (opts.bucketed) {
    out.push(`  bucketed by feel.lift at <= ${opts.liftLow} and >= ${opts.liftHigh}`);
  }
  out.push('');
  out.push(line('', columns.map((c) => c.label)));
  out.push(rule(columns.length));

  out.push(line('loops', columns.map((c) => c.stats.loops)));
  out.push(line('with an audible melody', columns.map((c) => `${c.stats.sung}`), 4));
  out.push(line('share of loops', columns.map((c) => pct(c.stats.sung, c.stats.loops)), 4));
  out.push(line('melody notes counted', columns.map((c) => c.stats.notes)));
  out.push('');

  out.push(...distribution('dominant profile', (s) => s.profiles, columns));
  out.push('');
  out.push(...distribution('steps per bar', (s) => s.spb, columns, { sortKeys: true }));
  out.push('');
  out.push(...distribution('melody voice', (s) => s.voices, columns, { limit: 12 }));
  if (columns.some((c) => c.stats.cells.size)) {
    out.push('');
    out.push(...distribution('rhythmic cell', (s) => s.cells, columns));
  }
  out.push('');

  out.push(line('melody figures', columns.map(() => '')));
  out.push(line('mean melodic span', columns.map((c) => num(c.stats.span)), 4));
  out.push(line('mean notes per loop', columns.map((c) => num(c.stats.perLoop, 1)), 4));
  out.push(line('mean notes per bar', columns.map((c) => num(c.stats.perBar)), 4));
  out.push(line('mean note duration', columns.map((c) => num(c.stats.dur)), 4));
  out.push(line('mean velocity', columns.map((c) => num(c.stats.vel, 3)), 4));
  out.push(line('notes on odd steps', columns.map((c) => num(c.stats.oddFraction, 3)), 4));
  out.push('');

  out.push(line('velocity across a phrase', columns.map(() => '')));
  out.push(line('phrase edges', columns.map((c) => num(c.stats.edgeVel, 3)), 4));
  out.push(line('mid phrase', columns.map((c) => num(c.stats.midVel, 3)), 4));
  out.push(line('edges above middle', columns.map((c) => num(c.stats.edgeOverMid, 3)), 4));
  out.push(line('within-phrase range', columns.map((c) => num(c.stats.phraseRange, 3)), 4));
  out.push('');

  out.push(line('melodic intervals', columns.map((c) => '')));
  out.push(line('repeats (0)', columns.map((c) => num(c.stats.repeatShare, 3)), 4));
  out.push(line('steps (1-2)', columns.map((c) => num(c.stats.stepShare, 3)), 4));
  out.push(line('mid (3-4)', columns.map((c) => num(c.stats.midShare, 3)), 4));
  out.push(line('leaps (5+)', columns.map((c) => num(c.stats.leapShare, 3)), 4));
  out.push(line('steps + repeats', columns.map((c) => num(c.stats.stepOrRepeat, 3)), 4));
  out.push('');

  out.push(line('motif survival', columns.map((c) => '')));
  out.push(line('bars sharing the rhythm', columns.map((c) => num(c.stats.rhythmRepeat, 3)), 4));
  out.push(line('bars sharing the contour', columns.map((c) => num(c.stats.contourRepeat, 3)), 4));
  out.push(line('bars quoting the figure', columns.map((c) => num(c.stats.figureRepeat, 3)), 4));
  out.push(line('bars quoting it audibly', columns.map((c) => num(c.stats.audibleRepeat, 3)), 4));
  out.push('');

  out.push(line('keys against melody', columns.map((c) => '')));
  out.push(line('mean centroid gap', columns.map((c) => num(c.stats.separation, 2)), 4));
  out.push(line('not a choir, under 5', columns.map((c) => num(c.stats.tooClose, 3)), 4));
  out.push(line('choir loops, within 2', columns.map((c) => num(c.stats.unison, 3)), 4));
  out.push(line('choir loops, within 6', columns.map((c) => num(c.stats.oneRegister, 3)), 4));
  out.push(line('deliberate choir rate', columns.map((c) => num(c.stats.choirRate, 3)), 4));
  out.push(line('deliberate choir loops', columns.map((c) => c.stats.choirLoops), 4));
  out.push(line('incidental collisions', columns.map((c) => c.stats.collisionLoops), 4));
  out.push('');
  return out.join('\n');
}

// ------------------------------------------------------- the balance lock

// Mikey's standing decision is that the current balance is right and has to
// survive new content: meandering, ambient loops alongside tuneful ones, not
// every loop a triumphant melody, the choir about one in thirty. New
// profiles and voices will move the profile, metre and voice shares on
// purpose, so those are reported and not locked. What is locked is melodic
// character -- the rows of the report that describe what a melody does,
// whichever profile or voice it came from.
//
// Each figure is read off `summarise`, the same numbers the report prints,
// so the lock cannot drift from what a person reading the report sees.
const LOCKED = [
  ['melody', 'melodyShare', 'share of loops with a melody', (s) => (s.loops ? s.sung / s.loops : NaN)],
  ['melody figures', 'span', 'mean melodic span', (s) => s.span],
  ['melody figures', 'perBar', 'mean notes per bar', (s) => s.perBar],
  ['melody figures', 'dur', 'mean note duration', (s) => s.dur],
  ['melody figures', 'vel', 'mean velocity', (s) => s.vel],
  ['melody figures', 'oddFraction', 'notes on odd steps', (s) => s.oddFraction],
  ['velocity across a phrase', 'edgeVel', 'phrase edges', (s) => s.edgeVel],
  ['velocity across a phrase', 'midVel', 'mid phrase', (s) => s.midVel],
  ['velocity across a phrase', 'edgeOverMid', 'edges above middle', (s) => s.edgeOverMid],
  ['velocity across a phrase', 'phraseRange', 'within-phrase range', (s) => s.phraseRange],
  ['melodic intervals', 'repeatShare', 'repeats (0)', (s) => s.repeatShare],
  ['melodic intervals', 'stepShare', 'steps (1-2)', (s) => s.stepShare],
  ['melodic intervals', 'midShare', 'mid (3-4)', (s) => s.midShare],
  ['melodic intervals', 'leapShare', 'leaps (5+)', (s) => s.leapShare],
  ['melodic intervals', 'stepOrRepeat', 'steps + repeats', (s) => s.stepOrRepeat],
  ['motif survival', 'rhythmRepeat', 'bars sharing the rhythm', (s) => s.rhythmRepeat],
  ['motif survival', 'contourRepeat', 'bars sharing the contour', (s) => s.contourRepeat],
  ['motif survival', 'figureRepeat', 'bars quoting the figure', (s) => s.figureRepeat],
  ['motif survival', 'audibleRepeat', 'bars quoting it audibly', (s) => s.audibleRepeat],
  ['choir', 'choirRate', 'deliberate choir rate', (s) => s.choirRate],
  // Two readings of "keys against melody collide". The register one is
  // item 4's guarantee: outside a choir, the keys and the tune are kept
  // apart. The voice one is the pools drawing the same voice by accident,
  // which item 12 stopped acting on; it is locked so that a change to what
  // collides is noticed, and it is the figure most likely to move when a
  // new profile puts one voice in both pools -- which would be a reason to
  // rewrite the baseline, not a bug.
  ['keys against melody', 'tooClose', 'not a choir, under 5', (s) => s.tooClose],
  ['keys against melody', 'collisionRate', 'incidental collisions, share', (s) => (s.loops ? s.collisionLoops / s.loops : NaN)],
].map(([group, key, label, get]) => ({ group, key, label, get }));

// Reported beside the lock, never failed on.
const REPORTED = [
  ['dominant profile', (s) => s.profiles, 'loops'],
  ['steps per bar', (s) => s.spb, 'loops'],
  ['melody voice', (s) => s.voices, 'sung'],
];

// Six places is well inside every tolerance, and keeps a rewritten baseline
// readable in a diff. Not-a-number (no choir loops at all, say) is null.
const keep = (v, places = 6) => (Number.isFinite(v) ? +v.toFixed(places) : null);

function lockedFigures(records) {
  const s = summarise(records);
  const out = {};
  for (const f of LOCKED) out[f.key] = f.get(s);
  return { figures: out, summary: s };
}

function shares(counts) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const out = {};
  for (const key of [...counts.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
    out[key] = total ? keep(counts.get(key) / total, 4) : null;
  }
  return out;
}

function writeBaseline(opts) {
  const { figures, summary } = lockedFigures(collect(opts));

  // Tolerance corpora: the same size, drawn from their own salted stream.
  const stream = new Rng(((opts.seed ^ TOLERANCE_SALT) >>> 0) || 1);
  const seeds = [];
  while (seeds.length < TOLERANCE_SEEDS) {
    const s = stream.seed32();
    if (s !== opts.seed && !seeds.includes(s)) seeds.push(s);
  }
  const samples = seeds.map((seed) => lockedFigures(collect({ n: opts.n, seed })).figures);

  const locked = {};
  for (const f of LOCKED) {
    const xs = samples.map((x) => x[f.key]).filter(Number.isFinite);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : NaN;
    const seedToSeed = Math.SQRT2 * sd;
    locked[f.key] = {
      group: f.group,
      label: f.label,
      value: keep(figures[f.key]),
      sd: keep(sd),
      seedToSeed: keep(seedToSeed),
      tolerance: keep(TOLERANCE_SIGMA * seedToSeed),
      samples: xs.map((x) => keep(x)),
    };
  }
  const reported = {};
  for (const [title, pick] of REPORTED) reported[title] = shares(pick(summary));

  const baseline = {
    about: 'The balance lock. Written by `node tools/stats.mjs --write-baseline`, '
      + 'checked by `node tools/stats.mjs --check`. Rewriting it is a deliberate act '
      + 'that the pull request says out loud.',
    n: opts.n,
    seed: opts.seed,
    tolerance: {
      rule: `${TOLERANCE_SIGMA} x the seed-to-seed sd: root 2 x the sample sd of each figure across ${TOLERANCE_SEEDS} further corpora of n loops`,
      sigma: TOLERANCE_SIGMA,
      seeds,
    },
    locked,
    reported,
  };
  fs.mkdirSync(path.dirname(opts.writeBaseline), { recursive: true });
  fs.writeFileSync(opts.writeBaseline, `${JSON.stringify(baseline, null, 2)}\n`);

  const out = [''];
  out.push(`driftloom balance lock written to ${opts.writeBaseline}`);
  out.push(`  ${opts.n} loops from corpus seed ${opts.seed}; tolerance ${TOLERANCE_SIGMA} x the seed-to-seed sd,`);
  out.push(`  measured over ${TOLERANCE_SEEDS} further corpora of ${opts.n}`);
  out.push('');
  out.push(checkLine('figure', ['baseline', 'corpus sd', 'seed-to-seed', 'tolerance']));
  out.push(checkRule(4));
  let group = null;
  for (const f of LOCKED) {
    if (f.group !== group) { group = f.group; out.push(checkLine(group, [])); }
    const b = locked[f.key];
    out.push(checkLine(f.label, [fig(b.value), fig(b.sd), fig(b.seedToSeed), fig(b.tolerance)], 4));
  }
  out.push('');
  return out.join('\n');
}

const checkRule = (columns) => `  ${'-'.repeat(LABEL_WIDTH - 2 + 12 * columns)}`;

function checkLine(label, cells, indent = 2) {
  return ((' '.repeat(indent) + label).padEnd(LABEL_WIDTH) + cells.map((c) => String(c).padStart(12)).join('')).trimEnd();
}

const fig = (v) => (v == null || !Number.isFinite(v) ? '-' : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(4));
const signed = (v) => (v == null || !Number.isFinite(v) ? '-' : `${v >= 0 ? '+' : ''}${Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(4)}`);

function check(opts) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(opts.check, 'utf8'));
  } catch (err) {
    console.error(`stats: cannot read the baseline ${opts.check} -- ${err.message}`);
    process.exit(2);
  }
  const { figures, summary } = lockedFigures(collect({ n: baseline.n, seed: baseline.seed }));

  const out = [''];
  out.push('driftloom balance lock');
  out.push(`  ${baseline.n} loops from corpus seed ${baseline.seed}, against ${opts.check}`);
  out.push(`  tolerance: ${baseline.tolerance.rule}`);
  out.push('');
  out.push(checkLine('figure', ['baseline', 'now', 'difference', 'tolerance', '']));
  out.push(checkRule(5));

  const misses = [];
  let group = null;
  for (const f of LOCKED) {
    if (f.group !== group) { group = f.group; out.push(checkLine(group, [])); }
    const b = baseline.locked[f.key];
    // Rounded as the baseline was, so unchanged code differs by exactly 0.
    const now = keep(figures[f.key]);
    if (!b) {
      misses.push(`${f.label}: not in the baseline`);
      out.push(checkLine(f.label, ['-', fig(now), '-', '-', 'NEW'], 4));
      continue;
    }
    const bothMissing = b.value == null && now == null;
    const diff = now != null && b.value != null ? now - b.value : NaN;
    const ok = bothMissing || (Number.isFinite(diff) && Math.abs(diff) <= b.tolerance);
    if (!ok) misses.push(`${f.label}: ${fig(b.value)} -> ${fig(now)}, ${signed(diff)} against +/-${fig(b.tolerance)}`);
    out.push(checkLine(f.label, [fig(b.value), fig(now), signed(diff), fig(b.tolerance), ok ? 'ok' : 'MISS'], 4));
  }
  for (const key of Object.keys(baseline.locked)) {
    if (!LOCKED.some((f) => f.key === key)) misses.push(`${baseline.locked[key].label}: in the baseline, no longer measured`);
  }

  out.push('');
  out.push('  not locked -- new profiles move these on purpose');
  for (const [title, pick] of REPORTED) {
    const was = baseline.reported[title] || {};
    const now = shares(pick(summary));
    const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .sort((a, b) => (now[b] ?? was[b] ?? 0) - (now[a] ?? was[a] ?? 0) || a.localeCompare(b));
    out.push(checkLine(title, []));
    for (const key of keys) {
      const a = was[key] ?? 0;
      const c = now[key] ?? 0;
      out.push(checkLine(key, [pct(a, 1), pct(c, 1), `${c - a >= 0 ? '+' : ''}${((c - a) * 100).toFixed(1)}%`], 4));
    }
  }

  out.push('');
  if (misses.length) {
    out.push(`  ${misses.length} locked figure${misses.length === 1 ? '' : 's'} outside tolerance:`);
    for (const m of misses) out.push(`    ${m}`);
    out.push('');
    out.push('  Either the change is wrong, or the balance has moved on purpose. If it');
    out.push('  has, rewrite the baseline with --write-baseline and say so in the PR.');
  } else {
    out.push(`  all ${LOCKED.length} locked figures within tolerance`);
  }
  out.push('');
  return { text: out.join('\n'), ok: misses.length === 0 };
}

// ------------------------------------------------------------- the quiz

// Item 12's acceptance line is "a listener who did not know the feature
// existed can pick the choir loops out of twenty by ear", and it says
// outright that this is not a number stats.mjs can produce. What it can do
// is set the test up so somebody can actually sit it: draw a corpus, take
// five choirs and fifteen that are not, shuffle them, print the codes, and
// put the answers somewhere other than the screen being read.
//
// Deterministic in --seed, so a quiz can be handed to two people and be
// the same quiz, and so a disputed answer can be regenerated rather than
// argued about.
const QUIZ_TOTAL = 20;
const QUIZ_CHOIRS = 5;

function quiz(opts) {
  const master = new Rng(opts.seed || 1);
  const choirs = [];
  const others = [];
  // Choirs are 3% of loops, so filling five of them needs a few hundred
  // draws. Bounded so a future rate of zero fails loudly instead of
  // spinning.
  for (let i = 0; i < 200000; i++) {
    if (choirs.length >= QUIZ_CHOIRS && others.length >= QUIZ_TOTAL - QUIZ_CHOIRS) break;
    const seed = master.seed32();
    const spec = newSpec(seed);
    const bucket = choirOf(spec) ? choirs : others;
    const want = bucket === choirs ? QUIZ_CHOIRS : QUIZ_TOTAL - QUIZ_CHOIRS;
    if (bucket.length < want) bucket.push(spec);
  }
  if (choirs.length < QUIZ_CHOIRS) {
    fail(`only found ${choirs.length} choir loops; is the draw still firing?`);
  }

  const items = master.shuffle(
    choirs.map((spec) => ({ spec, choir: true }))
      .concat(others.map((spec) => ({ spec, choir: false })))
  ).map((item) => ({ ...item, code: encodeSong(item.spec) }));

  const key = [
    'driftloom choir quiz -- answer key',
    `corpus seed ${opts.seed}. Regenerate with:  node tools/stats.mjs --seed ${opts.seed} --choir-quiz`,
    '',
    ...items.map((it, n) => `${String(n + 1).padStart(2)}. ${it.choir ? 'CHOIR   ' : 'not     '} ${it.code}   seed ${it.spec.seed}`),
    '',
    `The five choirs are ${items.map((it, n) => (it.choir ? n + 1 : null)).filter(Boolean).join(', ')}.`,
    '',
  ].join('\n');
  fs.writeFileSync(opts.quiz, key);

  const out = [''];
  out.push('driftloom choir quiz');
  out.push(`  ${QUIZ_TOTAL} loops, ${QUIZ_CHOIRS} of them choirs, shuffled. Corpus seed ${opts.seed}.`);
  out.push('  Paste each code into the app and listen. Write down the five you');
  out.push('  think are doublings before you open the key.');
  out.push('');
  items.forEach((it, n) => out.push(`  ${String(n + 1).padStart(2)}.  ${it.code}`));
  out.push('');
  out.push(`  Answers written to ${opts.quiz} -- do not open it first.`);
  out.push('');
  return out.join('\n');
}

// -------------------------------------------------------- finding a voice

// A change to one voice is close to unfindable by rolling dice in the app.
// The three wind voices are 12.4% of melody draws between them, and any
// single one is nearer 4%, so hearing a change to the ocarina means
// re-rolling twenty-five times and hoping. This prints codes that are
// guaranteed to have it.
//
// The loops are picked for being worth listening to as well as for the
// voice: a melody the entry schedules have left two notes of tells you
// nothing about how its attacks sound, so a loop needs a reasonable number
// of sounding notes to be offered.
const VOICE_CODES = 6;
const VOICE_CODES_MIN_NOTES = 10;

function voiceCodes(opts) {
  const master = new Rng(opts.seed || 1);
  const found = [];
  let scanned = 0;
  for (let i = 0; i < 400000 && found.length < VOICE_CODES; i++) {
    scanned++;
    const spec = newSpec(master.seed32());
    const pattern = render(spec);
    if (pattern.meta.melodyVoice !== opts.voiceCodes) continue;
    const notes = pattern.tracks.melody.filter((e) => e.vel);
    if (notes.length < VOICE_CODES_MIN_NOTES) continue;
    const spb = spec.stepsPerBar || STEPS_PER_BAR;
    const sd = 60 / spec.bpm / 4;
    found.push({
      spec,
      code: encodeSong(spec),
      notes: notes.length,
      // How much of this loop the change can actually touch, so a listener
      // knows whether they are hearing a fair example.
      annotated: notes.filter((e) => e.prev != null).length,
      bars: Math.round(pattern.totalSteps / spb),
      secs: +(pattern.totalSteps * sd).toFixed(1),
    });
  }
  if (!found.length) {
    fail(`no loops drew '${opts.voiceCodes}' in ${scanned} draws -- is that a melody voice?`);
  }

  const out = [''];
  out.push(`driftloom loops whose melody draws '${opts.voiceCodes}'`);
  out.push(`  ${found.length} found in ${scanned} draws, corpus seed ${opts.seed}`);
  out.push('');
  for (const f of found) {
    out.push(`  ${f.spec.name}  --  ${f.bars} bars, ${f.secs}s, ${f.notes} melody notes, ${f.annotated} of them joined to the one before`);
    out.push(`    ${f.code}`);
    out.push('');
  }
  out.push('  Paste a code into the app to hear it. Same --seed, same codes.');
  out.push('');
  return out.join('\n');
}

// ----------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));

if (opts.quiz) {
  console.log(quiz(opts));
  process.exit(0);
}

if (opts.voiceCodes) {
  console.log(voiceCodes(opts));
  process.exit(0);
}

if (opts.writeBaseline) {
  console.log(writeBaseline(opts));
  process.exit(0);
}

if (opts.check) {
  const { text, ok } = check(opts);
  console.log(text);
  process.exit(ok ? 0 : 1);
}

const records = collect(opts);

const columns = opts.bucketed
  ? [
      { label: `lift <= ${opts.liftLow}`, stats: summarise(records.filter((r) => r.lift <= opts.liftLow)) },
      { label: `lift >= ${opts.liftHigh}`, stats: summarise(records.filter((r) => r.lift >= opts.liftHigh)) },
    ]
  : [{ label: 'all', stats: summarise(records) }];

console.log(report(columns, opts));
