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

import { newSpec, render, STEPS_PER_BAR } from '../js/generator.js';
import { Rng } from '../js/rng.js';
import { SCALES } from '../js/theory.js';

// ------------------------------------------------------------ arguments

const USAGE = `
driftloom generation statistics

  node tools/stats.mjs [options]

  --n <count>         how many loops to draw            (default 2000)
  --seed <number>     corpus seed; same seed, same loops   (default 1)
  --lift-low [value]  upper bound of the low-lift bucket   (default 0.6)
  --lift-high [value] lower bound of the high-lift bucket (default 0.78)
  --help              this

  Giving either --lift-low or --lift-high splits the corpus by feel.lift
  and prints the two buckets side by side; the other bound takes its
  default. Loops between the two bounds are in neither column. The
  defaults are roughly the lower and upper quartiles of feel.lift, which
  is skewed high, so a bound picked by eye puts almost nothing in the
  low column.
`;

const LIFT_LOW_DEFAULT = 0.6;
const LIFT_HIGH_DEFAULT = 0.78;

function parseArgs(argv) {
  const opts = { n: 2000, seed: 1, liftLow: null, liftHigh: null, bucketed: false };
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
    // layers drew the same voice.
    separation: null,
    sameVoice: null,
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
    tooClose: (() => {
      const pairs = records.filter((r) => r.separation != null && r.sameVoice === false);
      return pairs.length ? pairs.filter((r) => r.separation < 5).length / pairs.length : NaN;
    })(),
    unison: (() => {
      const pairs = records.filter((r) => r.separation != null && r.sameVoice === true);
      return pairs.length ? pairs.filter((r) => r.separation <= 2).length / pairs.length : NaN;
    })(),
    sameVoiceLoops: records.filter((r) => r.sameVoice === true).length,
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
  out.push(line('different voice, under 5', columns.map((c) => num(c.stats.tooClose, 3)), 4));
  out.push(line('same voice, within 2', columns.map((c) => num(c.stats.unison, 3)), 4));
  out.push(line('loops drawing one voice', columns.map((c) => c.stats.sameVoiceLoops), 4));
  out.push('');
  return out.join('\n');
}

// ----------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));
const records = collect(opts);

const columns = opts.bucketed
  ? [
      { label: `lift <= ${opts.liftLow}`, stats: summarise(records.filter((r) => r.lift <= opts.liftLow)) },
      { label: `lift >= ${opts.liftHigh}`, stats: summarise(records.filter((r) => r.lift >= opts.liftHigh)) },
    ]
  : [{ label: 'all', stats: summarise(records) }];

console.log(report(columns, opts));
