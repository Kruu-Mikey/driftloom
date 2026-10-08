//! The voices, each a port of its JavaScript twin in `js/synth.js`, call
//! for call: the same oscillators, the same parameter calls at the same
//! times, so each curve comes out the same. What a note needs from the
//! JavaScript side -- its pitch, time, length, velocity, which parts of it
//! the voice budget let through, and any random draws -- arrives with it.
//!
//! Every voice's `new` is all zeros, so a pool of them costs nothing in the
//! `.wasm` (a static that is all zeros is not written into the file);
//! `play` sets every value a note reads.

use crate::QUANTUM;
use crate::filter::{Biquad, Kind};
use crate::osc::{Part, Pitch, TableOsc};
use crate::param::Param;
use crate::wave::Waves;

/// `midiToFreq` in `js/theory.js`.
pub fn midi_to_freq(midi: f64) -> f64 {
    440.0 * 2f64.powf((midi - 69.0) / 12.0)
}

/// A GainNode's gain, before anything is scheduled on it.
const UNITY: f32 = 1.0;
/// An OscillatorNode's frequency, likewise.
const A440: f32 = 440.0;

/// A block's worth of a parameter, frame by frame.
type Block = [f32; QUANTUM];

/// How an oscillator whose frequency is a parameter is pitched for the
/// block starting at `block`: moving, frame by frame, while Web Audio would
/// render the parameter sample by sample, and otherwise steady at its value
/// (see `osc`). `freq` is filled when it moves. `first` is whether the
/// oscillator starts in this block: its events are clamped to the block
/// then, as Chromium does (`Param::clamp_before`) -- after deciding whether
/// it moves, as Chromium decides that first too.
fn pitch_of<'a>(
    p: &mut Param,
    block: u64,
    rate: f64,
    first: bool,
    freq: &'a mut Block,
    detune: Part<'a>,
) -> Pitch<'a> {
    let from = block as f64 / rate;
    let moving = p.moving_from(from, QUANTUM as f64 / rate);
    if first {
        p.clamp_before(from);
    }
    if moving {
        p.fill(block, rate, freq);
    }
    match (moving, detune) {
        (false, Part::Steady(d)) => Pitch::Steady {
            freq: p.value_at(from),
            detune: d,
        },
        (true, detune) => Pitch::Moving {
            freq: Part::Moving(freq),
            detune,
        },
        (false, detune) => Pitch::Moving {
            freq: Part::Steady(p.value_at(from)),
            detune,
        },
    }
}

/// Whether an oscillator starting at frame `start` starts in the block
/// from frame `block`.
fn starts_in(start: u64, block: u64) -> bool {
    start >= block && start < block + QUANTUM as u64
}

/// The options `fm()` reads.
pub struct FmOptions {
    pub ratio: f64,
    pub index: f64,
    pub attack: f64,
    pub decay: f64,
    pub detune: f64,
}

/// `fm()`: two-operator FM. A sine modulator, its depth falling from
/// `index * vel` Hz across the decay, into the frequency of a sine carrier
/// under an envelope that strikes, decays across the note and releases to
/// silence 1.2 s after it.
pub struct Fm {
    carrier: TableOsc,
    modulator: TableOsc,
    depth: Param,
    envelope: Param,
    pitch: f32,
    mod_pitch: f32,
    detune: f32,
}

impl Fm {
    pub const fn new() -> Self {
        Fm {
            carrier: TableOsc::new(),
            modulator: TableOsc::new(),
            depth: Param::new(0.0),
            envelope: Param::new(0.0),
            pitch: 0.0,
            mod_pitch: 0.0,
            detune: 0.0,
        }
    }

    pub fn strike(&mut self, f: f64, time: f64, dur: f64, vel: f64, o: &FmOptions, rate: f64) {
        self.pitch = f as f32;
        self.mod_pitch = (f * o.ratio) as f32;
        self.detune = o.detune as f32;

        let depth = &mut self.depth;
        depth.reset(UNITY);
        depth.set_value_at_time((o.index * vel) as f32, time);
        depth.exponential_ramp_to_value_at_time(
            (o.index * 0.06).max(1.0) as f32,
            time + o.decay.min(0.9),
            time,
        );

        let peak = (vel * 0.26).max(0.001);
        let stop = time + dur + 1.2;
        let g = &mut self.envelope;
        g.reset(UNITY);
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time(peak as f32, time + o.attack, time);
        let from = time + (dur * 0.7).max(0.08);
        g.exponential_ramp_to_value_at_time((peak * 0.3).max(0.0008) as f32, from, time);
        release(g, from, stop, time);

        self.carrier.schedule(time, stop + 0.01, rate);
        self.modulator.schedule(time, stop + 0.01, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.carrier.start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.carrier.stop_frame().max(self.modulator.stop_frame())
    }

    /// Add this block of the note into `out`.
    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        let mut wave = [0.0; QUANTUM];
        // The modulator's frequency never moves.
        let steady = Pitch::Steady {
            freq: self.mod_pitch,
            detune: 0.0,
        };
        let (lo, hi) = self
            .modulator
            .render(block, &waves.sine, &steady, r, &mut wave);
        // The carrier's frequency at every frame of the block: its own pitch
        // plus the modulator through its depth, as Web Audio sums an
        // AudioParam's value and its input. Connected, so it always moves.
        // The depth's gain node feeds only the carrier's frequency, so like
        // the carrier's own events it is first rendered when the carrier
        // starts, and its events are clamped to that block.
        if starts_in(self.carrier.start_frame(), block) {
            self.depth.clamp_before(block as f64 / rate);
        }
        let mut depth = [0.0; QUANTUM];
        self.depth.fill(block, rate, &mut depth);
        let mut freq = [self.pitch; QUANTUM];
        for ((f, w), d) in freq
            .iter_mut()
            .zip(wave.iter())
            .zip(depth.iter())
            .take(hi)
            .skip(lo)
        {
            *f += *w * *d;
        }
        let carrier = Pitch::Moving {
            freq: Part::Moving(&freq),
            detune: Part::Steady(self.detune),
        };
        let (lo, hi) = self
            .carrier
            .render(block, &waves.sine, &carrier, r, &mut wave);
        let mut envelope = [0.0; QUANTUM];
        self.envelope.fill(block, rate, &mut envelope);
        for ((y, w), g) in out
            .iter_mut()
            .zip(wave.iter())
            .zip(envelope.iter())
            .take(hi)
            .skip(lo)
        {
            *y += *w * *g;
        }
    }
}

impl Default for Fm {
    fn default() -> Self {
        Self::new()
    }
}

/// `_release2`: from wherever the envelope has got to, an exponential fall
/// to `floor`, then a short line to true zero at `to`.
fn release(g: &mut Param, from: f64, to: f64, now: f64) {
    const FLOOR: f32 = 0.0006;
    g.exponential_ramp_to_value_at_time(FLOOR, (from + 0.01).max(to - 0.025), now);
    g.linear_ramp_to_value_at_time(0.0, to, now);
}

/// The kalimba's FM strike, as `voice('kalimba')` asks `fm()` for it.
const KALIMBA_STRIKE: FmOptions = FmOptions {
    ratio: 3.7,
    index: 260.0,
    decay: 0.09,
    attack: 0.002,
    detune: 0.0,
};
/// The longest note the strike is given.
pub const KALIMBA_LONGEST: f64 = 1.1;

/// Which parts of a kalimba note the voice budget let through: in the
/// JavaScript voice the strike and the body ask for room separately, and
/// either can be refused alone.
pub const STRIKE: u32 = 1;
pub const BODY: u32 = 2;

/// Kalimba: a plucked metal tine. A bright inharmonic FM strike that dies
/// away almost at once, over a soft wooden thump from the box -- a sine an
/// octave down, gone in a fifth of a second.
pub struct Kalimba {
    strike: Fm,
    body: TableOsc,
    body_pitch: Param,
    body_gain: Param,
    parts: u32,
}

impl Kalimba {
    pub const fn new() -> Self {
        Kalimba {
            strike: Fm::new(),
            body: TableOsc::new(),
            body_pitch: Param::new(0.0),
            body_gain: Param::new(0.0),
            parts: 0,
        }
    }

    pub fn play(&mut self, midi: f64, time: f64, dur: f64, vel: f64, parts: u32, rate: f64) {
        self.parts = parts;
        if parts & STRIKE != 0 {
            let f = midi_to_freq(midi);
            self.strike.strike(
                f,
                time,
                dur.min(KALIMBA_LONGEST),
                vel,
                &KALIMBA_STRIKE,
                rate,
            );
        }
        if parts & BODY != 0 {
            self.body_pitch.reset(A440);
            self.body_pitch
                .set_value_at_time(midi_to_freq(midi - 12.0) as f32, time);
            let g = &mut self.body_gain;
            g.reset(UNITY);
            g.set_value_at_time(0.0001, time);
            g.exponential_ramp_to_value_at_time((vel * 0.12) as f32, time + 0.004, time);
            g.exponential_ramp_to_value_at_time(0.0001, time + 0.16, time);
            self.body.schedule(time, time + 0.2, rate);
        }
    }

    pub fn start_frame(&self) -> u64 {
        let mut at = u64::MAX;
        if self.parts & STRIKE != 0 {
            at = at.min(self.strike.start_frame());
        }
        if self.parts & BODY != 0 {
            at = at.min(self.body.start_frame());
        }
        at
    }

    pub fn end_frame(&self) -> u64 {
        let mut at = 0;
        if self.parts & STRIKE != 0 {
            at = at.max(self.strike.end_frame());
        }
        if self.parts & BODY != 0 {
            at = at.max(self.body.stop_frame());
        }
        at
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        if self.parts & STRIKE != 0 {
            self.strike.render(block, rate, waves, out);
        }
        if self.parts & BODY != 0 && block < self.body.stop_frame() {
            let mut freq = [0.0; QUANTUM];
            let first = starts_in(self.body.start_frame(), block);
            let pitch = pitch_of(
                &mut self.body_pitch,
                block,
                rate,
                first,
                &mut freq,
                Part::Steady(0.0),
            );
            let mut wave = [0.0; QUANTUM];
            let (lo, hi) = self
                .body
                .render(block, &waves.sine, &pitch, rate as f32, &mut wave);
            let mut gain = [0.0; QUANTUM];
            self.body_gain.fill(block, rate, &mut gain);
            for ((y, w), g) in out
                .iter_mut()
                .zip(wave.iter())
                .zip(gain.iter())
                .take(hi)
                .skip(lo)
            {
                *y += *w * *g;
            }
        }
    }
}

impl Default for Kalimba {
    fn default() -> Self {
        Self::new()
    }
}

/// The fiddle's level, to its layer's median (`FIDDLE_LEVEL` in synth.js).
const FIDDLE_LEVEL: f64 = 0.0736;
/// A slurred note is not attacked again, beyond the few ms that keep it
/// from clicking (`SLUR_ATTACK`).
const SLUR_ATTACK: f64 = 0.012;
/// The widest step a slur glides across, in semitones (`SLIDE_MAX_STEP`).
const SLUR_MAX_STEP: f64 = 5.0;

/// `speak`: how long a note takes to arrive, by its length.
fn speak(dur: f64) -> f64 {
    (0.015 + dur * 0.06).clamp(0.02, 0.1)
}

/// The vibrato a long fiddle note draws in JavaScript (three `Math.random`
/// draws, in this order): its rate at the start and the end of the note,
/// in Hz, and its depth in cents.
#[derive(Clone, Copy)]
pub struct Vibrato {
    pub rate: f64,
    pub rate_end: f64,
    pub depth: f64,
}

/// Fiddle: a bowed string. The `bowed` wave through the violin's body (one
/// per channel, in `Core`), an attack sized to the note, a slur from the
/// note before when it is joined to it, and on long notes a vibrato that
/// rides on the detune, arriving once the note has settled.
pub struct Fiddle {
    osc: TableOsc,
    pitch: Param,
    vibrato: bool,
    lfo: TableOsc,
    lfo_rate: Param,
    lfo_depth: Param,
    envelope: Param,
}

impl Fiddle {
    pub const fn new() -> Self {
        Fiddle {
            osc: TableOsc::new(),
            pitch: Param::new(0.0),
            vibrato: false,
            lfo: TableOsc::new(),
            lfo_rate: Param::new(0.0),
            lfo_depth: Param::new(0.0),
            envelope: Param::new(0.0),
        }
    }

    /// `prev` is the note this one is joined to, if any (`opts.prev`).
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        prev: Option<f64>,
        vib: Option<Vibrato>,
        rate: f64,
    ) {
        let f = midi_to_freq(midi);
        // `_slur`: from the last note to this one, a little quicker than a
        // slide, unless the step is a repeat or wider than a fourth.
        let slurred = match prev {
            Some(p) if midi != p && (midi - p).abs() <= SLUR_MAX_STEP => {
                self.pitch.reset(A440);
                self.pitch.set_value_at_time(midi_to_freq(p) as f32, time);
                let reach = (dur * 0.12).clamp(0.02, 0.045);
                self.pitch
                    .exponential_ramp_to_value_at_time(f as f32, time + reach, time);
                true
            }
            _ => false,
        };
        if !slurred {
            self.pitch.reset(f as f32);
        }
        self.vibrato = vib.is_some();
        if let Some(v) = vib {
            self.lfo_rate.reset(A440);
            self.lfo_rate.set_value_at_time(v.rate as f32, time);
            self.lfo_rate
                .linear_ramp_to_value_at_time(v.rate_end as f32, time + dur, time);
            let onset = (dur * 0.3).min(0.3);
            let d = &mut self.lfo_depth;
            d.reset(UNITY);
            d.set_value_at_time(0.0, time);
            d.set_value_at_time(0.0, time + onset);
            d.linear_ramp_to_value_at_time((v.depth * 0.6) as f32, time + onset + 0.2, time);
            d.linear_ramp_to_value_at_time(v.depth as f32, time + dur, time);
            self.lfo.schedule(time, time + dur + 0.4, rate);
        }
        let attack = if prev.is_some() {
            SLUR_ATTACK
        } else {
            speak(dur)
        };
        let g = &mut self.envelope;
        g.reset(UNITY);
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time((vel * FIDDLE_LEVEL) as f32, time + attack, time);
        g.set_target_at_time(0.0001, time + dur * 0.9, 0.07);
        self.osc.schedule(time, time + dur + 0.4, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.osc.start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.osc.stop_frame()
    }

    /// Add this block into `out`, the fiddle's bus for its channel: the body
    /// comes after, shared by every fiddle note in the channel.
    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        // The detune, in cents: the vibrato's sine through its depth.
        // Connected to the vibrato, the detune moves for the whole note,
        // even before the vibrato's own start.
        let mut cents = [0.0f32; QUANTUM];
        if self.vibrato {
            let mut lfo_freq = [0.0f32; QUANTUM];
            let first = starts_in(self.lfo.start_frame(), block);
            let lfo_pitch = pitch_of(
                &mut self.lfo_rate,
                block,
                rate,
                first,
                &mut lfo_freq,
                Part::Steady(0.0),
            );
            let mut wave = [0.0f32; QUANTUM];
            let (lo, hi) = self
                .lfo
                .render(block, &waves.sine, &lfo_pitch, r, &mut wave);
            // Feeding only the detune, the depth is first rendered when the
            // fiddle starts: clamped then, as above.
            if first {
                self.lfo_depth.clamp_before(block as f64 / rate);
            }
            let mut depth = [0.0f32; QUANTUM];
            self.lfo_depth.fill(block, rate, &mut depth);
            for ((c, w), d) in cents
                .iter_mut()
                .zip(wave.iter())
                .zip(depth.iter())
                .take(hi)
                .skip(lo)
            {
                *c = *w * *d;
            }
        }
        let detune = if self.vibrato {
            Part::Moving(&cents)
        } else {
            Part::Steady(0.0)
        };
        let mut freq = [0.0f32; QUANTUM];
        let first = starts_in(self.osc.start_frame(), block);
        let pitch = pitch_of(&mut self.pitch, block, rate, first, &mut freq, detune);
        let mut wave = [0.0f32; QUANTUM];
        let (lo, hi) = self.osc.render(block, &waves.bowed, &pitch, r, &mut wave);
        let mut envelope = [0.0f32; QUANTUM];
        self.envelope.fill(block, rate, &mut envelope);
        for ((y, w), g) in out
            .iter_mut()
            .zip(wave.iter())
            .zip(envelope.iter())
            .take(hi)
            .skip(lo)
        {
            *y += *w * *g;
        }
    }
}

impl Default for Fiddle {
    fn default() -> Self {
        Self::new()
    }
}

/// A BiquadFilterNode's frequency, before anything is scheduled on it.
const CUTOFF_DEFAULT: f32 = 350.0;
/// The two triangles' detunes, in cents.
const PAD_DETUNE: [f32; 2] = [-7.0, 6.0];
const PAD_Q: f32 = 0.8;

/// One note of `pad()`: two triangles 13 cents apart through a lowpass
/// that opens across the first half of the note, under a slow swell and a
/// release to silence 1.6 s after it.
pub struct PadNote {
    oscs: [TableOsc; 2],
    pitch: f32,
    gain: Param,
    cutoff: Param,
    filter: Biquad,
}

impl PadNote {
    pub const fn new() -> Self {
        PadNote {
            oscs: [TableOsc::new(), TableOsc::new()],
            pitch: 0.0,
            gain: Param::new(0.0),
            cutoff: Param::new(0.0),
            filter: Biquad::new(),
        }
    }

    /// `count` is how many notes the chord has: the level is spread across
    /// them.
    pub fn play(&mut self, midi: f64, time: f64, dur: f64, vel: f64, count: f64, rate: f64) {
        self.pitch = midi_to_freq(midi) as f32;
        let stop = time + dur + 1.6;
        let g = &mut self.gain;
        g.reset(UNITY);
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time(
            ((vel * 0.22) / count.sqrt()) as f32,
            time + (dur * 0.4).min(0.9),
            time,
        );
        release(g, time + dur * 0.8, stop, time);
        let c = &mut self.cutoff;
        c.reset(CUTOFF_DEFAULT);
        c.set_value_at_time(700.0, time);
        c.linear_ramp_to_value_at_time(1900.0, time + dur * 0.5, time);
        self.filter.reset();
        for osc in self.oscs.iter_mut() {
            osc.schedule(time, stop + 0.01, rate);
        }
    }

    pub fn start_frame(&self) -> u64 {
        self.oscs[0].start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.oscs[0].stop_frame()
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        let mut sum = [0.0f32; QUANTUM];
        let mut wave = [0.0f32; QUANTUM];
        for (osc, &detune) in self.oscs.iter_mut().zip(PAD_DETUNE.iter()) {
            let pitch = Pitch::Steady {
                freq: self.pitch,
                detune,
            };
            osc.render(block, &waves.triangle, &pitch, r, &mut wave);
            for (s, w) in sum.iter_mut().zip(wave.iter()) {
                *s += *w;
            }
        }
        // The filter runs every frame of the block, as a node does: before
        // the triangles start its input is silence.
        let mut cutoff = [0.0f32; QUANTUM];
        self.cutoff.fill(block, rate, &mut cutoff);
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        for (((y, x), c), g) in out
            .iter_mut()
            .zip(sum.iter())
            .zip(cutoff.iter())
            .zip(gain.iter())
        {
            self.filter.set(Kind::Lowpass, *c, PAD_Q, 0.0, r);
            *y += self.filter.step(*x) * *g;
        }
        self.filter.flush();
    }
}

impl Default for PadNote {
    fn default() -> Self {
        Self::new()
    }
}

/// Sine: one sine under a linear swell and a release to silence 1 s after
/// the note (`voice('sine')`).
pub struct SineNote {
    osc: TableOsc,
    pitch: f32,
    gain: Param,
}

impl SineNote {
    pub const fn new() -> Self {
        SineNote {
            osc: TableOsc::new(),
            pitch: 0.0,
            gain: Param::new(0.0),
        }
    }

    pub fn play(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        self.pitch = midi_to_freq(midi) as f32;
        let stop = time + dur + 1.0;
        let g = &mut self.gain;
        g.reset(UNITY);
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time((vel * 0.24) as f32, time + (dur * 0.3).min(0.5), time);
        release(g, time + dur * 0.7, stop, time);
        self.osc.schedule(time, stop + 0.01, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.osc.start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.osc.stop_frame()
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let pitch = Pitch::Steady {
            freq: self.pitch,
            detune: 0.0,
        };
        let mut wave = [0.0f32; QUANTUM];
        let (lo, hi) = self
            .osc
            .render(block, &waves.sine, &pitch, rate as f32, &mut wave);
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        for ((y, w), g) in out
            .iter_mut()
            .zip(wave.iter())
            .zip(gain.iter())
            .take(hi)
            .skip(lo)
        {
            *y += *w * *g;
        }
    }
}

impl Default for SineNote {
    fn default() -> Self {
        Self::new()
    }
}

/// A partial's level in a struck bell (`BELL_PARTIAL_VEL`).
const BELL_PARTIAL_VEL: f64 = 0.8;
/// The tubular bell's partials: ratio to the note, and relative level.
const TUBULAR_PARTIALS: [(f64, f64); 5] = [
    (1.0, 0.8),
    (1.19, 0.6),
    (1.56, 0.4),
    (2.0, 0.5),
    (2.71, 0.22),
];
/// How many partials the tubular bell has.
pub const TUBULAR_PARTS: usize = TUBULAR_PARTIALS.len();

/// Tubular: a church or orchestral tubular bell. Five sine partials, each
/// detuned by up to three cents either way and each dying away at its own
/// rate, under one envelope that strikes at once and lets go after at least
/// five seconds.
pub struct Tubular {
    oscs: [TableOsc; TUBULAR_PARTS],
    gains: [Param; TUBULAR_PARTS],
    pitch: [f32; TUBULAR_PARTS],
    detune: [f32; TUBULAR_PARTS],
    envelope: Param,
}

impl Tubular {
    pub const fn new() -> Self {
        Tubular {
            oscs: [const { TableOsc::new() }; TUBULAR_PARTS],
            gains: [const { Param::new(0.0) }; TUBULAR_PARTS],
            pitch: [0.0; TUBULAR_PARTS],
            detune: [0.0; TUBULAR_PARTS],
            envelope: Param::new(0.0),
        }
    }

    /// `draws` are the five `Math.random` draws JavaScript makes for the
    /// partials' detunes, in partial order, each in [0, 1): a partial's
    /// detune is `(draw - 0.5) * 6` cents.
    pub fn play(
        &mut self,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        draws: [f64; TUBULAR_PARTS],
        rate: f64,
    ) {
        let f = midi_to_freq(midi);
        let hold = dur.max(5.0);
        let stop = time + hold + 1.2;
        let g = &mut self.envelope;
        g.reset(UNITY);
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time((vel * 0.26) as f32, time + 0.004, time);
        release(g, time + 0.02, stop, time);
        for (i, &(ratio, amp)) in TUBULAR_PARTIALS.iter().enumerate() {
            if let (Some(p), Some(d), Some(&draw)) =
                (self.pitch.get_mut(i), self.detune.get_mut(i), draws.get(i))
            {
                *p = (f * ratio) as f32;
                *d = ((draw - 0.5) * 6.0) as f32;
            }
            if let (Some(pg), Some(osc)) = (self.gains.get_mut(i), self.oscs.get_mut(i)) {
                pg.reset(UNITY);
                pg.set_value_at_time((BELL_PARTIAL_VEL * amp * 0.62) as f32, time);
                pg.exponential_ramp_to_value_at_time(
                    0.0001,
                    time + hold / (0.5 + ratio * 0.28),
                    time,
                );
                osc.schedule(time, stop + 0.01, rate);
            }
        }
    }

    pub fn start_frame(&self) -> u64 {
        self.oscs[0].start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.oscs[0].stop_frame()
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        let mut sum = [0.0f32; QUANTUM];
        let mut wave = [0.0f32; QUANTUM];
        let mut gain = [0.0f32; QUANTUM];
        for ((osc, pg), (&freq, &detune)) in self
            .oscs
            .iter_mut()
            .zip(self.gains.iter())
            .zip(self.pitch.iter().zip(self.detune.iter()))
        {
            let pitch = Pitch::Steady { freq, detune };
            let (lo, hi) = osc.render(block, &waves.sine, &pitch, r, &mut wave);
            pg.fill(block, rate, &mut gain);
            for ((s, w), g) in sum
                .iter_mut()
                .zip(wave.iter())
                .zip(gain.iter())
                .take(hi)
                .skip(lo)
            {
                *s += *w * *g;
            }
        }
        let mut envelope = [0.0f32; QUANTUM];
        self.envelope.fill(block, rate, &mut envelope);
        for ((y, x), g) in out.iter_mut().zip(sum.iter()).zip(envelope.iter()) {
            *y += *x * *g;
        }
    }
}

impl Default for Tubular {
    fn default() -> Self {
        Self::new()
    }
}
