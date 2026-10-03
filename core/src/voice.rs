//! The voices, each a port of its JavaScript twin in `js/synth.js`, call
//! for call: the same oscillators, the same parameter calls at the same
//! times, so each curve comes out the same. What a note needs from the
//! JavaScript side -- its pitch, time, length, velocity, which parts of it
//! the voice budget let through, and any random draws -- arrives with it.

use crate::QUANTUM;
use crate::osc::Sine;
use crate::param::Param;

/// `midiToFreq` in `js/theory.js`.
pub fn midi_to_freq(midi: f64) -> f64 {
    440.0 * 2f64.powf((midi - 69.0) / 12.0)
}

/// A GainNode's gain, before anything is scheduled on it.
const UNITY: f32 = 1.0;
/// An OscillatorNode's frequency, likewise.
const A440: f32 = 440.0;

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
///
/// `new` is all zeros, so a pool of them costs nothing in the `.wasm`: a
/// static that is all zeros is not written into the file. `strike` sets
/// every value a note reads.
pub struct Fm {
    carrier: Sine,
    modulator: Sine,
    depth: Param,
    envelope: Param,
    pitch: f32,
    mod_pitch: f32,
    /// 2^(detune / 1200): the carrier's detune, which never moves.
    detune: f32,
}

impl Fm {
    pub const fn new() -> Self {
        Fm {
            carrier: Sine::new(),
            modulator: Sine::new(),
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
        // A detune is a float AudioParam too, and Web Audio scales by it
        // as 2^(cents/1200) from the float.
        self.detune = 2f64.powf(o.detune as f32 as f64 / 1200.0) as f32;

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
    pub fn render(&mut self, block: u64, rate: f64, out: &mut [f32; QUANTUM]) {
        let mut wave = [0.0; QUANTUM];
        let steady = [self.mod_pitch; QUANTUM];
        // The modulator's frequency never moves.
        let (lo, hi) = self
            .modulator
            .render(block, &steady, false, rate, &mut wave);
        // The carrier's frequency at every frame of the block: its own
        // pitch plus the modulator through its depth, as Web Audio sums an
        // AudioParam's value and its input, then the detune.
        let mut freq = [self.pitch; QUANTUM];
        for (i, (f, w)) in freq
            .iter_mut()
            .zip(wave.iter())
            .enumerate()
            .take(hi)
            .skip(lo)
        {
            let t = (block + i as u64) as f64 / rate;
            *f += *w * self.depth.value_at(t);
        }
        if self.detune != 1.0 {
            for f in freq.iter_mut() {
                *f *= self.detune;
            }
        }
        // The carrier's is the modulator, connected, so it always moves.
        let (lo, hi) = self.carrier.render(block, &freq, true, rate, &mut wave);
        for (i, (y, w)) in out
            .iter_mut()
            .zip(wave.iter())
            .enumerate()
            .take(hi)
            .skip(lo)
        {
            let t = (block + i as u64) as f64 / rate;
            *y += *w * self.envelope.value_at(t);
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
    body: Sine,
    body_pitch: Param,
    body_gain: Param,
    parts: u32,
}

impl Kalimba {
    pub const fn new() -> Self {
        Kalimba {
            strike: Fm::new(),
            body: Sine::new(),
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

    pub fn render(&mut self, block: u64, rate: f64, out: &mut [f32; QUANTUM]) {
        if self.parts & STRIKE != 0 {
            self.strike.render(block, rate, out);
        }
        if self.parts & BODY != 0 {
            let mut freq = [0.0; QUANTUM];
            for (i, f) in freq.iter_mut().enumerate() {
                *f = self.body_pitch.value_at((block + i as u64) as f64 / rate);
            }
            // Its frequency is set at its start time, so it moves in the block
            // it starts in unless that time falls just before the block.
            let moving = self.body_pitch.moving_from(block as f64 / rate);
            let mut wave = [0.0; QUANTUM];
            let (lo, hi) = self.body.render(block, &freq, moving, rate, &mut wave);
            for (i, (y, w)) in out
                .iter_mut()
                .zip(wave.iter())
                .enumerate()
                .take(hi)
                .skip(lo)
            {
                *y += *w * self.body_gain.value_at((block + i as u64) as f64 / rate);
            }
        }
    }
}

impl Default for Kalimba {
    fn default() -> Self {
        Self::new()
    }
}
