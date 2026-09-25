// All sound is synthesised at runtime. No samples, no downloads, nothing
// to load. Every voice is built from a handful of oscillators and one
// shared noise buffer, which is what keeps this playable on a cheap phone.

import { midiToFreq } from './theory.js';

// A voice budget in *cost units*, not a count of voices.
//
// Earlier versions capped a flat count of active voices (28, then 44). That
// treats a hi-hat and a fat three-oscillator analogue pad as costing the
// same "one voice", which measured render time across every voice type
// shows is wrong by a lot: an analogpad note costs roughly 36x what a hat
// does, a choir note 34x, an FM piano note 28x. A flat cap is either far too
// loose for a chord of pads or far too tight for a busy hat pattern -- there
// is no single number that is right for both.
//
// The weights below are ratios from OfflineAudioContext render-time
// measurements taken on a development machine, not a real phone, and that
// distinction is not close enough to ignore: a desktop CPU core is commonly
// five to ten times faster per cycle than the efficiency cores a low-end
// Android phone actually schedules audio work onto. The *relative* costs
// between voices should hold regardless of hardware, since they come from
// node counts and filter complexity, not clock speed -- but the absolute
// BUDGET figures below are a reasoned starting point, not a measurement of
// any real device. If Diagnostics shows dropouts on a specific phone, this
// is the number to revisit first.
const VOICE_COST = {
  hat: 1, ohat: 1, shaker: 1, rim: 1, kick: 1, snare: 1.5, clap: 1.5,
  drop: 1.5, bell: 4, chime: 4, celeste: 4, musicbox: 4,
  sub: 8, round: 8, fifths: 8, pluckbass: 9, rhodesbass: 10, moogbass: 7,
  stab: 4, sine: 4, pluck: 11,
  // The softened leads, re-measured the way the folk voices were (1 s notes
  // against an empty render, through the tonal voices above): saw 6.8 and
  // 7.7, moog 12.9 and 13.6, analoglead 14.0 and 15.3. The analoglead used
  // to bill the moog's 18; by the same method, before this change, the saw
  // read 10.9, the moog 13.9 and the analoglead 17.0.
  saw: 7, moog: 13, analoglead: 15,
  rhodes: 15, whistle: 14, harp: 20,
  // keys is ONE two-operator FM note. piano below is two of them, and the
  // table used to price them the same, which cannot both be right. Measured
  // marginal render time puts keys at 2.1x a sine and 0.47x a piano -- the
  // structure exactly -- so it is half of piano rather than equal to it.
  // At 25 it was reserving twice what an actual piano note costs and
  // starving the melody behind it; see "Why the melody was losing notes".
  keys: 12, prepared: 25, piano: 26,
  pad: 25, moogpad: 25,
  choir: 34, analogpad: 32, softpad: 25,
  kalimba: 11, marimba: 9, vowel: 22, hum: 16,
  ocarina: 15, flute: 16,
  // Measured, not guessed: marginal render time of 1s notes through the real
  // Synth, budget off, against an empty render, converted through the voices
  // above at the median rate (1.14-1.18 units a ms). Take one was 24 and 23,
  // and the same method still reads 24.8 and 23.2 for it. Take two drops
  // the bow noise and shares one fixed body per channel instead of filters
  // on every note, so a note is its oscillators and a gain or two. Two
  // passes: fiddle 7.9 and 8.3, accordion 8.7 and 9.1.
  fiddle: 8, accordion: 9,
  // Pair 2, measured the same way: nylon 6.6 and 7.2 (two oscillators and
  // two gains a note, into the shared body); pan flute 15.4 and 14.5 once
  // its chiff rode the breath's own path -- with a noise source of its own
  // it read 22.8 and 21.5.
  nylon: 7, panflute: 15,
  templebell: 12, tubular: 12,
  // The hand kit, measured the way the folk voices were, but priced against
  // the kit instruments they stand in for rather than through the tonal
  // voices: by the same render timing a kick reads 7.5 units and a hat 4.6,
  // so the drum rows above are on a scale of their own, and pricing these
  // on the tonal one would make the same pattern six times dearer on a
  // frame drum. Two passes, as ratios to what each replaces: frame 1.43
  // and 1.39 of a kick, tap 1.21 and 1.19 of a snare, jingle 3.3 and 3.2
  // of a hat, the long jingle 3.0 and 3.3 of an open hat. The zils are
  // five partials where a hat is one noise burst.
  frame: 1.4, tap: 1.8, jingle: 3.2, ojingle: 3.2,
  // Waves, through the tonal voices like the other textures (wind's 12
  // reads 18 by the same method): 15.9 and 14.3 for a 1 s event.
  waves: 15,
};
const DEFAULT_COST = 12; // any voice not listed above

// Levels for the folk voices, calibrated with measure.mjs --voice all at
// 0.4s notes to the median of each layer that draws them (contribution rule
// 5). The accordion is drawn for both melody and chords, and a chord note
// goes through the engine's spread, so each layer gets its own level.
//
// Re-measured for take two below (--voice all --note 0.4, the mean of the
// two velocities): the new fiddle arrives in 20-40 ms where take one's bow
// took 80-120, so it came out 5.6 LU over the melody median and gave that
// back (0.141 -> 0.0736); the accordion 0.1 under as a tune (0.088 ->
// 0.0892) and 1.0 over as chords (0.102 -> 0.0909).
const FIDDLE_LEVEL = 0.0736;
const ACCORDION_LEVEL = { melody: 0.0892, chords: 0.0909 };

// The folk voices' sources and bodies (take two). Take one was a raw
// sawtooth under a filter that swept open on every note: the family the
// lead audition had already called harsh, with a wah on every note, and
// heard as "a toy fiddle and accordion played badly by a child".
//
// Harmonic slope of each source, as 1/n^slope. A sawtooth is 1; the sung
// voices' glottal source is 2.5. A reed's even harmonics are weaker than
// its odd ones.
//
// Set by the tone probe (measure.mjs --voice): each voice's A-weighted
// share of energy in 2-5 kHz, the band where a voice reads as harsh, has to
// land among the voices Mikey likes -- ocarina, harp and kalimba near 0.02%,
// flute 0.75% -- and not the leads he called harsh, saw, moog and
// analoglead at 8-13%. Take one's fiddle measured 12-14% and its accordion
// 11%.
const BOWED_SLOPE = 2.2;
const REED_SLOPE = 2.0;
const REED_EVEN = 0.6;
// Fixed resonances: [type, Hz, Q, dB]. The violin's wood around 300 Hz and
// a gentle bridge hill at 2.7 kHz, with the fizz above it rolled away; the
// accordion's milder reed formant, under a lowpass near 3 kHz. A lowpass
// Q is in dB in Web Audio, so -3 is the plain, unresonant slope.
const BODIES = {
  nylon: [
    ['peaking', 110, 1.0, 3],
    ['peaking', 230, 1.2, 2],
    ['lowpass', 3500, -3],
  ],
  fiddle: [
    ['peaking', 300, 1.2, 5],
    ['peaking', 2700, 0.9, 2],
    ['lowpass', 4500, -3],
  ],
  accordion: [
    ['peaking', 1250, 0.9, 3],
    ['lowpass', 2800, -3],
  ],
};
// Reeds 2-3 cents apart: a slow shimmer, not a beat. Two equal reeds that
// close together cancel outright at the bottom of every beat -- a second
// and a half apart around G4 -- and a held note swelled and all but
// vanished; measured, the accordion was no louder on a 1.6 s note than a
// 0.4 s one, where every other voice gains 2-3.6 LU. Real reeds never
// cancel that cleanly, so the second one sounds softer: the beat becomes a
// wave of about +2 and -4 dB. Nor do they start a note in step, so the
// second one comes in at a random point of its cycle, under a period late
// and inside the attack; started together, every short note sat on the
// crest of the beat, about 2 dB over what a held note averages.
const REED_CENTS = 1.25;
const SECOND_REED = 0.35;

// Nylon guitar (pair 2). A plucked string: bright for an instant and then
// mellow, which is two layers here rather than a filter closing on every
// note -- a bright one that dies in a tenth of a second over a mellow one
// that rings on, lower strings longer. Both sources carry the comb of a
// string plucked a fifth of the way along. The body is the guitar's air and
// top-plate resonances, fixed, shared per channel like the fiddle's.
// Level to the chords layer's median at 0.4 s notes (--voice all --note
// 0.4, the mean of the two velocities): 5.8 LU over it at first, 0.2 ->
// 0.1029. No profile draws nylon as a melody yet, so there is no melody
// median to measure it against; it plays at the chords level until one does.
const NYLON_LEVEL = 0.1029;
const NYLON_PLUCK_AT = 0.2;
const NYLON_BRIGHT = { slope: 1.4, share: 0.6, tau: 0.08 };
const NYLON_MELLOW = { slope: 2.4, tau: 0.55 };

// Pan flute (pair 2): the Spirit Tracks pipes. A flute's cousin with more
// breath, a chiff of air as each pipe speaks, a small dip in pitch into the
// note, and no vibrato on a short one. A closed pipe: odd partials only.
// No slides: every note is its own pipe.
// To the melody median at 0.4 s: 1.5 LU over at first, 0.12 -> 0.1011.
const PANFLUTE_LEVEL = 0.1011;
const PIPE_SLOPE = 2.5;
const PANFLUTE_BREATH = 0.5;
// The breath spikes to this at the chiff, then settles to PANFLUTE_BREATH.
const PANFLUTE_CHIFF = 0.8;
const PANFLUTE_DIP = 30; // cents
// A note speaks in 20-40 ms when it is short and bows or swells in only
// when it is long: the median melody note is 0.35 s, and take one spent a
// third of that arriving. A slurred note is not attacked at all, beyond
// the few ms that keep it from clicking.
const speak = (dur) => Math.min(0.1, Math.max(0.02, 0.015 + dur * 0.06));
const SLUR_ATTACK = 0.012;
// Vibrato only on notes long enough to hold, arriving once the note has
// settled, and never twice the same: rate and depth are drawn per note and
// drift across it, widening as it holds, as a player's does.
const VIBRATO_MIN_DUR = 0.5;

// The hand kit's levels, per instrument, against the one each replaces on
// the same pattern; see "the hand kit" in `drum`.
const HAND_LEVEL = { frame: 1.097, tap: 0.2918, jingle: 0.02227, ojingle: 0.04494 };
// A tambourine's zils, in Hz: inharmonic, and all above the 2-5 kHz band.
const JINGLE_PARTIALS = [5300, 6650, 7900, 9400, 11200];

// Waves (tide's air): noise under two lowpass stages, so the sea is a
// swell and never a hiss, rising to a crest and falling away. The cutoff
// opens a little at the crest, as a breaking wave brightens.
const WAVES_CUTOFF = 650;
const WAVES_LEVEL = 0.67;

// The leads Mikey called harsh, sharp and gross in the blind lead
// audition -- saw, moog and analoglead -- given what take two gave the
// fiddle: a softer source than a raw sawtooth, and a fixed tone instead of
// a bright per-note sweep. Slopes as in BOWED_SLOPE; cutoffs in Hz, not
// multiples of the note, so a high note is not a brighter one. The moog
// keeps a gentle movement, opening a little at the attack and settling.
// Set by the tone probe, each at or under the flute's 2-5 kHz share.
const LEAD_SLOPE = { saw: 1.5, moog: 1.8, analoglead: 1.7 };
const LEAD_TONE = {
  saw: { cutoff: 1400, q: 4 },
  moog: { open: 1600, settle: 1100, q: 5 },
  analoglead: { cutoff: 1600, q: 0 },
};

// Slid attacks, for the wind voices. See `_slide`.
//
// The rate is the one number here that is a judgement rather than a
// measurement, so: roughly one note in five of those long enough to take
// one, which over the corpus works out at about one wind note in six
// overall. A player leans into some notes. Much above this and the line
// reads as an effect applied to it; much below and nobody ever meets one.
const SLIDE_CHANCE = 0.22;
// A fourth. Wider than this and a glide is a siren.
const SLIDE_MAX_STEP = 5;
// How far below a note to come up from when there is no previous note to
// come from. A tone and a half reads as reaching the note; a fourth, which
// is what the old unreachable `glide` branch used, reads as a swoop.
const SLIDE_SCOOP = 1.5;
// Seconds. The 25th percentile of wind-melody note lengths, so the
// shortest quarter of them arrive clean.
const SLIDE_MIN_DUR = 0.18;

// What a formant voice is charged on top of its own cost when its vowel
// moves within the note. Measured, not reasoned: the marginal render time
// of a 2.4s note through the real Synth in an OfflineAudioContext, one
// build with the drift pinned off against the same build with it pinned
// on. Movement runs 27-29% of a vowel, 19-23% of a hum and 13-16% of a
// choir, which through each voice's own weight above is 4.7 and 5.0 units
// on two clean passes. It is one constant rather than three because the
// cost is the same three biquads recomputing coefficients in every case --
// no nodes are added at all. See "Vowel movement" in the README.
const VOWEL_DRIFT_COST = 5;

// Total budget, in the same units. Calibrated so a genuinely dense passage
// (a four-note analogpad chord plus a busy kit plus a melody note: roughly
// 4*32 + 6*1 + 15 = 149) fits comfortably, while a wall of the heaviest
// voice alone still hits a ceiling well before it could bog down a weak
// device. The "soft" budget is what pads and textures see, so when
// something has to give it is the sustained background yielding, not drums
// or the tune.
const MAX_BUDGET = 260;
const SOFT_BUDGET = 170;
const LITE_BUDGET = 140;
// What the soft cap holds back for the layers that ask after the
// accompaniment -- the melody, and the air behind it. Written this way
// rather than as an absolute cap so it means the same thing at either
// ceiling; see `_budget`.
const LATE_LAYER_RESERVE = MAX_BUDGET - SOFT_BUDGET;
// ...but never more than this share of a smaller ceiling. On lite the full
// 90 would be 64% of everything, which stops being "leave room for the
// tune" and becomes "delete the accompaniment".
//
// 0.42 is where the curve turns, measured on the loop that found this bug.
// At 0.35 the melody still loses 6.5% of its notes on lite; at 0.42 it
// loses none, and every step past that only costs the keys more -- 79.1%
// of chord notes refused at 0.42, 85.0% at 0.50, 90.9% at 0.58, for no
// further gain to the tune. Full quality is unaffected by this number at
// any of those values, because 90 is the smaller term there.
const RESERVE_SHARE = 0.42;

// The struck bells, templebell and tubular, used to apply velocity twice:
// once in the output envelope and again in every partial's gain (and the
// bowl's strike), so their level went with velocity squared -- 11.7 LU
// louder per doubling where everything else in their layers moves 6.
// Velocity now lives in the envelope alone, and the partials and strike
// are fixed at what they were at this velocity, so the top of the range
// sounds as it did and only the bottom comes up.
const BELL_PARTIAL_VEL = 0.8;

// Tape saturation, not a maximizer.
//
// Dividing by tanh(drive) -- the obvious normalisation, since it maps x=1 to
// y=1 -- gives a small-signal gain of drive/tanh(drive), which reaches 3.2x.
// That hauls up every quiet detail while clamping the peaks, which is a
// distortion pedal, and it is what was audible as "clipping" even though
// nothing ever reached full scale.
//
// Dividing by drive instead makes the slope at zero exactly 1: quiet passages
// pass through untouched and only loud ones round off. Peaks land around
// -3 to -6 dB depending on drive, which is what tape actually does.
function tanhCurve(drive = 1.0, n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / drive;
  }
  return curve;
}

export class Synth {
  constructor(ctx, quality = 'full') {
    this.ctx = ctx;
    this.quality = quality;
    this._releases = [];
    this.noise = this._makeNoise(2.0);
    this.glottal = this._makeGlottal();
    this.bowed = this._makeWave(BOWED_SLOPE);
    this.reed = this._makeWave(REED_SLOPE, REED_EVEN);
    this.pipe = this._makeWave(PIPE_SLOPE, 0);
    this.nylonBright = this._makePluck(NYLON_BRIGHT.slope, NYLON_PLUCK_AT);
    this.nylonMellow = this._makePluck(NYLON_MELLOW.slope, NYLON_PLUCK_AT);
    this.leads = Object.fromEntries(Object.entries(LEAD_SLOPE).map(([k, slope]) => [k, this._makeWave(slope)]));
    this._bodies = new Map();
    this._build();
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      // Light pinking. Pure white noise sounds like a hiss; this sounds like air.
      b0 = 0.99765 * b0 + white * 0.099;
      b1 = 0.963 * b1 + white * 0.293;
      b2 = 0.57 * b2 + white * 1.0526;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
    return buf;
  }

  // A voiced source, rather than a sawtooth with the difference filtered
  // back out afterwards.
  //
  // A sawtooth's harmonics fall as 1/n, which is 6dB an octave. A real
  // voiced source falls at about 12, and softer or breathier phonation --
  // which is the register this whole app sings in -- falls faster still,
  // 15 to 18. Building the wave with the slope it should have had is both
  // more honest than correcting it downstream and free: one PeriodicWave
  // made once and shared by every note, against a filter node per note
  // forever.
  //
  // 1/n^2.5 is 15dB an octave. 1/n^2 is the textbook figure and was tried
  // first; it leaves 0.32% of the voice's A-weighted energy in 2-5kHz
  // against the 0.0-0.2% of the voices this one shares a mix with, so the
  // textbook slope is not quite enough here and the soft-phonation end of
  // the real range is what lands.
  _makeGlottal(harmonics = 64) {
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) imag[n] = 1 / Math.pow(n, 2.5);
    return this.ctx.createPeriodicWave(real, imag);
  }

  // The same idea for the folk voices: a source built with the slope it
  // should have, instead of a raw sawtooth filtered after the fact. `even`
  // scales the even harmonics, which is most of what makes a reed a reed.
  _makeWave(slope, even = 1, harmonics = 64) {
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) imag[n] = (n % 2 ? 1 : even) / Math.pow(n, slope);
    return this.ctx.createPeriodicWave(real, imag);
  }

  // A plucked string's spectrum: the slope, times the comb of where it was
  // plucked -- a string plucked at a fifth of its length has almost no
  // fifth harmonic, and that gap is much of what tells a pluck from a beep.
  _makePluck(slope, at, harmonics = 64) {
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) imag[n] = Math.sin(n * Math.PI * at) / Math.pow(n, slope);
    return this.ctx.createPeriodicWave(real, imag);
  }

  // An instrument's body, shared by every note that voice plays into one
  // channel. The resonances are fixed -- a violin's wood does not retune
  // itself each note -- so one chain per channel does what a filter per
  // note did, and a note costs its oscillators and a gain. Built the first
  // time it is asked for; a quality toggle builds a new Synth, and a new
  // set with it.
  _body(kind, dest) {
    let byDest = this._bodies.get(kind);
    if (!byDest) this._bodies.set(kind, byDest = new Map());
    let input = byDest.get(dest);
    if (input) return input;
    const ctx = this.ctx;
    const nodes = BODIES[kind].map(([type, frequency, Q, gain]) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = frequency;
      b.Q.value = Q;
      if (gain != null) b.gain.value = gain;
      return b;
    });
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
    nodes[nodes.length - 1].connect(dest);
    input = nodes[0];
    byDest.set(dest, input);
    return input;
  }

  // Slid attacks (roadmap item 9 v2).
  //
  // The wind voices had vibrato and breath and still did not sound played,
  // because nothing ever arrived at a pitch -- every note simply began on
  // one. A player reaches the note: from the note before it when the two
  // are joined, and from just underneath it when they are not.
  //
  // Which notes get one is articulation, so it is decided here with
  // Math.random, beside the scoop, the jitter and the vibrato, and for the
  // same reason: a draw from the composer's stream would renumber every
  // decision after it and rewrite every share code in circulation. What
  // the synth cannot know is where the line came from, so the composer
  // writes that down as `prev` (see `annotatePrev`).
  //
  // The rate is flat, and deliberately not tied to lift or energy. It
  // does not need to be: the material already carries that relationship.
  // A driven loop has shorter notes and fewer joined pairs, so the share
  // of its notes a slide can touch falls from 96.8% at low energy to 67.5%
  // at high, and 88.2% to 71.2% across lift. Consulting the feeling as
  // well would count the same thing twice.
  _slide(param, midi, time, dur, opts) {
    // Scaled to note length, so a staccato line stays clean. A quarter of
    // the corpus's wind notes are shorter than this and none of them slide.
    if (dur < SLIDE_MIN_DUR) return false;
    if (Math.random() >= SLIDE_CHANCE) return false;

    const f = midiToFreq(midi);
    const prev = opts.prev;
    const step = prev == null ? null : midi - prev;
    // From the previous note when it is near enough to be one gesture --
    // up to a fourth. A glide across a big leap is a siren, not a player,
    // so a wide interval takes the scoop below instead of refusing.
    // A repeated note has nowhere to come from and takes it too.
    const from = step !== null && step !== 0 && Math.abs(step) <= SLIDE_MAX_STEP
      ? midiToFreq(prev)
      : f * Math.pow(2, -SLIDE_SCOOP / 12);

    this._arrive(param, from, f, time, Math.min(0.09, Math.max(0.03, dur * 0.22)));
    return true;
  }

  // Short, and landing well before the midpoint: the note has to be *on*
  // pitch for most of its length or the slide stops being an attack and
  // becomes the note.
  _arrive(param, from, f, time, reach) {
    param.setValueAtTime(from, time);
    param.exponentialRampToValueAtTime(f, time + reach);
  }

  // A slur: a note joined to the one before it (`prev`, as the slides
  // read it) is not attacked again. On a string the finger moves and the
  // bow does not, so the pitch travels from the last note, quicker than a
  // slide, since the note is the point and not the reaching. A leap past
  // a fourth or a repeated note simply changes: no glide, still no attack.
  // Every joined note slurs; there is no draw.
  _slur(param, midi, time, dur, prev) {
    const step = midi - prev;
    if (step === 0 || Math.abs(step) > SLIDE_MAX_STEP) return false;
    this._arrive(param, midiToFreq(prev), midiToFreq(midi), time, Math.min(0.045, Math.max(0.02, dur * 0.12)));
    return true;
  }

  _build() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.userVolume = 0.85;
    this.characterLevel = 1;

    // Last line of defence. Whatever combination of layers lands on the
    // same sixteenth, nothing leaves here above unity.
    this.ceiling = ctx.createDynamicsCompressor();
    this.ceiling.threshold.value = -3;
    this.ceiling.knee.value = 0;
    this.ceiling.ratio.value = 20;
    this.ceiling.attack.value = 0.001;
    this.ceiling.release.value = 0.08;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.25;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 38;

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 7200;
    this.tone.Q.value = 0.6;

    this.sat = ctx.createWaveShaper();
    this.sat.curve = tanhCurve(1.0);
    this.sat.oversample = this.quality === 'full' ? '2x' : 'none';

    // Tape wobble: a very short delay whose time is modulated. Slow wow,
    // fast flutter. This one node does most of the "not made this decade" work.
    this.wobble = ctx.createDelay(0.2);
    this.wobble.delayTime.value = 0.014;
    this.wowLfo = ctx.createOscillator();
    this.wowLfo.frequency.value = 0.32;
    this.wowDepth = ctx.createGain();
    this.wowDepth.gain.value = 0.0016;
    this.flutterLfo = ctx.createOscillator();
    this.flutterLfo.frequency.value = 6.3;
    this.flutterDepth = ctx.createGain();
    this.flutterDepth.gain.value = 0.00018;
    this.wowLfo.connect(this.wowDepth).connect(this.wobble.delayTime);
    this.flutterLfo.connect(this.flutterDepth).connect(this.wobble.delayTime);
    this.wowLfo.start();
    this.flutterLfo.start();

    this.preBus = ctx.createGain();
    this.preBus.connect(this.wobble);
    this.wobble.connect(this.sat);
    this.sat.connect(this.tone);
    this.tone.connect(this.hp);
    this.hp.connect(this.comp);
    this.comp.connect(this.master);
    // Everything already scheduled keeps playing after Stop: notes are
    // queued up to a lookahead ahead (three seconds when hidden) and a pad
    // triggered just before Stop rings for its full length. A transport has
    // to actually stop, so the whole output passes through here and gets
    // faded out in 60ms.
    this.kill = ctx.createGain();
    this.kill.gain.value = 1;

    this.master.connect(this.kill);
    this.kill.connect(this.ceiling);
    // The last node in the chain. Connected straight to the speakers here
    // so the synth works on its own, but MediaBridge re-routes it through
    // a media element so the phone treats us as a music player.
    this.output = this.ceiling;
    this.ceiling.connect(ctx.destination);

    // Reverb: parallel damped comb filters. Far cheaper than a convolver
    // and it can be tuned live, which a fixed impulse response cannot.
    this.reverbIn = ctx.createGain();
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.8;
    // Six combs in parallel, each with feedback near 0.85, multiply the
    // signal by roughly fifty before it reaches the bus. Normalising by
    // (1 - feedback) / count puts the tail back at the level of the send.
    this.combSum = ctx.createGain();
    this.combs = [];
    const times = this.quality === 'full'
      ? [0.0297, 0.0371, 0.0411, 0.0437, 0.0503, 0.0577]
      : [0.0297, 0.0411, 0.0503];
    for (const t of times) {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = t;
      const fb = ctx.createGain();
      fb.gain.value = 0.8;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      this.reverbIn.connect(d);
      d.connect(lp);
      lp.connect(fb);
      fb.connect(d);
      d.connect(this.combSum);
      this.combs.push({ d, fb, lp });
    }
    this.combSum.gain.value = 0.2 / this.combs.length;
    this.combSum.connect(this.reverbOut);
    // Both tails run through one gain so a scheduled rest can be made into
    // real silence. Without this a four second hole is two seconds of hole
    // and two seconds of reverb wash, which is not what silence sounds like.
    this.tails = ctx.createGain();
    this.tails.gain.value = 1;
    this.tails.connect(this.preBus);

    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = 0.02;
    this.reverbOut.connect(preDelay);
    preDelay.connect(this.tails);

    // Echo, tuned to a dotted eighth by default; set per loop tempo later.
    this.echo = ctx.createDelay(2.0);
    this.echo.delayTime.value = 0.36;
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.34;
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 2000;
    this.echoIn = ctx.createGain();
    this.echoIn.connect(this.echo);
    this.echo.connect(this.echoTone);
    this.echoTone.connect(this.echoFb);
    this.echoFb.connect(this.echo);
    this.echoTone.connect(this.tails);

    // No continuous surface-noise layer: the musical voices and reverb
    // provide the atmosphere without adding an audible hiss.

    // Everything except the drums passes through here, so the kick can
    // press the rest of the mix down and let it breathe back. Without that
    // movement a steady four-to-the-floor is just a thud on top of a pad.
    this.pumpBus = ctx.createGain();
    this.pumpBus.gain.value = 1;
    this.pumpBus.connect(this.preBus);

    // Per-layer channels, each with its own send amounts.
    //
    // The melody used to be the quietest channel in the mix and the wettest
    // -- 0.45 of gain against 0.5 for both keys and air, with more echo on
    // it than anything else carries. That is the recipe for an accompaniment,
    // not a tune: send and level both push a part backwards, and the melody
    // had the worst of each. It now sits above keys and air, with the echo
    // cut to a third of what it was and the reverb pulled back with it, so
    // the line arrives dry and in front instead of washing in from behind.
    // Keys give up a little to make the room.
    this.channels = {};
    const cfg = {
      drums: { gain: 0.82, verb: 0.1, echo: 0.05 },
      bass: { gain: 0.62, verb: 0.05, echo: 0.0 },
      chords: { gain: 0.44, verb: 0.35, echo: 0.15 },
      melody: { gain: 0.58, verb: 0.28, echo: 0.12 },
      texture: { gain: 0.5, verb: 0.6, echo: 0.25 },
    };
    for (const [name, c] of Object.entries(cfg)) {
      const g = ctx.createGain();
      g.gain.value = c.gain;
      const verb = ctx.createGain();
      verb.gain.value = c.verb;
      const echo = ctx.createGain();
      echo.gain.value = c.echo;
      g.connect(name === 'drums' ? this.preBus : this.pumpBus);
      g.connect(verb).connect(this.reverbIn);
      g.connect(echo).connect(this.echoIn);
      this.channels[name] = { gain: g, verb, echo, base: c };
    }
  }

  setTone(tone) {
    const t = this.ctx.currentTime;
    const warmth = tone.warmth ?? 0.6;
    const space = tone.space ?? 0.5;
    const wobble = tone.wobble ?? 0.4;

    this.tone.frequency.setTargetAtTime(2600 + (1 - warmth) * 9000, t, 0.2);
    this.sat.curve = tanhCurve(0.55 + warmth * 1.25);
    this.reverbOut.gain.setTargetAtTime(0.4 + space * 0.9, t, 0.2);
    // Cap room feedback to prevent resonant high-frequency feedback at large room sizes.
    const fb = Math.min(0.74, 0.66 + space * 0.2);
    for (const c of this.combs) {
      c.fb.gain.setTargetAtTime(fb, t, 0.2);
      c.lp.frequency.setTargetAtTime(1400 + space * 2600, t, 0.2);
    }
    this.combSum.gain.setTargetAtTime((1 - fb) / this.combs.length, t, 0.2);
    this.wowDepth.gain.setTargetAtTime(0.0004 + wobble * 0.0038, t, 0.2);
    this.flutterDepth.gain.setTargetAtTime(0.00004 + wobble * 0.0005, t, 0.2);
  }

  // Let the tail ring naturally for a moment, then take it down to nothing.
  fadeTails(time, hold = 0.7, fall = 1.1) {
    this.tails.gain.cancelScheduledValues(time);
    this.tails.gain.setTargetAtTime(0.0001, time + hold, fall / 3);
  }

  restoreTails(time) {
    this.tails.gain.cancelScheduledValues(time);
    this.tails.gain.setTargetAtTime(1, time, 0.08);
  }

  // Called on each kick when the profile asks for it.
  duck(time, amount = 0.5, recover = 0.24) {
    if (!amount) return;
    const g = this.pumpBus.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(Math.max(0.1, 1 - amount), time);
    g.linearRampToValueAtTime(1, time + recover);
  }

  setEchoTime(seconds) {
    this.echo.delayTime.setTargetAtTime(Math.min(1.9, seconds), this.ctx.currentTime, 0.05);
  }

  setMute(layer, muted) {
    const ch = this.channels[layer];
    if (!ch) return;
    ch.gain.gain.setTargetAtTime(muted ? 0 : ch.base.gain, this.ctx.currentTime, 0.03);
  }

  // Silence everything already in flight. Not a mute: the transport stopped.
  silence(when = this.ctx.currentTime) {
    const g = this.kill.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(g.value, when);
    g.linearRampToValueAtTime(0, when + 0.06);
  }

  unsilence(when = this.ctx.currentTime) {
    const g = this.kill.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(g.value, when);
    g.linearRampToValueAtTime(1, when + 0.02);
  }

  // Rebuilding the graph (the quality toggle does) used to abandon the old
  // one still wired to the speakers, with its LFOs running and its combs
  // ringing. Tear it down properly instead.
  dispose() {
    for (const osc of [this.wowLfo, this.flutterLfo]) {
      try { osc.stop(); } catch { /* already stopped */ }
      try { osc.disconnect(); } catch { /* already detached */ }
    }
    for (const c of this.combs) {
      try { c.fb.disconnect(); } catch { /* already detached */ }
      try { c.d.disconnect(); } catch { /* already detached */ }
      try { c.lp.disconnect(); } catch { /* already detached */ }
    }
    try { this.echoFb.disconnect(); } catch { /* already detached */ }
    try { this.ceiling.disconnect(); } catch { /* already detached */ }
    try { this.master.disconnect(); } catch { /* already detached */ }
    this._releases = [];
  }

  setVolume(v) {
    this.userVolume = v;
    this._applyGain();
  }

  // Per-character trim, kept separate from the user's volume so the two do
  // not fight each other.
  setCharacterLevel(level) {
    this.characterLevel = level;
    this._applyGain();
  }

  _applyGain() {
    const v = (this.userVolume ?? 0.85) * (this.characterLevel ?? 1);
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  // Voice budgeting used to count down with setTimeout. That is wrong twice
  // over. Backgrounded pages have their timers clamped to about 1Hz, so
  // releases arrive late, the counter stays high and notes get dropped --
  // a real cause of dropouts with the screen off. And in an offline render
  // the callbacks never fire at all, so the budget saturates after 28 notes
  // and silently discards the rest of the piece.
  //
  // Releases are now tracked on the audio clock and pruned against the time
  // the note is scheduled for, which is correct in both cases.
  // Guarantee an envelope is actually at zero when its oscillators stop.
  //
  // setTargetAtTime approaches the target exponentially and never arrives,
  // so stopping a node a fixed time later severs whatever is left. On a six
  // second chord that was a quarter of peak amplitude -- a step
  // discontinuity, which is a click, on every sustained note. Hold the
  // envelope where it has got to, then ramp it properly to zero.
  // Schedule a release that genuinely arrives at zero, then stop.
  //
  // setTargetAtTime approaches its target exponentially and never reaches
  // it, so stopping a node a fixed time later severs whatever is left --
  // on a six second chord that was a quarter of peak amplitude, a step
  // discontinuity, which is a click, on every sustained note.
  // exponentialRampToValueAtTime has a defined endpoint, so a short linear
  // ramp can take the last inaudible bit to true zero from a known value.
  _release2(param, from, to, floor = 0.0006) {
    param.exponentialRampToValueAtTime(floor, Math.max(from + 0.01, to - 0.025));
    param.linearRampToValueAtTime(0, to);
  }

  _stopClean(gainNode, sources, stopAt) {
    for (const s of sources) {
      try { s.stop(stopAt + 0.01); } catch { /* already stopped */ }
    }
  }

  _budget(time = this.ctx.currentTime, soft = false, cost = DEFAULT_COST) {
    while (this._releases.length && this._releases[0].at <= time) this._releases.shift();
    const spent = this._releases.reduce((sum, r) => sum + r.cost, 0);
    const ceiling = this.quality === 'lite' ? LITE_BUDGET : MAX_BUDGET;
    // The soft cap is a *reserve*, not a flat number.
    //
    // SOFT_BUDGET was already MAX_BUDGET minus 90, which is to say it always
    // meant "leave ninety units for whatever asks later". Written as
    // Math.min(SOFT_BUDGET, ceiling) that meaning was lost on lite: 170
    // against a 140 ceiling is no cap at all, so the one mechanism that
    // keeps room for the tune did nothing on exactly the devices that
    // needed it most. Subtracting the reserve says the same thing at both
    // ceilings -- full is unchanged at 170, and lite gets 50.
    const reserve = Math.min(LATE_LAYER_RESERVE, Math.round(ceiling * RESERVE_SHARE));
    const cap = soft ? Math.max(40, ceiling - reserve) : ceiling;
    if (spent + cost > cap) return false;
    return true;
  }

  _release(time, dur, cost = DEFAULT_COST) {
    const at = (typeof dur === 'number' ? time + dur : this.ctx.currentTime + time) + 0.12;
    let i = this._releases.length;
    while (i > 0 && this._releases[i - 1].at > at) i--;
    this._releases.splice(i, 0, { at, cost });
  }

  _noiseSource(time, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const offset = Math.random() * (this.noise.duration - dur - 0.05);
    src.start(time, Math.max(0, offset), dur + 0.05);
    return src;
  }

  // ------------------------------------------------------------- drums

  drum(inst, time, vel = 0.8) {
    const cost = VOICE_COST[inst] ?? 1.5;
    if (!this._budget(time, false, cost)) return;
    const ctx = this.ctx;
    const out = this.channels.drums.gain;
    const v = Math.max(0, Math.min(1, vel));

    if (inst === 'kick') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(128, time);
      osc.frequency.exponentialRampToValueAtTime(44, time + 0.09);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * 1.1, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);
      osc.connect(g).connect(out);
      osc.start(time);
      osc.stop(time + 0.42);

      const click = this._noiseSource(time, 0.03);
      const cf = ctx.createBiquadFilter();
      cf.type = 'lowpass';
      cf.frequency.value = 1400;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(v * 0.28, time);
      cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
      click.connect(cf).connect(cg).connect(out);
      this._release(time, 0.45, cost);
      return;
    }

    if (inst === 'snare' || inst === 'clap') {
      const dur = inst === 'clap' ? 0.2 : 0.16;
      const src = this._noiseSource(time, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = inst === 'clap' ? 1500 : 1900;
      bp.Q.value = inst === 'clap' ? 1.4 : 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * 0.7, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(bp).connect(g).connect(out);

      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(inst === 'clap' ? 320 : 190, time);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(v * 0.3, time);
      bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
      body.connect(bg).connect(out);
      body.start(time);
      body.stop(time + 0.12);
      this._release(time, dur, cost);
      return;
    }

    if (inst === 'hat' || inst === 'ohat' || inst === 'shaker') {
      const dur = inst === 'ohat' ? 0.26 : inst === 'shaker' ? 0.07 : 0.045;
      const src = this._noiseSource(time, dur);
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = inst === 'shaker' ? 5200 : 7400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * (inst === 'shaker' ? 0.3 : 0.42), time + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(hpf).connect(g).connect(out);
      this._release(time, dur, cost);
      return;
    }

    if (inst === 'rim') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, time);
      osc.frequency.exponentialRampToValueAtTime(280, time + 0.03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * 0.5, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 2.4;
      osc.connect(bp).connect(g).connect(out);
      osc.start(time);
      osc.stop(time + 0.09);
      this._release(time, 0.1, cost);
      return;
    }

    // The hand kit (tide): a frame drum played with a tipper, and the zils
    // of a tambourine. The generator writes these in place of the kit's
    // kick, snare and hats; the pattern is the same one.
    if (inst === 'frame' || inst === 'tap') {
      // A skin, not a kick: a round low note that falls a little as it
      // rings, a second membrane mode above it dying faster, and the soft
      // slap of the tipper on the skin. The tap is the tipper's other end,
      // higher and shorter, where the snare would be.
      const low = inst === 'frame';
      const level = v * HAND_LEVEL[inst];
      const pitch = low ? 92 : 210;
      const ring = low ? 0.32 : 0.12;
      const skin = ctx.createOscillator();
      skin.type = 'sine';
      skin.frequency.setValueAtTime(pitch * 1.18, time);
      skin.frequency.exponentialRampToValueAtTime(pitch, time + 0.05);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, time);
      sg.gain.exponentialRampToValueAtTime(level, time + 0.004);
      sg.gain.exponentialRampToValueAtTime(0.0001, time + ring);
      skin.connect(sg).connect(out);
      const mode = ctx.createOscillator();
      mode.type = 'sine';
      mode.frequency.value = pitch * 1.59;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.0001, time);
      mg.gain.exponentialRampToValueAtTime(level * 0.35, time + 0.003);
      mg.gain.exponentialRampToValueAtTime(0.0001, time + ring * 0.45);
      mode.connect(mg).connect(out);
      const slap = this._noiseSource(time, 0.04);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = low ? 520 : 900;
      bp.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, time);
      ng.gain.exponentialRampToValueAtTime(level * (low ? 0.3 : 0.45), time + 0.002);
      ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      slap.connect(bp).connect(ng).connect(out);
      skin.start(time); mode.start(time);
      skin.stop(time + ring + 0.02); mode.stop(time + ring + 0.02);
      this._release(time, ring, cost);
      return;
    }

    if (inst === 'jingle' || inst === 'ojingle') {
      // A tambourine's zils: a handful of inharmonic partials above 5 kHz,
      // ringing briefly together, over a whisper of noise up there too, so
      // the brightness sits above the band where a sound reads as harsh.
      const long = inst === 'ojingle';
      const ring = long ? 0.24 : 0.09;
      const level = v * HAND_LEVEL[inst];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(level, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + ring);
      g.connect(out);
      for (const hz of JINGLE_PARTIALS) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        // Each zil a hair off from the last time it was struck.
        o.frequency.value = hz * (0.99 + Math.random() * 0.02);
        o.connect(g);
        o.start(time);
        o.stop(time + ring + 0.02);
      }
      const hiss = this._noiseSource(time, ring);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const hg = ctx.createGain();
      hg.gain.value = 0.6;
      hiss.connect(hp).connect(hg).connect(g);
      this._release(time, ring, cost);
      return;
    }
    this._release(time, 0.05, cost);
  }

  // -------------------------------------------------------------- bass

  // One sawtooth-plus-sub recipe for every loop was both the muddiest option
  // and the most monotonous. Each of these keeps the low end clear a
  // different way: less sub, a steeper filter, or no sawtooth at all.
  bass(midi, time, dur, vel = 0.7, glide = false, voice = 'sub', chug = false) {
    const cost = VOICE_COST[voice] ?? 8;
    if (!this._budget(time, false, cost)) return;
    const ctx = this.ctx;
    const out = this.channels.bass.gain;
    const f = midiToFreq(midi);
    const stop = time + dur + 0.4;
    // Measured trims. Sustained low voices build up far more energy than
    // short ones, so a single channel fader either leaves the sustained
    // ones booming or buries the plucked ones.
    const TRIM = { sub: 0.55, fifths: 0.55, round: 0.75, pluckbass: 0.72, rhodesbass: 0.8, moogbass: 1 };
    vel *= TRIM[voice] ?? 1;

    const env = (peak, sustain, release) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), time + 0.014);
      if (sustain != null) g.gain.setTargetAtTime(sustain, time + 0.05, 0.25);
      g.gain.setTargetAtTime(0.0001, time + dur, release);
      return g;
    };

    const setF = (osc) => {
      if (glide) {
        osc.frequency.setValueAtTime(f * 0.66, time);
        osc.frequency.exponentialRampToValueAtTime(f, time + 0.08);
      } else {
        osc.frequency.setValueAtTime(f, time);
      }
    };

    if (voice === 'round') {
      // Triangle through a gentle filter. No sawtooth buzz, no sub piled on
      // top: the cleanest option and the right one under a quiet pad.
      const o = ctx.createOscillator();
      o.type = 'triangle';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(Math.min(2200, f * 6), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(140, f * 2.4), time + Math.min(0.5, dur));
      const g = env(vel * 0.34, vel * 0.22, 0.08);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);
    } else if (voice === 'fifths') {
      // Root and fifth, sine only. Open and weightless -- it states a bass
      // note without asserting a chord, which is what the ambient
      // characters want underneath a floating harmony.
      for (const [mult, lvl] of [[1, 0.3], [1.5, 0.14]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * mult, time);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * lvl, time + Math.min(0.4, dur * 0.3));
        g.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.2);
        o.connect(g).connect(out);
        o.start(time); o.stop(stop + 0.4);
      }
    } else if (voice === 'rhodesbass') {
      // TRIM above is this voice's measured level. A second 0.85 here
      // trimmed it again, -3.4 dB together; it still sits under the other
      // bass voices, as the only one here whose note decays.
      this.fm(midi, time, dur, vel, {
        out, ratio: 1, index: 130, decay: 0.4, attack: 0.006, skipBudget: true,
      });
    } else if (voice === 'pluckbass') {
      // Short and woody, with a little noise for the finger. Leaves space
      // between notes instead of filling the whole bar with low end.
      const o = ctx.createOscillator();
      o.type = 'triangle';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(Math.min(2600, f * 9), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(130, f * 2), time + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vel * 0.42, time + 0.006);
      g.gain.setTargetAtTime(0.0001, time + Math.min(dur, 0.3), 0.1);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);
      const click = this._noiseSource(time, 0.02);
      const cf = ctx.createBiquadFilter();
      cf.type = 'bandpass';
      cf.frequency.value = 900;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(vel * 0.1, time);
      cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.025);
      click.connect(cf).connect(cg).connect(out);
    } else if (voice === 'moogbass') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 9;
      lp.frequency.setValueAtTime(Math.min(3600, f * 11), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(150, f * 2.2), time + Math.min(0.35, dur));
      const g = env(vel * 0.26, vel * 0.15, 0.07);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);
    } else {
      // The original: sawtooth over a sine sub. Kept, but with the sub
      // pulled well down -- at the old level the two fundamentals stacked
      // and turned into mud.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(Math.min(4200, f * 10), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2.2), time + Math.min(0.4, dur));
      const g = env(vel * 0.17, vel * 0.11, 0.06);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);

      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(f, time);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, time);
      sg.gain.exponentialRampToValueAtTime(vel * 0.13, time + 0.015);
      sg.gain.setTargetAtTime(0.0001, time + dur, 0.08);
      sub.connect(sg).connect(out);
      sub.start(time); sub.stop(stop);
    }
    // The budget holds a bass note for 0.8 s past its end: the longest tail
    // here, the fifths voice's, which stops at stop + 0.4. Every other
    // voice stops at dur + 0.4 (rhodesbass aside, which decays in fm()). A
    // chug, a short note on every eighth, was charged for twice as long as
    // it sounds -- about four notes at once, some 35 units on pluckbass --
    // and on lite that came out of the tune: wayfare's chug loops lost
    // melody notes twice as often as its others. A chug note is held as
    // long as it sounds. Every other bass note keeps the old hold, so no
    // loop that was already here refuses anything differently.
    const exact = chug && voice !== 'fifths' && voice !== 'rhodesbass';
    this._release(time, dur + (exact ? 0.4 : 0.8), cost);
  }

  // ------------------------------------------------------------- tuned

  // Two-operator FM. Ratio and index do all the work: 2:1 with a short
  // index envelope is an electric piano, 3.5:1 is a bell, 1:1 is a soft
  // reed. One tiny voice covering most of a mid-80s digital keyboard.
  fm(midi, time, dur, vel, opts = {}) {
    // rhodesbass calls this from inside bass(), which has already checked
    // and will release its own budget for the whole note; checking again
    // here would charge the same sound twice.
    const cost = opts.cost ?? DEFAULT_COST;
    if (!opts.skipBudget && !this._budget(time, !!opts.soft, cost)) return;
    const ctx = this.ctx;
    const out = opts.out || this.channels.chords.gain;
    const f = midiToFreq(midi);
    const ratio = opts.ratio ?? 2;
    const index = opts.index ?? 220;
    const attack = opts.attack ?? 0.006;
    const decay = opts.decay ?? dur;
    const detune = opts.detune ?? 0;

    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = f;
    car.detune.value = detune;

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = f * ratio;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(index * vel, time);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.06), time + Math.min(0.9, decay));
    mod.connect(modGain).connect(car.frequency);

    const peak = Math.max(0.001, vel * 0.26);
    const stop = time + dur + 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + attack);
    // Decay across the note, then a defined release to silence.
    g.gain.exponentialRampToValueAtTime(Math.max(0.0008, peak * 0.3), time + Math.max(0.08, dur * 0.7));
    this._release2(g.gain, time + Math.max(0.08, dur * 0.7), stop);

    car.connect(g).connect(out);
    car.start(time);
    mod.start(time);
    this._stopClean(g, [car, mod], stop);
    if (!opts.skipBudget) this._release(time, dur + 1.2, cost);
  }

  pad(notes, time, dur, vel, dest) {
    const ctx = this.ctx;
    const out = dest || this.channels.chords.gain;
    // Two detuned triangles per note, so this is the same weight class as
    // the fat analogue voices, not the plain plucks.
    const cost = VOICE_COST.pad;
    for (const midi of notes) {
      if (!this._budget(time, true, cost)) return;
      const f = midiToFreq(midi);
      const g = ctx.createGain();
      const stopAt = time + dur + 1.6;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime((vel * 0.22) / Math.sqrt(notes.length), time + Math.min(0.9, dur * 0.4));
      this._release2(g.gain, time + dur * 0.8, stopAt);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(700, time);
      lp.frequency.linearRampToValueAtTime(1900, time + dur * 0.5);
      lp.Q.value = 0.8;
      const oscs = [];
      for (const cents of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(time);
        oscs.push(o);
      }
      lp.connect(g).connect(out);
      this._stopClean(g, oscs, time + dur + 1.6);
      this._release(time, dur + 1.6, cost);
    }
  }

  // `out` defaults to the melody channel because that is where most of
  // these play, but it has to be passable: `keys` is a chord voice and
  // reaches here through `voice()`'s default branch. For as long as this
  // signature ended at `soft`, every keys chord in the app was routed to
  // the melody bus -- louder, drier and with less echo than the chords
  // channel it was supposed to use, and it quietly undid the "keys give up
  // a little to make the room" balance set in `_build`.
  pluck(midi, time, dur, vel, voice = 'pluck', soft = false, out = this.channels.melody.gain) {
    if (voice === 'bell') {
      this.fm(midi, time, dur * 0.9, vel, { out, soft, ratio: 3.51, index: 420, decay: 0.5, cost: VOICE_COST.bell });
    } else if (voice === 'keys') {
      this.fm(midi, time, dur, vel, { out, soft, ratio: 2, index: 260, decay: 0.4, cost: VOICE_COST.keys });
    } else if (voice === 'saw') {
      if (!this._budget(time, soft, VOICE_COST.saw)) return;
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.leads.saw);
      o.frequency.value = midiToFreq(midi);
      // A soft source under a fixed lowpass with a little edge at the
      // cutoff. Was a raw sawtooth under a resonant sweep from 3.2 kHz down
      // to 700 Hz on every note: 10-13% of it in 2-5 kHz.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = LEAD_TONE.saw.cutoff;
      lp.Q.value = LEAD_TONE.saw.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      // Was 0.28: 5.9 LU over the melody layer's median at 0.4s notes, near
      // the app's median melody note (measure.mjs --voice all --note 0.4).
      // Every loop flagged on every pass of #42's listening test led with
      // this or the square below, so both sit at the median now. The soft
      // source came out 2.6 LU over it again, and gave that back (0.142 ->
      // 0.1055).
      g.gain.exponentialRampToValueAtTime(vel * 0.1055, time + 0.01);
      g.gain.setTargetAtTime(0.0001, time + dur * 0.6, 0.15);
      o.connect(lp).connect(g).connect(out);
      o.start(time);
      o.stop(time + dur + 0.6);
      this._release(time, dur + 0.6, VOICE_COST.saw);
    } else {
      // Square-wave beep with a touch of vibrato. The Adventure Time voice.
      if (!this._budget(time, soft, VOICE_COST.pluck)) return;
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = midiToFreq(midi);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.4;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 3.5;
      vib.connect(vibGain).connect(o.detune);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      // Was 0.16: 4.6 LU over the melody layer's median at 0.4s notes.
      // Trimmed to it with the saw above; the timbre is untouched.
      g.gain.exponentialRampToValueAtTime(vel * 0.095, time + 0.008);
      g.gain.setTargetAtTime(0.0001, time + dur * 0.55, 0.12);
      o.connect(lp).connect(g).connect(out);
      o.start(time);
      vib.start(time);
      o.stop(time + dur + 0.5);
      vib.stop(time + dur + 0.5);
      this._release(time, dur + 0.5, VOICE_COST.pluck);
    }
  }


  // ------------------------------------------------------- voice router

  // One entry point for every tuned sound. Characters name a voice and this
  // decides what that means in oscillators.
  voice(name, midi, time, dur, vel, out, opts = {}) {
    const ctx = this.ctx;
    const dest = out || this.channels.melody.gain;
    const f = midiToFreq(midi);
    // Accompaniment yields before the tune.
    //
    // The engine asks for layers in a fixed order -- drums, bass, chords,
    // melody, texture -- so the melody asks fourth, after the chords have
    // reserved theirs, and on a dense loop it is refused for want of room
    // it never had a chance at. Measured over 150 loops before this: 28.6%
    // of them lost more than 5% of their melody, and one lost 52%.
    //
    // The mechanism already existed and only pads were using it. A voice
    // handed the chords channel now bills against the soft cap, which
    // leaves the rest of the ceiling for whatever asks later. Pads keep
    // billing soft wherever they play, which is what they already did.
    const soft = dest === this.channels.chords.gain;

    switch (name) {
      // Zelda's harp: bright, short, two-operator, with a second voice a
      // hair out of tune so it rings rather than beeps.
      case 'harp':
        // Two fm() calls, no outer gate; measured harp end-to-end is ~20x a
        // hat, split across the two layered strikes.
        this.fm(midi, time, dur * 0.8, vel, { soft, out: dest, ratio: 3, index: 200, decay: 0.35, cost: 13 });
        this.fm(midi, time + 0.006, dur * 0.6, vel * 0.4, { soft, out: dest, ratio: 3, index: 140, decay: 0.3, detune: 7, cost: 7 });
        return;

      // Ocarina and flute are the same idea at different mixes: a nearly pure
      // tone plus breath noise, with vibrato that arrives late the way a
      // player's does.
      case 'ocarina':
      case 'flute': {
        const breathy = name === 'flute';
        if (!this._budget(time, soft, VOICE_COST[name])) return;
        // Both were 0.3, which put the ocarina 8.6 LU and the flute 6.9 LU over
        // the melody layer's median at 0.4s notes (measure.mjs --voice all
        // --note 0.4). Trimmed to the median, as the pluck and saw were. Tone
        // and breath scale together, so the level moves and the mix inside
        // the voice does not.
        const level = breathy ? 0.1357 : 0.1115;
        const o = ctx.createOscillator();
        o.type = breathy ? 'triangle' : 'sine';
        // The vibrato below rides on detune, so the frequency param is free
        // for the slide to use without the two fighting each other.
        if (!this._slide(o.frequency, midi, time, dur, opts)) o.frequency.value = f;
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.2;
        const vibAmt = ctx.createGain();
        vibAmt.gain.setValueAtTime(0, time);
        vibAmt.gain.linearRampToValueAtTime(breathy ? 9 : 6, time + Math.min(0.5, dur));
        vib.connect(vibAmt).connect(o.detune);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * level, time + 0.05);
        g.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.09);
        o.connect(g).connect(dest);
        // The shared noise buffer is two seconds long; a held note can be
        // longer than that, and the breath used to stop partway through it.
        const air = ctx.createBufferSource();
        air.buffer = this.noise;
        air.loop = true;
        air.playbackRate.value = 0.9 + Math.random() * 0.25;
        air.start(time);
        air.stop(time + dur + 0.5);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * 2;
        bp.Q.value = 1.2;
        const ag = ctx.createGain();
        ag.gain.setValueAtTime(0.0001, time);
        ag.gain.linearRampToValueAtTime(vel * level * (breathy ? 1 / 3 : 0.15), time + 0.06);
        ag.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.09);
        air.connect(bp).connect(ag).connect(dest);
        o.start(time); vib.start(time);
        o.stop(time + dur + 0.4); vib.stop(time + dur + 0.4);
        this._release(time, dur + 0.4, VOICE_COST[name]);
        return;
      }

      // Fiddle: a bowed string. A source with the slope a bowed string has
      // once the violin's body has had it, the body's fixed resonances, an
      // attack sized to the note, slurs between joined notes, and a vibrato
      // that breathes on the long ones. No bow noise: it read as grit.
      case 'fiddle': {
        if (!this._budget(time, soft, VOICE_COST.fiddle)) return;
        const joined = opts.prev != null;
        const o = ctx.createOscillator();
        o.setPeriodicWave(this.bowed);
        // The vibrato rides on detune, so the frequency is free for the slur.
        if (!(joined && this._slur(o.frequency, midi, time, dur, opts.prev))) o.frequency.value = f;
        let vib = null;
        if (dur >= VIBRATO_MIN_DUR) {
          vib = ctx.createOscillator();
          const rate = 4.8 + Math.random() * 1.3;
          vib.frequency.setValueAtTime(rate, time);
          vib.frequency.linearRampToValueAtTime(rate * (0.9 + Math.random() * 0.2), time + dur);
          const depth = 10 + Math.random() * 10;
          const onset = Math.min(0.3, dur * 0.3);
          const vibAmt = ctx.createGain();
          vibAmt.gain.setValueAtTime(0, time);
          vibAmt.gain.setValueAtTime(0, time + onset);
          vibAmt.gain.linearRampToValueAtTime(depth * 0.6, time + onset + 0.2);
          vibAmt.gain.linearRampToValueAtTime(depth, time + dur);
          vib.connect(vibAmt).connect(o.detune);
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * FIDDLE_LEVEL, time + (joined ? SLUR_ATTACK : speak(dur)));
        g.gain.setTargetAtTime(0.0001, time + dur * 0.9, 0.07);
        o.connect(g).connect(this._body('fiddle', dest));
        o.start(time);
        o.stop(time + dur + 0.4);
        if (vib) { vib.start(time); vib.stop(time + dur + 0.4); }
        this._release(time, dur + 0.4, VOICE_COST.fiddle);
        return;
      }

      // Accordion: two soft reeds a couple of cents apart, the second one
      // quieter, which is the musette shimmer without the beating, through
      // the reed's fixed formant and a lowpass. The bellows swell only into
      // long notes, and not at all into a joined one: the bellows keep
      // moving and the next button speaks. No glide, since there is no
      // string to slide on. Two reeds, not three: a third is a different
      // register stop, not more accordion.
      case 'accordion': {
        if (!this._budget(time, soft, VOICE_COST.accordion)) return;
        const g = ctx.createGain();
        // A chord is several notes at once through the engine's spread, so
        // the two layers take separate levels; see ACCORDION_LEVEL.
        const level = vel * (soft ? ACCORDION_LEVEL.chords : ACCORDION_LEVEL.melody);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(level, time + (opts.prev != null ? SLUR_ATTACK : speak(dur)));
        g.gain.setTargetAtTime(0.0001, time + dur * 0.92, 0.06);
        g.connect(this._body('accordion', dest));
        const second = ctx.createGain();
        second.gain.value = SECOND_REED;
        second.connect(g);
        for (const [cents, into, late] of [[-REED_CENTS, g, 0], [REED_CENTS, second, Math.random() / f]]) {
          const o = ctx.createOscillator();
          o.setPeriodicWave(this.reed);
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(into);
          o.start(time + late);
          o.stop(time + dur + 0.35);
        }
        this._release(time, dur + 0.35, VOICE_COST.accordion);
        return;
      }

      // Nylon guitar; see NYLON_LEVEL. The string rings past the note as a
      // plucked string does, and is damped where the note ends.
      case 'nylon': {
        if (!this._budget(time, soft, VOICE_COST.nylon)) return;
        const level = vel * NYLON_LEVEL;
        const ring = NYLON_MELLOW.tau * Math.pow(261.6 / f, 0.35);
        const body = this._body('nylon', dest);
        const stop = time + dur + 0.4;
        for (const [wave, peak, tau] of [
          [this.nylonMellow, level, ring],
          [this.nylonBright, level * NYLON_BRIGHT.share, NYLON_BRIGHT.tau],
        ]) {
          const o = ctx.createOscillator();
          o.setPeriodicWave(wave);
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, time);
          g.gain.exponentialRampToValueAtTime(peak, time + 0.004);
          g.gain.setTargetAtTime(0.0001, time + 0.004, tau);
          g.gain.setTargetAtTime(0.0001, time + dur, 0.08);
          o.connect(g).connect(body);
          o.start(time);
          o.stop(stop);
        }
        this._release(time, dur + 0.4, VOICE_COST.nylon);
        return;
      }

      // Pan flute; see PANFLUTE_LEVEL.
      case 'panflute': {
        if (!this._budget(time, soft, VOICE_COST.panflute)) return;
        const level = vel * PANFLUTE_LEVEL;
        const o = ctx.createOscillator();
        o.setPeriodicWave(this.pipe);
        // The pipe speaks a little flat and rises onto the note.
        o.frequency.setValueAtTime(f * Math.pow(2, -PANFLUTE_DIP / 1200), time);
        o.frequency.exponentialRampToValueAtTime(f, time + 0.05);
        let vib = null;
        if (dur >= VIBRATO_MIN_DUR) {
          vib = ctx.createOscillator();
          vib.frequency.value = 4.8 + Math.random() * 0.8;
          const vibAmt = ctx.createGain();
          const onset = Math.min(0.3, dur * 0.3);
          vibAmt.gain.setValueAtTime(0, time);
          vibAmt.gain.setValueAtTime(0, time + onset);
          vibAmt.gain.linearRampToValueAtTime(8, time + onset + 0.3);
          vib.connect(vibAmt).connect(o.detune);
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(level, time + 0.03);
        g.gain.setTargetAtTime(0.0001, time + dur * 0.85, 0.08);
        o.connect(g).connect(dest);
        // Breath riding the note, lower and fuller than the flute's.
        const air = ctx.createBufferSource();
        air.buffer = this.noise;
        air.loop = true;
        air.playbackRate.value = 0.9 + Math.random() * 0.25;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * 1.5;
        bp.Q.value = 0.9;
        // The chiff is the same breath, spiking as the pipe catches and
        // settling within 30 ms: a puff of air, on the breath's own path
        // rather than a second noise source for every note.
        const ag = ctx.createGain();
        ag.gain.setValueAtTime(0.0001, time);
        ag.gain.exponentialRampToValueAtTime(level * PANFLUTE_CHIFF, time + 0.004);
        ag.gain.exponentialRampToValueAtTime(level * PANFLUTE_BREATH, time + 0.03);
        ag.gain.setTargetAtTime(0.0001, time + dur * 0.85, 0.08);
        air.connect(bp).connect(ag).connect(dest);
        o.start(time);
        air.start(time);
        o.stop(time + dur + 0.4);
        air.stop(time + dur + 0.4);
        if (vib) { vib.start(time); vib.stop(time + dur + 0.4); }
        this._release(time, dur + 0.4, VOICE_COST.panflute);
        return;
      }

      // Piano, the BOTW voice. Two operators at a 1:1 ratio with a fast index
      // decay give the struck-string bite; a detuned second partial and a
      // long tail do the rest. Not a Steinway, but it reads as a piano.
      case 'piano': {
        // Measured piano end-to-end is ~26x a hat, split across the two
        // struck-string partials.
        this.fm(midi, time, dur, vel * 0.9, { soft, out: dest, ratio: 1, index: 340, decay: 0.16, attack: 0.002, cost: 19 });
        this.fm(midi + 12, time, dur * 0.5, vel * 0.16, { soft, out: dest, ratio: 1, index: 120, decay: 0.1, detune: 4, cost: 7 });
        return;
      }


      // Fat detuned analogue pad. Three sawtooths a few cents apart beat
      // against each other; that slow phasing is the whole sound, and it is
      // why one oscillator never sounds like this however it is filtered.
      case 'analogpad': {
        if (!this._budget(time, true, VOICE_COST.analogpad)) return;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 1.6;
        lp.frequency.setValueAtTime(Math.min(900, f * 3), time);
        lp.frequency.linearRampToValueAtTime(Math.min(2600, f * 6), time + Math.min(2, dur * 0.6));
        const g = ctx.createGain();
        const stopAt = time + dur + 1.6;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.17, time + Math.min(0.9, dur * 0.3));
        this._release2(g.gain, time + dur * 0.75, stopAt);
        const oscs = [];
        for (const cents of [-11, 0, 9]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(time);
          oscs.push(o);
        }
        lp.connect(g).connect(dest);
        this._stopClean(g, oscs, time + dur + 1.6);
        this._release(time, dur + 1.6, VOICE_COST.analogpad);
        return;
      }

      case 'analoglead': {
        // Two detuned oscillators through one filter, no pad-scale energy
        // building up: a lead, not the analogpad.
        if (!this._budget(time, soft, VOICE_COST.analoglead)) return;
        // Two soft sources, detuned, under a fixed lowpass. Was two raw saws
        // under a resonant sweep from eight times the note down.
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = LEAD_TONE.analoglead.q;
        lp.frequency.value = LEAD_TONE.analoglead.cutoff;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        // Was 0.16: 3.6 LU over the melody layer's median at 0.4s notes.
        // Trimmed to it, then the soft sources came out 1.8 LU over again
        // and gave that back (0.1057 -> 0.0861).
        g.gain.exponentialRampToValueAtTime(vel * 0.0861, time + 0.03);
        g.gain.setTargetAtTime(0.0001, time + dur * 0.7, 0.18);
        for (const cents of [-7, 6]) {
          const o = ctx.createOscillator();
          o.setPeriodicWave(this.leads.analoglead);
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(time);
          o.stop(time + dur + 0.8);
        }
        lp.connect(g).connect(dest);
        this._release(time, dur + 0.8, VOICE_COST.analoglead);
        return;
      }

      // Prepared piano: felt between the hammers and the strings. The tone
      // loses its upper partials and shortens, and you hear the mechanism --
      // a wooden knock alongside the note rather than underneath it.
      case 'prepared': {
        // Measured ~25x a hat, split across the strike, the knock, and the
        // detuned second strike.
        this.fm(midi, time, dur * 0.7, vel * 0.85, { soft,
          out: dest, ratio: 1, index: 200, decay: 0.1, attack: 0.002, cost: 15,
        });
        if (!this._budget(time, soft, 3)) return;
        const knock = this._noiseSource(time, 0.05);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 220 + Math.random() * 180;
        bp.Q.value = 3.5;
        const kg = ctx.createGain();
        kg.gain.setValueAtTime(vel * 0.13, time);
        kg.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
        knock.connect(bp).connect(kg).connect(dest);
        // A touch of detuning: nothing prepared stays in tune.
        this.fm(midi, time + 0.004, dur * 0.45, vel * 0.2, { soft,
          out: dest, ratio: 1, index: 90, decay: 0.08, detune: 9, cost: 7,
        });
        this._release(time, dur + 0.4, 3);
        return;
      }

      case 'celeste':
        this.fm(midi, time, dur, vel * 0.9, { soft, out: dest, ratio: 4, index: 200, decay: 0.5, cost: VOICE_COST.celeste });
        return;

      // Short filtered chord stab. The repeating fragment that hypnotic
      // house is built from: too brief to be a chord, too pitched to be a
      // drum, and it survives being heard a thousand times.
      case 'stab': {
        if (!this._budget(time, soft)) return;
        const len = Math.min(dur, 0.22);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(Math.min(3400, f * 3.2), time);
        bp.Q.value = 2.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * 0.3, time + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, time + len);
        for (const cents of [-6, 7]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(bp);
          o.start(time);
          o.stop(time + len + 0.1);
        }
        bp.connect(g).connect(dest);
        this._release(time, len + 0.2);
        return;
      }

      // Kalimba: a plucked metal tine. Bright inharmonic attack that dies
      // away almost at once, over a soft wooden thump from the box. The
      // shortness is the character -- a tine has almost no sustain.
      case 'kalimba': {
        this.fm(midi, time, Math.min(dur, 1.1), vel, {
          soft,
          out: dest, ratio: 3.7, index: 260, decay: 0.09, attack: 0.002, cost: 8,
        });
        if (!this._budget(time, soft, 3)) return;
        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(midiToFreq(midi - 12), time);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, time);
        bg.gain.exponentialRampToValueAtTime(vel * 0.12, time + 0.004);
        bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
        body.connect(bg).connect(dest);
        body.start(time);
        body.stop(time + 0.2);
        this._release(time, 0.25, 3);
        return;
      }

      // Marimba: wood rather than metal. The bar's fourth partial is what
      // makes it read as wooden, and it decays slower and darker than a tine.
      case 'marimba': {
        this.fm(midi, time, Math.min(dur, 1.6), vel, {
          soft,
          out: dest, ratio: 4, index: 190, decay: 0.16, attack: 0.003, cost: 9,
        });
        return;
      }

      // A synthetic human vowel.
      //
      // The first version ran a sawtooth through three parallel bandpass
      // filters. That is the obvious way to build formants and it is why it
      // sounded like a synth: bandpasses keep only the formant bands and
      // throw away everything between them, leaving a thin, hollow buzz. A
      // vocal tract does the opposite -- it resonates a full glottal
      // spectrum, lifting some regions and leaving the rest present. So the
      // filters are now *peaking* filters in series, and the whole harmonic
      // series survives.
      //
      // The other half of sounding human is instability. A perfectly steady
      // pitch is the single most synthetic thing a voice can do, so every
      // note gets jitter (small random pitch drift), a scoop into the note,
      // vibrato whose rate and depth differ per note, and a breath at the
      // onset.
      case 'vowel':
      case 'hum':
      case 'choir': {
        const humming = name === 'hum';
        const choral = name === 'choir';

        // [centre Hz, bandwidth Hz, boost dB]. Bandwidth matters as much as
        // centre: too wide and the vowel blurs into a filter sweep.
        const VOWELS = {
          a: [[800, 80, 16], [1150, 90, 13], [2900, 130, 9]],
          e: [[400, 60, 16], [1600, 80, 13], [2700, 130, 9]],
          o: [[450, 70, 17], [800, 80, 12], [2830, 120, 7]],
          u: [[325, 50, 17], [700, 60, 11], [2530, 170, 6]],
        };
        // The composer supplies the vowel. The fallback is fixed rather
        // than pitch-derived: deriving it from the note number changed the
        // vowel on every note and made every loop in a given register sing
        // the same sequence.
        const vowelKey = opts.vowel || 'a';
        // A closed mouth: one low nasal resonance, nothing up top.
        const formants = humming
          ? [[280, 60, 18], [1100, 100, 8], [2200, 160, 3]]
          : VOWELS[vowelKey] || VOWELS.a;

        // Movement within the note.
        //
        // The vowel itself belongs to the composition -- one per phrase,
        // shared across a chord -- and that is right. What it cannot say is
        // what happens *during* a held note. A singer holding a bar does not
        // hold one mouth shape for it: the jaw gives, the vowel opens or
        // closes, and the formants migrate with it. That migration is most
        // of the difference between a formant filter and something sung.
        //
        // It is decided here rather than in the composer for two reasons.
        // The composer's random stream is what a share code replays, so one
        // extra draw there renumbers every decision after it and every code
        // in circulation renders as different music. And it is the wrong
        // place to ask the question anyway: the composer knows a note's
        // length in steps, and whether a vowel has time to travel is a
        // question about seconds. So this sits beside the scoop, the jitter
        // and the vibrato, which are per-note for the same reason.
        //
        // How far this note is into "long". Nothing moves under half a
        // second: a mouth that crosses a whole vowel that fast has sung a
        // diphthong, and a diphthong is a word. Full travel from two
        // seconds up, which is a sustain by any reading.
        const held = Math.min(1, Math.max(0, (dur - 0.5) / 1.5));
        // Both the likelihood and the depth follow that, so the two never
        // disagree: a note just over the floor seldom moves and barely moves
        // when it does, and one held two seconds always moves and travels
        // the whole way. A long note that kept still would be the odd one.
        const drifts = held > 0 && Math.random() < held;
        const depth = 0.34 + held * 0.66;
        // Where a held vowel goes: one rung along the open/close axis,
        // never across it. F1 is the openness formant -- a 800, o 450,
        // e 400, u 325 -- and a neighbouring rung glides, which the ear
        // hears as one vowel changing shape. A jump across the ladder
        // ("eh" straight into "oo") is two vowels in succession, which is
        // a word again.
        const DRIFT_TO = { a: ['o', 'e'], e: ['a'], o: ['u', 'a'], u: ['o'] };
        // A hum has no vowel to move to, and it still opens: the same
        // closed tract relaxing, which is what a long hum does by itself.
        const OPEN_HUM = [[330, 70, 16.5], [1200, 110, 10], [2350, 170, 5]];
        let target = null;
        if (drifts) {
          const to = DRIFT_TO[vowelKey] || DRIFT_TO.a;
          target = humming ? OPEN_HUM : VOWELS[to[Math.floor(Math.random() * to.length)]];
        }

        const cost = (choral ? 34 : humming ? 16 : 22) + (target ? VOWEL_DRIFT_COST : 0);
        if (!this._budget(time, soft, cost)) return;

        const amp = ctx.createGain();
        const stopAt = time + dur + 0.9;
        amp.gain.setValueAtTime(0.0001, time);
        // Levels measured, not guessed. The humming tract puts an 18dB boost
        // at 280Hz, which lands directly on a triangle wave's fundamental
        // and made it four times louder than every other voice.
        //
        // The open voices carry a trim for the glottal source. A
        // PeriodicWave is normalised when it is built, and a 1/n^2.5 wave
        // is a far smoother shape than a sawtooth, so the same nominal
        // amplitude arrives several dB louder. The figures below are
        // measured A-weighted rather than as raw RMS: what "no quieter, and
        // no louder, in the mix" means is what a listener hears, and
        // changing the top of a spectrum moves the two by different
        // amounts.
        amp.gain.linearRampToValueAtTime(vel * (choral ? 0.112 : humming ? 0.085 : 0.174),
          time + Math.min(0.3, dur * 0.25));
        this._release2(amp.gain, time + dur * 0.72, stopAt);
        amp.connect(dest);

        // Series peaking filters, then a lowpass standing in for the steeper
        // rolloff of a glottal pulse: a raw sawtooth is far too bright and
        // reads as buzz rather than voice.
        //
        // A moving vowel moves these same filters rather than crossfading
        // into a second set of them. Two banks summed is not one tract
        // travelling: their phase responses differ, so the sum combs, which
        // sounds like a flanger rather than like a mouth. Sliding the
        // resonances means every instant in between is a real vowel shape,
        // and it adds no nodes at all -- the whole of the extra cost is the
        // filter having to recompute its coefficients while a parameter is
        // in motion, which is what VOWEL_DRIFT_COST pays for.
        let head = null;
        let tail = null;
        // Hold the vowel, then travel. Leaving at the attack and arriving
        // early reads as a filter sweep laid over the note; the move belongs
        // in its second half, which is where a held note's jaw actually
        // gives. It lands before the release so the tail sings the vowel it
        // arrived at.
        const leaveAt = time + dur * 0.35;
        const landAt = time + dur * 0.85;
        formants.forEach(([hz, bw, gainDb], i) => {
          const bq = ctx.createBiquadFilter();
          bq.type = 'peaking';
          bq.frequency.value = hz;
          bq.Q.value = hz / bw;
          bq.gain.value = gainDb;
          if (target) {
            // Part of the way there, not all of it, unless the note is long
            // enough to have earned the whole distance.
            const part = (from, to) => from + (to - from) * depth;
            const [thz, tbw, tgain] = target[i];
            bq.frequency.setValueAtTime(hz, leaveAt);
            bq.frequency.linearRampToValueAtTime(part(hz, thz), landAt);
            bq.Q.setValueAtTime(hz / bw, leaveAt);
            bq.Q.linearRampToValueAtTime(part(hz, thz) / part(bw, tbw), landAt);
            bq.gain.setValueAtTime(gainDb, leaveAt);
            bq.gain.linearRampToValueAtTime(part(gainDb, tgain), landAt);
          }
          if (!head) head = bq; else tail.connect(bq);
          tail = bq;
        });
        // The corner, brought down to where it does some work.
        //
        // This voice was harsh, and the cause was arithmetic rather than
        // taste. The source was a sawtooth, falling at 6dB an octave where
        // a voice falls at 12 or more, so every harmonic above the first
        // formant arrived at roughly twice the level a throat would have
        // sent it. The lowpass that was supposed to stand in for the
        // difference sat at 3400Hz -- above the entire region that matters,
        // and a filter contributes nothing below its own corner. What was
        // left was full sawtooth brightness from 1kHz to 3.4kHz with a
        // narrow F3 resonance of +6 to +9dB sitting on top of it at
        // 2.5-2.9kHz, which is exactly where hearing is sharpest.
        //
        // Measured with `node tools/measure.mjs --voice`: 12.2% of this
        // voice's A-weighted energy landed between 2 and 5kHz, and 28% of
        // it on the worst note of two octaves. The struck voices it shares
        // a mix with are at 0.0-0.2%, and a hum -- the same code with a
        // closed tract and a 1700Hz corner -- is at 0.2%.
        //
        // The fix is at the source (see `_makeGlottal`), not here. A high
        // shelf taking 24dB off everything above 1800Hz was built first and
        // worked, but it cost a filter node on every note forever -- 12% of
        // the voice, measured -- to undo a slope that could simply not be
        // generated in the first place. This corner moved from 3400 to 2600
        // to finish the job, and that is the whole of the change in here.
        //
        // A hum is left alone: its corner is already at 1700, its source is
        // already a triangle, and it already measured 0.2%.
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 0.7;
        lp.frequency.value = humming ? 1700 : 2600;
        tail.connect(lp).connect(amp);

        // A choir is several of these sharing one tract: the filters are the
        // expensive part, so extra singers cost little. Each gets its own
        // detune and its own vibrato rate, which is what makes a group read
        // as a group rather than as one voice through a chorus pedal.
        const singers = choral ? 3 : 1;
        const sources = [];
        // A standing offset in cents, written by the composer. Item 12
        // gives the two layers of a choir loop opposite ones so they beat
        // against each other for the whole loop rather than only where
        // their own jitter happens to disagree.
        const lean = opts.detune || 0;
        for (let i = 0; i < singers; i++) {
          const src = ctx.createOscillator();
          // A hum keeps its triangle: a closed mouth is a different source
          // and it was never the harsh one.
          if (humming) src.type = 'triangle';
          else src.setPeriodicWave(this.glottal);
          src.frequency.value = f;

          const spread = lean + (choral ? (i - 1) * (7 + Math.random() * 6) : 0);
          // Scoop into the note. Singers arrive at a pitch, they do not
          // start on it.
          src.detune.setValueAtTime(spread - 22 - Math.random() * 14, time);
          src.detune.linearRampToValueAtTime(spread, time + 0.06 + Math.random() * 0.05);
          // Jitter: small random drift for the rest of the note, scheduled
          // straight onto the param so it costs no extra nodes.
          let t = time + 0.12;
          while (t < time + dur) {
            src.detune.linearRampToValueAtTime(spread + (Math.random() - 0.5) * 11, t);
            t += 0.09 + Math.random() * 0.08;
          }

          const vib = ctx.createOscillator();
          vib.frequency.value = 4.3 + Math.random() * 1.8;
          const vibAmt = ctx.createGain();
          vibAmt.gain.setValueAtTime(0, time);
          vibAmt.gain.linearRampToValueAtTime(
            (humming ? 5 : 9) + Math.random() * 4,
            time + Math.min(0.9, dur * 0.55) + Math.random() * 0.2
          );
          vib.connect(vibAmt).connect(src.detune);

          src.connect(head);
          src.start(time);
          vib.start(time);
          sources.push(src, vib);
        }

        // Aspiration. Strongest at the onset, then settling back -- this is
        // most of what separates a sung note from an organ note.
        const breath = ctx.createBufferSource();
        breath.buffer = this.noise;
        breath.loop = true;
        breath.playbackRate.value = 0.8 + Math.random() * 0.4;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = humming ? 900 : 2200;
        bp.Q.value = 0.8;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, time);
        bg.gain.linearRampToValueAtTime(vel * (humming ? 0.05 : 0.1), time + 0.04);
        bg.gain.exponentialRampToValueAtTime(Math.max(0.0005, vel * 0.02), time + 0.3);
        bg.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.15);
        breath.connect(bp).connect(bg).connect(amp);
        breath.start(time);
        breath.stop(stopAt);

        this._stopClean(amp, sources, stopAt);
        this._release(time, dur + 0.9, cost);
        return;
      }

      // A struck bowl or temple bell. The defining feature is not brightness
      // but *beating*: two partials a few cents apart drifting in and out of
      // phase, which is the slow shimmer you hear standing next to a real
      // bowl. A single FM voice cannot do that however inharmonic it is,
      // which is why the existing bell voices all sound like the same object.
      case 'templebell': {
        if (!this._budget(time, soft, VOICE_COST.templebell)) return;
        const hold = Math.max(dur, 6.5);
        const stopAt = time + hold + 1.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * 0.3, time + 0.006);
        this._release2(g.gain, time + 0.02, stopAt);
        g.connect(dest);

        // Struck metal is inharmonic: these ratios are roughly a bowl's.
        const partials = [[1, 1], [2.02, 0.5], [2.76, 0.32], [5.4, 0.14]];
        const oscs = [];
        for (const [ratio, amp] of partials) {
          // Each partial is a close pair, and the pair is what beats.
          for (const cents of [-4, 4]) {
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = f * ratio;
            o.detune.value = cents + (Math.random() - 0.5) * 3;
            const pg = ctx.createGain();
            pg.gain.setValueAtTime(BELL_PARTIAL_VEL * amp * 0.5, time);
            // Higher partials die first, as they do on real metal.
            pg.gain.exponentialRampToValueAtTime(0.0001, time + hold / (0.55 + ratio * 0.3));
            o.connect(pg).connect(g);
            o.start(time);
            oscs.push(o);
          }
        }
        const strike = this._noiseSource(time, 0.03);
        const sf = ctx.createBiquadFilter();
        sf.type = 'bandpass';
        sf.frequency.value = f * 6;
        sf.Q.value = 1.2;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(BELL_PARTIAL_VEL * 0.18, time);
        sg.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
        strike.connect(sf).connect(sg).connect(g);

        this._stopClean(g, oscs, stopAt);
        this._release(time, hold + 1.4, VOICE_COST.templebell);
        return;
      }

      // Church or orchestral tubular bell. Brighter and more pitched than a
      // bowl, with the strong minor-third partial that gives chimes their
      // particular sourness, and a long even decay.
      case 'tubular': {
        if (!this._budget(time, soft, VOICE_COST.tubular)) return;
        const hold = Math.max(dur, 5);
        const stopAt = time + hold + 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * 0.26, time + 0.004);
        this._release2(g.gain, time + 0.02, stopAt);
        g.connect(dest);

        const partials = [[1, 0.8], [1.19, 0.6], [1.56, 0.4], [2, 0.5], [2.71, 0.22]];
        const oscs = [];
        for (const [ratio, amp] of partials) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f * ratio;
          o.detune.value = (Math.random() - 0.5) * 6;
          const pg = ctx.createGain();
          pg.gain.setValueAtTime(BELL_PARTIAL_VEL * amp * 0.62, time);
          pg.gain.exponentialRampToValueAtTime(0.0001, time + hold / (0.5 + ratio * 0.28));
          o.connect(pg).connect(g);
          o.start(time);
          oscs.push(o);
        }
        this._stopClean(g, oscs, stopAt);
        this._release(time, hold + 1.2, VOICE_COST.tubular);
        return;
      }

      case 'musicbox':
        this.fm(midi, time, dur * 0.9, vel, { soft, out: dest, ratio: 5.1, index: 420, decay: 0.45, cost: VOICE_COST.musicbox });
        return;

      // Fender Rhodes: the classic 2:1 bell-ish FM electric piano.
      case 'rhodes':
        this.fm(midi, time, dur, vel, { soft, out: dest, ratio: 2, index: 190, decay: 0.5, attack: 0.004, cost: VOICE_COST.rhodes });
        return;

      // Garson's Moog: one oscillator, portamento, and a resonant filter
      // sweep. Monophonic by nature, which is why it is a lead and not a pad.
      case 'moog':
      case 'whistle': {
        const whistle = name === 'whistle';
        if (!this._budget(time, soft, VOICE_COST[name])) return;
        const o = ctx.createOscillator();
        if (whistle) o.type = 'triangle';
        else o.setPeriodicWave(this.leads.moog);
        // Only the whistle slides: the moog shares this case but is a lead
        // synth and not a wind instrument, and item 9 is about winds.
        //
        // The `opts.glide` branch below is kept because the bass voices
        // set `glide` and a future melody could, but note that nothing
        // reaches it today: `glide` is written onto bass events only, and
        // the bass has its own method. It has been dead since it was
        // written, which is part of why nothing here ever glided.
        if (whistle && this._slide(o.frequency, midi, time, dur, opts)) {
          // slid into
        } else if (opts.glide) {
          o.frequency.setValueAtTime(f * 0.75, time);
          o.frequency.exponentialRampToValueAtTime(f, time + 0.09);
        } else {
          o.frequency.setValueAtTime(f, time);
        }
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.6;
        const vibAmt = ctx.createGain();
        vibAmt.gain.setValueAtTime(0, time);
        vibAmt.gain.linearRampToValueAtTime(whistle ? 12 : 5, time + Math.min(0.6, dur));
        vib.connect(vibAmt).connect(o.detune);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        if (whistle) {
          lp.Q.value = 8;
          lp.frequency.setValueAtTime(Math.min(9000, f * 7), time);
          lp.frequency.exponentialRampToValueAtTime(Math.max(220, f * 1.6), time + Math.max(0.12, dur * 0.8));
        } else {
          // The moog's filter still moves, gently: open a little at the
          // attack, settling. Was a sweep from seven times the note down to
          // 1.6 times it through a resonance of 11 dB, a wah on every note.
          lp.Q.value = LEAD_TONE.moog.q;
          lp.frequency.setValueAtTime(LEAD_TONE.moog.open, time);
          lp.frequency.exponentialRampToValueAtTime(LEAD_TONE.moog.settle, time + Math.max(0.12, dur * 0.8));
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        // Were 0.22 and 0.2: the whistle 5.9 LU and the moog 5.4 LU over the
        // melody layer's median at 0.4s notes. Trimmed to it; timbre untouched.
        // The moog's soft source then came out 1.1 LU over, and gave that
        // back (0.1069 -> 0.0947).
        g.gain.exponentialRampToValueAtTime(vel * (whistle ? 0.1121 : 0.0947), time + 0.014);
        g.gain.setTargetAtTime(0.0001, time + dur * 0.75, 0.1);
        o.connect(lp).connect(g).connect(dest);
        o.start(time); vib.start(time);
        o.stop(time + dur + 0.5); vib.stop(time + dur + 0.5);
        this._release(time, dur + 0.5, VOICE_COST[name]);
        return;
      }

      // The old 'choir' lived here: three detuned saws through a lowpass,
      // with no formants at all. That is a string pad, which is exactly what
      // it sounded like. It is now handled with the vowel voices above,
      // where it gets a vocal tract and three independently wavering
      // singers. Renamed rather than deleted so the pad remains available
      // to the profiles that actually wanted a pad.
      case 'softpad': {
        if (!this._budget(time, true, VOICE_COST.pad)) return;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(700, time);
        lp.frequency.linearRampToValueAtTime(1500, time + dur * 0.5);
        const g = ctx.createGain();
        const stopAt = time + dur + 1.8;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.16, time + Math.min(1.4, dur * 0.45));
        this._release2(g.gain, time + dur * 0.7, stopAt);
        const oscs = [];
        for (const cents of [-9, 0, 11]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(time);
          oscs.push(o);
        }
        lp.connect(g).connect(dest);
        this._stopClean(g, oscs, stopAt);
        this._release(time, dur + 1.8, VOICE_COST.pad);
        return;
      }

      case 'sine': {
        if (!this._budget(time, soft)) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        const stopAt = time + dur + 1;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.24, time + Math.min(0.5, dur * 0.3));
        this._release2(g.gain, time + dur * 0.7, stopAt);
        o.connect(g).connect(dest);
        o.start(time);
        this._stopClean(g, [o], time + dur + 1);
        this._release(time, dur + 1);
        return;
      }

      case 'moogpad':
        this.pad([midi], time, dur, vel, dest);
        return;

      default:
        this.pluck(midi, time, dur, vel, name, soft, dest);
    }
  }

  // ------------------------------------------------------------ texture

  texture(kind, notes, time, dur, vel, opts = {}) {
    const ctx = this.ctx;
    const out = this.channels.texture.gain;
    const soft = true; // background: first to yield when the graph is full
    if (kind === 'swell') {
      for (const midi of notes) {
        if (!this._budget(time, soft)) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = midiToFreq(midi);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.3, time + dur * 0.45);
        g.gain.linearRampToValueAtTime(0.0001, time + dur);
        o.connect(g).connect(out);
        o.start(time);
        o.stop(time + dur + 0.2);
        this._release(time, dur + 0.2);
      }
    } else if (kind === 'bell') {
      this.fm(notes[0], time, dur, vel, { out, ratio: 5.1, index: 300, decay: 1.1, cost: VOICE_COST.bell });
    } else if (kind === 'chime') {
      this.fm(notes[0], time, dur, vel, { out, ratio: 2.76, index: 230, decay: 1.6, attack: 0.004, cost: VOICE_COST.chime });
    } else if (kind === 'drop') {
      if (!this._budget(time, soft)) return;
      const src = this._noiseSource(time, 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400 + Math.random() * 3000, time);
      bp.Q.value = 9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vel * 0.3, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
      src.connect(bp).connect(g).connect(out);
      this._release(time, 0.15);
    } else if (kind === 'wind') {
      if (!this._budget(time, soft)) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.6;
      src.start(time);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      // Band varies per segment, so successive gusts are not the same gust.
      bp.frequency.value = opts.band || 620;
      bp.Q.value = 1.1;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.06;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 280;
      lfo.connect(lfoG).connect(bp.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      // Swell in and back out inside the segment rather than sitting flat.
      g.gain.linearRampToValueAtTime(vel * 0.32, time + Math.max(0.8, dur * 0.4));
      g.gain.setTargetAtTime(0.0001, time + dur * 0.75, Math.max(0.4, dur * 0.2));
      src.connect(bp).connect(g).connect(out);
      lfo.start(time);
      lfo.stop(time + dur + 1);
      src.stop(time + dur + 1);
      this._release(time, dur + 1);
    } else if (kind === 'waves') {
      if (!this._budget(time, soft, VOICE_COST.waves)) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.1;
      src.start(time, Math.random() * 1.5);
      const crest = time + dur * 0.4;
      const filters = [0, 1].map(() => {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = -3;
        lp.frequency.setValueAtTime(WAVES_CUTOFF * 0.7, time);
        lp.frequency.linearRampToValueAtTime(WAVES_CUTOFF, crest);
        lp.frequency.linearRampToValueAtTime(WAVES_CUTOFF * 0.7, time + dur);
        return lp;
      });
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(vel * WAVES_LEVEL, crest);
      g.gain.linearRampToValueAtTime(0.0001, time + dur);
      src.connect(filters[0]).connect(filters[1]).connect(g).connect(out);
      src.stop(time + dur + 0.1);
      this._release(time, dur + 0.1, VOICE_COST.waves);
    }
  }
}
